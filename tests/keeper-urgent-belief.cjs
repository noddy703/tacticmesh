const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');
const TF = globalThis.TF;

function setup(seed, side, goalward) {
  const match = TF.createMatch({ seed, halfSeconds: 90, matchId: `urgent-keeper-${seed}-${side}-${goalward}` });
  match.state.phase = 'open-play';
  match.tick = 600;
  match.clock.elapsedSeconds = 10;
  const team = match.teams.find(item => item.side === side);
  const keeper = team.activePlayers.find(player => player.isGoalkeeper);
  const dir = team.attackDirection;
  const ownX = dir > 0 ? 0 : match.pitch.length;
  const opponentTeam = match.teams.find(item => item.id !== team.id);
  keeper.position = { x: ownX + dir * 6, y: 34, z: 0 };
  keeper.previousPosition = { ...keeper.position };
  keeper.facing = { x: -dir, y: 0 };
  keeper.velocity.x = keeper.velocity.y = 0;
  keeper.intent = keeper.motor = keeper.currentAction = {
    type: 'hold', action: 'hold', target: { x: ownX + dir * 3, y: 34 },
    desiredSpeed: 0.7, createdTick: match.tick - 10, expiresTick: match.tick + 30
  };
  keeper.ai = keeper.ai || {};
  keeper.ai.lastDecision = match.tick - 1;
  keeper.ai.nextDecision = match.tick + 8;
  keeper.beliefState = {
    entities: {}, observations: [], lastScanTick: match.tick,
    ball: {
      position: { x: ownX + dir * 4, y: 34, z: 0.11 },
      estimatedPosition: { x: ownX + dir * 4, y: 34 },
      velocity: { x: goalward ? -dir * 12 : dir * 12, y: 0, z: 0 },
      ownerId: null, lastTouchPlayerId: null, lastTouchTeamId: opponentTeam.id,
      baseConfidence: 0.96, confidence: 0.96, observedTick: match.tick,
      ageTicks: 0, source: 'test-local-observation'
    }
  };

  // Keep the real ball outside this keeper's perception range. The reaction
  // below must come from the explicit local belief above, not world velocity.
  match.ball.ownerId = null;
  match.ball.position = { x: match.pitch.length / 2, y: match.pitch.width - 1, z: 0.11 };
  match.ball.previousPosition = { ...match.ball.position };
  match.ball.velocity = { x: 0, y: 0, z: 0 };
  match.ball.lastTouchTeamId = null;
  return { match, team, keeper, dir, ownX };
}

function advanceOne(match) {
  match.tick++;
  match.clock.elapsedSeconds += TF.FIXED_DT;
  TF.updateAI(match, TF.FIXED_DT);
}

for (const side of ['home', 'away']) {
  const threat = setup(side === 'home' ? 81021 : 81022, side, true);
  const lastBefore = threat.keeper.ai.lastDecision;
  for (let tick = 0; tick < 3 && threat.keeper.ai.lastDecision === lastBefore; tick++) advanceOne(threat.match);
  assert.ok(threat.keeper.ai.lastDecision > lastBefore,
    `${side} keeper reacts within three ticks to a fresh believed own-goalward crossing`);
  assert.equal(threat.keeper.ai.selected.type, 'save',
    `${side} keeper selects save from its belief-only goal-line crossing`);
  assert.ok(threat.keeper.motor.target.x >= 0 && threat.keeper.motor.target.x <= threat.match.pitch.length,
    `${side} keeper save target remains inside the pitch`);

  const away = setup(side === 'home' ? 81023 : 81024, side, false);
  const awayLast = away.keeper.ai.lastDecision;
  for (let tick = 0; tick < 3; tick++) advanceOne(away.match);
  assert.equal(away.keeper.ai.lastDecision, awayLast,
    `${side} keeper does not urgently react to fresh flight moving away from its own goal`);
}

