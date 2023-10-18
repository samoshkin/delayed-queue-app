const createDelayedQueue = require('../src/delayed-queue');
const processDueJobs = require('../src/delayed-queue/worker/process-due-jobs');
const timestamp = require('unix-timestamp');
const { delay } = require('../src/delayed-queue/utils/timer');
const { EventEmitter, once } = require('events');

let queue = null;
let redis = null;
let cancelController = null;
let signal = null;

let now = null;

beforeEach(async() => {
  redis = global.redis;
  cancelController = new AbortController();
  signal = cancelController.signal;
  queue = createDelayedQueue({
    redisOptions: global.__redisConnOptions__
  });
  now = timestamp.now();
});

afterEach(async() => {
  queue.close();
  cancelController.abort();
});

test('processes due jobs one by one', async() => {
  await lpushDuesJobsToQueue([
    'first',
    'second',
    'third'
  ]);

  const jobsHandled = [];
  const ee = new EventEmitter();
  const task = processDueJobs({
    redis: queue.redis,
    jobProcessingTimeout: 1000,
    jobHandler: (job) => {
      jobsHandled.push(job);
    },
    onJobError: (err) => { throw err; },
    onJobProcessed: (job) => { ee.emit('jobProcessed', job); }
  });

  await Promise.race([
    task.start(signal),
    (async() => {
      await once(ee, 'jobProcessed');
      expect(jobsHandled).toHaveLength(1);
      expect(jobsHandled).toMatchObject([
        { id: 'third' }
      ]);

      await once(ee, 'jobProcessed');
      expect(jobsHandled).toHaveLength(2);
      expect(jobsHandled).toMatchObject([
        { id: 'third' },
        { id: 'second' }
      ]);

      await once(ee, 'jobProcessed');
      expect(jobsHandled).toHaveLength(3);
      expect(jobsHandled).toMatchObject([
        { id: 'third' },
        { id: 'second' },
        { id: 'first' }
      ]);
    })()
  ]);
});

test('sets pickup time when job is taken from queue', async() => {
  await lpushDuesJobsToQueue([
    'first',
    'second'
  ]);

  const jobsHandled = [];
  const ee = new EventEmitter();
  const task = processDueJobs({
    redis: queue.redis,
    jobProcessingTimeout: 1000,
    jobHandler: (job) => {
      jobsHandled.push(job);
    },
    onJobError: (err) => { throw err; },
    onJobProcessed: (job) => { ee.emit('jobProcessed', job); }
  });

  // pitfall: don't use fake timers because it does not work with ioredis.blmove() implementation
  jest.spyOn(Date, 'now').mockImplementation(() => now * 1000);
  await Promise.race([
    task.start(signal),
    (async() => {
      await once(ee, 'jobProcessed');
      expect(Number(jobsHandled[0].pickupTime)).toBe(now);

      jest.spyOn(Date, 'now').mockImplementation(() => (now + 1) * 1000);
      await once(ee, 'jobProcessed');
      expect(Number(jobsHandled[1].pickupTime)).toBe(now + 1);
    })()
  ]);
});

test('stores job in "unackedJobs" list when job is in progress and removes on completion', async() => {
  await lpushDuesJobsToQueue([
    'first',
    'second'
  ]);

  let unackedJobs;
  const ee = new EventEmitter();
  const task = processDueJobs({
    redis: queue.redis,
    jobProcessingTimeout: 1000,
    jobHandler: async(job) => {
      unackedJobs = await redis.lrange('delayed-queue:unackedJobs', 0, -1);
    },
    onJobError: (err) => { throw err; },
    onJobProcessed: (job) => { ee.emit('jobProcessed', job); }
  });

  await Promise.race([
    task.start(signal),
    (async() => {
      // check what was the state of unackedJobs list during job processing
      await once(ee, 'jobProcessed');
      expect(unackedJobs).toEqual(['second']);

      // drain both elements from queue
      await once(ee, 'jobProcessed');

      // check the unackedJobs list queue is empty
      const unackedJobsAfterCompletion = await redis.lrange('delayed-queue:unackedJobs', 0, -1);
      expect(unackedJobsAfterCompletion).toEqual([]);
    })()
  ]);
});

