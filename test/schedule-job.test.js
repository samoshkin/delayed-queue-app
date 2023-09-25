const createDelayedQueue = require('../src/delayed-queue');
const timestamp = require('unix-timestamp');
const { parseZRangeResponse } = require('./utils');

timestamp.round = true;

let queue = null;
let redis = null;

beforeEach(async() => {
  redis = global.redis;
  queue = createDelayedQueue({
    redisOptions: {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT
    }
  });
});

afterEach(async() => {
  await queue.close();
});

test('schedule jobs', async() => {
  const now = timestamp.now();

  // schedule jobs with due time randomized
  const job1Id = await queue.scheduleJob('payload1', timestamp.add(now, '10s'));
  const job2Id = await queue.scheduleJob('payload2', timestamp.add(now, '5s'));
  const job3Id = await queue.scheduleJob('payload3', timestamp.add(now, '1s'));
  const job4Id = await queue.scheduleJob('payload4', timestamp.add(now, '2s'));
  const job5Id = await queue.scheduleJob('payload5', timestamp.add(now, '8s'));

  const items = parseZRangeResponse(await redis.zrange('delayed-queue:jobs', 0, -1, 'WITHSCORES'));

  // ensure all jobs are kept in according to due time ASC order
  expect(items).toEqual([
    [job3Id, timestamp.add(now, '1s')],
    [job4Id, timestamp.add(now, '2s')],
    [job2Id, timestamp.add(now, '5s')],
    [job5Id, timestamp.add(now, '8s')],
    [job1Id, timestamp.add(now, '10s')]
  ]);

  // ensure details for each jobs are stored in a separate Hash
  expect(await redis.hgetall(`delayed-queue:job:${job1Id}`)).toMatchObject({
    payload: 'payload1',
    dueTime: String(timestamp.add(now, '10s'))
  });
  expect(await redis.hgetall(`delayed-queue:job:${job2Id}`)).toMatchObject({
    payload: 'payload2',
    dueTime: String(timestamp.add(now, '5s'))
  });
  expect(await redis.hgetall(`delayed-queue:job:${job3Id}`)).toMatchObject({
    payload: 'payload3',
    dueTime: String(timestamp.add(now, '1s'))
  });
  expect(await redis.hgetall(`delayed-queue:job:${job4Id}`)).toMatchObject({
    payload: 'payload4',
    dueTime: String(timestamp.add(now, '2s'))
  });
  expect(await redis.hgetall(`delayed-queue:job:${job5Id}`)).toMatchObject({
    payload: 'payload5',
    dueTime: String(timestamp.add(now, '8s'))
  });
});

test('should allow to schedule jobs only in future', async() => {
  const now = timestamp.now();
  jest.spyOn(Date, 'now').mockImplementation(() => now * 1000);

  const expectedError = 'Job due time must be in future';

  // try to schedule jobs in past and now => fails
  await expect(queue.scheduleJob('payload', now))
    .rejects.toThrow(expectedError);
  await expect(queue.scheduleJob('payload', timestamp.add(now, '-1s')))
    .rejects.toThrow(expectedError);

  // schedule job in future => ok
  await expect(queue.scheduleJob('payload', timestamp.add(now, '2s')))
    .resolves;
});
