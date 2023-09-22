const express = require('express');
const config = require('./config');

const app = express();
app.use(express.json());
app.post('/', scheduleJobHandler);
app.use(notFoundHandler);
app.use(errorHandler);

function scheduleJobHandler(req, res) {
  const json = req.body;
  res.json(json);
}

function errorHandler(err, _req, res, _next) {
  console.error(err);
  return res.status(500).json({
    message: config.nodeEnv === 'production'
      ? 'unknown error'
      : `${err}`
  });
}

function notFoundHandler(_req, res) {
  return res.status(404).json({ message: 'not found' });
};

module.exports = app;
