const packageJson = require('../package.json');

const config = {
  version: packageJson.version,
  name: packageJson.name,
  description: packageJson.description,

  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: process.env.PORT ?? 3000,

  clientOrigins: {
    test: process.env.DEV_ORIGIN ?? '*',
    development: process.env.DEV_ORIGIN ?? '*',
    production: process.env.PROD_ORIGIN ?? 'none'
  }
};

module.exports = config;
