const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
function currentSourceVersion() {
  delete require.cache[require.resolve('../tools/version.cjs')];
  return require('../tools/version.cjs');
}
const sourceVersion = currentSourceVersion();
for (const file of ['core', 'world', 'tactics', 'intelligence', 'physics', 'rules', 'telemetry', 'labs']) require(path.resolve(__dirname, '..', 'src', file + '.js'));
const TF = globalThis.TF;
if (currentSourceVersion() !== sourceVersion) throw new Error('Source changed while loading modules; rerun the matrix on one source snapshot.');
const scenarioCount = Math.max(1, Number(process.env.TF_POSSESSION_SCENARIOS) || 100);
const durationSeconds = Number(process.env.TF_POSSESSION_SECONDS) || 60;
const matrixMode = process.env.TF_POSSESSION_MODE || 'full-11';
const reportPath = process.env.TF_POSSESSION_REPORT_PATH
  ? path.resolve(__dirname, '..', process.env.TF_POSSESSION_REPORT_PATH)
  : path.resolve(__dirname, '..', '.project', 'reports', 'pass-probe-v6-' + matrixMode + '-n' + scenarioCount + '-' + durationSeconds + 's.json');

function setup(seed, caseIndex = 0) {
  const match = TF.createMatch({ seed, halfSeconds: 2700, matchId: 'possession-' + seed });
  if (matrixMode === '4v4+3-possession') {
    TF.configureAIScenario(match, '4v4+3 possession');
    TF.updateLabNeutrals(match);
    return { match, carrierTeamId: match.ball.lastTouchTeamId };
  }
  const home = match.teams[0], away = match.teams[1];
  const h = home.activePlayers, a = away.activePlayers;
  const smallSided = matrixMode === 'small-7';
  const varied = matrixMode === 'varied-possession';
  const context = varied ? ['buildup-retain', 'close-pressure', 'wide-retain', 'counter-transition'][caseIndex % 4] : matrixMode;
  const smallActive = new Set([0, 1, 2, 5, 6, 9, 10]);
  // Structured, non-overlapping 4-3-3 staging: keep both keepers at their
  // goal, defensive lines spread across lanes, and leave realistic passing
  // distances between midfield and forward lines.
  const homeXY = [[5,34],[32,59],[28,44],[28,24],[32,9],[41,34],[49,49],[49,19],[52,34],[70,43],[68,14]];
  const awayXY = [[100,34],[77,59],[82,44],[82,24],[77,9],[64,34],[58,49],[58,19],[43,59],[43,34],[43,9]];
  h.forEach((p, i) => {
    p.active = !smallSided || smallActive.has(i);
    p.velocity.x = p.velocity.y = 0;
    [p.position.x, p.position.y] = smallSided && i === 6 ? [52, 34] : smallSided && i === 5 ? [40, 42] : homeXY[i];
    p.facing = { x: 1, y: 0 };
  });
  a.forEach((p, i) => {
    p.active = !smallSided || smallActive.has(i);
    p.velocity.x = p.velocity.y = 0;
    [p.position.x, p.position.y] = smallSided && i === 6 ? [58, 34] : smallSided && i === 5 ? [65, 42] : awayXY[i];
    p.facing = { x: -1, y: 0 };
  });
  let carrierIndex = smallSided ? 6 : 8;
  if (varied) {
    if (context === 'buildup-retain') { carrierIndex = 5; h[5].position.x = h[5].previousPosition.x = 37; h[5].position.y = h[5].previousPosition.y = 34; }
    else if (context === 'close-pressure') {
      carrierIndex = 6; h[6].position.x = h[6].previousPosition.x = 51; h[6].position.y = h[6].previousPosition.y = 43;
      a[5].position.x = a[5].previousPosition.x = 54.2; a[5].position.y = a[5].previousPosition.y = 42.5;
    } else if (context === 'wide-retain') { carrierIndex = 7; h[7].position.x = h[7].previousPosition.x = 47; h[7].position.y = h[7].previousPosition.y = 11; }
    else if (context === 'counter-transition') {
      carrierIndex = 9; h[9].position.x = h[9].previousPosition.x = 63; h[9].position.y = h[9].previousPosition.y = 43;
      a[1].position.x = a[1].previousPosition.x = 76; a[1].position.y = a[1].previousPosition.y = 41;
    }
  }
  const carrier = h[carrierIndex];
  match.state.matrixScenario = context;
  match.state.phase = 'open-play'; match.state.restartType = null; match.state.restartTeamId = null;
  match.state.possessionTeamId = home.id;
  match.ball.position = { x: carrier.position.x + .4, y: carrier.position.y, z: .11 };
  match.ball.previousPosition = { ...match.ball.position };
  match.ball.velocity = { x: 0, y: 0, z: 0 }; match.ball.ownerId = carrier.id; match.ball.controlState = 'controlled';
  match.ball.lastTouchPlayerId = carrier.id; match.ball.lastTouchTeamId = home.id;
  return { match, carrierTeamId: home.id };
}

function emptyChainRun(teamId) { return { teamId: teamId || null, completed: 0, progressive: 0, usefulProgressions: 0, threatGains: 0, lineBreaks: 0, pressureEscapes: 0, valuableSpaceEntries: 0, defensiveDisplacements: 0, drawAndSwitches: 0, receivers: [] }; }

