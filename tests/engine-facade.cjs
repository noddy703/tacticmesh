const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = { console, TextEncoder, setTimeout, clearTimeout, Map, Set, Promise };
context.globalThis = context;
vm.createContext(context);
[
  'src/core.js', 'src/analysis.js', 'src/world.js', 'src/tactics.js',
  'src/intelligence.js', 'src/physics.js', 'src/rules.js', 'src/telemetry.js',
  'src/product-data.js', 'src/engine-facade.js'
].forEach(file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
context.TF.VERSION = 'facade-test-build';
const TF = context.TF;

function compiledTeams() {
  const built = TF.productData.compilePack(TF.productData.starterPack());
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  return built.teams;
}
function config(teams, extras = {}) {
  return { matchId: 'facade-contract', seed: 73, home: teams[0], away: teams[1], ...extras };
}

const teams = compiledTeams();
assert.equal(TF.engine.getCapabilities().fixedHz, 60);
assert.ok(TF.engine.getCapabilities().engineBuild);
assert.ok(TF.engine.getCapabilities().coreBuild);
assert.ok(TF.engine.getCapabilities().rulesVersion);
assert.equal(TF.engine.validateMatchConfig(config(teams)).ok, true);
assert.equal(TF.engine.validateMatchConfig({}).ok, false);

const handle = TF.engine.createMatch(config(teams));
assert.equal(handle.match.players.length, teams[0].players.length + teams[1].players.length);
assert.equal(handle.match.teams[0].activePlayers.length, 11);
assert.equal(handle.match.teams[0].players.length, teams[0].players.length);
assert.equal(handle.match.players[0].attributes.acceleration, teams[0].players[0].attributes.acceleration);
assert.equal(handle.match.players[0].traits.riskAppetite, teams[0].players[0].traits.riskAppetite);
assert.equal(handle.match.players[0].sourceId, teams[0].players[0].id);
assert.match(handle.match.players[0].id, /^tm-home-/);
assert.equal(handle.match.playersById[handle.match.players[0].id], handle.match.players[0]);
assert.equal(handle.match.world.players, handle.match.players);
for (let i = 0; i < handle.match.teams[0].players.length; i += 1) {
  for (let j = i + 1; j < handle.match.teams[0].players.length; j += 1) {
    const a = handle.match.teams[0].players[i], b = handle.match.teams[0].players[j];
    for (const key of Object.keys(a)) if (a[key] && typeof a[key] === 'object' && key !== 'team') {
      assert.notEqual(a[key], b[key], `mutable nested template field ${key} must be player-local`);
    }
  }
}

const altered = JSON.parse(JSON.stringify(teams));
altered[0].name = 'A purely cosmetic rename';
altered[0].players[0].name = 'Different display name';
altered[0].crest = 'assets/crests/other.png';
altered[0].kits.home.primary = '#123456';
altered[0].players[0].appearance.skinColor = '#123456';
const cosmetic = TF.engine.createMatch(config(altered));
assert.equal(cosmetic.simulationHash, handle.simulationHash, 'cosmetic changes must not change simulation identity');
assert.deepEqual(cosmetic.match.players.map(p => p.rng.getState()), handle.match.players.map(p => p.rng.getState()), 'cosmetics must not change decision RNG state');

const stepped = TF.engine.stepMatch(handle, 120);
assert.equal(stepped.ticks, 120);
assert.equal(stepped.snapshot.tick, 120);
const subTeam = handle.match.teams[0], outgoing = subTeam.activePlayers[1], substitute = subTeam.bench[0];
TF.rulesLab.requestSubstitution(handle.match, { teamId: subTeam.id, playerId: outgoing.id, substituteId: substitute.id, exitSeconds: 60 });
TF.rulesLab.configure(handle.match, { advantageSeconds: 4.5 });
handle.match._aiTime = 987.25;
const cursor = TF.engine.readEvents(handle, 0);
assert.ok(cursor.nextSequence >= 0);
assert.equal(TF.engine.readEvents(handle, cursor.nextSequence).events.length, 0);

const checkpoint = TF.engine.saveCheckpoint(handle);
const restored = TF.engine.restoreCheckpoint(checkpoint);
assert.equal(TF.hashCheckpoint(TF.captureCheckpoint(handle.match)), TF.hashCheckpoint(TF.captureCheckpoint(restored.match)));
assert.deepEqual(restored.match.substitutionRequests, handle.match.substitutionRequests, 'a queued field-side substitution survives a checkpoint');
assert.deepEqual(restored.match.rulesConfig, handle.match.rulesConfig, 'configured rules survive a checkpoint');
assert.equal(restored.match._aiTime, handle.match._aiTime, 'fallback AI time survives a checkpoint');
TF.engine.stepMatch(handle, 120);
TF.engine.stepMatch(restored, 120);
assert.equal(TF.hashCheckpoint(TF.captureCheckpoint(handle.match)), TF.hashCheckpoint(TF.captureCheckpoint(restored.match)), 'resumed fixed ticks must match uninterrupted ticks');
const workerTarget = TF.engine.createMatch(config(teams));
const stableMatchObject = workerTarget.match;
TF.engine.restoreCheckpointInto(workerTarget, checkpoint);
assert.equal(workerTarget.match, stableMatchObject, 'worker result must restore in place for existing UI references');
assert.equal(TF.hashCheckpoint(TF.captureCheckpoint(workerTarget.match)), TF.hashCheckpoint(checkpoint.core));
for (const alteredConfig of [
  { ...config(teams), matchId: handle.config.matchId, seed: handle.config.seed, knockout: true },
  { ...config(teams), matchId: handle.config.matchId, seed: handle.config.seed, halfSeconds: 120 },
]) {
  const incompatible = TF.engine.createMatch(alteredConfig);
  assert.throws(() => TF.engine.restoreCheckpointInto(incompatible, checkpoint), /team simulation data does not match/i,
    'checkpoint restore must reject a changed knockout mode or half length');
}
const tamperedIdentity = { ...checkpoint, config: { ...checkpoint.config, knockout: true } };
assert.throws(() => TF.engine.restoreCheckpoint(tamperedIdentity), /configuration identity is invalid/i,
  'checkpoint wrapper config must match its saved simulation identity');
const wrongRules = { ...checkpoint, rulesVersion: 'different-laws' };
assert.throws(() => TF.engine.restoreCheckpoint(wrongRules), /rules version/i);

const viaTicks = TF.engine.createMatch(config(teams, { matchId: 'advance-parity', seed: 58 }));
const viaWatch = TF.engine.createMatch(config(teams, { matchId: 'advance-parity', seed: 58 }));
TF.engine.stepMatch(viaTicks, 6);
for (let i = 0; i < 6; i += 1) viaWatch.core.advance(1 / 60);
assert.equal(TF.hashCheckpoint(TF.captureCheckpoint(viaTicks.match)), TF.hashCheckpoint(TF.captureCheckpoint(viaWatch.match)), 'watch advance and headless ticks must execute identical football steps');

const short = TF.engine.createMatch(config(teams, { matchId: 'short-halves', seed: 19, halfSeconds: 1 }));
const firstHalf = TF.engine.stepMatch(short, 120);
assert.equal(firstHalf.status, 'half-time');
assert.equal(firstHalf.ticks, 60);
assert.equal(TF.engine.continueAfterHalfTime(short), true);
const secondHalf = TF.engine.stepMatch(short, 60);
assert.equal(secondHalf.status, 'completed');
assert.equal(TF.engine.getResult(short).winnerId, null, 'single match draws are valid');

const knockout = TF.engine.createMatch(config(teams, { matchId: 'knockout-tie', seed: 31, halfSeconds: 0.1, knockout: true }));
knockout.match.state.finished = true;
knockout.match.clock.period = 2;
knockout.match.state.period = 2;
knockout.match.state.phase = 'full-time';
const enterExtra = TF.engine.stepMatch(knockout, 1);
assert.equal(enterExtra.status, 'running');
assert.equal(knockout.match.clock.period, 3);
const extraBreak = TF.engine.stepMatch(knockout, 6);
assert.equal(extraBreak.status, 'half-time');
const redCarded = knockout.match.teams[0].activePlayers[1];
redCarded.active = false; redCarded.sentOff = true;
assert.equal(TF.engine.continueAfterHalfTime(knockout), true);
const enterShootout = TF.engine.stepMatch(knockout, 6);
assert.equal(enterShootout.status, 'running');
assert.equal(knockout.match.state.knockoutState.phase, 'penalties');
const prePenaltyStats = knockout.match.players.map(p => ({ id: p.id, shots: p.stats.shots, goals: p.stats.goals }));
const prePenaltyTelemetry = { shots: knockout.match.telemetry.shots, goals: knockout.match.telemetry.goals.length };
assert.equal(knockout.match.state.knockoutState.eligible.home.length, knockout.match.state.knockoutState.eligible.away.length, 'fewer eligible players requires the opposite side to reduce to the same number');
assert.ok(knockout.match.state.knockoutState.reduced.away.length === 1);
for (let i = 0; i < 3; i += 1) TF.engine.stepMatch(knockout, 1);
const penaltyStateCheckpoint = TF.engine.saveCheckpoint(knockout);
const penaltyStateRestore = TF.engine.createMatch(config(teams, { matchId: 'knockout-tie', seed: 31, halfSeconds: 0.1, knockout: true }));
TF.engine.restoreCheckpointInto(penaltyStateRestore, penaltyStateCheckpoint);
TF.engine.stepMatch(knockout, 12); TF.engine.stepMatch(penaltyStateRestore, 12);
assert.equal(TF.hashCheckpoint(TF.captureCheckpoint(knockout.match)), TF.hashCheckpoint(TF.captureCheckpoint(penaltyStateRestore.match)), 'physical penalty continuation must be reproducible from an in-place checkpoint');
for (let i = 0; i < 100 && knockout.match.state.knockoutState.history.length === 0; i += 1) TF.engine.stepMatch(knockout, 1);
assert.equal(knockout.match.state.knockoutState.history.length, 1, 'a real kick must resolve before the next shooter');
assert.equal(knockout.match.score.home + knockout.match.score.away, 0, 'shootout goals must not enter match score');
assert.deepEqual(knockout.match.players.map(p => ({ id: p.id, shots: p.stats.shots, goals: p.stats.goals })), prePenaltyStats, 'shootout attempts must not inflate player totals');
assert.equal(knockout.match.telemetry.shots, prePenaltyTelemetry.shots);
assert.equal(knockout.match.telemetry.goals.length, prePenaltyTelemetry.goals);
assert.ok(knockout.match.events.some(e => e.type === 'penalty-shootout-start'));
assert.ok(knockout.match.events.some(e => e.type === 'penalty-attempt'));
assert.ok(knockout.match.events.some(e => e.type === 'shot' && e.playerId === knockout.match.state.knockoutState.history[0].takerId), 'penalty attempt must use the physical shot path');

// Source-supported starter-pack cup fixture. This caught that the penalty
// phase name bypassed the normal rules boundary resolver, so every goalward
// kick timed out as a miss instead of producing a winner.
const cupHome = JSON.parse(JSON.stringify(teams[0]));
const cupAway = JSON.parse(JSON.stringify(teams[1]));
cupHome.id = 'club-0'; cupAway.id = 'club-1';
const cupSeed = parseInt(TF.productData.hash('71:r1-f1').slice(0, 8), 16) >>> 0;
const cup = TF.engine.createMatch(config([cupHome, cupAway], { matchId: 'starter-cup-fixture', seed: cupSeed, halfSeconds: 0.05, knockout: true }));
const homeKicker = cup.match.teams[0].activePlayers[1];
const penalty = cup.match.state.knockoutState = { phase: 'penalties', scores: { home: 4, away: 0 }, attempts: { home: 4, away: 4 }, history: [], eligible: { home: cup.match.teams[0].activePlayers.map(p => p.id), away: cup.match.teams[1].activePlayers.map(p => p.id) }, reduced: { home: [], away: [] }, activeAttempt: { side: 'home', teamId: cup.match.teams[0].id, takerId: homeKicker.id, startTick: cup.match.tick, shot: true, goal: false, resolved: false, bystanderPositions: {} } };
cup.match.state.finished = false; cup.match.state.halfTime = false; cup.match.state.phase = 'open-play';
cup.match.clock.period = 5; cup.match.state.period = 5;
cup.match.players.forEach(p => { p.position.x = 60; p.position.y = 60; p.previousPosition.x = 60; p.previousPosition.y = 60; p.velocity.x = p.velocity.y = 0; });
cup.match.teams[1].activePlayers.find(p => p.isGoalkeeper).active = false;
cup.match.ball.position.x = cup.match.ball.previousPosition.x = 104.8;
cup.match.ball.position.y = cup.match.ball.previousPosition.y = 34;
cup.match.ball.position.z = cup.match.ball.previousPosition.z = 0.11;
cup.match.ball.velocity.x = 18; cup.match.ball.velocity.y = cup.match.ball.velocity.z = 0;
cup.match.ball.ownerId = null; cup.match.ball.lastTouchPlayerId = homeKicker.id; cup.match.ball.lastTouchTeamId = cup.match.teams[0].id; cup.match.ball.lastTouchKind = 'deliberate';
cup.match.ball._lastShotId = homeKicker.id; cup.match.ball._lastShotType = 'shot';
assert.equal(TF.engine.stepMatch(cup, 4).status, 'completed', 'the authentic starter-team fixture must resolve a physical penalty crossing');
assert.equal(penalty.scores.home, 5);
assert.ok(cup.match.events.some(e => e.type === 'penalty-goal'), 'shootout goal must use ordinary goal-line resolution');
assert.equal(TF.engine.getResult(cup).winnerId, cupHome.id);

const delayedGoal = TF.engine.createMatch(config(teams, { matchId: 'delayed-penalty-goal', seed: 49, halfSeconds: 0.1, knockout: true }));
const delayedTaker = delayedGoal.match.teams[0].activePlayers[1];
const delayedKs = delayedGoal.match.state.knockoutState = { phase: 'penalties', scores: { home: 4, away: 0 }, attempts: { home: 4, away: 4 }, history: [], eligible: { home: [], away: [] }, reduced: { home: [], away: [] }, activeAttempt: { side: 'home', teamId: delayedGoal.match.teams[0].id, takerId: delayedTaker.id, startTick: 0, shot: true, goal: false, resolved: false, bystanderPositions: {} } };
delayedGoal.match.state.finished = false; delayedGoal.match.state.halfTime = false; delayedGoal.match.state.phase = 'open-play';
delayedGoal.match.clock.period = 5; delayedGoal.match.state.period = 5;
delayedGoal.match.players.forEach(p => { p.position.x = 45; p.position.y = 60; p.previousPosition.x = 45; p.previousPosition.y = 60; p.velocity.x = p.velocity.y = 0; });
delayedGoal.match.teams[1].activePlayers.find(p => p.isGoalkeeper).active = false;
delayedGoal.match.ball.position.x = delayedGoal.match.ball.previousPosition.x = 100;
delayedGoal.match.ball.position.y = delayedGoal.match.ball.previousPosition.y = 34;
delayedGoal.match.ball.position.z = delayedGoal.match.ball.previousPosition.z = 0.11;
delayedGoal.match.ball.velocity.x = 2.5; delayedGoal.match.ball.velocity.y = delayedGoal.match.ball.velocity.z = 0;
delayedGoal.match.ball.ownerId = null; delayedGoal.match.ball.lastTouchPlayerId = delayedTaker.id; delayedGoal.match.ball.lastTouchTeamId = delayedGoal.match.teams[0].id;
delayedGoal.match.ball.lastTouchKind = 'deliberate'; delayedGoal.match.ball._lastShotId = delayedTaker.id; delayedGoal.match.ball._lastShotType = 'shot';
TF.engine.stepMatch(delayedGoal, 90);
assert.equal(delayedKs.history.length, 0, 'a rebound still moving after 1.5 seconds remains live');
for (let i = 0; i < 240 && delayedGoal.status !== 'completed'; i += 1) TF.engine.stepMatch(delayedGoal, 1);
assert.equal(delayedGoal.status, 'completed', 'a live penalty ball can still score after the former timeout');
assert.equal(delayedKs.scores.home, 5);
assert.ok(delayedGoal.match.events.some(e => e.type === 'penalty-goal'));

const doubleTouch = TF.engine.createMatch(config(teams, { matchId: 'penalty-double-touch', seed: 48, halfSeconds: 0.1, knockout: true }));
const doubleTaker = doubleTouch.match.teams[0].activePlayers[1];
doubleTouch.match.clock.period = 5; doubleTouch.match.state.period = 5; doubleTouch.match.state.phase = 'open-play';
doubleTouch.match.state.knockoutState = { phase: 'penalties', scores: { home: 0, away: 0 }, attempts: { home: 0, away: 0 }, history: [], eligible: { home: [], away: [] }, reduced: { home: [], away: [] }, activeAttempt: { side: 'home', teamId: doubleTouch.match.teams[0].id, takerId: doubleTaker.id, startTick: doubleTouch.match.tick, shot: true, goal: false, resolved: false, bystanderPositions: {} } };
doubleTouch.match.ball.ownerId = doubleTaker.id;
doubleTouch.match.ball.position.x = doubleTouch.match.ball.previousPosition.x = doubleTaker.position.x;
doubleTouch.match.ball.position.y = doubleTouch.match.ball.previousPosition.y = doubleTaker.position.y;
doubleTouch.match.ball.velocity.x = doubleTouch.match.ball.velocity.y = doubleTouch.match.ball.velocity.z = 0;
TF.engine.stepMatch(doubleTouch, 1);
assert.equal(doubleTouch.match.state.knockoutState.history[0].outcome, 'double-touch', 'a kicker regaining the ball directly after a parry cannot play a second touch');
assert.ok(doubleTouch.match.events.some(e => e.type === 'penalty-double-touch'));

// A live, slowly moving penalty ball must not be turned into a miss by a short
// wall-clock timeout; it resolves when it physically stops instead.
const liveKick = TF.engine.createMatch(config(teams, { matchId: 'live-penalty-ball', seed: 47, halfSeconds: 0.1, knockout: true }));
liveKick.match.clock.period = 5; liveKick.match.state.period = 5; liveKick.match.state.phase = 'penalty-shootout';
liveKick.match.rulesConfig = Object.assign({}, liveKick.match.rulesConfig || {}, { minPlayers: 0 });
liveKick.match.players.forEach(p => { p.active = false; });
liveKick.match.teams.forEach(t => { t.activePlayers = []; });
const liveTaker = liveKick.match.players[0];
liveKick.match.ball.position.x = liveKick.match.ball.previousPosition.x = 100;
liveKick.match.ball.position.y = liveKick.match.ball.previousPosition.y = 34;
liveKick.match.ball.position.z = liveKick.match.ball.previousPosition.z = 0.11;
liveKick.match.ball.velocity.x = 0.25; liveKick.match.ball.velocity.y = liveKick.match.ball.velocity.z = 0;
liveKick.match.ball.ownerId = null;
liveKick.match.state.knockoutState = { phase: 'penalties', scores: { home: 0, away: 0 }, attempts: { home: 0, away: 0 }, history: [], eligible: { home: [], away: [] }, reduced: { home: [], away: [] }, activeAttempt: { side: 'home', teamId: liveKick.match.teams[0].id, takerId: liveTaker.id, startTick: liveKick.match.tick, shot: true, goal: false, resolved: false, bystanderPositions: {} } };
TF.engine.stepMatch(liveKick, 90);
assert.equal(liveKick.match.state.knockoutState.history.length, 0, 'a still-moving penalty ball beyond 1.5 seconds remains live');
assert.ok(Math.hypot(liveKick.match.ball.velocity.x, liveKick.match.ball.velocity.y) > 0.12);
TF.engine.stepMatch(liveKick, 120);
assert.equal(liveKick.match.state.knockoutState.history[0].outcome, 'stopped');

const earlyCup = TF.engine.createMatch(config(teams, { matchId: 'early-penalties', seed: 41, halfSeconds: 0.1, knockout: true }));
earlyCup.match.state.knockoutState = { phase: 'penalties', scores: { home: 3, away: 0 }, attempts: { home: 3, away: 3 }, history: [], eligible: { home: earlyCup.match.teams[0].activePlayers.map(p => p.id), away: earlyCup.match.teams[1].activePlayers.map(p => p.id) }, reduced: { home: [], away: [] }, activeAttempt: null };
earlyCup.match.state.finished = false; earlyCup.match.state.halfTime = false; earlyCup.match.state.phase = 'penalty-shootout'; earlyCup.match.clock.period = 5; earlyCup.match.state.period = 5;
const earlyResult = TF.engine.stepMatch(earlyCup, 1);
assert.equal(earlyResult.status, 'completed', 'three-goal lead after three kicks cannot be overturned');
assert.equal(TF.engine.getResult(earlyCup).winnerId, teams[0].id);
assert.equal(earlyCup.match.events.filter(e => e.type === 'penalty-attempt').length, 0, 'mathematically decided shootout must not take another kick');

const sudden = TF.engine.createMatch(config(teams, { matchId: 'sudden-death', seed: 43, halfSeconds: 0.1, knockout: true }));
sudden.match.state.knockoutState = { phase: 'penalties', scores: { home: 4, away: 4 }, attempts: { home: 5, away: 5 }, history: [], eligible: { home: sudden.match.teams[0].activePlayers.map(p => p.id), away: sudden.match.teams[1].activePlayers.map(p => p.id) }, reduced: { home: [], away: [] }, activeAttempt: null };
sudden.match.state.finished = false; sudden.match.state.halfTime = false; sudden.match.state.phase = 'penalty-shootout'; sudden.match.clock.period = 5; sudden.match.state.period = 5;
const suddenStart = TF.engine.stepMatch(sudden, 1);
assert.equal(suddenStart.status, 'running', 'level scores after five each must continue into sudden death');
assert.equal(sudden.match.events.filter(e => e.type === 'penalty-attempt').length, 1);
const cancelledPenalty = TF.engine.createMatch(config(teams, { matchId: 'cancelled-shootout', seed: 44, halfSeconds: 0.1, knockout: true }));
cancelledPenalty.match.state.knockoutState = { phase: 'penalties', scores: { home: 0, away: 0 }, attempts: { home: 0, away: 0 }, history: [], eligible: { home: cancelledPenalty.match.teams[0].activePlayers.map(p => p.id), away: cancelledPenalty.match.teams[1].activePlayers.map(p => p.id) }, reduced: { home: [], away: [] }, activeAttempt: null };
cancelledPenalty.match.state.finished = false; cancelledPenalty.match.clock.period = 5;
TF.engine.cancelRun(cancelledPenalty);
const cancelledPenaltyTick = cancelledPenalty.match.tick;
assert.equal(TF.engine.stepMatch(cancelledPenalty, 120).ticks, 0, 'cancelled shootouts must stop before the next physical tick');
assert.equal(cancelledPenalty.match.tick, cancelledPenaltyTick);

const cancelled = TF.engine.createMatch(config(teams, { matchId: 'cancelled', seed: 91, halfSeconds: 10 }));
const controller = new AbortController();
const finishing = TF.engine.finishSimulation(cancelled, { signal: controller.signal, chunkTicks: 30, onProgress() { controller.abort(); } });
const fastFinish = TF.engine.createMatch(config(teams, { matchId: 'fast-finish', seed: 92, halfSeconds: 0.05 }));
fastFinish.core.pause();
const finishingPaused = TF.engine.finishSimulation(fastFinish, { chunkTicks: 12 });
Promise.all([finishing, finishingPaused]).then(([cancelledResult, fastResult]) => {
  assert.equal(cancelledResult.status, 'cancelled');
  assert.equal(TF.engine.getResult(cancelled).complete, false, 'cancelled runs are not complete results');
  assert.equal(fastResult.status, 'completed', 'fast finish must resume a paused handle and continue past half-time');
  console.log('engine-facade: team mapping, cosmetic invariance, fixed ticks, watch parity, checkpoint restore, ET/penalties, half-time, fast finish and cancellation passed');
}).catch(error => { console.error(error); process.exitCode = 1; });
