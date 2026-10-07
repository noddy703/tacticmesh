const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');
require('../src/physics.js');
require('../src/rules.js');
require('../src/telemetry.js');
const TF = globalThis.TF;

function fixture(id) {
  const match = TF.createMatch({ seed: 81200, halfSeconds: 90, matchId: id });
  match.state.phase = 'open-play';
  match.players.forEach((p, i) => { p.position = { x: p.teamId === 'home' ? 30 + (i % 5) : 75 + (i % 5), y: 5 + (i * 7) % 58, z: 0 }; });
  return match;
}
function event(match, data) {
  match.tick = data.tick;
  TF.appendEvent(match, Object.assign({ time: match.clock.elapsedSeconds }, data));
  TF.updateTelemetry(match, TF.FIXED_DT);
}

// reset() rebuilds telemetry for a fresh lab session, including legacy
// counters that world/physics still update directly.
const resetSession = fixture('telemetry-reset-legacy-fields');
resetSession.telemetry.passes = 8;
resetSession.telemetry.shots = 3;
resetSession.telemetry.turnovers = 2;
TF.telemetry.reset(resetSession);
assert.deepEqual(resetSession.telemetry.goals, [], 'reset initializes the goal-event list');
assert.equal(resetSession.telemetry.passes, 0);
assert.equal(resetSession.telemetry.shots, 0);
assert.equal(resetSession.telemetry.turnovers, 0);
const resetGoal = resetSession.scoreGoal('home', 'home-p09');
assert.ok(resetGoal);
TF.updateTelemetry(resetSession, TF.FIXED_DT);
assert.equal(resetSession.telemetry.goals.length, 1, 'a goal after reset records successfully');
assert.equal(resetSession.telemetry.teams.home.goals, 1, 'goal event after reset reaches team telemetry');
assert.equal(resetSession.score.home, 1);

// A launch event records origin at kick time, even if the player later moves.
const frozen = fixture('pass-origin-frozen');
const passer = frozen.playersById['home-p09'], receiver = frozen.playersById['home-p10'];
event(frozen, { type: 'pass', tick: 1, teamId: 'home', playerId: passer.id, targetId: receiver.id, origin: { x: 30, y: 34 }, target: { x: 42, y: 34 } });
passer.position.x = 82;
assert.equal(frozen.telemetry.teams.home.counters.progressivePass, 0, 'an intended forward target is not completed progression');

// Self-recovery ends a pending pass but never counts as a completed teammate pass.
frozen.ball.ownerId = passer.id;
event(frozen, { type: 'ball-control', tick: 2, teamId: 'home', playerId: passer.id, origin: { x: 42, y: 34 } });
assert.equal(frozen.telemetry.teams.home.completedPasses, 0);
assert.equal(frozen.telemetry._quality.pendingPasses.length, 0);

// A distinct teammate controlling the next launch completes exactly one pass.
event(frozen, { type: 'pass', tick: 3, teamId: 'home', playerId: passer.id, targetId: receiver.id, origin: { x: 35, y: 34 }, target: { x: 46, y: 34 } });
frozen.ball.ownerId = receiver.id;
event(frozen, { type: 'ball-control', tick: 4, teamId: 'home', playerId: receiver.id, origin: { x: 50, y: 34 } });
assert.equal(frozen.telemetry.teams.home.completedPasses, 1);
assert.equal(frozen.telemetry.teams.home.counters.progressivePass, 1, 'progression uses the frozen point where a teammate receives the ball');
assert.equal(frozen.telemetry._quality.possessionChains.home.passes, 1);

// A receiver who plays the ball in one touch emits ball-played before the
// next pass event, so that contact must complete the incoming pass first.
event(frozen, { type: 'pass', tick: 5, teamId: 'home', playerId: receiver.id, targetId: passer.id, origin: { x: 46, y: 34 }, target: { x: 35, y: 34 } });
event(frozen, { type: 'ball-played', tick: 6, teamId: 'home', playerId: passer.id, kind: 'pass', origin: { x: 35, y: 34 } });
assert.equal(frozen.telemetry.teams.home.completedPasses, 2, 'a teammate one-touch completes the incoming pass');
assert.equal(frozen.telemetry._quality.possessionChains.home.passes, 2);
event(frozen, { type: 'pass', tick: 6, teamId: 'home', playerId: passer.id, targetId: receiver.id, origin: { x: 35, y: 34 }, target: { x: 46, y: 34 } });

