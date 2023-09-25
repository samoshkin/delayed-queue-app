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

module.exports = {
  splitInPairs,
  parseZRangeResponse,
  generateJobId
};
