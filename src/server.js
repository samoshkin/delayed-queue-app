const { onExit } = require('signal-exit');
const { setTimeout: setTimeoutPromise } = require('node:timers/promises');
const api = require('./api');
const config = require('./config');

// create delayed queue instanace
const createDelayedQueue = require('./delayed-queue');
const queue = createDelayedQueue({ redisOptions: config.redisServer });

// create HTTP server
const { port, host } = config.api;
const server = api({ queue }).listen(port, host, () => {
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

    process.exit(1);
  })();

  return true;
});
