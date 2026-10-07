'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

[
  '../src/core.js', '../src/analysis.js', '../src/world.js', '../src/tactics.js',
  '../src/intelligence.js', '../src/physics.js', '../src/rules.js', '../src/telemetry.js',
  '../src/product-data.js', '../src/engine-facade.js'
].forEach(file => require(path.join(__dirname, file)));

const TF = globalThis.TF;
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/throughball-da178-tick494.json'), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const teamsResult = TF.productData.compilePack(JSON.parse(fs.readFileSync(path.join(__dirname, '../agents/v1/examples/two-team-pack.json'), 'utf8')));
assert.equal(teamsResult.ok, true, JSON.stringify(teamsResult.errors));

assert.equal(fixture.kind, 'through-ball-open-space-lead-witness-v1');
assert.equal(fixture.provenance.appVersion, 'tf-b596aea5d308a4f7');
assert.equal(fixture.provenance.sourceEngine, 'engine-da178ffc27396f6e');
assert.equal(fixture.baseline.decisionTick, 495);
assert.equal(fixture.baseline.releaseEvent.kind, 'throughBall');
assert.equal(fixture.baseline.releaseEvent.targetId, fixture.baseline.receiverId);
assert.equal(fixture.baseline.terminalRestart.tick, 792);
const oldThrough = fixture.baseline.targetCandidates.find(c => c.type === 'throughBall' && c.targetId === fixture.baseline.receiverId);
const oldPass = fixture.baseline.targetCandidates.find(c => c.type === 'pass' && c.targetId === fixture.baseline.receiverId);
assert.ok(oldThrough, 'frozen source witness must contain the original selected same-receiver through-ball');
assert.ok(oldPass, 'frozen source witness must retain the same-receiver ordinary pass comparison');
assert.ok(Math.abs(oldThrough.utility - 0.7204) < 0.001);
assert.ok(fixture.baseline.senderAtDecision.beliefToReceiver.entity.velocity.x < 0,
  'witness must retain the fresh locally observed retreating x component');

function makeHandle(checkpoint = fixture.checkpoint, verifyExactRestore = false) {
  TF.VERSION = fixture.provenance.appVersion;
  const handle = TF.engine.createMatch({
    matchId: checkpoint.id,
    seed: checkpoint.seed,
    halfSeconds: 2700,
    home: teamsResult.teams.find(team => team.id === 'home'),
    away: teamsResult.teams.find(team => team.id === 'away')
  });
  TF.restoreCheckpoint(handle.match, clone(checkpoint));
  if (verifyExactRestore) assert.equal(JSON.stringify(TF.captureCheckpoint(handle.match)), JSON.stringify(checkpoint),
    'restore must reproduce the full JSON tick-494 witness');
  return handle;
}

const senderId = fixture.baseline.senderId, receiverId = fixture.baseline.receiverId;
function alterReceiver(checkpoint, change) {
  const saved = clone(checkpoint);
  const sender = saved.players.find(player => player.id === senderId);
  const receiver = saved.players.find(player => player.id === receiverId);
  const entity = sender.beliefState.entities[receiverId];
  change({ checkpoint: saved, sender, receiver, entity });
  return saved;
}
function decideNext(checkpoint, verifyExactRestore = false) {
  const handle = makeHandle(checkpoint, verifyExactRestore);
  const priorEvents = handle.match.events.length;
  handle.core.step(1);
  const sender = handle.match.playersById[senderId];
  const selected = clone(sender.intent);
  const explanation = clone(sender.ai.decisionExplanation);
  const emitted = handle.match.events.slice(priorEvents).map(clone);
  return { handle, selected, explanation, emitted };
}
function decideAtNoScanTick(checkpoint, tick) {
  const handle = makeHandle(checkpoint);
  const sender = handle.match.playersById[senderId];
  handle.match.tick = tick;
  sender.ai.nextDecision = tick;
  TF.updateAI(handle.match, 1 / 60);
  return { handle, selected: clone(sender.intent), explanation: clone(sender.ai.decisionExplanation) };
}
function seedHeldThrough(checkpoint) {
  return alterReceiver(checkpoint, ({ sender }) => {
    sender.ai.lastScanTick = fixture.checkpoint.tick + 2;
    sender.beliefState.lastScanTick = fixture.checkpoint.tick + 2;
    sender.intent = {
      type: 'throughBall', action: 'throughBall', target: { x: 51.8832, y: 60.8752, z: 0 },
      ballTarget: { x: 51.8832, y: 60.8752, z: 0 }, targetId: receiverId,
      createdTick: 490, commitUntilTick: 520, expiresTick: 520, utility: 0.8,
      teamIdAtCreation: sender.teamId, details: { targetId: receiverId }
    };
  });
}
function freshLocalReceiverCheckpoint(checkpoint) {
  return alterReceiver(checkpoint, ({ sender, entity }) => {
    sender.ai.lastScanTick = 496;
    sender.beliefState.lastScanTick = 496;
    sender.beliefState.updatedTick = 496;
    entity.observedTick = 496;
    entity.ageTicks = 0;
    entity.confidence = 0.9481;
    entity.baseConfidence = 0.9481;
    entity.estimatedPosition = clone(entity.position);
  });
}

