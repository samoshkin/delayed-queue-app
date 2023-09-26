const ulid = require('ulid');

function parseZRangeResponse(response) {
  return Array.from(splitInPairs(response)).map(([item, score]) => [item, Number(score)]);
}

function * splitInPairs(array) {
  for (let i = 0; i < array.length; i += 2) {
    yield [array[i], array[i + 1]];
  }
}

function generateJobId() {
  return ulid.ulid().toLowerCase();
}

// schedule given job count with theid due time randomly choosen
// to be within a window [now, now + maxSecondsFromNow]
async function submitJobs(jobCount, now, maxSecondsFromNow, scheduleJob) {
  const jobs = [];
  let i = 0;
  while (i++ < jobCount) {
    const dueTime = now + getRandomTimeOffsetInSeconds(1, maxSecondsFromNow);
    jobs.push({
      promise: scheduleJob(i, dueTime),
      dueTime
    });
  }

  const jobIds = await Promise.all(jobs.map(x => x.promise));
  return jobIds.map((id, idx) => ({ id, dueTime: jobs[idx].dueTime }));
}

// return a random number between min (inclusive) and max (exclusive)
function getRandomTimeOffsetInSeconds(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

module.exports = {
  splitInPairs,
  parseZRangeResponse,
  generateJobId,
  submitJobs
};
