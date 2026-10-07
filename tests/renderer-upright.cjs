const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/camera.js');
require('../src/renderer.js');
require('../src/product-appearance.js');

const TF = globalThis.TF;
const calls = [];
function makeCanvas() {
  const context = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (key === 'measureText') return () => ({ width: 0 });
      if (typeof key === 'string') return (...args) => {
        if (key === 'rotate' || key === 'scale' || key === 'fill' || key === 'fillRect') calls.push({ key, args, color: target.fillStyle });
      };
    },
    set(target, key, value) { target[key] = value; return true; }
  });
  return {
    width: 800, height: 500, clientWidth: 800, clientHeight: 500, parentElement: null,
    ownerDocument: { createElement: () => makeCanvas() },
    getBoundingClientRect: () => ({ width: 800, height: 500 }),
    getContext: () => context
  };
}

const match = TF.createMatch({ seed: 4401 });
const player = match.players.find(p => p.active && !p.isGoalkeeper);
match.players.forEach(p => { p.active = false; });
player.active = true;
player.position = { x: 41, y: 27, z: 0 };
player.previousPosition = { ...player.position };
player.velocity = { x: 0, y: 0 };
match.ball = null;
match.referee = null;
const renderer = TF.createRenderer(makeCanvas(), { showNumbers: false });

function renderFacing(facing) {
  calls.length = 0;
  player.facing = facing;
  renderer.render(match, 0);
  const bodyScales = calls.filter(call => call.key === 'scale');
  const bodyRotations = calls.filter(call => call.key === 'rotate');
  assert.equal(bodyScales.length, 1, 'upright player gets one horizontal yaw scale');
  assert.equal(bodyRotations.length, 0, 'ordinary facing does not rotate the whole body');
  assert.equal(bodyScales[0].args[1], 1, 'yaw keeps the player upright on the screen');
  return bodyScales[0].args[0];
}

const sideFacing = renderFacing({ x: 1, y: -1 });
const depthFacing = renderFacing({ x: 1, y: 1 });
assert.ok(sideFacing > depthFacing + .25, 'yaw cues distinguish side-on and depth-facing posture');
assert.deepEqual(player.position, { x: 41, y: 27, z: 0 }, 'rendering leaves world position unchanged');
const screen = renderer.camera.project(player.position);
assert.equal(renderer.hitTest(screen.x, screen.y).id, player.id, 'upright rendering preserves player selection location');

player.visualMotion = { type: 'tackle', tick: match.tick - 14 };
calls.length = 0;
renderer.render(match, 0);
assert.ok(calls.some(call => call.key === 'rotate' && Math.abs(call.args[0]) > .1), 'actual fall motion can still tilt the player');

// The imported kit's chosen trim must match its procedural portrait, including
// snapshot players that retain only teamId. Legacy teams still get contrast trim.
const importedTeam = { id: player.teamId, colors: { primary: '#2b957b', secondary: '#f3e0b0' } };
match.teams = [importedTeam];
player.team = importedTeam;
player.appearance = { skinColor: '#8b5a3c', hairColor: '#241b18', hairStyle: 'crop' };
delete player.visualMotion;
const renderState = JSON.stringify({ tick: match.tick, rng: match.rng.getState(), player });
function renderedTrim() {
  calls.length = 0;
  renderer.render(match, 0);
  const trim = calls.find(call => call.key === 'fillRect' && call.args.join(',') === '-4.1,-13,1.5,5.5');
  assert.ok(trim, 'pitch kit trim is actually drawn');
  return trim.color;
}
assert.equal(renderedTrim(), importedTeam.colors.secondary, 'pitch trim uses imported secondary colour');
const portrait = decodeURIComponent(TF.appearance.portrait(player, importedTeam).split(',')[1]);
assert.ok(portrait.includes('stroke="' + renderedTrim() + '"'), 'portrait and pitch use the same chosen trim');
for (const color of [importedTeam.colors.primary, player.appearance.skinColor, player.appearance.hairColor]) {
  assert.ok(calls.some(call => call.key === 'fill' && call.color === color), 'primary kit, skin and hair remain chosen colours: ' + color);
}
assert.equal(JSON.stringify({ tick: match.tick, rng: match.rng.getState(), player }), renderState, 'cosmetic rendering changes neither player state nor simulation RNG');
delete player.team;
assert.equal(renderedTrim(), '#f3e0b0', 'teamId-only snapshot resolves secondary from match teams');
delete importedTeam.colors.secondary;
assert.equal(renderedTrim(), '#f8f4e8', 'legacy dark primary keeps contrasting light trim');
importedTeam.colors.secondary = 'url(https://example.invalid/trim)';
assert.equal(renderedTrim(), '#f8f4e8', 'invalid imported trim falls back to contrast');
importedTeam.colors.primary = '#eee8dd';
assert.equal(renderedTrim(), '#142127', 'legacy light primary keeps contrasting dark trim');
renderer.destroy();
console.log('upright player rendering preserves yaw cues, world location, selection, physical fall tilt, and chosen kit/portrait colours');
