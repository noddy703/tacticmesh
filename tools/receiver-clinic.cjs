const fs = require('node:fs');
const path = require('node:path');
for (const file of ['core', 'world', 'tactics', 'intelligence', 'physics', 'rules', 'telemetry']) require(path.resolve(__dirname, '..', 'src', file + '.js'));
const TF = globalThis.TF;
const sourceVersion = require('./version.cjs');
const seedBase = 20261060;
const durationSeconds = Math.max(3, Number(process.env.TF_RECEIVER_SECONDS) || 7);
const outPath = process.argv.includes('--out') ? path.resolve(process.argv[process.argv.indexOf('--out') + 1]) : null;

function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
function scenarioGrid() {
  const cases = [];
  for (const distance of [10, 14, 18]) for (const receiverLead of [4, 8])
    for (const facing of ['toward-target', 'toward-passer']) for (const skill of [40, 80])
      for (const pressure of ['clear', 'pressured']) cases.push({ distance, receiverLead, facing, skill, pressure });
  return cases;
}
function stage(seed, scenario) {
  const match = TF.createMatch({ seed, halfSeconds: 2700, matchId: 'receiver-clinic-' + seed });
  const home = match.teams[0], away = match.teams[1], homePlayers = home.activePlayers, awayPlayers = away.activePlayers;
  const passer = homePlayers[6], receiver = homePlayers[8];
  const target = { x: 35 + scenario.distance, y: 34 };
  // Keep every non-target teammate off the intended flight lane while still
  // leaving all eleven active. The previous DM staging at x39,y34 collected
  // the pass before the named receiver in almost every case.
  const homePositions = [[5,34],[20,25],[20,43],[25,7],[25,61],[28,17],[35,34],[25,56],[35 + scenario.receiverLead,34],[21,10],[25,50]];
  const awayPositions = [[100,34],[81,27],[81,41],[79,13],[79,55],[67,34],[70,22],[70,46],[75,60],[75,8],[80,34]];
  homePlayers.forEach((p, index) => {
    p.position.x = p.previousPosition.x = homePositions[index][0]; p.position.y = p.previousPosition.y = homePositions[index][1];
    p.position.z = p.previousPosition.z = 0; p.velocity.x = p.velocity.y = p.velocity.z = 0;
    p.facing.x = 1; p.facing.y = 0; p.stamina = 1;
  });
  awayPlayers.forEach((p, index) => {
    p.position.x = p.previousPosition.x = awayPositions[index][0]; p.position.y = p.previousPosition.y = awayPositions[index][1];
    p.position.z = p.previousPosition.z = 0; p.velocity.x = p.velocity.y = p.velocity.z = 0;
    p.facing.x = -1; p.facing.y = 0; p.stamina = 1;
  });
  if (scenario.pressure === 'pressured') {
    const defender = awayPlayers[5];
    defender.position.x = defender.previousPosition.x = target.x - 3;
    defender.position.y = defender.previousPosition.y = target.y + 1;
    defender.facing.x = -1; defender.facing.y = 0;
  }
  const quality = scenario.skill;
  for (const name of ['firstTouch', 'balance', 'agility', 'acceleration', 'sprintSpeed', 'awareness', 'vision', 'concentration', 'anticipation', 'offBallIntelligence']) receiver.attributes[name] = quality;
  receiver.facing.x = scenario.facing === 'toward-target' ? 1 : -1;
  receiver.facing.y = 0;
  passer.facing.x = 1; passer.facing.y = 0;
  match.state.phase = 'open-play'; match.state.restartType = null; match.state.restartTeamId = null; match.state.possessionTeamId = home.id;
  match.ball.position = { x: passer.position.x + 0.42, y: passer.position.y, z: 0.11 };
  match.ball.previousPosition = { ...match.ball.position };
  match.ball.velocity = { x: 0, y: 0, z: 0 }; match.ball.ownerId = passer.id; match.ball.controlState = 'controlled';
  match.ball.lastTouchPlayerId = passer.id; match.ball.lastTouchTeamId = home.id;
  return { match, passer, receiver, home, away, target };
}
function classify(match, passer, receiver, startedAt) {
  const events = match.events.slice(startedAt), control = events.find(e => e.type === 'ball-control' || e.type === 'keeper-collection');
  if (control) {
    const playerId = control.playerId || control.keeperId;
    const actor = match.playersById[playerId];
    if (playerId === receiver.id) return { outcome: 'intended-receiver-control', receiverId: playerId, teamId: actor && actor.teamId };
    if (actor && actor.teamId === receiver.teamId) return { outcome: 'other-teammate-control', receiverId: playerId, teamId: actor.teamId };
    return { outcome: 'opponent-control', receiverId: playerId || null, teamId: actor && actor.teamId };
  }
  const restart = events.find(e => e.type === 'restart-awarded');
  if (restart) return { outcome: 'dead-ball-or-out', restartType: restart.restartType || null, teamId: restart.teamId || null };
  const kick = events.find(e => e.type === 'pass' && e.playerId === passer.id);
  if (!kick) return { outcome: 'kick-not-executed' };
  return { outcome: 'unresolved-at-limit' };
}
function runCase(scenario, index) {
  const seed = seedBase + index;
  const { match, passer, receiver, home, away, target } = stage(seed, scenario);
  const eventsAtStart = match.events.length;
  let kick = null;
  const maxTicks = Math.round(durationSeconds * 60);
  for (let i = 0; i < maxTicks; i++) {
    match.tick += 1;
    TF.updateTactics(match, TF.FIXED_DT);
    TF.updateAI(match, TF.FIXED_DT);
    // The clinic authors only the pass attempt. The receiver remains under
    // ordinary belief, movement, execution, and physical-control systems.
    if (!kick && match.ball.ownerId === passer.id) {
      const command = { type: 'pass', action: 'pass', target: target, targetId: receiver.id, ballTarget: target,
        desiredSpeed: 0, power: clamp(scenario.distance / 35, 0.22, 0.75), lift: 0,
        createdTick: match.tick, commitUntilTick: match.tick + 24, expiresTick: match.tick + 30, details: { targetId: receiver.id, clinicAuthored: true } };
      passer.intent = passer.motor = passer.currentAction = command;
      passer.action = 'pass'; passer.movementTarget = command.target;
    }
    TF.updateWorld(match, TF.FIXED_DT);
    kick = match.events.find(e => e.type === 'pass' && e.playerId === passer.id) || kick;
    if (kick && match.events.slice(eventsAtStart).some(e => e.type === 'ball-control' || e.type === 'keeper-collection' || e.type === 'restart-awarded')) break;
  }
  const result = classify(match, passer, receiver, eventsAtStart);
  return Object.assign({ seed, sourceVersion, scenario: scenario, ticks: match.tick, kickExecuted: !!kick,
    kickTarget: kick && kick.target || null, receiver: { id: receiver.id, finalPosition: { x: Number(receiver.position.x.toFixed(2)), y: Number(receiver.position.y.toFixed(2)) }, finalIntent: receiver.intent && receiver.intent.type || null },
    ball: { position: { x: Number(match.ball.position.x.toFixed(2)), y: Number(match.ball.position.y.toFixed(2)) }, speed: Number(Math.hypot(match.ball.velocity.x, match.ball.velocity.y).toFixed(2)) } }, result);
}
function main() {
  const scenarios = scenarioGrid(), cases = scenarios.map(runCase), outcomes = {};
  for (const item of cases) outcomes[item.outcome] = (outcomes[item.outcome] || 0) + 1;
  const by = (key, val) => {
    const group = cases.filter(c => c.scenario[key] === val), counts = {};
    group.forEach(c => counts[c.outcome] = (counts[c.outcome] || 0) + 1);
    return { cases: group.length, outcomes: counts };
  };
  const report = { kind: 'physical-receiver-clinic', sourceVersion, seedPolicy: seedBase + ' + caseIndex', scenarioCount: cases.length,
    durationSeconds, passAttemptAuthored: true, receiverControlForced: false,
    factors: { distanceMeters: [10,14,18], receiverStartLeadMeters: [4,8], bodyFacing: ['toward-target','toward-passer'], receiverSkill: [40,80], pressure: ['clear','pressured'] },
    outcomes, byFacing: Object.fromEntries(['toward-target','toward-passer'].map(v => [v,by('facing',v)])),
    byPressure: Object.fromEntries(['clear','pressured'].map(v => [v,by('pressure',v)])),
    bySkill: Object.fromEntries(['40','80'].map(v => [v,by('skill',Number(v))])), cases };
  const output = JSON.stringify(report, null, 2) + '\n';
  if (outPath) { fs.mkdirSync(path.dirname(outPath), { recursive: true }); fs.writeFileSync(outPath, output); }
  process.stdout.write(output);
}
main();
