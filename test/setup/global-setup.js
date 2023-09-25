const { RedisMemoryServer } = require('redis-memory-server');
const dotenv = require('dotenv');

// start Redis server on test suite global setup
// single Redis server instance will be shared across all test files and tests
module.exports = async() => {
  dotenv.config({ path: '.env.test' });

  console.log(process.env.REDIS_MSVERSION);

  const redisServer = new RedisMemoryServer({
    instance: {
      host: String(process.env.REDIS_HOST),
      port: Number(process.env.REDIS_PORT)
    },
    binary: {
      version: process.env.REDISMS_VERSION
    }
  });
  await redisServer.ensureInstance();

  global.redisServer = redisServer;
};
