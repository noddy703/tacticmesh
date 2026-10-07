const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/physics.js');
require('../src/rules.js');
const TF = globalThis.TF;

function fresh(seed, options = {}) {
  const m = TF.createMatch(Object.assign({ seed, halfSeconds: 120 }, options));
  TF.rulesLab.configure(m, { autoRestartSeconds: 0, addedTimeSeconds: 0 });
  return m;
}
function open(m) { m.state.phase = 'open-play'; m.state.halfTime = false; }

// Involvement triggers offside, while a deliberate defender play resets the phase.
const os = fresh(7101), atk = os.teams[0], def = os.teams[1];
const attacker = atk.activePlayers[8], defender = def.activePlayers[4];
open(os); os.tick = 10;
attacker.position.x = 95; attacker.position.y = 34;
defender.position.x = 85; defender.position.y = 34;
os.ball.position.x = 70; os.ball.position.y = 34;
os.ball.offsideKick = { teamId: atk.id, kickerId: atk.activePlayers[5].id, tick: 9, line: 85,
  candidates: [{ playerId: attacker.id, offside: true }] };
os.ball.lastTouchPlayerId = defender.id; os.ball.lastTouchTeamId = def.id;
os.ball.lastTouchKind = 'deliberate'; os.ball.lastTouchTick = 10;
os.state._offsideCheckedTouchTick = -1;
TF.updateRules(os, TF.FIXED_DT);
assert.equal(os.ball.offsideKick, null, 'deliberate defender control resets the offside phase');

// A save/deflection does not reset offside; an offside attacker challenging within the threshold is penalized.
const challenge = fresh(7102), ca = challenge.teams[0], cd = challenge.teams[1];
const offsidePlayer = ca.activePlayers[8], opponentPlayer = cd.activePlayers[4];
open(challenge); challenge.tick = 12;
offsidePlayer.position.x = 91; offsidePlayer.position.y = 34;
opponentPlayer.position.x = 90; opponentPlayer.position.y = 34;
challenge.ball.position.x = 92; challenge.ball.position.y = 34;
challenge.ball.offsideKick = { teamId: ca.id, kickerId: ca.activePlayers[5].id, tick: 11, line: 84,
  candidates: [{ playerId: offsidePlayer.id, offside: true }] };
challenge.ball.lastTouchTeamId = ca.id; challenge.ball.lastTouchKind = 'play';
challenge.state._offsideCheckedTouchTick = -1;
TF.updateRules(challenge, TF.FIXED_DT);
assert.equal(challenge.state.restartType, 'indirect-free-kick');
assert.ok(challenge.events.some(e => e.type === 'offside' && e.involvement === 'challenge'));

// Direct and indirect free kicks award different restarts when put directly into either goal.
function directRestart(seed, type, ownGoal) {
  const m = fresh(seed), takerTeam = m.teams[0], taker = takerTeam.activePlayers[5];
  const endX = ownGoal ? -0.2 : 105.2;
  m.state.phase = 'open-play'; m.tick = 20;
  m.ball.previousPosition = { x: ownGoal ? 0.2 : 104.8, y: 34, z: 0.11 };
  m.ball.position = { x: endX, y: 34, z: 0.11 };
  m.ball.lastTouchPlayerId = taker.id; m.ball.lastTouchTeamId = takerTeam.id; m.ball.lastTouchTick = 20;
  m.ball.offsideKick = { kickerId: taker.id, teamId: takerTeam.id, tick: 20 };
  m.ball._lastRestartTouchType = type;
  TF.rulesLab.inspectBoundaries(m); return m;
}
const ifkOpponentGoal = directRestart(7103, 'indirect-free-kick', false);
assert.equal(ifkOpponentGoal.score.home, 0);
assert.equal(ifkOpponentGoal.state.restartType, 'goal-kick');
const ifkOwnGoal = directRestart(7104, 'indirect-free-kick', true);
assert.equal(ifkOwnGoal.state.restartType, 'corner');
const dfkOpponentGoal = directRestart(7105, 'direct-free-kick', false);
assert.equal(dfkOpponentGoal.score.home, 1);

