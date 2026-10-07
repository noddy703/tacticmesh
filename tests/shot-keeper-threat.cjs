const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/intelligence.js');
const TF = globalThis.TF;

function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < String(text).length; i += 1) { value ^= String(text).charCodeAt(i); value = Math.imul(value, 16777619); }
  return value >>> 0;
}

function runScene(options = {}) {
  const seed = options.seed || 6010;
  const match = TF.createMatch({ seed, homeFormation: '4-3-3', awayFormation: '4-2-3-1' });
  const home = match.teams.find(t => t.side === 'home'), away = match.teams.find(t => t.side === 'away');
  const dir = options.dir || 1, goalX = dir > 0 ? match.pitch.length : 0;
  home.attackDirection = dir; away.attackDirection = -dir;
  const shooter = home.activePlayers.find(p => p.positionFamily === 'FWD');
  const strikerX = options.shooterX == null ? (dir > 0 ? 89 : 16) : options.shooterX;
  const strikerY = options.shooterY == null ? match.pitch.width / 2 : options.shooterY;
  home.activePlayers.forEach((p, i) => {
    p.position.x = p.previousPosition.x = p === shooter ? strikerX : (dir > 0 ? 38 - i : 67 + i);
    p.position.y = p.previousPosition.y = p === shooter ? strikerY : 8 + (i % 8) * 7;
    p.velocity.x = p.velocity.y = 0;
    p.facing.x = dir; p.facing.y = 0;
  });
  const goalkeeper = away.activePlayers.find(p => p.isGoalkeeper);
  const keeperActual = options.keeperActual || { x: goalX - dir * 2, y: match.pitch.width / 2 };
  goalkeeper.position.x = goalkeeper.previousPosition.x = keeperActual.x;
  goalkeeper.position.y = goalkeeper.previousPosition.y = keeperActual.y;
  goalkeeper.velocity.x = Number(options.keeperActualVelocity && options.keeperActualVelocity.x) || 0;
  goalkeeper.velocity.y = Number(options.keeperActualVelocity && options.keeperActualVelocity.y) || 0;
  if (options.keeperActualAttributes) Object.assign(goalkeeper.attributes, options.keeperActualAttributes);
  goalkeeper.facing.x = -dir; goalkeeper.facing.y = 0;
  away.activePlayers.filter(p => !p.isGoalkeeper).forEach((p, i) => {
    p.position.x = p.previousPosition.x = options.outfieldBlocker && i === 0 ? options.outfieldBlocker.x : (dir > 0 ? 58 - (i % 3) * 4 : 47 + (i % 3) * 4);
    p.position.y = p.previousPosition.y = options.outfieldBlocker && i === 0 ? options.outfieldBlocker.y : 5 + (i % 8) * 8;
    p.velocity.x = p.velocity.y = 0;
  });
  match.state.phase = 'open-play'; match.state.restartType = null;
  match.ball.ownerId = shooter.id; match.ball.lastTouchPlayerId = shooter.id; match.ball.lastTouchTeamId = home.id;
  match.ball.position.x = strikerX + dir * 0.45; match.ball.position.y = strikerY; match.ball.position.z = 0.11;
  shooter.hasBall = true;

  let tick = 1;
  const cycle = TF.getPerceptionScanInterval(shooter, match), phase = hash(shooter.id) % cycle;
  while ((tick + phase) % cycle === 0) tick += 1;
  match.tick = tick;
  const age = Math.max(0, Number(options.keeperAge) || 0), confidence = Number(options.keeperConfidence == null ? 0.95 : options.keeperConfidence);
  const beliefKeeperPos = options.keeperBelief || { x: goalX - dir * 2, y: match.pitch.width / 2 };
  const keeperVelocity = options.keeperVelocity || { x: 0, y: 0 };
  const beliefEntities = {};
  home.activePlayers.filter(p => p !== shooter && !p.isGoalkeeper).forEach((p, i) => {
    beliefEntities[p.id] = { id: p.id, teamId: home.id, role: p.role, position: { x: p.position.x, y: p.position.y },
      estimatedPosition: { x: p.position.x, y: p.position.y }, velocity: { x: 0, y: 0 }, facing: { x: dir, y: 0 },
      confidence: 0.92, baseConfidence: 0.92, observedTick: tick, ageTicks: 0, source: 'vision' };
  });
  away.activePlayers.filter(p => !p.isGoalkeeper).forEach(p => {
    beliefEntities[p.id] = { id: p.id, teamId: away.id, role: p.role, position: { x: p.position.x, y: p.position.y },
      estimatedPosition: { x: p.position.x, y: p.position.y }, velocity: { x: 0, y: 0 }, facing: { x: -dir, y: 0 },
      confidence: 0.92, baseConfidence: 0.92, observedTick: tick, ageTicks: 0, source: 'vision' };
  });
  const observedKeeperPosition = { x: beliefKeeperPos.x - (Number(keeperVelocity.x) || 0) * Math.min(age / 60, 1.2),
    y: beliefKeeperPos.y - (Number(keeperVelocity.y) || 0) * Math.min(age / 60, 1.2) };
  if (options.keeperObserved !== false) beliefEntities[goalkeeper.id] = { id: goalkeeper.id, teamId: away.id, role: 'GK', position: observedKeeperPosition,
    estimatedPosition: observedKeeperPosition, velocity: { x: Number(keeperVelocity.x) || 0, y: Number(keeperVelocity.y) || 0 },
    facing: { x: -dir, y: 0 }, isGoalkeeper: true, confidence, baseConfidence: confidence, observedTick: tick - age, ageTicks: age, source: 'vision' };
  shooter.beliefState = { entities: beliefEntities, updatedTick: tick, lastScanTick: tick - 1, observations: [],
    ball: { position: { x: match.ball.position.x, y: match.ball.position.y, z: 0.11 },
      estimatedPosition: { x: match.ball.position.x, y: match.ball.position.y }, velocity: { x: 0, y: 0, z: 0 },
      confidence: 0.96, baseConfidence: 0.96, ageTicks: 0, observedTick: tick, ownerId: shooter.id, lastTouchTeamId: home.id } };
  shooter.ai = { nextDecision: tick, lastDecision: tick - 1 };
  TF.updateAI(match, 1 / 60);
  const shot = shooter.ai.decisionExplanation.candidates.find(c => c.type === 'shoot');
  assert.ok(shot, 'fixture did not produce a shot candidate');
  return { match, shooter, shot, intent: shooter.intent, candidates: shooter.ai.decisionExplanation.candidates };
}

