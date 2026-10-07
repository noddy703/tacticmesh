const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');
require('../src/physics.js');
require('../src/rules.js');
require('../src/telemetry.js');
const TF = globalThis.TF;

const styledDefaults = TF.createMatch({ seed: 73020, halfSeconds: 90, matchId: 'contrasting-default-styles' });
assert.notEqual(styledDefaults.teams[0].tactics.passingDirectness, styledDefaults.teams[1].tactics.passingDirectness,
  'seeded default teams should have distinct tactical identities');
styledDefaults.state.phase = 'open-play'; styledDefaults.state.restartType = null;
styledDefaults.ball.ownerId = styledDefaults.teams[0].activePlayers[8].id;
styledDefaults.ball.lastTouchTeamId = styledDefaults.teams[0].id;
styledDefaults.state.possessionTeamId = styledDefaults.teams[0].id; styledDefaults.tick = 60;
TF.updateTactics(styledDefaults, TF.FIXED_DT);
assert.notEqual(styledDefaults.teams[0].intent, styledDefaults.teams[1].intent,
  'default tactical profiles should produce distinct team intent in the same open-play state');
const explicitStyles = TF.createMatch({ seed: 73020, halfSeconds: 90, homeTactics: { passingDirectness: .91 }, away: { tactics: { passingDirectness: .17, tempo: .23 } } });
assert.equal(explicitStyles.teams[0].tactics.passingDirectness, .91, 'home tactical configuration must override its default profile');
assert.equal(explicitStyles.teams[1].tactics.passingDirectness, .17, 'away tactical configuration must override its default profile');
assert.equal(explicitStyles.teams[1].tactics.tempo, .23, 'partial explicit tactics must preserve every supplied value');
const identicalStyles = TF.createMatch({ seed: 73020, halfSeconds: 90, homeTactics: { passingDirectness: .38, tempo: .48 }, awayTactics: { passingDirectness: .38, tempo: .48 } });
assert.deepEqual(identicalStyles.teams[0].tactics, identicalStyles.teams[1].tactics,
  'explicit matching configurations must preserve identical-team test semantics');

// A player must abandon an old carry after losing control, even if it has high utility.
const match = TF.createMatch({ seed: 73021, halfSeconds: 90, matchId: 'loose-ball-claim' });
const claimant = match.playersById['home-p09'];
match.state.phase = 'open-play';
match.ball.ownerId = null;
match.ball.controlState = 'loose';
match.ball.position = { x: claimant.position.x + 5, y: claimant.position.y, z: .11 };
match.ball.velocity = { x: 0, y: 0, z: 0 };
claimant.position.x = 40; claimant.position.y = 34;
match.ball.position.x = 45; match.ball.position.y = 34;
claimant.intent = { type: 'carry', action: 'carry', target: { x: 50, y: 34 }, utility: .96, createdTick: 1, expiresTick: 50000, details: {} };
claimant.motor = claimant.intent; claimant.ai = { nextDecision: 0 };
match.players.filter(p => p !== claimant && p.active).forEach((p, i) => {
  p.position.x = p.teamId === claimant.teamId ? 10 + (i % 3) : 85 + (i % 3);
  p.position.y = 5 + (i * 7) % 58;
});
match.tick = 1;
TF.updateTactics(match, TF.FIXED_DT);
TF.updateAI(match, TF.FIXED_DT);
assert.notEqual(claimant.intent.type, 'carry', 'loose-ball player should switch from stale carry to a current off-ball decision');

// Movement audit compares sampled positions across its 60-tick window, not adjacent frames.
const auditMatch = TF.createMatch({ seed: 73022, halfSeconds: 90, matchId: 'audit-window' });
const mover = auditMatch.playersById['home-p09'];
mover.intent = { type: 'support', target: { x: mover.position.x + 20, y: mover.position.y } };
for (let i = 0; i < 122; i++) {
  auditMatch.tick++;
  mover.position.x += .1;
  TF.updateTelemetry(auditMatch, TF.FIXED_DT);
}
assert.equal(auditMatch.telemetry.auditSamples[1].staticSupport, 0, 'steady 0.1m/tick movement should count across the full sample interval');

// Sequence IDs keep telemetry accumulating after the source event feed is trimmed.
const eventMatch = TF.createMatch({ seed: 73023, halfSeconds: 90, matchId: 'event-cursor' });
eventMatch.tick = 4;
TF.appendEvent(eventMatch, { type: 'shot', teamId: 'home', playerId: 'home-p09', tick: 4, time: 0 });
TF.updateTelemetry(eventMatch, TF.FIXED_DT);
eventMatch.events = [];
eventMatch.tick = 5;
TF.appendEvent(eventMatch, { type: 'shot', teamId: 'home', playerId: 'home-p09', tick: 5, time: .02 });
TF.updateTelemetry(eventMatch, TF.FIXED_DT);
assert.equal(TF.telemetry.summary(eventMatch).teams.home.shots, 2, 'event-derived counters survive bounded source history');
assert.ok(eventMatch.events[0].sequence > 4 * 1024, 'event sequence increases with simulation time');

