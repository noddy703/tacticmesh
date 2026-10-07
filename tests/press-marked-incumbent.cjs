'use strict';
const assert = require('node:assert/strict');
for (const name of ['core', 'analysis', 'world', 'tactics', 'intelligence', 'physics', 'rules', 'telemetry']) {
  require(`../src/${name}.js`);
}
const TF = globalThis.TF;

// Regression fixture for an incumbent whose separate marking duty must not
// erase its ETA from the press-rerank comparison. No AI or perception calls
// are made: all tactic inputs are explicit, timestamped local-belief DTOs.
function makeFixture(defendingSide = 'away', options = {}) {
  const core = TF.createCore({ seed: 52031, halfSeconds: 2700, renderSnapshots: false,
    home: { id: 'home', name: 'Home', formation: '4-3-3' },
    away: { id: 'away', name: 'Away', formation: '4-3-3' } });
  const match = core.match;
  match.eventTick = null; match.eventTickCount = 0;
  const defending = match.teams.find(team => team.id === defendingSide);
  const attacking = match.teams.find(team => team !== defending);
  const d = defending.attackDirection < 0 ? -1 : 1;
  const ownGoalX = d > 0 ? 0 : match.pitch.length;
  const carrier = attacking.activePlayers.find(player => player.role === 'RW');
  const incumbent = defending.activePlayers.find(player => player.role === 'RCB');
  const alternate = defending.activePlayers.find(player => player.role === 'RCM');
  const secondIncumbent = defending.activePlayers.find(player => player.role === 'DM');
  const place = (player, x, y, facingX = -d, facingY = 0) => {
    player.position.x = x; player.position.y = y;
    player.previousPosition.x = x; player.previousPosition.y = y;
    player.velocity.x = 0; player.velocity.y = 0;
    player.facing.x = facingX; player.facing.y = facingY;
    player.intent = null; player.motor = null;
  };
  place(carrier, ownGoalX + d * 21, 34, -d, 0);
  carrier.hasBall = true;
  // The marked incumbent is the nearest eligible defender to the carrier,
  // but faces away; the unmarked RCM has a much shorter, direct arrival.
  place(incumbent, ownGoalX + d * 29, 41, d, 0);
  place(alternate, ownGoalX + d * 25, 35, -d, 0);
  place(secondIncumbent, ownGoalX + d * 34, 55, -d, 0);
  for (const [index, player] of defending.activePlayers.entries()) {
    if ([incumbent, alternate, secondIncumbent].includes(player) || player.isGoalkeeper) continue;
    place(player, ownGoalX + d * (38 + index % 3), 5 + (index * 11) % 58, -d, 0);
  }
  for (const [index, player] of attacking.activePlayers.entries()) {
    if (player === carrier || player.isGoalkeeper) continue;
    place(player, carrier.position.x + d * (6 + index % 4), 8 + (index * 9) % 54, d, 0);
  }
  match.ball.ownerId = carrier.id;
  match.ball.position.x = carrier.position.x - d * .3;
  match.ball.position.y = carrier.position.y;
  match.ball.position.z = .11;
  match.ball.velocity.x = -d * 2;
  match.ball.velocity.y = 0; match.ball.velocity.z = 0;
  match.state.phase = 'open-play'; match.state.restartType = null; match.state.restartTeamId = null;
  defending.tactics.pressingIntensity = options.pressingIntensity ?? .5;
  const initial = options.twoSlots ? [incumbent.id, secondIncumbent.id] : [incumbent.id];
  const marked = options.markAlternate ? alternate : incumbent;
  const target = attacking.activePlayers.find(player => player.role === 'ST');
  defending._tacticalState = {
    phase: 'emergencyDefending', phaseWeights: {}, updatedTick: -1,
    pressAssignments: { [carrier.id]: initial },
    markAssignments: options.noMark ? {} : { [marked.id]: target.id },
    centralLaneAssignments: options.coverAlternate ? { [carrier.id]: { playerId: alternate.id, publishedTick: 15 } } : {}
  };

  function publish(tick, changes = {}) {
    match.tick = tick;
    const carrierPoint = changes.observedCarrier || { x: carrier.position.x, y: carrier.position.y };
    const ballPoint = changes.observedBall || { x: match.ball.position.x, y: match.ball.position.y };
    for (const observer of match.players) {
      const entities = {};
      for (const other of match.players) {
        if (other === observer) continue;
        const ownMate = other.teamId === observer.teamId;
        // Every observer has a nearby teammate for communication. Only the
        // carrier is exposed as an opponent, preventing unrelated marks.
        if (!ownMate && other !== carrier) continue;
        const point = other === carrier ? carrierPoint : { x: other.position.x, y: other.position.y };
        if (changes.omitCarrierEntity && other === carrier) continue;
        entities[other.id] = {
          id: other.id, teamId: other.teamId, role: other.role,
          position: point, estimatedPosition: point,
          velocity: other === carrier ? { x: changes.carrierVx ?? 0, y: changes.carrierVy ?? 0 } : { x: other.velocity.x, y: other.velocity.y },
          facing: { x: other.facing.x, y: other.facing.y },
          confidence: changes.ownerConfidence ?? .96,
          ageTicks: changes.ownerAge ?? 0, observedTick: tick, source: 'vision'
        };
      }
      observer.beliefState = {
        entities, updatedTick: tick, lastScanTick: tick, observations: [],
        ball: {
          position: { x: ballPoint.x, y: ballPoint.y, z: .11 },
          estimatedPosition: { x: ballPoint.x, y: ballPoint.y },
          velocity: { x: -d * 2, y: 0, z: 0 }, estimatedZ: .11,
          confidence: changes.ballConfidence ?? .96, ageTicks: changes.ballAge ?? 0,
          observedTick: tick, ownerId: changes.ownerVisible === false ? null : carrier.id,
          lastTouchTeamId: attacking.id
        }
      };
    }
    TF.updateTactics(match, TF.FIXED_DT);
  }
  return { core, match, defending, attacking, carrier, incumbent, alternate, secondIncumbent, publish };
}
function assignment(f) { return f.defending._tacticalState.pressAssignments[f.carrier.id] || []; }
function comparableCheckpoint(match) {
  const cp = TF.captureCheckpoint(match);
  delete cp.eventTick; delete cp.eventTickCount;
  return cp;
}

