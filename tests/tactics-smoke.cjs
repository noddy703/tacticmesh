const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');
const TF = globalThis.TF;
const pitch = { length: 105, width: 68 };

const testedFormations = ['4-3-3', '4-2-3-1', '4-4-2', '3-4-2-1', '3-5-2'];
const formationProfiles = new Map();
for (const formation of testedFormations) {
  const m = TF.createMatch({ seed: 81, homeFormation: formation, awayFormation: formation });
  TF.updateTactics(m, 1 / 60);
  const starters = m.teams[0].activePlayers;
  const roleCounts = starters.reduce((out, p) => {
    out[p.role] = (out[p.role] || 0) + 1;
    return out;
  }, {});
  // Slot lines/flanks are the intended home-region contract, and physical
  // kickoff positions must be derived from those slots rather than a generic
  // eleven-player shape.
  const regionCounts = starters.reduce((out, p) => {
    const x = p.formationSlot.x, y = p.formationSlot.y;
    const line = x < 30 ? 'back' : x < 55 ? 'middle' : 'front';
    const lane = y < 25 ? 'left' : y > 43 ? 'right' : 'center';
    const key = line + ':' + lane;
    out[key] = (out[key] || 0) + 1;
    assert.ok(Math.hypot(p.position.x - p.formationSlot.x, p.position.y - p.formationSlot.y) < 1e-9,
      formation + ' kickoff position ignored its assigned home slot');
    return out;
  }, {});
  const profile = JSON.stringify({ roleCounts, regionCounts });
  formationProfiles.set(formation, profile);
  for (const t of m.teams) for (const p of t.activePlayers) {
    const ctx = TF.getTacticalContext(m, p);
    assert.ok(ctx.anchor.x >= 0 && ctx.anchor.x <= pitch.length, formation + ' x anchor out of bounds');
    assert.ok(ctx.anchor.y >= 0 && ctx.anchor.y <= pitch.width, formation + ' y anchor out of bounds');
  }
}
assert.equal(new Set(formationProfiles.values()).size, testedFormations.length,
  'each supported formation must produce a distinct intended role and home-region distribution');
assert.deepEqual(
  JSON.parse(formationProfiles.get('4-3-3')).roleCounts,
  { GK: 1, RB: 1, RCB: 1, LCB: 1, LB: 1, DM: 1, RCM: 1, LCM: 1, RW: 1, ST: 1, LW: 1 },
  '4-3-3 role distribution changed');
assert.equal(JSON.parse(formationProfiles.get('4-4-2')).roleCounts.ST, 2,
  '4-4-2 must assign two strikers');
assert.equal(JSON.parse(formationProfiles.get('4-4-2')).roleCounts.LM, 1,
  '4-4-2 must assign a left wide midfielder');
assert.equal(JSON.parse(formationProfiles.get('3-5-2')).roleCounts.CB, 1,
  '3-5-2 must retain a central third center-back');
assert.equal(JSON.parse(formationProfiles.get('3-5-2')).roleCounts.RWB, 1,
  '3-5-2 must assign a right wing-back');

// Dynamic role anchors must advance forwards and preserve a goal-side block.
// Away coordinates mirror the same phase and ball position across the pitch.
const roleAnchorMatch = TF.createMatch({ seed: 818, homeFormation: '4-3-3', awayFormation: '4-3-3' });
roleAnchorMatch.state.phase = 'open-play';
roleAnchorMatch.state.restartType = null;
roleAnchorMatch.tick = 30;
function setBelievedPossession(team, point, ownerId) {
  for (const player of team.activePlayers) player.beliefState = {
    updatedTick: roleAnchorMatch.tick,
    ball: { estimatedPosition: { ...point }, position: { ...point, z: 0 }, ownerId, confidence: .95, ageTicks: 0 },
    entities: {}
  };
}
const homeRoleTeam = roleAnchorMatch.teams[0], awayRoleTeam = roleAnchorMatch.teams[1];
const homeST = homeRoleTeam.activePlayers.find(p => p.role === 'ST');
const homeRoleCB = homeRoleTeam.activePlayers.find(p => p.role === 'RCB');
const awayST = awayRoleTeam.activePlayers.find(p => p.role === 'ST');
const awayRoleCB = awayRoleTeam.activePlayers.find(p => p.role === 'RCB');
setBelievedPossession(homeRoleTeam, { x: 82, y: 34 }, homeST.id);
setBelievedPossession(awayRoleTeam, { x: 23, y: 34 }, awayST.id);
const homeAttackST = TF.getTacticalContext(roleAnchorMatch, homeST).anchor;
const homeAttackCB = TF.getTacticalContext(roleAnchorMatch, homeRoleCB).anchor;
const awayAttackST = TF.getTacticalContext(roleAnchorMatch, awayST).anchor;
const awayAttackCB = TF.getTacticalContext(roleAnchorMatch, awayRoleCB).anchor;
assert.ok(homeAttackST.x > homeAttackCB.x, 'attacking striker did not anchor ahead of center-back');
assert.ok(awayAttackST.x < awayAttackCB.x, 'mirrored attacking striker did not anchor ahead of center-back');
assert.ok(Math.abs(homeAttackST.x + awayAttackST.x - pitch.length) < .01,
  'attacking formation anchors did not mirror across teams');
