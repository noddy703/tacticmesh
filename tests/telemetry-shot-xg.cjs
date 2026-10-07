const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/telemetry.js');
const TF = globalThis.TF;
const shooter = { id: 'shooter', teamId: 'home', position: { x: 20, y: 5 } };
const keeper = { id: 'keeper', teamId: 'away', isGoalkeeper: true, active: true, position: { x: 102, y: 34 } };
const match = {
  pitch: { length: 105, width: 68, goalWidth: 7.32 },
  teams: [{ id: 'home', attackDirection: 1 }, { id: 'away', attackDirection: -1 }],
  playersById: { shooter, keeper }, players: [shooter, keeper], ball: { position: { x: 80, y: 34 } }
};
const estimate = (origin) => TF.telemetry.estimateShotXG(match, { type: 'shot', playerId: 'shooter', teamId: 'home', origin, lift: 0 });

const central = estimate({ x: 85, y: 34 });
const wideAbove = estimate({ x: 85, y: 20 });
const wideBelow = estimate({ x: 85, y: 48 });
assert.ok(central > wideAbove, `central shot (${central}) should see more goal than a wide shot (${wideAbove}) at the same x`);
assert.equal(wideAbove, wideBelow, 'mirrored lateral origins produce equal angle/range estimates');

// The event's frozen kick origin must dominate later mutable player position.
shooter.position = { x: 4, y: 60 };
assert.equal(estimate({ x: 85, y: 34 }), central, 'later shooter movement cannot rewrite the shot origin used by xG');
assert.equal(estimate({ x: 85, y: 34 }), estimate({ x: 85, y: 34 }), 'shot estimate is deterministic and consumes no RNG');

process.stdout.write('telemetry xG geometry passes (lateral angle, mirrored origin, frozen kick origin, deterministic estimate)\n');
