const createDelayedQueue = require('../src/delayed-queue');
const moveDueJobs = require('../src/delayed-queue/worker/move-due-jobs');
const timestamp = require('unix-timestamp');
const { AbortError } = require('../src/delayed-queue/utils/signal');
const { generateJobId } = require('./utils');
const { EventEmitter, once } = require('events');

timestamp.round = true;

let queue = null;
let redis = null;
let cancelController = null;
let signal = null;

let now = null;
let jobsDataSet = null;

beforeEach(async() => {
  redis = global.redis;
  cancelController = new AbortController();
  signal = cancelController.signal;
  queue = createDelayedQueue({
    redisOptions: {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT
    }
  });

  now = timestamp.now();
});

afterEach(async() => {
  jest.useRealTimers();
  queue.close();
  cancelController.abort();
});

test('move due jobs once', async() => {
  jobsDataSet = await seedJobDataSet(
    '-10m; -4m 30s; -2m; -80s; -2s; 6s; 10s; 1m; 2m; 3m'
  );

  const task = moveDueJobs({
    redis: queue.redis,
    moveDueJobsInterval: 1000,
    maxDueJobsToMove: 50
  });

  // when run at 'currentTime=-3m', expect item {-4m 30s} to be last taken due job
  await task._moveDueJobsOnce(timestamp.add(now, '-3m') * 1000, signal);
  await expectNextJobInBacklog(jobsDataSet[2].id);
  await expectDueJobQueue([
    jobsDataSet[1].id,
    jobsDataSet[0].id
  ]);

  // when run at 'currentTime=0', expect item {-2s} to be last taken due job
  await task._moveDueJobsOnce(now * 1000, signal);
  await expectNextJobInBacklog(jobsDataSet[5].id);
  await expectDueJobQueue([
    jobsDataSet[4].id,
    jobsDataSet[3].id,
    jobsDataSet[2].id,
    jobsDataSet[1].id,
    jobsDataSet[0].id
  ]);

  // when run at 'currentTime=2m', expect item {2m} to be last taken due job
  await task._moveDueJobsOnce(timestamp.add(now, '2m') * 1000, signal);
  await expectNextJobInBacklog(jobsDataSet[9].id);
  await expectDueJobQueue([
    jobsDataSet[8].id,
    jobsDataSet[7].id,
    jobsDataSet[6].id,
    jobsDataSet[5].id,
    jobsDataSet[4].id,
    jobsDataSet[3].id,
    jobsDataSet[2].id,
    jobsDataSet[1].id,
    jobsDataSet[0].id
  ]);
});

test('move due jobs while due jobs list is drained', async() => {
  jobsDataSet = await seedJobDataSet(
    '-10m; -4m 30s; -2m; -80s; -2s; 6s; 10s; 1m; 2m; 3m'
  );

  const task = moveDueJobs({
    redis: queue.redis,
    moveDueJobsInterval: 1000,
    maxDueJobsToMove: 50
  });

  // when run at 'currentTime=-2m', expect item {-2m} to be last taken due job
  await task._moveDueJobsOnce(timestamp.add(now, '-2m') * 1000, signal);
  await expectNextJobInBacklog(jobsDataSet[3].id);
  await expectDueJobQueue([
    jobsDataSet[2].id,
    jobsDataSet[1].id,
    jobsDataSet[0].id
  ]);

  await drainDueJobsQueue();

  // when run at 'currentTime=now', expect item {-2s} to be last taken due job
  await task._moveDueJobsOnce(now * 1000, signal);
  await expectNextJobInBacklog(jobsDataSet[5].id);
  // expect old jobs (0, 1, 2, 3) to be already removed from queue
  await expectDueJobQueue([
    jobsDataSet[4].id,
    jobsDataSet[3].id
  ]);

  await drainDueJobsQueue();
  await expectDueJobQueue([]);
});

test('order for due jobs with same due time is undetermined', async() => {
  // multiple jobs are due on 1s
  jobsDataSet = await seedJobDataSet(
    '-10m; -4m 30s; -2m; 1s; 1s; 1s; 1s; 10s; 1m; 2m; 3m'
  );

  const task = moveDueJobs({
    redis: queue.redis,
    moveDueJobsInterval: 1000,
    maxDueJobsToMove: 50
  });

  await task._moveDueJobsOnce(timestamp.add(now, '1s') * 1000, signal);

  // expect all 1s jobs to be moved, the next job in backlog is {10s}
  await expectNextJobInBacklog(jobsDataSet[7].id);

  const dueJobs = await redis.lrange('delayed-queue:dueJobs', 0, -1);
  expect(dueJobs).toHaveLength(7);
  // for jobs which are due on 1s, we cannot guarantee any order
  expect(dueJobs.slice(0, 4)).toEqual(expect.arrayContaining([
    jobsDataSet[3].id,
    jobsDataSet[4].id,
    jobsDataSet[5].id,
    jobsDataSet[6].id
  ]));
  // jobs having distinct due time are ordered according to that time
  expect(dueJobs.slice(4)).toEqual([
    jobsDataSet[2].id,
    jobsDataSet[1].id,
    jobsDataSet[0].id
  ]);
});