// Place the opponent carrier near each team's own goal to exercise defending anchors.
setBelievedPossession(homeRoleTeam, { x: 9, y: 34 }, awayST.id);
setBelievedPossession(awayRoleTeam, { x: 96, y: 34 }, homeST.id);
const homeDefST = TF.getTacticalContext(roleAnchorMatch, homeST).anchor;
const homeDefCB = TF.getTacticalContext(roleAnchorMatch, homeRoleCB).anchor;
const awayDefST = TF.getTacticalContext(roleAnchorMatch, awayST).anchor;
const awayDefCB = TF.getTacticalContext(roleAnchorMatch, awayRoleCB).anchor;
assert.ok(homeDefCB.x < homeDefST.x, 'defending center-back did not hold deeper than striker');
assert.ok(awayDefCB.x > awayDefST.x, 'mirrored defending center-back did not hold deeper than striker');
assert.ok(Math.abs(homeDefCB.x + awayDefCB.x - pitch.length) < .01,
  'defending formation anchors did not mirror across teams');

const match = TF.createMatch({ seed: 991, homeFormation: '4-3-3', awayFormation: '4-3-3' });
const home = match.teams[0], away = match.teams[1];
const carrier = home.activePlayers.find(p => p.role === 'RW');
const fullback = home.activePlayers.find(p => p.role === 'RB');
const defender = away.activePlayers.find(p => p.role === 'LB');
carrier.position = { x: 82, y: 60, z: 0 };
fullback.position = { x: 88, y: 56, z: 0 };
defender.position = { x: 86, y: 57, z: 0 };
match.ball.ownerId = carrier.id;
match.ball.position = { x: 82, y: 60, z: 0 };
match.state.phase = 'open-play';
match.state.restartType = null;
// A local perceived snapshot supports crossing and the outside runner opportunity.
carrier.beliefState = { updatedTick: 1, ball: { estimatedPosition: { x: 82, y: 60 }, position: { x: 82, y: 60 }, ownerId: carrier.id, confidence: .9, ageTicks: 0 }, entities: {
  [fullback.id]: { id: fullback.id, teamId: home.id, estimatedPosition: { x: 88, y: 56 }, position: { x: 88, y: 56 }, velocity: { x: 1, y: 0 }, confidence: .9, ageTicks: 0 },
  [defender.id]: { id: defender.id, teamId: away.id, estimatedPosition: { x: 86, y: 57 }, position: { x: 86, y: 57 }, velocity: { x: 0, y: 0 }, confidence: .9, ageTicks: 0 }
} };
fullback.beliefState = { updatedTick: 1, ball: { estimatedPosition: { x: 82, y: 60 }, position: { x: 82, y: 60 }, ownerId: carrier.id, confidence: .9, ageTicks: 0 }, entities: {
    [carrier.id]: { id: carrier.id, teamId: home.id, estimatedPosition: { x: 82, y: 60 }, position: { x: 82, y: 60 }, velocity: { x: 0, y: 0 }, confidence: .9, ageTicks: 0 }
} };
const cross = TF.getTacticalContext(match, carrier);
assert.ok(['finalThirdPossession', 'attackingProgression'].includes(cross.phase), 'perceived final-third phase not recognized');
const candidates = TF.augmentCandidates([], {
  self: { id: carrier.id, teamId: home.id, position: carrier.position, role: carrier.role, positionFamily: carrier.positionFamily, attributes: carrier.attributes, traits: carrier.traits },
  ball: { position: { x: 82, y: 60 }, ownerId: carrier.id, confidence: .9 },
  teammates: [{ id: fullback.id, teamId: home.id, position: { x: 88, y: 56 }, confidence: .9 }],
  opponents: [{ id: defender.id, teamId: away.id, position: { x: 86, y: 57 }, confidence: .9 }],
  carrying: true, teamId: home.id, attackDirection: 1, tactical: cross, pitch
});
assert.ok(candidates.some(c => c.type === 'cross' || c.type === 'cutback'), 'wide final-third carrier did not evaluate a delivery');

