const { Redis } = require('ioredis');
const Worker = require('./worker/worker');
const scripts = require('./scripts');
const keys = require('./keys');
const ulid = require('ulid');
const { toUnixTimestamp } = require('./utils/timer');

function createDelayedQueue(options) {
  const {
    redisOptions
  } = options;

  const redis = new Redis({
    // default timeout values, user can still override
    connectTimeout: 5000,
    commandTimeout: 5000,
    // namespace all queue-related data structures
    keyPrefix: 'delayed-queue:',

    // user-provided options
    ...redisOptions,

    // reconnect automatically when connection is lost
    // but don't reconnect on error
    autoResubscribe: true,
    autoResendUnfulfilledCommands: true,
    reconnectOnError: false
  });

  // install custom Lua scripts
  scripts.installLuaScripts(redis);

  function nextJobId() {
    return ulid.ulid().toLowerCase();
  }

  async function scheduleJob(jobPayload, dueTime) {
    if (dueTime <= toUnixTimestamp(Date.now())) {
      throw new Error(`Job due time must be in future. Due time: '${dueTime}'`);
    }

    const jobId = nextJobId();

    // store job details in Hash
    // add job ID to job backlog SortedSet
    const pipeline = redis.pipeline();
    pipeline.hset(keys.jobDetails(jobId), { payload: jobPayload, dueTime });
    pipeline.zadd(keys.allJobs, dueTime, jobId);
    await pipeline.exec();

    return jobId;
  }

  function createWorker(isLeader, jobHandler, options = {}) {
    const {
      jobProcessingTimeout = 5000
    } = options;
    const role = isLeader ? Worker.Role.Leader : Worker.Role.Follower;

    return new Worker(role, jobHandler, redis, {
      jobProcessingTimeout,
      moveDueJobsInterval: 1000,
      maxDueJobsToMove: 500,
      maxUnackedJobAge: 10000,
      monitorUnackedJobsInterval: 5000
    });
  }

  async function close() {
    await redis.quit();
  }

  return {
    redis,
    scheduleJob,
    createWorker,
    close
  };
}

module.exports = createDelayedQueue;
