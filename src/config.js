module.exports = {
  nodeEnv: process.env.NODE_ENV ?? 'development',

  api: {
    host: process.env.API_HOST || 'localhost',
    port: process.env.API_PORT || 8080
  },

  redisServer: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    db: process.env.REDIS_DB || 0
  },

  worker: {
    role: process.env.WORKER_ROLE || 'follower'
  }
};