const coveredHome = runScene({ dir: 1, shooterY: 30.4, keeperBelief: { x: 103, y: 34 } });
const wrongSideHome = runScene({ dir: 1, keeperBelief: { x: 82, y: 34 }, keeperActual: { x: 82, y: 34 } });
assert.ok(coveredHome.shot.details.keeperInterceptionRisk > 0.08
  && Math.abs(coveredHome.shot.target.y - 34) >= 2.5,
  'the fresh keeper belief did not price or avoid its projected shot corridor');
assert.ok(coveredHome.shot.utility < wrongSideHome.shot.utility - 0.09,
  'keeper arrival threat did not materially lower the shot candidate utility');

const movingToward = runScene({ dir: 1, shooterY: 30.4, keeperBelief: { x: 103, y: 34 }, keeperVelocity: { x: 0, y: 4 } });
const movingAway = runScene({ dir: 1, shooterY: 30.4, keeperBelief: { x: 103, y: 34 }, keeperVelocity: { x: 0, y: -4 } });
assert.ok(movingToward.shot.utility < movingAway.shot.utility - 0.08
  && Math.abs(movingToward.shot.target.y - movingAway.shot.target.y) > 5,
  'observed keeper movement did not steer the selected shot toward the less reachable lane');

const staleKeeper = runScene({ dir: 1, keeperBelief: { x: 103, y: 34 }, keeperAge: 110 });
assert.ok(staleKeeper.shot.details.keeperInterceptionRisk > 0 && staleKeeper.shot.details.keeperInterceptionRisk < 0.2,
  'an old but still locally remembered on-ray keeper was erased or treated as certain');
