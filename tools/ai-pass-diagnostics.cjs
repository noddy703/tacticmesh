const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function currentSourceVersion() {
  delete require.cache[require.resolve('./version.cjs')];
  return require('./version.cjs');
}
const sourceVersion = currentSourceVersion();
for (const file of ['core', 'world', 'tactics', 'intelligence', 'physics', 'rules', 'telemetry', 'labs']) {
  require(path.join(root, 'src', file + '.js'));
}
if (currentSourceVersion() !== sourceVersion) throw new Error('Source changed while loading AI pass diagnostics.');

const TF = globalThis.TF;
const scenarioCount = Math.max(1, Number(process.env.TF_AI_PASS_SCENARIOS) || 10);
const durationSeconds = Math.max(5, Number(process.env.TF_AI_PASS_SECONDS) || 60);
const firstSeed = Math.max(1, Number(process.env.TF_AI_PASS_SEED) || 20261007);
const outputPath = process.env.TF_AI_PASS_REPORT_PATH
  ? path.resolve(root, process.env.TF_AI_PASS_REPORT_PATH)
  : path.join(root, '.project', 'reports', `ai-pass-diagnostics-${sourceVersion}-n${scenarioCount}-${durationSeconds}s.json`);

function round(value, places = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(places)) : null;
}
function xy(player) { return { x: Number(player.position.x), y: Number(player.position.y) }; }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function segmentDistance(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  const t = length2 > 1e-8 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
  return distance(point, { x: a.x + dx * t, y: a.y + dy * t });
}
function beliefRecord(player, targetId) {
  if (!player || !player.beliefState || !targetId) return null;
  const entity = player.beliefState.entities && player.beliefState.entities[String(targetId)];
  if (!entity) return null;
  const point = entity.estimatedPosition || entity.position;
  return {
    id: String(targetId), teamId: entity.teamId || null,
    position: point ? { x: round(Number(point.x)), y: round(Number(point.y)) } : null,
    confidence: round(Number(entity.confidence)), ageTicks: Number(entity.ageTicks) || 0,
    observedTick: Number.isFinite(Number(entity.observedTick)) ? Number(entity.observedTick) : null,
    velocity: entity.velocity ? { x: round(Number(entity.velocity.x)), y: round(Number(entity.velocity.y)) } : null,
  };
}
function lineGeometry(match, pass) {
  const opponents = match.players.filter(player => player.active && player.teamId !== pass.teamId);
  const origin = pass.origin, target = pass.target;
  return opponents.map(player => {
    const point = xy(player);
    return {
      id: player.id, x: round(point.x), y: round(point.y),
      distanceToOrigin: round(distance(point, origin)),
      distanceToTarget: round(distance(point, target)),
      distanceToLane: round(segmentDistance(point, origin, target)),
      speed: round(Math.hypot(player.velocity.x || 0, player.velocity.y || 0)),
    };
  }).sort((a, b) => a.distanceToLane - b.distanceToLane);
}
function actorBeliefSnapshot(actor, targetId) {
  const entity = actor && actor.beliefState && actor.beliefState.entities && actor.beliefState.entities[String(targetId)];
  if (!entity) return null;
  const p = entity.estimatedPosition || entity.position;
  return { position: p ? { x: round(p.x), y: round(p.y) } : null, confidence: round(entity.confidence), ageTicks: entity.ageTicks || 0, observedTick: entity.observedTick == null ? null : entity.observedTick };
}
function kickSnapshot(match, event) {
  const actor = match.playersById[event.playerId] || null;
  const targetId = event.targetId || null;
  const intent = actor && actor.intent || null;
  const actualOrigin = event.origin || (actor ? xy(actor) : null);
  const actualTarget = event.target || null;
  const receiver = targetId && match.playersById[String(targetId)];
  const receiverBelief = actorBeliefSnapshot(actor, targetId);
  const actorFacing = actor && actor.facing ? { x: Number(actor.facing.x), y: Number(actor.facing.y) } : null;
  const intendedVector = actualOrigin && actualTarget ? { x: actualTarget.x - actualOrigin.x, y: actualTarget.y - actualOrigin.y } : null;
  const intendedLength = intendedVector ? Math.hypot(intendedVector.x, intendedVector.y) || 1 : 1;
  const intendedUnit = intendedVector ? { x: intendedVector.x / intendedLength, y: intendedVector.y / intendedLength } : null;
  const faceDot = actorFacing && intendedUnit ? actorFacing.x * intendedUnit.x + actorFacing.y * intendedUnit.y : null;
  return {
    type: event.type, tick: event.tick, sequence: event.sequence == null ? null : event.sequence,
    playerId: event.playerId, teamId: event.teamId, targetId,
    origin: actualOrigin ? { x: round(actualOrigin.x), y: round(actualOrigin.y) } : null,
    requestedTarget: actualTarget ? { x: round(actualTarget.x), y: round(actualTarget.y) } : null,
    kickSpeed: round(Number(event.kickSpeed)), requestedPower: round(Number(event.requestedPower)), executedPower: round(Number(event.power)),
    angleError: round(Number(event.angleError)), precision: round(Number(event.precision)), requestedLift: round(Number(event.requestedLift)), executedLift: round(Number(event.lift)),
    facingAtKick: actorFacing, facingDotToTarget: round(faceDot),
    intent: intent ? {
      type: intent.type, action: intent.action, createdTick: intent.createdTick, commitUntilTick: intent.commitUntilTick,
      utility: round(Number(intent.utility)), target: intent.target ? { x: round(intent.target.x), y: round(intent.target.y) } : null,
      selectedTargetId: intent.targetId || null,
      details: intent.details ? {
        pressure: round(Number(intent.details.pressure)), laneInterceptionRisk: round(Number(intent.details.laneInterceptionRisk)),
        receiverConfidence: round(Number(intent.details.receiverConfidence)), receiverAgeTicks: intent.details.receiverAgeTicks == null ? null : intent.details.receiverAgeTicks,
        receiverTimingPenalty: round(Number(intent.details.receiverTimingPenalty)), receiverArrivalTime: round(Number(intent.details.receiverArrivalTime)),
        arrivalTime: round(Number(intent.details.arrivalTime)), leadTime: round(Number(intent.details.leadTime)),
        boundaryRisk: round(Number(intent.details.boundaryRisk)), targetSidelineMargin: round(Number(intent.details.targetSidelineMargin)),
        progression: round(Number(intent.details.progression)), targetPressure: round(Number(intent.details.pressure)),
      } : null,
    } : null,
    receiverAtKick: receiver ? {
      id: receiver.id, teamId: receiver.teamId, isOpponentAtKick: receiver.teamId !== event.teamId,
      position: { x: round(receiver.position.x), y: round(receiver.position.y) },
      velocity: { x: round(receiver.velocity.x), y: round(receiver.velocity.y) },
      intent: receiver.intent ? { type: receiver.intent.type, target: receiver.intent.target ? { x: round(receiver.intent.target.x), y: round(receiver.intent.target.y) } : null, desiredSpeed: round(Number(receiver.intent.desiredSpeed)) } : null,
      distanceToActualTarget: actualTarget ? round(distance(xy(receiver), actualTarget)) : null,
      beliefFromPasser: receiverBelief,
    } : null,
    consideredCandidates: actor && actor.ai && Array.isArray(actor.ai.candidates) ? actor.ai.candidates.slice(0, 8).map(candidate => ({
      type: candidate.type, utility: round(Number(candidate.utility)),
      targetId: candidate.targetId || null,
      target: candidate.target ? { x: round(candidate.target.x), y: round(candidate.target.y) } : null,
      details: candidate.details ? {
        pressure: round(Number(candidate.details.pressure)), laneInterceptionRisk: round(Number(candidate.details.laneInterceptionRisk)),
        receiverConfidence: round(Number(candidate.details.receiverConfidence)), receiverAgeTicks: candidate.details.receiverAgeTicks == null ? null : candidate.details.receiverAgeTicks,
        receiverTimingPenalty: round(Number(candidate.details.receiverTimingPenalty)), receiverArrivalTime: round(Number(candidate.details.receiverArrivalTime)),
        arrivalTime: round(Number(candidate.details.arrivalTime)), leadTime: round(Number(candidate.details.leadTime)),
        boundaryRisk: round(Number(candidate.details.boundaryRisk)), progression: round(Number(candidate.details.progression)),
      } : null,
    })) : [],
    nearestOpponents: actualOrigin && actualTarget ? lineGeometry(match, { teamId: event.teamId, origin: actualOrigin, target: actualTarget }).slice(0, 4) : [],
  };
}
function settle(pending, outcome, event, match) {
  if (!pending) return null;
  pending.outcome = outcome;
  pending.resolution = event ? { type: event.type, tick: event.tick, sequence: event.sequence == null ? null : event.sequence, playerId: event.playerId || event.keeperId || null, teamId: event.teamId || null, reason: event.reason || event.restartType || null } : null;
  pending.elapsedTicks = event && Number.isFinite(event.tick) ? event.tick - pending.kick.tick : null;
  pending.elapsedSeconds = pending.elapsedTicks == null ? null : round(pending.elapsedTicks / 60, 3);
  const actorId = event && (event.playerId || event.keeperId);
  const actor = actorId && match.playersById[actorId];
  if (actor) {
    const ballPoint = { x: match.ball.position.x, y: match.ball.position.y };
    pending.contact = {
      playerId: actor.id, teamId: actor.teamId,
      position: { x: round(actor.position.x), y: round(actor.position.y) },
      ballPosition: { x: round(ballPoint.x), y: round(ballPoint.y) },
      playerBallGap: round(distance(xy(actor), ballPoint)),
      playerVelocity: { x: round(actor.velocity.x), y: round(actor.velocity.y) },
      ballVelocity: { x: round(match.ball.velocity.x), y: round(match.ball.velocity.y) },
      speedAtResolution: round(Math.hypot(match.ball.velocity.x, match.ball.velocity.y)),
      targetReceiverGap: pending.kick.targetId && match.playersById[String(pending.kick.targetId)] ? round(distance(xy(match.playersById[String(pending.kick.targetId)]), ballPoint)) : null,
    };
  }
  return pending;
}