// The original da178 release was selected from this exact full tick-494
// checkpoint. It chose throughBall despite a same-receiver pass candidate,
// then never controlled the pass before the tick-792 throw-in.
const base = decideNext(fixture.checkpoint, true);
assert.equal(base.handle.match.tick, 495);
assert.equal(base.selected.type, 'pass');
assert.equal(base.selected.targetId, receiverId);
assert.equal(base.explanation.commitment.valid, false,
  'fresh contradictory evidence must also release a held speculative through-ball');
assert.equal(base.emitted.find(event => event.type === 'ball-played')?.kind, 'pass');
let received = false;
while (base.handle.match.tick < 855 && !received) {
  const before = base.handle.match.tick;
  base.handle.core.step(1);
  assert.equal(base.handle.match.tick, before + 1);
  received = base.handle.match.events.some(event => event.type === 'ball-control'
    && event.playerId === receiverId && event.tick > 495 && event.tick <= 855);
}
assert.ok(received, 'normal motor/physics should produce the witnessed natural receiver control');
const controlEvent = base.handle.match.events.find(event => event.type === 'ball-control' && event.playerId === receiverId && event.tick > 495);
assert.equal(controlEvent.tick, 568);
const branchCheckpointAtControl = TF.captureCheckpoint(base.handle.match);
const branchEventsAtControl = clone(base.handle.match.events);
const branchTwin = decideNext();
while (branchTwin.handle.match.tick < 568) branchTwin.handle.core.step(1);
assert.equal(JSON.stringify(TF.captureCheckpoint(branchTwin.handle.match)), JSON.stringify(branchCheckpointAtControl),
  'restored branch must reproduce the full physical receiver-control checkpoint');
assert.equal(JSON.stringify(branchTwin.handle.match.events), JSON.stringify(branchEventsAtControl),
  'restored branch event suffix must match through actual receiver control');

// Fully trusted forward motion still opens the explicit through-run route.
const forwardCheckpoint = alterReceiver(fixture.checkpoint, ({ receiver, entity }) => {
  receiver.velocity = { x: 5.355002332809287, y: 2.1781679952394835, z: 0 };
  entity.velocity = { x: 5.355002332809287, y: 2.1781679952394835 };
});
const forward = decideNext(forwardCheckpoint);
assert.equal(forward.selected.type, 'throughBall');
assert.equal(forward.selected.targetId, receiverId);
const forwardHeldCheckpoint = seedHeldThrough(forwardCheckpoint);
const forwardHeld = decideAtNoScanTick(forwardHeldCheckpoint, 496);
assert.equal(forwardHeld.selected.type, 'throughBall');
assert.equal(forwardHeld.explanation.commitment.valid, true);

// Stationary, fully observed receivers retain the open-space anticipation
// path because zero projected motion does not oppose the added lead.
const stationaryCheckpoint = alterReceiver(fixture.checkpoint, ({ receiver, entity }) => {
  receiver.velocity = { x: 0, y: 0, z: 0 };
  entity.velocity = { x: 0, y: 0 };
});
const stationary = decideNext(stationaryCheckpoint);
assert.ok(stationary.explanation.candidates.some(c => c.type === 'throughBall' && c.targetId === receiverId));
const stationaryHeld = decideAtNoScanTick(seedHeldThrough(stationaryCheckpoint), 496);
assert.equal(stationaryHeld.selected.type, 'throughBall');
assert.equal(stationaryHeld.explanation.commitment.valid, true);

// The new veto only uses the existing fully reliable confidence/age value.
// Uncertain remembered velocity follows the previous fallback behavior.
const lowConfidenceCheckpoint = alterReceiver(fixture.checkpoint, ({ sender, entity }) => {
  sender.ai.lastScanTick = fixture.checkpoint.tick + 1;
  sender.beliefState.lastScanTick = fixture.checkpoint.tick + 1;
  entity.confidence = 0.79;
  entity.baseConfidence = 0.79;
  entity.ageTicks = 1;
  entity.observedTick = fixture.checkpoint.tick - 1;
  sender.intent = {
    type: 'throughBall', action: 'throughBall', target: { x: 51.8832, y: 60.8752, z: 0 },
    ballTarget: { x: 51.8832, y: 60.8752, z: 0 }, targetId: receiverId,
    createdTick: 490, commitUntilTick: 520, expiresTick: 520, utility: 0.8,
    teamIdAtCreation: sender.teamId, details: { targetId: receiverId }
  };
});
const lowConfidence = decideAtNoScanTick(lowConfidenceCheckpoint, 496);
assert.equal(lowConfidence.selected.type, 'throughBall', 'uncertain motion must leave the previous commitment rule unchanged');
assert.equal(lowConfidence.selected.targetId, receiverId);
assert.equal(lowConfidence.explanation.commitment.valid, true);
const lowConfidenceDto = lowConfidence.explanation.beliefs.entities.find(entity => entity.id === receiverId);
assert.ok(lowConfidenceDto && lowConfidenceDto.confidence < 0.8 && lowConfidenceDto.ageTicks > 0,
  'uncertain-control fixture must retain its low-confidence stale local DTO through the decision');