// A possession change is interpreted as a short attacking transition from the actor's belief.
match.tick = 16;
home._tacticalState = { lastOwnerTeamId: away.id };
carrier.beliefState.ball.ownerId = carrier.id;
carrier.beliefState.ball.confidence = .9;
assert.equal(TF.getTacticalContext(match, carrier).phase, 'attackingTransition', 'observed possession change did not create transition phase');

// Away progress uses the mirrored attacking direction.
const awayCarrier = away.activePlayers.find(p => p.role === 'ST');
awayCarrier.beliefState = { updatedTick: 16, ball: { estimatedPosition: { x: 19, y: 34 }, position: { x: 19, y: 34 }, ownerId: awayCarrier.id, confidence: .9, ageTicks: 0 }, entities: {} };
const awayContext = TF.getTacticalContext(match, awayCarrier);
assert.ok(['finalThirdPossession', 'attackingTransition'].includes(awayContext.phase), 'away attacking direction was not mirrored');

// Defensive danger uses distance from each defending side's own goal. The
// same perceived attack must trigger an emergency block and mirrored anchors.
const dangerMatch = TF.createMatch({ seed: 992, homeFormation: '4-3-3', awayFormation: '4-3-3' });
dangerMatch.tick = 150;
dangerMatch.state.phase = 'open-play';
dangerMatch.state.restartType = null;
dangerMatch.teams.forEach((defending) => {
  const attacking = dangerMatch.teams.find((team) => team.id !== defending.id);
  const centerBack = defending.activePlayers.find((player) => player.role === 'RCB');
  const attacker = attacking.activePlayers.find((player) => player.role === 'ST');
  const ballPosition = defending.attackDirection > 0 ? { x: 9, y: 34 } : { x: 96, y: 34 };
  defending._tacticalState = { lastOwnerTeamId: attacking.id, transitionUntil: -1, updatedTick: dangerMatch.tick };
  centerBack.beliefState = { updatedTick: dangerMatch.tick, ball: { estimatedPosition: ballPosition, position: ballPosition, ownerId: attacker.id, confidence: .95, ageTicks: 0 }, entities: {
    [attacker.id]: { id: attacker.id, teamId: attacking.id, estimatedPosition: ballPosition, position: ballPosition, velocity: { x: 0, y: 0 }, facing: { x: -defending.attackDirection, y: 0 }, confidence: .95, ageTicks: 0 }
  } };
});
const homeCB = dangerMatch.teams.find((team) => team.side === 'home').activePlayers.find((player) => player.role === 'RCB');
const awayCB = dangerMatch.teams.find((team) => team.side === 'away').activePlayers.find((player) => player.role === 'RCB');
const homeDanger = TF.getTacticalContext(dangerMatch, homeCB);
const awayDanger = TF.getTacticalContext(dangerMatch, awayCB);
assert.equal(homeDanger.phase, 'emergencyDefending', 'opponent near home goal did not trigger emergency defense');
assert.equal(awayDanger.phase, 'emergencyDefending', 'opponent near away goal did not trigger mirrored emergency defense');
assert.ok(Math.abs(homeDanger.anchor.x - (pitch.length - awayDanger.anchor.x)) < .01, 'emergency defensive depth did not mirror across teams');
assert.ok(homeDanger.anchor.x < 17 && awayDanger.anchor.x > pitch.length - 17, 'emergency center backs did not retreat toward their own goal');
// An identified kick remains phase evidence during a short, uncontrolled
// flight. It must come from this player's fresh belief, not the hidden ball or
// an opponent record elsewhere in the roster.
const flightMatch = TF.createMatch({ seed: 995, homeFormation: '4-3-3', awayFormation: '4-3-3' });
flightMatch.state.phase = 'open-play'; flightMatch.state.restartType = null; flightMatch.state.restartTeamId = null;
const flightHome = flightMatch.teams.find(team => team.side === 'home');
const flightAway = flightMatch.teams.find(team => team.side === 'away');
const flightObserver = flightHome.activePlayers.find(player => player.role === 'RCB');
flightObserver.beliefState = { updatedTick: 15, entities: {}, ball: {
  estimatedPosition: { x: 9, y: 34 }, position: { x: 9, y: 34, z: 0.1 }, velocity: { x: -8, y: 0, z: 0 },
  confidence: .9, ageTicks: 3, ownerId: null, lastTouchTeamId: flightAway.id
} };
flightMatch.ball.lastTouchTeamId = flightHome.id; // Deliberate hidden-world disagreement.
const enemyFlightPhase = TF.getTacticalContext(flightMatch, flightObserver).phase;
assert.equal(enemyFlightPhase, 'emergencyDefending', 'fresh opponent kick flight dropped the defensive phase');
flightObserver.beliefState.ball.lastTouchTeamId = flightHome.id;
flightObserver.beliefState.ball.estimatedPosition = { x: 96, y: 34 };
flightObserver.beliefState.ball.position = { x: 96, y: 34, z: 0.1 };
flightObserver.beliefState.ball.velocity = { x: 8, y: 0, z: 0 };
assert.ok(['finalThirdPossession', 'attackingProgression'].includes(TF.getTacticalContext(flightMatch, flightObserver).phase), 'own kick flight dropped the attacking phase');
flightObserver.beliefState.ball.lastTouchTeamId = flightAway.id;
flightObserver.beliefState.ball.ageTicks = 31;
assert.notEqual(TF.getTacticalContext(flightMatch, flightObserver).phase, 'emergencyDefending', 'stale last-touch memory was treated as live ownership');
const holdLine = TF.augmentCandidates([], {
  self: { id: homeCB.id, teamId: homeCB.teamId, position: homeCB.position, role: homeCB.role, positionFamily: homeCB.positionFamily, attributes: homeCB.attributes, traits: homeCB.traits },
  ball: { position: { x: 9, y: 34 }, ownerId: dangerMatch.teams.find((team) => team.side === 'away').activePlayers.find((player) => player.role === 'ST').id, confidence: .95 },
  teammates: [], opponents: [{ id: 'observed-threat', teamId: 'away', position: { x: 9, y: 34 }, confidence: .95 }],
  carrying: false, teamId: homeCB.teamId, attackDirection: 1, tactical: homeDanger, pitch
}).find((candidate) => candidate.type === 'holdLine');
assert.ok(holdLine && holdLine.target.x < 10, 'emergency defensive line stayed at its fixed high anchor');