function updateChains(state, events, match) {
  const emptyRun = emptyChainRun;
  function attackProgress(teamId, point) {
    const length = match.pitch && match.pitch.length || 105, direction = state.attackDirection[teamId] || 1;
    return Math.max(0, Math.min(1, direction > 0 ? point.x / length : (length - point.x) / length));
  }
  function threatValue(teamId, point) {
    const width = match.pitch && match.pitch.width || 68, centrality = Math.max(0, 1 - Math.abs(point.y - width / 2) / (width / 2));
    return attackProgress(teamId, point) * (0.55 + centrality * 0.45);
  }
  function nearestOpponent(teamId, point) {
    return match.players.reduce((best, p) => p.active && p.teamId !== teamId ? Math.min(best, Math.hypot(p.position.x - point.x, p.position.y - point.y)) : best, Infinity);
  }
  function nearestOpponentActor(teamId, point) {
    return match.players.filter(p => p.active && p.teamId !== teamId).map(p => ({ id: p.id, distance: Math.hypot(p.position.x - point.x, p.position.y - point.y) })).sort((a, b) => a.distance - b.distance)[0] || null;
  }
  function passDetail(pending, reason, event, oneTouch) {
    if (!pending) return;
    state.passResolutionTotals[reason] = (state.passResolutionTotals[reason] || 0) + 1;
    const timing = state.targetArrivalOutcomes;
    timing.resolved++;
    timing[reason] = (timing[reason] || 0) + 1;
    if (pending.targetCrossed) timing.targetWithinContactRadius++;
    if (Number.isFinite(pending.receiverGapAtBallTarget)) {
      timing.targetGapSamples++;
      if (pending.receiverGapAtBallTarget <= .72) timing.receiverWithinContactAtTarget++;
      if (pending.receiverGapAtBallTarget <= 1.5) timing.receiverWithin1_5mAtTarget++;
      if (pending.receiverGapAtBallTarget <= 3) timing.receiverWithin3mAtTarget++;
    }
    if (pending.targetCrossed && Number.isFinite(pending.receiverGapAtBallTarget)) {
      timing.targetCrossingsWithReceiverSample++;
      if (pending.receiverGapAtBallTarget <= .72) timing.receiverWithinContactAtCrossing++;
      if (pending.receiverGapAtBallTarget <= 1.5) timing.receiverWithin1_5mAtCrossing++;
      if (pending.receiverGapAtBallTarget <= 3) timing.receiverWithin3mAtCrossing++;
    }
    if (Number.isFinite(pending.closestReceiverDistance) && pending.closestReceiverDistance <= .72) timing.receiverEverWithinContact++;
    if (reason === 'teammate-control' && event && pending.targetId && (event.playerId || event.keeperId) === pending.targetId) timing.intendedReceiverResolved++;
    if (reason === 'teammate-control' && event && pending.targetId && (event.playerId || event.keeperId) !== pending.targetId) timing.otherTeammateResolved++;
    const receiver = pending.targetId && match.playersById[pending.targetId], ball = match.ball;
    const receiverDistance = receiver ? Math.hypot(receiver.position.x - ball.position.x, receiver.position.y - ball.position.y) : null;
    const receiverMoved = receiver ? Math.hypot(receiver.position.x - pending.receiverStart.x, receiver.position.y - pending.receiverStart.y) : null;
    const landingError = pending.target ? Math.hypot(ball.position.x - pending.target.x, ball.position.y - pending.target.y) : null;
    const displacement = Math.hypot(ball.position.x - pending.ballStart.x, ball.position.y - pending.ballStart.y);
    const dx = displacement > .001 ? (ball.position.x - pending.ballStart.x) / displacement : 0;
    const dy = displacement > .001 ? (ball.position.y - pending.ballStart.y) / displacement : 0;
    const motionAlongFlight = receiver ? (receiver.position.x - pending.receiverStart.x) * dx + (receiver.position.y - pending.receiverStart.y) * dy : null;
    const closestReceiver = Number(pending.closestReceiverDistance.toFixed(2)), closestMate = Number(pending.closestTeammateDistance.toFixed(2));
    const actualPoint = event && event.origin, attackDir = state.attackDirection[pending.teamId] || 1;
    const actualProgress = actualPoint && pending.origin ? (actualPoint.x - pending.origin.x) * attackDir : null;
    const actualThreatGain = actualPoint && pending.origin ? threatValue(pending.teamId, actualPoint) - threatValue(pending.teamId, pending.origin) : null;
    const actualPressure = actualPoint ? nearestOpponent(pending.teamId, actualPoint) : null;
    const actualDefenseDisplacement = actualPoint ? (pending.opponentPositionsAtKick || []).reduce((max, old) => {
      const now = match.playersById[old.id]; return now && now.active ? Math.max(max, Math.hypot(now.position.x - old.x, now.position.y - old.y)) : max;
    }, 0) : null;
    const actualLineBreak = !!(actualPoint && pending.defensiveLineAtKick != null && pending.receiverPositionAtKick
      && (pending.receiverPositionAtKick.x - pending.defensiveLineAtKick) * attackDir <= -0.5
      && (actualPoint.x - pending.defensiveLineAtKick) * attackDir >= 0.5);
    const actualFinalThirdEntry = !!(actualPoint && pending.origin && attackProgress(pending.teamId, pending.origin) < 2 / 3 && attackProgress(pending.teamId, actualPoint) >= 2 / 3);
    const actualBoxEntry = !!(actualPoint && pending.origin && attackProgress(pending.teamId, pending.origin) < 0.84 && attackProgress(pending.teamId, actualPoint) >= 0.84 && Math.abs(actualPoint.y - 34) <= 20.16);
    const pressureEscape = !!(actualPressure != null && pending.nearestOpponentAtKick <= 5 && actualPressure >= pending.nearestOpponentAtKick + 1.5);
    const drawDefender = pending.nearestDefenderAtKick && match.playersById[pending.nearestDefenderAtKick.id];
    const defenderDrawDistance = drawDefender && actualPoint && pending.origin
      ? pending.nearestDefenderAtKick.distanceToOrigin - Math.hypot(drawDefender.position.x - pending.origin.x, drawDefender.position.y - pending.origin.y) : null;
    const drawAndSwitch = !!(actualPoint && pending.origin && Math.abs(actualPoint.y - pending.origin.y) >= 12 && defenderDrawDistance >= 1.5);
    const usefulProgress = reason === 'teammate-control' && (actualProgress >= 3 || actualThreatGain >= 0.03 || actualLineBreak || actualFinalThirdEntry || actualBoxEntry || pressureEscape || drawAndSwitch);
    if (reason === 'teammate-control' && state.run.teamId === pending.teamId && actualPoint) {
      if (usefulProgress) state.run.usefulProgressions++;
      if (actualThreatGain >= 0.03) state.run.threatGains++;
      if (actualLineBreak) state.run.lineBreaks++;
      if (pressureEscape) state.run.pressureEscapes++;
      if (actualFinalThirdEntry || actualBoxEntry) state.run.valuableSpaceEntries++;
      if (actualDefenseDisplacement >= 1.5) state.run.defensiveDisplacements++;
      if (drawAndSwitch) state.run.drawAndSwitches++;
    }
    let likelyCause = reason;
    if (reason === 'opponent-control' || reason === 'opponent-touch') likelyCause = 'real-opponent-interception';
    else if (reason === 'outOfPlay') likelyCause = 'ball-out-of-play';
    else if (reason === 'next-kick-before-contact' || reason === 'timeout') {
      if (closestMate <= 0.72) likelyCause = 'within-contact-range-no-control';
      else if ((pending.receiverTargetGapAtKick != null && pending.receiverTargetGapAtKick > 5) && Math.abs(Number(motionAlongFlight) || 0) < .5) likelyCause = 'receiver-tracking-miss';
      else likelyCause = 'flight-or-arrival-miss';
    }
    if (state.passDiagnostics.length >= 40) return;
    state.passDiagnostics.push({ passerId: pending.playerId, targetId: pending.targetId || null, teamId: pending.teamId,
      tick: pending.tick, resolutionTick: event && event.tick || match.tick, reason, oneTouch: !!oneTouch,
      elapsedSeconds: Number((((event && event.tick || match.tick) - pending.tick) / 60).toFixed(2)), estimatedArrivalTime: pending.estimatedArrivalTime || null,
      receiverIntentAtKick: pending.receiverIntent, receiverStart: pending.receiverStart,
      receiverMotorSpeed: pending.receiverMotorSpeed, receiverIntentTarget: pending.receiverIntentTarget, receiverFacingAtKick: pending.receiverFacingAtKick,
      receiverTargetGapAtKick: pending.receiverTargetGapAtKick == null ? null : Number(pending.receiverTargetGapAtKick.toFixed(2)),
      launchVelocity: pending.launchVelocity,
      launchSpeed: Number(pending.launchSpeed.toFixed(2)), kickDistance: pending.kickDistance == null ? null : Number(pending.kickDistance.toFixed(2)),
      unconstrainedStopRange: Number(pending.unconstrainedStopRange.toFixed(2)), predictedStopError: pending.predictedStopError == null ? null : Number(pending.predictedStopError.toFixed(2)),
      closestBallToTarget: Number(pending.closestBallToTarget.toFixed(2)), targetCrossed: pending.targetCrossed,
      closestBallToTargetSeconds: Number((pending.closestBallToTargetTick / 60).toFixed(2)),
      targetReceiverGapWhenBallPassed: pending.receiverGapAtBallTarget == null ? null : Number(pending.receiverGapAtBallTarget.toFixed(2)),
      targetReceiverIntentWhenBallPassed: pending.receiverIntentAtBallTarget || null,
      targetReceiverPositionWhenBallPassed: pending.receiverPositionAtBallTarget || null,
      actualReceiveLocation: event && event.origin || null,
      actualTerritorialGain: actualProgress == null ? null : Number(actualProgress.toFixed(2)),
      actualThreatGain: actualThreatGain == null ? null : Number(actualThreatGain.toFixed(4)),
      actualLineBreak, actualFinalThirdEntry, actualBoxEntry, pressureEscape, actualPressureAtReceipt: actualPressure,
      actualMaxDefenderMovement: actualDefenseDisplacement == null ? null : Number(actualDefenseDisplacement.toFixed(2)), drawAndSwitch, usefulProgress,
      nearestDefenderDrawnTowardOrigin: defenderDrawDistance == null ? null : Number(defenderDrawDistance.toFixed(2)),
      closestReceiverSeconds: Number((pending.closestReceiverTick / 60).toFixed(2)),
      maxReceiverMovement: Number(pending.maxReceiverMovement.toFixed(2)),
      receiverIntentSamples: pending.receiverIntentSamples,
      receiverMaxTurnDegrees: Number((pending.receiverMaxTurnRadians * 180 / Math.PI).toFixed(1)),
      intendedLanding: pending.target || null, receiverDistanceAtKick: pending.receiverDistanceAtKick == null ? null : Number(pending.receiverDistanceAtKick.toFixed(2)),
      ballToIntendedLandingAtResolution: landingError == null ? null : Number(landingError.toFixed(2)),
      closestReceiverDistance: closestReceiver, closestTeammateDistance: closestMate, likelyCause: likelyCause,
      receiverDistanceAtResolution: receiverDistance == null ? null : Number(receiverDistance.toFixed(2)), receiverMoved: receiverMoved == null ? null : Number(receiverMoved.toFixed(2)),
      receiverMotionAlongFlight: motionAlongFlight == null ? null : Number(motionAlongFlight.toFixed(2)),
      ballFinal: { x: Number(ball.position.x.toFixed(2)), y: Number(ball.position.y.toFixed(2)), speed: Number(Math.hypot(ball.velocity.x, ball.velocity.y).toFixed(2)) },
      resolutionPlayerId: event && (event.playerId || event.keeperId) || null, resolutionTeamId: event && event.teamId || null,
      currentBallOwner: ball.ownerId || null, lastTouchPlayerId: ball.lastTouchPlayerId || null });
  }
  function measurePending(pending) {
    if (!pending) return;
    const ball = match.ball, receiver = pending.targetId && match.playersById[pending.targetId];
    if (pending.target) {
      const targetGap = Math.hypot(pending.target.x - ball.position.x, pending.target.y - ball.position.y);
      if (targetGap < pending.closestBallToTarget) {
        pending.closestBallToTarget = targetGap; pending.closestBallToTargetTick = match.tick - pending.tick;
        if (receiver) {
          pending.receiverGapAtBallTarget = Math.hypot(receiver.position.x - ball.position.x, receiver.position.y - ball.position.y);
          pending.receiverIntentAtBallTarget = receiver.intent && receiver.intent.type || null;
          pending.receiverPositionAtBallTarget = { x: receiver.position.x, y: receiver.position.y };
        }
      }
      if (targetGap < 0.72) pending.targetCrossed = true;
    }
    if (receiver) {
      const gap = Math.hypot(receiver.position.x - ball.position.x, receiver.position.y - ball.position.y);
      if (gap < pending.closestReceiverDistance) { pending.closestReceiverDistance = gap; pending.closestReceiverTick = match.tick - pending.tick; }
      pending.maxReceiverMovement = Math.max(pending.maxReceiverMovement || 0, Math.hypot(receiver.position.x - pending.receiverStart.x, receiver.position.y - pending.receiverStart.y));
      pending.receiverIntentSamples[receiver.intent && receiver.intent.type || 'none'] = (pending.receiverIntentSamples[receiver.intent && receiver.intent.type || 'none'] || 0) + 1;
      const facing = receiver.facing || { x: 1, y: 0 }, facingAtKick = pending.receiverFacingAtKick || { x: 1, y: 0 }, faceDot = Math.max(-1, Math.min(1, facing.x * facingAtKick.x + facing.y * facingAtKick.y));
      pending.receiverMaxTurnRadians = Math.max(pending.receiverMaxTurnRadians || 0, Math.acos(faceDot));
    }
    for (const mate of match.players) if (mate.active && mate.teamId === pending.teamId && mate.id !== pending.playerId) {
      pending.closestTeammateDistance = Math.min(pending.closestTeammateDistance, Math.hypot(mate.position.x - ball.position.x, mate.position.y - ball.position.y));
    }
  }
  function completePending(teamId, receiverId, oneTouch, contactEvent) {
    const pending = state.pending;
    if (!pending || pending.teamId !== teamId || !receiverId || receiverId === pending.playerId) return false;
    state.passOutcomes.complete++;
    if (oneTouch) state.passOutcomes.oneTouchCompletions = (state.passOutcomes.oneTouchCompletions || 0) + 1;
    const receiver = match.playersById[receiverId], actualPoint = contactEvent && contactEvent.origin || receiver && receiver.position || null;
    passDetail(pending, 'teammate-control', Object.assign({ playerId: receiverId, teamId: teamId, tick: match.tick }, contactEvent || {}, { origin: actualPoint }), oneTouch);
    if (state.run.teamId !== teamId) state.run = emptyRun(teamId);
    const direction = state.attackDirection[teamId] || 1;
    state.run.completed++;
    const progressed = !!(pending.origin && actualPoint && (actualPoint.x - pending.origin.x) * direction >= 3);
    if (progressed) state.run.progressive++;
    state.run.receivers.push(receiverId);
    const repeatCount = state.run.receivers.reduce((n, id, i, list) => n + (i >= 2 && id === list[i - 2] ? 1 : 0), 0);
    const max = state.maxByTeam[teamId] || { completed: 0, progressive: 0, repeatCount: 0 };
    if (state.run.completed > max.completed) state.maxByTeam[teamId] = { completed: state.run.completed, progressive: state.run.progressive, usefulProgressions: state.run.usefulProgressions, threatGains: state.run.threatGains, lineBreaks: state.run.lineBreaks, pressureEscapes: state.run.pressureEscapes, valuableSpaceEntries: state.run.valuableSpaceEntries, defensiveDisplacements: state.run.defensiveDisplacements, drawAndSwitches: state.run.drawAndSwitches, repeatCount };
    state.pending = null;
    return true;
  }
  measurePending(state.pending);
  for (const event of events) {
    if (event.type === 'ball-control' && event.teamId) {
      if (state.lastControlledTeamId && state.lastControlledTeamId !== event.teamId) state.trueTurnovers++;
      state.lastControlledTeamId = event.teamId;
    }
    if (event.type === 'restart-taken' || event.type === 'goal') {
      if (event.type === 'restart-taken' && event.teamId) state.lastControlledTeamId = event.teamId;
      if (state.pending) { passDetail(state.pending, 'deadball', event, false); state.passOutcomes.deadball = (state.passOutcomes.deadball || 0) + 1; state.pending = null; }
      state.run = emptyRun(event.teamId || null);
    } else if (event.type === 'pass') {
      if (state.pending) {
        state.passOutcomes.notControlledBeforeNextKick = (state.passOutcomes.notControlledBeforeNextKick || 0) + 1;
        passDetail(state.pending, 'next-kick-before-contact', event, false);
        state.uncontrolledExamples.push({ priorPasser: state.pending.playerId, priorTargetId: state.pending.targetId || null,
          priorTeamId: state.pending.teamId, priorTick: state.pending.tick, nextPasser: event.playerId, nextTeamId: event.teamId,
          samePlayer: state.pending.playerId === event.playerId, sameTeam: state.pending.teamId === event.teamId,
          targetDistanceAtNextKick: state.pending.targetId && match.playersById[state.pending.targetId] ? Number(Math.hypot(match.playersById[state.pending.targetId].position.x - match.ball.position.x, match.playersById[state.pending.targetId].position.y - match.ball.position.y).toFixed(2)) : null,
          nextKickerDistance: Number(Math.hypot(match.playersById[event.playerId].position.x - match.ball.position.x, match.playersById[event.playerId].position.y - match.ball.position.y).toFixed(2)),
          currentBallOwner: match.ball.ownerId || null, currentLastTouch: match.ball.lastTouchPlayerId || null });
      }
      const receiver = event.targetId && match.playersById[event.targetId];
      const receiverStart = receiver ? { x: receiver.position.x, y: receiver.position.y } : { x: 0, y: 0 };
      const receiverIntentTarget = receiver && receiver.intent && receiver.intent.target ? { x: receiver.intent.target.x, y: receiver.intent.target.y } : null;
      const ballStart = { x: match.ball.position.x, y: match.ball.position.y };
      const attackDirection = state.attackDirection[event.teamId] || 1;
      const opponentLine = match.players.filter(p => p.active && p.teamId !== event.teamId).sort((a, b) => (b.position.x - a.position.x) * attackDirection)[1];
      const nearestDefender = nearestOpponentActor(event.teamId, ballStart);
      const nearestDefenderActor = nearestDefender && match.playersById[nearestDefender.id];
      const launchVelocity = { x: match.ball.velocity.x, y: match.ball.velocity.y, z: match.ball.velocity.z || 0 };
      const launchSpeed = Math.hypot(launchVelocity.x, launchVelocity.y);
      const kickDistance = event.target ? Math.hypot(event.target.x - ballStart.x, event.target.y - ballStart.y) : null;
      const unconstrainedStopRange = launchSpeed / 0.42;
      const receiverDistanceAtKick = receiver ? Math.hypot(receiver.position.x - ballStart.x, receiver.position.y - ballStart.y) : null;
      state.pending = { ...event, receiverIntent: receiver && receiver.intent && receiver.intent.type || null,
        receiverStart: receiverStart, ballStart: ballStart, receiverDistanceAtKick: receiverDistanceAtKick,
        receiverMotorSpeed: receiver && receiver.intent && receiver.intent.desiredSpeed || 0, receiverIntentTarget: receiverIntentTarget,
        receiverFacingAtKick: receiver && receiver.facing ? { x: receiver.facing.x, y: receiver.facing.y } : null,
        receiverPositionAtKick: receiver ? { x: receiver.position.x, y: receiver.position.y } : null,
        defensiveLineAtKick: opponentLine ? opponentLine.position.x : null,
        nearestOpponentAtKick: nearestOpponent(event.teamId, ballStart),
        nearestDefenderAtKick: nearestDefender && nearestDefenderActor ? { id: nearestDefender.id, distanceToOrigin: Math.hypot(nearestDefenderActor.position.x - event.origin.x, nearestDefenderActor.position.y - event.origin.y) } : null,
        opponentPositionsAtKick: match.players.filter(p => p.active && p.teamId !== event.teamId).map(p => ({ id: p.id, x: p.position.x, y: p.position.y })),
        receiverTargetGapAtKick: receiverIntentTarget ? Math.hypot(receiverIntentTarget.x - event.target.x, receiverIntentTarget.y - event.target.y) : null,
        launchVelocity, launchSpeed, kickDistance, unconstrainedStopRange,
        predictedStopError: kickDistance == null ? null : unconstrainedStopRange - kickDistance,
        closestBallToTarget: kickDistance == null ? 999 : kickDistance, closestBallToTargetTick: 0, targetCrossed: false,
        receiverGapAtBallTarget: null, receiverIntentAtBallTarget: null, receiverPositionAtBallTarget: null,
        closestReceiverTick: 0, maxReceiverMovement: 0, receiverIntentSamples: {}, receiverMaxTurnRadians: 0,
        closestReceiverDistance: receiverDistanceAtKick == null ? 999 : receiverDistanceAtKick,
        closestTeammateDistance: 999 };
      state.passOutcomes.attempts++;
      const intent = state.pending.receiverIntent || 'no-target-intent';
      state.passOutcomes.receiverIntent = state.passOutcomes.receiverIntent || {};
      state.passOutcomes.receiverIntent[intent] = (state.passOutcomes.receiverIntent[intent] || 0) + 1;
    }
    else if (event.type === 'ball-played') {
      if (state.pending && event.teamId === state.pending.teamId && event.playerId !== state.pending.playerId) completePending(event.teamId, event.playerId, true, event);
      else if (state.pending && event.teamId !== state.pending.teamId) {
        passDetail(state.pending, 'opponent-touch', event, false);
        state.passOutcomes.intercepted = (state.passOutcomes.intercepted || 0) + 1; state.pending = null;
        state.run = emptyRun(null);
      } else if (state.pending && event.playerId === state.pending.playerId) {
        const previous = state.pending;
        passDetail(previous, 'same-player-kick', event, false);
        state.passOutcomes.samePlayerRecovery = (state.passOutcomes.samePlayerRecovery || 0) + 1; state.pending = null;
        state.selfTouchExamples.push({ passerId: event.playerId, teamId: event.teamId, targetId: previous.targetId || null,
          touchKind: event.kind, tick: event.tick, tickSincePass: event.tick - previous.tick, ballOwner: match.ball.ownerId || null, lastTouchPlayerId: match.ball.lastTouchPlayerId || null });
      }
    } else if (event.type === 'ball-control') {
      const previous = state.pending;
      const completed = completePending(event.teamId, event.playerId, false, event);
      if (!completed && previous) {
        if (previous.teamId !== event.teamId) { state.passOutcomes.intercepted = (state.passOutcomes.intercepted || 0) + 1; passDetail(previous, 'opponent-control', event, false); }
        else {
          passDetail(previous, 'same-player-control', event, false);
          state.passOutcomes.samePlayerRecovery = (state.passOutcomes.samePlayerRecovery || 0) + 1;
          const player = match.playersById[event.playerId], ball = match.ball, face = player && player.facing || { x: 1, y: 0 };
          const rx = ball.position.x - player.position.x, ry = ball.position.y - player.position.y, d = Math.hypot(rx, ry) || 1;
          state.selfControlExamples.push({ passerId: previous.playerId, targetId: previous.targetId || null, receiverId: event.playerId,
            teamId: event.teamId, tick: event.tick, ageTicks: event.tick - previous.tick, ballOwner: ball.ownerId || null,
            lastTouchPlayerId: ball.lastTouchPlayerId || null, relativeBall: { x: Number(rx.toFixed(2)), y: Number(ry.toFixed(2)), distance: Number(d.toFixed(2)), frontDot: Number(((rx / d) * face.x + (ry / d) * face.y).toFixed(2)) },
            playerVelocity: player && { x: Number(player.velocity.x.toFixed(2)), y: Number(player.velocity.y.toFixed(2)) },
            ballVelocity: { x: Number(ball.velocity.x.toFixed(2)), y: Number(ball.velocity.y.toFixed(2)) },
            relativeVelocity: player && { x: Number((ball.velocity.x - player.velocity.x).toFixed(2)), y: Number((ball.velocity.y - player.velocity.y).toFixed(2)) } });
        }
      }
      if (state.run.teamId && state.run.teamId !== event.teamId) state.run = emptyRun(event.teamId);
      state.pending = null;
    } else if (state.pending && (event.type === 'restart-awarded' || event.type === 'out-of-play')) {
      const category = event.restartType === 'foul' || event.restartType === 'free-kick' || event.type === 'restart-awarded' && event.reason === 'foul' ? 'deadball' : 'outOfPlay';
      passDetail(state.pending, category, event, false);
      state.passOutcomes[category] = (state.passOutcomes[category] || 0) + 1; state.pending = null;
      state.run = emptyRun(null);
    } else if (state.pending && (event.type === 'foul' || event.type === 'offside')) {
      passDetail(state.pending, 'deadball', event, false);
      state.passOutcomes.deadball = (state.passOutcomes.deadball || 0) + 1; state.pending = null;
      state.run = emptyRun(null);
    }
  }
}

