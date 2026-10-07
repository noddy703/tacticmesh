const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');
require('../src/physics.js');
require('../src/rules.js');
require('../src/telemetry.js');
require('../src/labs.js');

const TF = globalThis.TF;
const names = ['2v1 overload', '3v2 transition', '4v4+3 possession', '6v4 build-up', 'Through ball', 'Low block', 'High press', 'Defensive transition'];
const metrics = {};

for (const name of names) {
  const match = TF.createMatch({ seed: name === 'Through ball' ? 11 : 2026, autoStart: true });
  TF.configureAIScenario(match, name);
  const meta = match.state.labScenarioMeta;
  assert.ok(match.rulesConfig.minPlayers < 7, name + ' must use small-sided lab competition rules');
  assert.ok(meta.fieldCounts.home > 0 && meta.fieldCounts.away > 0, name + ' must have actors on both teams');
  assert.equal(match.state.phase, 'open-play', name + ' must start in open play');
  const initialPositions = Object.fromEntries(match.teams.flatMap(t => t.activePlayers.map(p => [p.id, { x: p.position.x, y: p.position.y }])));
  const initialBallX = match.ball.position.x;
  const initialOwnerId = match.ball.ownerId;
  let throughKickCandidate = null;
  let selectedThroughBall = 0;
  let maxHomePress = 0;
  let maxAssignedPress = 0;
  let maxCover = 0;
  let maxScreen = 0;
  const transitionFrames = [];
  const lowBlockFrames = [];
  let lowBlockAcceptance = null;
  const candidateTypes = {};
  const selectedTypes = {};
  const observedPossessionIntents = new Set();
  const augment = TF.augmentCandidates;
  TF.augmentCandidates = function (candidates, context) {
    if (context.teamId === match.teams[0].id || context.teamId === match.teams[1].id) {
      const key = context.teamId + ':';
      for (const c of candidates) candidateTypes[key + c.type] = (candidateTypes[key + c.type] || 0) + 1;
    }
    return augment(candidates, context);
  };
  try {
    for (let i = 0; i < 600; i++) {
      match.tick++;
      TF.updateLabNeutrals(match);
      TF.updateTactics(match, TF.FIXED_DT);
      const observedOwner = match.ball.ownerId && match.playersById[match.ball.ownerId];
      if (observedOwner && observedOwner.team && observedOwner.team.intent) observedPossessionIntents.add(observedOwner.teamId + ':' + observedOwner.team.intent);
      const responsibilities = match.teams[0].activePlayers.map(p => TF.getTacticalContext(match, p).responsibilities);
      maxAssignedPress = Math.max(maxAssignedPress, responsibilities.filter(r => r.press).length);
      maxCover = Math.max(maxCover, responsibilities.filter(r => r.cover).length);
      maxScreen = Math.max(maxScreen, responsibilities.filter(r => r.screen).length);
      TF.updateAI(match, TF.FIXED_DT);
      let selectedThroughThisTick = null;
      if (name === 'Through ball') {
        const passer = match.teams[0].activePlayers.find(p => p.role === 'CM');
        const selected = passer && passer.intent && passer.intent.type === 'throughBall' ? passer.intent : null;
        if (selected) {
          const receiver = match.teams[0].activePlayers.find(p => p.id === selected.targetId);
          selectedThroughThisTick = { target: { x: selected.target.x, y: selected.target.y }, receiverId: selected.targetId, receiver: receiver && { x: receiver.position.x, y: receiver.position.y }, offsideRisk: selected.details && selected.details.offsideRisk };
        }
      }
      for (const team of match.teams) for (const p of team.activePlayers) if (p.intent) {
        selectedTypes[team.id + ':' + p.intent.type] = (selectedTypes[team.id + ':' + p.intent.type] || 0) + 1;
        if (team.id === match.teams[0].id && p.intent.type === 'throughBall') selectedThroughBall++;
      }
      maxHomePress = Math.max(maxHomePress, match.teams[0].activePlayers.filter(p => p.intent && p.intent.type === 'press').length);
      TF.updateWorld(match, TF.FIXED_DT);
      if (name === 'Low block') {
        const owner = match.ball.ownerId && match.playersById[match.ball.ownerId];
        if (owner && owner.teamId === match.teams[1].id) {
          const back = match.teams[0].activePlayers.filter(p => ['CB', 'LCB', 'RCB', 'LB', 'RB', 'DM'].includes(p.role));
          lowBlockFrames.push({
            meanLineX: back.reduce((sum, p) => sum + p.position.x, 0) / Math.max(1, back.length),
            meanCentralDeviation: back.reduce((sum, p) => sum + Math.abs(p.position.y - match.pitch.width / 2), 0) / Math.max(1, back.length),
            gaps: back.map(p => p.position.x).sort((a, b) => a - b)
          });
        }
      }
      if (name === 'Through ball' && selectedThroughThisTick) {
        const passer = match.teams[0].activePlayers.find(p => p.role === 'CM');
        const kick = match.events.find(e => e.type === 'pass' && e.playerId === passer.id && e.tick === match.tick && e.targetId === selectedThroughThisTick.receiverId);
        if (kick) throughKickCandidate = selectedThroughThisTick;
      }
      if (name === 'Defensive transition' && match.ball.ownerId && match.players.find(p => p.id === match.ball.ownerId)?.teamId === match.teams[1].id) {
        const central = match.teams[0].activePlayers.filter(p => ['CB', 'DM', 'CM'].includes(p.role));
        const deviation = central.reduce((s, p) => s + Math.abs(p.position.y - match.pitch.width / 2), 0) / Math.max(1, central.length);
        transitionFrames.push({ deviation, retreated: central.some(p => p.position.x < initialPositions[p.id].x - 1) });
      }
    }
  } finally {
    TF.augmentCandidates = augment;
  }
  assert.equal(match.tick, 600, name + ' must advance the complete 10-second window');
  assert.ok(match.clock.periodSeconds >= 9.99, name + ' must advance simulation time');
  assert.equal(match.state.finished, false, name + ' must not be abandoned or finished');
  for (const team of match.teams) for (const p of team.activePlayers) {
    assert.ok(Number.isFinite(p.position.x) && Number.isFinite(p.position.y), name + ' has invalid active actor position ' + p.id);
  }
  const movement = match.teams[0].activePlayers.reduce((sum, p) => {
    const start = initialPositions[p.id];
    return sum + (start ? Math.hypot(p.position.x - start.x, p.position.y - start.y) : 0);
  }, 0);
  assert.ok(movement > 0, name + ' actors must respond to the scenario');
  if (name === 'Through ball') {
    assert.ok(throughKickCandidate, 'passer must select an evaluated through-ball opportunity');
    assert.ok(throughKickCandidate.receiver && throughKickCandidate.target.x > throughKickCandidate.receiver.x, 'through-ball target must lead the onside runner');
    assert.ok(throughKickCandidate.offsideRisk < .25, 'through-ball candidate must recognize the high defensive line as playable');
    const passer = match.teams[0].activePlayers.find(p => p.role === 'CM');
    const throughKick = match.events.find(e => e.type === 'pass' && e.playerId === passer.id);
    assert.ok(throughKick, 'passer must physically strike the selected through-ball target');
    assert.ok(Math.hypot(throughKick.target.x - throughKickCandidate.target.x, throughKick.target.y - throughKickCandidate.target.y) < .1, 'physical kick must match the selected weighted future point');
    const releaseRecord = match.events.find(e => e.type === 'ball-played' && e.playerId === passer.id && e.tick === throughKick.tick);
    const releasedRunner = releaseRecord && releaseRecord.offside && releaseRecord.offside.candidates.find(c => c.playerId === throughKickCandidate.receiverId);
    assert.ok(releasedRunner && !releasedRunner.offside, 'runner must be onside at the actual release; a future ball target may cross the line');
    assert.equal(match.events.some(e => e.type === 'offside'), false, 'the released through-ball must not be flagged offside');
  }
  if (name === 'High press' || name === 'Defensive transition') {
    assert.ok(maxHomePress >= 1, name + ' must produce at least one selected presser in the transition window');
    assert.ok(maxHomePress <= 2, name + ' must keep actual simultaneous press intents to at most two');
    assert.ok(maxAssignedPress <= 2, name + ' must reserve at most two perceived press responsibilities');
    assert.ok(maxCover > 0 && maxScreen > 0, name + ' must assign cover and distant screen shape behind the press');
  }
  if (name === '4v4+3 possession') {
    assert.equal(meta.neutralSupport, 3, 'possession fixture must include three neutral support actors');
    assert.deepEqual(new Set(meta.patientPossessionTeams), new Set(match.teams.map(t => t.id)), 'possession fixture must explicitly configure both sides as patient profiles');
    for (const team of match.teams) {
      assert.ok(team.tactics.patience >= 0.8 && team.tactics.passingDirectness <= 0.3 && team.tactics.buildupRisk <= 0.25, 'possession fixture must configure patient, low-risk tactics for ' + team.id);
    }
    assert.ok(Array.from(observedPossessionIntents).some(key => key.endsWith(':retain')), 'observed possession phase must publish retain intent for the active patient side');
  }
  if (name === 'Low block') {
    assert.ok(meta.patientPossessionTeams.includes(match.teams[1].id), 'low-block attacker must use an explicit patient attacking profile');
    assert.ok(match.teams[1].tactics.patience >= 0.8 && observedPossessionIntents.has(match.teams[1].id + ':retain'), 'low-block attacking intent must be patient during observed possession');
    const defenders = match.teams[0].activePlayers.filter(p => ['CB', 'LCB', 'RCB', 'LB', 'RB', 'DM'].includes(p.role));
    assert.ok(defenders.length >= 2, 'low block fixture must retain a defensive line');
    assert.ok(meta.goalkeepers.home && meta.goalkeepers.away, 'low-block fixture must retain both keepers');
    assert.ok(defenders.some(p => p.role === 'DM'), 'low block must include a central screening midfielder');
    assert.ok(candidateTypes['away:pass'] > 0 && selectedTypes['away:carry'] > 0 && selectedTypes['home:recover'] > 0, 'low-block window must exercise attacking pass options, carrier decisions, and defending recovery');
    assert.ok(lowBlockFrames.length > 20, 'low block must spend a measured window defending actual opponent possession');
    const compactFrames = lowBlockFrames.filter(frame => frame.meanLineX >= 17 && frame.meanLineX <= 42 && frame.meanCentralDeviation <= 17);
    assert.ok(compactFrames.length / lowBlockFrames.length >= 0.6, 'low-block back four plus screen must remain compact during live defending');
    const actualAwayPasses = match.events.filter(e => e.type === 'pass' && e.teamId === match.teams[1].id).length;
    const actualHomeRecoveries = match.events.filter(e => e.type === 'ball-control' && e.teamId === match.teams[0].id).length;
    assert.ok(actualAwayPasses >= 1, 'low-block probe must record an actual physical pass rather than only passing candidates');
    lowBlockAcceptance = { goalkeepers: meta.goalkeepers, lowBlockDefendingFrames: lowBlockFrames.length,
      compactShapeFrames: compactFrames.length, compactShapeRatio: +(compactFrames.length / lowBlockFrames.length).toFixed(3), actualAwayPasses, actualHomeRecoveries };
  }
  let counterRunners = 0, centralRecovery = false;
  if (name === 'Defensive transition') {
    counterRunners = match.teams[1].activePlayers.filter(p => !p.isGoalkeeper && p.id !== initialOwnerId && initialPositions[p.id] && initialPositions[p.id].x - p.position.x > 5).length;
    const central = match.teams[0].activePlayers.filter(p => ['CB', 'DM', 'CM'].includes(p.role));
    const startDeviation = central.reduce((s, p) => s + Math.abs(initialPositions[p.id].y - match.pitch.width / 2), 0) / Math.max(1, central.length);
    // Assess the actual transition while the opponent has the ball. The final
    // snapshot can be after home has regained possession, when the same players
    // should leave their defensive recovery positions and support the attack.
    const recoveredInTransition = transitionFrames.some(frame => frame.deviation < startDeviation - 0.35 && frame.retreated);
    centralRecovery = recoveredInTransition;
    assert.ok(counterRunners > 0, 'opponent possession after the turnover must trigger forward counter runs');
    assert.ok(centralRecovery && selectedTypes['home:recover'] > 0, 'defending midfield/centre-backs must recover centrally during the opponent-possession transition window');
  }
  const initialCarrier = match.playersById[initialOwnerId];
  const attackDirection = initialCarrier && initialCarrier.team ? initialCarrier.team.attackDirection : 1;
  // Measure pitch-axis gain along the initial carrier's attacking direction.
  // This is physical ball position, not an intent's target coordinate.
  const ballProgress = (match.ball.position.x - initialBallX) * attackDirection;
  metrics[name] = Object.assign({
    seconds: +match.clock.periodSeconds.toFixed(2), fieldCounts: meta.fieldCounts,
    passes: match.telemetry.passes || 0, shots: match.telemetry.shots || 0,
    movement: +movement.toFixed(1), maxPress: maxHomePress,
    throughCandidate: !!throughKickCandidate, throughSelectedTicks: selectedThroughBall,
    maxAssignedPress, maxCover, maxScreen, ballProgress: +ballProgress.toFixed(1), counterRunners, centralRecovery,
    candidateTypes: Object.fromEntries(Object.entries(candidateTypes).filter(([key]) => key.endsWith(':switch') || key.endsWith(':support') || key.endsWith(':pass') || key.endsWith(':carry') || key.endsWith(':throughBall'))),
    selectedTypes: Object.fromEntries(Object.entries(selectedTypes).filter(([key]) => key.endsWith(':press') || key.endsWith(':recover') || key.endsWith(':support') || key.endsWith(':switch') || key.endsWith(':pass') || key.endsWith(':carry') || key.endsWith(':throughBall')))
  }, lowBlockAcceptance || {});
}

