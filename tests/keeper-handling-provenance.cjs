const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');
require('../src/physics.js');
require('../src/rules.js');
const TF = globalThis.TF;

function setup(seed) {
  const match = TF.createMatch({ seed, halfSeconds: 90 });
  match.state.phase = 'open-play';
  const home = match.teams.find(t => t.side === 'home');
  const away = match.teams.find(t => t !== home);
  for (const [index, p] of match.players.entries()) {
    p.position = { x: p.teamId === home.id ? 26 + index * 0.34 : 76 + index * 0.34, y: 5 + index % 10 * 5.4 };
    p.previousPosition = { ...p.position };
    p.velocity.x = p.velocity.y = 0;
    p.motor = p.intent = p.currentAction = null;
  }
  const passer = home.activePlayers[5];
  const keeper = home.activePlayers.find(p => p.isGoalkeeper);
  const otherKeeper = away.activePlayers.find(p => p.isGoalkeeper);
  passer.position = { x: 15, y: 34 }; passer.previousPosition = { ...passer.position };
  passer.facing = { x: -1, y: 0 }; passer.rng = { next: () => 0.5 };
  keeper.position = { x: 6, y: 34 }; keeper.previousPosition = { ...keeper.position };
  keeper.facing = { x: 1, y: 0 }; keeper.rng = { next: () => 0 };
  otherKeeper.position = { x: 100, y: 8 }; otherKeeper.previousPosition = { ...otherKeeper.position };
  return { match, home, away, passer, keeper, otherKeeper };
}
function launchPass(f, targetId) {
  const { match, passer, keeper } = f;
  match.ball.position = { x: 14.55, y: 34, z: 0.11 };
  match.ball.previousPosition = { ...match.ball.position };
  match.ball.velocity.x = match.ball.velocity.y = match.ball.velocity.z = 0;
  match.ball.ownerId = passer.id; match.ball.controlState = 'controlled'; match.ball.handControl = false;
  passer.motor = passer.intent = passer.currentAction = {
    type: 'pass', target: { x: keeper.position.x, y: keeper.position.y },
    ballTarget: { x: keeper.position.x, y: keeper.position.y }, targetId, power: 0.7, desiredSpeed: 0
  };
  TF.updatePhysics(match, TF.FIXED_DT);
  assert.ok(match.events.some(e => e.type === 'pass' && e.playerId === passer.id), 'fixture must use a real foot-strike motor');
}
function continueToKeeperCatch(f) {
  const { match, keeper } = f;
  for (let i = 0; i < 120 && !match.events.some(e => e.type === 'keeper-collection' && e.keeperId === keeper.id); i += 1) {
    match.tick += 1; match.clock.elapsedSeconds += TF.FIXED_DT;
    TF.updatePhysics(match, TF.FIXED_DT);
    TF.updateRules(match, TF.FIXED_DT);
  }
  assert.ok(match.events.some(e => e.type === 'keeper-collection' && e.keeperId === keeper.id), 'keeper physically collects the incoming ball');
  TF.updateRules(match, TF.FIXED_DT);
}
function continueWithKeeperAIToFootControl(f) {
  const { match, keeper } = f;
  for (let i = 0; i < 120 && !match.events.some(e => e.type === 'ball-control' && e.playerId === keeper.id); i += 1) {
    match.tick += 1; match.clock.elapsedSeconds += TF.FIXED_DT;
    for (const actor of match.players) if (actor.id !== keeper.id) {
      actor.ai = actor.ai || {}; actor.ai.nextDecision = 1000000000;
      const stay = { type: 'hold', target: { ...actor.position }, desiredSpeed: 0 };
      actor.motor = actor.intent = actor.currentAction = stay;
    }
    TF.updateAI(match, TF.FIXED_DT);
    TF.updatePhysics(match, TF.FIXED_DT);
    TF.updateRules(match, TF.FIXED_DT);
  }
  assert.ok(match.events.some(e => e.type === 'ball-control' && e.playerId === keeper.id),
    'normal goalkeeper AI and the ordinary motor/physics path reach a foot control; ' + JSON.stringify({
      ball: { position: match.ball.position, velocity: match.ball.velocity, ownerId: match.ball.ownerId, restriction: match.ball._keeperHandlingRestriction },
      keeper: { id: keeper.id, position: keeper.position },
      eventPlayers: match.events.slice(-8).map(e => ({ type: e.type, playerId: e.playerId, keeperId: e.keeperId })),
      events: match.events.slice(-8).map(e => ({ type: e.type, tick: e.tick, playerId: e.playerId, keeperId: e.keeperId }))
    }));
  assert.equal(match.ball.ownerId, keeper.id);
  assert.equal(match.ball.handControl, false, 'a restricted ball is received with the feet');
}
function makeHeader(seed) {
  const f = setup(seed), { match, passer, keeper } = f;
  passer.rng = { next: () => 0.5 };
  keeper.position = { x: 12, y: 34 }; keeper.previousPosition = { ...keeper.position };
  match.ball.position = { x: 14.55, y: 34, z: 1.4 }; match.ball.previousPosition = { ...match.ball.position };
  match.ball.velocity.x = match.ball.velocity.y = match.ball.velocity.z = 0;
  match.ball.ownerId = null; match.ball.controlState = 'flight';
  passer.motor = passer.intent = passer.currentAction = {
    type: 'header', target: { x: keeper.position.x, y: 34 }, ballTarget: { x: keeper.position.x, y: 34 }, targetId: keeper.id, desiredSpeed: 0
  };
  TF.updatePhysics(match, TF.FIXED_DT);
  assert.ok(match.events.some(e => e.type === 'header' && e.playerId === passer.id), 'fixture must use a real aerial header strike');
  assert.equal(match.ball.lastTouchAction, 'header');
  assert.equal(match.ball._keeperHandlingRestriction, null, 'a header does not create a deliberate-foot restriction');
  for (let i = 0; i < 120 && !match.events.some(e => e.type === 'keeper-collection' && e.keeperId === keeper.id); i += 1) {
    match.tick += 1; match.clock.elapsedSeconds += TF.FIXED_DT;
    TF.updatePhysics(match, TF.FIXED_DT); TF.updateRules(match, TF.FIXED_DT);
  }
  assert.ok(match.events.some(e => e.type === 'keeper-collection' && e.keeperId === keeper.id), 'keeper physically catches the headed ball');
  TF.updateRules(match, TF.FIXED_DT);
  assert.equal(match.events.some(e => e.type === 'goalkeeper-backpass-handball'), false,
    'a legal teammate header remains hand-handleable');
  return f;
}