const scenarios = [];
for (let i = 0; i < scenarioCount; i++) {
  const { match } = setup(20261007 + i, i);
  const core = TF.createCore({ match, renderSnapshots: false });
  const state = { pending: null, run: emptyChainRun(match.teams[0].id), uncontrolledExamples: [], selfTouchExamples: [], selfControlExamples: [], passDiagnostics: [], passResolutionTotals: {},
    targetArrivalOutcomes: { resolved: 0, targetWithinContactRadius: 0, targetGapSamples: 0, receiverWithinContactAtTarget: 0, receiverWithin1_5mAtTarget: 0, receiverWithin3mAtTarget: 0, targetCrossingsWithReceiverSample: 0, receiverWithinContactAtCrossing: 0, receiverWithin1_5mAtCrossing: 0, receiverWithin3mAtCrossing: 0, receiverEverWithinContact: 0, intendedReceiverResolved: 0, otherTeammateResolved: 0 },
    maxByTeam: {}, neutralAffiliationChanges: 0, lastNeutralTeamId: match.state.labNeutralTeamId || null, trueTurnovers: 0, lastControlledTeamId: match.ball.lastTouchTeamId || null,
    passOutcomes: { attempts: 0, complete: 0, receiverIntent: {} }, attackDirection: Object.fromEntries(match.teams.map(t => [t.id, t.attackDirection])) };
  const eventCursor = TF.createEventCursor();
  const tickLimit = durationSeconds * 60;
  for (let tick = 0; tick < tickLimit; tick++) {
    if (matrixMode === '4v4+3-possession') {
      TF.updateLabNeutrals(match);
      if (match.state.labNeutralTeamId && match.state.labNeutralTeamId !== state.lastNeutralTeamId) state.neutralAffiliationChanges++;
      state.lastNeutralTeamId = match.state.labNeutralTeamId || state.lastNeutralTeamId;
    }
    core.step(1);
    if (matrixMode === '4v4+3-possession') {
      TF.updateLabNeutrals(match);
      if (match.state.labNeutralTeamId && match.state.labNeutralTeamId !== state.lastNeutralTeamId) state.neutralAffiliationChanges++;
      state.lastNeutralTeamId = match.state.labNeutralTeamId || state.lastNeutralTeamId;
    }
    const events = eventCursor.read(match.events);
    updateChains(state, events, match);
    if (Object.values(state.maxByTeam).some(x => x.completed >= 12)) break;
  }
  const best = Object.values(state.maxByTeam).sort((a, b) => b.completed - a.completed)[0] || { completed: 0, progressive: 0, usefulProgressions: 0, threatGains: 0, lineBreaks: 0, pressureEscapes: 0, valuableSpaceEntries: 0, defensiveDisplacements: 0, drawAndSwitches: 0, repeatCount: 0 };
  if (state.pending) { state.passOutcomes.unresolved = (state.passOutcomes.unresolved || 0) + 1; state.pending = null; }
  const stats = TF.telemetry.summary(match);
  const teamStats = Object.values(stats.teams);
  const passes = teamStats.reduce((n, team) => n + team.passes, 0), completed = teamStats.reduce((n, team) => n + team.completedPasses, 0);
  const shots = teamStats.reduce((n, team) => n + team.shots, 0);
  scenarios.push({ seed: match.seed, scenarioType: match.state.matrixScenario || matrixMode, seconds: Number(match.clock.elapsedSeconds.toFixed(1)), score: [match.score.home, match.score.away], passes, completed, passCompletion: passes ? Number((completed / passes).toFixed(3)) : 0, shots, trueTurnovers: state.trueTurnovers, neutralAffiliationChanges: state.neutralAffiliationChanges, passOutcomes: state.passOutcomes, targetArrivalOutcomes: state.targetArrivalOutcomes, maxCompletedChain: best.completed, progressiveInChain: best.progressive, usefulProgressionsInChain: best.usefulProgressions, threatGainsInChain: best.threatGains, lineBreaksInChain: best.lineBreaks, pressureEscapesInChain: best.pressureEscapes, valuableSpaceEntriesInChain: best.valuableSpaceEntries, defensiveDisplacementsInChain: best.defensiveDisplacements, drawAndSwitchesInChain: best.drawAndSwitches, repeatedAtoB: best.repeatCount, uncontrolledExamples: state.uncontrolledExamples.slice(0, 3), selfTouchExamples: state.selfTouchExamples.slice(0, 3), selfControlExamples: state.selfControlExamples.slice(0, 5), passDiagnostics: state.passDiagnostics, passResolutionTotals: state.passResolutionTotals });
}

