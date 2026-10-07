const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/analysis.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');
require('../src/physics.js');
require('../src/rules.js');
const TF = globalThis.TF;
const indexedPressure = TF.analysis.pressureAtPlayer;
const observedPressureRadii = new Set();
TF.analysis.pressureAtPlayer = function (match, player, radius) {
  let reference = 0;
  for (const opponent of match.players) if (opponent.active && opponent.teamId !== player.teamId) {
    const dx = opponent.position.x - player.position.x, dy = opponent.position.y - player.position.y;
    const gap = Math.sqrt(dx * dx + dy * dy);
    if (gap < radius) reference += (radius - gap) / radius;
  }
  const actual = indexedPressure(match, player, radius);
  assert.ok(Math.abs(actual - reference) <= 1e-12, `indexed ${radius}m pressure matches the former roster scan`);
  observedPressureRadii.add(radius);
  return actual;
};

function strikeTrial(seed, skill, pressure, keeper = false) {
  const m = TF.createMatch({ seed, halfSeconds: 90, matchId: 'execution-' + seed });
  const player = m.playersById[keeper ? 'away-p01' : 'home-p09'];
  m.state.phase = 'open-play'; m.tick = 30; m.clock.elapsedSeconds = 2;
  m.players.forEach((p, i) => {
    p.intent = p.motor = null; p.velocity.x = p.velocity.y = 0;
    p.position = { x: 10 + (i % 6) * 11, y: 5 + Math.floor(i / 6) * 16, z: 0 };
  });
  player.position = { x: 50, y: 34, z: 0 }; player.previousPosition = { ...player.position };
  player.facing = { x: 1, y: 0 }; player.isGoalkeeper = !!keeper;
  player.attributes.shortPassing = skill; player.attributes.kicking = skill; player.attributes.throwing = skill;
  player.attributes.stamina = 99; player.stamina = 1;
  if (pressure) {
    const defender = m.players.find(p => p.teamId !== player.teamId);
    defender.position = { x: 52.2, y: 34.1, z: 0 }; defender.previousPosition = { ...defender.position };
  }
  const target = { x: 75, y: 38 };
  m.ball.ownerId = player.id; m.ball.position = { x: 50.43, y: 34, z: .11 };
  m.ball.previousPosition = { ...m.ball.position }; m.ball.velocity = { x: 0, y: 0, z: 0 };
  const action = keeper ? 'throw' : 'pass';
  player.intent = player.motor = { type: action, action, target, ballTarget: target, desiredSpeed: 0, power: .7, lift: .35, expiresTick: 60 };
  if (keeper) { m.ball.handControl = true; m.ball.position.z = .68; m.ball._handStarted = m.clock.elapsedSeconds; }
  TF.updatePhysics(m, TF.FIXED_DT);
  const launched = m.events.find(e => e.type === 'pass');
  assert.ok(launched, 'the aligned carrier should execute the kick');
  return { angle: Math.abs(Math.atan2(m.ball.velocity.y, m.ball.velocity.x) - Math.atan2(4, 25)), power: launched.power,
    powerError: launched.powerError, angleError: launched.angleError, executedLift: launched.executedLift,
    liftError: launched.executedLift - launched.requestedLift, skillName: launched.executionSkill };
}

function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function variance(values) { const avg = mean(values); return mean(values.map(value => (value - avg) ** 2)); }
const elite = Array.from({ length: 120 }, (_, i) => strikeTrial(74100 + i, 96, false));
const novice = Array.from({ length: 120 }, (_, i) => strikeTrial(74200 + i, 28, false));
const pressed = Array.from({ length: 120 }, (_, i) => strikeTrial(74300 + i, 96, true));
assert.ok(mean(novice.map(r => r.angle)) > mean(elite.map(r => r.angle)) * 1.25,
  'high passing skill should reduce observed angular execution error');
assert.ok(variance(novice.map(r => r.powerError)) > variance(elite.map(r => r.powerError)),
  'low skill should create more power dispersion');
assert.ok(variance(novice.map(r => r.liftError)) > variance(elite.map(r => r.liftError)),
  'low skill should create more vertical-angle dispersion');
assert.ok(mean(pressed.map(r => Math.abs(r.angleError))) > mean(elite.map(r => Math.abs(r.angleError))),
  'nearby pressure should increase execution uncertainty');
assert.ok(elite.every(r => Math.abs(r.angle) < .45 && r.executedLift >= 0 && r.executedLift <= 1),
  'execution error remains bounded and should not swamp an accurate pass');
const keeperThrow = strikeTrial(74400, 96, false, true);
assert.equal(keeperThrow.skillName, 'throwing', 'keeper throw precision should use throwing skill');
assert.ok(observedPressureRadii.has(5), 'kick execution uses parity-checked 5m spatial pressure');