function runScenario(seed, scenarioIndex) {
  const match = TF.createMatch({ seed, halfSeconds: 2700, matchId: 'ai-pass-diagnostics-' + seed });
  TF.configureAIScenario(match, '4v4+3 possession');
  TF.updateLabNeutrals(match);
  const core = TF.createCore({ match, renderSnapshots: false });
  const eventCursor = TF.createEventCursor();
  const passes = [], outcomes = {};
  let pending = null;
  const tickLimit = Math.round(durationSeconds * 60);
  for (let step = 0; step < tickLimit; step += 1) {
    TF.updateLabNeutrals(match);
    core.step(1);
    TF.updateLabNeutrals(match);
    for (const event of eventCursor.read(match.events)) {
      if (event.type === 'pass') {
        if (pending) {
          const completed = settle(pending, 'next-kick-before-control', event, match);
          passes.push(completed); outcomes[completed.outcome] = (outcomes[completed.outcome] || 0) + 1;
          pending = null;
        }
        pending = { kick: kickSnapshot(match, event), startedTick: event.tick };
      } else if (pending && (event.type === 'ball-control' || event.type === 'keeper-collection')) {
        const teamId = event.teamId || (event.playerId && match.playersById[event.playerId] && match.playersById[event.playerId].teamId);
        const outcome = teamId === pending.kick.teamId ? 'teammate-control' : 'opponent-control';
        const completed = settle(pending, outcome, event, match);
        passes.push(completed); outcomes[completed.outcome] = (outcomes[completed.outcome] || 0) + 1;
        pending = null;
      } else if (pending && event.type === 'ball-played') {
        const outcome = event.teamId === pending.kick.teamId
          ? event.playerId === pending.kick.playerId ? 'same-player-touch' : 'teammate-one-touch'
          : 'opponent-touch';
        const completed = settle(pending, outcome, event, match);
        passes.push(completed); outcomes[completed.outcome] = (outcomes[completed.outcome] || 0) + 1;
        pending = null;
      } else if (pending && (event.type === 'restart-awarded' || event.type === 'goal')) {
        const outcome = event.type === 'goal' ? 'goal-before-control' : event.reason === 'foul' ? 'foul-deadball' : 'out-or-deadball';
        const completed = settle(pending, outcome, event, match);
        passes.push(completed); outcomes[completed.outcome] = (outcomes[completed.outcome] || 0) + 1;
        pending = null;
      }
    }
  }
  if (pending) {
    pending.outcome = 'unresolved-at-limit';
    pending.elapsedTicks = null;
    pending.elapsedSeconds = null;
    passes.push(pending);
    outcomes[pending.outcome] = (outcomes[pending.outcome] || 0) + 1;
  }
  return {
    scenarioIndex, seed, seconds: round(match.clock.elapsedSeconds, 2), sourceVersion,
    score: { home: match.score.home, away: match.score.away },
    attempts: passes.length, outcomes, passes,
  };
}

