'use strict';
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const core = ['core', 'analysis', 'world', 'tactics', 'intelligence', 'physics', 'rules', 'telemetry'];
function fingerprint(names) {
  const hash = crypto.createHash('sha256');
  for (const name of names) {
    const file = 'src/' + name + '.js';
    hash.update(file); hash.update('\0'); hash.update(fs.readFileSync(path.join(root, file))); hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}
const coreBuild = 'core-' + fingerprint(core);
const engineBuild = 'engine-' + fingerprint(core.concat(fs.existsSync(path.join(root, 'src/engine-facade.js')) ? ['engine-facade'] : []));
// sourceEngineBuild identifies active causal source; lineage never acts as compatibility identity.
module.exports = { coreBuild, engineBuild, sourceEngineBuild: engineBuild, legacySourceEngineBuild: 'tf-0ccdc2176bc4119f' };