const shotBlock = openPhysics(74401), shooter = shotBlock.playersById['home-p09'], blockingDefender = shotBlock.playersById['away-p02'];
shotBlock.players.forEach((p, index) => { p.intent = p.motor = p.currentAction = null; p.position = { x: 80 + index * 0.2, y: 55 + index * 0.25, z: 0 }; p.previousPosition = { ...p.position }; p.velocity.x = p.velocity.y = 0; });
shooter.position = { x: 50, y: 34, z: 0 }; shooter.previousPosition = { ...shooter.position }; shooter.facing = { x: 1, y: 0 }; shooter.rng = { next: () => 0.5 };
shooter.intent = shooter.motor = shooter.currentAction = { type: 'shoot', action: 'shoot', target: { x: 55, y: 34 }, ballTarget: { x: 55, y: 34 }, desiredSpeed: 0, power: 0.55, lift: 0, expiresTick: shotBlock.tick + 20 };
blockingDefender.position = { x: 51.3, y: 34, z: 0 }; blockingDefender.previousPosition = { ...blockingDefender.position }; blockingDefender.facing = { x: -1, y: 0 }; blockingDefender.rng = { next: () => 0 };
shotBlock.ball.ownerId = shooter.id; shotBlock.ball.position = { x: 50.43, y: 34, z: 0.11 }; shotBlock.ball.previousPosition = { ...shotBlock.ball.position }; shotBlock.ball.velocity = { x: 0, y: 0, z: 0 }; shotBlock.ball._touchCooldown = 0;
TF.updatePhysics(shotBlock, TF.FIXED_DT);
assert.ok(shotBlock.events.some(e => (e.type === 'ball-control' || e.type === 'ball-deflection') && e.playerId === blockingDefender.id),
  'a physically intersecting defender can block a shot immediately instead of being hidden by the kicker follow-through window');

function openPhysics(seed) {
  const m = TF.createMatch({ seed, halfSeconds: 90, matchId: 'physical-contact-' + seed });
  m.state.phase = 'open-play'; m.tick = 40; m.clock.elapsedSeconds = 3;
  m.players.forEach((p, i) => { p.intent = p.motor = null; p.position = { x: 8 + i * 2.3, y: 8 + (i % 4) * 11, z: 0 }; p.previousPosition = { ...p.position }; p.velocity.x = p.velocity.y = 0; });
  m.ball.ownerId = null; m.ball.handControl = false; m.ball._touchCooldown = 1;
  return m;
}

const receiverMatch = openPhysics(74410), receiver = receiverMatch.playersById['home-p08'];
receiver.position = { x: 45, y: 34, z: 0 }; receiver.previousPosition = { ...receiver.position }; receiver.facing = { x: 1, y: 0 };
receiver.intent = receiver.motor = { type: 'receive', target: { x: 40, y: 34 }, facingTarget: { x: 45, y: 44 }, desiredSpeed: 0.7 };
TF.updatePhysics(receiverMatch, TF.FIXED_DT);
assert.ok(receiver.facing.y > 0 && receiver.facing.x > 0.9, 'receiver turns toward the perceived approach point at a bounded physical rate');
assert.ok(receiver.position.x < 45, 'receiver keeps moving toward the interception point while facing the ball approach');

const defenderFacing = openPhysics(74418), trackingDefender = defenderFacing.playersById['home-p06'];
trackingDefender.position = { x: 60, y: 30, z: 0 }; trackingDefender.previousPosition = { ...trackingDefender.position };
trackingDefender.facing = { x: 1, y: 0 };
trackingDefender.intent = trackingDefender.motor = { type: 'recover', target: { x: 50, y: 30 }, facingTarget: { x: 60, y: 40 }, desiredSpeed: 0.7 };
TF.updatePhysics(defenderFacing, TF.FIXED_DT);
assert.ok(trackingDefender.facing.y > 0 && trackingDefender.facing.x > 0.9,
  'a defensive motor can face a fresh perceived threat independently of its retreat target');
assert.ok(trackingDefender.position.x < 60,
  'the defender continues its bounded movement toward the retreat target while orienting to the threat');