event(frozen, { type: 'turnover', tick: 7, teamId: 'away' });
assert.equal(frozen.telemetry._quality.pendingPasses.length, 0);
assert.equal(frozen.telemetry._quality.possessionChains.home, undefined, 'explicit turnover resets the old side chain');
event(frozen, { type: 'pass', tick: 8, teamId: 'home', playerId: receiver.id, targetId: passer.id, origin: { x: 46, y: 34 }, target: { x: 35, y: 34 } });
event(frozen, { type: 'ball-control', tick: 9, teamId: 'home', playerId: passer.id, origin: { x: 35, y: 34 } });
assert.equal(frozen.telemetry.teams.home.completedPasses, 3);
assert.equal(frozen.telemetry._quality.possessionChains.home.passes, 1);

// A restart terminates the in-flight pass and the old possession chain.
event(frozen, { type: 'pass', tick: 10, teamId: 'home', playerId: passer.id, targetId: receiver.id, origin: { x: 35, y: 34 }, target: { x: 46, y: 34 } });
event(frozen, { type: 'restart-awarded', tick: 11, teamId: 'away', restartType: 'throw-in' });
frozen.ball.ownerId = receiver.id;
event(frozen, { type: 'ball-control', tick: 12, teamId: 'home', playerId: receiver.id, origin: { x: 46, y: 34 } });
assert.equal(frozen.telemetry.teams.home.completedPasses, 3, 'post-restart control cannot complete the pre-restart pass');
assert.equal(frozen.telemetry._quality.pendingPasses.length, 0);
assert.equal(frozen.telemetry._quality.possessionChains.home, undefined);

event(frozen, { type: 'pass', tick: 13, teamId: 'home', playerId: receiver.id, targetId: passer.id, origin: { x: 46, y: 34 }, target: { x: 35, y: 34 } });
event(frozen, { type: 'foul', tick: 14, teamId: 'away', playerId: frozen.playersById['away-p09'].id });
event(frozen, { type: 'ball-control', tick: 15, teamId: 'home', playerId: passer.id, origin: { x: 35, y: 34 } });
assert.equal(frozen.telemetry.teams.home.completedPasses, 3, 'post-foul control cannot complete the pre-foul pass');
assert.equal(frozen.telemetry._quality.pendingPasses.length, 0);

// A side change cancels pending passes and removes the former side's chain.
event(frozen, { type: 'pass', tick: 16, teamId: 'home', playerId: receiver.id, targetId: passer.id, origin: { x: 46, y: 34 }, target: { x: 35, y: 34 } });
event(frozen, { type: 'ball-control', tick: 17, teamId: 'home', playerId: passer.id, origin: { x: 35, y: 34 } });
assert.equal(frozen.telemetry.teams.home.completedPasses, 4);
assert.equal(frozen.telemetry._quality.possessionChains.home.passes, 1);
event(frozen, { type: 'pass', tick: 18, teamId: 'home', playerId: passer.id, targetId: receiver.id, origin: { x: 35, y: 34 }, target: { x: 46, y: 34 } });
frozen.ball.ownerId = frozen.playersById['away-p09'].id;
event(frozen, { type: 'ball-control', tick: 19, teamId: 'away', playerId: frozen.ball.ownerId, origin: { x: 75, y: 34 } });
assert.equal(frozen.telemetry.teams.home.completedPasses, 4, 'opponent control is an interception/turnover, not a pass completion');
assert.equal(frozen.telemetry._quality.pendingPasses.length, 0);
assert.equal(frozen.telemetry._quality.possessionChains.home, undefined, 'turnover resets the previous possession chain');

