const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/physics.js');
require('../src/rules.js');
const TF = globalThis.TF;

function openMatch(seed) {
  const match = TF.createMatch({ seed, halfSeconds: 2700 });
  match.state.phase = 'open-play';
  match.state.restartType = null;
  match.state.restartTeamId = null;
  match.tick = 600;
  match.clock.elapsedSeconds = 10;
  match.players.forEach((player, index) => {
    player.position.x = player.previousPosition.x = player.team.side === 'home' ? 24 + index * 0.31 : 76 + index * 0.27;
    player.position.y = player.previousPosition.y = 6 + index % 10 * 5.5;
    player.position.z = player.previousPosition.z = 0;
    player.velocity.x = player.velocity.y = 0;
    player.intent = player.motor = player.currentAction = null;
  });
  match.ball.ownerId = null;
  match.ball.handControl = false;
  match.ball.controlState = 'flight';
  match.ball._touchCooldown = 0;
  return match;
}

function advanceUntilGoal(match) {
  for (let i = 0; i < 30 && !match.events.some(event => event.type === 'goal'); i += 1) {
    match.tick += 1;
    match.clock.elapsedSeconds += TF.FIXED_DT;
    TF.updatePhysics(match, TF.FIXED_DT);
    TF.updateRules(match, TF.FIXED_DT);
  }
  return match.events.find(event => event.type === 'goal');
}

function parryThenGoal(dir) {
  const match = openMatch(94100 + dir);
  const scoringTeam = match.teams.find(team => team.attackDirection === dir);
  const defendingTeam = match.teams.find(team => team !== scoringTeam);
  const shooter = scoringTeam.activePlayers.find(player => player.role === 'ST');
  const keeper = defendingTeam.activePlayers.find(player => player.isGoalkeeper);
  const goalX = dir > 0 ? match.pitch.length : 0;
  keeper.position.x = keeper.previousPosition.x = goalX - dir * 0.8;
  keeper.position.y = keeper.previousPosition.y = match.pitch.width / 2;
  keeper.facing = { x: 0, y: 1 };
  keeper.attributes.handling = keeper.attributes.catching = keeper.attributes.reflexes = 55;
  keeper.rng = { next: () => 0.999 }; // deterministically resolves as a parry, not a catch
  keeper.motor = keeper.intent = { type: 'save', target: { x: keeper.position.x, y: keeper.position.y }, desiredSpeed: 0, createdTick: match.tick };
  shooter.position.x = shooter.previousPosition.x = goalX - dir * 25;
  shooter.position.y = shooter.previousPosition.y = match.pitch.width / 2;
  match.ball.position = { x: goalX - dir * 1.9, y: match.pitch.width / 2, z: 0.11 };
  match.ball.previousPosition = { ...match.ball.position };
  match.ball.velocity = { x: dir * 15, y: 0, z: 0 };
  match.ball.lastTouchPlayerId = shooter.id;
  match.ball.lastTouchTeamId = shooter.teamId;
  match.ball.lastTouchKind = 'deliberate';
  match.ball._lastShotId = shooter.id;
  match.ball._lastShotType = 'shot';

  TF.updatePhysics(match, TF.FIXED_DT);
  const parry = match.events.find(event => event.type === 'save' && event.keeperId === keeper.id);
  assert.ok(parry && parry.caught === false, `${dir > 0 ? 'home' : 'away'} fixture must physically parry the shot`);
  assert.equal(parry.shotBy, shooter.id);
  assert.equal(match.ball.lastTouchKind, 'save');
  assert.equal(match.ball._lastShotId, shooter.id, 'parry must preserve unbroken attacker shot provenance');

  const goal = advanceUntilGoal(match);
  assert.ok(goal, 'the post-parry ball should physically cross the goal line');
  assert.equal(goal.teamId, scoringTeam.id);
  assert.equal(goal.scorerId, shooter.id, 'an unbroken attacker shot ending after a goalkeeper save should credit its shooter');
  assert.equal(goal.shotPlayerId, shooter.id);
  return { match, shooter, keeper, goal };
}