// A deliberate teammate foot pass addressed to the keeper creates a physical
// restriction and is whistled only when that keeper actually handles it.
const backpass = setup(93001);
launchPass(backpass, backpass.keeper.id);
assert.deepEqual(backpass.match.ball._keeperHandlingRestriction, {
  teamId: backpass.home.id, keeperId: backpass.keeper.id, sourcePlayerId: backpass.passer.id,
  action: 'pass', targetId: backpass.keeper.id
});
// The keeper sees the release action/aim only while the passer and visual cue
// are locally observable; the belief never contains the hidden target ID.
const passCheckpoint = TF.captureCheckpoint(backpass.match);
const restored = TF.createMatch({ seed: 93001, halfSeconds: 90 });
TF.restoreCheckpoint(restored, passCheckpoint);
assert.deepEqual(restored.ball._keeperHandlingRestriction, backpass.match.ball._keeperHandlingRestriction,
  'the authored handling restriction survives checkpoint restore');
continueWithKeeperAIToFootControl(backpass);
assert.equal(backpass.match.events.some(e => e.type === 'keeper-collection' && e.keeperId === backpass.keeper.id), false,
  'a known foot backpass does not get an automatic keeper hand collection');
assert.equal(backpass.match.events.some(e => e.type === 'goalkeeper-backpass-handball'), false,
  'normal AI foot control is not penalized as hand handling');
