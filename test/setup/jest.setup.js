const { once } = require('events');
const { Redis } = require('ioredis');
const timestamp = require('unix-timestamp');
const extraJestMatchers = require('jest-extended');

expect.extend(extraJestMatchers);

jest.setTimeout(10000);

timestamp.round = true;

// connect to Redis instance before each individual test
// ensure clean database by flushing all data
// provide Redis connection as 'global.redis' in test files
beforeEach(async() => {
  const redis = global.redis = new Redis({
    ...globalThis.__redisConnOptions__
  });

  await once(redis, 'connect');
  await redis.flushall();
});

afterEach(async() => {
  jest.clearAllMocks();
  jest.resetAllMocks();
  jest.resetModules();

  await global.redis.quit();
});
