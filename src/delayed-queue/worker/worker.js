const { EventEmitter, once } = require('events');
const { AbortError } = require('../utils/signal');
const processDueJobs = require('./process-due-jobs');
const moveDueJobs = require('./move-due-jobs');
const monitorUnackedJobs = require('./monitor-unacked-jobs');
const assert = require('assert/strict');

/**
 * Class that listens for due jobs and dispatches them to job handler
 *
 * Worker can be run in two roles:
 * - follower, listens to upcoming due jobs and dispatches them
 * - leader, plus detects due jobs and monitors unacked jobs
 *
 * @property {Worker.Role} status - Worker's role
 * @property {Worker.Status} status - Worker's current status
 *
 * @fires Worker#error
 * @fires Worker#close, when worker is completely stopped
 * @fires Worker#jobTimeout, when processing of a single job exceeds the timeout
 * @fires Worker#jobError, when processing of a single job fails (Worker is still healthy and continue processing)
 */
class Worker extends EventEmitter {
  #cancelController = new AbortController();
  #tasks = [];
  #jobHandler;
  #redis;
  #options;

  /**
   * Worker roles enum
   * @enum
   * @readonly
   */
  static Role = {
    Leader: 'leader',
    Follower: 'follower'
  };

  /**
   * Worker lifecycle stage enum
   * @enum
   * @readonly
   */
  static Status = {
    /** just instantiated worker that is not running yet (initial state) */
    Idle: 'idle',

    /** worker is running */
    Running: 'running',

    /** Worker is closing (due to cancellation, or error) */
    Closing: 'closing',

    /** Worker is closed (terminal state) */
    Closed: 'closed'
  };

  /**
   * Creates a new Worker instance.
   * @constructor
   *
   * @param {Worker.Role} role - role of the worker
   * @param {Function} jobHandler - job processing callback
   * @param {Object} redisConn - `ioredis` Redis client instance
   * @param {Object} options - extra config options
   * @param {Object} options.jobProcessingTimeout - timeout for processing a single job
   * @param {Object} options.moveDueJobsInterval - how often to check jobs backlog for due jobs
   * @param {Object} options.maxDueJobsToMove - how many due jobs to move from backlog in one turn
   * @param {Object} options.maxUnackedJobAge - max age of unacked job when it's considered orphaned and returned to queue
   * @param {Object} options.monitorUnackedJobsInterval - how often to monitor unacked jobs to detect orphans
   */
  constructor(role, jobHandler, redis, options) {
    super();

    this.role = role;
    this.status = Worker.Status.Idle;
    this.#jobHandler = jobHandler;
    this.#redis = redis;
    this.#options = options;

    // on error, close Worker and cancel all ongoing tasks
    this.on('error', () => {
      this.close();
    });
  }

  /**
   * Starts the worker
   */
  run() {
    assert(this.status === Worker.Status.Idle, 'Can call run() only once for just created Worker');

    this.status = Worker.Status.Running;

    this.#processDueJobs();

    // extra queue maintenance activities if run as Leader
    if (this.role === Worker.Role.Leader) {
      this.#moveDueJobs();
      // this.#monitorUnackedJobs();
    }

    return Promise.allSettled(this.#tasks).then(() => {
      this.status = Worker.Status.Closed;
      this.emit('close');
    });
  }

  /**
   * Stops the worker
   *
   * @param {number} timeout - timeout to wait for worker to stop (in milliseconds)
   * @returns {Promise} - resolves when worker is fully stopped
   * @throws {AssertionError} - up attempt to close the idle worker
   */
  async close(timeout) {
    assert(this.status !== Worker.Status.Idle, 'Idle worker cannot be closed');

    // already closed
    if (this.status === Worker.Status.Closed) {
      return Promise.resolve();
    }

    // when running or closing
    this.#cancelController.abort();
    this.status = Worker.Status.Closing;
    await once(this, 'close', { signal: timeout && AbortSignal.timeout(timeout) });
  }

  #runTask(task) {
    const cancelSignal = this.#cancelController.signal;
    const promise = task.start(cancelSignal);
    this.#tasks.push(promise);

    promise.catch(err => {
      // if not a cancellation-related error, emit 'error' event
      if (!AbortError.isAbortError(err)) {
        this.emit('error', err);
      }
    });
  }

  #processDueJobs() {
    this.#runTask(processDueJobs({
      redis: this.#redis,
      jobProcessingTimeout: this.#options.jobProcessingTimeout,
      jobHandler: this.#jobHandler,
      onJobTimeout: (evt) => {
        this.emit('jobTimeout', evt);
      },
      onJobProcessed: (evt) => {
        this.emit('jobProcessed', evt);
      },
      onJobError: (evt) => {
        this.emit('jobError', evt);
      }
    }));
  }

  #monitorUnackedJobs() {
    this.#runTask(monitorUnackedJobs({
      redis: this.#redis,
      maxUnackedJobAge: this.#options.maxUnackedJobAge,
      monitorInterval: this.#options.monitorUnackedJobsInterval,
      onTick: () => {
        // internal logging
      }
    }));
  }

  #moveDueJobs() {
    this.#runTask(moveDueJobs({
      redis: this.#redis,
      moveDueJobsInterval: this.#options.moveDueJobsInterval,
      maxDueJobsToMove: this.#options.maxDueJobsToMove,
      onTick: () => {
        // internal logging
      }
    }));
  }
}

module.exports = Worker;
