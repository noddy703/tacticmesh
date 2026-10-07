const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');
require('../src/physics.js');
require('../src/rules.js');
require('../src/telemetry.js');
const TF = globalThis.TF;

// Exercise one real core tick through tactical context, local perception,
// player intent/motor handoff, and physical movement toward that intent.
const pipelineMatch = TF.createMatch({ seed: 4, halfSeconds: 90, matchId: 'layer-handoff' });
pipelineMatch.state.phase = 'open-play';
pipelineMatch.state.restartType = null;
pipelineMatch.state.restartTeamId = null;
const actor = pipelineMatch.playersById['home-p09'];
// Start visibly displaced from its normal home region so a stationary action
// cannot accidentally satisfy the movement portion of this handoff test.
actor.position = { x: 60, y: 50, z: 0 };
actor.previousPosition = { x: 60, y: 50, z: 0 };
const initial = { x: actor.position.x, y: actor.position.y };
const order = [];
const originalTactics = TF.updateTactics, originalAI = TF.updateAI, originalWorld = TF.updateWorld;
let movement = null;
TF.updateTactics = function (match, dt) { originalTactics(match, dt); order.push('tactics'); };
TF.updateAI = function (match, dt) {
  originalAI(match, dt);
  assert.equal(actor.beliefState.updatedTick, match.tick, 'perception is current at the decision stage');
  assert.ok(Object.keys(actor.beliefState.entities).length > 0, 'actor has locally observed entities');
  assert.ok(actor.intent && actor.intent.target && actor.ai.lastDecision === match.tick, 'AI turns perceived state into a player intent');
  assert.equal(actor.motor, actor.intent, 'committed intent is handed to the motor controller');
  order.push('decision');
};
TF.updateWorld = function (match, dt) {
  originalWorld(match, dt);
  movement = { x: actor.position.x - initial.x, y: actor.position.y - initial.y };
  order.push('world');
};
try {
  TF.createCore({ match: pipelineMatch, renderSnapshots: false }).step(1);
} finally {
  TF.updateTactics = originalTactics;
  TF.updateAI = originalAI;
  TF.updateWorld = originalWorld;
}
assert.deepEqual(order, ['tactics', 'decision', 'world']);
const desired = { x: actor.intent.target.x - initial.x, y: actor.intent.target.y - initial.y };
assert.ok(Math.hypot(desired.x, desired.y) > 1, 'the selected target is meaningfully away from the actor');
assert.ok(movement.x * desired.x + movement.y * desired.y > 0, 'physics moves the player toward the selected motor target');

// Decisions run on deterministic 6–12 fixed-tick intervals (5–10 Hz) while
// movement/physics continue at every 60 Hz simulation tick.
const cadenceMatch = TF.createMatch({ seed: 4011, halfSeconds: 90, matchId: 'staggered-ai-cadence' });
cadenceMatch.state.phase = 'open-play'; cadenceMatch.state.restartType = null;
const cadenceCore = TF.createCore({ match: cadenceMatch, renderSnapshots: false });
const activeCadencePlayers = cadenceMatch.players.filter(p => p.active);
assert.equal(activeCadencePlayers.length, 22);
const decisionTicks = Object.fromEntries(activeCadencePlayers.map(p => [p.id, []]));
for (let i = 0; i < 120; i++) {
  cadenceCore.step(1);
  for (const player of activeCadencePlayers) if (player.ai && player.ai.lastDecision === cadenceMatch.tick) decisionTicks[player.id].push(cadenceMatch.tick);
}
const gaps = [];
for (const ticks of Object.values(decisionTicks)) {
  assert.ok(ticks.length >= 5, 'each active player gets repeated deliberation opportunities');
  for (let i = 1; i < ticks.length; i++) gaps.push(ticks[i] - ticks[i - 1]);
}
assert.ok(gaps.length > 200 && Math.min(...gaps) >= 6 && Math.max(...gaps) <= 12, 'staggered decisions stay within the 5–10 Hz band');