const facingMatch = TF.createMatch({ seed: 993, homeFormation: '4-3-3', awayFormation: '4-3-3' });
const facingHome = facingMatch.teams[0], facingAway = facingMatch.teams[1];
const goalSideActor = facingHome.activePlayers.find(player => player.role === 'RCB');
const centralThreat = facingAway.activePlayers.find(player => player.role === 'ST');
goalSideActor.position.x = 20; goalSideActor.position.y = 25;
goalSideActor.facing.x = -1; goalSideActor.facing.y = 0;
centralThreat.position.x = 9; centralThreat.position.y = 34;
facingMatch.ball.ownerId = centralThreat.id;
facingMatch.ball.position.x = 9; facingMatch.ball.position.y = 34;
facingMatch.state.phase = 'open-play'; facingMatch.state.restartType = null; facingMatch.state.restartTeamId = null;
facingMatch.tick = 1;
goalSideActor.beliefState = { updatedTick: 1, ball: { estimatedPosition: { x: 9, y: 34 }, position: { x: 9, y: 34, z: .11 }, velocity: { x: 0, y: 0, z: 0 }, baseConfidence: .95, observedTick: 1, ownerId: centralThreat.id, confidence: .95, ageTicks: 0 }, entities: {
  [centralThreat.id]: { id: centralThreat.id, teamId: facingAway.id, estimatedPosition: { x: 9, y: 34 }, position: { x: 9, y: 34 }, velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 }, baseConfidence: .95, observedTick: 1, confidence: .95, ageTicks: 0 }
} };
goalSideActor.ai = { nextDecision: 0 };
let recoverTarget = null, perceivedFocus = null;
const originalAugment = TF.augmentCandidates;
TF.augmentCandidates = function (candidates, context) {
  if (context.self.id === goalSideActor.id) {
    const recover = candidates.find(candidate => candidate.type === 'recover');
    recoverTarget = recover && recover.target;
    perceivedFocus = context.ball && context.ball.position;
  }
  return originalAugment(candidates, context);
};
try { TF.updateAI(facingMatch, TF.FIXED_DT); } finally { TF.augmentCandidates = originalAugment; }
assert.ok(recoverTarget && recoverTarget.x < 9 && Math.abs(recoverTarget.y - 34) < 8,
  'center-back recovery target did not protect the goal-side central lane');
