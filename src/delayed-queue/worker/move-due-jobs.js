const { createTimer, toUnixTimestamp } = require('../utils/timer');
const keys = require('../keys');

/**
 * Creates a task that repeatedly checks 'allJobs' SortedSet
 * and moves due jobs to the 'dueJobs' List
 *
 * The fact that a job is due is determined by 'job.due_time <= currentTime' condition
 *
 * @param {Object} options - task options
 * @param {Object} options.redis - An `ioredis` Redis client instance
 * @param {number} options.moveDueJobsInterval - the interval between recurring invocation of the task (in milliseconds)
 * @param {number} options.maxDueJobsToMove - the max limit of due jobs to move within single turn
 * @param {Function} options.onTick - called after task completion on each interval tick
 */
const moveDueJobs = (options) => {
  const {
    redis,
    moveDueJobsInterval,
    maxDueJobsToMove,
    onTick = () => {}
  } = options;

  /**
   * Start the 'move due jobs' activity
   * Runs the task recurrently at given interval
   *
   * @param {AbortSignal} cancelSignal - cancellation signal
   * @returns {Promise} it's neverending Promise, which however fails on error or when cancelled from the outside
   */
  async function start(cancelSignal) {
    for await (const tick of createTimer(moveDueJobsInterval, { signal: cancelSignal })) {
      await moveDueJobsOnce(tick.time, cancelSignal);
      onTick(tick);
    }
  }

  /**
   * Checks for due jobs in 'allJobs' SortedSet and moves them to 'dueJobs' List
   *
   * @param {number} currentTime
   * @param {AbortSignal} cancelSignal - cancellation signal
   * @returns {Promise}
   */
  async function moveDueJobsOnce(currentTime, cancelSignal) {
    let hasMoreDueJobs = true;

    // call moveDueJobs Lua script, but split it in multiple invocations
    // each invocation is allowed to process up to {options.maxJobsToMove}
    // this is to avoid long-running blocking 'moveDueJobs()' Lua script
    // if there're more jobs to move at currentTime,
    // repeat calling moveDueJobs() until all due jobs are moved
    while (hasMoreDueJobs) {
      hasMoreDueJobs = Boolean(await redis.moveDueJobs(
        2,
        keys.allJobs,
        keys.dueJobs,
        toUnixTimestamp(currentTime),
        maxDueJobsToMove
      ));
      cancelSignal.throwIfAborted();
    }
  }

  return {
    start,
    _moveDueJobsOnce: moveDueJobsOnce
  };
};

module.exports = moveDueJobs;
