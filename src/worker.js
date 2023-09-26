const { onExit } = require('signal-exit');
const config = require('./config');
const createDelayedQueue = require('./delayed-queue');

const queue = createDelayedQueue({ redisOptions: config.redisServer });
const worker = queue.createWorker(config.worker.role, (job) => {
  console.log(`processing ${job.id}: ${job.payload}`);
});

worker.run();
console.log(`Worker running as '${worker.role}'`);

// graceful shutdown
onExit((code, signal) => {
  // no cleanup for error-related exit (uncaughtException) => fail fast
  if (!signal) return;

  console.error(`Received ${signal}. Shutting down.`);

  (async function() {
    await worker.close(1000);

    process.exit(1);
  })();

  // tell we will handle this signal ourselves (prevents immediate exit)
  return true;
});
