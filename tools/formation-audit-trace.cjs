const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const versionPath = path.resolve(__dirname, 'version.cjs');
delete require.cache[versionPath];
const sourceVersion = require('./version.cjs');
const runnerSha256 = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
for (const file of ['core', 'analysis', 'world', 'tactics', 'intelligence', 'physics', 'rules', 'telemetry']) require(path.join(root, 'src', file + '.js'));
const TF = globalThis.TF;
TF.VERSION = sourceVersion;
delete require.cache[versionPath];
if (require('./version.cjs') !== sourceVersion) throw new Error('Source changed while loading the formation audit trace runtime.');
function arg(name, fallback) { const index = process.argv.indexOf('--' + name); return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback; }
function point(p) { return p ? { x: Number(p.x), y: Number(p.y) } : null; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
const seed = Number(arg('seed', '20261010')) || 20261010;
const seconds = Math.max(10, Math.min(180, Number(arg('seconds', '120')) || 120));
const output = path.resolve(arg('out', path.join(root, '.project', 'reports', `formation-audit-${sourceVersion}-seed${seed}-${seconds}s.json`)));
const core = TF.createCore({ seed, halfSeconds: 2700, renderSnapshots: false,
  home: { id: 'home', name: 'Redbridge FC', formation: arg('home-formation', '4-3-3') },
  away: { id: 'away', name: 'Ashford Athletic', formation: arg('away-formation', '4-2-3-1') } });
const match = core.match, originalUpdateTelemetry = TF.updateTelemetry, samples = [];
let lastSampleTick = -1;
function capture(sample) {
  const matchState = match.state || {}, restart = matchState.restartInProgress;
  const teams = match.teams.map(team => {
    const players = team.activePlayers.filter(p => p.active && !p.isGoalkeeper).map(p => {
      const tactical = TF.getTacticalContext ? TF.getTacticalContext(match, p) : {};
      return { id: p.id, role: p.role, family: p.positionFamily, position: point(p.position), anchor: point(tactical.anchor || p.formationSlot), actorPhase: tactical.phase || null,
        teamPhase: team.tacticalExpectations && team.tacticalExpectations.phase || team._tacticalState && team._tacticalState.phase || null,
        teamIntent: team.intent || null, action: p.intent && p.intent.type || null, target: point(p.intent && p.intent.target) };
    });
    let maxCrowd = { id: null, total: 1, members: [] };
    players.forEach(player => {
      const nearby = players.filter(other => other.id === player.id || dist(other.position, player.position) <= 6);
      if (nearby.length > maxCrowd.total) maxCrowd = { id: player.id, total: nearby.length, members: nearby.map(other => other.id) };
    });
    const xs = players.map(p => p.position.x), ys = players.map(p => p.position.y);
    const anchorErrors = players.filter(p => p.anchor).map(p => dist(p.position, p.anchor));
    return { id: team.id, side: team.side, formation: team.formation, attackDirection: team.attackDirection,
      intent: team.intent || null, tacticalPhase: team.tacticalExpectations && team.tacticalExpectations.phase || team._tacticalState && team._tacticalState.phase || null,
      maxLocalCrowd: maxCrowd,
      shape: { width: Math.max(...ys) - Math.min(...ys), depth: Math.max(...xs) - Math.min(...xs), meanRoleAnchorError: anchorErrors.length ? anchorErrors.reduce((sum, d) => sum + d, 0) / anchorErrors.length : null },
      players };
  });
  samples.push({ tick: sample.tick, simulatedSeconds: Number(match.clock.elapsedSeconds.toFixed(2)), warning: sample.formationCollapse > 0,
    warningScore: sample.formationCollapse, statePhase: matchState.phase || null, restartType: matchState.restartType || null,
    restartTeamId: matchState.restartTeamId || null, restartInProgress: restart ? { type: restart.type || restart.restartType || null, takerId: restart.takerId || null, teamId: restart.teamId || null } : null,
    ball: { position: point(match.ball.position), ownerId: match.ball.ownerId || null, lastTouchTeamId: match.ball.lastTouchTeamId || null }, teams });
}
TF.updateTelemetry = function (m, dt) {
  const result = originalUpdateTelemetry(m, dt);
  const recent = m.telemetry && m.telemetry.auditSamples || [];
  const sample = recent.length ? recent[recent.length - 1] : null;
  if (sample && sample.tick !== lastSampleTick) { lastSampleTick = sample.tick; capture(sample); }
  return result;
};
while (!match.state.finished && match.clock.elapsedSeconds < seconds) core.step(120);
TF.updateTelemetry = originalUpdateTelemetry;
const flagged = samples.filter(s => s.warning), restartFlags = flagged.filter(s => s.statePhase === 'dead-ball' || s.restartInProgress);
const report = { kind: 'formation-audit-causal-trace', sourceVersion, runner: { file: path.basename(__filename), sha256: runnerSha256, capturedAt: 'process start before runtime module loading' },
  seed, secondsRequested: seconds, simulatedSeconds: Number(match.clock.elapsedSeconds.toFixed(2)), ticks: match.tick, finished: match.state.finished,
  matchup: match.teams.map(team => ({ id: team.id, name: team.name, side: team.side, formation: team.formation, tactics: JSON.parse(JSON.stringify(team.tactics)) })),
  detector: { source: 'src/telemetry.js sampled audit (unchanged)', cadenceTicks: 60, cadenceSeconds: 1,
    rule: 'For each team active non-goalkeepers, compute each player’s count as self + same-team outfielders within 6m; flag a sample if any count is >=5. Audit increments one boolean sample, regardless of count.',
    allSamples: samples.length, flaggedSamples: flagged.length, flaggedDuringRestart: restartFlags.length,
    flaggedDuringLivePlay: flagged.length - restartFlags.length, flagRate: samples.length ? flagged.length / samples.length : null },
  auditSamples: samples };
if (require('./version.cjs') !== sourceVersion) throw new Error('Source changed while running the formation audit trace.');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ output: path.relative(root, output), sourceVersion, runnerSha256, simulatedSeconds: report.simulatedSeconds,
  samples: samples.length, flaggedSamples: flagged.length, flaggedDuringRestart: restartFlags.length, flaggedDuringLivePlay: flagged.length - restartFlags.length }, null, 2) + '\n');