const deflectionMatch = openPhysics(74411), catcher = deflectionMatch.playersById['home-p08'];
catcher.position = { x: 50, y: 34, z: 0 }; catcher.previousPosition = { ...catcher.position }; catcher.velocity.x = catcher.velocity.y = 0; catcher.facing = { x: 1, y: 0 };
catcher.attributes.firstTouch = 20; catcher.rng = { next: () => 0.999 };
deflectionMatch.ball._touchCooldown = 0; deflectionMatch.ball.position = { x: 50.2, y: 34, z: 0.11 }; deflectionMatch.ball.previousPosition = { ...deflectionMatch.ball.position };
deflectionMatch.ball.velocity = { x: -12, y: 0, z: 0 };
TF.updatePhysics(deflectionMatch, TF.FIXED_DT);
const deflection = deflectionMatch.events.find(e => e.type === 'ball-deflection');
assert.ok(deflection, 'the deliberately missed trap remains a physical deflection');
assert.ok(deflectionMatch.ball.velocity.x > 0 && deflectionMatch.ball.velocity.x < 7,
  'a failed trap redirects and dissipates incoming speed instead of adding energy along its old path');

function challengeTrial(seed, type, speed, discipline, options = {}) {
  const m = openPhysics(seed), attacker = m.playersById['home-p09'], tackler = m.playersById['away-p02'];
  attacker.position = options.attackerPosition || { x: 50, y: 34, z: 0 }; attacker.previousPosition = { ...attacker.position };
  tackler.position = options.tacklerPosition || { x: 49.15, y: 34, z: 0 }; tackler.previousPosition = { ...tackler.position }; tackler.facing = options.facing || { x: 1, y: 0 };
  tackler.velocity.x = options.velocityX == null ? speed : options.velocityX; tackler.velocity.y = 0; attacker.velocity.x = options.attackerSpeed || 0; attacker.velocity.y = options.attackerYSpeed || 0; tackler.attributes.discipline = discipline;
  m.ball.ownerId = attacker.id; m.ball.position = options.ballPosition || { x: 50.43, y: 34, z: 0.11 }; m.ball.previousPosition = { ...m.ball.position }; m.ball._touchCooldown = 1;
  tackler.intent = tackler.motor = { type, action: type, desiredSpeed: 0, expiresTick: m.tick + 1 };
  TF.updatePhysics(m, TF.FIXED_DT);
  return { match: m, tackler, severity: m.events.find(e => e.type === 'contact')?.severity, contact: m.events.find(e => e.type === 'contact') };
}
const carefulChallenge = challengeTrial(74412, 'standingtackle', 0.2, 95);
const recklessChallenge = challengeTrial(74413, 'slide', 7.5, 25);
assert.ok(recklessChallenge.severity > carefulChallenge.severity + 0.15, 'contact severity scales with relative impact, slide technique, and discipline');
assert.ok(recklessChallenge.contact.relativeClosingSpeed > carefulChallenge.contact.relativeClosingSpeed,
  'contact event exposes relative closing speed for foul assessment');
const parallelChallenge = challengeTrial(74428, 'standingtackle', 4.2, 85, {
  tacklerPosition: { x: 49.45, y: 34, z: 0 }, attackerSpeed: 4.2
});
assert.ok(parallelChallenge.contact?.bodyContact, 'parallel runners can make a real low-impact body contact');
assert.ok(parallelChallenge.contact.relativeClosingSpeed < 0.3, 'parallel contact has negligible relative closing speed');
assert.ok(parallelChallenge.severity < 0.18, 'high absolute running speed alone does not make parallel body contact severe');
const separatingChallenge = challengeTrial(74429, 'standingtackle', -3.4, 85,
  { tacklerPosition: { x: 49.2, y: 34, z: 0 }, ballPosition: { x: 50, y: 34.43, z: 0.11 } });
assert.equal(separatingChallenge.contact, undefined,
  'a separating poke with neither body overlap nor intersecting leg path creates no invented player-contact event');
const standingTrip = challengeTrial(74430, 'standingtackle', 0, 80);
assert.equal(standingTrip.contact?.legContact, true,
  'a low-speed standing tackle still registers a genuine trip when its foot path intersects the victim');
const mirroredImpact = challengeTrial(74413, 'slide', 7.5, 25, {
  attackerPosition: { x: 55, y: 34, z: 0 }, tacklerPosition: { x: 55.85, y: 34, z: 0 },
  ballPosition: { x: 54.57, y: 34, z: 0.11 }, facing: { x: -1, y: 0 }, velocityX: -7.5
});
assert.ok(Math.abs(mirroredImpact.severity - recklessChallenge.severity) < 1e-9,
  'relative impact severity is invariant when the same contact is mirrored across the pitch');
const contactCheckpoint = TF.captureCheckpoint(carefulChallenge.match), restoredContact = openPhysics(74412);
TF.restoreCheckpoint(restoredContact, contactCheckpoint);
assert.equal(restoredContact.playersById['away-p02']._challengeRecoveryUntilTick,
  carefulChallenge.tackler._challengeRecoveryUntilTick,
  'checkpoint preserves the tackler recovery window associated with a resolved contact');