test('returns job back to "dueJobs" on processing error', async() => {
  await lpushDuesJobsToQueue([
    'first',
    'second',
    'third'
  ]);

  let unackedJobsDuringProcessing;
  const ee = new EventEmitter();
  const task = processDueJobs({
    redis: queue.redis,
    jobProcessingTimeout: 1000,
    maxJobsToProcess: 1,
    jobHandler: async(job) => {
      unackedJobsDuringProcessing = await redis.lrange('delayed-queue:unackedJobs', 0, -1);
      throw new Error('job processing error');
    },
    // eslint-disable-next-line n/handle-callback-err
    onJobError: (err) => {
      // supress job error so it does not escalate higher
    },
    onJobProcessed: (job) => {
      ee.emit('jobProcessed', job);
    }
  });

  jest.spyOn(Date, 'now').mockImplementation(() => now);
  await task.start(signal);

  // check unacked jobs at the moment of processing a job
  expect(unackedJobsDuringProcessing).toEqual(['third']);

  // check that job is removed from unacked jobs on error
  const unackedJobsAfterCompletion = await redis.lrange('delayed-queue:unackedJobs', 0, -1);
  expect(unackedJobsAfterCompletion).toEqual([]);

  // check that job is returned back to the tail of 'dueJobs' queue
  const dueJobs = await redis.lrange('delayed-queue:dueJobs', 0, -1);
  expect(dueJobs).toEqual([
    'third', // third being returned to the tail of the queue
    'first',
    'second'
  ]);

  // see that job pickup time is saved in job details
  const pickupTime = await redis.hget('delayed-queue:job:third', 'pickupTime');
  expect(pickupTime).toEqual(String(now));
});

test('when job processing timeout elapsed returns job to dueJobs queue', async() => {
  await lpushDuesJobsToQueue([
    'first',
    'second'
  ]);

  const ee = new EventEmitter();
  const timeoutSignalFn = jest.fn();
  const task = processDueJobs({
    redis: queue.redis,
    jobProcessingTimeout: 500,
    maxJobsToProcess: 2,
    jobHandler: async(job, { signal }) => {
      if (job.id === 'second') {
        signal.addEventListener('abort', timeoutSignalFn);
        await delay(1000);
      }
    },
    onJobError: (err) => { throw err; },
    onJobProcessed: (job) => {
      ee.emit('jobProcessed', job);
    }
  });

  await task.start(signal);

  // check that cancellation signal has signalled to jobHandler
  expect(timeoutSignalFn).toHaveBeenCalledTimes(1);

  const unackedJobs = await redis.lrange('delayed-queue:unackedJobs', 0, -1);
  const dueJobs = await redis.lrange('delayed-queue:dueJobs', 0, -1);
  expect(unackedJobs).toEqual([]);
  // 'first' job is processed, but 'second' is returned back to queue
  expect(dueJobs).toEqual(['second']);
});

test('job processing blocks when queue is drained and resumes when items are added', async() => {
  await lpushDuesJobsToQueue([
    'first'
  ]);

  const ee = new EventEmitter();
  const jobsHandled = [];
  const jobProcessedFn = jest.fn((job) => {
    ee.emit('jobProcessed', job);
  });

  const task = processDueJobs({
    redis: queue.redis,
    jobProcessingTimeout: 500,
    jobHandler: (job, { signal }) => {
      jobsHandled.push(job);
    },
    onJobError: (err) => { throw err; },
    onJobProcessed: jobProcessedFn
  });

  await Promise.race([
    task.start(signal),
    (async() => {
      await once(ee, 'jobProcessed');
      expect(jobsHandled).toMatchObject([{ id: 'first' }]);
      expect(jobProcessedFn).toHaveBeenCalledTimes(1);

      // still no new jobs after some delay
      // at this point queue is empty
      await delay(500);
      expect(jobsHandled).toMatchObject([{ id: 'first' }]);
      expect(jobProcessedFn).toHaveBeenCalledTimes(1);

      // add some more jobs to queue
      await lpushDuesJobsToQueue([
        'second',
        'third'
      ]);
      await once(ee, 'jobProcessed');
      await once(ee, 'jobProcessed');
      expect(jobsHandled).toMatchObject([
        { id: 'first' },
        { id: 'third' },
        { id: 'second' }
      ]);
      expect(jobProcessedFn).toHaveBeenCalledTimes(3);

      // still no new jobs after some delay
      await delay(300);
      expect(jobProcessedFn).toHaveBeenCalledTimes(3);
    })()
  ]);
});

async function lpushDuesJobsToQueue(jobs) {
  for (const jobId of jobs.reverse()) {
    await redis.lpush('delayed-queue:dueJobs', jobId);
  }
}