function keeperProfile(sweeping) {
  const match = TF.createMatch({ seed: 713, matchId: 'keeper-profile-' + sweeping, autoStart: true });
  match.state.phase = 'open-play'; match.state.restartType = null; match.state.restartTeamId = null;
  const keeper = match.teams[0].activePlayers.find(p => p.isGoalkeeper);
  keeper.position.x = keeper.previousPosition.x = 5; keeper.position.y = keeper.previousPosition.y = 34;
  keeper.facing.x = 1; keeper.facing.y = 0; keeper.attributes.sweeping = sweeping;
  // A reachable, loose trajectory isolates the sweeper decision from the
  // motor's physical reach limit; the conservative profile should still hold.
  match.ball.position = match.ball.previousPosition = { x: 8, y: 35, z: .3 };
  match.ball.velocity = { x: -3, y: .5, z: 0 }; match.ball.ownerId = null;
  let interceptCandidate = false;
  let selectedIntercept = false;
  const augment = TF.augmentCandidates;
  TF.augmentCandidates = function (candidates, context) {
    if (context.self.id === keeper.id) interceptCandidate = interceptCandidate || candidates.some(c => c.type === 'intercept');
    return augment(candidates, context);
  };
  try {
    for (let i = 0; i < 40; i++) {
      match.tick++; TF.updateTactics(match, TF.FIXED_DT); TF.updateAI(match, TF.FIXED_DT);
      selectedIntercept = selectedIntercept || keeper.intent && keeper.intent.type === 'intercept';
      TF.updateWorld(match, TF.FIXED_DT);
    }
  } finally { TF.augmentCandidates = augment; }
  return { intent: keeper.intent && keeper.intent.type, interceptCandidate, selectedIntercept, x: keeper.position.x, events: match.events.map(e => e.type) };
}
const sweeper = keeperProfile(95), conservative = keeperProfile(10);
assert.equal(sweeper.selectedIntercept, true, 'sweeper goalkeeper must choose to attack a perceived loose ball');
assert.equal(sweeper.interceptCandidate, true, 'sweeper goalkeeper must evaluate a reachable loose-ball interception');
assert.ok(sweeper.events.some(type => type === 'keeper-punch' || type === 'keeper-catch'), 'selected sweep did not produce physical keeper contact');
assert.equal(conservative.interceptCandidate, false, 'conservative goalkeeper must reject the same ball outside its sweep envelope');
assert.equal(conservative.selectedIntercept, false, 'conservative goalkeeper selected an interception outside its envelope');

