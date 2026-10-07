'use strict';
const assert = require('node:assert/strict');
for (const name of ['core', 'analysis', 'world', 'tactics', 'intelligence', 'physics', 'rules', 'telemetry']) {
  require(`../src/${name}.js`);
}
const TF = globalThis.TF;

function makeFixture(defendingSide = 'away', options = {}) {
  const core = TF.createCore({ seed: 41001, halfSeconds: 2700, renderSnapshots: false,
    home: { id: 'home', name: 'Home', formation: '4-3-3' },
    away: { id: 'away', name: 'Away', formation: '4-3-3' } });
  const match = core.match;
  match.eventTick = null; match.eventTickCount = 0;
  const defending = match.teams.find(team => team.id === defendingSide);
  const attacking = match.teams.find(team => team !== defending);
  const direction = defending.attackDirection < 0 ? -1 : 1;
  const ownGoalX = direction > 0 ? 0 : match.pitch.length;
  const carrier = attacking.activePlayers.find(player => player.role === 'RW');
  const incumbent = defending.activePlayers.find(player => player.role === 'DM');
  const alternate = defending.activePlayers.find(player => player.role === 'RCM');
  const central = defending.activePlayers.find(player => player.role === 'RCB');
  const place = (player, x, y, facingX = 0, facingY = 0) => {
    player.position.x = x; player.position.y = y;
    player.previousPosition.x = x; player.previousPosition.y = y;
    player.velocity.x = 0; player.velocity.y = 0;
    player.facing.x = facingX; player.facing.y = facingY;
    player.intent = null; player.motor = null;
  };
  place(carrier, ownGoalX + direction * 21, 34, -direction, 0);
  carrier.hasBall = true;
  place(incumbent, ownGoalX + direction * 29, 41, -direction * .8, -.6);
  place(alternate, ownGoalX + direction * 25, 35, -direction, 0);
  place(central, ownGoalX + direction * 14, 37, -direction, 0);
  for (const [index, player] of defending.activePlayers.entries()) {
    if ([incumbent, alternate, central].includes(player)) continue;
    place(player, ownGoalX + direction * (31 + index % 3), 11 + (index * 7) % 46, -direction, 0);
  }
  for (const [index, player] of attacking.activePlayers.entries()) {
    if (player === carrier || player.isGoalkeeper) continue;
    place(player, carrier.position.x + direction * (5 + index % 3), 12 + (index * 8) % 42, direction, 0);
  }
  match.ball.ownerId = carrier.id;
  match.ball.position.x = carrier.position.x - direction * .35;
  match.ball.position.y = carrier.position.y;
  match.ball.position.z = .11;
  match.ball.velocity.x = -direction * 3;
  match.ball.velocity.y = 0; match.ball.velocity.z = 0;
  const observedCarrier = { x: carrier.position.x, y: carrier.position.y };
  const observedBall = { x: match.ball.position.x, y: match.ball.position.y };
  match.state.phase = 'open-play'; match.state.restartType = null; match.state.restartTeamId = null;
  defending.tactics.pressingIntensity = options.pressingIntensity ?? .5;
  defending._tacticalState = {
    phase: 'emergencyDefending', phaseWeights: {}, updatedTick: -1,
    pressAssignments: { [carrier.id]: options.initialPressers || [incumbent.id] },
    markAssignments: options.markAlternate ? { [alternate.id]: attacking.activePlayers.find(p => p.role === 'ST').id } : {},
    centralLaneAssignments: options.coverAlternate ? { [carrier.id]: { playerId: alternate.id, publishedTick: 15 } } : {}
  };

  function publish(tick, changes = {}) {
    match.tick = tick;
    if (changes.ownerVisible === false) {
      for (const player of match.players) if (player.beliefState) player.beliefState.ball.ownerId = null;
    }
    if (changes.moveAlternateTo) place(alternate, changes.moveAlternateTo.x, changes.moveAlternateTo.y, -direction, 0);
    for (const observer of match.players) {
      const entities = {};
      for (const other of match.players) {
        if (other === observer) continue;
        const point = other === carrier ? observedCarrier : { x: other.position.x, y: other.position.y };
        entities[other.id] = {
          id: other.id, teamId: other.teamId, role: other.role,
          position: point, estimatedPosition: point,
          velocity: { x: other.velocity.x, y: other.velocity.y },
          facing: { x: other.facing.x, y: other.facing.y },
          confidence: changes.ownerConfidence ?? .96,
          ageTicks: changes.ageTicks ?? tick - 15, observedTick: 15, source: 'vision'
        };
      }
      observer.beliefState = {
        entities, updatedTick: 15, lastScanTick: 15, observations: [],
        ball: {
          position: { x: observedBall.x, y: observedBall.y, z: .11 },
          estimatedPosition: { x: observedBall.x, y: observedBall.y },
          velocity: { x: match.ball.velocity.x, y: 0, z: 0 }, estimatedZ: .11,
          confidence: changes.ballConfidence ?? .96, ageTicks: changes.ageTicks ?? tick - 15,
          observedTick: 15, ownerId: changes.ownerVisible === false ? null : carrier.id,
          lastTouchTeamId: attacking.id
        }
      };
    }
    TF.updateTactics(match, TF.FIXED_DT);
  }
  if (options.hiddenCarrierShift) {
    carrier.position.x += options.hiddenCarrierShift.x || 0;
    carrier.position.y += options.hiddenCarrierShift.y || 0;
    match.ball.position.x += options.hiddenCarrierShift.x || 0;
    match.ball.position.y += options.hiddenCarrierShift.y || 0;
  }
  return { core, match, defending, attacking, carrier, incumbent, alternate, central, publish };
}

