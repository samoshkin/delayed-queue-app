const express = require('express');
const { onExit } = require('signal-exit');
const { setTimeout: setTimeoutPromise } = require('node:timers/promises');
const config = require('./config');
const createDelayedQueue = require('./delayed-queue');

const queue = createDelayedQueue({ redisOptions: config.redisServer });

const app = express();
app.use(express.json());
app.post('/', onScheduleJobHandler);
app.use(notFoundHandler);
app.use(errorHandler);

const { port, host } = config.api;
const server = app.listen(port, host, () => {
  console.log(`🚀 Listening at http://${host}:${port}/`);
});

// graceful shutdown
onExit((code, signal) => {
  // no cleanup for failure-related exit => fail fast
  if (!signal) return;

  console.error(`Received ${signal}. Shutting down.`);

  (async function() {
    queue.close();
    server.close();

    await setTimeoutPromise(1000);

    // kill ourselves respecting signal and exit code = signal + 128
    process.kill(process.pid, signal);
  })();

  return true;
});

async function onScheduleJobHandler(req, res) {
  const { payload, dueTime } = req.body;
  const jobId = await queue.scheduleJob(payload, dueTime);
  res.json({ jobId });
}

function errorHandler(err, _req, res, _next) {
  console.error(err);
  return res.status(500).json({ message: `${err}` });
}

function notFoundHandler(_req, res) {
  return res.status(404).json({ message: 'not found' });
};