// The formation lab override is exercised through the same tactical API the visible lab uses.
const lab = TF.createMatch({ seed: 91 });
TF.configureFormationLab(lab, '3-5-2', '4-2-3-1', 'attackingTransition');
TF.updateTactics(lab, TF.FIXED_DT);
const labActor = lab.teams[0].activePlayers.find(p => p.role === 'ST');
labActor.beliefState = { updatedTick: 1, ball: { estimatedPosition: { x: 82, y: 34 }, position: { x: 82, y: 34 }, ownerId: null, confidence: .9, ageTicks: 0 }, entities: {} };
assert.equal(TF.getTacticalContext(lab, labActor).phase, 'attackingTransition', 'phase selector must change tactical context');
const firstShape = TF.getTacticalContext(lab, labActor).anchor;
const firstSlots = lab.teams[0].activePlayers.map(p => [p.id, p.formationSlot.x, p.formationSlot.y]);
TF.configureFormationLab(lab, '3-5-2', '3-5-2', 'organizedDefensiveBlock');
TF.updateTactics(lab, TF.FIXED_DT);
const secondActor = lab.teams[0].activePlayers.find(p => p.role === 'ST');
secondActor.beliefState = { updatedTick: 1, ball: { estimatedPosition: { x: 82, y: 34 }, position: { x: 82, y: 34 }, ownerId: null, confidence: .9, ageTicks: 0 }, entities: {} };
const secondShape = TF.getTacticalContext(lab, secondActor).anchor;
assert.equal(TF.getTacticalContext(lab, secondActor).phase, 'organizedDefensiveBlock', 'phase selector must change defensive context');
assert.ok(Math.hypot(firstShape.x - secondShape.x, firstShape.y - secondShape.y) > .5, 'phase selector must change the observed tactical anchor');
TF.configureFormationLab(lab, '4-4-2', '3-5-2', 'organizedDefensiveBlock');
assert.ok(lab.teams[0].activePlayers.some(p => { const before = firstSlots.find(row => row[0] === p.id); return before && Math.hypot(p.formationSlot.x - before[1], p.formationSlot.y - before[2]) > 1; }), 'formation selector must change visible player anchors');

process.stdout.write('Named scenario fixture smoke passed (full physics/rules/telemetry steps):\n' + JSON.stringify(metrics, null, 2) + '\nKeeper profile choices: ' + JSON.stringify({ sweeper: { intent: sweeper.intent, interceptCandidate: sweeper.interceptCandidate }, conservative: { intent: conservative.intent, interceptCandidate: conservative.interceptCandidate } }) + '\n');