const nearGoalFreeKick = fresh(71051), defendingHome = nearGoalFreeKick.teams[0], attackingAway = nearGoalFreeKick.teams[1];
TF.rulesLab.configure(nearGoalFreeKick, { autoRestartSeconds: 0 }); open(nearGoalFreeKick);
const nearGoalKeeper = defendingHome.activePlayers.find(p => p.isGoalkeeper);
nearGoalKeeper.position = { x: 0.02, y: 27, z: 0 }; nearGoalKeeper.previousPosition = { ...nearGoalKeeper.position };
TF.rulesLab.awardRestart(nearGoalFreeKick, 'direct-free-kick', attackingAway.id, { x: 3, y: 34 }, 'near-own-goal-test');
TF.updateRules(nearGoalFreeKick, TF.FIXED_DT);
assert.ok(nearGoalKeeper.position.x < 0.1, 'the defending keeper may remain on their actual own goal line');
assert.ok(Math.abs(nearGoalKeeper.position.y - nearGoalFreeKick.pitch.width / 2) <= nearGoalFreeKick.pitch.goalWidth / 2,
  'a keeper moved onto the goal line must be between the posts');

// The keeper may not re-handle a deliberate self-release before any other player touches it.
const secondHandle = fresh(7110), ownKeeper = secondHandle.teams[0].activePlayers.find(p => p.isGoalkeeper);
TF.rulesLab.configure(secondHandle, { autoRestartSeconds: 90 });
open(secondHandle); secondHandle.ball.ownerId = ownKeeper.id; secondHandle.ball.handControl = true;
secondHandle.ball._keeperSourceTouchPlayerId = ownKeeper.id;
secondHandle.ball._keeperSourceTouchKind = 'deliberate';
secondHandle.ball._keeperHandlingRestriction = { teamId: ownKeeper.teamId, keeperId: ownKeeper.id, sourcePlayerId: ownKeeper.id, action: 'pass', targetId: null };
secondHandle.ball._keeperHandlingPlayerId = ownKeeper.id;
secondHandle.ball._handStarted = secondHandle.clock.elapsedSeconds;
TF.updateRules(secondHandle, TF.FIXED_DT);
assert.equal(secondHandle.state.restartType, 'indirect-free-kick');
assert.ok(secondHandle.events.some(e => e.type === 'goalkeeper-second-handling'));

// A failed advantage returns to the foul location and administers its deferred caution.
const advantage = fresh(7106), victimTeam = advantage.teams[0];
TF.rulesLab.configure(advantage, { autoRestartSeconds: 90 });
const offender = advantage.teams[1].activePlayers[6], victim = victimTeam.activePlayers[7];
open(advantage); advantage.state.possessionTeamId = victimTeam.id;
victim.position.x = 44; victim.position.y = 25;
advantage.ball.position.x = 44; advantage.ball.position.y = 25;
advantage.clock.elapsedSeconds = 5;
TF.rulesLab.awardFoul(advantage, { offenderId: offender.id, victimId: victim.id,
  point: { x: 44, y: 25 }, severity: 0.62, reckless: true });
assert.ok(advantage.state.advantage);
advantage.clock.elapsedSeconds += 0.5;
TF.updateRules(advantage, TF.FIXED_DT);
assert.equal(advantage.state.restartType, 'direct-free-kick');
assert.equal(advantage.state.restartTeamId, victimTeam.id);
assert.equal(offender.cards.yellow, 1);
assert.ok(advantage.events.some(e => e.type === 'advantage-recalled'));