const age89 = runScene({ dir: 1, keeperBelief: { x: 103, y: 34 }, keeperAge: 89 }).shot.details.keeperInterceptionRisk;
const age90 = runScene({ dir: 1, keeperBelief: { x: 103, y: 34 }, keeperAge: 90 }).shot.details.keeperInterceptionRisk;
const age91 = runScene({ dir: 1, keeperBelief: { x: 103, y: 34 }, keeperAge: 91 }).shot.details.keeperInterceptionRisk;
assert.ok(age89 >= age90 && age90 >= age91 && age89 - age91 < 0.03,
  'remembered keeper risk changes smoothly across the former hard age cutoff');

const awayCovered = runScene({ dir: -1, keeperBelief: { x: 2, y: 34 }, keeperVelocity: { x: 0, y: 4 } });
const awayWrongSide = runScene({ dir: -1, keeperBelief: { x: 23, y: 34 }, keeperActual: { x: 23, y: 34 } });
assert.ok(awayCovered.shot.utility < awayWrongSide.shot.utility - 0.01
  && Math.abs(awayCovered.shot.target.y - awayWrongSide.shot.target.y) > 2,
  'mirrored keeper coverage did not steer the selected shot toward the safer lane');

const hiddenActualA = runScene({ dir: 1, shooterY: 30.4, keeperBelief: { x: 103, y: 34 }, keeperActual: { x: 103, y: 34 } });
const hiddenActualB = runScene({ dir: 1, shooterY: 30.4, keeperBelief: { x: 103, y: 34 }, keeperActual: { x: 74, y: 6 } });
assert.equal(hiddenActualA.shot.utility, hiddenActualB.shot.utility, 'shot utility leaked the hidden physical keeper position instead of using the same observer belief');

const openCloseFinish = runScene({ dir: 1, shooterX: 99, keeperBelief: { x: 86, y: 34 }, keeperActual: { x: 86, y: 34 } });
assert.equal(openCloseFinish.intent.type, 'shoot', 'a close, open finish was suppressed despite the goalkeeper being behind the shooter');
assert.ok(openCloseFinish.shot.details.keeperInterceptionRisk < 0.1, 'keeper behind the shooter incorrectly covered the close finish');

// Named trace-2 geometry: at 7.9m, compare plausible aim rays against the
// fresh keeper's observed position and movement. The selected aim should avoid
// the covered side and mirror with the opposite attack direction.
const trace2Home = runScene({ dir: 1, shooterX: 97.147, shooterY: 33.098,
  keeperBelief: { x: 103.248, y: 34.065 }, keeperActual: { x: 103.248, y: 34.065 },
  keeperVelocity: { x: 0.277, y: -0.039 } });
const trace2Away = runScene({ dir: -1, shooterX: 7.853, shooterY: 34.902,
  keeperBelief: { x: 1.752, y: 33.935 }, keeperActual: { x: 1.752, y: 33.935 },
  keeperVelocity: { x: -0.277, y: 0.039 } });
assert.ok(trace2Home.shot.target.y < 34 && trace2Away.shot.target.y > 34
  && Math.abs(trace2Home.shot.target.y + trace2Away.shot.target.y - 68) < 0.02,
  'trace-2 selected target did not avoid the observed keeper symmetrically');
assert.ok(Math.abs(trace2Home.shot.utility - trace2Away.shot.utility) < 0.06,
  'trace-2 mirrored shot utility diverged by goal direction');
// Trace-4's keeper observation was 69 ticks old and low-confidence; the model
// must not convert the new contact-window forecast into hidden-world knowledge.
const trace4Stale = runScene({ dir: 1, shooterX: 97.147, shooterY: 33.098,
  keeperBelief: { x: 103.248, y: 34.065 }, keeperActual: { x: 103.248, y: 34.065 },
  keeperVelocity: { x: 0.277, y: -0.039 }, keeperAge: 69, keeperConfidence: 0.328 });
