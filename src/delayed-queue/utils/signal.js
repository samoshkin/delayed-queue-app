/**
 * Class that emulates native NodeJS and browser AbortError.
 *
 * @class
 * @property {string} code - error code, is always 'ABORT_ERR'.
 * @property {string} name - error name, always 'AbortError'.
 */
class AbortError extends Error {
  constructor() {
    super('The operation was aborted');
    this.code = 'ABORT_ERR';
    this.name = 'AbortError';
  }

  /**
  * Checks whether an error is an instance of `AbortError`.
  * @param {Error} err - error to check
  * @returns {boolean} - check result
  */
  static isAbortError(err) {
    return err.name === 'AbortError';
  }
}

/**
 * Creates a Promise that is rejected with AbortError when the signal is aborted
 *
 * @param {AbortSignal} signal - cancellation signal
 * @returns {Promise} resulting promise
 * @throws {AbortError} promise is rejected with AbortError when the signal is aborted.
 */
function signalToPromise(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      return reject(new AbortError());
    }

    signal.addEventListener('abort', () => { reject(new AbortError()); });
  });
}

module.exports = {
  signalToPromise,
  AbortError
};