assert.ok(goalSideActor.intent && perceivedFocus && goalSideActor.intent.type === 'recover' && !goalSideActor.intent.facingTarget,
  'beaten defender should sprint to regain goal-side position rather than pay a strafe cost to face the threat');

const keeperFacingMatch = TF.createMatch({ seed: 994, homeFormation: '4-3-3', awayFormation: '4-3-3' });
const keeperHome = keeperFacingMatch.teams[0], keeperAway = keeperFacingMatch.teams[1];
const facingKeeper = keeperAway.activePlayers.find(player => player.isGoalkeeper);
const keeperOpponent = keeperHome.activePlayers.find(player => player.role === 'RW');
facingKeeper.position.x = 102.9; facingKeeper.position.y = 34; facingKeeper.facing.x = -1; facingKeeper.facing.y = 0;
keeperOpponent.position.x = 96; keeperOpponent.position.y = 34;
keeperFacingMatch.ball.ownerId = keeperOpponent.id;
keeperFacingMatch.ball.position.x = 96.4; keeperFacingMatch.ball.position.y = 34;
keeperFacingMatch.state.phase = 'open-play'; keeperFacingMatch.state.restartType = null; keeperFacingMatch.state.restartTeamId = null;
keeperFacingMatch.tick = 1; facingKeeper.ai = { nextDecision: 0 };
facingKeeper.beliefState = { updatedTick: 1, ball: { estimatedPosition: { x: 96.4, y: 34 }, position: { x: 96.4, y: 34, z: .11 }, velocity: { x: 0, y: 0, z: 0 }, baseConfidence: .95, observedTick: 1, ownerId: keeperOpponent.id, confidence: .95, ageTicks: 0 }, entities: {
  [keeperOpponent.id]: { id: keeperOpponent.id, teamId: keeperHome.id, estimatedPosition: { x: 96, y: 34 }, position: { x: 96, y: 34 }, velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 }, baseConfidence: .95, observedTick: 1, confidence: .95, ageTicks: 0 }
} };
TF.updateAI(keeperFacingMatch, TF.FIXED_DT);
assert.ok(facingKeeper.intent && facingKeeper.intent.facingTarget && Math.hypot(facingKeeper.intent.facingTarget.x - 96, facingKeeper.intent.facingTarget.y - 34) < 1,
  'keeper did not keep a separate facing cue toward the perceived attacker');
assert.ok(Math.abs(facingKeeper.intent.target.x - facingKeeper.intent.facingTarget.x) > 3,
  'keeper facing cue collapsed the independent movement target');

