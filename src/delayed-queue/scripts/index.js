const fs = require('fs');
const path = require('path');
const { camelCase } = require('change-case');

// load script files synchronously at application startup
const scriptsDir = path.join(__dirname);
const scripts = loadLuaScripts(scriptsDir);

function loadLuaScripts(dir) {
  return fs.readdirSync(path.join(__dirname, './scripts'), { withFileTypes: true })
    .filter(entry => entry.isFile() && path.extname(entry.name) === '.lua')
    .map(file => [file.name, fs.readFileSync(file.path)]);
}

/**
 * Install user-defined Lua scripts onto Redis instance as custom commands
 * Each command name would be a camel-cased file name
 *
 * @example
 * scripts/ack-job.lua => redis.ackJob()
 *
 * @param {Object} redis - 'ioredis' Redis instance
 */
function installLuaScripts(redis) {
  for (const [fileName, fileContents] of scripts) {
    redis.defineCommand(camelCase(fileName), { lua: fileContents });
  }
}

module.exports = {
  installLuaScripts
};
