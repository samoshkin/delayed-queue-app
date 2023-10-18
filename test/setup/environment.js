const NodeEnvironment = require('jest-environment-node').TestEnvironment;
const { RedisMemoryServer } = require('redis-memory-server');

module.exports = class RedisEnvironment extends NodeEnvironment {
  async setup() {
    await super.setup();

    // start unique Redis server for each test file on a random port
    const redisServer = new RedisMemoryServer({
      binary: {
        version: process.env.REDISMS_VERSION
      },
      autoStart: false
    });
    await redisServer.ensureInstance();
    this.redisServer = redisServer;

    // pass server location to tests through global variable
    this.global.__redisConnOptions__ = {
      host: await redisServer.getHost(),
      port: await redisServer.getPort()
    };
  }

  async teardown() {
    await this.redisServer.stop();
    await super.teardown();
  }
};