// Same-team contact cannot earn a free kick, advantage or disciplinary sanction.
const friendlyContact = fresh(71061), friendlyTeam = friendlyContact.teams[0];
const teammateOffender = friendlyTeam.activePlayers[5], teammateVictim = friendlyTeam.activePlayers[6];
open(friendlyContact); friendlyContact.state.restartType = null;
const eventCountBeforeFriendlyContact = friendlyContact.events.length;
TF.rulesLab.awardFoul(friendlyContact, { offenderId: teammateOffender.id, victimId: teammateVictim.id,
  point: { x: 55, y: 34 }, severity: 0.82, reckless: true });
assert.equal(friendlyContact.state.restartType, null, 'friendly contact does not award a restart');
assert.ok(!friendlyContact.state.advantage, 'friendly contact cannot trigger advantage');
assert.equal(friendlyContact.events.slice(eventCountBeforeFriendlyContact).some(e => e.type === 'foul' || e.type === 'card'), false,
  'friendly contact cannot create a foul or a card');
assert.equal(friendlyContact.state.rules && friendlyContact.state.rules.persistentOffenses, undefined,
  'same-team contact does not pollute the offender history');

function minorFoul(match, offender, victim, time) {
  match.clock.elapsedSeconds = time;
  match.state.possessionTeamId = null;
  const start = match.events.length;
  TF.rulesLab.awardFoul(match, { offenderId: offender.id, victimId: victim.id,
    point: { x: 55, y: 34 }, severity: 0.3, reckless: false });
  return match.events.slice(start).reverse().find(e => e.type === 'foul' || e.type === 'advantage');
}
const persistence = fresh(71062), persistOffender = persistence.teams[1].activePlayers[7], persistVictim = persistence.teams[0].activePlayers[8];
open(persistence);
const firstMinor = minorFoul(persistence, persistOffender, persistVictim, 0);
assert.equal(firstMinor.card, null, 'a first ordinary minor foul does not earn a caution');
minorFoul(persistence, persistOffender, persistVictim, 30);
minorFoul(persistence, persistOffender, persistVictim, 60);
const disciplineCheckpoint = TF.captureCheckpoint(persistence), restoredDiscipline = fresh(71062);
TF.restoreCheckpoint(restoredDiscipline, disciplineCheckpoint);
assert.deepEqual(restoredDiscipline.state.rules.persistentOffenses, persistence.state.rules.persistentOffenses,
  'recent offender history survives checkpoint capture and restore');
let nextFoulTime = 90, persistentCard = null;
for (let i = 0; i < 8 && !persistOffender.cards?.yellow; i++, nextFoulTime += 30)
  persistentCard = minorFoul(persistence, persistOffender, persistVictim, nextFoulTime);
assert.equal(persistOffender.cards.yellow, 1, 'a clustered repeated minor-offence pattern merits a caution');
assert.ok(persistentCard.persistentCaution, 'the referee event explains the persistent-offence caution');
for (let i = 0; i < 8 && persistOffender.active; i++, nextFoulTime += 30)
  minorFoul(persistence, persistOffender, persistVictim, nextFoulTime);
assert.equal(persistOffender.cards.red, 1, 'a later persistent-offence caution applies the existing second-yellow dismissal');
assert.equal(persistOffender.active, false);

const spacedMinor = fresh(71063), spacedOffender = spacedMinor.teams[1].activePlayers[7], spacedVictim = spacedMinor.teams[0].activePlayers[8];
open(spacedMinor);
for (let i = 0; i < 7; i++) {
  const event = minorFoul(spacedMinor, spacedOffender, spacedVictim, i * 601);
  assert.equal(event.card, null, 'widely spaced minor offences decay instead of becoming persistent');
}
assert.equal(spacedOffender.cards?.yellow || 0, 0);

const advantagePersistence = fresh(71064), advOffender = advantagePersistence.teams[1].activePlayers[7], advVictim = advantagePersistence.teams[0].activePlayers[8];
open(advantagePersistence); advVictim.position.x = 44; advVictim.position.y = 25; advantagePersistence.ball.position.x = 44; advantagePersistence.ball.position.y = 25;
for (let i = 0; i < 3; i++) minorFoul(advantagePersistence, advOffender, advVictim, 0);
advantagePersistence.state.possessionTeamId = advVictim.teamId; advantagePersistence.ball.position.x = 44; advantagePersistence.ball.position.y = 25;
const persistentAdvantageEventCount = advantagePersistence.events.length;
TF.rulesLab.awardFoul(advantagePersistence, { offenderId: advOffender.id, victimId: advVictim.id,
  point: { x: 44, y: 25 }, severity: 0.3, reckless: false });