const contactCount = carefulChallenge.match.events.filter(e => e.type === 'contact').length;
carefulChallenge.match.tick += 1; carefulChallenge.match.clock.elapsedSeconds += TF.FIXED_DT;
carefulChallenge.match.ball.ownerId = carefulChallenge.match.playersById['home-p09'].id;
carefulChallenge.match.playersById['home-p09'].position = { x: 50, y: 34, z: 0 };
carefulChallenge.tackler.intent = carefulChallenge.tackler.motor = { type: 'standingtackle', action: 'standingtackle', desiredSpeed: 0, expiresTick: carefulChallenge.match.tick + 1 };
TF.updatePhysics(carefulChallenge.match, TF.FIXED_DT);
assert.equal(carefulChallenge.match.events.filter(e => e.type === 'contact').length, contactCount,
  'a refreshed AI challenge intent cannot create another contact during physical recovery');

const friendlyChallenge = openPhysics(74416), friendlyCarrier = friendlyChallenge.playersById['home-p09'];
const staleChallenger = friendlyChallenge.playersById['home-p08'];
friendlyCarrier.position = { x: 50, y: 34, z: 0 }; friendlyCarrier.previousPosition = { ...friendlyCarrier.position };
staleChallenger.position = { x: 49.15, y: 34, z: 0 }; staleChallenger.previousPosition = { ...staleChallenger.position };
staleChallenger.facing = { x: 1, y: 0 };
friendlyChallenge.ball.ownerId = friendlyCarrier.id;
friendlyChallenge.ball.position = { x: 50.43, y: 34, z: 0.11 }; friendlyChallenge.ball.previousPosition = { ...friendlyChallenge.ball.position };
friendlyChallenge.ball._touchCooldown = 1;
staleChallenger.intent = staleChallenger.motor = { type: 'standingtackle', action: 'standingtackle', desiredSpeed: 0, expiresTick: friendlyChallenge.tick + 1 };
TF.updatePhysics(friendlyChallenge, TF.FIXED_DT);
assert.equal(friendlyChallenge.ball.ownerId, friendlyCarrier.id, 'a stale tackle intent cannot dispossess a same-team carrier');
assert.ok(staleChallenger.motor._physicsDone, 'the invalid challenge is consumed instead of retried each tick');
assert.equal(friendlyChallenge.events.filter(e => e.type === 'tackle' || e.type === 'contact').length, 0,
  'same-team proximity does not emit a tackle or foul-eligible challenge contact');

const looseAfterTackle = openPhysics(74417), tackledCarrier = looseAfterTackle.playersById['home-p09'];
const tacklingOpponent = looseAfterTackle.playersById['away-p02'];
tackledCarrier.position = { x: 50, y: 34, z: 0 }; tackledCarrier.previousPosition = { ...tackledCarrier.position };
tacklingOpponent.position = { x: 49.15, y: 34, z: 0 }; tacklingOpponent.previousPosition = { ...tacklingOpponent.position };
tacklingOpponent.facing = { x: 1, y: 0 }; tacklingOpponent.rng = { next: () => 0 };
looseAfterTackle.ball.ownerId = tackledCarrier.id; looseAfterTackle.ball.position = { x: 50.43, y: 34, z: 0.11 };
looseAfterTackle.ball.previousPosition = { ...looseAfterTackle.ball.position }; looseAfterTackle.ball.velocity = { x: 0, y: 0, z: 0 };
looseAfterTackle.ball._touchCooldown = 0;
tacklingOpponent.intent = tacklingOpponent.motor = { type: 'standingtackle', action: 'standingtackle', desiredSpeed: 0, expiresTick: looseAfterTackle.tick + 1 };
TF.updatePhysics(looseAfterTackle, TF.FIXED_DT);
assert.ok(looseAfterTackle.events.some(e => e.type === 'tackle' && e.success && e.ballLoose && e.possessionWon === false),
  'successful challenge records a loose-ball poke, not an awarded possession');
assert.equal(looseAfterTackle.ball.ownerId, null, 'the ball remains physically loose immediately after a successful tackle');
assert.ok(looseAfterTackle.ball.position.x > 50.43, 'the tackle impulse moves the ball away from the carrier');
assert.equal(looseAfterTackle.events.filter(e => e.type === 'ball-control' && e.playerId === tackledCarrier.id && e.tick === looseAfterTackle.tick).length, 0,
  'the former carrier cannot recapture the ball in the same tick as the tackle');
assert.ok(looseAfterTackle.ball._touchCooldown > 0, 'the loose ball receives a brief physical-contact window');