// Slow ownerless balls still get a save intent when the local physical
// projection crosses the goal within the existing 1.8s horizon. A speed floor
// must not suppress this case after friction has reduced a still-goalward ball.
function setLocalSlowFlight(fixture, { distance, speed, goalward = true, ageTicks = 0 }) {
  const { keeper, ownX, dir, match } = fixture;
  const belief = keeper.beliefState.ball;
  const point = { x: ownX + dir * distance, y: 34, z: 0.11 };
  const velocity = { x: (goalward ? -dir : dir) * speed, y: 0, z: 0 };
  belief.position = { ...point };
  belief.estimatedPosition = { x: point.x, y: point.y };
  belief.velocity = velocity;
  belief.ownerId = null;
  belief.confidence = 0.96;
  belief.ageTicks = ageTicks;
  belief.observedTick = match.tick - ageTicks;
}
function runSlowFlight(side, options, seed) {
  const fixture = setup(seed, side, true);
  setLocalSlowFlight(fixture, options);
  fixture.keeper.ai.nextDecision = fixture.match.tick + 1;
  const before = fixture.keeper.ai.lastDecision;
  for (let tick = 0; tick < 2 && fixture.keeper.ai.lastDecision === before; tick++) advanceOne(fixture.match);
  return fixture;
}
for (const side of ['home', 'away']) {
  const slowCrossing = runSlowFlight(side, { distance: 0.75, speed: 0.8 }, side === 'home' ? 81025 : 81026);
  assert.equal(slowCrossing.keeper.intent.type, 'save',
    `${side} keeper ignored a fresh slow goalward ball whose local 1.8s projection crosses the goal`);

  const slowMovingAway = runSlowFlight(side, { distance: 0.75, speed: 0.8, goalward: false }, side === 'home' ? 81027 : 81028);
  assert.notEqual(slowMovingAway.keeper.intent.type, 'save',
    `${side} keeper saved against a fresh slow ball moving away from its own goal`);

  const stoppingShort = runSlowFlight(side, { distance: 2, speed: 0.8 }, side === 'home' ? 81029 : 81030);
  assert.notEqual(stoppingShort.keeper.intent.type, 'save',
    `${side} keeper treated a slow ball that stops short of the goal as a save threat`);

  const distant = runSlowFlight(side, { distance: 6, speed: 3 }, side === 'home' ? 81033 : 81034);
  assert.notEqual(distant.keeper.intent.type, 'save',
    `${side} keeper treated a fresh ball outside the 1.8s crossing forecast as an immediate save threat`);

  const stale = runSlowFlight(side, { distance: 0.75, speed: 0.8, ageTicks: 50 }, side === 'home' ? 81031 : 81032);
  assert.notEqual(stale.keeper.intent.type, 'save',
    `${side} keeper reacted to stale slow-flight memory as an immediate save threat`);

  const teammateCarry = setup(side === 'home' ? 81035 : 81036, side, true);
  setLocalSlowFlight(teammateCarry, { distance: 0.75, speed: 0.8 });
  const teammate = teammateCarry.team.activePlayers.find((player) => !player.isGoalkeeper);
  const carriedPoint = { x: teammateCarry.ownX + teammateCarry.dir * 0.75, y: 34 };
  teammateCarry.keeper.beliefState.ball.ownerId = teammate.id;
  teammateCarry.keeper.beliefState.ball.lastTouchTeamId = teammate.teamId;
  teammateCarry.keeper.beliefState.entities[teammate.id] = {
    id: teammate.id, teamId: teammate.teamId, position: carriedPoint, estimatedPosition: carriedPoint,
    velocity: { x: -teammateCarry.dir * 0.8, y: 0 }, facing: { x: -teammateCarry.dir, y: 0 },
    confidence: 0.96, ageTicks: 0, observedTick: teammateCarry.match.tick,
  };
  teammateCarry.keeper.ai.nextDecision = teammateCarry.match.tick + 1;
  const teammateBefore = teammateCarry.keeper.ai.lastDecision;
  for (let tick = 0; tick < 3 && teammateCarry.keeper.ai.lastDecision === teammateBefore; tick++) advanceOne(teammateCarry.match);
  assert.notEqual(teammateCarry.keeper.intent.type, 'save',
    `${side} keeper treated a fresh teammate-controlled backpass as a released shot`);

  const footBackpass = setup(side === 'home' ? 81037 : 81038, side, true);
  const passer = footBackpass.team.activePlayers.find((player) => !player.isGoalkeeper);
  const backpassPoint = { x: footBackpass.ownX + footBackpass.dir * 6.5, y: 34, z: 0.11 };
  passer.position = { x: footBackpass.ownX + footBackpass.dir * 14, y: 34, z: 0 };
  passer.previousPosition = { ...passer.position };
  footBackpass.match.ball.position = { ...backpassPoint };
  footBackpass.match.ball.previousPosition = { ...backpassPoint };
  footBackpass.match.ball.velocity = { x: -footBackpass.dir * 0.8, y: 0, z: 0 };
  footBackpass.match.ball.ownerId = null;
  footBackpass.match.ball.lastTouchPlayerId = passer.id;
  footBackpass.match.ball.lastTouchTeamId = passer.teamId;
  footBackpass.match.ball.lastTouchKind = 'deliberate';
  footBackpass.match.ball.lastTouchTick = footBackpass.match.tick;
  footBackpass.match.ball.lastTouchAction = 'pass'; // private physical metadata is not itself a local cue
  footBackpass.match.ball.lastTouchTargetId = footBackpass.keeper.id;
  passer.visualMotion = { type: 'pass', action: 'pass', tick: footBackpass.match.tick, target: { x: footBackpass.keeper.position.x, y: footBackpass.keeper.position.y } };
  footBackpass.keeper.beliefState.ball = null;
  footBackpass.keeper.facing = { x: footBackpass.dir, y: 0 };
  footBackpass.keeper.ai.lastDecision = null;
  footBackpass.keeper.ai.nextDecision = footBackpass.match.tick + 1000;
  let sawBackpass = false;
  for (let tick = 0; tick < 60 && !sawBackpass; tick++) {
    advanceOne(footBackpass.match);
    const belief = footBackpass.keeper.beliefState.ball;
    sawBackpass = !!(belief && belief.lastTouchTeamId === footBackpass.team.id
      && belief.lastTouchKind === 'deliberate' && belief.lastTouchAction === 'pass'
      && belief.lastTouchTarget && Math.hypot(belief.lastTouchTarget.x - footBackpass.keeper.position.x,
        belief.lastTouchTarget.y - footBackpass.keeper.position.y) <= 0.01 && belief.ageTicks === 0);
  }
  assert.equal(sawBackpass, true, `${side} goalkeeper did not locally observe the teammate's deliberate foot backpass`);
  footBackpass.keeper.ai.lastDecision = footBackpass.match.tick - 1;
  footBackpass.keeper.ai.nextDecision = footBackpass.match.tick + 1;
  advanceOne(footBackpass.match);
  assert.equal(footBackpass.keeper.beliefState.ball.lastTouchKind, 'deliberate',
    `${side} keeper's local backpass observation lost deliberate-touch provenance`);
  assert.equal(footBackpass.keeper.beliefState.ball.lastTouchAction, 'pass',
    `${side} keeper's local belief lost the physical foot-action provenance`);
  assert.equal('lastTouchTargetId' in footBackpass.keeper.beliefState.ball, false,
    `${side} keeper belief exposed the hidden release recipient identifier`);
  assert.notEqual(footBackpass.keeper.intent.type, 'save',
    `${side} keeper selected a hand-save intent for a fresh deliberate teammate backpass`);
}

process.stdout.write('belief-only urgent goalkeeper reactions pass in both directions; away-moving flights do not trigger\n');