assert.equal(trace4Stale.shot.details.keeperInterceptionRisk, 0,
  'stale trace-4 keeper state was treated as a live contact forecast');
assert.equal(trace4Stale.intent.type, 'shoot', 'stale trace-4 keeper memory changed the shot decision');
const highConfidenceRisk = runScene({ dir: 1, shooterX: 94.9, shooterY: 34,
  keeperBelief: { x: 103, y: 34 }, keeperConfidence: 0.95 }).shot.details.keeperInterceptionRisk;
const lowConfidenceKeeper = runScene({ dir: 1, shooterX: 94.9, shooterY: 34,
  keeperBelief: { x: 103, y: 34 }, keeperConfidence: 0.2 });
assert.ok(lowConfidenceKeeper.shot.details.keeperInterceptionRisk < 0.1
  && lowConfidenceKeeper.shot.details.keeperInterceptionRisk < highConfidenceRisk * 0.2,
  'keeper confidence was multiplied repeatedly across correlated contact samples');
const weakMemory = runScene({ dir: 1, shooterX: 94.9, shooterY: 34,
  keeperBelief: { x: 103, y: 34 }, keeperConfidence: 0.1 });
assert.ok(weakMemory.shot.details.keeperInterceptionRisk > 0
  && weakMemory.shot.details.keeperInterceptionRisk < highConfidenceRisk * 0.2,
  'weak but present keeper memory is uncertainty-weighted once rather than erased');
const unseenKeeper = runScene({ dir: 1, shooterX: 94.9, shooterY: 34,
  keeperBelief: { x: 103, y: 34 }, keeperObserved: false });
assert.equal(unseenKeeper.shot.details.keeperInterceptionRisk, 0,
  'an unconfirmed keeper observation created a shot threat');
const displacedKeeper = runScene({ dir: 1, shooterX: 97.147, shooterY: 33.098,
  keeperBelief: { x: 103.248, y: 39 }, keeperActual: { x: 103.248, y: 39 } });
assert.ok(displacedKeeper.shot.details.keeperInterceptionRisk < 0.1,
  'a laterally displaced keeper was falsely projected into the shot corridor');
const coveredNearTieHome = runScene({ dir: 1, shooterX: 94.9, shooterY: 34, keeperBelief: { x: 103, y: 34 } });
const coveredNearTieAway = runScene({ dir: -1, shooterX: 10.1, shooterY: 34, keeperBelief: { x: 2, y: 34 } });
const openNearTieHome = runScene({ dir: 1, shooterX: 94.9, shooterY: 34,
  keeperBelief: { x: 86, y: 34 }, keeperActual: { x: 86, y: 34 } });
const openNearTieAway = runScene({ dir: -1, shooterX: 10.1, shooterY: 34,
  keeperBelief: { x: 19, y: 34 }, keeperActual: { x: 19, y: 34 } });
for (const scene of [coveredNearTieHome, coveredNearTieAway]) {
  const bestAlternative = Math.max(...scene.candidates.filter(c => c.type !== 'shoot').map(c => c.utility));
  const keeper = scene.shooter.beliefState.entities[scene.match.teams.find(t => t.side === 'away').activePlayers.find(p => p.isGoalkeeper).id];
  assert.ok(bestAlternative > 0.4, 'covered near-tie scene lost its credible carry alternative');
  if (scene.intent.type === 'shoot') {
    assert.ok(Math.abs(scene.shot.target.y - keeper.estimatedPosition.y) > 2.5,
      'shot selection did not choose a lane away from the observed keeper');
  } else {
    assert.ok(bestAlternative > scene.shot.utility, 'non-shot choice did not have a better observed alternative');
  }
}
for (const scene of [openNearTieHome, openNearTieAway]) {
  assert.equal(scene.intent.type, 'shoot', 'open-goal near-tie finish changed in the mirrored scene');
  assert.ok(scene.shot.details.keeperInterceptionRisk < 0.1, 'keeper behind the shooter was priced as a threat');
}