assert.deepEqual(backpass.match.ball._keeperHandlingRestriction, {
  teamId: backpass.home.id, keeperId: backpass.keeper.id, sourcePlayerId: backpass.passer.id,
  action: 'pass', targetId: backpass.keeper.id
}, 'the handling restriction persists through a legal foot response');
// A subsequent legal foot pass remains executable and does not erase the
// handling restriction before another player actually touches the ball.
backpass.match.tick += 1; backpass.match.clock.elapsedSeconds += TF.FIXED_DT;
backpass.keeper.motor = backpass.keeper.intent = backpass.keeper.currentAction = {
  type: 'pass', target: { x: 25, y: 34 }, ballTarget: { x: 25, y: 34 },
  targetId: backpass.home.activePlayers[8].id, desiredSpeed: 0
};
TF.updatePhysics(backpass.match, TF.FIXED_DT);
assert.ok(backpass.match.events.some(e => e.tick === backpass.match.tick && e.type === 'pass' && e.playerId === backpass.keeper.id),
  'a legal keeper foot pass remains available after normal AI foot reception');
assert.equal(backpass.match.ball._keeperHandlingRestriction.keeperId, backpass.keeper.id,
  'the restriction survives the keeper foot pass until another player touches');
assert.equal(backpass.match.events.some(e => e.type === 'goalkeeper-backpass-handball'), false);
backpass.match.ball.ownerId = backpass.keeper.id; backpass.match.ball.handControl = true;
backpass.match.ball.controlState = 'keeper-held'; backpass.match.ball._keeperHandlingPlayerId = backpass.keeper.id;
backpass.match.ball._handStarted = backpass.match.clock.elapsedSeconds;
TF.updateRules(backpass.match, TF.FIXED_DT);
assert.ok(backpass.match.events.some(e => e.type === 'goalkeeper-backpass-handball'),
  'an explicit illegal hand-control state on the authored foot-backpass still produces the IFK');

// A foot pass addressed to another teammate remains legal to catch even when
// the goalkeeper physically intercepts the flight.
const otherRecipient = setup(93002), teammate = otherRecipient.home.activePlayers[8];
launchPass(otherRecipient, teammate.id);
assert.equal(otherRecipient.match.ball._keeperHandlingRestriction, null);
continueToKeeperCatch(otherRecipient);
assert.equal(otherRecipient.match.events.some(e => e.type === 'goalkeeper-backpass-handball'), false);

// Physical header to a keeper is not mislabeled as a foot backpass.
makeHeader(93003);

// Direct teammate throw-in is restricted after the real throw enters the pitch.
const thrown = setup(93004), { match: throwMatch, home, keeper } = thrown;
TF.rulesLab.configure(throwMatch, { autoRestartSeconds: 0 });
TF.rulesLab.awardRestart(throwMatch, 'throw-in', home.id, { x: 2, y: 68 });
TF.updateRules(throwMatch, TF.FIXED_DT);
const ready = throwMatch.state.restartInProgress, taker = throwMatch.playersById[ready.takerId];
keeper.position = { x: 2, y: 36 }; keeper.previousPosition = { ...keeper.position }; keeper.rng = { next: () => 0 };
taker.facing = { x: 0, y: -1 }; taker.rng = { next: () => 0.5 };
taker.motor = taker.intent = taker.currentAction = {
  type: 'throw', action: 'throw', target: { x: 2, y: 34 }, ballTarget: { x: 2, y: 34 },
  power: 1, lift: 0.9, desiredSpeed: 0, createdTick: throwMatch.tick
};
for (let i = 0; i < 180 && !throwMatch.events.some(e => e.type === 'restart-taken' && e.restartType === 'throw-in'); i += 1) {
  throwMatch.tick += 1; throwMatch.clock.elapsedSeconds += TF.FIXED_DT;
  TF.updatePhysics(throwMatch, TF.FIXED_DT); TF.updateRules(throwMatch, TF.FIXED_DT);
}
assert.ok(throwMatch.events.some(e => e.type === 'restart-taken' && e.restartType === 'throw-in'));
continueWithKeeperAIToFootControl(thrown);
assert.equal(throwMatch.events.some(e => e.type === 'keeper-collection' && e.keeperId === keeper.id), false,
  'keeper handles a direct teammate throw-in with the feet rather than hands');