const distantTackle = openPhysics(74419), distantCarrier = distantTackle.playersById['home-p09'];
const distantChallenger = distantTackle.playersById['away-p02'];
distantCarrier.position = { x: 50, y: 34, z: 0 }; distantCarrier.previousPosition = { ...distantCarrier.position };
distantChallenger.position = { x: 48.5, y: 34, z: 0 }; distantChallenger.previousPosition = { ...distantChallenger.position };
distantChallenger.facing = { x: 1, y: 0 }; distantChallenger.rng = { next: () => 0.999 };
distantTackle.ball.ownerId = distantCarrier.id; distantTackle.ball.position = { x: 49.57, y: 34, z: 0.11 };
distantTackle.ball.previousPosition = { ...distantTackle.ball.position }; distantTackle.ball._touchCooldown = 1;
distantChallenger.intent = distantChallenger.motor = { type: 'standingtackle', action: 'standingtackle', desiredSpeed: 0, expiresTick: distantTackle.tick + 1 };
TF.updatePhysics(distantTackle, TF.FIXED_DT);
assert.ok(distantTackle.events.some(e => e.type === 'tackle' && e.success === false),
  'a defender may miss a ball that lies inside challenge reach');
assert.equal(distantTackle.events.filter(e => e.type === 'contact').length, 0,
  'a missed poke from outside player-to-player leg contact reach is not a foul-eligible collision');

const keeperReach = openPhysics(74414), saveKeeper = keeperReach.playersById['away-p01'];
saveKeeper.position = { x: 95, y: 34, z: 0 }; saveKeeper.previousPosition = { ...saveKeeper.position };
saveKeeper.attributes.diving = 90; saveKeeper.attributes.reach = 90; saveKeeper.intent = saveKeeper.motor = { type: 'save', target: { x: 99.2, y: 35.7 }, desiredSpeed: 1, createdTick: keeperReach.tick };
keeperReach.ball._touchCooldown = 0; keeperReach.ball.position = { x: 95, y: 35.7, z: 0.5 }; keeperReach.ball.previousPosition = { ...keeperReach.ball.position };
keeperReach.ball.velocity = { x: 0, y: 0, z: 0 }; keeperReach.ball.lastTouchTeamId = 'home'; keeperReach.ball._lastShotType = 'shot'; keeperReach.ball._lastShotId = 'home-p09';
TF.updatePhysics(keeperReach, TF.FIXED_DT);
assert.equal(keeperReach.events.filter(e => e.type === 'save' || e.type === 'keeper-punch').length, 0,
  'the keeper cannot gain maximum dive reach on the first reaction tick');
for (let tick = 0; tick < 12; tick++) { keeperReach.tick++; keeperReach.clock.elapsedSeconds += TF.FIXED_DT; TF.updatePhysics(keeperReach, TF.FIXED_DT); }
assert.ok(keeperReach.events.some(e => e.type === 'save' || e.type === 'keeper-punch'), 'dive reach grows after a bounded reaction interval');

function keeperDiveMatch(seed, playerId, targetY) {
  const m = openPhysics(seed), gk = m.playersById[playerId], ownX = gk.team.attackDirection > 0 ? 0 : m.pitch.length;
  m.players.forEach((p, index) => { p.intent = p.motor = p.currentAction = null; p.position = { x: 75 + index * 0.2, y: 54 + index * 0.2, z: 0 }; p.previousPosition = { ...p.position }; p.velocity.x = p.velocity.y = 0; });
  gk.position = { x: ownX === 0 ? 0.9 : ownX - 0.9, y: 34, z: 0 }; gk.previousPosition = { ...gk.position };
  gk.facing = { x: ownX === 0 ? 1 : -1, y: 0 }; gk.attributes.diving = 80; gk.attributes.agility = 75; gk.attributes.stamina = 99; gk.stamina = 1;
  gk.intent = gk.motor = gk.currentAction = { type: 'save', action: 'save', target: { x: ownX === 0 ? 0.8 : ownX - 0.8, y: targetY },
    facingTarget: { x: ownX === 0 ? 14 : ownX - 14, y: 34 }, desiredSpeed: 1, createdTick: m.tick, commitUntilTick: m.tick + 36 };
  m.ball.ownerId = null; m.ball._touchCooldown = 1; m.ball.position = { x: 50, y: 34, z: 0.11 }; m.ball.previousPosition = { ...m.ball.position }; m.ball.velocity = { x: 0, y: 0, z: 0 };
  return { match: m, keeper: gk };
}
const keeperDiver = keeperDiveMatch(74424, 'away-p01', 38), walkingKeeper = keeperDiveMatch(74424, 'away-p01', 34);
walkingKeeper.keeper.intent = walkingKeeper.keeper.motor = walkingKeeper.keeper.currentAction = { type: 'hold', target: { x: 104.2, y: 34 }, facingTarget: { x: 90, y: 34 }, desiredSpeed: 0.38 };
for (let tick = 0; tick < 18; tick++) {
  if (tick) for (const item of [keeperDiver, walkingKeeper]) { item.match.tick++; item.match.clock.elapsedSeconds += TF.FIXED_DT; }
  TF.updatePhysics(keeperDiver.match, TF.FIXED_DT); TF.updatePhysics(walkingKeeper.match, TF.FIXED_DT);
}
const diveTravel = keeperDiver.keeper.position.y - 34, walkTravel = walkingKeeper.keeper.position.y - 34;
assert.ok(diveTravel > walkTravel + 0.7 && diveTravel < 1.8,
  'a diving attribute-scaled lateral motor reaches materially farther than walking without teleporting');