const scenarios = [];
for (let i = 0; i < scenarioCount; i += 1) scenarios.push(runScenario(firstSeed + i, i));
if (currentSourceVersion() !== sourceVersion) throw new Error('Source changed during diagnostics; report is not a single-source snapshot.');
const totals = {};
for (const scenario of scenarios) {
  for (const [outcome, count] of Object.entries(scenario.outcomes)) totals[outcome] = (totals[outcome] || 0) + count;
}
const report = {
  kind: 'AI pass-choice and physical-resolution diagnostics',
  sourceVersion, scenarioMode: '4v4+3 possession; both teams use the configured patient possession profile',
  seedPolicy: `${firstSeed} + scenario index`, scenarioCount, durationSeconds,
  measurementNotes: [
    'AI intent/candidate details and receiver estimates are captured from the passer’s local belief at the physical pass event.',
    'Opponent/player positions at the pass event are offline geometry diagnostics; the AI does not read them through this report.',
    'Resolution joins pass event to first subsequent control, played touch, restart, goal, or next kick; kickSpeed comes from the emitted physical event rather than post-contact ball velocity.',
    'A selected intent can be committed across deliberation ticks; createdTick, commitUntilTick and kick-time utility/risk fields are preserved for audit.',
  ],
  totals, scenarios,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ report: path.relative(root, outputPath), sourceVersion, scenarioCount, durationSeconds, totals }, null, 2) + '\n');