assert.ok(advantagePersistence.state.advantage && advantagePersistence.state.advantage.card === 'yellow',
  'a persistent caution remains delayed while advantage is applied');
assert.equal(advOffender.cards?.yellow || 0, 0, 'the persistent caution is not administered before advantage ends');
advantagePersistence.clock.elapsedSeconds += 0.4; advantagePersistence.state.possessionTeamId = null; advantagePersistence.ball.ownerId = null;
TF.updateRules(advantagePersistence, TF.FIXED_DT);
assert.equal(advOffender.cards.yellow, 1, 'the delayed persistent caution is administered when advantage is recalled');
assert.ok(advantagePersistence.events.slice(persistentAdvantageEventCount).some(e => e.type === 'advantage-recalled'));

// Two cautions dismiss a player, and the configurable minimum ends a match below seven.
const cards = fresh(7107), sentOff = cards.teams[1].activePlayers[5];
TF.rulesLab.awardFoul(cards, { offenderId: sentOff.id, victimId: cards.teams[0].activePlayers[4].id,
  point: { x: 55, y: 34 }, severity: 0.7 });
sentOff.active = true; // Isolate the second-card transition from the first foul's restart state.
sentOff.cards.yellow = 1;
TF.rulesLab.awardFoul(cards, { offenderId: sentOff.id, victimId: cards.teams[0].activePlayers[4].id,
  point: { x: 55, y: 34 }, severity: 0.7 });
assert.equal(sentOff.cards.red, 1);
assert.equal(sentOff.active, false);
const shortSide = fresh(7108, { rules: { minPlayers: 7 } });
shortSide.teams[0].activePlayers.slice(0, 5).forEach(p => { p.active = false; });
TF.updateRules(shortSide, TF.FIXED_DT);
assert.equal(shortSide.state.phase, 'abandoned');
assert.equal(shortSide.state.abandonedTeamId, shortSide.teams[0].id);

// A legal restart progresses into live play, then physics records the taker's real kick.
const restart = fresh(7109), restartingTeam = restart.teams[0];
restart.state.phase = 'dead-ball'; restart.state.restartType = 'direct-free-kick';
restart.state.restartTeamId = restartingTeam.id; restart.state.restartPoint = { x: 60, y: 34 };
restart.state.restartStarted = 0; restart.clock.elapsedSeconds = 1;
TF.updateRules(restart, TF.FIXED_DT);
const taker = restart.playersById[restart.ball.ownerId];
assert.equal(restart.state.phase, 'open-play');
assert.ok(restart.state.restartInProgress);
taker.motor = { type: 'action', action: 'pass', target: { x: 72, y: 34 }, ballTarget: { x: 72, y: 34 }, power: 0.5, createdTick: restart.tick };
restart.tick += 1;
TF.updatePhysics(restart, TF.FIXED_DT);
TF.updateRules(restart, TF.FIXED_DT);
assert.equal(restart.state.restartInProgress, null);
assert.equal(restart.ball.lastTouchPlayerId, taker.id);
assert.ok(restart.events.some(e => e.type === 'pass' && e.playerId === taker.id));

// Rule events preserve sequence ordering and immutable event records.
const sequences = restart.events.map(e => e.sequence);
assert.ok(sequences.every((value, i) => i === 0 || value > sequences[i - 1]));
assert.ok(restart.events.filter(e => e.type === 'restart-awarded' || e.type === 'restart-taken')
  .every(Object.isFrozen));

process.stdout.write('complete rules transitions passed (offside, restart goals, advantage, cards, player minimum, restart execution)\n');
