const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const version = require('./version.cjs');
const runnerSha256AtStart = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
for (const f of ['core', 'analysis', 'world', 'tactics', 'intelligence', 'physics', 'rules', 'telemetry']) require(path.resolve(__dirname, '..', 'src', f + '.js'));
const versionPath = require.resolve('./version.cjs');
delete require.cache[versionPath];
const loadedVersion = require('./version.cjs');
if (loadedVersion !== version) throw new Error(`Source changed while batch runtime loaded: ${version} -> ${loadedVersion}`);
const TF = globalThis.TF;
TF.VERSION = version;
function arg(name, fallback) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : fallback; }
function has(name) { return process.argv.includes('--' + name); }
function merge(target, source) { Object.keys(source || {}).forEach(k => { target[k] = source[k]; }); return target; }
function histogramAdd(into, from) { Object.keys(from || {}).forEach(k => { into[k] = (into[k] || 0) + from[k]; }); return into; }
function teamOptions(id, name, formation, style) {
  const styles = {
    balanced: {}, possession: { tempo: .42, patience: .70, buildupRisk: .30, passingDirectness: .28, compactness: .68, width: .68 },
    press: { pressingIntensity: .86, engagementLine: .77, defensiveLine: .76, counterpress: .84, stamina: .5 },
    direct: { tempo: .7, buildupRisk: .7, passingDirectness: .8, counterattack: .78, attackingWidth: .63 }
  };
  // Generated mode must use the same roster-size draw as the shipped match UI.
  // Fixed-size lab styles retain their explicit 20-player roster.
  const team = { id, name, formation };
  if (style !== 'generated') team.squadSize = 20;
  if (style !== 'generated') team.tactics = Object.assign({ width: .62, attackingWidth: .72, defensiveWidth: .56, defensiveLine: .58, pressingIntensity: .52, engagementLine: .55, compactness: .62, tempo: .52, buildupRisk: .45, passingDirectness: .42, counterattack: .5, counterpress: .5, crossingFrequency: .4, overlapPreference: .48 }, styles[style]);
  return team;
}
function mirrorProfiles(match) {
  const home = match.teams[0], away = match.teams[1];
  home.players.forEach((p, i) => {
    const target = away.players[i];
    if (!target) return;
    target.attributes = JSON.parse(JSON.stringify(p.attributes));
    target.traits = JSON.parse(JSON.stringify(p.traits));
    target.preferredFoot = p.preferredFoot;
    target.height = p.height; target.weight = p.weight;
    target.age = p.age;
  });
}
function runHalf(core) {
  while (!core.match.state.halfTime && !core.match.state.finished) {
    const before = core.match.tick; core.step(300);
    if (core.match.tick === before) break;
  }
}
function progress(index, seed, period, label, core, started) {
  const elapsedSeconds = (performance.now() - started) / 1000;
  process.stderr.write(`[batch] match ${index + 1}/${count} seed=${seed} ${label} tick=${core.match.tick} simulated=${core.match.clock.elapsedSeconds.toFixed(1)}s events=${core.match.events.length} elapsed=${elapsedSeconds.toFixed(1)}s\n`);
}
const count = Math.max(1, Math.floor(Number(arg('matches', '1')) || 1));
const halfSeconds = Math.max(1, Number(arg('half-seconds', '2700')) || 2700);
const firstSeed = Number(arg('seed', '20261006'));
const identical = has('identical-teams');
const homeFormation = arg('home-formation', '4-3-3');
const awayFormation = identical ? homeFormation : arg('away-formation', '4-3-3');
const generatedDefaults = has('generated-defaults');
const homeStyle = generatedDefaults ? 'generated' : arg('home-style', 'balanced');
const awayStyle = identical ? homeStyle : generatedDefaults ? 'generated' : arg('away-style', 'balanced');
const validStyles = ['balanced', 'possession', 'press', 'direct', 'generated'];
if (!validStyles.includes(homeStyle) || !validStyles.includes(awayStyle)) throw new Error(`Unknown style. Choose one of: ${validStyles.join(', ')}`);
const homeName = arg('home-name', 'Redbridge FC');
const awayName = identical ? homeName + ' B' : arg('away-name', 'Ashford Athletic');
const firstTeam = teamOptions('home', homeName, homeFormation, homeStyle);
const secondTeam = teamOptions('away', awayName, awayFormation, awayStyle);
const matches = [], scorelines = {}, distributions = {
  goals: [], shots: [], xG: [], possessionSeconds: [], possessionShare: [], passAttempts: [], completedPasses: [],
  progressivePasses: [], passCompletionRate: [], passChainHistograms: [], possessionDurationHistograms: [],
  possessionDurations: [], goalsByAttackType: [], turnovers: [], defensiveErrors: [], fouls: [], yellowCards: [],
  redCards: [], cards: [], offsides: [], corners: [], saves: [], eventCounts: [], firstHalfRuntimeMs: [], secondHalfRuntimeMs: []
};
let totalRuntimeMs = 0, totalTicks = 0, completedMatches = 0;
let effectiveMatchup = null;
for (let index = 0; index < count; index++) {
  const seed = firstSeed + index;
  const core = TF.createCore({ seed, halfSeconds, renderSnapshots: false, home: firstTeam, away: secondTeam });
  if (!effectiveMatchup) effectiveMatchup = {
    capturedAt: 'match initialization before simulation',
    home: { id: core.match.teams[0].id, name: core.match.teams[0].name, formation: core.match.teams[0].formation, style: homeStyle, tacticsSource: homeStyle === 'generated' ? 'shipped-world-defaults' : 'explicit-batch-style', tactics: JSON.parse(JSON.stringify(core.match.teams[0].tactics)), colors: JSON.parse(JSON.stringify(core.match.teams[0].colors)), roster: { squadSize: core.match.teams[0].players.length, activeCount: core.match.teams[0].activePlayers.length, benchCount: core.match.teams[0].bench.length } },
    away: { id: core.match.teams[1].id, name: core.match.teams[1].name, formation: core.match.teams[1].formation, style: awayStyle, tacticsSource: awayStyle === 'generated' ? 'shipped-world-defaults' : 'explicit-batch-style', tactics: JSON.parse(JSON.stringify(core.match.teams[1].tactics)), colors: JSON.parse(JSON.stringify(core.match.teams[1].colors)), roster: { squadSize: core.match.teams[1].players.length, activeCount: core.match.teams[1].activePlayers.length, benchCount: core.match.teams[1].bench.length } }
  };
  if (identical) mirrorProfiles(core.match);
  const started = performance.now();
  const firstHalfStarted = performance.now();
  runHalf(core);
  const firstHalfRuntimeMs = performance.now() - firstHalfStarted;
  const firstHalfTicks = core.match.tick;
  progress(index, seed, 1, core.match.state.halfTime ? 'half-time' : 'period-end', core, started);
  let secondHalfRuntimeMs = 0;
  if (core.match.state.halfTime) {
    const secondHalfStarted = performance.now();
    core.match.startSecondHalf(); runHalf(core);
    secondHalfRuntimeMs = performance.now() - secondHalfStarted;
    progress(index, seed, 2, core.match.state.finished ? 'full-time' : 'period-end', core, started);
  }
  const runtimeMs = performance.now() - started, m = core.match, stats = TF.telemetry.summary(m);
  const home = stats.teams[m.teams[0].id], away = stats.teams[m.teams[1].id];
  const teams = [home, away], goals = m.score.home + m.score.away;
  const passAttempts = home.passes + away.passes, completedPasses = home.completedPasses + away.completedPasses;
  const possessionTotal = home.possessionSeconds + away.possessionSeconds;
  const goalEvents = (m.telemetry.goals || []).map(e => ({ teamId: e.teamId, attackType: e.attackType || 'unclassified', scorerId: e.scorerId || null, shotPlayerId: e.shotPlayerId || null, timeSeconds: Number((e.time || 0).toFixed(2)) }));
  const goalsByAttackType = goalEvents.reduce((out, e) => { out[e.attackType] = (out[e.attackType] || 0) + 1; return out; }, {});
  const chainHist = teams.reduce((out, t) => histogramAdd(out, t.passChainHistogram), {});
  const durationHist = teams.reduce((out, t) => histogramAdd(out, t.possessionDurationHistogram), {});
  const yellowCards = home.cards.yellow + away.cards.yellow, redCards = home.cards.red + away.cards.red;
  const item = {
    seed, score: { home: m.score.home, away: m.score.away }, scoreline: `${m.score.home}-${m.score.away}`,
    goals, shots: home.shots + away.shots, xG: Number((home.xG + away.xG).toFixed(4)),
    possessionSeconds: { home: home.possessionSeconds, away: away.possessionSeconds },
    possessionShare: possessionTotal ? { home: home.possessionSeconds / possessionTotal, away: away.possessionSeconds / possessionTotal } : null,
    passAttempts, completedPasses, passCompletionRate: passAttempts ? completedPasses / passAttempts : null,
    progressivePasses: home.counters.progressivePass + away.counters.progressivePass,
    passChains: { completedPossessions: home.possessionCount + away.possessionCount, histogram: chainHist, meanHome: home.meanPassesPerPossession, meanAway: away.meanPassesPerPossession },
    possessionDuration: { homeMeanSeconds: home.meanPossessionDurationSeconds, awayMeanSeconds: away.meanPossessionDurationSeconds, histogramSeconds5: durationHist },
    goalsByAttackType, goalEvents, turnovers: home.counters.turnover + away.counters.turnover,
    defensiveErrors: home.defensiveErrors + away.defensiveErrors,
    fouls: home.counters.foul + away.counters.foul, cards: { yellow: yellowCards, red: redCards, total: yellowCards + redCards },
    offsides: home.counters.offside + away.counters.offside, corners: home.counters.corner + away.counters.corner,
    saves: home.counters.save + away.counters.save, teams: stats.teams, audit: TF.telemetry.audit(m),
    firstHalfTicks, finalTick: m.tick, simulatedSeconds: m.clock.elapsedSeconds,
    finished: m.state.finished, shortenedForTesting: m.clock.shortenedForTesting, runtimeMs: Number(runtimeMs.toFixed(2)),
    firstHalfRuntimeMs: Number(firstHalfRuntimeMs.toFixed(2)), secondHalfRuntimeMs: Number(secondHalfRuntimeMs.toFixed(2)), eventCount: m.events.length
  };
  matches.push(item); totalRuntimeMs += runtimeMs; totalTicks += m.tick; completedMatches += m.state.finished ? 1 : 0;
  scorelines[item.scoreline] = (scorelines[item.scoreline] || 0) + 1;
  distributions.goals.push(item.goals); distributions.shots.push(item.shots); distributions.xG.push(item.xG);
  distributions.possessionSeconds.push(item.possessionSeconds); distributions.possessionShare.push(item.possessionShare);
  distributions.passAttempts.push(item.passAttempts); distributions.completedPasses.push(item.completedPasses);
  distributions.progressivePasses.push(item.progressivePasses); distributions.passCompletionRate.push(item.passCompletionRate);
  distributions.passChainHistograms.push(item.passChains.histogram); distributions.possessionDurationHistograms.push(item.possessionDuration.histogramSeconds5);
  distributions.possessionDurations.push(item.possessionDuration); distributions.goalsByAttackType.push(item.goalsByAttackType);
  distributions.turnovers.push(item.turnovers); distributions.defensiveErrors.push(item.defensiveErrors); distributions.fouls.push(item.fouls);
  distributions.yellowCards.push(yellowCards); distributions.redCards.push(redCards); distributions.cards.push(item.cards);
  distributions.offsides.push(item.offsides); distributions.corners.push(item.corners); distributions.saves.push(item.saves);
  distributions.eventCounts.push(item.eventCount); distributions.firstHalfRuntimeMs.push(item.firstHalfRuntimeMs); distributions.secondHalfRuntimeMs.push(item.secondHalfRuntimeMs);
}
const report = {
  kind: 'batch-simulation', engineVersion: TF.VERSION, sourceHash: TF.VERSION, seedPolicy: `${firstSeed} + matchIndex`,
  runner: { file: path.basename(__filename), sha256: runnerSha256AtStart, shaCapturedAt: 'process start before runtime module loading' },
  matches: count, completedMatches, halfSeconds, fullRegulation: halfSeconds === 2700,
  shortenedForTesting: halfSeconds !== 2700, identicalTeams: identical, generatedDefaults,
  matchup: effectiveMatchup,
  stabilityClaim: false, note: 'Exploratory batch output. §127 requires at least 10,000 completed full-regulation matches plus review of all distributions before balance is called stable.',
  elapsedMs: Number(totalRuntimeMs.toFixed(2)), matchesPerSecond: Number((count / Math.max(.001, totalRuntimeMs / 1000)).toFixed(4)),
  ticksPerSecond: Number((totalTicks / Math.max(.001, totalRuntimeMs / 1000)).toFixed(2)),
  environment: { node: process.version, platform: process.platform, release: os.release(), arch: process.arch, cpu: (os.cpus()[0] || {}).model || 'unknown', cpuCount: os.cpus().length, heapUsedBytes: process.memoryUsage().heapUsed },
  completionSummary: {
    method: 'aggregate completed passes divided by aggregate attempts; per-match means are unweighted and count zero-attempt matches as zero only in the all-match mean',
    completedPasses: distributions.completedPasses.reduce((a, b) => a + b, 0),
    attemptedPasses: distributions.passAttempts.reduce((a, b) => a + b, 0),
    aggregateRate: distributions.passAttempts.reduce((a, b) => a + b, 0) ? distributions.completedPasses.reduce((a, b) => a + b, 0) / distributions.passAttempts.reduce((a, b) => a + b, 0) : null,
    aggregateCompletedPerAttempt: distributions.passAttempts.reduce((a, b) => a + b, 0) ? distributions.completedPasses.reduce((a, b) => a + b, 0) / distributions.passAttempts.reduce((a, b) => a + b, 0) : null,
    matchesWithAttempts: distributions.passCompletionRate.filter(Number.isFinite).length,
    conditionalMeanRate: distributions.passCompletionRate.filter(Number.isFinite).length ? distributions.passCompletionRate.filter(Number.isFinite).reduce((a, b) => a + b, 0) / distributions.passCompletionRate.filter(Number.isFinite).length : null,
    conditionalMeanAmongAttemptingMatches: distributions.passCompletionRate.filter(Number.isFinite).length ? distributions.passCompletionRate.filter(Number.isFinite).reduce((a, b) => a + b, 0) / distributions.passCompletionRate.filter(Number.isFinite).length : null,
    unweightedMeanAcrossAllMatches: count ? distributions.passCompletionRate.reduce((sum, rate) => sum + (Number.isFinite(rate) ? rate : 0), 0) / count : null,
    matchesWithoutAttempts: distributions.passCompletionRate.filter(x => x == null).length
  },
  scorelines, distributions, matchesData: matches
};
const output = arg('out', null);
if (output) fs.writeFileSync(path.resolve(output), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