event(frozen, { type: 'pass', tick: 20, teamId: 'home', playerId: passer.id, targetId: receiver.id, origin: { x: 35, y: 34 }, target: { x: 46, y: 34 } });
event(frozen, { type: 'ball-played', tick: 21, teamId: 'away', playerId: frozen.playersById['away-p09'].id, kind: 'pass', origin: { x: 75, y: 34 } });
assert.equal(frozen.telemetry.teams.home.completedPasses, 4, 'opponent touch cancels rather than completes the pending pass');
assert.equal(frozen.telemetry._quality.pendingPasses.length, 0);

// Real reception is not discarded just because a deflection delayed it past
// five seconds. Terminal contacts still resolve once, based on actual player
// and team identity rather than elapsed time.
const lateReceipt = fixture('late-receipt');
const latePasser = lateReceipt.playersById['home-p09'], lateReceiver = lateReceipt.playersById['home-p10'];
event(lateReceipt, { type: 'pass', tick: 10, teamId: 'home', playerId: latePasser.id, targetId: lateReceiver.id, origin: { x: 34, y: 30 }, target: { x: 50, y: 30 } });
event(lateReceipt, { type: 'ball-control', tick: 400, teamId: 'home', playerId: lateReceiver.id, origin: { x: 46, y: 30 } });
assert.equal(lateReceipt.telemetry.teams.home.completedPasses, 1, 'a teammate receipt after 300 ticks completes from actual control');
assert.equal(lateReceipt.telemetry.teams.home.counters.progressivePass, 1, 'late progression uses the frozen receive location');
assert.equal(lateReceipt.telemetry._quality.pendingPasses.length, 0);

const lateOneTouch = fixture('late-one-touch');
const touchPasser = lateOneTouch.playersById['home-p09'], touchReceiver = lateOneTouch.playersById['home-p10'];
event(lateOneTouch, { type: 'pass', tick: 10, teamId: 'home', playerId: touchPasser.id, targetId: touchReceiver.id, origin: { x: 34, y: 30 }, target: { x: 50, y: 30 } });
event(lateOneTouch, { type: 'ball-played', tick: 400, teamId: 'home', playerId: touchReceiver.id, kind: 'shot', origin: { x: 46, y: 30 } });
assert.equal(lateOneTouch.telemetry.teams.home.completedPasses, 1, 'a delayed same-team one-touch contact resolves the incoming pass');

const lateOpponent = fixture('late-opponent-control');
const opponentPasser = lateOpponent.playersById['home-p09'], lateDefender = lateOpponent.playersById['away-p09'];
event(lateOpponent, { type: 'pass', tick: 10, teamId: 'home', playerId: opponentPasser.id, origin: { x: 34, y: 30 }, target: { x: 50, y: 30 } });
event(lateOpponent, { type: 'ball-control', tick: 400, teamId: 'away', playerId: lateDefender.id, origin: { x: 60, y: 30 } });
assert.equal(lateOpponent.telemetry.teams.home.completedPasses, 0, 'a delayed opponent control remains a failed pass');
assert.equal(lateOpponent.telemetry._quality.pendingPasses.length, 0, 'opponent control consumes the delayed attempt');

const directShot = fixture('direct-shot-cancels-pass');
const shotPasser = directShot.playersById['home-p09'], laterReceiver = directShot.playersById['home-p10'];
event(directShot, { type: 'pass', tick: 10, teamId: 'home', playerId: shotPasser.id, origin: { x: 34, y: 30 }, target: { x: 50, y: 30 } });
event(directShot, { type: 'shot', tick: 11, teamId: 'home', playerId: shotPasser.id, target: { x: 100, y: 30 } });
event(directShot, { type: 'ball-control', tick: 12, teamId: 'home', playerId: laterReceiver.id, origin: { x: 70, y: 30 } });
assert.equal(directShot.telemetry.teams.home.completedPasses, 0, 'a later unrelated teammate control cannot resolve a direct shot attempt');
assert.equal(directShot.telemetry._quality.pendingPasses.length, 0);

