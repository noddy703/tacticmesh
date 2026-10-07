const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');

const TF = globalThis.TF;
const dt = 1 / 60;

function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < String(text).length; i += 1) {
    value ^= String(text).charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function fixture() {
  const match = TF.createMatch({ seed: 721, homeFormation: '4-3-3', awayFormation: '4-3-3', matchId: 'hidden-team-belief' });
  const home = match.teams.find((team) => team.side === 'home');
  const carrier = home.activePlayers.find((player) => player.role === 'ST');
  const dir = carrier.team.attackDirection;
  carrier.position.x = dir > 0 ? 72 : 33;
  carrier.position.y = 34;
  carrier.facing.x = dir;
  carrier.facing.y = 0;
  carrier.attributes.awareness = 90;
  carrier.attributes.vision = 75;
  carrier.attributes.decisionMaking = 75;
  carrier.attributes.anticipation = 70;
  carrier.attributes.offBallIntelligence = 70;
  match.ball.position.x = carrier.position.x + dir * 0.45;
  match.ball.position.y = carrier.position.y;
  match.ball.ownerId = carrier.id;
  carrier.hasBall = true;

  home.activePlayers.forEach((player, index) => {
    if (player === carrier || player.isGoalkeeper) return;
    player.position.x = carrier.position.x - dir * (4 + (index % 3) * 3);
    player.position.y = 22 + (index % 5) * 6;
  });
  const away = match.teams.find((team) => team.id !== home.id);
  away.activePlayers.forEach((player, index) => {
    player.position.x = dir > 0 ? 5 + index : 100 - index;
    player.position.y = index * 4 + 3;
  });

  match.tick = 1;
  TF.updateAI(match, dt); // Initial scan and candidate record.
  return { match, carrier, home };
}

function passTargets(carrier) {
  return carrier.ai.decisionExplanation.candidates
    .filter((candidate) => ['pass', 'throughBall', 'switch', 'cross', 'cutback'].includes(candidate.type))
    .map((candidate) => candidate.targetId)
    .filter(Boolean)
    .sort();
}

function decisionWithoutScan(f) {
  const cycle = TF.getPerceptionScanInterval(f.carrier, f.match);
  const phase = hash(f.carrier.id) % cycle;
  let tick = 2;
  while ((tick + phase) % cycle === 0) tick += 1;
  f.match.tick = tick;
  for (const player of f.match.players) {
    player.ai = player.ai || {};
    player.ai.nextDecision = 999999;
  }
  f.carrier.ai.nextDecision = tick;
  TF.updateAI(f.match, dt);
  return tick;
}

// The twins hold identical local beliefs. Only one world's currently hidden
// affiliation changes; that truth must not change the carrier's alternatives.
const control = fixture();
const hiddenChange = fixture();
const target = control.home.activePlayers.find((player) => player !== control.carrier
  && control.carrier.beliefState.entities[player.id]);
assert.ok(target, 'fixture carrier observed a teammate');
const changedTarget = hiddenChange.match.players.find((player) => player.id === target.id);
assert.ok(hiddenChange.carrier.beliefState.entities[target.id], 'twin carrier has the same teammate belief');
assert.deepEqual(hiddenChange.carrier.beliefState, control.carrier.beliefState, 'initial actor-local beliefs are identical');
changedTarget.teamId = 'away'; // Simulate unseen neutral affiliation change in the world.

const decisionTick = decisionWithoutScan(control);
assert.equal(decisionWithoutScan(hiddenChange), decisionTick, 'twin carrier decisions use the same tick');
assert.equal(hiddenChange.carrier.beliefState.entities[target.id].teamId, control.carrier.teamId,
  'hidden affiliation does not rewrite remembered teammate identity');
assert.deepEqual(hiddenChange.carrier.beliefState, control.carrier.beliefState,
  'hidden affiliation does not change actor belief state');
assert.deepEqual(passTargets(hiddenChange.carrier), passTargets(control.carrier),
  'hidden affiliation does not change teammate pass alternatives');
assert.ok(passTargets(control.carrier).includes(target.id), 'observed teammate is considered as a pass target');

// Positive control: once a later vision scan observes the changed affiliation,
// the teammate must stop appearing among pass alternatives.
changedTarget.position.x = hiddenChange.carrier.position.x + hiddenChange.carrier.team.attackDirection * 5;
changedTarget.position.y = hiddenChange.carrier.position.y;
hiddenChange.carrier.facing.x = hiddenChange.carrier.team.attackDirection;
hiddenChange.carrier.facing.y = 0;
const cycle = TF.getPerceptionScanInterval(hiddenChange.carrier, hiddenChange.match);
const phase = hash(hiddenChange.carrier.id) % cycle;
let scanTick = decisionTick + 1;
while ((scanTick + phase) % cycle !== 0) scanTick += 1;
hiddenChange.match.tick = scanTick;
hiddenChange.carrier.ai.nextDecision = scanTick;
TF.updateAI(hiddenChange.match, dt);
assert.equal(hiddenChange.carrier.beliefState.entities[target.id].teamId, 'away',
  'visible affiliation change updates remembered teammate metadata');
assert.ok(hiddenChange.carrier.beliefState.observations.some((observation) => observation.id === target.id),
  'positive control actually observed the changed player');
assert.ok(!passTargets(hiddenChange.carrier).includes(target.id),
  'observed opponent is no longer considered as a teammate pass target');

process.stdout.write('hidden team belief invariance passes (unseen affiliation is hidden; observed update is honored)\n');
