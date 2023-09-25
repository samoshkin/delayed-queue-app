const { toUnixTimestamp } = require('../utils/timer');
const { signalToPromise, AbortError } = require('../utils/signal');
const keys = require('../keys');

const noop = () => {};

/**
 * Creates a task that listens to 'dueJobs' List and processes jobs ASAP
 *
 * @param {Object} options - task options
 * @param {Object} options.redis - An `ioredis` Redis client instance
 * @param {number} options.jobProcessingTimeout - maximum time allowed for job handler to work
 * before job is nacked and processing gets cancelled
 * @param {Function} options.jobHandler - processing logic for the job
 * @param {Function} options.maxJobsToProcess - maximum number of jobs to process from queue before exit
 * by default there's no limit on max jobs to process
 * @param {Function} [options.onJobError] - called when job processing encounters error while processing particular job
 * @param {Function} [options.onJobTimeout] - called when job processing hits the 'jobProcessingTimeout'
 */
const processDueJobs = options => {
  const {
    redis,
    jobProcessingTimeout,
    jobHandler,
    maxJobsToProcess = Infinity,
    onJobTimeout = noop,
    onJobError = noop,
    onJobProcessed = noop
  } = options;

  // separate connection for blocking calls when listening to 'dueJobs' List
  let redis2 = null;

  /**
   * Starts the job processing loop
   * Listens for 'dueJobs' list in blocking fashion and dispatches job to job handler
   *
   * @param {AbortSignal} cancelSignal - cancellation signal
   * @returns {Promise} it's neverending Promise, which however fails on error or when cancelled from the outside
   */
  async function start(cancelSignal) {
    redis2 = redis.duplicate();
    cancelSignal.addEventListener('abort', () => {
      redis2.disconnect();
    }, { once: true });

    // NOTE: fetching jobs 1 by 1 for simplicity
    // TODO: prefetch multiple jobs
    let job = null;
    let jobCount = 0;
    while ((job = await fetchJob())) {
      await processJob(job, cancelSignal);
      onJobProcessed(job);
      cancelSignal.throwIfAborted();
      if (++jobCount >= maxJobsToProcess) {
        return;
      }
    }
  }

  /**
   * Send positive acknowledgment for the job
   * Removes job from 'unackedJobs' List
   *
   * @param {string} jobId - job ID
   * @returns {boolean} - indicates whether job was successfully acked
   */
  async function ack(jobId) {
    const acked = await redis.ackJob(2, keys.unackedJobs, keys.jobDetails(jobId), jobId);
    return Boolean(acked);
  }

  /**
   * Send negative acknowledgment for the job
   * Returns job from 'unackedJobs' List back to 'dueJobs' List
   *
   * @param {string} jobId - job ID
   * @returns {boolean} - indicates whether job was successfully nacked
   */
  async function nack(jobId) {
    const nacked = await redis.nackJob(2, keys.unackedJobs, keys.dueJobs, jobId);
    return Boolean(nacked);
  };

  /**
   * Takes next job from 'dueJobs' List in blocking fashion
   * Fetches single job and augments it with job details data stored in a Hash
   * Updates the 'job.pickupTime'
   * @returns {Object} job
   */
  async function fetchJob() {
    // take job from 'dueJobs' List and atomically move it to 'unackedJobs' List
    // if no items in 'dueJobs' List block the connection (similar to BLPOPRPUSH semantic)
    const jobId = await redis2.blmove(keys.dueJobs, keys.unackedJobs, 'RIGHT', 'LEFT', 0);

    // update 'job.pickupTime=current_time'
    // this is used later to detect if job stays in 'unackedJobs' List for too long
    await redis.hset(keys.jobDetails(jobId), 'pickupTime', toUnixTimestamp(Date.now()));

    // pull all job details by job ID from Hash
    const job = await redis.hgetall(keys.jobDetails(jobId));

    return { id: jobId, ...job };
  }

  async function processJob(job, cancelSignal) {
    const timeout = AbortSignal.timeout(jobProcessingTimeout);
    const signal = AbortSignal.any([cancelSignal, timeout]);

    try {
      await Promise.race([
        jobHandler(job, {
          ack: ack.bind(null, job.id),
          nack: nack.bind(null, job.id),
          signal
        }),
        signalToPromise(signal)
      ]);
      await ack(job.id);
    } catch (err) {
      // on error, return job back to the "due jobs" list
      await nack(job.id);

      // if not an AbortError, then it's a job handler error (user code)
      // don't fail the whole Worker, just report to the user code
      if (!AbortError.isAbortError(err)) {
        onJobError(err);
        return;
      }

      if (timeout.aborted) {
        onJobTimeout(job.id);
      }
    }
  }

  return {
    start
  };
};

module.exports = processDueJobs;
