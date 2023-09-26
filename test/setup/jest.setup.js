const dotenv = require('dotenv');
const { once } = require('events');
const { Redis } = require('ioredis');
const timestamp = require('unix-timestamp');
const extraJestMatchers = require('jest-extended');

dotenv.config({ path: '.env.test' });

expect.extend(extraJestMatchers);

jest.setTimeout(10000);

timestamp.round = true;

// connect to Redis instance before each individual test
// ensure clean database by flushing all data
// provide Redis connection as 'global.redis' in test files
beforeEach(async() => {
  const redis = global.redis = new Redis({
    port: process.env.REDIS_PORT,
    host: process.env.REDIS_HOST
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