// Missing local receiver information cannot trigger a rejection from the
// hidden physical state.
const missingCheckpoint = alterReceiver(fixture.checkpoint, ({ sender }) => {
  sender.ai.lastScanTick = fixture.checkpoint.tick + 1;
  sender.beliefState.lastScanTick = fixture.checkpoint.tick + 1;
  delete sender.beliefState.entities[receiverId];
  sender.intent = {
    type: 'throughBall', action: 'throughBall', target: { x: 51.8832, y: 60.8752, z: 0 },
    ballTarget: { x: 51.8832, y: 60.8752, z: 0 }, targetId: receiverId,
    createdTick: 490, commitUntilTick: 520, expiresTick: 520, utility: 0.8,
    teamIdAtCreation: sender.teamId, details: { targetId: receiverId }
  };
});
const missing = decideAtNoScanTick(missingCheckpoint, 496);
assert.equal(missing.selected.type, 'throughBall');
assert.equal(missing.selected.targetId, receiverId);
assert.equal(missing.explanation.commitment.valid, true);

// Changing a physical opponent outside the passer's local view cannot change
// the passer's native choice while its own checkpointed DTOs remain identical.
const hiddenCheckpoint = alterReceiver(fixture.checkpoint, ({ checkpoint }) => {
  const hiddenOpponent = checkpoint.players.find(player => player.id === 'tm-away-000061000077000061000079-p-00006100007700006100007900002d000070000030000031');
  hiddenOpponent.position = { x: 2, y: 2, z: 0 };
  hiddenOpponent.previousPosition = { x: 2, y: 2, z: 0 };
  hiddenOpponent.velocity = { x: 0, y: 0, z: 0 };
});
const hidden = decideNext(hiddenCheckpoint);
assert.equal(hidden.selected.type, base.selected.type);
assert.equal(hidden.selected.targetId, base.selected.targetId);
assert.deepEqual(hidden.explanation.beliefs.entities.find(e => e.id === receiverId),
  base.explanation.beliefs.entities.find(e => e.id === receiverId), 'hidden-world twin keeps the same local receiver DTO');

const hiddenReceiverCheckpoint = alterReceiver(freshLocalReceiverCheckpoint(fixture.checkpoint), ({ sender, receiver }) => {
  sender.ai.lastScanTick = 496;
  sender.beliefState.lastScanTick = 496;
  receiver.position = { x: 90, y: 5, z: 0 };
  receiver.previousPosition = { x: 90, y: 5, z: 0 };
  receiver.velocity = { x: 2, y: -3, z: 0 };
});
const fixedDtoCheckpoint = freshLocalReceiverCheckpoint(fixture.checkpoint);
const receiverTwinA = decideAtNoScanTick(fixedDtoCheckpoint, 496);
const receiverTwinB = decideAtNoScanTick(hiddenReceiverCheckpoint, 496);
for (const twin of [receiverTwinA, receiverTwinB]) {
  const observed = twin.explanation.beliefs.entities.find(entity => entity.id === receiverId);
  assert.equal(observed.ageTicks, 0);
  assert.ok(observed.confidence >= 0.9);
}
assert.equal(receiverTwinA.selected.type, receiverTwinB.selected.type);
assert.equal(receiverTwinA.selected.targetId, receiverTwinB.selected.targetId,
  'changing unseen receiver position and velocity cannot change the passer choice');
assert.deepEqual(receiverTwinA.explanation.beliefs.entities.find(e => e.id === receiverId),
  receiverTwinB.explanation.beliefs.entities.find(e => e.id === receiverId));

function mirrorCheckpoint(source) {
  const result = clone(source);
  function reflect(value, key) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(entry => reflect(entry, key)); return; }
    if (Number.isFinite(value.x) && Number.isFinite(value.y)) {
      value.x = /velocity|facing|direction/i.test(String(key || '')) ? -value.x : 105 - value.x;
    }
    Object.keys(value).forEach(child => reflect(value[child], child));
  }
  result.teams.forEach(team => { team.attackDirection *= -1; });
  reflect(result, '');
  return result;
}
const mirrored = decideNext(mirrorCheckpoint(fixture.checkpoint));
assert.equal(mirrored.selected.type, 'pass');
assert.equal(mirrored.selected.targetId, receiverId);
assert.equal(mirrored.emitted.find(event => event.type === 'ball-played')?.kind, 'pass');

console.log('through-ball lead coherence witness and controls passed');
