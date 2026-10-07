const assert = require('node:assert/strict');
for (const name of ['core', 'world', 'tactics', 'intelligence', 'physics', 'rules', 'telemetry', 'labs']) require('../src/' + name + '.js');
const TF = globalThis.TF;
const match = TF.createMatch({ seed: 74601, halfSeconds: 90, matchId: 'neutral-possession-integrity' });
TF.configureAIScenario(match, '4v4+3 possession');
const home = match.teams[0], away = match.teams[1];
const neutrals = match.state.labNeutralIds.map(id => match.playersById[id]);
assert.equal(match.state.labNeutralTeamId, home.id, 'the fixture starts with its configured home support side');
const bases = Object.values(match.state.labBaseLineups).flat().map(id => match.playersById[id]);
const baseAnchors = new Map(bases.map(p => [p.id, { x: p.formationSlot.x, y: p.formationSlot.y }]));

// Opponent last touch/deflection while the ball is loose must not switch
// neutral support or rewrite the stationary base formation anchors.
match.ball.ownerId = null; match.ball.controlState = 'loose';
match.ball.lastTouchTeamId = away.id;
bases[0].position.x += 4; bases[0].position.y += 2;
TF.updateLabNeutrals(match);
assert.equal(match.state.labNeutralTeamId, home.id, 'an opponent deflection while loose does not switch neutral affiliation');
assert.ok(neutrals.every(p => p.teamId === home.id), 'loose-ball deflection leaves neutral support on the prior team');
assert.deepEqual({ x: bases[0].formationSlot.x, y: bases[0].formationSlot.y }, baseAnchors.get(bases[0].id), 'base role anchor must not follow the moving player');
const neutralAnchorBefore = { ...neutrals[0].formationSlot };
neutrals[0].position.x += 3;
TF.updateLabNeutrals(match);
assert.deepEqual(neutrals[0].formationSlot, neutralAnchorBefore, 'neutral anchor must not drift during movement without an affiliation change');

// A real opponent-controlled possession changes affiliation once and maps
// the neutral's anchor at the new side without teleporting its position.
const receiver = away.activePlayers.find(p => !p.isGoalkeeper);
match.ball.ownerId = receiver.id; match.ball.controlState = 'controlled'; match.ball.lastTouchTeamId = away.id;
const physicalPosition = { ...neutrals[0].position };
TF.updateLabNeutrals(match);
assert.equal(match.state.labNeutralTeamId, away.id, 'actual opponent control changes the support side');
assert.ok(neutrals.every(p => p.teamId === away.id), 'all neutral players affiliate with the controlled side');
assert.deepEqual(neutrals[0].position, physicalPosition, 'changing neutral support never teleports the player');
const mappedAnchor = away.attackDirection > 0 ? physicalPosition.x : match.pitch.length - physicalPosition.x;
assert.equal(neutrals[0].formationSlot.x, mappedAnchor, 'neutral role anchor is remapped at the controlled possession change');
const anchorAfterSwitch = { ...neutrals[0].formationSlot };
neutrals[0].position.x -= 2;
TF.updateLabNeutrals(match);
assert.deepEqual(neutrals[0].formationSlot, anchorAfterSwitch, 'neutral anchor stays fixed while the player moves after a switch');
assert.deepEqual({ x: bases[0].formationSlot.x, y: bases[0].formationSlot.y }, baseAnchors.get(bases[0].id), 'base role anchors remain fixed after side changes');
process.stdout.write('AI possession fixture keeps neutral affiliation possession-driven and role anchors stable\n');
