const supertest = require('supertest');
const timestamp = require('unix-timestamp');
const api = require('../src/api');
const { delay } = require('../src/delayed-queue/utils/timer');
const { submitJobs } = require('./utils');

const createDelayedQueue = require('../src/delayed-queue');

let queue = null;
let now = null;
let server = null;

jest.setTimeout(12000);

beforeEach(async() => {
  queue = createDelayedQueue({
    redisOptions: global.__redisConnOptions__
  });
  now = timestamp.now();
  server = api({ queue });
});

afterEach(async() => {
  await queue.close();
});

test('single worker', async() => {
  const workerJobs = [];
  const worker = queue.createWorker('leader', (job) => {
    workerJobs.push(job.id);
  });

  // schedule 30 jobs with random due time within next 10 seconds
  const jobs = await submitJobs(30, now, 10, scheduleJob);

  worker.run();
  await delay(10100);

  expect(workerJobs).toHaveLength(30);
  // ensure processed jobs ID are same to submitted jobs
  expect(workerJobs).toIncludeAllMembers(jobs.map(x => x.id));
  expect(areJobsProcessedInDueTimeOrder(workerJobs, jobs)).toBe(true);

  await worker.close();
});

test('multiple competing workers', async() => {
  const worker1Jobs = [];
  const worker2Jobs = [];
  const worker3Jobs = [];

  // create 3 workers: 1 leader and 2 followers
  const worker1 = queue.createWorker('leader', (job) => {
    worker1Jobs.push(job.id);
  });
  const worker2 = queue.createWorker('follower', (job) => {
    worker2Jobs.push(job.id);
  });
  const worker3 = queue.createWorker('follower', (job) => {
    worker3Jobs.push(job.id);
  });

  worker1.run();
  worker2.run();
  worker3.run();

  // create 30 jobs with random due time within next 10 seconds
  const jobs = await submitJobs(30, now, 10, scheduleJob);

  await delay(10100);

  const allProcessedJobs = new Set([
    ...worker1Jobs,
    ...worker2Jobs,
    ...worker3Jobs
  ]);
  // ensure jobs are not duplicated across workers
  expect(allProcessedJobs.size).toBe(
    worker1Jobs.length + worker2Jobs.length + worker3Jobs.length);
  expect(allProcessedJobs.size).toBe(30);

  // ensure processed jobs ID are same to submitted jobs
  expect([...allProcessedJobs]).toIncludeAllMembers(jobs.map(x => x.id));

  // ensure order of jobs is respected for each worker
  expect(areJobsProcessedInDueTimeOrder(worker1Jobs, jobs)).toBe(true);
  expect(areJobsProcessedInDueTimeOrder(worker2Jobs, jobs)).toBe(true);
  expect(areJobsProcessedInDueTimeOrder(worker3Jobs, jobs)).toBe(true);

  await Promise.all([
    worker1.close(),
    worker2.close(),
    worker3.close()
  ]);
});

// iterate over processed jobs in order they were processed
// and see their respective dueTimes
// to ensure dueTime monotonically increases
function areJobsProcessedInDueTimeOrder(jobs, allJobs) {
  const allJobIndex = Object.fromEntries(allJobs.map(x => [x.id, x]));

  let prevJobDueTime = 0;
  let i = 0;
  while (i < jobs.length) {
    const jobId = jobs[i];
    const jobDueTime = allJobIndex[jobId].dueTime;

    if (jobDueTime < prevJobDueTime) return false;
    prevJobDueTime = jobDueTime;
    i += 1;
  }

  return true;
}

// send a request to API to schedule new job
// returns job ID
async function scheduleJob(jobNumber, dueTime) {
  const response = await supertest(server)
    .post('/')
    .send({ dueTime, payload: `job #${jobNumber}` })
    .set('Accept', 'application/json')
    .expect('Content-Type', /json/)
    .expect(200);
  const { jobId } = response.body;
  return jobId;
}
