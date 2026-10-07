const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/physics.js');
require('../src/rules.js');

function match(seed) { return TF.createMatch({ seed, halfSeconds: 10 }); }

// Motor movement accelerates toward a target and a committed shot creates a ball impulse.
const physical = match(7), mover = physical.teams[0].activePlayers[5];
mover.position.x = 40; mover.position.y = 34; mover.facing = { x: 1, y: 0 };
mover.motor = { type: 'move', target: { x: 50, y: 34 }, desiredSpeed: 1 };
const startX = mover.position.x;
TF.updatePhysics(physical, TF.FIXED_DT);
assert.ok(mover.position.x > startX && mover.velocity.x > 0);
mover.position.x = 50; mover.position.y = 34; mover.motor = { action: 'shoot', target: { x: 105, y: 34 }, ballTarget: { x: 105, y: 34 }, power: 0.8, createdTick: 2, expiresTick: 4 };
physical.ball.position = { x: 50, y: 34, z: 0.11 }; physical.ball.ownerId = mover.id; physical.tick = 2;
TF.updatePhysics(physical, TF.FIXED_DT);
assert.equal(physical.ball.ownerId, null);
assert.ok(physical.ball.velocity.x > 0);
assert.ok(physical.events.some(e => e.type === 'shot'));

// Kickoff becomes live only after the rules system owns the restart.
const kickoff = match(8);
TF.rulesLab.configure(kickoff, { autoRestartSeconds: 0, addedTimeSeconds: 0 });
TF.updateRules(kickoff, TF.FIXED_DT);
assert.equal(kickoff.state.phase, 'open-play');
assert.ok(kickoff.ball.ownerId);
const openingKickerTeam = kickoff.state.rules.firstKickoffTeamId;
kickoff.state.halfTime = true; kickoff.state.phase = 'half-time';
assert.equal(kickoff.startSecondHalf(), true);
TF.updateRules(kickoff, TF.FIXED_DT);
assert.equal(kickoff.state.restartTeamId, kickoff.teams.find(t => t.id !== openingKickerTeam).id);

// Swept goal-line crossings score for the team attacking that end in either half.
for (const x of [105.2, -0.2]) {
  const m = match(x > 0 ? 11 : 12);
  m.state.phase = 'open-play';
  m.ball.previousPosition = { x: x > 0 ? 104.8 : 0.2, y: 34, z: 0.11 };
  m.ball.position = { x, y: 34, z: 0.11 };
  const scorerTeam = m.teams.find(t => t.attackDirection === (x > 0 ? 1 : -1));
  m.ball.lastTouchTeamId = scorerTeam.id;
  m.ball.lastTouchPlayerId = scorerTeam.activePlayers[9].id;
  TF.rulesLab.inspectBoundaries(m);
  assert.equal(scorerTeam.score, 1);
  assert.equal(m.events.filter(e => e.type === 'goal').length, 1);
}

function directGoalFixture(seed, endX, kickerTeamIndex, restartType) {
  const m = match(seed), kickerTeam = m.teams[kickerTeamIndex], p = kickerTeam.activePlayers[5];
  m.state.phase = 'open-play'; m.tick = 20;
  m.ball.previousPosition = { x: endX > 0 ? 104.8 : 0.2, y: 34, z: 0.11 };
  m.ball.position = { x: endX, y: 34, z: 0.11 };
  m.ball.lastTouchPlayerId = p.id; m.ball.lastTouchTeamId = kickerTeam.id; m.ball.lastTouchTick = 20;
  m.ball.offsideKick = { kickerId: p.id, teamId: kickerTeam.id, tick: 20 };
  m.ball._lastRestartTouchType = restartType;
  TF.rulesLab.inspectBoundaries(m); return m;
}
const indirectDirectGoal = directGoalFixture(120, 105.2, 0, 'indirect-free-kick');
assert.equal(indirectDirectGoal.score.home, 0); assert.equal(indirectDirectGoal.state.restartType, 'goal-kick');
const throwDirectGoal = directGoalFixture(121, 105.2, 0, 'throw-in');
assert.equal(throwDirectGoal.score.home, 0); assert.equal(throwDirectGoal.state.restartType, 'goal-kick');
const freeDirectGoal = directGoalFixture(122, 105.2, 0, 'direct-free-kick');
assert.equal(freeDirectGoal.score.home, 1);
const ownRestartGoal = directGoalFixture(123, -0.2, 0, 'kickoff');
assert.equal(ownRestartGoal.score.away, 0); assert.equal(ownRestartGoal.state.restartType, 'corner');
const dropDirectGoal = directGoalFixture(124, 105.2, 0, 'dropped-ball');
assert.equal(dropDirectGoal.score.home, 0); assert.equal(dropDirectGoal.state.restartType, 'goal-kick');

