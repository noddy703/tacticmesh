const assert = require("node:assert/strict");
require("../src/core.js");
require("../src/world.js");
require("../src/replay.js");
require("../src/audio.js");
require("../src/studio.js");

const TF = globalThis.TF;
const match = TF.createMatch({ seed: 77, autoStart: true });
const replay = TF.replay;
replay.reset();
const rendered = [];
const cameraCalls = [];
const renderer = {
  camera: { mode: "follow", targetId: "ball-1" },
  capture(state) { rendered.push(state); }, render(state) { rendered.push(state); },
  setCamera(mode, target) { cameraCalls.push([mode, target]); this.camera.mode = mode; this.camera.targetId = target; }
};
let core;
const autoReplay = { checked: false };
replay.attachControls({ match: () => match, core: () => core, renderer, autoReplay, badge: { hidden: true } });
core = TF.createCore({ match, maxStepsPerFrame: 15, maxFrameSeconds: 0.25 });
core.registerSystem((m) => { if (m.tick === 10) m.events.push({ type: "goal", tick: m.tick, teamId: m.teams[0].id }); });
replay.bindCore(core);
core.step(9);
assert.equal(replay.getFrames().length, 3, "render-only snapshots are sampled every third tick");
autoReplay.checked = true;
const beforeEventAdvance = match.tick;
const originalSetInterval = global.setInterval;
let replayIntervalMs = null;
global.setInterval = (callback, delay) => {
  replayIntervalMs = delay;
  return originalSetInterval(callback, 100000);
};
core.advance(0.25);
global.setInterval = originalSetInterval;
assert.equal(match.tick, beforeEventAdvance + 1, "auto replay pauses at the triggering tick boundary");
assert.equal(replay.playing, true, "important event starts a replay");
const capturedFrames = replay.getFrames();
assert.ok(Math.abs(replayIntervalMs - (capturedFrames[1].time - capturedFrames[0].time) * 1000 / 0.5) < 1e-9,
  "replay wall-clock interval matches sampled simulation time at the displayed 0.5x speed");
assert.equal(replayIntervalMs, 100, "three ticks at 60 Hz play over 100 ms at half speed");
assert.equal(core.isPaused(), true, "live core is paused during replay");
const liveTick = match.tick;
replay.stop();
assert.equal(match.tick, liveTick, "replay rendering leaves the live match untouched");
assert.equal(core.isPaused(), false, "replay restores a previously running match");
assert.deepEqual(cameraCalls.at(-1), ["follow", "ball-1"], "replay restores the live camera");
assert.ok(rendered.some((state) => state !== match), "replay sends isolated snapshot facades to the renderer");

core.pause();
assert.equal(replay.play(), true, "a manual replay can start from a paused match");
replay.stop();
assert.equal(core.isPaused(), true, "replay keeps a match paused when it started paused");

const hugeMatch = TF.createMatch({ seed: 78 });
hugeMatch.players.forEach((p) => { p.name = "x".repeat(9000); });
replay.reset();
for (let i = 0; i < 240; i += 1) {
  hugeMatch.tick = i * 3;
  hugeMatch.clock.elapsedSeconds = i / 20;
  replay.capture(hugeMatch);
}
assert.ok(replay.bytes <= 8 * 1024 * 1024, "replay storage respects the 8 MB cap");
const frames = replay.getFrames();
assert.ok(frames.length <= 200, "replay history is bounded to ten seconds at 20 fps");
assert.ok(frames.at(-1).time - frames[0].time <= 10, "old replay snapshots are evicted by elapsed time");

assert.equal(TF.audio.isEnabled(), false, "audio starts muted until a user gesture");
assert.equal(TF.audio.toggle(true), true, "audio can be enabled explicitly");
assert.equal(TF.audio.toggle(false), false, "audio mute toggle is independent and reversible");
const randomState = match.rng.getState();
TF.studio.mount(match);
assert.equal(match.rng.getState(), randomState, "studio presentation setup does not advance simulation RNG");
assert.equal(TF.studio.eventLabel({ type: "offside" }, match).title, "OFFSIDE", "studio maps rules events to presentation graphics");

console.log("presentation replay bounds, tick pause, live state, audio mute, and studio hooks passed");