// Sample 100 seeded generation runs: squad shape, positional archetypes,
// complete profiles, within-role skill correlation, and credible exceptions.
const ATTRIBUTE_GROUPS = {
  physical: ['acceleration', 'sprintSpeed', 'agility', 'turning', 'balance', 'strength', 'stamina', 'jumping', 'reach', 'recoverySpeed'],
  technical: ['firstTouch', 'shortPassing', 'longPassing', 'throughBalls', 'crossing', 'shooting', 'finishing', 'heading', 'dribbling', 'ballCarrying', 'tackling', 'interception', 'weakFoot'],
  mental: ['awareness', 'vision', 'anticipation', 'decisionMaking', 'composure', 'positioning', 'teamwork', 'creativity', 'concentration', 'discipline', 'aggression', 'workRate', 'offBallIntelligence'],
  goalkeeper: ['handling', 'reflexes', 'catching', 'parrying', 'diving', 'oneOnOne', 'aerialCommand', 'sweeping', 'throwing', 'kicking']
};
const TRAITS = ['riskAppetite', 'directness', 'patience', 'selfishness', 'roaming', 'pressingEnthusiasm', 'receiveToFeet', 'attackSpace', 'earlyCrossing', 'dribbleTendency', 'longShotTendency', 'conservativePassing', 'switchPlay', 'weakFootUse'];
const roleSamples = new Map();
let skillExceptionCount = 0, samplePlayers = 0;
const strikerFinishing = [], defenderFinishing = [], goalkeeperHandling = [], outfieldHandling = [];
const observedSquadSizes = new Set();
for (let seed = 20261020; seed < 20261120; seed++) {
  const match = TF.createMatch({ seed, matchId: 'generation-cohort-' + seed });
  assert.equal(match.pitch.length, 105); assert.equal(match.pitch.width, 68);
  assert.equal(match.players.length, match.teams.reduce((n, team) => n + team.players.length, 0));
  for (const team of match.teams) {
    observedSquadSizes.add(team.players.length);
    assert.ok(team.players.length >= 18 && team.players.length <= 20, team.id + ' squad is between 18–20');
    assert.equal(team.activePlayers.length, 11, team.id + ' selects 11 active players');
    assert.equal(team.bench.length, team.players.length - 11, team.id + ' has a bench');
    assert.equal(team.activePlayers.filter(p => p.isGoalkeeper).length, 1, team.id + ' selects one starting goalkeeper');
    assert.equal(new Set(team.players.map(p => p.id)).size, team.players.length, team.id + ' player IDs are unique');
    for (const player of team.players) {
      samplePlayers++;
      assert.ok(player.positionFamily && player.role && player.formationSlot, 'player has an assigned family, role, and slot');
      assert.ok(player.name && Number.isFinite(player.age) && Number.isFinite(player.height) && player.preferredFoot, 'player profile has identity and physical fields');
      for (const group of Object.values(ATTRIBUTE_GROUPS)) for (const key of group) {
        assert.ok(Number.isFinite(player.attributes[key]), player.id + ' has ' + key);
        const minimum = player.positionFamily !== 'GK' && ATTRIBUTE_GROUPS.goalkeeper.includes(key) ? 10 : 20;
        assert.ok(player.attributes[key] >= minimum && player.attributes[key] <= 99, player.id + ' has plausible ' + key);
      }
      for (const trait of TRAITS) assert.ok(Number.isFinite(player.traits[trait]) && player.traits[trait] >= 0.2 && player.traits[trait] <= 0.8, player.id + ' has bounded ' + trait);
      if (Math.abs(player.attributes.firstTouch - player.attributes.shortPassing) >= 20) skillExceptionCount++;
      if (player.positionFamily === 'FWD') strikerFinishing.push(player.attributes.finishing);
      if (player.positionFamily === 'DEF') defenderFinishing.push(player.attributes.finishing);
      if (player.positionFamily === 'GK') goalkeeperHandling.push(player.attributes.handling);
      else outfieldHandling.push(player.attributes.handling);
      if (!roleSamples.has(player.role)) roleSamples.set(player.role, []);
      roleSamples.get(player.role).push([player.attributes.firstTouch, player.attributes.shortPassing]);
    }
  }
}
assert.deepEqual([...observedSquadSizes].sort(), [18, 19, 20], 'the 100-seed cohort exercises all supported squad sizes');
assert.ok(samplePlayers >= 3600, 'the cohort covers thousands of generated players');
assert.ok(skillExceptionCount > 50, 'independent skill residuals allow plausible player-level exceptions');
const average = values => values.reduce((sum, n) => sum + n, 0) / values.length;
assert.ok(average(strikerFinishing) > average(defenderFinishing) + 4, 'forward archetypes have stronger finishing on average without forcing identical player profiles');
assert.ok(average(goalkeeperHandling) > average(outfieldHandling) + 30, 'goalkeeper handling profile is distinct from outfield players');
let cov = 0, varA = 0, varB = 0, count = 0;
for (const values of roleSamples.values()) {
  const meanA = values.reduce((s, v) => s + v[0], 0) / values.length;
  const meanB = values.reduce((s, v) => s + v[1], 0) / values.length;
  for (const [a, b] of values) { const da = a - meanA, db = b - meanB; cov += da * db; varA += da * da; varB += db * db; count++; }
}
const withinRoleCorrelation = cov / Math.sqrt(varA * varB);
assert.ok(count > 3500 && withinRoleCorrelation > 0.05, 'related technical attributes retain positive within-role correlation');

process.stdout.write(`foundation contracts pass (layer handoff, ${gaps.length} staggered decision intervals, ${samplePlayers} generated players, within-role skill r=${withinRoleCorrelation.toFixed(2)}, ${skillExceptionCount} skill exceptions)\n`);
