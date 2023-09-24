module.exports = {
  extends: [
    'standard'
  ],
  parserOptions: {
    ecmaVersion: 2022
  },
  env: {
    jest: true
  },
  rules: {
    'space-before-function-paren': ['error', 'never'],
    semi: ['error', 'always']
  }
};