// Independent event-ledger reconciliation on a compact stream: this reference
// parser has no telemetry state and no time expiry, so counts must match only
// after actual contacts and explicit terminal events have been processed.
const reconciled = fixture('event-ledger-reconciliation');
const ledger = [], ledgerPasser = reconciled.playersById['home-p09'], ledgerMate = reconciled.playersById['home-p10'], ledgerOpp = reconciled.playersById['away-p09'];
function ledgerEvent(data) { ledger.push(data); event(reconciled, data); }
ledgerEvent({ type: 'pass', tick: 1, teamId: 'home', playerId: ledgerPasser.id, origin: { x: 30, y: 30 } });
ledgerEvent({ type: 'ball-control', tick: 400, teamId: 'home', playerId: ledgerMate.id, origin: { x: 39, y: 30 } });
ledgerEvent({ type: 'pass', tick: 401, teamId: 'home', playerId: ledgerMate.id, origin: { x: 39, y: 30 } });
ledgerEvent({ type: 'ball-played', tick: 800, teamId: 'home', playerId: ledgerPasser.id, kind: 'pass', origin: { x: 42, y: 30 } });
ledgerEvent({ type: 'pass', tick: 801, teamId: 'home', playerId: ledgerPasser.id, origin: { x: 42, y: 30 } });
ledgerEvent({ type: 'ball-control', tick: 1200, teamId: 'away', playerId: ledgerOpp.id, origin: { x: 60, y: 30 } });
ledgerEvent({ type: 'pass', tick: 1201, teamId: 'home', playerId: ledgerPasser.id, origin: { x: 42, y: 30 } });
ledgerEvent({ type: 'foul', tick: 1202, teamId: 'away', playerId: ledgerOpp.id });
ledgerEvent({ type: 'ball-control', tick: 1203, teamId: 'home', playerId: ledgerMate.id, origin: { x: 45, y: 30 } });
ledgerEvent({ type: 'pass', tick: 1204, teamId: 'home', playerId: ledgerMate.id, origin: { x: 45, y: 30 } });
ledgerEvent({ type: 'shot', tick: 1205, teamId: 'home', playerId: ledgerMate.id, target: { x: 100, y: 30 } });
ledgerEvent({ type: 'ball-control', tick: 1206, teamId: 'home', playerId: ledgerPasser.id, origin: { x: 70, y: 30 } });
let ledgerPending = null, ledgerCompleted = 0;
for (const item of ledger) {
  if (item.type === 'pass') ledgerPending = item;
  else if (item.type === 'ball-control' || item.type === 'ball-played') {
    if (ledgerPending && item.teamId === ledgerPending.teamId && item.playerId !== ledgerPending.playerId) ledgerCompleted++;
    ledgerPending = null;
  } else if (['restart-awarded', 'offside', 'goal', 'turnover', 'interception', 'foul', 'advantage', 'shot'].includes(item.type)) ledgerPending = null;
}
assert.equal(ledgerCompleted, 2, 'independent fixture parser observes two actual teammate receipts');
assert.equal(reconciled.telemetry.teams.home.completedPasses, ledgerCompleted, 'event-derived receipt total reconciles to telemetry across delayed completion and cancellations');

// Summary possession denominators describe completed possessions, matching
// the completion-only duration and chain histograms.
const possessionCounts = fixture('completed-possession-counts');
const homeOwner = possessionCounts.playersById['home-p09'], awayOwner = possessionCounts.playersById['away-p09'];
possessionCounts.ball.ownerId = homeOwner.id;
possessionCounts.tick = 1;
TF.updateTelemetry(possessionCounts, TF.FIXED_DT);
possessionCounts.ball.ownerId = awayOwner.id;
possessionCounts.tick = 2;
TF.updateTelemetry(possessionCounts, TF.FIXED_DT);
const homeHistogramTotal = Object.values(possessionCounts.telemetry.teams.home.passChainHistogram).reduce((sum, count) => sum + count, 0);
assert.equal(possessionCounts.telemetry.teams.home.counters.possessionCount, 1);
assert.equal(homeHistogramTotal, 1, 'completed possession count and pass-chain histogram share the same denominator');

process.stdout.write('telemetry pass lifecycle checks passed (frozen origin, teammate control/one-touch completion, self-recovery, restart/foul/turnover/interception cancellation)\n');