// A keeper's handling attempt wins over a nearby teammate's generic foot touch.
const keeperMatch = TF.createMatch({ seed: 73024, halfSeconds: 90, matchId: 'keeper-first-contact' });
const keeper = keeperMatch.teams[1].activePlayers.find(p => p.isGoalkeeper);
const nearbyDefender = keeperMatch.teams[1].activePlayers.find(p => !p.isGoalkeeper);
keeper.position = { x: 100, y: 34, z: 0 }; keeper.velocity = { x: 0, y: 0, z: 0 }; keeper.attributes.handling = 99; keeper.attributes.catching = 99; keeper.attributes.reflexes = 99;
nearbyDefender.position = { x: 99.5, y: 34, z: 0 }; nearbyDefender.velocity = { x: 0, y: 0, z: 0 };
keeperMatch.players.filter(p => p !== keeper && p !== nearbyDefender).forEach((p, i) => { p.position.x = 15 + (i % 4) * 12; p.position.y = 8 + (i % 5) * 11; p.velocity.x = p.velocity.y = 0; });
keeperMatch.state.phase = 'open-play'; keeperMatch.clock.elapsedSeconds = 10;
keeperMatch.ball.position = { x: 98.9, y: 34, z: .5 }; keeperMatch.ball.previousPosition = { ...keeperMatch.ball.position };
keeperMatch.ball.velocity = { x: 10, y: 0, z: 0 }; keeperMatch.ball.ownerId = null; keeperMatch.ball.lastTouchTeamId = keeperMatch.teams[0].id;
keeperMatch.ball._lastShotId = 'home-p10'; keeperMatch.ball._lastShotType = 'shot';
TF.updatePhysics(keeperMatch, TF.FIXED_DT);
assert.ok(keeperMatch.events.some(e => e.type === 'save' && e.keeperId === keeper.id), 'keeper handling should resolve before a teammate foot touch');

function keeperBoxTrial(teamId, ballX, keeperX) {
  const m = TF.createMatch({ seed: 73026, halfSeconds: 90, matchId: 'keeper-box-boundary-' + ballX });
  const defending = m.teams.find(team => team.id === teamId);
  const gk = defending.activePlayers.find(player => player.isGoalkeeper);
  m.players.filter(player => player !== gk).forEach((player, i) => { player.position = { x: 40 + i % 3, y: 5 + i % 4 * 15, z: 0 }; player.velocity.x = player.velocity.y = 0; });
  gk.position = { x: keeperX, y: 34, z: 0 }; gk.previousPosition = { ...gk.position }; gk.velocity.x = gk.velocity.y = 0;
  gk.attributes.handling = gk.attributes.catching = gk.attributes.reflexes = 99;
  m.state.phase = 'open-play'; m.clock.elapsedSeconds = 8; m.tick = 20;
  m.ball.position = { x: ballX, y: 34, z: .11 }; m.ball.previousPosition = { ...m.ball.position };
  m.ball.velocity = { x: 0, y: 0, z: 0 }; m.ball.ownerId = null; m.ball._touchCooldown = 0;
  m.ball.lastTouchPlayerId = 'opponent'; m.ball.lastTouchTeamId = teamId === m.teams[0].id ? m.teams[1].id : m.teams[0].id;
  TF.updatePhysics(m, TF.FIXED_DT);
  return m.events.some(event => event.type === 'keeper-collection' && event.keeperId === gk.id) || m.events.some(event => event.type === 'save' && event.keeperId === gk.id);
}
assert.equal(keeperBoxTrial('home', 16.51, 17.7), false, 'keeper may not handle a ball beyond the home penalty-area line even when nearby');
assert.equal(keeperBoxTrial('home', 16.49, 17.68), true, 'keeper may handle a ball just inside the home penalty-area line');
assert.equal(keeperBoxTrial('away', 88.49, 87.3), false, 'keeper may not handle a ball beyond the away penalty-area line even when nearby');
assert.equal(keeperBoxTrial('away', 88.51, 87.32), true, 'keeper may handle a ball just inside the away penalty-area line');

