const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');

const TF = globalThis.TF;
const originalContext = TF.getTacticalContext;

function fixture({ seed = 81001, defenderX = 45, carrierX = 47, ballX = 46.2, facing = { x: 1, y: 0 }, recovery = 0, oldChallenge = false } = {}) {
  const match = TF.createMatch({ seed, homeFormation: '4-3-3', awayFormation: '4-3-3' });
  match.state.phase = 'open-play';
  match.tick = 10;
  const home = match.teams.find(team => team.side === 'home');
  const away = match.teams.find(team => team.side === 'away');
  const defender = home.activePlayers.find(player => player.positionFamily === 'DEF' && !player.isGoalkeeper);
  const carrier = away.activePlayers.find(player => !player.isGoalkeeper);
  defender.position.x = defenderX; defender.position.y = 34;
  defender.velocity.x = defender.velocity.y = 0;
  defender.facing = { ...facing };
  defender._challengeRecoveryUntilTick = recovery;
  carrier.position.x = carrierX; carrier.position.y = 34;
  carrier.velocity.x = carrier.velocity.y = 0;
  match.ball.ownerId = carrier.id;
  match.ball.position = { x: ballX, y: 34, z: 0.11 };
  match.ball.velocity = { x: 0, y: 0, z: 0 };
  defender.beliefState = {
    entities: {
      [carrier.id]: {
        id: carrier.id, teamId: carrier.teamId, position: { x: carrierX, y: 34 },
        estimatedPosition: { x: carrierX, y: 34 }, velocity: { x: 0, y: 0 },
        confidence: 0.95, baseConfidence: 0.95, observedTick: match.tick, ageTicks: 0, source: 'vision',
      },
    },
    updatedTick: match.tick, lastScanTick: match.tick, observations: [],
    ball: {
      position: { x: ballX, y: 34, z: 0.11 }, estimatedPosition: { x: ballX, y: 34 },
      velocity: { x: 0, y: 0, z: 0 }, estimatedZ: 0.11, estimatedVelocityZ: 0,
      ownerId: carrier.id, lastTouchTeamId: carrier.teamId,
      confidence: 0.95, baseConfidence: 0.95, observedTick: match.tick, ageTicks: 0,
    },
  };
  defender.ai = { nextDecision: match.tick };
  if (oldChallenge) defender.intent = {
    type: 'challenge', action: 'standingtackle', target: { x: ballX, y: 34 },
    utility: 1, createdTick: 1, expiresTick: 40, commitUntilTick: 40,
  };
  TF.getTacticalContext = function (current, player) {
    if (player.id === defender.id) return {
      anchor: { x: defender.position.x, y: defender.position.y }, intent: 'recover',
      responsibilities: { press: true, pressTargetId: carrier.id, cover: false, screen: false, type: 'press' },
      actionWeights: {},
    };
    return originalContext(current, player);
  };
  return { match, defender, carrier };
}

function decide(state) {
  TF.updateAI(state.match, TF.FIXED_DT);
  return state.defender.ai.candidates || [];
}

// A near-side ball is reachable with an unobstructed foot path.
const near = fixture({ seed: 81002, defenderX: 45.8, carrierX: 47, ballX: 46.3 });
let candidates = decide(near);
const challenge = candidates.find(candidate => candidate.type === 'challenge');
assert.ok(challenge, 'fresh assigned presser did not consider a physically reachable near-side challenge');
assert.equal(challenge.details.physicsAction, 'standingtackle');
assert.equal(near.defender.intent.type, 'challenge', 'eligible contact did not remain a candidate for selection');

// If the ball lies beyond the carrier, the proposed foot line crosses the
// carrier's body; the AI should continue pressing without proposing a tackle.
const farSide = fixture({ seed: 81003, defenderX: 45, carrierX: 45.9, ballX: 46.2 });
candidates = decide(farSide);
assert.ok(candidates.some(candidate => candidate.type === 'press'), 'blocked challenge removed the normal press option');
assert.ok(!candidates.some(candidate => candidate.type === 'challenge'), 'challenge foot path passed through the observed carrier');

const sideOn = fixture({ seed: 81004, defenderX: 45.8, carrierX: 47, ballX: 46.3, facing: { x: 0, y: 1 } });
candidates = decide(sideOn);
assert.ok(candidates.some(candidate => candidate.type === 'press'), 'poorly oriented defender lost the press option');
assert.ok(!candidates.some(candidate => candidate.type === 'challenge'), 'near-perpendicular body orientation offered a standing tackle');

// Physics owns the 24-tick recovery window. During it, old challenge intent
// cannot monopolize the actor, while ordinary press/cover choices remain live.
const recovering = fixture({ seed: 81005, defenderX: 45.8, carrierX: 47, ballX: 46.3, recovery: 20, oldChallenge: true });
candidates = decide(recovering);
assert.ok(candidates.some(candidate => candidate.type === 'press'), 'recovery window displaced the assigned press candidate');
assert.ok(!candidates.some(candidate => candidate.type === 'challenge'), 'AI offered another tackle during physical recovery');
assert.notEqual(recovering.defender.intent.type, 'challenge', 'old challenge commitment survived its physical recovery window');
assert.notEqual(recovering.defender.intent.committed, true, 'recovering tackle retained a stale commitment');

TF.getTacticalContext = originalContext;
process.stdout.write('challenge selection respects physical recovery, facing, and observed foot-path geometry\n');