const dropped = match(125); TF.rulesLab.configure(dropped, { autoRestartSeconds: 0 }); dropped.clock.elapsedSeconds = 1;
TF.rulesLab.awardRestart(dropped, 'dropped-ball', dropped.teams[0].id, { x: 40, y: 34 }); TF.updateRules(dropped, TF.FIXED_DT);
assert.equal(dropped.ball.ownerId, null); assert.equal(dropped.state.rules.dropBallActive, true);
const dropPlayers = dropped.teams[0].activePlayers;
dropped.tick = 1; dropped.ball.lastTouchPlayerId = dropPlayers[1].id; dropped.ball.lastTouchTeamId = dropped.teams[0].id; dropped.ball.lastTouchKind = 'control'; dropped.ball.lastTouchTick = 1;
TF.updateRules(dropped, TF.FIXED_DT); assert.equal(dropped.state.rules.dropBallActive, true);
dropped.tick = 2; dropped.ball.lastTouchPlayerId = dropPlayers[2].id; dropped.ball.lastTouchTeamId = dropped.teams[0].id; dropped.ball.lastTouchKind = 'control'; dropped.ball.lastTouchTick = 2;
TF.updateRules(dropped, TF.FIXED_DT); assert.equal(dropped.state.rules.dropBallActive, false);

// A defender's last touch gives the attackers a corner at the pitch corner, even wide of the posts.
const corner = match(13);
corner.state.phase = 'open-play';
corner.ball.previousPosition = { x: 104.8, y: 66, z: 0.11 };
corner.ball.position = { x: 105.2, y: 66, z: 0.11 };
corner.ball.lastTouchTeamId = corner.teams.find(t => t.attackDirection === -1).id;
TF.rulesLab.inspectBoundaries(corner);
assert.equal(corner.state.restartType, 'corner');
assert.deepEqual(corner.state.restartPoint, { x: 105, y: 68 });

// Offside is captured at the kick and penalized only when the candidate is involved.
const offside = match(14);
const kicker = offside.teams[0].activePlayers[5], receiver = offside.teams[0].activePlayers[9];
receiver.position.x = 95; receiver.position.y = 34; offside.ball.position.x = 70;
offside.teams[1].activePlayers[1].position.x = 82; offside.teams[1].activePlayers[2].position.x = 80;
const snap = TF.rulesLab.positionAtPlay(offside, kicker, 'pass');
assert.equal(TF.rulesLab.checkOffsideInvolvement(offside, receiver), true);
offside.ball.lastTouchPlayerId = receiver.id; offside.ball.lastTouchTeamId = receiver.teamId;
offside.ball.lastTouchKind = 'control'; offside.ball.lastTouchTick = 4; offside.tick = 4;
offside.state.phase = 'open-play'; offside.state._offsideCheckedTouchTick = -1;
TF.updateRules(offside, TF.FIXED_DT);
assert.equal(offside.state.restartType, 'indirect-free-kick');
assert.ok(offside.events.some(e => e.type === 'offside'));

// Direct goal-kick/throw-in/corner reception uses the restart offside exemption.
offside.state.phase = 'open-play';
offside.ball._offsideExemptNextTouch = true;
TF.rulesLab.positionAtPlay(offside, kicker, 'pass');
assert.equal(offside.ball.offsideKick.exempt, true);
assert.equal(TF.rulesLab.checkOffsideInvolvement(offside, receiver), false);

// Advantage that produces retained possession is played; any card waits for a later stoppage.
const adv = match(15), home = adv.teams[0], offender = adv.teams[1].activePlayers[5], victim = home.activePlayers[5];
adv.state.phase = 'open-play'; adv.state.possessionTeamId = home.id;
victim.position.x = adv.ball.position.x = 50; victim.position.y = adv.ball.position.y = 30;
adv.ball.ownerId = victim.id; adv.clock.elapsedSeconds = 1;
TF.rulesLab.awardFoul(adv, { offenderId: offender.id, victimId: victim.id, point: { x: 50, y: 30 }, severity: 0.62, reckless: true });
assert.ok(adv.state.advantage);
adv.ball.ownerId = victim.id; adv.ball.position.x = 54; adv.clock.elapsedSeconds = 1.5;
TF.updateRules(adv, TF.FIXED_DT);
assert.equal(adv.state.advantage, null);
assert.ok(adv.events.some(e => e.type === 'advantage-played'));
assert.ok(!adv.events.some(e => e.type === 'advantage-recalled'));
assert.ok(adv.state.advantageCardPending);
TF.rulesLab.awardRestart(adv, 'throw-in', home.id, { x: 51, y: 0 });
assert.equal(offender.cards.yellow, 1);