const qualifying = scenarios.filter(x => x.maxCompletedChain >= 8 && x.progressiveInChain >= 4).length;
const chains = scenarios.map(x => x.maxCompletedChain).sort((a, b) => a - b);
const usefulByChain = scenarios.map(x => x.usefulProgressionsInChain).sort((a, b) => a - b);
const fixture = matrixMode === '4v4+3-possession' ? 'supported 4v4+3 possession scenario with dynamic neutral affiliation' : matrixMode === 'small-7' ? '7v7 with GK, two backs, two midfielders, and two forwards' : '11v11 with full 4-3-3, keepers at goal lines, separated lines';
const scenarioTypeSummary = Object.fromEntries([...new Set(scenarios.map(x => x.scenarioType))].map(type => {
  const cases = scenarios.filter(x => x.scenarioType === type), attempts = cases.reduce((n, x) => n + x.passOutcomes.attempts, 0), receipts = cases.reduce((n, x) => n + x.passOutcomes.complete, 0);
  return [type, { cases: cases.length, attempts, receipts, aggregateCompletion: attempts ? Number((receipts / attempts).toFixed(4)) : null,
    meanPassesPerCase: Number((cases.reduce((n, x) => n + x.passes, 0) / cases.length).toFixed(2)), meanShotsPerCase: Number((cases.reduce((n, x) => n + x.shots, 0) / cases.length).toFixed(2)),
    meanLongestChain: Number((cases.reduce((n, x) => n + x.maxCompletedChain, 0) / cases.length).toFixed(2)), meanUsefulProgressionsInLongestChain: Number((cases.reduce((n, x) => n + x.usefulProgressionsInChain, 0) / cases.length).toFixed(2)),
    meanLineBreaks: Number((cases.reduce((n, x) => n + x.lineBreaksInChain, 0) / cases.length).toFixed(2)), meanPressureEscapes: Number((cases.reduce((n, x) => n + x.pressureEscapesInChain, 0) / cases.length).toFixed(2)),
    meanValuableSpaceEntries: Number((cases.reduce((n, x) => n + x.valuableSpaceEntriesInChain, 0) / cases.length).toFixed(2)), meanDefensiveDisplacements: Number((cases.reduce((n, x) => n + x.defensiveDisplacementsInChain, 0) / cases.length).toFixed(2)),
    meanDrawAndSwitches: Number((cases.reduce((n, x) => n + x.drawAndSwitchesInChain, 0) / cases.length).toFixed(2)) }];
}));
const report = { mechanicsVersion: 'pass-probe-v6', sourceVersion, matrixMode, fixture, scenarios: scenarioCount, durationSeconds,
  maxCompletedChain: Math.max(...chains), medianMaxCompletedChain: chains[Math.floor(chains.length / 2)],
  scenariosWith8PlusCompleted: scenarios.filter(x => x.maxCompletedChain >= 8).length,
  scenariosWith8PlusAndAnyUsefulProgression: scenarios.filter(x => x.maxCompletedChain >= 8 && x.usefulProgressionsInChain > 0).length,
  qualifying8PlusWith4Progressive: qualifying,
  medianUsefulProgressionsInLongestChain: usefulByChain[Math.floor(usefulByChain.length / 2)],
  usefulProgressionMetricDefinition: 'At actual teammate control origin, any of: >=3m net territory gain, >=0.03 goal-proximity threat value gain, runner moving from >=0.5m behind to >=0.5m beyond the second-last-defender line, entry into final third or box, nearest-opponent distance improving by >=1.5m from a pressured pass origin, or a >=12m width switch while the nearest defender moves >=1.5m toward the original ball location. These world-space measures are diagnostics, not AI-perception claims. The strict >=4 territorial receipts column remains a stress diagnostic, not a literal spec threshold.',
  scenarioTypeSummary,
  scorelines: scenarios.map(x => x.score.join('-')), meanGoals: Number((scenarios.reduce((n, x) => n + x.score[0] + x.score[1], 0) / scenarioCount).toFixed(2)),
  dominantAtoBChains: scenarios.filter(x => x.maxCompletedChain >= 4 && x.repeatedAtoB >= x.maxCompletedChain / 2).length,
  meanPassCompletion: Number((scenarios.reduce((n, x) => n + x.passCompletion, 0) / scenarioCount).toFixed(3)),
  meanPassCompletionActiveCases: Number((scenarios.filter(x => x.passes > 0).reduce((n, x) => n + x.passCompletion, 0) / Math.max(1, scenarios.filter(x => x.passes > 0).length)).toFixed(3)),
  passOutcomeTotals: scenarios.reduce((total, scenario) => {
    Object.entries(scenario.passOutcomes).forEach(([key, value]) => {
      if (key === 'receiverIntent') {
        total.receiverIntent = total.receiverIntent || {};
        Object.entries(value).forEach(([intent, count]) => { total.receiverIntent[intent] = (total.receiverIntent[intent] || 0) + count; });
      } else total[key] = (total[key] || 0) + value;
    });
    return total;
  }, {}),
  targetArrivalOutcomes: scenarios.reduce((total, scenario) => {
    Object.entries(scenario.targetArrivalOutcomes).forEach(([key, value]) => { total[key] = (total[key] || 0) + value; });
    return total;
  }, {}),
  totalTrueTurnovers: scenarios.reduce((n, scenario) => n + scenario.trueTurnovers, 0),
  totalNeutralAffiliationChanges: scenarios.reduce((n, scenario) => n + scenario.neutralAffiliationChanges, 0),
  uncontrolledExamples: scenarios.flatMap(scenario => scenario.uncontrolledExamples).slice(0, 20),
  selfTouchExamples: scenarios.flatMap(scenario => scenario.selfTouchExamples).slice(0, 20),
  selfControlExamples: scenarios.flatMap(scenario => scenario.selfControlExamples).slice(0, 20),
  passDiagnostics: scenarios.flatMap(scenario => scenario.passDiagnostics).slice(0, 40),
  passResolutionTotals: scenarios.reduce((totals, scenario) => { Object.entries(scenario.passResolutionTotals).forEach(([reason, count]) => { totals[reason] = (totals[reason] || 0) + count; }); return totals; }, {}),
  meanPasses: Number((scenarios.reduce((n, x) => n + x.passes, 0) / scenarioCount).toFixed(2)), meanShots: Number((scenarios.reduce((n, x) => n + x.shots, 0) / scenarioCount).toFixed(2)),
  completedChainLengths: chains, cases: scenarios };