const distributionMatch = TF.createMatch({ seed: 73025, halfSeconds: 90, matchId: 'keeper-release-follow-through' });
const distributingKeeper = distributionMatch.teams[1].activePlayers.find(p => p.isGoalkeeper);
distributionMatch.players.filter(p => p !== distributingKeeper).forEach((p, i) => { p.position = { x: 10 + (i % 5) * 10, y: 5 + (i % 6) * 10, z: 0 }; p.velocity.x = p.velocity.y = 0; p.intent = p.motor = null; });
distributingKeeper.position = { x: 100, y: 34, z: 0 }; distributingKeeper.previousPosition = { ...distributingKeeper.position }; distributingKeeper.facing = { x: -1, y: 0 };
distributionMatch.state.phase = 'open-play'; distributionMatch.tick = 10; distributionMatch.clock.elapsedSeconds = 10;
distributionMatch.ball.ownerId = distributingKeeper.id; distributionMatch.ball.handControl = true;
distributionMatch.ball.position = { x: 99.55, y: 34, z: .68 }; distributionMatch.ball._handStarted = 10;
distributingKeeper.intent = distributingKeeper.motor = { type: 'clear', action: 'clear', target: { x: 82, y: 34 }, ballTarget: { x: 82, y: 34 }, desiredSpeed: 0, power: .5, lift: 0, expiresTick: 90 };
TF.updatePhysics(distributionMatch, TF.FIXED_DT);
assert.equal(distributionMatch.ball.ownerId, null, 'keeper release should leave the hand without same-tick rehandling');
assert.ok(!distributionMatch.events.some(e => e.type === 'keeper-collection' && e.tick === distributionMatch.tick), 'keeper follow-through must clear its own handling radius after a kick');

function firstTouchTrials(count, pressAndSpeed) {
  let controls = 0;
  for (let i = 0; i < count; i++) {
    const m = TF.createMatch({ seed: 73100 + i, halfSeconds: 90, matchId: 'first-touch-' + i });
    const receiver = m.playersById['home-p06'];
    m.state.phase = 'open-play'; m.clock.elapsedSeconds = 1;
    m.players.forEach((p, j) => { p.intent = null; p.motor = null; p.velocity.x = p.velocity.y = 0; p.position = { x: 8 + (j % 5) * 4, y: 5 + Math.floor(j / 5) * 7, z: 0 }; });
    receiver.position = { x: 50, y: 34, z: 0 }; receiver.previousPosition = { ...receiver.position };
    receiver.facing = { x: 1, y: 0 }; receiver.attributes.firstTouch = 82; receiver.attributes.balance = 82; receiver.stamina = 1;
    if (pressAndSpeed) {
      const defender = m.playersById['away-p06']; defender.position = { x: 49.55, y: 34, z: 0 }; defender.previousPosition = { ...defender.position };
    }
    const speed = pressAndSpeed ? 16 : 0.5;
    m.ball.position = { x: 50.22, y: 34, z: 0.11 }; m.ball.previousPosition = { ...m.ball.position };
    m.ball.velocity = { x: -speed, y: 0, z: 0 }; m.ball.ownerId = null; m.ball._touchCooldown = 0;
    TF.updatePhysics(m, TF.FIXED_DT);
    if (m.ball.ownerId === receiver.id) controls++;
  }
  return controls / count;
}
const cleanTrapRate = firstTouchTrials(100, false), pressuredPaceTrapRate = firstTouchTrials(100, true);
assert.ok(cleanTrapRate >= 0.85, 'unopposed low-speed ground balls should be controlled reliably');
assert.ok(pressuredPaceTrapRate < cleanTrapRate - 0.2, 'pressure and incoming pace should materially increase miscontrol');

const facingMatch = TF.createMatch({ seed: 73199, halfSeconds: 90, matchId: 'kick-needs-facing' });
const kicker = facingMatch.playersById['home-p09'];
facingMatch.state.phase = 'open-play';
facingMatch.players.filter(p => p !== kicker).forEach((p, j) => { p.intent = null; p.motor = null; p.position = { x: 8 + (j % 5) * 4, y: 5 + Math.floor(j / 5) * 7, z: 0 }; p.velocity.x = p.velocity.y = 0; });
kicker.position = { x: 50, y: 34, z: 0 }; kicker.previousPosition = { ...kicker.position }; kicker.facing = { x: -1, y: 0 }; kicker.velocity.x = kicker.velocity.y = 0;
facingMatch.ball.ownerId = kicker.id; facingMatch.ball.position = { x: 49.4, y: 34, z: .11 }; facingMatch.ball._lastControlTouch = 0;
const kickTarget = { x: 68, y: 34 };
kicker.intent = kicker.motor = { type: 'pass', action: 'pass', target: kickTarget, ballTarget: kickTarget, desiredSpeed: 0, power: .6, expiresTick: 120 };
let kickTick = 0, strikeAlignment = 0, strikeFootDot = 0, followsThrough = false;
for (let tick = 1; tick <= 100; tick++) {
  facingMatch.tick = tick; TF.updatePhysics(facingMatch, TF.FIXED_DT);
  if (facingMatch.events.some(e => e.type === 'pass')) {
    kickTick = tick; strikeAlignment = kicker.facing.x;
    const rx = facingMatch.ball.position.x - kicker.position.x, ry = facingMatch.ball.position.y - kicker.position.y, d = Math.hypot(rx, ry) || 1;
    strikeFootDot = (rx * kicker.facing.x + ry * kicker.facing.y) / d;
    followsThrough = facingMatch.ball._kickFollowThroughPlayerId === kicker.id;
    break;
  }
}
assert.ok(kickTick >= 20, 'a backward-facing carrier must turn before striking a pass');
assert.ok(strikeAlignment >= .84, 'the pass should strike only after the body faces the target');
assert.ok(strikeFootDot > .8, 'the ball should leave from the carrier’s playable front foot');
assert.ok(followsThrough, 'the same player must be protected from immediate swept recontact after striking');