const outfieldBlocker = runScene({ dir: 1, outfieldBlocker: { x: 95, y: 35 } });
assert.ok(outfieldBlocker.shot.utility < wrongSideHome.shot.utility - 0.1
  && outfieldBlocker.shot.target.y < wrongSideHome.shot.target.y - 2,
  'outfield block did not lower shot value or steer the selected lane away from contact');

// The total post-to-post aperture alone can overvalue a ray that barely clears
// a post once the kicker's real angular execution spread is included. Compare
// an acute near-post aim with a central, executable aim and mirror both ends.
const narrowAimHome = runScene({ dir: 1, shooterX: 104.05, shooterY: 42.22,
  keeperBelief: { x: 82, y: 35 }, keeperActual: { x: 82, y: 35 } });
const centralAimHome = runScene({ dir: 1, shooterX: 104.05, shooterY: 31.2,
  keeperBelief: { x: 82, y: 35 }, keeperActual: { x: 82, y: 35 } });
const narrowAimAway = runScene({ dir: -1, shooterX: 0.95, shooterY: 25.78,
  keeperBelief: { x: 23, y: 33 }, keeperActual: { x: 23, y: 33 } });
const centralAimAway = runScene({ dir: -1, shooterX: 0.95, shooterY: 36.8,
  keeperBelief: { x: 23, y: 33 }, keeperActual: { x: 23, y: 33 } });
for (const [narrow, central] of [[narrowAimHome, centralAimHome], [narrowAimAway, centralAimAway]]) {
  assert.ok(narrow.shot.details.shotPlacementChance < central.shot.details.shotPlacementChance - 0.3,
    'near-post target ignored the actor’s angular execution spread');
  assert.ok(narrow.shot.utility < central.shot.utility - 0.05,
    'near-post aperture bonus was not reduced by the target ray’s physical clearance');
  assert.ok(central.shot.details.shotPlacementChance > 0.9,
    'a clean central line lost its high placement reliability');
}
assert.equal(centralAimHome.intent.type, 'shoot', 'central open-goal finish was displaced by the placement correction');
assert.equal(centralAimAway.intent.type, 'shoot', 'mirrored central open-goal finish was displaced by the placement correction');
assert.ok(narrowAimHome.candidates.some(c => c.type === 'carry' && c.utility > narrowAimHome.shot.utility),
  'near-post shot ignored a credible carry alternative in the fixture');
assert.ok(narrowAimAway.candidates.some(c => c.type === 'carry' && c.utility > narrowAimAway.shot.utility),
  'mirrored near-post shot ignored a credible carry alternative in the fixture');
assert.notEqual(narrowAimHome.intent.type, 'shoot', 'near-post shot still beat the credible carry in the home-side fixture');
assert.notEqual(narrowAimAway.intent.type, 'shoot', 'near-post shot still beat the credible carry in the mirrored fixture');
const hiddenNarrowAim = runScene({ dir: 1, shooterX: 104.05, shooterY: 42.22,
  keeperBelief: { x: 82, y: 35 }, keeperActual: { x: 103, y: 34 },
  keeperActualAttributes: { positioning: 99, reflexes: 99, diving: 99, reach: 99 } });
const staleNarrowAim = runScene({ dir: 1, shooterX: 104.05, shooterY: 42.22,
  keeperBelief: { x: 82, y: 35 }, keeperActual: { x: 103, y: 34 }, keeperAge: 110 });
assert.equal(hiddenNarrowAim.shot.details.shotPlacementChance, narrowAimHome.shot.details.shotPlacementChance,
  'placement estimate read the hidden keeper position');
assert.deepEqual(hiddenNarrowAim.shot.target, narrowAimHome.shot.target,
  'chosen aim ray changed when only the hidden keeper truth changed');
