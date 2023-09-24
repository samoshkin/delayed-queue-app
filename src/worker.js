const { onExit } = require('signal-exit');
const config = require('./config');
const createDelayedQueue = require('./delayed-queue');

const queue = createDelayedQueue({ redisOptions: config.redisServer });
const worker = queue.createWorker(true, jobHandler);
worker.run();

function jobHandler(job) {
  console.log(`${job.id} : ${job.payload}`);
}

// graceful shutdown
onExit((code, signal) => {
  // no cleanup for error-related exit (uncaughtException) => fail fast
  if (!signal) return;

  console.error(`Received ${signal}. Shutting down.`);

  (async function() {
    await worker.close(1000);

    // kill ourselves respecting signal and set 'exit code = signal + 128'
    process.kill(process.pid, signal);
  })();

  // tell we will handle this signal ourselves (prevents immediate exit)
  return true;
});
