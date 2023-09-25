const fs = require('fs');
const path = require('path');
const { camelCase } = require('change-case');

// load script files synchronously at application startup
const scriptsDir = path.join(__dirname);
const scripts = loadLuaScripts(scriptsDir);

function loadLuaScripts(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && path.extname(entry.name) === '.lua')
    .map(file => {
      const filePath = path.join(file.path, file.name);
      return [
        path.parse(filePath).name, // only file name without extension
        fs.readFileSync(filePath, 'utf-8')
      ];
    });
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
  for (const [name, contents] of scripts) {
    redis.defineCommand(camelCase(name), { lua: contents });
  }
}

module.exports = {
  installLuaScripts
};