assert.ok(keeperDiver.keeper._keeperDiveState && keeperDiver.keeper._keeperDiveState.directionY === 1,
  'the keeper records a directionally committed dive toward the perceived crossing point');

const mirroredDive = keeperDiveMatch(74425, 'home-p01', 30);
for (let tick = 0; tick < 12; tick++) { if (tick) { mirroredDive.match.tick++; mirroredDive.match.clock.elapsedSeconds += TF.FIXED_DT; } TF.updatePhysics(mirroredDive.match, TF.FIXED_DT); }
assert.ok(mirroredDive.keeper.position.y < 34 && mirroredDive.keeper._keeperDiveState.directionY === -1,
  'the physical lateral dive mirrors correctly at the opposite goal');

const commitDive = keeperDiveMatch(74426, 'away-p01', 38), committedStart = commitDive.match.tick;
for (let tick = 0; tick < 4; tick++) { if (tick) { commitDive.match.tick++; commitDive.match.clock.elapsedSeconds += TF.FIXED_DT; } TF.updatePhysics(commitDive.match, TF.FIXED_DT); }
const committedY = commitDive.keeper.position.y, visualStart = commitDive.keeper.visualMotion.tick;
for (let tick = 0; tick < 32; tick++) {
  commitDive.match.tick++; commitDive.match.clock.elapsedSeconds += TF.FIXED_DT;
  commitDive.keeper.intent = commitDive.keeper.motor = commitDive.keeper.currentAction = { type: 'save', action: 'save', target: { x: 104.2, y: 30 }, desiredSpeed: 1, createdTick: committedStart, commitUntilTick: committedStart + 36 };
  TF.updatePhysics(commitDive.match, TF.FIXED_DT);
}
assert.equal(commitDive.keeper._keeperDiveState.startTick, committedStart, 'successive opposite save targets cannot reverse or relaunch a committed dive during recovery');
assert.equal(commitDive.keeper._keeperDiveState.target.y, 38, 'the goalkeeper retains the original perceived crossing point through recovery');
assert.equal(commitDive.keeper.visualMotion.tick, visualStart, 'refreshed save intents do not restart the dive animation');
assert.ok(commitDive.keeper.position.y >= committedY, 'the keeper does not snap back toward a newly reversed target during the landing window');

const checkpointDive = keeperDiveMatch(74427, 'away-p01', 39);
for (let tick = 0; tick < 3; tick++) { if (tick) { checkpointDive.match.tick++; checkpointDive.match.clock.elapsedSeconds += TF.FIXED_DT; } TF.updatePhysics(checkpointDive.match, TF.FIXED_DT); }
const diveCheckpoint = TF.captureCheckpoint(checkpointDive.match), restoredDive = keeperDiveMatch(74427, 'away-p01', 34);
TF.restoreCheckpoint(restoredDive.match, diveCheckpoint);
assert.deepEqual(restoredDive.keeper._keeperDiveState, checkpointDive.keeper._keeperDiveState, 'checkpoint restores the committed dive target and recovery timing');
assert.deepEqual(restoredDive.keeper.position, checkpointDive.keeper.position, 'checkpoint restores the keeper dive body position');
assert.deepEqual(restoredDive.keeper.velocity, checkpointDive.keeper.velocity, 'checkpoint restores the keeper dive momentum');
for (let tick = 0; tick < 5; tick++) {
  checkpointDive.match.tick++; checkpointDive.match.clock.elapsedSeconds += TF.FIXED_DT; restoredDive.match.tick++; restoredDive.match.clock.elapsedSeconds += TF.FIXED_DT;
  TF.updatePhysics(checkpointDive.match, TF.FIXED_DT); TF.updatePhysics(restoredDive.match, TF.FIXED_DT);
  assert.deepEqual(restoredDive.keeper.position, checkpointDive.keeper.position, 'restored dive position matches at continuation tick ' + tick);
  assert.deepEqual(restoredDive.keeper.velocity, checkpointDive.keeper.velocity, 'restored dive momentum matches at continuation tick ' + tick);
  assert.deepEqual(restoredDive.keeper._keeperDiveState, checkpointDive.keeper._keeperDiveState, 'restored dive commitment matches at continuation tick ' + tick);
}

