# Delayed Queue App

## Getting started

### Dependencies

This is needs to be in your environment in order to run app and tests:

- `node@^18`
- `docker-compose@1.29.2`
- `docker@20.10.2`


### Start

`npm start`, run all services together (redis, HTTP server, workers) using docker-compose

`npm run submit-jobs`, submit a bunch of jobs against HTTP API endpoint

```
# First start everything
# Will take longer on first run building Docker image
$ npm start

# then, in separate shell session

# Example 1. Submit 50 jobs with their due time within 20 seconds from now
$ JOB_COUNT=50 TIME_OFFSET_SEC=20 npm run submit-jobs

# Example 2. Submit 50 jobs with their due time within 10 seconds from now
$ JOB_COUNT=100 TIME_OFFSET_SEC=10 npm run submit-jobs
```

`npm stop`, shutdown and remove all containers after `npm start` is finished

### Tests
`npm test`, run integration and e2e test. Will take longer on first start downloading Redis server binaries [redis-memory-server](https://github.com/mhassan1/redis-memory-server/).

Tests are written using `Jest`.

NOTE: e2e tests can take a while (~20s), please be patient.

## Design decisions

### Redis data structures

**SortedSet `delayed-queue:jobs`**, used as a backlog of all jobs. `job.dueTime` is used as a SCORE. Insertion operation is `O(log(N))`. Range query operation `ZRANGEBYSCORE` is `O(log(N))`. Provides a balance between write and read access patterns.

**List `delayed-queue:dueJobs`**, jobs which are due (job.dueTime <= current_time) are moved from SortedSet `jobs` to this List. The List is used as a FIFO queue. Provides a way to distribute jobs evenly across multiple workers with `at-least-once` semantic. Workers use blocking `BLMOVE` operation to favor push-based approach over constantly polling Redis for new due jobs. Recurring background activity running once per 1s queries due jobs from SortedSet `jobs` using `ZRANGEBYSCORE` and moves them to `dueJobs` List.

**List `delayed-queue:unackedJobs`**, when due job is picked up by worker from `dueJobs` List, it's atomically moved to `unackedJobs` List using `BLMOVE` operation. This is to ensure `at-least-once` queue semantic and prevent losing jobs if worker dies while processing jobs. Recurring background activity monitors `unackedJobs` List and returns them back to `dueJobs` List if job has been unacked for a long time.

**Hash `delayed-queue:job:${jobId}`**, this Hash stores any job details (payload, dueTime, pickupTime). We'are not storing job's payload in `delayed-queue:jobs` SortedSet directly, because multiple jobs can have same payload. Instead `delayed-queue:jobs` stores the job ID and `delayed-queue:job:{$jobId}` Hash keeps job details including payload.

### Services

We have following processes at runtime:
- `redis`, Redis server
- `server`, API endpoint exposed over HTTP
- `worker`, process that listens for due jobs queue and processes them

Both process types can be scaled independently.

Worker can run in two modes:
- `follower`, main activity is processing due jobs
- `leader`, besides processing due jobs like follower does, leader takes care of queue maintenance tasks as well: detecting and moving due jobs from `allJobs` SortedSet to `dueJobs` List, and monitoring `unackedJobs` List.

### Libraries

- `express@4`, for API endpoint exposed via HTTP server
- `ioredis@5`,
- `ulid@2`, [ULID](https://github.com/ulid/spec) algorithm is used for job IDs. ULID composed of time and random component, and can be lexicographically sorted according to time. And it has more compact encoding than UUID.

### If `allJobs` SortedSet becomes too large

Extra care needs to be taken when `allJobs` queue grows very quickly and becomes huge. Despite insertion and range operations having `O(log(N))` complexity, they might becomes slow if `ZCARD(allJobs)` is too large.

One possible solution would be to implement size-based partitioning of `allJobs` Sorted. If `allJobs` exceeds the size threshold (e.g. 10000 items), it has to be split in two halves. Special background activity can take care of it without disrupting insertion traffic. To keep track of multiple parts splitted, we can introduce yet another `SortedSet` that acts as an index for all splitted parts of a job backlog.

A pseudo code of Lua script handling this partitioning might look like this:

```lua
local originalSet = KEYS[1]
local leftPartId = KEYS[2]
local rightPartId = KEYS[3]
local allJobsIndex = KEYS[4]

local size = redis.call('ZCARD', originalSet)
local midIndex = math.floor(setSize / 2)
redis.call('ZRANGESTORE', leftPartId, originalSet, 0, midIndex - 1)
redis.call('ZRANGESTORE', rightPartId, originalSet, midIndex, -1)

-- take left most elements of each part, and use it as scores in allJobsIndex SortedSet
local leftPartScore = redis.call('ZRANGE', leftPartId, 0, 0, 'WITHSCORES')[2]
local rightPartScore = redis.call('ZRANGE', rightPartId, 0, 0, 'WITHSCORES')[2]

-- Update the allJobs index SortedSet
redis.call('ZADD', allJobsIndex, leftPartId, leftHalfScore)
redis.call('ZADD', allJobsIndex, rightPartId, rightPartScore)
redis.call('ZREM', allJobsIndex, originalSet)
```

**NOTE**: This was not implemented in scope of this task