assert.equal(hiddenNarrowAim.shot.utility, narrowAimHome.shot.utility,
  'shot utility changed when only hidden keeper position changed');
assert.equal(staleNarrowAim.shot.details.shotPlacementChance, narrowAimHome.shot.details.shotPlacementChance,
  'stale keeper memory contaminated the kicker’s own execution geometry');
assert.deepEqual(staleNarrowAim.shot.target, narrowAimHome.shot.target,
  'same-position stale keeper memory changed the selected aim ray');
const unseenNarrowAim = runScene({ dir: 1, shooterX: 104.05, shooterY: 42.22,
  keeperBelief: { x: 82, y: 35 }, keeperActual: { x: 103, y: 34 }, keeperConfidence: 0.1 });
assert.deepEqual(unseenNarrowAim.shot.target, narrowAimHome.shot.target,
  'unconfirmed keeper observation changed aim selection');

// Seed-20261010's near-goalline chance: with the target ray only ~10% likely
// to pass between the posts, the shot base must not survive almost unchanged
// and outrank the observed pressure-escape carry. Mirror the same geometry at
// the opposite end so the action choice has no goal-direction bias.
const lowPlacementHome = runScene({ dir: 1, shooterX: 104.165, shooterY: 26.626,
  keeperBelief: { x: 103, y: 34 }, keeperActual: { x: 103, y: 34 } });
const lowPlacementAway = runScene({ dir: -1, shooterX: 0.835, shooterY: 41.374,
  keeperBelief: { x: 2, y: 34 }, keeperActual: { x: 2, y: 34 } });
for (const scene of [lowPlacementHome, lowPlacementAway]) {
  const alternative = Math.max(...scene.candidates.filter(c => c.type !== 'shoot').map(c => c.utility));
  assert.ok(scene.shot.details.shotPlacementChance < 0.2,
    'the mirrored near-post fixture did not produce a low-probability target ray');
  assert.ok(scene.shot.utility < alternative,
    'a low-probability shot retained its full base benefit over the credible non-shot alternative');
  assert.notEqual(scene.intent.type, 'shoot',
    'the low-placement ray was selected over its better observed carry/pass alternative');
}
assert.ok(Math.abs(lowPlacementHome.shot.utility - lowPlacementAway.shot.utility) < 0.02,
  'expected shot value changed materially when the same fixture was mirrored');

// A fully reliable ray keeps its contextual value even when pressure and
// range are poor; placement weighting must never remove the negative base and
// accidentally boost a clean shot.
const pressuredReliable = runScene({ dir: 1, shooterX: 89, shooterY: 34,
  keeperBelief: { x: 103, y: 34 }, keeperActual: { x: 103, y: 34 },
  outfieldBlocker: { x: 88.5, y: 34.6 } });
const reliableCandidate = pressuredReliable.shot;
const shooting = Number(pressuredReliable.shooter.attributes.shooting) / 100;
const finishing = Number(pressuredReliable.shooter.attributes.finishing) / 100;
const composure = Number(pressuredReliable.shooter.attributes.composure) / 100;
const shotBase = 0.73 - reliableCandidate.details.goalDistance / (25 * 1.65)
  - reliableCandidate.details.pressure * 0.17 + shooting * 0.12 + finishing * 0.11 + composure * 0.06 - 0.13;
const expectedReliableUtility = Math.max(0.02, Math.min(0.88,
  shotBase + reliableCandidate.details.shotAngle * 0.25
  - reliableCandidate.details.keeperInterceptionRisk * 0.35 - reliableCandidate.details.shotLaneRisk * 0.24));
assert.equal(reliableCandidate.details.shotPlacementChance, 1,
  'the pressured central control scene must have a fully reliable shot ray');
assert.ok(Math.abs(reliableCandidate.utilityComponents.raw - expectedReliableUtility) < 0.0001,
  'placement weighting changed a fully reliable shot’s contextual benefit');

process.stdout.write('keeper shot-interception utility responds to local coverage, approach, freshness, and mirrored goal direction; open finishes and outfield lane control remain intact\n');