const parryMatch = openPhysics(74415), parryingKeeper = parryMatch.playersById['away-p01'];
parryingKeeper.position = { x: 95, y: 34, z: 0 }; parryingKeeper.previousPosition = { ...parryingKeeper.position };
parryingKeeper.rng = { next: () => 0.999 }; parryingKeeper.intent = parryingKeeper.motor = { type: 'save', target: { x: 99, y: 34 }, desiredSpeed: 1, createdTick: parryMatch.tick - 12 };
parryMatch.ball._touchCooldown = 0; parryMatch.ball.position = { x: 94.5, y: 34, z: 0.5 }; parryMatch.ball.previousPosition = { ...parryMatch.ball.position };
parryMatch.ball.velocity = { x: 12, y: 0, z: 0 }; parryMatch.ball.lastTouchTeamId = 'home'; parryMatch.ball._lastShotType = 'shot'; parryMatch.ball._lastShotId = 'home-p09';
TF.updatePhysics(parryMatch, TF.FIXED_DT);
assert.equal(parryMatch.events.filter(e => (e.type === 'save' || e.type === 'keeper-punch') && e.caught === false).length, 1, 'a failed catch produces one parry contact');
const parryAfterFirstTouch = { x: parryMatch.ball.position.x, y: parryMatch.ball.position.y };
for (let tick = 0; tick < 3; tick++) { parryMatch.tick++; parryMatch.clock.elapsedSeconds += TF.FIXED_DT; TF.updatePhysics(parryMatch, TF.FIXED_DT); }
assert.equal(parryMatch.events.filter(e => e.type === 'keeper-punch' || e.type === 'save').length, 1,
  'one shot cannot create repeated save or parry events on adjacent ticks');
assert.ok(Math.hypot(parryMatch.ball.position.x - parryAfterFirstTouch.x, parryMatch.ball.position.y - parryAfterFirstTouch.y) > 0.02,
  'the parried ball keeps moving through its physical flight between contacts');

const goalSideParry = openPhysics(74420), goalSideKeeper = goalSideParry.playersById['away-p01'];
goalSideKeeper.position = { x: 104.1, y: 34, z: 0 }; goalSideKeeper.previousPosition = { ...goalSideKeeper.position };
goalSideKeeper.facing = { x: -1, y: 0 }; goalSideKeeper.rng = { next: () => 0.999 };
goalSideKeeper.attributes.parrying = 80;
goalSideKeeper.intent = goalSideKeeper.motor = { type: 'save', target: { x: 104.7, y: 34 }, desiredSpeed: 0, createdTick: goalSideParry.tick - 12 };
goalSideParry.ball._touchCooldown = 0; goalSideParry.ball.position = { x: 104.7, y: 34, z: 0.5 }; goalSideParry.ball.previousPosition = { ...goalSideParry.ball.position };
goalSideParry.ball.velocity = { x: 12, y: 0, z: 0 }; goalSideParry.ball.lastTouchTeamId = 'home'; goalSideParry.ball._lastShotType = 'shot'; goalSideParry.ball._lastShotId = 'home-p09';
TF.updatePhysics(goalSideParry, TF.FIXED_DT);
const goalSideParryEvent = goalSideParry.events.find(e => e.type === 'save' && e.caught === false);
assert.ok(goalSideParryEvent, 'a keeper can physically parry a ball that is goal-side of their body but still inside the goal plane');
assert.ok(goalSideParryEvent.outgoingVelocity.x < 0,
  'a fieldward-facing hand redirects an already goal-side shot back toward the field');
assert.ok(Math.hypot(goalSideParryEvent.outgoingVelocity.x, goalSideParryEvent.outgoingVelocity.y) < 12,
  'the parry redirects and dissipates incoming speed instead of adding an arbitrary goalward impulse');
const parryContactX = goalSideParry.ball.position.x;
goalSideParry.tick++; goalSideParry.clock.elapsedSeconds += TF.FIXED_DT;
TF.updatePhysics(goalSideParry, TF.FIXED_DT);
assert.ok(goalSideParry.ball.position.x < parryContactX,
  'the deflected ball continues fieldward under ordinary flight integration');

