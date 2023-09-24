const { createTimer, toUnixTimestamp } = require('../utils/timer');
const keys = require('../keys');

/**
 * Creates a task that repeatedly monitors List of unacked jobs
 * and moves orphaned jobs back to the List of due jobs
 *
 * Orphaned job is determined by checking how for how long it has been unacked
 *
 * @param {Object} options - task options
 * @param {Object} options.redis - An `ioredis` Redis client instance
 * @param {number} options.maxUnackedJobAge - maximum age that is allowed for a job to be unacked
 * before it gets considered orphaned (in milliseconds)
 * @param {Function} options.onTick - called after task completion on each interval tick
 * @param {number} options.monitorInterval - the interval beetween recurring invocation of a monitor task (in milliseconds)
 */
const monitorUnackedJobs = (options) => {
  const {
    redis,
    maxUnackedJobAge,
    monitorInterval,
    onTick = () => {}
  } = options;

  /**
   * Start the 'monitor unacked jobs' activity
   * Runs the task recurrently at given interval
   *
   * @param {AbortSignal} cancelSignal - cancellation signal
   * @returns {Promise} it's neverending Promise, which however fails on error or when cancelled from the outside
   */
  async function start(cancelSignal) {
    for await (const tick of createTimer(monitorInterval, { signal: cancelSignal })) {
      await respawnOrphanedJobs(tick.time, cancelSignal);
      onTick(tick);
    }
  }

  /**
   * Checks for orphaned jobs according to the given time
   * and moves them back to the 'dueJobs' List
   *
   * @param {number} currentTime
   * @param {AbortSignal} cancelSignal - cancellation signal
   * @returns {Promise}
   */
  async function respawnOrphanedJobs(currentTime, cancelSignal) {
    const orphanedJobThreshold = toUnixTimestamp(currentTime - maxUnackedJobAge);

    // fetch all unacked jobs from List
    const unackedJobs = await redis.lrange(keys.unackedJobs, 0, -1);
    cancelSignal.throwIfAborted();

    // query pickupTime for each job
    const pipeline = redis.pipeline();
    for (const jobId of unackedJobs) {
      pipeline.hget(keys.jobDetails(jobId), 'pickupTime');
    }
    const results = await pipeline.exec();
    cancelSignal.throwIfAborted();

    const nackPipeline = redis.pipeline();
    for (const [idx, pickupTime] of results.entries()) {
      // if pickup time is older than orphaned threshold, consider such job as orphaned
      // and move job back to the "dueJobs" List
      if (pickupTime === null || Number(pickupTime) < orphanedJobThreshold) {
        const jobId = unackedJobs[idx];
        nackPipeline.nackJob(2, keys.unackedJobs, keys.dueJobs, jobId);
      }
    }

    if (nackPipeline.length > 0) {
      await nackPipeline.exec();
    }
  }

  return {
    start,
    _respawnOrphanedJobs: respawnOrphanedJobs
  };
};

module.exports = monitorUnackedJobs;