report.meanPerScenarioPassCompletion = report.meanPassCompletion;
report.activeScenarioMeanPassCompletion = report.meanPassCompletionActiveCases;
report.aggregatePassCompletionRate = report.passOutcomeTotals.attempts ? Number((report.passOutcomeTotals.complete / report.passOutcomeTotals.attempts).toFixed(4)) : null;
report.passCompletionDenominator = { attempts: report.passOutcomeTotals.attempts || 0, completed: report.passOutcomeTotals.complete || 0,
  completionDefinition: 'different teammate controls via ball-control or receives a one-touch ball-played event; one physical pass event per attempt' };
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ report: path.relative(process.cwd(), reportPath), scenarios: scenarioCount, durationSeconds,
  scenariosWith8PlusCompleted: report.scenariosWith8PlusCompleted,
  scenariosWith8PlusAndAnyUsefulProgression: report.scenariosWith8PlusAndAnyUsefulProgression,
  stricterFourProgressiveReceiptDiagnostic: qualifying, maxCompletedChain: report.maxCompletedChain,
  medianMaxCompletedChain: report.medianMaxCompletedChain, dominantAtoBChains: report.dominantAtoBChains,
  meanGoals: report.meanGoals, aggregatePassCompletionRate: report.aggregatePassCompletionRate, meanPerScenarioPassCompletion: report.meanPerScenarioPassCompletion,
  meanPasses: report.meanPasses, meanShots: report.meanShots }, null, 2) + '\n');
if (scenarioCount === 100) assert.equal(scenarios.length, 100, 'all 100 real possession scenarios must run');