function assignment(fixture) {
  return fixture.defending._tacticalState.pressAssignments[fixture.carrier.id] || [];
}
function publishTwice(fixture) { fixture.publish(15); fixture.publish(30); }
function comparableCheckpoint(match) {
  const checkpoint = TF.captureCheckpoint(match);
  delete checkpoint.eventTick; delete checkpoint.eventTickCount;
  return checkpoint;
}

for (const defendingSide of ['home', 'away']) {
  const fixture = makeFixture(defendingSide);
  fixture.publish(15);
  assert.deepEqual(assignment(fixture), [fixture.incumbent.id], `${defendingSide}: one publication must not switch the press slot`);
  const pending = fixture.defending._tacticalState.pressRerankPending[fixture.carrier.id];
  assert.equal(pending.count, 1, `${defendingSide}: first fresh advantage is checkpointed as pending`);
  const checkpoint = TF.captureCheckpoint(fixture.match);
  const reference = makeFixture(defendingSide);
  TF.restoreCheckpoint(reference.match, JSON.parse(JSON.stringify(checkpoint)));
  fixture.publish(30);
  reference.publish(30);
  assert.deepEqual(comparableCheckpoint(reference.match), comparableCheckpoint(fixture.match), `${defendingSide}: pending hysteresis survives restore with identical causal state`);
  assert.deepEqual(assignment(fixture), [fixture.alternate.id], `${defendingSide}: sustained fresh ETA advantage reassigns the same single press slot`);
  assert.equal(fixture.defending._tacticalState.markAssignments[fixture.alternate.id], undefined, `${defendingSide}: no marked player is taken from its duty`);
  assert.notEqual(fixture.defending._tacticalState.centralLaneAssignments[fixture.carrier.id]?.playerId, fixture.alternate.id, `${defendingSide}: central-cover duty is preserved`);
  assert.equal(fixture.defending._tacticalState.pressAssignments[fixture.carrier.id].length, 1, 'press cap remains one');
  fixture.core.step(6);
  reference.core.step(6);
  assert.deepEqual(comparableCheckpoint(reference.match), comparableCheckpoint(fixture.match), `${defendingSide}: restored pending hysteresis produces an identical ordinary event/state suffix`);
}

const marked = makeFixture('away', { markAlternate: true });
publishTwice(marked);
assert.deepEqual(assignment(marked), [marked.incumbent.id], 'a marked alternative cannot take the press slot');

const covered = makeFixture('away', { coverAlternate: true });
publishTwice(covered);
assert.deepEqual(assignment(covered), [covered.incumbent.id], 'a player with a current cover responsibility cannot take the press slot');

