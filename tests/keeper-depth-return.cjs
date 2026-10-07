const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');
const TF = globalThis.TF;

function setup({ seed = 94101, side = 'home', threat = true, stale = false, sweep = 50, hiddenIntent = 'carry' } = {}) {
  const match = TF.createMatch({ seed, halfSeconds: 90, matchId: `keeper-depth-${seed}-${side}-${threat}-${stale}-${sweep}` });
  match.state.phase = 'open-play';
  const team = match.teams.find(item => item.side === side);
  const opposingTeam = match.teams.find(item => item.id !== team.id);
  const keeper = team.activePlayers.find(player => player.isGoalkeeper);
  const carrier = opposingTeam.activePlayers.find(player => !player.isGoalkeeper && player.positionFamily === 'FWD');
  const dir = team.attackDirection;
  const ownX = dir > 0 ? 0 : match.pitch.length;
  keeper.position = { x: ownX + dir * 11, y: 34, z: 0 };
  keeper.previousPosition = { ...keeper.position };
  keeper.facing = { x: -dir, y: 0 };
  keeper.velocity.x = keeper.velocity.y = 0;
  keeper.attributes.sweeping = sweep;
  keeper.intent = keeper.motor = keeper.currentAction = {
    type: 'hold', action: 'hold', target: { x: ownX + dir * 12, y: 34 },
    desiredSpeed: 0.38, createdTick: 0, expiresTick: 200,
  };
  keeper.ai = { lastDecision: 0, nextDecision: 1 };
  carrier.position = { x: ownX + dir * 70, y: 9, z: 0 };
  carrier.intent = { type: hiddenIntent, target: { x: ownX + dir * 94, y: 9 } };
  carrier.velocity.x = carrier.velocity.y = 0;
  match.tick = 180;
  match.clock.elapsedSeconds = 3;

  // The opponent and ball stay outside scan range; only this actor-local
  // observation can justify an early goal-side return.
  const carrierAge = stale ? 60 : 1;
  const believedCarrier = { x: ownX + dir * 38, y: 17 };
  keeper.beliefState = {
    entities: {}, lastScanTick: match.tick, updatedTick: match.tick, observations: [],
    ball: {
      position: { x: match.pitch.length / 2, y: match.pitch.width / 2, z: 0.11 },
      estimatedPosition: { x: match.pitch.length / 2, y: match.pitch.width / 2 },
      velocity: { x: 0, y: 0, z: 0 }, estimatedZ: 0.11, estimatedVelocityZ: 0,
      ownerId: threat ? carrier.id : null, lastTouchPlayerId: threat ? carrier.id : null,
      lastTouchTeamId: threat ? opposingTeam.id : null,
      baseConfidence: 0.96, confidence: 0.96, observedTick: match.tick, ageTicks: 0,
    },
  };
  if (threat) keeper.beliefState.entities[carrier.id] = {
    id: carrier.id, teamId: opposingTeam.id, role: carrier.role, positionFamily: carrier.positionFamily,
    position: believedCarrier, estimatedPosition: believedCarrier, velocity: { x: 0, y: 0 }, facing: { x: -dir, y: 0 },
    baseConfidence: 0.96, confidence: 0.96, observedTick: match.tick - carrierAge, ageTicks: carrierAge,
  };

  match.ball.ownerId = null;
  match.ball.position = { x: match.pitch.length / 2, y: match.pitch.width / 2, z: 0.11 };
  match.ball.previousPosition = { ...match.ball.position };
  match.ball.velocity = { x: 0, y: 0, z: 0 };
  match.ball.lastTouchTeamId = null;
  return { match, team, opposingTeam, keeper, carrier, dir, ownX };
}
function decide(state) {
  TF.updateAI(state.match, TF.FIXED_DT);
  return state.keeper.intent;
}

for (const side of ['home', 'away']) {
  const threat = setup({ seed: side === 'home' ? 94101 : 94102, side });
  const intent = decide(threat);
  assert.equal(intent.type, 'hold', `${side} keeper abandoned goal-side cover for a threat still 38m out`);
  assert.ok(Math.abs(intent.target.x - threat.ownX) <= 6.2, `${side} keeper did not begin an early bounded return`);
  assert.equal(intent.details.returningForCarrierThreat, true, `${side} return decision lost its observed-threat basis`);

  const ordinary = setup({ seed: side === 'home' ? 94103 : 94104, side, threat: false });
  const ordinaryIntent = decide(ordinary);
  assert.equal(ordinaryIntent.type, 'hold');
  assert.ok(Math.abs(ordinaryIntent.target.x - ordinary.ownX) > Math.abs(intent.target.x - threat.ownX) + 1,
    `${side} no-threat goalkeeper lost its normal sweeper starting depth`);

  const stale = setup({ seed: side === 'home' ? 94105 : 94106, side, stale: true });
  const staleIntent = decide(stale);
  assert.equal(staleIntent.details.returningForCarrierThreat, false, `${side} keeper used stale remembered carrier as current pressure`);
  assert.ok(Math.abs(staleIntent.target.x - stale.ownX) > 6.2, `${side} stale threat caused an unsupported goal-line retreat`);
}