assert.equal(throwMatch.events.some(e => e.type === 'goalkeeper-backpass-handball'), false,
  'the normal physical foot response does not incur a handball whistle');
assert.equal(throwMatch.ball.handControl, false);
assert.equal(throwMatch.ball._keeperHandlingRestriction.action, 'throw-in',
  'direct throw-in hand restriction persists during the legal foot response');
throwMatch.ball.ownerId = keeper.id; throwMatch.ball.handControl = true;
throwMatch.ball.controlState = 'keeper-held'; throwMatch.ball._keeperHandlingPlayerId = keeper.id;
throwMatch.ball._handStarted = throwMatch.clock.elapsedSeconds;
TF.updateRules(throwMatch, TF.FIXED_DT);
assert.ok(throwMatch.events.some(e => e.type === 'goalkeeper-backpass-handball'),
  'an explicit illegal hand-control state on a direct teammate throw-in still produces the IFK');

// A keeper's own actual foot release preserves the existing second-handling rule.
const self = setup(93005), gk = self.keeper, m = self.match;
m.ball.position = { x: 6.45, y: 34, z: 0.68 }; m.ball.previousPosition = { ...m.ball.position };
m.ball.ownerId = gk.id; m.ball.handControl = true; m.ball.controlState = 'keeper-held';
gk.motor = gk.intent = gk.currentAction = { type: 'pass', target: { x: 22, y: 34 }, ballTarget: { x: 22, y: 34 }, targetId: self.home.activePlayers[7].id, desiredSpeed: 0 };
TF.updatePhysics(m, TF.FIXED_DT);
assert.equal(m.ball._keeperHandlingRestriction.sourcePlayerId, gk.id);
m.ball.ownerId = gk.id; m.ball.handControl = true; m.ball._handStarted = m.clock.elapsedSeconds; m.ball._keeperHandlingPlayerId = gk.id;
// A real keeper foot strike after hand release cannot clear the restriction;
// it remains until a different player makes physical contact.
m.ball.position = { x: 6.45, y: 34, z: 0.11 }; m.ball.previousPosition = { ...m.ball.position };
m.ball.handControl = false; m.ball.controlState = 'controlled';
gk.motor = gk.intent = gk.currentAction = { type: 'pass', target: { x: 22, y: 34 }, ballTarget: { x: 22, y: 34 }, targetId: self.home.activePlayers[7].id, desiredSpeed: 0 };
TF.updatePhysics(m, TF.FIXED_DT);
assert.deepEqual(m.ball._keeperHandlingRestriction, { teamId: self.home.id, keeperId: gk.id, sourcePlayerId: gk.id,
  action: 'pass', targetId: self.home.activePlayers[7].id }, 'keeper foot play does not clear a self-handling restriction');
m.ball.ownerId = gk.id; m.ball.handControl = true; m.ball._handStarted = m.clock.elapsedSeconds; m.ball._keeperHandlingPlayerId = gk.id;
TF.updateRules(m, TF.FIXED_DT);
assert.ok(m.events.some(e => e.type === 'goalkeeper-second-handling'));

