const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');
const TF = globalThis.TF;

function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < String(text).length; i += 1) { value ^= String(text).charCodeAt(i); value = Math.imul(value, 16777619); }
  return value >>> 0;
}

function recoveryTargets({ defendingSide, threatDepth, actualThreatDepth = threatDepth, seed = 93001 }) {
  const match = TF.createMatch({ seed, homeFormation: '4-3-3', awayFormation: '4-3-3' });
  const defending = match.teams.find(team => team.side === defendingSide);
  const attacking = match.teams.find(team => team.id !== defending.id);
  const dir = defending.attackDirection;
  const ownGoalX = dir > 0 ? 0 : match.pitch.length;
  const attacker = attacking.activePlayers.find(player => player.role === 'ST');
  const hiddenOwner = attacking.activePlayers.find(player => player !== attacker && player.role !== 'GK');
  const observed = { x: ownGoalX + dir * threatDepth, y: match.pitch.width / 2 };
  attacker.position.x = ownGoalX + dir * actualThreatDepth;
  attacker.position.y = 8;
  match.ball.ownerId = hiddenOwner.id;
  match.ball.position.x = ownGoalX + dir * 40;
  match.ball.position.y = 8;
  match.state.phase = 'open-play';
  match.state.restartType = null;
  match.state.restartTeamId = null;
  match.tick = 1;

  const roles = ['RCB', 'DM', 'RB'];
  const result = {};
  for (const role of roles) {
    const defender = defending.activePlayers.find(player => player.role === role);
    const scanCycle = TF.getPerceptionScanInterval(defender, match);
    const scanPhase = hash(defender.id) % scanCycle;
    let tick = 1;
    while ((tick + scanPhase) % scanCycle === 0) tick += 1;
    match.tick = tick;
    defender.ai = { nextDecision: tick, lastDecision: tick - 1 };
    defender.beliefState = {
      updatedTick: tick,
      lastScanTick: tick - 1,
      ball: {
        position: { x: observed.x, y: observed.y, z: 0.11 },
        estimatedPosition: { x: observed.x, y: observed.y },
        velocity: { x: 0, y: 0, z: 0 },
        confidence: 0.96,
        baseConfidence: 0.96,
        ageTicks: 0,
        observedTick: tick,
        ownerId: attacker.id,
        lastTouchTeamId: attacking.id
      },
      entities: {
        [attacker.id]: {
          id: attacker.id,
          teamId: attacking.id,
          role: 'ST',
          position: { x: observed.x, y: observed.y },
          estimatedPosition: { x: observed.x, y: observed.y },
          velocity: { x: 0, y: 0 },
          facing: { x: -dir, y: 0 },
          confidence: 0.96,
          baseConfidence: 0.96,
          ageTicks: 0,
          observedTick: tick,
          source: 'vision'
        }
      }
    };
    let candidates = null;
    const originalAugment = TF.augmentCandidates;
    TF.augmentCandidates = function (list, context) {
      if (context.self.id === defender.id) candidates = list;
      return originalAugment(list, context);
    };
    try { TF.updateAI(match, TF.FIXED_DT); } finally { TF.augmentCandidates = originalAugment; }
    const recovery = candidates && candidates.find(candidate => candidate.type === 'recover');
    assert.ok(recovery, `${defendingSide} ${role} did not produce a recovery candidate`);
    result[role] = { target: recovery.target, intent: defender.intent, ownGoalX, dir, threatDepth };
  }
  return result;
}

for (const side of ['home', 'away']) {
  const deep = recoveryTargets({ defendingSide: side, threatDepth: 5.5, actualThreatDepth: 42 });
  for (const role of ['RCB', 'DM', 'RB']) {
    const item = deep[role];
    const targetProgress = (item.target.x - item.ownGoalX) * item.dir;
    assert.ok(targetProgress < item.threatDepth - 0.5,
      `${side} ${role} blended recovery target stayed field-side of the locally observed deep carrier: ${targetProgress.toFixed(2)}m vs ${item.threatDepth}m`);
    assert.equal(item.intent.type, 'recover', `${side} ${role} did not use its observed recovery option`);
  }
  const lateralTargets = ['RCB', 'DM', 'RB'].map(role => deep[role].target.y);
  assert.ok(Math.max(...lateralTargets) - Math.min(...lateralTargets) > 8,
    `${side} deep recovery collapsed distinct center, screen, and wide roles into one lateral lane`);

  const normal = recoveryTargets({ defendingSide: side, threatDepth: 35, actualThreatDepth: 42, seed: side === 'home' ? 93002 : 93003 });
  for (const role of ['RCB', 'DM', 'RB']) {
    const item = normal[role];
    const targetProgress = (item.target.x - item.ownGoalX) * item.dir;
    assert.ok(targetProgress > 8 && targetProgress < item.threatDepth,
      `${side} ${role} normal defensive recovery collapsed toward goal or drifted field-side: ${targetProgress.toFixed(2)}m`);
  }
}

const visibleTruth = recoveryTargets({ defendingSide: 'away', threatDepth: 5.5, actualThreatDepth: 42, seed: 93004 });
const hiddenTruthChanged = recoveryTargets({ defendingSide: 'away', threatDepth: 5.5, actualThreatDepth: 18, seed: 93004 });
assert.deepEqual(
  Object.fromEntries(['RCB', 'DM', 'RB'].map(role => [role, visibleTruth[role].target])),
  Object.fromEntries(['RCB', 'DM', 'RB'].map(role => [role, hiddenTruthChanged[role].target])),
  'deep recovery target used hidden physical carrier position instead of the defender’s fresh local observation');

process.stdout.write('deep-carrier recovery stays goal-side after anchor blending, mirrors both ends, retains role spacing, and uses local belief only\n');