for (const side of ['home', 'away']) {
  const f = makeFixture(side);
  f.publish(15);
  const originalMark = f.defending._tacticalState.markAssignments[f.incumbent.id];
  assert.deepEqual(assignment(f), [f.incumbent.id], `${side}: first qualifying publication preserves incumbent pending hysteresis`);
  assert.equal(f.defending._tacticalState.pressRerankPending[f.carrier.id]?.count, 1, `${side}: first publication records one pending advantage`);
  const checkpoint = TF.captureCheckpoint(f.match);
  const restored = makeFixture(side);
  TF.restoreCheckpoint(restored.match, JSON.parse(JSON.stringify(checkpoint)));
  f.publish(30); restored.publish(30);
  assert.deepEqual(comparableCheckpoint(restored.match), comparableCheckpoint(f.match), `${side}: pending marked-incumbent comparison restores with identical state`);
  assert.deepEqual(assignment(f), [f.alternate.id], `${side}: second consecutive qualifying publication hands off to the unmarked alternate`);
  assert.equal(f.defending._tacticalState.markAssignments[f.incumbent.id], originalMark, `${side}: incumbent's separate mark assignment survives the handoff`);
  assert.equal(assignment(f).length, 1, `${side}: handoff preserves pressing cap one`);
  f.core.step(6); restored.core.step(6);
  assert.deepEqual(comparableCheckpoint(restored.match), comparableCheckpoint(f.match), `${side}: restored handoff has deterministic ordinary suffix`);
  const stable = assignment(f).slice();
  f.publish(45); f.publish(60);
  assert.deepEqual(assignment(f), stable, `${side}: stable observations do not chatter after handoff`);
}

const two = makeFixture('away', { pressingIntensity: .9, twoSlots: true });
two.publish(15);
const twoSlotMarkAfterRefresh = two.defending._tacticalState.markAssignments[two.incumbent.id];
two.publish(30);
assert.equal(assignment(two).length, 2, 'two-slot press cap remains intact');
assert(assignment(two).includes(two.alternate.id), 'two-slot pool can replace a marked incumbent with a qualifying unmarked alternate');
assert.equal(two.defending._tacticalState.markAssignments[two.incumbent.id], twoSlotMarkAfterRefresh, 'two-slot handoff preserves the incumbent mark after ordinary publication refresh');

const markedAlternate = makeFixture('away', { markAlternate: true });
markedAlternate.publish(15);
assert(!assignment(markedAlternate).includes(markedAlternate.alternate.id), 'marked alternate cannot replace a press incumbent');
assert.equal(markedAlternate.defending._tacticalState.pressRerankPending[markedAlternate.carrier.id], undefined, 'a marked alternate cannot start rerank hysteresis');
const coveredAlternate = makeFixture('away', { coverAlternate: true });
coveredAlternate.publish(15);
assert(!assignment(coveredAlternate).includes(coveredAlternate.alternate.id), 'active central cover cannot be pulled into the press pool');
assert.equal(coveredAlternate.defending._tacticalState.pressRerankPending[coveredAlternate.carrier.id], undefined, 'protected active cover cannot start rerank hysteresis');

for (const state of ['stale', 'low-confidence', 'missing-owner', 'missing-carrier']) {
  const f = makeFixture('away');
  if (state === 'stale') { f.publish(15, { ownerAge: 20, ballAge: 20 }); f.publish(30, { ownerAge: 20, ballAge: 20 }); }
  else if (state === 'low-confidence') { f.publish(15, { ownerConfidence: .4, ballConfidence: .4 }); f.publish(30, { ownerConfidence: .4, ballConfidence: .4 }); }
  else if (state === 'missing-owner') { f.publish(15); f.publish(30, { ownerVisible: false }); }
  else { f.publish(15, { omitCarrierEntity: true }); f.publish(30, { omitCarrierEntity: true }); }
  assert(!assignment(f).includes(f.alternate.id), `${state} local information cannot trigger a press handoff`);
  assert.equal(f.defending._tacticalState.pressRerankPending[f.carrier.id], undefined, `${state} information clears pending hysteresis`);
}

const hiddenA = makeFixture('away');
const hiddenB = makeFixture('away');
hiddenB.carrier.position.x += 17; hiddenB.carrier.position.y -= 8;
hiddenB.match.ball.position.x += 17; hiddenB.match.ball.position.y -= 8;
const observed = { x: hiddenA.carrier.position.x, y: hiddenA.carrier.position.y };
hiddenA.publish(15, { observedCarrier: observed });
hiddenB.publish(15, { observedCarrier: observed, observedBall: { x: hiddenA.match.ball.position.x, y: hiddenA.match.ball.position.y } });
assert.deepEqual(assignment(hiddenA), assignment(hiddenB), 'hidden carrier-world changes do not change actor-local published press');
assert.deepEqual(hiddenA.defending._tacticalState.pressRerankPending, hiddenB.defending._tacticalState.pressRerankPending, 'hidden-world twin has identical pending hysteresis');

console.log('marked incumbent remains in ETA comparison; two-publication handoff preserves mark, cover, cap, and checkpoint controls');
