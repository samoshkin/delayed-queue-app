const { AbortError } = require('./signal');

/**
 * Creates a timer generator that yields a current time at given interval
 *
 * @param {number} interval - time interval in milliseconds
 * @param {Object} [options] - configuration object
 * @param {boolean} [options.runFirstTickImmediately=true] - whether to execute the first tick immediately or wait for the interval time
 * @param {AbortSignal} [options.signal] - cancellation signal to abort timer operation
 */
async function * createTimer(interval, { signal, runFirstTickImmediately = true } = {}) {
  let tickCount = 0;

  if (!runFirstTickImmediately) {
    await delay(interval, signal);
  }

  while (true) {
    yield { time: Date.now(), count: tickCount++ };
    await delay(interval, signal);
  }
}

/**
 * setTimeout() as a Promise with cancellation support
 *
 * @param {*} ms -- interval of delay (in milliseconds)
 * @param {*} signal -- cancellation signal
 * @returns - Promise that resolves when delay elapses
 */
async function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAborted);
      }
      resolve();
    }, ms);

    const onAborted = () => {
      clearTimeout(timer);
      reject(new AbortError());
    };

    if (signal) {
      signal.addEventListener('abort', onAborted, { once: true });
    }
  });
}

/**
 * Converts JS Date (millisecond precision) to Unix timestamp (second precision)
 *
 * @param {number | Date} ms - Date instance or a number that represents a Date
 * @returns {number} - Unix timestamp with seconds precision
 */
function toUnixTimestamp(ms) {
  return Math.floor(ms / 1000);
}

module.exports = {
  createTimer,
  toUnixTimestamp,
  delay
};