function defenderControlsThenOwnGoal(dir) {
  const match = openMatch(94200 + dir);
  const scoringTeam = match.teams.find(team => team.attackDirection === dir);
  const defendingTeam = match.teams.find(team => team !== scoringTeam);
  const shooter = scoringTeam.activePlayers.find(player => player.role === 'ST');
  const defender = defendingTeam.activePlayers.find(player => !player.isGoalkeeper && player.role === 'RCB');
  const keeper = defendingTeam.activePlayers.find(player => player.isGoalkeeper);
  const goalX = dir > 0 ? match.pitch.length : 0;
  defender.position.x = defender.previousPosition.x = goalX - dir * 2.8;
  defender.position.y = defender.previousPosition.y = match.pitch.width / 2;
  defender.facing = { x: -dir, y: 0 };
  defender.attributes.firstTouch = 90;
  defender.rng = { next: () => 0 };
  keeper.position.x = keeper.previousPosition.x = goalX - dir * 12;
  keeper.position.y = keeper.previousPosition.y = match.pitch.width / 2;
  shooter.position.x = shooter.previousPosition.x = goalX - dir * 25;
  shooter.position.y = shooter.previousPosition.y = match.pitch.width / 2;
  match.ball.position = { x: goalX - dir * 3.4, y: match.pitch.width / 2, z: 0.11 };
  match.ball.previousPosition = { ...match.ball.position };
  match.ball.velocity = { x: dir * 12, y: 0, z: 0 };
  match.ball.lastTouchPlayerId = shooter.id;
  match.ball.lastTouchTeamId = shooter.teamId;
  match.ball.lastTouchKind = 'deliberate';
  match.ball._lastShotId = shooter.id;
  match.ball._lastShotType = 'shot';

  TF.updatePhysics(match, TF.FIXED_DT);
  assert.ok(match.events.some(event => event.type === 'ball-control' && event.playerId === defender.id),
    `${dir > 0 ? 'home' : 'away'} defender must physically control the shot`);
  assert.equal(match.ball.lastTouchPlayerId, defender.id);
  assert.equal(match.ball.lastTouchKind, 'control');
  assert.equal(match.ball._lastShotId, null, 'controlled defender contact must end the previous shot attribution');
  assert.equal(match.ball._lastShotType, null);

  // The controlled ball is subsequently mishit across the defender's own goal.
  // Keep this second phase deterministic so this regression tests attribution,
  // while the first phase proves the actual physical control transition.
  match.ball.ownerId = null;
  match.ball.position = { x: goalX - dir * 0.9, y: match.pitch.width / 2, z: 0.11 };
  match.ball.previousPosition = { x: goalX - dir * 1.15, y: match.pitch.width / 2, z: 0.11 };
  match.ball.velocity = { x: dir * 15, y: 0, z: 0 };
  const goal = advanceUntilGoal(match);
  assert.ok(goal, 'the defender-controlled loose ball should cross the own goal line');
  assert.equal(goal.teamId, scoringTeam.id);
  assert.equal(goal.scorerId, null, 'a prior attacking shooter must not receive credit after defender control');
  assert.equal(goal.shotPlayerId, null, 'a defender-controlled own goal must not retain the prior shot id');
  assert.equal(match.ball.lastTouchPlayerId, defender.id);
  return { match, defender, goal };
}

function caughtKeeperEndsShot(dir) {
  const match = openMatch(94300 + dir);
  const scoringTeam = match.teams.find(team => team.attackDirection === dir);
  const defendingTeam = match.teams.find(team => team !== scoringTeam);
  const shooter = scoringTeam.activePlayers.find(player => player.role === 'ST');
  const keeper = defendingTeam.activePlayers.find(player => player.isGoalkeeper);
  const goalX = dir > 0 ? match.pitch.length : 0;
  keeper.position.x = keeper.previousPosition.x = goalX - dir * 0.8;
  keeper.position.y = keeper.previousPosition.y = match.pitch.width / 2;
  keeper.facing = { x: -dir, y: 0 };
  keeper.rng = { next: () => 0 };
  shooter.position.x = shooter.previousPosition.x = goalX - dir * 25;
  shooter.position.y = shooter.previousPosition.y = match.pitch.width / 2;
  match.ball.position = { x: goalX - dir * 1.9, y: match.pitch.width / 2, z: 0.11 };
  match.ball.previousPosition = { ...match.ball.position };
  match.ball.velocity = { x: dir * 15, y: 0, z: 0 };
  match.ball.lastTouchPlayerId = shooter.id;
  match.ball.lastTouchTeamId = shooter.teamId;
  match.ball.lastTouchKind = 'deliberate';
  match.ball._lastShotId = shooter.id;
  match.ball._lastShotType = 'shot';
  TF.updatePhysics(match, TF.FIXED_DT);
  const catchEvent = match.events.find(event => event.type === 'save' && event.keeperId === keeper.id);
  assert.ok(catchEvent && catchEvent.caught, 'keeper should physically catch the shot');
  assert.equal(catchEvent.shotBy, shooter.id, 'the catch event retains shot provenance');
  assert.equal(match.ball._lastShotId, null, 'a caught shot must end active shot provenance');
  assert.equal(match.ball._lastShotType, null);
}

for (const dir of [1, -1]) {
  const parry = parryThenGoal(dir);
  assert.equal(parry.match.score[parry.goal.teamId === parry.match.teams[0].id ? 'home' : 'away'], 1);
  const ownGoal = defenderControlsThenOwnGoal(dir);
  assert.equal(ownGoal.match.score[ownGoal.goal.teamId === ownGoal.match.teams[0].id ? 'home' : 'away'], 1);
  caughtKeeperEndsShot(dir);
}

process.stdout.write('goal attribution preserves continuous shot credit through mirrored goalkeeper parries and clears it after defender control\n');