const poorHandParry = openPhysics(74423), poorlyAlignedKeeper = poorHandParry.playersById['away-p01'];
poorlyAlignedKeeper.position = { x: 104.1, y: 34, z: 0 }; poorlyAlignedKeeper.previousPosition = { ...poorlyAlignedKeeper.position };
poorlyAlignedKeeper.facing = { x: 0, y: 1 }; poorlyAlignedKeeper.rng = { next: () => 0.999 };
poorlyAlignedKeeper.intent = poorlyAlignedKeeper.motor = { type: 'save', target: { x: 104.7, y: 34 }, desiredSpeed: 0, createdTick: poorHandParry.tick - 12 };
poorHandParry.ball._touchCooldown = 0; poorHandParry.ball.position = { x: 104.7, y: 34, z: 0.5 }; poorHandParry.ball.previousPosition = { ...poorHandParry.ball.position };
poorHandParry.ball.velocity = { x: 12, y: 0, z: 0 }; poorHandParry.ball.lastTouchTeamId = 'home'; poorHandParry.ball._lastShotType = 'shot'; poorHandParry.ball._lastShotId = 'home-p09';
TF.updatePhysics(poorHandParry, TF.FIXED_DT);
const poorParry = poorHandParry.events.find(e => e.type === 'save' && e.caught === false);
assert.ok(poorParry && poorParry.outgoingVelocity.x > 0,
  'a badly oriented hand leaves most goalward momentum in a poor parry');
for (let tick = 0; tick < 16 && !poorHandParry.events.some(e => e.type === 'goal'); tick++) {
  poorHandParry.tick++; poorHandParry.clock.elapsedSeconds += TF.FIXED_DT;
  TF.updatePhysics(poorHandParry, TF.FIXED_DT); TF.updateRules(poorHandParry, TF.FIXED_DT);
}
assert.ok(poorHandParry.events.some(e => e.type === 'goal'),
  'an inaccurate parry is not an automatic save and can still let the ball cross the goal plane');

function keeperAtGoalLineCase(seed, centerX) {
  const m = openPhysics(seed), keeper = m.playersById['away-p01'];
  keeper.position = { x: 104.1, y: 34, z: 0 }; keeper.previousPosition = { ...keeper.position }; keeper.facing = { x: -1, y: 0 };
  keeper.rng = { next: () => 0 }; keeper.intent = keeper.motor = { type: 'save', target: { x: centerX, y: 34 }, desiredSpeed: 0, createdTick: m.tick - 12 };
  m.ball._touchCooldown = 0; m.ball.ownerId = null; m.ball.position = { x: centerX, y: 34, z: 0.11 }; m.ball.previousPosition = { ...m.ball.position };
  m.ball.velocity = { x: 0, y: 0, z: 0 }; m.ball.lastTouchTeamId = 'home'; m.ball._lastShotType = 'shot'; m.ball._lastShotId = 'home-p09';
  TF.updatePhysics(m, TF.FIXED_DT);
  return { match: m, keeper };
}
const partlyAcrossGoal = keeperAtGoalLineCase(74421, 105.05);
assert.equal(partlyAcrossGoal.match.ball.ownerId, partlyAcrossGoal.keeper.id,
  'a keeper may handle a ball whose center crossed the line while part of the ball remains on the field');
const whollyAcrossGoal = keeperAtGoalLineCase(74422, 105.12);
assert.notEqual(whollyAcrossGoal.match.ball.ownerId, whollyAcrossGoal.keeper.id,
  'a keeper cannot handle after the whole ball crossed the goal plane');
TF.updateRules(whollyAcrossGoal.match, TF.FIXED_DT);
assert.ok(whollyAcrossGoal.match.events.some(e => e.type === 'goal' || e.type === 'goal-confirmed'),
  'a fully crossed ball is resolved as a goal rather than being caught or saved');

const air = TF.createMatch({ seed: 74500, halfSeconds: 90, matchId: 'air-drag' });
air.state.phase = 'open-play';
air.players.forEach(p => { p.position = { x: 8, y: 8, z: 0 }; p.velocity.x = p.velocity.y = 0; p.intent = p.motor = null; });
air.ball.ownerId = null; air.ball._touchCooldown = 1;
air.ball.position = { x: 50, y: 34, z: 2 }; air.ball.previousPosition = { ...air.ball.position };
air.ball.velocity = { x: 10, y: 0, z: 2 };
TF.updatePhysics(air, TF.FIXED_DT);
assert.ok(air.ball.velocity.x < 10 && air.ball.velocity.x > 9.99, 'airborne horizontal velocity should decay under light air resistance');

process.stdout.write(`execution dispersion passes (mean angular error elite ${mean(elite.map(r => r.angle)).toFixed(3)} rad, novice ${mean(novice.map(r => r.angle)).toFixed(3)} rad; pressure uncertainty ${mean(pressed.map(r => Math.abs(r.angleError))).toFixed(3)})\n`);