for (const state of ['inactive', 'sentOff', 'injured']) {
  const ineligible = makeFixture('away');
  if (state === 'inactive') ineligible.alternate.active = false;
  else ineligible.alternate[state] = true;
  publishTwice(ineligible);
  assert.deepEqual(assignment(ineligible), [ineligible.incumbent.id], `${state} candidates cannot take a press slot`);
}

const keeperOnlyAlternative = makeFixture('away');
keeperOnlyAlternative.alternate.active = false;
const keeper = keeperOnlyAlternative.defending.activePlayers.find(player => player.isGoalkeeper || player.role === 'GK');
keeper.position.x = keeperOnlyAlternative.carrier.position.x;
keeper.position.y = keeperOnlyAlternative.carrier.position.y;
keeper.previousPosition.x = keeper.position.x; keeper.previousPosition.y = keeper.position.y;
keeper.velocity.x = 0; keeper.velocity.y = 0;
keeperOnlyAlternative.publish(15);
keeperOnlyAlternative.publish(30);
assert.deepEqual(assignment(keeperOnlyAlternative), [keeperOnlyAlternative.incumbent.id], 'a nearer goalkeeper is never promoted into the outfield press assignment');

const stale = makeFixture('away');
stale.publish(15, { ageTicks: 20 });
stale.publish(30, { ageTicks: 35 });
assert.deepEqual(assignment(stale), [stale.incumbent.id], 'stale carrier/ball memory cannot reassign the press');
assert.equal(stale.defending._tacticalState.pressRerankPending[stale.carrier.id], undefined, 'stale publication clears pending hysteresis');

const lowConfidence = makeFixture('away');
lowConfidence.publish(15, { ownerConfidence: .4, ballConfidence: .4 });
lowConfidence.publish(30, { ownerConfidence: .4, ballConfidence: .4 });
assert.deepEqual(assignment(lowConfidence), [lowConfidence.incumbent.id], 'low-confidence observations cannot reassign the press');

const hiddenA = makeFixture('away');
const hiddenB = makeFixture('away', { hiddenCarrierShift: { x: 18, y: -9 } });
for (const fixture of [hiddenA, hiddenB]) fixture.publish(15);
assert.deepEqual(assignment(hiddenA), assignment(hiddenB), 'unobserved carrier-world changes do not alter the published assignment');
assert.deepEqual(hiddenA.defending._tacticalState.pressRerankPending, hiddenB.defending._tacticalState.pressRerankPending, 'hidden carrier-world changes do not alter pending ETA history');

const cap = makeFixture('away', { pressingIntensity: .9, initialPressers: ['away-p06', 'away-p11'] });
publishTwice(cap);
assert.equal(assignment(cap).length, 2, 're-ranking does not exceed the existing two-presser cap');
assert(assignment(cap).includes(cap.alternate.id), 'the materially faster unassigned alternative replaces one incumbent slot');

const chatter = makeFixture('away');
chatter.publish(15);
chatter.publish(30, { moveAlternateTo: { x: 58, y: 10 } });
assert.deepEqual(assignment(chatter), [chatter.incumbent.id], 'an advantage that disappears on the next publication does not switch');
assert.equal(chatter.defending._tacticalState.pressRerankPending[chatter.carrier.id], undefined, 'nonconsecutive qualification cannot accumulate');

const missedPublication = makeFixture('away');
missedPublication.publish(15);
missedPublication.publish(45, { ageTicks: 0 });
assert.deepEqual(assignment(missedPublication), [missedPublication.incumbent.id], 'a missed publication breaks consecutive hysteresis');
assert.equal(missedPublication.defending._tacticalState.pressRerankPending[missedPublication.carrier.id].count, 1, 'new interval starts a fresh pending record');

const absentOwner = makeFixture('away');
absentOwner.publish(15);
absentOwner.publish(30, { ownerVisible: false });
assert.equal(absentOwner.defending._tacticalState.pressRerankPending[absentOwner.carrier.id], undefined, 'owner disappearance clears pending hysteresis');

console.log('press reservation re-ranks only on two fresh mirrored ETA publications; cap, mark/cover, stale, hidden-state, chatter, and checkpoint controls pass');
