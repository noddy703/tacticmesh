'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const os = require('os'), cp = require('child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tacticmesh-identity-'));
function run(relative) { return cp.execFileSync(process.execPath, [relative], { cwd: temp, encoding: 'utf8' }); }
function identity() {
  return JSON.parse(cp.execFileSync(process.execPath, ['-e', "console.log(JSON.stringify(require('./tools/engine-version.cjs')))"], { cwd: temp, encoding: 'utf8' }));
}
function builtIdentity(expected) {
  run('tools/build.cjs');
  const html = fs.readFileSync(path.join(temp, 'tacticmesh.html'), 'utf8');
  const read = name => JSON.parse(html.match(new RegExp('window\\.TF\\.' + name + ' = ("[^"\\n]+");'))[1]);
  assert.equal(read('CORE_BUILD'), expected.coreBuild);
  assert.equal(read('ENGINE_BUILD'), expected.engineBuild);
  assert.equal(read('SOURCE_ENGINE_BUILD'), expected.engineBuild);
  assert.equal(read('LEGACY_SOURCE_ENGINE_BUILD'), 'tf-0ccdc2176bc4119f');
  const manifest = JSON.parse(fs.readFileSync(path.join(temp, 'agents/manifest.json')));
  assert.equal(manifest.coreBuild, expected.coreBuild);
  assert.equal(manifest.engineBuild, expected.engineBuild);
  assert.equal(manifest.sourceEngineBuild, expected.engineBuild);
  assert.equal(manifest.legacySourceEngineBuild, 'tf-0ccdc2176bc4119f');
  assert.equal(manifest.applicationBuild, read('VERSION'));
  return read('VERSION');
}
try {
  for (const entry of ['index.html', 'templates', 'src', 'tools', 'package.json', 'package-lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'llms.txt', 'assets', 'licenses', 'agents']) {
    fs.cpSync(path.join(root, entry), path.join(temp, entry), { recursive: true });
  }
  const baseline = identity(), baselineApp = builtIdentity(baseline);
  assert.equal(baseline.sourceEngineBuild, baseline.engineBuild);
  assert.equal(baseline.legacySourceEngineBuild, 'tf-0ccdc2176bc4119f');
  fs.appendFileSync(path.join(temp, 'src/physics.js'), '\n/* isolated identity fixture: causal source changed */\n');
  const changed = identity(), changedApp = builtIdentity(changed);
  assert.notEqual(changed.coreBuild, baseline.coreBuild);
  assert.notEqual(changed.engineBuild, baseline.engineBuild);
  assert.notEqual(changed.sourceEngineBuild, baseline.sourceEngineBuild);
  assert.notEqual(changedApp, baselineApp);
  assert.equal(changed.legacySourceEngineBuild, baseline.legacySourceEngineBuild);
  fs.appendFileSync(path.join(temp, 'src/product-ui.js'), '\n/* isolated identity fixture: cosmetic source changed */\n');
  const cosmetic = identity(), cosmeticApp = builtIdentity(cosmetic);
  assert.deepEqual(cosmetic, changed);
  assert.notEqual(cosmeticApp, changedApp);
  console.log('Active core/engine/source identities track causal bytes; cosmetic changes preserve them and legacy lineage stays distinct.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