// A stale remembered point behind the keeper must age out. With no actionable
// ball, holding should face back into the field using a neutral local cue.
const staleKeeperMatch = TF.createMatch({ seed: 996, homeFormation: '4-3-3', awayFormation: '4-3-3' });
staleKeeperMatch.state.phase = 'open-play'; staleKeeperMatch.state.restartType = null; staleKeeperMatch.state.restartTeamId = null;
staleKeeperMatch.tick = 600;
const staleKeeper = staleKeeperMatch.teams.find(team => team.side === 'away').activePlayers.find(player => player.isGoalkeeper);
staleKeeper.position.x = 102; staleKeeper.position.y = 34;
staleKeeper.ai = { nextDecision: 0, lastKnownBall: { x: 104, y: 34 }, lastKnownBallTick: 0 };
staleKeeper.beliefState = { updatedTick: 600, entities: {}, ball: null };
const originalKeeperAugment = TF.augmentCandidates;
TF.augmentCandidates = function (candidates, context) {
  return originalKeeperAugment(candidates, context).concat([{ type: 'hold', target: { x: 102, y: 34 }, utility: 1.1, details: { keeper: true } }]);
};
try { TF.updateAI(staleKeeperMatch, TF.FIXED_DT); } finally { TF.augmentCandidates = originalKeeperAugment; }
assert.equal(staleKeeper.intent.type, 'hold', 'keeper-hold regression did not select the hold action');
assert.ok(staleKeeper.intent.facingTarget && staleKeeper.intent.facingTarget.x < staleKeeper.position.x - 4,
  'keeper hold faced stale behind-net memory instead of back into the field');

const aerialCandidates = TF.augmentCandidates([], {
  self: { id: carrier.id, teamId: home.id, position: carrier.position, role: carrier.role, positionFamily: carrier.positionFamily, attributes: carrier.attributes, traits: carrier.traits },
  ball: { position: { x: carrier.position.x, y: carrier.position.y, z: 1.8 }, velocity: { z: 0 }, confidence: .8 },
  teammates: [], opponents: [], carrying: false, teamId: home.id, attackDirection: 1, tactical: cross, pitch
});
assert.ok(aerialCandidates.some(c => c.type === 'header'), 'actor did not consider a perceived aerial header');

const augment = TF.augmentCandidates;
TF.augmentCandidates = () => [{ type: 'overlap', target: { x: 90, y: 54 }, utility: .95, details: { tacticalOpportunity: 'test' } }];
match.tick = 17;
fullback.ai = { nextDecision: 0 };
TF.updateAI(match, 1 / 60);
assert.equal(fullback.intent.type, 'overlap');
assert.ok(fullback.intent.desiredSpeed > 0, 'tactical movement candidate was decorative');
TF.augmentCandidates = augment;

// Only a small local group receives the direct press assignment; other players cover or screen.
const ballEstimate = { position: { x: 45, y: 34 }, ownerId: defender.id, confidence: .9 };
const assigned = [];
home.activePlayers.forEach((p, i) => {
  p.position = { x: 42 + i * 1.5, y: 28 + i * 1.2, z: 0 };
  p.beliefState = { updatedTick: 10, ball: { estimatedPosition: ballEstimate.position, position: ballEstimate.position, ownerId: defender.id, confidence: .9, ageTicks: 0 }, entities: {
    [defender.id]: { id: defender.id, teamId: away.id, estimatedPosition: { x: 45, y: 34 }, position: { x: 45, y: 34 }, velocity: { x: 0, y: 0 }, confidence: .9, ageTicks: 0 }
  } };
});
home.activePlayers.forEach((p, i) => {
  const mate = home.activePlayers[(i + 1) % home.activePlayers.length];
  p.beliefState.entities[mate.id] = { id: mate.id, teamId: home.id, estimatedPosition: { x: mate.position.x, y: mate.position.y }, position: { x: mate.position.x, y: mate.position.y }, velocity: { x: 0, y: 0 }, confidence: .9, ageTicks: 0 };
});
match.tick = 15;
TF.updateTactics(match, 1 / 60);
assert.ok(home.tacticalMemory.observed > 0, 'team did not accumulate decayed perceived observations');
home.activePlayers.forEach((p) => {
  const c = TF.getTacticalContext(match, p);
  if (c.responsibilities.press) assigned.push(p.id);
});
assert.ok(assigned.length >= 1 && assigned.length <= 2, 'press assignment exceeded the defined small group');

const before = TF.captureCheckpoint(match);
const restore = TF.createMatch({ seed: match.seed, matchId: match.id });
TF.restoreCheckpoint(restore, before);
assert.deepEqual(TF.captureCheckpoint(restore).extensions.tactics, before.extensions.tactics, 'tactics checkpoint extension did not restore');
process.stdout.write('tactics smoke checks passed\n');
