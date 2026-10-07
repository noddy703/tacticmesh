const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const version = require('./version.cjs');
for (const f of ['core', 'analysis', 'world', 'tactics', 'intelligence', 'physics', 'rules', 'telemetry']) require(path.resolve(__dirname, '..', 'src', f + '.js'));
const TF = globalThis.TF;
TF.VERSION = version;
function arg(name, fallback) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : fallback; }
const analysisRebuild = process.argv.includes('--analysis-rebuild');
const halfSeconds = Number(arg('half-seconds', '120'));
const measuredTicks = Math.max(1, Number(arg('ticks', String(Math.round(halfSeconds * 60)))));
const warmup = Math.max(0, Number(arg('warmup', '300')));
const seed = Number(arg('seed', '20261006'));
const fullRegulation = process.argv.includes('--full-regulation');
const disableSharedAnalysis = process.argv.includes('--disable-analysis-index');
const core = TF.createCore({ seed, halfSeconds, renderSnapshots: false });
if (disableSharedAnalysis) TF.analysis = null;
if (analysisRebuild && TF.analysis) core.registerSystem(match => TF.analysis.rebuild(match));
core.step(warmup);
const samples = [];
const start = performance.now();
for (let i = 0; i < measuredTicks && !core.match.state.finished; i++) {
  if (core.match.state.halfTime) {
    if (!fullRegulation || core.match.state.period !== 1 || !core.match.startSecondHalf()) break;
  }
  const tickStart = performance.now(); core.step(1); samples.push(performance.now() - tickStart);
}
const elapsedMs = performance.now() - start;
const sorted = samples.slice().sort((a, b) => a - b);
const percentile = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : 0;
const report = {
  kind: 'tick-benchmark', engineVersion: TF.VERSION, seed,
  halfSeconds, fullRegulationRequested: fullRegulation, fullRegulationCompleted: fullRegulation && !core.match.clock.shortenedForTesting && core.match.state.finished && core.match.state.period === 2, shortenedForTesting: core.match.clock.shortenedForTesting,
  requestedMeasuredTicks: measuredTicks, measuredTicks: samples.length, warmupTicks: warmup,
  elapsedMs: Number(elapsedMs.toFixed(2)), ticksPerSecond: Number((samples.length / Math.max(.001, elapsedMs / 1000)).toFixed(2)),
  tickMs: { p50: Number(percentile(.5).toFixed(4)), p95: Number(percentile(.95).toFixed(4)), p99: Number(percentile(.99).toFixed(4)), max: Number((sorted.at(-1) || 0).toFixed(4)) },
  node: process.version, platform: process.platform, release: os.release(), arch: process.arch,
  cpu: (os.cpus()[0] || {}).model || 'unknown', cpuCount: os.cpus().length,
  roster: { active: core.match.players.filter(p => p.active).length, total: core.match.players.length },
  renderSnapshots: false, telemetryDecisionBuffer: core.match.telemetry.debugDecisions.length,
  sharedAnalysisEnabled: !disableSharedAnalysis && !!TF.analysis, sharedAnalysisRebuild: analysisRebuild,
  deterministicCheckpointHash: TF.hashCheckpoint(TF.captureCheckpoint(core.match)),
  heapUsedBytes: process.memoryUsage().heapUsed,
  state: { tick: core.match.tick, phase: core.match.state.phase, halfTime: core.match.state.halfTime }
};
const output = arg('out', null);
if (output) fs.writeFileSync(path.resolve(output), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