const cautious = setup({ seed: 94107, side: 'home', sweep: 10 });
const sweeper = setup({ seed: 94107, side: 'home', sweep: 90 });
const cautiousDepth = Math.abs(decide(cautious).target.x - cautious.ownX);
const sweeperDepth = Math.abs(decide(sweeper).target.x - sweeper.ownX);
assert.ok(sweeperDepth > cautiousDepth + 1, 'fresh-threat return removed the sweeper depth advantage');

const unseenPass = setup({ seed: 94108, side: 'home', hiddenIntent: 'pass' });
const unseenShoot = setup({ seed: 94108, side: 'home', hiddenIntent: 'shoot' });
assert.deepEqual(decide(unseenPass).target, decide(unseenShoot).target,
  'keeper response depended on an unseen opponent private action');

const continuous = setup({ seed: 94109, side: 'away' });
decide(continuous);
const saved = TF.captureCheckpoint(continuous.match);
const restored = setup({ seed: 94109, side: 'away' });
TF.restoreCheckpoint(restored.match, saved);
continuous.match.tick += 8; restored.match.tick += 8;
continuous.match.clock.elapsedSeconds += 8 * TF.FIXED_DT;
restored.match.clock.elapsedSeconds += 8 * TF.FIXED_DT;
TF.updateAI(continuous.match, TF.FIXED_DT);
TF.updateAI(restored.match, TF.FIXED_DT);
assert.deepEqual(restored.keeper.intent, continuous.keeper.intent, 'keeper return decision diverged after checkpoint restore');

const recovering = setup({ seed: 94110, side: 'home' });
recovering.keeper.intent = recovering.keeper.motor = recovering.keeper.currentAction = {
  type: 'intercept', action: 'intercept', target: { x: 26, y: 17 }, desiredSpeed: 1,
  createdTick: recovering.match.tick - 2, commitUntilTick: recovering.match.tick + 24,
  expiresTick: recovering.match.tick + 24, utility: 1.1,
};
const recoveryIntent = decide(recovering);
assert.equal(recoveryIntent.type, 'hold', 'old sweep commitment prevented return under a fresh nearby carrier threat');
assert.equal(recoveryIntent.committed, false, 'keeper incorrectly preserved an unsafe sweep commitment');

for (const side of ['home', 'away']) {
  const race = setup({ seed: side === 'home' ? 94111 : 94112, side, threat: false, sweep: 90 });
  race.keeper.position.x = race.ownX + race.dir * 12;
  race.keeper.facing = { x: -race.dir, y: 0 };
  const racePoint = { x: race.ownX + race.dir * 15, y: 34 };
  const knownRivalPoint = { x: race.ownX + race.dir * 14.8, y: 34 };
  race.keeper.beliefState.ball.position = { x: racePoint.x, y: racePoint.y, z: 0.12 };
  race.keeper.beliefState.ball.estimatedPosition = racePoint;
  race.keeper.beliefState.ball.velocity = { x: -race.dir * 2.5, y: 0, z: 0 };
  race.keeper.beliefState.ball.ownerId = null;
  race.keeper.beliefState.ball.lastTouchTeamId = race.opposingTeam.id;
  race.keeper.beliefState.entities[race.carrier.id] = {
    id: race.carrier.id, teamId: race.opposingTeam.id, positionFamily: 'FWD',
    position: knownRivalPoint, estimatedPosition: knownRivalPoint, velocity: { x: 0, y: 0 }, facing: { x: -race.dir, y: 0 },
    baseConfidence: 0.96, confidence: 0.96, observedTick: race.match.tick, ageTicks: 0,
  };
  race.keeper.intent = race.keeper.motor = race.keeper.currentAction = {
    type: 'intercept', action: 'intercept', target: { x: racePoint.x, y: racePoint.y }, desiredSpeed: 1,
    createdTick: race.match.tick - 2, commitUntilTick: race.match.tick + 24,
    expiresTick: race.match.tick + 24, utility: 1.1,
  };
  const raceIntent = decide(race);
  assert.equal(raceIntent.type, 'hold', `${side} sweeper chased an outlet race a fresh opponent could win`);
  assert.equal(raceIntent.details.opponentWinsSweep, true, `${side} keeper did not explain the observed opponent's earlier arrival`);
  assert.equal(raceIntent.committed, false, `${side} keeper did not break its losing sweep commitment`);
  assert.ok(Math.abs(raceIntent.target.x - race.ownX) < 6.2, `${side} keeper stayed too far upfield after losing the race`);
}

process.stdout.write('keeper return depth uses fresh local threat beliefs, preserves sweeper range, and interrupts losing sweeps\n');