let retained = 0;
for (let i = 0; i < 30; i++) {
  const m = TF.createMatch({ seed: 73200 + i, halfSeconds: 90, matchId: 'carry-retention-' + i });
  const carrier = m.playersById['home-p09']; m.state.phase = 'open-play';
  m.players.forEach((p, j) => { p.intent = null; p.motor = null; p.velocity.x = p.velocity.y = 0; p.position = { x: 8 + (j % 5) * 4, y: 5 + Math.floor(j / 5) * 7, z: 0 }; });
  carrier.position = { x: 50, y: 34, z: 0 }; carrier.previousPosition = { ...carrier.position }; carrier.facing = { x: 1, y: 0 };
  m.ball.ownerId = carrier.id; m.ball.position = { x: 50.4, y: 34, z: 0.11 }; m.ball._lastControlTouch = 0;
  for (let tick = 0; tick < 300 && m.ball.ownerId; tick++) { m.clock.elapsedSeconds += TF.FIXED_DT; m.tick++; TF.updatePhysics(m, TF.FIXED_DT); }
  if (m.ball.ownerId === carrier.id) retained++;
}
assert.ok(retained >= 26, 'unpressured carrier should retain the ball for five seconds in at least 26/30 trials');

const physicalCarry = TF.createMatch({ seed: 73240, halfSeconds: 90, matchId: 'carry-is-not-glued' });
const physicalCarrier = physicalCarry.playersById['home-p09'];
physicalCarry.state.phase = 'open-play'; physicalCarry.players.forEach(player => { player.intent = player.motor = null; player.velocity.x = player.velocity.y = 0; });
physicalCarrier.position = { x: 50, y: 34, z: 0 }; physicalCarrier.previousPosition = { ...physicalCarrier.position }; physicalCarrier.facing = { x: 1, y: 0 };
physicalCarry.ball.ownerId = physicalCarrier.id; physicalCarry.ball.controlState = 'controlled';
physicalCarry.ball.position = { x: 50.85, y: 34, z: .11 }; physicalCarry.ball.previousPosition = { ...physicalCarry.ball.position };
physicalCarry.ball.velocity = { x: 0, y: 0, z: 0 }; physicalCarry.ball._lastControlTouchTick = 1;
const carryStart = { ...physicalCarry.ball.position };
physicalCarry.tick = 2; TF.updatePhysics(physicalCarry, TF.FIXED_DT);
assert.ok(Math.hypot(physicalCarry.ball.position.x - carryStart.x, physicalCarry.ball.position.y - carryStart.y) < .03,
  'a controlled ball should continue from its physical position instead of snapping to the foot each frame');
assert.ok(Math.abs(physicalCarry.ball.position.x - (physicalCarrier.position.x + .43)) > .2,
  'the controlled ball should remain physically separated from the foot between touches');
for (let tick = 3; tick <= 24 && physicalCarry.ball.ownerId; tick++) { physicalCarry.tick = tick; TF.updatePhysics(physicalCarry, TF.FIXED_DT); }
assert.equal(physicalCarry.ball.ownerId, physicalCarrier.id, 'discrete unpressured control touches should retain a nearby ball');
assert.ok(Math.abs(physicalCarry.ball.position.x - (physicalCarrier.position.x + .43)) > .03,
  'touch corrections must leave some physical offset instead of gluing the ball to the player');

process.stdout.write(`integration behavior passes (loose-ball claim, sampled-motion audit, bounded event cursor, traps ${Math.round(cleanTrapRate * 100)}% clean/${Math.round(pressuredPaceTrapRate * 100)}% pressured, five-second retention ${retained}/30)\n`);
