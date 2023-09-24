/**
 * @typedef {Object} RedisKeys
 * @property {string} allJobs - SortedSet that acts as a backlog for all jobs
 * @property {string} dueJobs - List that contains due jobs, which are supposed to be processed ASAP
 * @property {string} unackedJobs - List with jobs that are processing right not but not yet finished
 * @property {function(string): string} jobDetails - Hash for each job that contains job details
 */

/**
 * Constants that represent keys for known Redis data structures
 * @type {RedisKeys}
 */
const keys = {
  allJobs: 'jobs',
  dueJobs: 'dueJobs',
  unackedJobs: 'unackedJobs',
  jobDetails: (id) => `job:${id}`
};

module.exports = keys;