// A direct deliberate teammate pass caught by the goalkeeper is an indirect free kick.
const backpass = match(16), keeper = backpass.teams[0].activePlayers[0], passer = backpass.teams[0].activePlayers[2];
backpass.ball.ownerId = keeper.id; backpass.ball.handControl = true; backpass.ball._handStarted = 1;
backpass.ball._keeperSourceTouchPlayerId = passer.id; backpass.ball._keeperSourceTouchKind = 'deliberate'; backpass.ball._keeperHandlingPlayerId = keeper.id;
backpass.ball._keeperHandlingRestriction = { teamId: keeper.teamId, keeperId: keeper.id, sourcePlayerId: passer.id, action: 'pass', targetId: keeper.id };
backpass.clock.elapsedSeconds = 2; TF.updateRules(backpass, TF.FIXED_DT);
assert.equal(backpass.state.restartType, 'indirect-free-kick');

// Keeper possession is limited to eight seconds and results in a corner under 2026/27 Law 12.
const eight = match(17), gk = eight.teams[0].activePlayers[0];
eight.ball.ownerId = gk.id; eight.ball.handControl = true; eight.ball._handStarted = 1;
eight.clock.elapsedSeconds = 10; TF.updateRules(eight, TF.FIXED_DT);
assert.equal(eight.state.restartType, 'corner');

// A serious foul in the defending penalty area awards a penalty and sends the player off.
const cardMatch = match(171), defender = cardMatch.teams[1].activePlayers[3], attacker = cardMatch.teams[0].activePlayers[9];
TF.rulesLab.awardFoul(cardMatch, { offenderId: defender.id, victimId: attacker.id, point: { x: 95, y: 34 }, severity: 0.9, seriousFoulPlay: true });
assert.equal(cardMatch.state.restartType, 'penalty');
assert.equal(defender.cards.red, 1);
assert.equal(defender.active, false);

// Restart placements keep kick-off teams in their own halves and opponents back.
const kickoffSetup = match(173); TF.rulesLab.configure(kickoffSetup, { autoRestartSeconds: 0 });
TF.updateRules(kickoffSetup, TF.FIXED_DT);
const center = { x: 52.5, y: 34 }, kickTeam = kickoffSetup.teams.find(t => t.id === kickoffSetup.state.possessionTeamId);
for (const p of kickoffSetup.players.filter(p => p.active && p.teamId !== kickoffSetup.ball.ownerId)) {
  const own = kickoffSetup.teams.find(t => t.id === p.teamId);
  if (p.teamId === kickTeam.id) assert.ok(own.attackDirection > 0 ? p.position.x <= 52.5 : p.position.x >= 52.5);
  else { assert.ok(Math.hypot(p.position.x - center.x, p.position.y - center.y) >= 9.15); assert.ok(own.attackDirection > 0 ? p.position.x <= 52.5 : p.position.x >= 52.5); }
}

// A penalty puts the goalkeeper on the line and every other non-kicker outside the arc/area.
const penaltySetup = match(174), attackingTeam = penaltySetup.teams[0], fouled = penaltySetup.teams[1].activePlayers[4];
TF.rulesLab.configure(penaltySetup, { autoRestartSeconds: 0 });
penaltySetup.clock.elapsedSeconds = 2;
TF.rulesLab.awardRestart(penaltySetup, 'penalty', attackingTeam.id, { x: 95, y: 34 });
TF.updateRules(penaltySetup, TF.FIXED_DT);
const penaltyMark = { x: 94, y: 34 }, keeperOnLine = penaltySetup.teams[1].activePlayers.find(p => p.isGoalkeeper);
assert.ok(Math.abs(keeperOnLine.position.x - 104.97) < 0.04 && Math.abs(keeperOnLine.position.y - 34) < 0.01);
const penaltyTaker = penaltySetup.ball.ownerId;
for (const p of penaltySetup.players.filter(p => p.active && p.id !== penaltyTaker && !p.isGoalkeeper)) {
  assert.ok(Math.hypot(p.position.x - penaltyMark.x, p.position.y - penaltyMark.y) >= 9.15);
  assert.ok(p.position.x < 88.5);
}

// Defenders form a legal free-kick wall, and throw-in opponents respect two metres.
const freeSetup = match(175), freeTeam = freeSetup.teams[0]; TF.rulesLab.configure(freeSetup, { autoRestartSeconds: 0 });
freeSetup.clock.elapsedSeconds = 2; TF.rulesLab.awardRestart(freeSetup, 'direct-free-kick', freeTeam.id, { x: 70, y: 34 }); TF.updateRules(freeSetup, TF.FIXED_DT);
for (const p of freeSetup.teams[1].activePlayers.filter(p => p.active)) assert.ok(Math.hypot(p.position.x - 70, p.position.y - 34) >= 9.15);
const throwSetup = match(176); TF.rulesLab.configure(throwSetup, { autoRestartSeconds: 0 });
throwSetup.clock.elapsedSeconds = 2; TF.rulesLab.awardRestart(throwSetup, 'throw-in', throwSetup.teams[0].id, { x: 54, y: 68 }); TF.updateRules(throwSetup, TF.FIXED_DT);
for (const p of throwSetup.teams[1].activePlayers.filter(p => p.active)) assert.ok(Math.hypot(p.position.x - 54, p.position.y - 68) >= 2);