test('move due jobs activity running repeatedly', async() => {
  jest.useFakeTimers();
  jest.setSystemTime(now * 1000);

  jobsDataSet = await seedJobDataSet(
    '-2m; -80s; -2s; 6s; 10s; 1m; 2m; 3m'
  );

  const ee = new EventEmitter();
  const onTick = jest.fn(() => { ee.emit('tick'); });
  const task = moveDueJobs({
    redis: queue.redis,
    moveDueJobsInterval: 2000, // run once per 2s
    maxDueJobsToMove: 50,
    onTick
  });

  task.start(signal).catch((err) => {
    if (!AbortError.isAbortError(err)) {
      expect(true).toBe(false);
    }
  });

  // first run, runs immediately
  await once(ee, 'tick');
  await expectNextJobInBacklog(jobsDataSet[3].id);
  await expectDueJobQueue([
    jobsDataSet[2].id,
    jobsDataSet[1].id,
    jobsDataSet[0].id
  ]);

  // fast-forward 2 seconds
  jest.advanceTimersByTime(2000);
  await once(ee, 'tick');
  await expectNextJobInBacklog(jobsDataSet[3].id);

  // fast-forward 2 seconds
  jest.advanceTimersByTime(2000);
  await once(ee, 'tick');
  await expectNextJobInBacklog(jobsDataSet[3].id);

  // fast-forward 2 seconds
  jest.advanceTimersByTime(2000);
  await once(ee, 'tick');
  await expectNextJobInBacklog(jobsDataSet[4].id);
  await expectDueJobQueue([
    jobsDataSet[3].id,
    jobsDataSet[2].id,
    jobsDataSet[1].id,
    jobsDataSet[0].id
  ]);
});

test('works if job backlog is empty', async() => {
  jobsDataSet = await seedJobDataSet();

  jest.useFakeTimers();
  jest.setSystemTime(now * 1000);

  const ee = new EventEmitter();
  const onTick = jest.fn(() => { ee.emit('tick'); });
  const task = moveDueJobs({
    redis: queue.redis,
    moveDueJobsInterval: 2000, // run once per 2s
    maxDueJobsToMove: 50,
    onTick
  });

  task.start(signal).catch((err) => {
    if (!AbortError.isAbortError(err)) {
      expect(true).toBe(false);
    }
  });

  // first run, runs immediately
  await once(ee, 'tick');

  let backlogJobs = await redis.zrange('delayed-queue:jobs', 0, -1);
  expect(backlogJobs).toEqual([]);
  await expectDueJobQueue([]);

  // next timer tick
  jest.advanceTimersByTime(2000);
  await once(ee, 'tick');
  backlogJobs = await redis.zrange('delayed-queue:jobs', 0, -1);
  expect(backlogJobs).toEqual([]);
  await expectDueJobQueue([]);
});

async function expectNextJobInBacklog(jobId) {
  const idx = jobId
    ? jobsDataSet.findIndex(x => x.id === jobId)
    : 0;

  const backlogJobs = await redis.zrange('delayed-queue:jobs', 0, -1);

  // expect 'allJobs' SortedSet contains items starting with given job ID
  expect(backlogJobs).toEqual(
    jobsDataSet.slice(idx).map(x => x.id)
  );
}

async function seedJobDataSet(schedule) {
  if (!schedule) return [];

  const jobsDataSet = schedule.split(';')
    .map(offset => timestamp.add(now, offset.trim()))
    .map(dueTime => ({ dueTime, id: generateJobId() }));

  for (const job of jobsDataSet) {
    await redis.zadd('delayed-queue:jobs', job.dueTime, job.id);
  }

  return jobsDataSet;
}

async function expectDueJobQueue(expectedJobs) {
  const dueJobs = await redis.lrange('delayed-queue:dueJobs', 0, -1);
  expect(dueJobs).toEqual(expectedJobs);
}

async function drainDueJobsQueue() {
  await redis.ltrim('delayed-queue:dueJobs', 1, 0);
}
