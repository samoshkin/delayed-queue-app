// stop Redis server instance on test suite teardown
module.exports = async() => {
  const redisServer = global.redisServer;

  // if it's running, stop Redis server
  if (redisServer && redisServer.getInstanceInfo()) {
    await redisServer.stop();
  }
};