// Competition settings cap substitutions and count a shared stoppage as one window.
const subMatch = match(172), subTeam = subMatch.teams[0], outgoing = subTeam.activePlayers[10], incoming = subTeam.bench[0];
subMatch.state.phase = 'dead-ball'; subMatch.state.restartType = 'direct-free-kick'; subMatch.state.restartTeamId = subTeam.id; subMatch.state.restartStarted = 0;
subMatch.clock.elapsedSeconds = 1;
TF.rulesLab.configure(subMatch, { autoRestartSeconds: 90, substitutes: 1, substitutionWindows: 1 });
subMatch.substitutionRequests = [{ teamId: subTeam.id, playerId: outgoing.id, substituteId: incoming.id }];
TF.updateRules(subMatch, TF.FIXED_DT);
assert.equal(outgoing.active, false); assert.equal(incoming.active, true);
assert.equal(subTeam.substitutionState.used, 1); assert.equal(subTeam.substitutionState.windows, 1);

// Half-time substitutions do not consume a field-side substitution window.
const halftimeSub = match(177), halfTeam = halftimeSub.teams[0], halfOut = halfTeam.activePlayers[9], halfIn = halfTeam.bench[0];
halftimeSub.state.halfTime = true; halftimeSub.state.phase = 'half-time';
TF.rulesLab.configure(halftimeSub, { substitutes: 5, substitutionWindows: 0 });
halftimeSub.substitutionRequests = [{ teamId: halfTeam.id, playerId: halfOut.id, substituteId: halfIn.id }];
TF.updateRules(halftimeSub, TF.FIXED_DT);
assert.equal(halfOut.active, false); assert.equal(halfIn.active, true); assert.equal(halfTeam.substitutionState.windows, 0);

// If the outgoing player misses the ten-second exit limit, the substitute waits a minute and a further stoppage.
const delayedSub = match(178), delayTeam = delayedSub.teams[0], delayOut = delayTeam.activePlayers[8], delayIn = delayTeam.bench[0];
delayedSub.state.phase = 'dead-ball'; delayedSub.state.restartType = 'direct-free-kick'; delayedSub.state.restartTeamId = delayTeam.id; delayedSub.state.restartStarted = 1; delayedSub.clock.elapsedSeconds = 2;
TF.rulesLab.configure(delayedSub, { autoRestartSeconds: 90 });
delayedSub.substitutionRequests = [{ teamId: delayTeam.id, playerId: delayOut.id, substituteId: delayIn.id, exitSeconds: 12 }];
TF.updateRules(delayedSub, TF.FIXED_DT);
assert.equal(delayOut.active, false); assert.equal(delayIn.active, false);
delayedSub.clock.elapsedSeconds = 63; TF.rulesLab.awardRestart(delayedSub, 'direct-free-kick', delayTeam.id, { x: 40, y: 34 });
TF.updateRules(delayedSub, TF.FIXED_DT);
assert.equal(delayIn.active, true);

// Added time is surfaced through the shared clock limit; the world dispatcher owns transitions.
const clock = match(18); TF.rulesLab.configure(clock, { addedTimeSeconds: 25 }); TF.updateRules(clock, TF.FIXED_DT);
assert.equal(clock.clock.periodLimitSeconds, 35);

// Checkpoint extensions preserve hidden control and rule state.
const saved = match(19); saved.ball._touchCooldown = 0.25; saved.ball.offsideKick = snap;
saved.state.advantage = { teamId: saved.teams[0].id, started: 1 };
saved.teams[0].substitutionState = { used: 2, windows: 1, usedThisStoppage: true };
saved.players[0].cards = { yellow: 1, red: 0 };
const checkpoint = TF.captureCheckpoint(saved);
const restored = match(19); TF.restoreCheckpoint(restored, checkpoint);
assert.equal(restored.ball._touchCooldown, 0.25);
assert.deepEqual(restored.ball.offsideKick, snap);
assert.deepEqual(restored.state.advantage, saved.state.advantage);
assert.deepEqual(restored.teams[0].substitutionState, saved.teams[0].substitutionState);
assert.deepEqual(restored.players[0].cards, saved.players[0].cards);

console.log('physics/rules smoke scenarios passed');
