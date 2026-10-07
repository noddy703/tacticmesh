const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/intelligence.js');
require('../src/physics.js');
require('../src/rules.js');
require('../src/labs.js');

const TF = globalThis.TF;
const dt = 1 / 60;

function create(seed) {
  return TF.createMatch({ seed, homeFormation: '4-3-3', awayFormation: '4-3-3' });
}

function forward(match, side) {
  const team = match.teams.find((item) => item.side === side);
  return team.activePlayers.filter((p) => p.positionFamily === 'FWD').sort((a, b) => b.formationSlot.x - a.formationSlot.x)[0];
}

function setCarrier(match, carrier) {
  const dir = carrier.team.attackDirection;
  carrier.position.x = dir > 0 ? 72 : 33;
  carrier.position.y = 34;
  carrier.facing.x = dir;
  carrier.facing.y = 0;
  match.ball.position.x = carrier.position.x + dir * 0.45;
  match.ball.position.y = carrier.position.y;
  match.ball.ownerId = carrier.id;
  carrier.hasBall = true;
  carrier.attributes.awareness = 90;
  carrier.attributes.vision = 75;
  carrier.attributes.decisionMaking = 75;
  carrier.attributes.anticipation = 70;
  carrier.attributes.offBallIntelligence = 70;
  carrier.team.activePlayers.forEach((p, index) => {
    if (p === carrier || p.isGoalkeeper) return;
    p.position.x = carrier.position.x - dir * (4 + (index % 3) * 3);
    p.position.y = 22 + (index % 5) * 6;
  });
  const other = match.teams.find((t) => t.id !== carrier.teamId);
  other.activePlayers.forEach((p, index) => {
    p.position.x = dir > 0 ? 5 + index : 100 - index;
    p.position.y = index * 4 + 3;
  });
}

function tickAI(match, tick) {
  match.tick = tick;
  TF.updateAI(match, dt);
}

