# Delayed Queue App

## Getting started

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

## Design decisions

### Redis data structures

**SortedSet `delayed-queue:jobs`**, used as a backlog of all jobs. `job.dueTime` is used as a SCORE. Insertion operation is `O(log(N))`. Range query operation `ZRANGEBYSCORE` is `O(log(N))`. Provides a balance between write and read access patterns.

**List `delayed-queue:dueJobs`**, jobs which are due (job.dueTime <= current_time) are moved from SortedSet `jobs` to this List. The List is used as a FIFO queue. Provides a way to distribute jobs evenly across multiple workers with `at-least-once` semantic. Workers use blocking `BLMOVE` operation to favor push-based approach over constantly polling Redis for new due jobs. Recurring background activity running once per 1s queries due jobs from SortedSet `jobs` using `ZRANGEBYSCORE` and moves them to `dueJobs` List.

**List `delayed-queue:unackedJobs`**, when due job is picked up by worker from `dueJobs` List, it's atomically moved to `unackedJobs` List using `BLMOVE` operation. This is to ensure `at-least-once` queue semantic and prevent losing jobs if worker dies while processing jobs. Recurring background activity monitors `unackedJobs` List and returns them back to `dueJobs` List if job has been unacked for a long time.

**Hash `delayed-queue:job:${jobId}`**, this Hash stores any job details (payload, dueTime, pickupTime). We'are not storing job's payload in `delayed-queue:jobs` SortedSet directly, because multiple jobs can have same payload. Instead `delayed-queue:jobs` stores the job ID and `delayed-queue:job:{$jobId}` Hash keeps job details including payload.


### Dependencies

- `express@4`, for API endpoint exposed via HTTP server
- `ioredis@5`,
- `ulid@2`, [ULID](https://github.com/ulid/spec) algorithm is used for job IDs. ULID composed of time and random component, and can be lexicographically sorted according to time.