// An ordinary keeper foot distribution that began with foot control is not a
// hand-held release and must not create a self-handling restriction.
const footKeeper = setup(93008), footGK = footKeeper.keeper, footMatch = footKeeper.match;
footMatch.ball.position = { x: 6.45, y: 34, z: 0.11 }; footMatch.ball.previousPosition = { ...footMatch.ball.position };
footMatch.ball.ownerId = footGK.id; footMatch.ball.handControl = false; footMatch.ball.controlState = 'controlled';
footGK.facing = { x: 1, y: 0 };
footGK.motor = footGK.intent = footGK.currentAction = { type: 'pass', target: { x: 22, y: 34 }, ballTarget: { x: 22, y: 34 }, targetId: footKeeper.home.activePlayers[7].id, desiredSpeed: 0 };
TF.updatePhysics(footMatch, TF.FIXED_DT);
assert.ok(footMatch.events.some(e => e.type === 'pass' && e.playerId === footGK.id));
assert.equal(footMatch.ball._keeperHandlingRestriction, null,
  'a keeper foot distribution does not start the hand-release second-handling restriction');

// Hidden ball metadata never teaches an unobserved action/aim. Expired visual
// release cues also cannot be reacquired as fresh private recipient data.
const visible = setup(93006);
launchPass(visible, visible.keeper.id);
visible.keeper.facing = { x: 1, y: 0 };
TF.updateAI(visible.match, TF.FIXED_DT);
assert.equal(visible.keeper.beliefState.ball.lastTouchAction, 'pass');
assert.ok(visible.keeper.beliefState.ball.lastTouchTarget);
assert.equal('lastTouchTargetId' in visible.keeper.beliefState.ball, false);
const hidden = setup(93006), hiddenPasser = hidden.passer, hiddenKeeper = hidden.keeper;
launchPass(hidden, hidden.keeper.id);
hiddenPasser.position = { x: 70, y: 4 }; hiddenPasser.previousPosition = { ...hiddenPasser.position };
hiddenKeeper.facing = { x: 1, y: 0 };
TF.updateAI(hidden.match, TF.FIXED_DT);
assert.equal(hiddenKeeper.beliefState.ball.lastTouchPlayerId, null);
assert.equal(hiddenKeeper.beliefState.ball.lastTouchAction, null);
assert.equal(hiddenKeeper.beliefState.ball.lastTouchTarget, null);
const hiddenBelief = { action: hiddenKeeper.beliefState.ball.lastTouchAction,
  target: hiddenKeeper.beliefState.ball.lastTouchTarget,
  toucher: hiddenKeeper.beliefState.ball.lastTouchPlayerId };
hidden.match.ball.lastTouchAction = 'throw-in';
hidden.match.ball.lastTouchTargetId = hiddenKeeper.id;
hidden.match.ball.lastTouchTarget = { x: hiddenKeeper.position.x, y: hiddenKeeper.position.y };
hidden.match.ball._keeperHandlingRestriction = { teamId: hidden.home.id, keeperId: hiddenKeeper.id,
  sourcePlayerId: hidden.passer.id, action: 'throw-in', targetId: hiddenKeeper.id };
TF.updateAI(hidden.match, TF.FIXED_DT);
assert.deepEqual({ action: hiddenKeeper.beliefState.ball.lastTouchAction,
  target: hiddenKeeper.beliefState.ball.lastTouchTarget,
  toucher: hiddenKeeper.beliefState.ball.lastTouchPlayerId }, hiddenBelief,
  'changing hidden action, recipient and restriction metadata does not change the keeper local cue');
const expired = setup(93007), expiredTick = expired.match.tick;
launchPass(expired, expired.keeper.id);
expired.match.tick = expiredTick + 20;
expired.match.ball.lastTouchTick = expiredTick;
expired.keeper.facing = { x: 1, y: 0 };
TF.updateAI(expired.match, TF.FIXED_DT);
assert.equal(expired.keeper.beliefState.ball.lastTouchAction, null,
  'an expired visual kick animation is not reacquired as a fresh action cue');

process.stdout.write('keeper handling follows physical foot/header/throw provenance; observed cues remain local and checkpointed\n');
