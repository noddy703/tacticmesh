const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
for (const file of ['core', 'analysis', 'world', 'tactics', 'intelligence', 'physics', 'rules', 'telemetry']) require('../src/' + file + '.js');
const TF = globalThis.TF;
TF.VERSION = require('../tools/version.cjs');
const root = path.resolve(__dirname, '..');
const batchPath = path.join(root, 'tools', 'batch.cjs');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'football-batch-generated-'));
function run(name, flags) {
  const out = path.join(tempDir, name + '.json');
  const result = spawnSync(process.execPath, [batchPath, '--matches', '1', '--half-seconds', '1', '--seed', '8206', '--out', out, ...flags], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, `batch runner failed: ${result.stderr || result.stdout}`);
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(report.sourceHash, TF.VERSION, 'batch report source fingerprint differs from the loaded runtime');
  assert.equal(report.shortenedForTesting, true, 'short test run was not explicitly marked shortened');
  assert.equal(report.runner.sha256, crypto.createHash('sha256').update(fs.readFileSync(batchPath)).digest('hex'), 'runner hash does not identify the runner loaded at process start');
  assert.equal(report.runner.shaCapturedAt, 'process start before runtime module loading');
  return report;
}
function expectedDefaults() {
  return TF.createMatch({ seed: 8206, home: { name: 'Redbridge FC', formation: '4-3-3' }, away: { name: 'Ashford Athletic', formation: '4-2-3-1' } }).teams;
}
function profile(team) {
  return {
    formation: team.formation,
    tactics: team.tactics,
    colors: team.colors,
    squadSize: team.players.length,
    activeCount: team.activePlayers.length,
    benchCount: team.bench.length,
    players: team.players.map(player => ({
      active: player.active, role: player.role, positionFamily: player.positionFamily,
      formationSlot: player.formationSlot, preferredFoot: player.preferredFoot,
      height: player.height, weight: player.weight, age: player.age,
      attributes: player.attributes, traits: player.traits
    }))
  };
}
try {
  const expected = expectedDefaults();
  const formationFlags = ['--home-formation', '4-3-3', '--away-formation', '4-2-3-1'];
  const both = run('both-generated', [...formationFlags, '--generated-defaults']);
  assert.equal(both.generatedDefaults, true, 'generated-defaults mode was not recorded');
  assert.equal(both.matchup.home.tacticsSource, 'shipped-world-defaults');
  assert.equal(both.matchup.away.tacticsSource, 'shipped-world-defaults');
  assert.equal(both.matchup.home.formation, '4-3-3');
  assert.equal(both.matchup.away.formation, '4-2-3-1');
  assert.deepEqual(both.matchup.home.tactics, expected[0].tactics, 'home generated style differs from shipped world defaults');
  assert.deepEqual(both.matchup.away.tactics, expected[1].tactics, 'away generated style differs from shipped world defaults');
  assert.deepEqual(both.matchup.home.colors, expected[0].colors, 'home kit differs from the shipped default');
  assert.deepEqual(both.matchup.away.colors, expected[1].colors, 'away kit differs from the shipped default');
  assert.deepEqual(both.matchup.home.roster, { squadSize: expected[0].players.length, activeCount: expected[0].activePlayers.length, benchCount: expected[0].bench.length }, 'home generated roster does not use the shipped size draw');
  assert.deepEqual(both.matchup.away.roster, { squadSize: expected[1].players.length, activeCount: expected[1].activePlayers.length, benchCount: expected[1].bench.length }, 'away generated roster does not use the shipped size draw');
  const batchMatch = TF.createMatch({ seed: 8206, halfSeconds: 1, home: { name: 'Redbridge FC', formation: '4-3-3' }, away: { name: 'Ashford Athletic', formation: '4-2-3-1' } });
  assert.deepEqual(profile(batchMatch.teams[0]), profile(expected[0]), 'generated batch home squad differs from a UI-style match initialization');
  assert.deepEqual(profile(batchMatch.teams[1]), profile(expected[1]), 'generated batch away squad differs from a UI-style match initialization');

  const mixed = run('mixed-generated', [...formationFlags, '--home-style', 'generated', '--away-style', 'balanced']);
  assert.equal(mixed.generatedDefaults, false, 'single-side generated style incorrectly labels both teams generated');
  assert.equal(mixed.matchup.home.tacticsSource, 'shipped-world-defaults');
  assert.equal(mixed.matchup.away.tacticsSource, 'explicit-batch-style');
  assert.deepEqual(mixed.matchup.home.tactics, expected[0].tactics, 'home-style generated did not preserve the shipped default profile');
  process.stdout.write('batch generated-default mode records exact shipped tactics and start-time runner metadata\n');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