function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < String(text).length; i += 1) {
    value ^= String(text).charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function nextUnscannedTick(player, start) {
  const cycle = TF.getPerceptionScanInterval(player, player.team && player.team.match || {});
  let tick = start;
  while ((tick + hash(player.id) % cycle) % cycle === 0) tick += 1;
  return tick;
}

function setBallBelief(player, match, position, velocity) {
  player.beliefState = {
    entities: {}, updatedTick: match.tick, lastScanTick: match.tick, observations: [],
    ball: {
      position: { x: position.x, y: position.y, z: position.z == null ? 0.11 : position.z },
      estimatedPosition: { x: position.x, y: position.y },
      velocity: { x: velocity.x, y: velocity.y, z: velocity.z || 0 },
      estimatedZ: position.z == null ? 0.11 : position.z,
      estimatedVelocityZ: velocity.z || 0,
      confidence: 0.95, baseConfidence: 0.95, ageTicks: 0, observedTick: match.tick,
      ownerId: null, lastTouchTeamId: null,
    },
  };
  player.ai = { nextDecision: match.tick + 1 };
}

function canonical(match) {
  return match.players.map((p) => ({
    id: p.id,
    intent: p.intent,
    beliefState: p.beliefState,
    selected: p.ai && p.ai.selected,
    candidates: p.ai && p.ai.candidates,
    decisionExplanation: p.ai && p.ai.decisionExplanation,
    rngState: p.rng && p.rng.state,
  }));
}

// Same seed and tick sequence must reproduce player beliefs, choices and RNG state.
const first = create(8102);
const second = create(8102);
for (let tick = 1; tick <= 180; tick += 1) {
  tickAI(first, tick);
  tickAI(second, tick);
}
assert.deepEqual(canonical(first), canonical(second), 'same-seed AI replay diverged');

// A carrier recognizes its own string ID in the physical ownership record.
const possession = create(721);
const possessor = forward(possession, 'home');
setCarrier(possession, possessor);
tickAI(possession, 1);
assert.ok(['pass', 'throughBall', 'shoot', 'carry', 'hold', 'clear'].includes(possessor.intent.type), 'carrier was treated as off-ball');
assert.ok(possessor.ai.candidates.some((candidate) => candidate.type === 'pass'), 'an unopposed normal pass was not retained as an option');
const possessionPass = possessor.ai.candidates.find((candidate) => candidate.type === 'pass');
assert.ok(possessionPass && Number.isFinite(possessionPass.details.receiverUncertaintyPenalty), 'pass candidate omitted receiver observation quality');
assert.ok(Number.isFinite(possessionPass.details.receiverArrivalTime) && Number.isFinite(possessionPass.details.receiverTimingPenalty), 'pass candidate omitted motor-aware receiver timing');
assert.ok(possessor.ai.decisionExplanation, 'decision explanation snapshot was not stored');
assert.equal(possessor.ai.decisionExplanation.reason, 'utility-winner', 'ordinary selection reason did not identify the utility winner');
assert.equal(possessor.ai.decisionExplanation.selected.type, possessor.intent.type, 'selection explanation diverged from the live intent');
assert.equal(possessor.ai.decisionExplanation.evaluatedCount, possessor.ai.decisionExplanation.storedCount, 'complete candidate set was not retained for diagnostics');
assert.ok(possessor.ai.decisionExplanation.candidates.length >= possessor.ai.candidates.length, 'diagnostic alternatives were truncated more aggressively than the legacy top list');
assert.ok(possessor.ai.decisionExplanation.candidates.some((candidate) => candidate.type === 'pass' && Number.isFinite(candidate.details.receiverConfidence) && Number.isFinite(candidate.details.arrivalTime) && Number.isFinite(candidate.details.laneInterceptionRisk)), 'diagnostic pass did not preserve prediction fields');
assert.ok(possessor.ai.decisionExplanation.candidates.every((candidate) => ['raw', 'tactical', 'playerPreference', 'uncertainty'].every((key) => Number.isFinite(candidate.utilityComponents[key]))), 'diagnostic candidate omitted an existing utility component');
assert.ok(possessor.ai.decisionExplanation.beliefs.entities.length > 0 && possessor.ai.decisionExplanation.beliefs.entities.every((entity) => entity.estimatedPosition && Number.isFinite(entity.confidence) && Number.isFinite(entity.ageTicks) && entity.source), 'diagnostic snapshot omitted local belief identity/estimate provenance');

// The explanation distinguishes a held valid commitment from the freshly
// scored utility winner without changing the selected action path.
const heldMatch = create(7216);
const heldCarrier = forward(heldMatch, 'home');
setCarrier(heldMatch, heldCarrier);
heldCarrier.intent = { type: 'carry', target: { x: 100, y: 34 }, utility: 1.1, createdTick: 1, teamIdAtCreation: heldCarrier.teamId, expiresTick: 50, commitUntilTick: 50, details: { route: 'committed-route' } };
heldCarrier.ai = { nextDecision: 1 };
const priorAugment = TF.augmentCandidates;
TF.augmentCandidates = function (candidates, context) {
  if (context.self.id === heldCarrier.id) return [{ type: 'pass', target: { x: 80, y: 30, z: 0 }, utility: 0.2, details: { targetId: 'held-test-receiver', arrivalTime: 1.2 } }];
  return typeof priorAugment === 'function' ? priorAugment(candidates, context) : candidates;
};
try { tickAI(heldMatch, 2); } finally { TF.augmentCandidates = priorAugment; }
assert.equal(heldCarrier.ai.decisionExplanation.reason, 'held-valid-commitment', 'valid commitment replacement was not explained accurately');
assert.equal(heldCarrier.ai.decisionExplanation.utilityWinner.type, 'pass', 'utility winner diagnostic did not preserve the scored winner');
assert.equal(heldCarrier.ai.decisionExplanation.selected.type, 'carry', 'diagnostic selected action did not match held intent');

// The diagnostic alternatives retain the whole evaluated set up to their
// documented cap and explicitly report any truncation beyond it.
const boundedTraceMatch = create(7217);
const boundedTraceCarrier = forward(boundedTraceMatch, 'home');
setCarrier(boundedTraceMatch, boundedTraceCarrier);
const boundedAugment = TF.augmentCandidates;
TF.augmentCandidates = function (candidates, context) {
  if (context.self.id === boundedTraceCarrier.id) return Array.from({ length: 70 }, (_, index) => ({ type: 'debug-option', target: { x: 20 + index, y: 10 }, utility: index / 100, details: { targetId: 'alt-' + index, receiverConfidence: .8 } }));
  return typeof boundedAugment === 'function' ? boundedAugment(candidates, context) : candidates;
};
try { tickAI(boundedTraceMatch, 3); } finally { TF.augmentCandidates = boundedAugment; }
assert.equal(boundedTraceCarrier.ai.decisionExplanation.evaluatedCount, 70, 'diagnostic evaluator count did not include every scored alternative');
assert.equal(boundedTraceCarrier.ai.decisionExplanation.storedCount, 64, 'diagnostic alternatives exceeded or missed the bounded record limit');
assert.equal(boundedTraceCarrier.ai.decisionExplanation.truncated, true, 'diagnostic alternatives did not label truncation');

// The same observed receiver at the same estimated current location should get
// a shorter speculative lead and lower utility when its velocity memory is old
// and low-confidence. The observation is deliberately not refreshed by vision.
function receiverEstimate(ageTicks, baseConfidence, facingX = -1, receiverX = 86, receiverVelocityX = 2) {
  const match = create(7213);
  const carrier = forward(match, 'home');
  setCarrier(match, carrier);
  const mate = carrier.team.activePlayers.find((player) => player !== carrier && !player.isGoalkeeper);
  mate.position.x = receiverX; mate.position.y = 34;
  carrier.position.x = 72; carrier.position.y = 34;
  match.ball.position.x = 72.45; match.ball.position.y = 34;
  match.ball.ownerId = carrier.id;
  carrier.hasBall = true;
  const cycle = TF.getPerceptionScanInterval(carrier, match);
  let tick = 5;
  while ((tick + hash(carrier.id)) % cycle === 0) tick += 1;
  match.tick = tick;
  carrier.ai = { nextDecision: tick };
  carrier.beliefState = {
    updatedTick: tick, lastScanTick: tick, observations: [],
    ball: { position: { x: 72.45, y: 34, z: 0.11 }, estimatedPosition: { x: 72.45, y: 34 }, velocity: { x: 0, y: 0, z: 0 }, confidence: .95, baseConfidence: .95, observedTick: tick, ageTicks: 0, ownerId: carrier.id },
    entities: { [mate.id]: { id: mate.id, teamId: mate.teamId, position: { x: receiverX - receiverVelocityX * Math.min(ageTicks / 60, 1.2), y: 34 }, estimatedPosition: { x: receiverX, y: 34 }, velocity: { x: receiverVelocityX, y: 0 }, facing: { x: facingX, y: 0 }, confidence: baseConfidence, baseConfidence: baseConfidence, observedTick: tick - ageTicks, ageTicks: ageTicks } }
  };
  let pass = null;
  const original = TF.augmentCandidates;
  TF.augmentCandidates = function (candidates, context) {
    if (context.self.id === carrier.id) pass = candidates.find((candidate) => candidate.type === 'pass' && candidate.details.targetId === mate.id) || null;
    return typeof original === 'function' ? original(candidates, context) : candidates;
  };
  try { tickAI(match, tick); } finally { TF.augmentCandidates = original; }
  return pass;
}
const freshReceiverPass = receiverEstimate(0, .95);
const staleReceiverPass = receiverEstimate(80, .36);
const receiverFacingAway = receiverEstimate(0, .95, -1);
const receiverFacingRun = receiverEstimate(0, .95, 1);
assert.ok(freshReceiverPass && staleReceiverPass, 'receiver confidence probe did not discover the same intended outlet');
assert.ok(staleReceiverPass.details.receiverAgeTicks > freshReceiverPass.details.receiverAgeTicks, 'receiver age was not retained in pass prediction');
assert.ok(staleReceiverPass.details.receiverUncertaintyPenalty > freshReceiverPass.details.receiverUncertaintyPenalty + .04, 'stale receiver memory did not lower pass confidence');
assert.ok(staleReceiverPass.details.leadTime < freshReceiverPass.details.leadTime, 'stale receiver velocity received the same speculative lead');
assert.ok(staleReceiverPass.utility < freshReceiverPass.utility, 'stale receiver pass scored as highly as the same fresh outlet');
assert.ok(receiverFacingAway.details.receiverArrivalTime > receiverFacingRun.details.receiverArrivalTime, 'pass target did not account for receiver body turn time');
assert.ok(receiverFacingAway.details.receiverTimingPenalty >= receiverFacingRun.details.receiverTimingPenalty, 'late body orientation did not reduce pass utility');
assert.ok(freshReceiverPass.details.kickOrigin.x > 72 && freshReceiverPass.details.kickOrigin.x < 73, 'pass lane prediction did not start at the facing foot');
assert.ok(freshReceiverPass.details.progressionValue >= 0 && freshReceiverPass.details.progressionValue <= 1, 'forward progression bonus was not capped');
const touchlineReceiverPass = receiverEstimate(0, .95, -1, 104, 2);
assert.ok(touchlineReceiverPass && touchlineReceiverPass.target.x <= 103.5 && touchlineReceiverPass.target.x >= 1.5, 'future receiver target escaped the pitch boundary');
assert.ok(touchlineReceiverPass.details.leadTime < freshReceiverPass.details.leadTime, 'receiver lead did not stop at the pitch boundary');

// A freshly perceived defender beside the carrier's facing-foot release point
// must raise pass-lane risk and lower the same outlet's utility.
function passRiskEstimate(defenderX, defenderY) {
  const match = create(7317);
  const carrier = forward(match, 'home');
  setCarrier(match, carrier);
  const mate = carrier.team.activePlayers.find((player) => player !== carrier && !player.isGoalkeeper);
  mate.position.x = 86; mate.position.y = 34;
  const away = match.teams.find((team) => team.side === 'away');
  const defender = away.activePlayers.find((player) => !player.isGoalkeeper);
  defender.position.x = defenderX; defender.position.y = defenderY;
  carrier.position.x = 72; carrier.position.y = 34;
  carrier.facing.x = 1; carrier.facing.y = 0;
  match.ball.position.x = 72.43; match.ball.position.y = 34;
  match.ball.ownerId = carrier.id; carrier.hasBall = true;
  carrier.ai = { nextDecision: 1 };
  tickAI(match, 1);
  return carrier.ai.decisionExplanation.candidates.find((candidate) => candidate.type === 'pass' && candidate.targetId === mate.id);
}
const pressuredOriginPass = passRiskEstimate(72.9, 34);
const clearOriginPass = passRiskEstimate(60, 62);
assert.ok(pressuredOriginPass && clearOriginPass, 'origin-pressure fixtures did not retain a comparable outlet');
assert.ok(pressuredOriginPass.details.laneInterceptionRisk > clearOriginPass.details.laneInterceptionRisk + .4, 'near-origin defender was missed by pass-lane risk');
assert.ok(pressuredOriginPass.utility < clearOriginPass.utility, 'near-origin pressure did not lower pass utility');

// A live neutral affiliation change stays unknown until this actor next sees
// the player, then the public identity is refreshed in its local belief only.
const neutralBeliefMatch = create(7214);
TF.configureAIScenario(neutralBeliefMatch, '4v4+3 possession');
const neutralHome = neutralBeliefMatch.teams.find((team) => team.side === 'home');
const neutralAway = neutralBeliefMatch.teams.find((team) => team.side === 'away');
const neutralIds = new Set(neutralBeliefMatch.state.labNeutralIds);
const neutralObserver = neutralHome.activePlayers.find((player) => !neutralIds.has(player.id) && !player.isGoalkeeper);
const observedNeutral = neutralBeliefMatch.playersById[neutralBeliefMatch.state.labNeutralIds[0]];
neutralObserver.position.x = 40; neutralObserver.position.y = 34;
neutralObserver.facing.x = 1; neutralObserver.facing.y = 0;
observedNeutral.position.x = 43; observedNeutral.position.y = 34;
neutralBeliefMatch.tick = 1;
TF.updateAI(neutralBeliefMatch, dt);
assert.equal(neutralObserver.beliefState.entities[observedNeutral.id].teamId, neutralHome.id, 'initial visible neutral affiliation was not learned');
observedNeutral.teamId = neutralAway.id;
const nextScan = (tick) => {
  const cycle = TF.getPerceptionScanInterval(neutralObserver, neutralBeliefMatch);
  return (tick + (hash(neutralObserver.id) % cycle)) % cycle === 0;
};
let neutralTick = 2;
while (nextScan(neutralTick)) neutralTick += 1;
neutralBeliefMatch.tick = neutralTick;
TF.updateAI(neutralBeliefMatch, dt);
assert.equal(neutralObserver.beliefState.entities[observedNeutral.id].teamId, neutralHome.id, 'unseen affiliation change leaked into the observer belief');
neutralTick += 1;
while (!nextScan(neutralTick)) neutralTick += 1;
neutralBeliefMatch.tick = neutralTick;
TF.updateAI(neutralBeliefMatch, dt);
assert.equal(neutralObserver.beliefState.entities[observedNeutral.id].teamId, neutralAway.id, 'visible public neutral affiliation was not refreshed in the belief');

// A neutral actor knows its own affiliation change immediately and drops an
// unexpired movement commitment authored for its former team's shape.
const neutralSelfMatch = create(7215);
TF.configureAIScenario(neutralSelfMatch, '4v4+3 possession');
const selfHome = neutralSelfMatch.teams.find((team) => team.side === 'home');
const selfAway = neutralSelfMatch.teams.find((team) => team.side === 'away');
const changingNeutral = neutralSelfMatch.playersById[neutralSelfMatch.state.labNeutralIds[0]];
const awayCarrier = selfAway.activePlayers.find((player) => !player.isGoalkeeper);
changingNeutral.intent = { type: 'support', target: { x: 2, y: 2 }, utility: 1.1, createdTick: 1, teamIdAtCreation: selfHome.id, expiresTick: 100, commitUntilTick: 100 };
changingNeutral.ai = { nextDecision: 10 };
neutralSelfMatch.ball.ownerId = awayCarrier.id;
neutralSelfMatch.ball.controlState = 'controlled';
neutralSelfMatch.ball.position.x = awayCarrier.position.x;
neutralSelfMatch.ball.position.y = awayCarrier.position.y;
TF.updateLabNeutrals(neutralSelfMatch);
assert.equal(changingNeutral.teamId, selfAway.id, 'fixture did not change the neutral actor’s own affiliation');
neutralSelfMatch.tick = 10;
TF.updateAI(neutralSelfMatch, dt);
assert.equal(changingNeutral.intent.teamIdAtCreation, selfAway.id, 'neutral actor retained an old-team movement/ball-action commitment after switching');
assert.equal(changingNeutral.intent.createdTick, 10, 'new-side decision did not replace the former-team commitment promptly');

// Carriers discover straight, inward half-space, and pressure-escape routes
// from their perceived lanes instead of receiving a single sideline-biased
// dribble target.
const routeMatch = create(7211);
const routeCarrier = forward(routeMatch, 'home');
setCarrier(routeMatch, routeCarrier);
routeCarrier.position.y = 55;
routeMatch.ball.position.y = 55;
routeMatch.teams.find((team) => team.side === 'away').activePlayers.forEach((player, index) => {
  player.position.x = 78 + (index % 3);
  player.position.y = 47 + index * 2;
});
let carryRoutes = [];
const savedAugment = TF.augmentCandidates;
TF.augmentCandidates = function (candidates, context) {
  if (context.self.id === routeCarrier.id) carryRoutes = candidates.filter((candidate) => candidate.type === 'carry');
  return typeof savedAugment === 'function' ? savedAugment(candidates, context) : candidates;
};
try { tickAI(routeMatch, 1); } finally { TF.augmentCandidates = savedAugment; }
for (const route of ['straight-channel', 'central-halfspace', 'pressure-escape']) {
  assert.ok(carryRoutes.some((candidate) => candidate.details.route === route), 'carrier did not evaluate ' + route);
}
assert.ok(carryRoutes.every((candidate) => Number.isFinite(candidate.details.actorArrival) && Number.isFinite(candidate.details.arrivalAdvantage) && Number.isFinite(candidate.details.goalConnection)), 'carry route omitted movement, defender-arrival, or goal-connection scoring');

// Shot placement uses only the goalkeeper position the shooter has observed.
const shotMatch = create(722);
const shooter = forward(shotMatch, 'home');
setCarrier(shotMatch, shooter);
shooter.position.x = 89;
shooter.position.y = 34;
shooter.facing.x = 1;
shooter.facing.y = 0;
shotMatch.ball.position.x = 89.45;
shotMatch.ball.position.y = 34;
const defendingTeam = shotMatch.teams.find((team) => team.id !== shooter.teamId);
const knownShotKeeper = defendingTeam.activePlayers.find((player) => player.isGoalkeeper);
knownShotKeeper.position.x = 101;
knownShotKeeper.position.y = 34;
defendingTeam.activePlayers.filter((player) => player !== knownShotKeeper).forEach((player, index) => {
  player.position.x = 86 + (index % 3);
  player.position.y = 6 + index * 5;
});
shotMatch.ball.ownerId = shooter.id;
shotMatch.tick = 1;
tickAI(shotMatch, 1);
const shotCandidate = shooter.ai.candidates.find((candidate) => candidate.type === 'shoot');
assert.ok(shotCandidate, 'near-goal carrier did not consider a shot');
assert.equal(shotCandidate.details.knownKeeper, true, 'shot decision did not use the perceived goalkeeper');
if (Math.abs(shotCandidate.target.y - knownShotKeeper.position.y) <= 2) {
  assert.ok(shotCandidate.details.keeperInterceptionRisk > 0.8 && shotCandidate.utility < 0.1,
    'a shot into the observed goalkeeper lane was not strongly discounted');
}
assert.ok(Number.isFinite(shotCandidate.details.shotLaneRisk) && Number.isFinite(shotCandidate.details.shotAngle), 'shot candidate omitted observed lane or goal-mouth geometry');

function shotGeometryScene(seed, blocker, shooterY) {
  const match = create(seed);
  const actor = forward(match, 'home');
  setCarrier(match, actor);
  actor.position.x = 89;
  actor.position.y = shooterY == null ? 34 : shooterY;
  actor.facing.x = 1;
  actor.facing.y = 0;
  match.ball.position.x = actor.position.x + 0.45;
  match.ball.position.y = actor.position.y;
  const defense = match.teams.find((team) => team.id !== actor.teamId);
  const goalkeeper = defense.activePlayers.find((player) => player.isGoalkeeper);
  goalkeeper.position.x = 102;
  goalkeeper.position.y = 32.5;
  defense.activePlayers.filter((player) => player !== goalkeeper).forEach((player, index) => {
    player.position.x = 76 + (index % 4);
    player.position.y = 5 + index * 7;
  });
  if (blocker) {
    const screen = defense.activePlayers.find((player) => player !== goalkeeper && !player.isGoalkeeper);
    screen.position.x = 96;
    screen.position.y = actor.position.y + (36.8 - actor.position.y) * 0.45;
    screen.velocity.x = 0;
    screen.velocity.y = 0;
  }
  match.ball.ownerId = actor.id;
  actor.ai = actor.ai || {};
  actor.ai.nextDecision = 1;
  tickAI(match, 1);
  return actor.ai.decisionExplanation && actor.ai.decisionExplanation.candidates.find((candidate) => candidate.type === 'shoot');
}
const openShotGeometry = shotGeometryScene(723, false, 34);
const blockedShotGeometry = shotGeometryScene(723, true, 34);
const acuteShotGeometry = shotGeometryScene(723, false, 16);
assert.ok(openShotGeometry && blockedShotGeometry && acuteShotGeometry, 'shot geometry fixture did not produce shot candidates');
assert.ok(blockedShotGeometry.details.shotLaneRisk > openShotGeometry.details.shotLaneRisk + 0.3,
  'shot utility ignored a perceived defender arriving in the shot lane: ' + JSON.stringify({ open: openShotGeometry.details, blocked: blockedShotGeometry.details }));
assert.ok(blockedShotGeometry.utility < openShotGeometry.utility - 0.05,
  'clear shot lane and blocked shot received indistinguishable utility');
assert.ok(acuteShotGeometry.details.shotAngle < openShotGeometry.details.shotAngle * 0.65,
  'acute touchline angle did not reduce the visible goal-mouth window');
assert.ok(acuteShotGeometry.utility < openShotGeometry.utility - 0.04,
  'narrow goal-mouth angle did not reduce shot utility');

// Away formation anchors mirror the home-oriented slot across the pitch.
const away = create(514);
const awayForward = forward(away, 'away');
assert.equal(awayForward.formationSlot.x, 76);
assert.equal(TF.getTacticalContext(away, awayForward).anchor.x, 29);

// Hidden opponent motion cannot change a decision when the actor receives no new observation.
const hiddenA = create(1603);
const hiddenB = create(1603);
const actorA = forward(hiddenA, 'home');
const actorB = forward(hiddenB, 'home');
setCarrier(hiddenA, actorA);
setCarrier(hiddenB, actorB);
tickAI(hiddenA, 1);
tickAI(hiddenB, 1);
const hiddenOpponent = hiddenB.teams.find((t) => t.id !== actorB.teamId).activePlayers[0];
hiddenOpponent.position.x = 1;
hiddenOpponent.position.y = 1;
const scanCycle = Math.round(8 + (3 - 8) * (actorA.attributes.awareness / 100));
let hiddenTick = 2;
while ((hiddenTick + hash(actorA.id) % scanCycle) % scanCycle === 0) hiddenTick += 1;
actorA.ai.nextDecision = hiddenTick;
actorB.ai.nextDecision = hiddenTick;
tickAI(hiddenA, hiddenTick);
tickAI(hiddenB, hiddenTick);
assert.equal(actorA.beliefState.lastScanTick, 1, 'test actor unexpectedly scanned on hidden perturbation tick');
assert.deepEqual(actorA.intent, actorB.intent, 'unobserved opponent movement changed actor decision');

// Lower vision/decision budget discovers fewer pass recipients in the same scene.
const low = create(9281);
const elite = create(9281);
const lowCarrier = forward(low, 'home');
const eliteCarrier = forward(elite, 'home');
setCarrier(low, lowCarrier);
setCarrier(elite, eliteCarrier);
lowCarrier.attributes.vision = 10;
lowCarrier.attributes.decisionMaking = 10;
eliteCarrier.attributes.vision = 99;
eliteCarrier.attributes.decisionMaking = 99;
tickAI(low, 1);
tickAI(elite, 1);
const countPasses = (p) => (p.ai.candidates || []).filter((c) => c.type === 'pass' || c.type === 'throughBall').length;
assert.ok(countPasses(eliteCarrier) > countPasses(lowCarrier), 'elite player did not discover more passing alternatives');
const lowCadence = lowCarrier.ai.nextDecision - lowCarrier.ai.lastDecision;
const eliteCadence = eliteCarrier.ai.nextDecision - eliteCarrier.ai.lastDecision;
assert.ok(lowCadence >= 6 && lowCadence <= 12 && eliteCadence >= 6 && eliteCadence <= 12, 'decision cadence left the 5–10 Hz band');
assert.ok(eliteCadence < lowCadence, 'higher decision skill did not deliberate more frequently');

// Scan interval reflects concentration/anticipation, local remembered threat,
// phase and role in addition to awareness. Inputs here are belief/tactical data.
function scanProfile({ awareness = 60, concentration = 60, anticipation = 60, role = 'FW', phase = 'open-play', threatDistance = 30 }) {
  const match = create(9270 + Math.round(awareness + concentration + anticipation + threatDistance));
  const player = forward(match, 'home');
  player.attributes.awareness = awareness;
  player.attributes.concentration = concentration;
  player.attributes.anticipation = anticipation;
  player.role = role;
  match.state.tacticalPhase = phase;
  player.beliefState = { entities: {
    rememberedOpponent: { id: 'rememberedOpponent', teamId: match.teams[1].id,
      position: { x: player.position.x + threatDistance, y: player.position.y },
      estimatedPosition: { x: player.position.x + threatDistance, y: player.position.y },
      velocity: { x: 0, y: 0 }, confidence: 0.95, ageTicks: 0, observedTick: 1, source: 'vision' },
  }, ball: null, observations: [] };
  return TF.getPerceptionScanInterval(player, match);
}
const calmScan = scanProfile({ threatDistance: 30 });
const pressuredScan = scanProfile({ threatDistance: 4 });
const lowConcentrationScan = scanProfile({ concentration: 20, threatDistance: 30 });
const concentratedScan = scanProfile({ concentration: 90, threatDistance: 30 });
const lowAnticipationScan = scanProfile({ anticipation: 20, threatDistance: 30 });
const anticipatoryScan = scanProfile({ anticipation: 90, threatDistance: 30 });
const defensiveRoleScan = scanProfile({ role: 'CB', phase: 'defensiveTransition', threatDistance: 30 });
assert.ok(pressuredScan < calmScan, 'local perceived pressure did not increase scan cadence');
assert.ok(concentratedScan < lowConcentrationScan, 'concentration did not increase scan cadence');
assert.ok(anticipatoryScan < lowAnticipationScan, 'anticipation did not increase scan cadence');
assert.ok(defensiveRoleScan < calmScan, 'defensive role/phase did not increase scan cadence');

// First-touch proprioception may trigger a bounded urgent decision before the
// next ordinary deliberation deadline.
const firstTouch = create(9282);
const touchingPlayer = forward(firstTouch, 'home');
touchingPlayer.hasBall = true;
firstTouch.ball.ownerId = touchingPlayer.id;
touchingPlayer.intent = { type: 'support', target: { x: 65, y: 34 }, expiresTick: 40 };
touchingPlayer.ai = { nextDecision: 40, lastDecision: 1 };
tickAI(firstTouch, 4);
assert.equal(touchingPlayer.ai.lastDecision, 4, 'first touch did not trigger an urgent, bounded decision');

// A player facing away turns its scan toward the remembered ball at bounded
// speed instead of needing body rotation or a hidden-world query.
const gazeMatch = create(9283);
const gazer = forward(gazeMatch, 'home');
gazer.position.x = 55;
gazer.position.y = 34;
gazer.facing.x = 1;
gazer.facing.y = 0;
gazeMatch.tick = 1;
gazeMatch.ball.position.x = 45;
gazeMatch.ball.position.y = 34;
gazeMatch.ball.ownerId = null;
setBallBelief(gazer, gazeMatch, { x: 45, y: 34, z: 0.11 }, { x: 0, y: 0 });
gazer.ai.nextDecision = 100;
for (let gazeTick = 2; gazeTick <= 35; gazeTick += 1) tickAI(gazeMatch, gazeTick);
const gaze = gazer.ai.scanTarget;
assert.ok(gaze.x < gazer.position.x - 3, 'perceptual gaze did not turn toward the remembered ball behind the actor');

// A player moves toward a reachable incoming ball using only the stored belief.
const receiveMatch = create(6631);
const receiver = forward(receiveMatch, 'home');
receiver.position.x = 55;
receiver.position.y = 34;
receiver.facing.x = 1;
receiver.facing.y = 0;
receiveMatch.ball.position.x = 50;
receiveMatch.ball.position.y = 34;
receiveMatch.ball.position.z = 0.11;
receiveMatch.ball.velocity.x = 10;
receiveMatch.ball.velocity.y = 0;
receiveMatch.ball.velocity.z = 0;
receiveMatch.ball.ownerId = null;
receiveMatch.tick = 1;
setBallBelief(receiver, receiveMatch, { x: 50, y: 34, z: 0.11 }, { x: 10, y: 0 });
const receiveTick = nextUnscannedTick(receiver, 2);
receiver.ai.nextDecision = receiveTick;
receiver.intent = { type: 'support', target: { x: 67, y: 34 }, utility: 1.1, expiresTick: receiveTick + 20, commitUntilTick: receiveTick + 20 };
tickAI(receiveMatch, receiveTick);
assert.equal(receiver.beliefState.lastScanTick, 1, 'receiver regression unexpectedly observed the live ball');
assert.equal(receiver.intent.type, 'receive', 'receiver did not choose the reachable pass trajectory');
assert.ok(Math.hypot(receiver.intent.target.x - receiver.position.x, receiver.intent.target.y - receiver.position.y) < 3, 'receive target is not at a reachable interception point');
assert.ok(receiver.intent.facingTarget && receiver.intent.facingTarget.x < receiver.intent.target.x, 'receiver did not receive a belief-derived open-body cue toward the incoming ball');
assert.ok(receiver.intent.utility < 1.1, 'fixture did not prove imminent reception can interrupt a stale support intent');

// In an observed loose-ball contest, the two best local teammate arrival
// estimates may compete. The rest keep their shape, and a stale claim expires
// when the observer's refreshed beliefs show faster visible teammates.
const contestMatch = create(9921);
const contestHome = contestMatch.teams.find((team) => team.side === 'home');
const contestAway = contestMatch.teams.find((team) => team.side === 'away');
const contestPlayers = contestHome.activePlayers.filter((player) => !player.isGoalkeeper).slice(0, 6);
const contestPositions = [[47, 30], [48, 36], [50, 31], [51, 37], [53, 29], [54, 39]];
contestPlayers.forEach((player, index) => {
  player.position.x = contestPositions[index][0]; player.position.y = contestPositions[index][1];
  player.velocity.x = 0; player.velocity.y = 0;
  const dx = 52 - player.position.x, dy = 34 - player.position.y, length = Math.hypot(dx, dy) || 1;
  player.facing.x = dx / length; player.facing.y = dy / length;
  player.ai = { nextDecision: 1 };
});
contestHome.activePlayers.filter((player) => !player.isGoalkeeper && !contestPlayers.includes(player)).forEach((player, index) => {
  player.position.x = 25 + index; player.position.y = 4 + (index * 7) % 60; player.ai = { nextDecision: 1 };
});
contestAway.activePlayers.forEach((player, index) => {
  player.position.x = 80 + index % 5; player.position.y = 5 + (index * 5) % 58; player.ai = { nextDecision: 1 };
});
contestMatch.ball.position.x = 52; contestMatch.ball.position.y = 34; contestMatch.ball.position.z = 0.11;
contestMatch.ball.velocity.x = 8; contestMatch.ball.velocity.y = 0; contestMatch.ball.velocity.z = 0;
contestMatch.ball.ownerId = null; contestMatch.ball.controlState = 'flight';
contestMatch.ball.lastTouchTeamId = contestAway.id; contestMatch.ball.lastTouchPlayerId = contestAway.activePlayers[0].id;
for (let contestTick = 1; contestTick <= 24; contestTick += 1) tickAI(contestMatch, contestTick);
const contestIntentants = contestPlayers.filter((player) => ['receive', 'intercept'].includes(player.intent && player.intent.type));
assert.ok(contestIntentants.length >= 1 && contestIntentants.length <= 2,
  'locally observed loose ball produced ' + contestIntentants.length + ' of 6 teammate claimants instead of a small best-arrival contest');
assert.ok(contestIntentants.every((player) => Number.isFinite(player.intent.details.claimAdvantage) && player.intent.details.claimAdvantage >= -0.22 && player.intent.details.observedContestants >= 2),
  'loose-ball claim omitted its actor-local arrival rank');
const staleClaimant = contestPlayers.find((player) => !contestIntentants.includes(player));
staleClaimant.intent = { type: 'receive', target: { x: 60, y: 34 }, teamIdAtCreation: staleClaimant.teamId, utility: 1.1, createdTick: 1, commitUntilTick: 60, expiresTick: 60 };
staleClaimant.ai.nextDecision = 25;
tickAI(contestMatch, 25);
assert.notEqual(staleClaimant.intent.type, 'receive', 'stale receiver commitment survived a fresh belief showing faster visible teammates');

// A visible teammate controlling a fast-moving dribble is not treated as a pass recipient.
const carryMatch = create(6633);
const nearby = forward(carryMatch, 'home');
nearby.position.x = 55;
nearby.position.y = 34;
carryMatch.tick = 1;
const carrier = carryMatch.teams[0].activePlayers.find((p) => p !== nearby && !p.isGoalkeeper);
setBallBelief(nearby, carryMatch, { x: 53, y: 34, z: 0.11 }, { x: 5.1, y: 0 });
nearby.beliefState.entities[carrier.id] = {
  id: carrier.id, teamId: nearby.teamId, position: { x: 52.55, y: 34 },
  estimatedPosition: { x: 52.55, y: 34 }, velocity: { x: 5.1, y: 0 },
  confidence: 0.95, baseConfidence: 0.95, observedTick: 1, ageTicks: 0, source: 'vision',
};
nearby.beliefState.ball.ownerId = carrier.id;
nearby.beliefState.ball.lastTouchTeamId = nearby.teamId;
const carryTick = nextUnscannedTick(nearby, 2);
nearby.ai.nextDecision = carryTick;
tickAI(carryMatch, carryTick);
assert.ok(!(nearby.ai.candidates || []).some((candidate) => candidate.type === 'receive'), 'teammate carry was misread as an incoming pass');

// A fresh fast trajectory overrides an owner cached from the previous scan.
const staleOwnerMatch = create(6635);
const targetReceiver = forward(staleOwnerMatch, 'home');
targetReceiver.position.x = 55;
targetReceiver.position.y = 34;
staleOwnerMatch.tick = 1;
const oldCarrier = staleOwnerMatch.teams[0].activePlayers.find((player) => player !== targetReceiver && !player.isGoalkeeper);
oldCarrier.position.x = 46.5;
oldCarrier.position.y = 34;
setBallBelief(targetReceiver, staleOwnerMatch, { x: 47, y: 34, z: 0.11 }, { x: 10, y: 0 });
targetReceiver.beliefState.ball.ownerId = oldCarrier.id;
targetReceiver.beliefState.entities[oldCarrier.id] = {
  id: oldCarrier.id, teamId: targetReceiver.teamId, position: { x: 46.5, y: 34 },
  estimatedPosition: { x: 46.5, y: 34 }, velocity: { x: 0, y: 0 },
  confidence: 0.95, baseConfidence: 0.95, observedTick: 1, ageTicks: 0, source: 'vision',
};
const staleOwnerTick = nextUnscannedTick(targetReceiver, 2);
targetReceiver.ai.nextDecision = staleOwnerTick;
tickAI(staleOwnerMatch, staleOwnerTick);
assert.ok((targetReceiver.ai.candidates || []).some((candidate) => candidate.type === 'receive'), 'fresh fast flight was blocked by a stale owner belief');

// Shared pressing responsibility must constrain the basic fallback candidate;
// an unassigned defender preserves its cover/recovery action.
const originalTacticalContext = TF.getTacticalContext;
function pressingFixture(seed, assigned) {
  const match = create(seed);
  const home = match.teams.find((team) => team.side === 'home');
  const away = match.teams.find((team) => team.side === 'away');
  const defender = home.activePlayers.find((player) => player.positionFamily === 'DEF' && !player.isGoalkeeper);
  const carrier = away.activePlayers.find((player) => !player.isGoalkeeper);
  defender.position.x = 42; defender.position.y = 34;
  defender.facing.x = 1; defender.facing.y = 0;
  carrier.position.x = 47; carrier.position.y = 34;
  match.ball.position.x = 47; match.ball.position.y = 34; match.ball.ownerId = carrier.id;
  match.tick = 1;
  setBallBelief(defender, match, { x: 47, y: 34, z: 0.11 }, { x: 0, y: 0 });
  defender.beliefState.ball.ownerId = carrier.id;
  defender.beliefState.ball.lastTouchTeamId = carrier.teamId;
  defender.beliefState.entities[carrier.id] = {
    id: carrier.id, teamId: carrier.teamId, position: { x: 47, y: 34 }, estimatedPosition: { x: 47, y: 34 },
    velocity: { x: 0, y: 0 }, confidence: 0.95, baseConfidence: 0.95, observedTick: 1, ageTicks: 0, source: 'vision',
  };
  TF.getTacticalContext = function (current, player) {
    if (player.id === defender.id) return {
      anchor: { x: defender.position.x, y: defender.position.y }, intent: 'recover',
      responsibilities: { press: assigned, pressTargetId: assigned ? carrier.id : null, cover: !assigned, screen: false, type: assigned ? 'press' : 'cover' },
      actionWeights: {},
    };
    return originalTacticalContext(current, player);
  };
  return { match, defender };
}
const unassignedPress = pressingFixture(6637, false);
unassignedPress.defender.intent = { type: 'press', target: { x: 45, y: 34 }, utility: 0.9, expiresTick: 40, commitUntilTick: 40 };
unassignedPress.defender.ai.nextDecision = 1;
tickAI(unassignedPress.match, 1);
assert.ok(!(unassignedPress.defender.ai.candidates || []).some((candidate) => candidate.type === 'press'), 'unassigned defender generated an independent press candidate');
assert.notEqual(unassignedPress.defender.intent.type, 'press', 'unassigned defender retained a stale press assignment');
const assignedPress = pressingFixture(6638, true);
assignedPress.defender.ai.nextDecision = 1;
tickAI(assignedPress.match, 1);
assert.ok((assignedPress.defender.ai.candidates || []).some((candidate) => candidate.type === 'press'), 'assigned defender did not retain the press option');
const closeChallenge = pressingFixture(6639, true);
closeChallenge.defender.position.x = 45.8;
closeChallenge.defender.position.y = 34;
// Keep the perceived ball on the defender's near side. The carrier remains
// 0.7m behind the ball, so the physical foot path does not pass through them.
closeChallenge.match.ball.position.x = 46.3;
closeChallenge.defender.beliefState.ball.position.x = 46.3;
closeChallenge.defender.beliefState.ball.estimatedPosition.x = 46.3;
closeChallenge.defender.ai.nextDecision = 1;
tickAI(closeChallenge.match, 1);
const challengeCandidate = (closeChallenge.defender.ai.candidates || []).find((candidate) => candidate.type === 'challenge');
assert.ok(challengeCandidate, 'assigned presser did not evaluate a close, observed standing challenge');
assert.equal(challengeCandidate.details.physicsAction, 'standingtackle', 'challenge did not map to a supported physical tackle action');
assert.equal(closeChallenge.defender.intent.type, 'challenge', 'eligible close challenge lost to a stale defensive movement');
assert.equal(closeChallenge.defender.intent.action, 'standingtackle', 'challenge intent failed to reach the physical action field');
TF.updateWorld(closeChallenge.match, dt);
assert.ok(closeChallenge.match.events.some((event) => event.type === 'tackle' && event.defenderId === closeChallenge.defender.id), 'standing challenge did not reach the physical tackle resolver');
TF.getTacticalContext = originalTacticalContext;

// A freshly perceived nearby flight can interrupt the ordinary cadence at a
// bounded 20 Hz rate before the estimated ball meeting.
const urgentFlight = create(6636);
const urgentReceiver = forward(urgentFlight, 'home');
urgentReceiver.position.x = 55;
urgentReceiver.position.y = 34;
urgentFlight.tick = 1;
urgentFlight.ball.position.x = 50;
urgentFlight.ball.position.y = 34;
urgentFlight.ball.velocity.x = 10;
urgentFlight.ball.ownerId = null;
setBallBelief(urgentReceiver, urgentFlight, { x: 50, y: 34, z: 0.11 }, { x: 10, y: 0 });
urgentReceiver.intent = { type: 'support', target: { x: 65, y: 34 }, expiresTick: 40 };
let urgentTick = 4;
while ((urgentTick + hash(urgentReceiver.id)) % 3 !== 0) urgentTick += 1;
urgentReceiver.ai = { nextDecision: 40, lastDecision: urgentTick - 3 };
tickAI(urgentFlight, urgentTick);
assert.equal(urgentReceiver.ai.lastDecision, urgentTick, 'imminent pass arrival waited for the full deliberation period');

// A decayed remembered ball remains inspectable but is no longer actionable.
const staleMatch = create(6634);
const staleReceiver = forward(staleMatch, 'home');
staleReceiver.position.x = 55;
staleReceiver.position.y = 34;
staleMatch.tick = 180;
staleMatch.ball.position.x = 47;
staleMatch.ball.position.y = 34;
staleMatch.ball.velocity.x = 10;
staleMatch.ball.ownerId = null;
setBallBelief(staleReceiver, staleMatch, { x: 47, y: 34, z: 0.11 }, { x: 10, y: 0 });
staleReceiver.beliefState.ball.observedTick = 1;
staleReceiver.beliefState.ball.baseConfidence = 0.95;
staleReceiver.beliefState.ball.confidence = 0.95;
const staleTick = nextUnscannedTick(staleReceiver, 181);
staleReceiver.ai.nextDecision = staleTick;
tickAI(staleMatch, staleTick);
assert.ok(!(staleReceiver.ai.candidates || []).some((candidate) => candidate.type === 'receive'), 'stale remembered ball remained an actionable receive target');

// A goalkeeper guards the predicted goal-line crossing instead of chasing the ball.
const keeperMatch = create(6632);
const keeper = keeperMatch.teams.find((team) => team.side === 'home').activePlayers.find((p) => p.isGoalkeeper);
keeper.position.x = 4.5;
keeper.position.y = 34;
keeper.facing.x = 1;
keeper.facing.y = 0;
keeperMatch.ball.position.x = 8;
keeperMatch.ball.position.y = 34;
keeperMatch.ball.position.z = 0.11;
keeperMatch.ball.velocity.x = -10;
keeperMatch.ball.velocity.y = 0;
keeperMatch.ball.velocity.z = 0;
keeperMatch.ball.ownerId = null;
keeperMatch.tick = 1;
setBallBelief(keeper, keeperMatch, { x: 8, y: 34, z: 0.11 }, { x: -10, y: 0 });
const keeperTick = nextUnscannedTick(keeper, 2);
keeper.ai.nextDecision = keeperTick;
tickAI(keeperMatch, keeperTick);
assert.equal(keeper.beliefState.lastScanTick, 1, 'keeper regression unexpectedly observed the live ball');
assert.equal(keeper.intent.type, 'save', 'keeper did not respond to a perceived trajectory crossing the goal');
assert.ok(keeper.intent.target.x <= 1.25, 'keeper rushed away from the goal plane');

// A goalward dribble must not trigger a keeper save before the attacker kicks.
// The gate uses the keeper's fresh ball/owner beliefs, including mirrored ends.
function controlledKeeperThreat(side, urgent, actualOwnerHidden, carrySpeed = 5.8) {
  const match = create(6633 + (side === 'home' ? 0 : 100) + (urgent ? 10 : 0) + Math.round(carrySpeed * 10));
  const defending = match.teams.find((team) => team.side === side);
  const attacking = match.teams.find((team) => team.side !== side);
  const goalkeeper = defending.activePlayers.find((player) => player.isGoalkeeper);
  const carrier = attacking.activePlayers.find((player) => !player.isGoalkeeper);
  const ownX = side === 'home' ? 0 : match.pitch.length;
  const ownDir = defending.attackDirection;
  goalkeeper.position.x = ownX + ownDir * 2.5;
  goalkeeper.position.y = 34;
  goalkeeper.ai = { lastDecision: 1, nextDecision: urgent ? 100 : 2 };
  goalkeeper.intent = { type: 'hold', target: { x: goalkeeper.position.x, y: 34 } };
  carrier.position.x = ownX + ownDir * 12;
  carrier.position.y = 34;
  carrier.velocity.x = -ownDir * carrySpeed;
  carrier.velocity.y = 0;
  match.ball.position.x = carrier.position.x - ownDir * 0.45;
  match.ball.position.y = 34;
  match.ball.velocity.x = -ownDir * carrySpeed;
  match.ball.velocity.y = 0;
  match.ball.ownerId = actualOwnerHidden ? null : carrier.id;
  carrier.hasBall = !actualOwnerHidden;
  match.tick = 1;
  setBallBelief(goalkeeper, match, { x: match.ball.position.x, y: 34, z: 0.11 }, { x: -ownDir * carrySpeed, y: 0 });
  goalkeeper.ai.lastDecision = 1;
  goalkeeper.ai.nextDecision = urgent ? 100 : 2;
  goalkeeper.beliefState.ball.ownerId = carrier.id;
  goalkeeper.beliefState.ball.lastTouchTeamId = carrier.teamId;
  goalkeeper.beliefState.entities[carrier.id] = {
    id: carrier.id, teamId: carrier.teamId,
    position: { x: carrier.position.x, y: carrier.position.y },
    estimatedPosition: { x: carrier.position.x, y: carrier.position.y },
    velocity: { x: carrier.velocity.x, y: 0 },
    confidence: 0.95, ageTicks: 0, observedTick: 1,
  };
  if (urgent) {
    match.tick = 4;
    tickAI(match, 4);
  } else {
    tickAI(match, 2);
  }
  return { intent: goalkeeper.intent && goalkeeper.intent.type, target: goalkeeper.intent && goalkeeper.intent.target };
}
for (const side of ['home', 'away']) {
  for (const carrySpeed of [5.8, 8]) {
    const normalCarry = controlledKeeperThreat(side, false, false, carrySpeed);
    const urgentCarry = controlledKeeperThreat(side, true, false, carrySpeed);
    assert.notEqual(normalCarry.intent, 'save', `${side} goalkeeper treated a ${carrySpeed} m/s perceived controlled dribble as a shot`);
    assert.notEqual(urgentCarry.intent, 'save', `${side} urgent keeper reaction treated a ${carrySpeed} m/s perceived controlled dribble as a shot`);
  }
}
const visibleCarrierBall = controlledKeeperThreat('home', false, false);
const hiddenCarrierBall = controlledKeeperThreat('home', false, true);
assert.deepEqual(hiddenCarrierBall, visibleCarrierBall, 'keeper decision changed when only hidden physical owner truth changed');

// A recent owner ID may lag the kick. Strong ball/carrier relative motion
// preserves a legitimate fast shot even while the ball remains near the foot.
const releasedMatch = create(6742);
const releasedKeeper = releasedMatch.teams.find((team) => team.side === 'home').activePlayers.find((player) => player.isGoalkeeper);
const releasedShooter = releasedMatch.teams.find((team) => team.side === 'away').activePlayers.find((player) => !player.isGoalkeeper);
releasedKeeper.position.x = 4.5; releasedKeeper.position.y = 34;
releasedShooter.position.x = 8; releasedShooter.position.y = 34;
releasedShooter.velocity.x = -8; releasedShooter.velocity.y = 0;
releasedMatch.ball.position.x = 7.55; releasedMatch.ball.position.y = 34;
releasedMatch.ball.velocity.x = -30; releasedMatch.ball.velocity.y = 0;
releasedMatch.ball.ownerId = null;
releasedMatch.tick = 1;
setBallBelief(releasedKeeper, releasedMatch, { x: 7.55, y: 34, z: 0.11 }, { x: -30, y: 0 });
releasedKeeper.beliefState.ball.ownerId = releasedShooter.id;
releasedKeeper.beliefState.entities[releasedShooter.id] = {
  id: releasedShooter.id, teamId: releasedShooter.teamId,
  position: { x: 8, y: 34 }, estimatedPosition: { x: 8, y: 34 }, velocity: { x: -8, y: 0 },
  confidence: 0.95, ageTicks: 0, observedTick: 1,
};
releasedKeeper.ai.nextDecision = nextUnscannedTick(releasedKeeper, 2);
tickAI(releasedMatch, releasedKeeper.ai.nextDecision);
assert.equal(releasedKeeper.intent.type, 'save', 'recent stale owner ID suppressed a separated fast goalward shot');

// Sweeping profile and published team defensive-line height change the
// goalkeeper's ordinary starting depth without overriding a goal-line threat.
function keeperDepth(sweeping, defensiveLine) {
  const match = create(6638 + sweeping + Math.round(defensiveLine * 100));
  const team = match.teams.find((item) => item.side === 'home');
  const actor = team.activePlayers.find((player) => player.isGoalkeeper);
  actor.position.x = 4.5; actor.position.y = 34;
  actor.facing.x = 1; actor.facing.y = 0;
  actor.attributes.sweeping = sweeping;
  team.tactics.defensiveLine = defensiveLine;
  match.ball.position.x = 52.5; match.ball.position.y = 34; match.ball.ownerId = null;
  match.tick = 1;
  setBallBelief(actor, match, { x: 52.5, y: 34, z: 0.11 }, { x: 0, y: 0 });
  actor.ai.nextDecision = 2;
  tickAI(match, 2);
  return actor.intent.target.x;
}
const conservativeDepth = keeperDepth(10, 0.45);
const sweeperDepth = keeperDepth(90, 0.45);
const highLineDepth = keeperDepth(50, 0.9);
assert.ok(sweeperDepth > conservativeDepth + 2, 'sweeper and conservative goalkeeper starting depths did not differ');
assert.ok(highLineDepth > keeperDepth(50, 0.45) + 1, 'high defensive line did not advance the goalkeeper starting depth');

// An observed attacker inside shooting range pulls a keeper toward the goal
// line and aligns its lateral target with the carrier-to-goal-centre angle.
function keeperPreShotTarget(side, carrierY) {
  const match = create(6641 + (side === 'home' ? 0 : 10) + Math.round(carrierY));
  const defendingTeam = match.teams.find((team) => team.side === side);
  const attackingTeam = match.teams.find((team) => team.side !== side);
  const actor = defendingTeam.activePlayers.find((player) => player.isGoalkeeper);
  const attacker = attackingTeam.activePlayers.find((player) => !player.isGoalkeeper);
  const defendingOwnX = side === 'home' ? 0 : 105;
  const attackDirection = side === 'home' ? 1 : -1;
  actor.position.x = defendingOwnX + attackDirection * 2.6;
  actor.position.y = 34;
  actor.facing.x = -attackDirection;
  actor.facing.y = 0;
  attacker.position.x = defendingOwnX + attackDirection * 12;
  attacker.position.y = carrierY;
  attacker.facing.x = -attackDirection;
  attacker.facing.y = 0;
  match.ball.position.x = attacker.position.x;
  match.ball.position.y = attacker.position.y;
  match.ball.velocity.x = 0;
  match.ball.velocity.y = 0;
  match.ball.ownerId = attacker.id;
  attacker.hasBall = true;
  match.tick = 1;
  setBallBelief(actor, match, { x: attacker.position.x, y: attacker.position.y, z: 0.11 }, { x: 0, y: 0 });
  actor.beliefState.ball.ownerId = attacker.id;
  actor.beliefState.entities[attacker.id] = {
    id: attacker.id, teamId: attacker.teamId,
    position: { x: attacker.position.x, y: attacker.position.y },
    estimatedPosition: { x: attacker.position.x, y: attacker.position.y },
    velocity: { x: 0, y: 0 }, confidence: 0.95, ageTicks: 0, observedTick: 1,
  };
  actor.ai.nextDecision = 2;
  tickAI(match, 2);
  return { intent: actor.intent, candidates: actor.ai.candidates || [], ownX: defendingOwnX, dir: attackDirection };
}
const homeCentralThreat = keeperPreShotTarget('home', 20);
const awayCentralThreat = keeperPreShotTarget('away', 48);
assert.equal(homeCentralThreat.intent.type, 'hold', 'keeper abandoned its pre-shot angle against a fresh central carrier');
assert.ok(homeCentralThreat.intent.target.x < 2.6, 'keeper retained the old minimum two-metre depth against a close carrier');
assert.ok(awayCentralThreat.intent.target.x > 102.4, 'mirrored keeper did not advance symmetrically toward its goal line');
assert.ok(homeCentralThreat.intent.target.y < 34, 'keeper did not align toward the angle from the observed wide carrier');
assert.ok(awayCentralThreat.intent.target.y > 34, 'mirrored keeper did not align toward the opposite observed wide carrier');

// A defender clears under own-goal pressure without a safe outlet, never just
// because it is close to the opponent's goal. Both attack directions are tested.
function clearanceOptions(side, ownGoalThreat) {
  const match = create(6655 + (side === 'home' ? 0 : 10) + (ownGoalThreat ? 1 : 0));
  const team = match.teams.find((item) => item.side === side);
  const opponents = match.teams.find((item) => item.side !== side);
  const carrier = team.activePlayers.find((player) => player.positionFamily === 'DEF' && !player.isGoalkeeper);
  const dir = team.attackDirection;
  const ownX = dir > 0 ? 0 : 105;
  const goalwardX = ownGoalThreat ? ownX + dir * 4 : ownX + dir * 102;
  carrier.position.x = goalwardX;
  carrier.position.y = 34;
  carrier.facing.x = dir;
  carrier.facing.y = 0;
  carrier.hasBall = true;
  match.ball.position.x = goalwardX + dir * 0.42;
  match.ball.position.y = 34;
  match.ball.ownerId = carrier.id;
  match.players.filter((player) => player.teamId === team.id && player !== carrier && !player.isGoalkeeper).forEach((player) => {
    player.position.x = ownGoalThreat ? ownX + dir * 50 : ownX + dir * 45;
    player.position.y = 5 + (Number(player.number) % 8) * 8;
  });
  opponents.activePlayers.filter((player) => !player.isGoalkeeper).forEach((player, index) => {
    player.position.x = ownGoalThreat && index < 2 ? goalwardX + dir * 1.3 : (dir > 0 ? 85 : 20);
    player.position.y = index < 2 ? 34 + index * 0.3 : 4 + (index % 8) * 8;
  });
  let captured = [];
  const previousAugment = TF.augmentCandidates;
  TF.augmentCandidates = function (candidates, context) {
    if (context.self.id === carrier.id) captured = candidates;
    return typeof previousAugment === 'function' ? previousAugment(candidates, context) : candidates;
  };
  try { tickAI(match, 1); } finally { TF.augmentCandidates = previousAugment; }
  return captured.filter((candidate) => candidate.type === 'clear');
}
assert.equal(clearanceOptions('home', false).length, 0, 'home defender cleared merely for being near the opposing goal');
assert.equal(clearanceOptions('away', false).length, 0, 'mirrored away defender cleared merely for being near the opposing goal');
assert.ok(clearanceOptions('home', true).length > 0, 'home defender failed to discover clearance under own-goal pressure with no outlet');
assert.ok(clearanceOptions('away', true).length > 0, 'mirrored away defender failed to discover clearance under own-goal pressure with no outlet');

// Players supporting a perceived teammate carrier evaluate distinct recycle
// and width outlets. This checks candidate creation and local risk metadata;
// it does not require the carrier to pass or any receiver to succeed.
const supportMatch = create(6640);
const supportCarrier = forward(supportMatch, 'home');
setCarrier(supportMatch, supportCarrier);
supportCarrier.position.x = 56;
supportCarrier.position.y = 34;
supportCarrier.facing.x = 1;
supportCarrier.facing.y = 0;
supportMatch.ball.position.x = 56.45;
supportMatch.ball.position.y = 34;
const supportActor = supportCarrier.team.activePlayers.find((player) => player !== supportCarrier && !player.isGoalkeeper && player.positionFamily !== 'FWD');
supportActor.position.x = 51;
supportActor.position.y = 24;
supportActor.facing.x = 0.45;
supportActor.facing.y = 0.89;
supportMatch.teams.find((team) => team.side === 'away').activePlayers.forEach((player, index) => {
  player.position.x = 82 + (index % 4);
  player.position.y = 9 + index * 10;
});
let supportOptions = [];
const originalAugment = TF.augmentCandidates;
TF.augmentCandidates = function (candidates, context) {
  if (context.self.id === supportActor.id) supportOptions = candidates.filter((candidate) => candidate.type === 'support');
  return typeof originalAugment === 'function' ? originalAugment(candidates, context) : candidates;
};
try { tickAI(supportMatch, 1); } finally { TF.augmentCandidates = originalAugment; }
const supportPurposes = new Set(supportOptions.map((candidate) => candidate.details.purpose));
assert.ok(supportPurposes.has('support-angle'), 'support actor lost its tactical anchor option');
assert.ok(supportPurposes.has('support-recycle'), 'support actor did not evaluate a short recycle outlet');
assert.ok(supportPurposes.has('support-wide'), 'support actor did not evaluate a width outlet');
assert.ok(supportOptions.filter((candidate) => candidate.details.purpose !== 'support-angle').every((candidate) => Number.isFinite(candidate.details.laneInterceptionRisk) && Number.isFinite(candidate.details.pressure)), 'outlet utility omitted observed lane or pressure risk');
assert.ok(Math.hypot(supportOptions.find((candidate) => candidate.details.purpose === 'support-recycle').target.x - supportOptions.find((candidate) => candidate.details.purpose === 'support-wide').target.x, supportOptions.find((candidate) => candidate.details.purpose === 'support-recycle').target.y - supportOptions.find((candidate) => candidate.details.purpose === 'support-wide').target.y) > 10, 'recycle and wide outlets collapsed to the same destination');

// A settled off-ball supporter may face only the teammate carrier it has
// actually perceived; the gaze cue remains separate from its chosen motor goal.
const settledSupport = forward(supportMatch, 'home').team.activePlayers.find((player) => player === supportActor);
settledSupport.position.x = 52; settledSupport.position.y = 23;
settledSupport.beliefState = {
  updatedTick: 3, lastScanTick: 3, observations: [],
  ball: { position: { x: 56.45, y: 34, z: .11 }, estimatedPosition: { x: 56.45, y: 34 }, velocity: { x: 0, y: 0, z: 0 }, confidence: .95, baseConfidence: .95, observedTick: 3, ageTicks: 0, ownerId: supportCarrier.id, lastTouchTeamId: supportCarrier.teamId },
  entities: { [supportCarrier.id]: { id: supportCarrier.id, teamId: supportCarrier.teamId, position: { x: 56, y: 34 }, estimatedPosition: { x: 56, y: 34 }, velocity: { x: 0, y: 0 }, confidence: .95, baseConfidence: .95, observedTick: 3, ageTicks: 0 } }
};
settledSupport.ai = { nextDecision: 4 };
const savedSupportAugment = TF.augmentCandidates;
TF.augmentCandidates = function (candidates, context) {
  const augmented = typeof savedSupportAugment === 'function' ? savedSupportAugment(candidates, context) : candidates;
  return context.self.id === settledSupport.id ? augmented.concat([{ type: 'support', target: { x: 52.5, y: 23 }, utility: 1.1, details: { purpose: 'settle-open-body' } }]) : augmented;
};
try { tickAI(supportMatch, 4); } finally { TF.augmentCandidates = savedSupportAugment; }
assert.equal(settledSupport.intent.type, 'support', 'settled support regression did not select its local support intent');
assert.ok(settledSupport.intent.facingTarget && Math.hypot(settledSupport.intent.facingTarget.x - 56, settledSupport.intent.facingTarget.y - 34) < 1,
  'settled support player did not face the locally perceived carrier');
assert.ok(Math.hypot(settledSupport.intent.target.x - settledSupport.intent.facingTarget.x, settledSupport.intent.target.y - settledSupport.intent.facingTarget.y) > 5,
  'support facing cue overwrote the motor movement target');

settledSupport.beliefState = { updatedTick: 5, lastScanTick: 5, observations: [], entities: {}, ball: { position: { x: 56.45, y: 34, z: .11 }, estimatedPosition: { x: 56.45, y: 34 }, velocity: { x: 0, y: 0, z: 0 }, confidence: .1, observedTick: 5, ageTicks: 0, ownerId: null } };
settledSupport.ai.nextDecision = 6;
try { tickAI(supportMatch, 6); } finally { TF.augmentCandidates = savedSupportAugment; }
assert.equal(settledSupport.intent.facingTarget, null, 'hidden teammate possession leaked into support gaze');

process.stdout.write('intelligence smoke checks passed\n');
