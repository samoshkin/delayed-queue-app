const dotenv = require('dotenv');

module.exports = () => {
  dotenv.config({ path: '.env.test' });

  return {
    testFramework: 'jest'
  };
};
