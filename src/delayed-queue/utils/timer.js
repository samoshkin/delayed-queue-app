const { setTimeout: setTimeoutPromise } = require('node:timers/promises');

/**
 * Creates a timer generator that yields a current time at given interval
 *
 * @param {number} interval - time interval in milliseconds
 * @param {Object} [options] - configuration object
 * @param {boolean} [options.runFirstTickImmediately=true] - whether to execute the first tick immediately or wait for the interval time
 * @param {AbortSignal} [options.signal] - cancellation signal to abort timer operation
 */
async function * createTimer(interval, { signal, runFirstTickImmediately = true } = {}) {
  const delay = (ms) => setTimeoutPromise(ms, null, { signal });
  let tickCount = 0;

  if (!runFirstTickImmediately) {
    await delay(interval);
  }

  while (true) {
    yield { time: Date.now(), count: tickCount++ };
    await delay(interval);
  }
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
  toUnixTimestamp
};
