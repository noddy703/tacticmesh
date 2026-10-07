(function (root) {
  "use strict";
  var TF = root.TF = root.TF || {};
  var MAX_SECONDS = 10, MAX_BYTES = 8 * 1024 * 1024, SAMPLE_TICKS = 3, PLAYBACK_SPEED = 0.5;
  function copyPosition(p) { return { x: p.x, y: p.y, z: p.z || 0 }; }
  function snapshot(match) {
    var players = (match.players || []).map(function (p) {
      return { id: p.id, name: p.name, number: p.number, role: p.role, positionFamily: p.positionFamily, isGoalkeeper: !!p.isGoalkeeper,
        active: p.active !== false, teamId: p.teamId, position: copyPosition(p.position), previousPosition: copyPosition(p.previousPosition || p.position),
        velocity: { x: p.velocity && p.velocity.x || 0, y: p.velocity && p.velocity.y || 0 }, facing: { x: p.facing && p.facing.x || 0, y: p.facing && p.facing.y || 0 },
        stamina: p.stamina || 0, action: p.action ? { type: p.action.type } : null, intent: p.intent ? { type: p.intent.type } : null };
    });
    var teams = (match.teams || []).map(function (t) { return { id: t.id, name: t.name, shortName: t.shortName, attackDirection: t.attackDirection, formation: t.formation, colors: t.colors, color: t.color, score: t.score }; });
    players.forEach(function (p) { p.team = teams.find(function (t) { return t.id === p.teamId; }) || null; });
    return { tick: match.tick, seed: match.seed, time: match.clock && match.clock.elapsedSeconds || 0, period: match.clock && match.clock.period || 1,
      pitch: match.pitch, teams: teams, players: players, ball: { id: match.ball.id, position: copyPosition(match.ball.position), previousPosition: copyPosition(match.ball.previousPosition || match.ball.position), velocity: Object.assign({}, match.ball.velocity), ownerId: match.ball.ownerId },
      referee: { id: "referee-1", position: copyPosition(match.referee.position), previousPosition: copyPosition(match.referee.position), velocity: { x: 0, y: 0 } }, score: Object.assign({}, match.score), clock: { elapsedSeconds: match.clock.elapsedSeconds, period: match.clock.period, minute: match.clock.elapsedSeconds / 60 } };
  }
  function create() {
    var frames = [], bytes = 0, controls = null, playing = false, returnPaused = false, returnCamera = null, cursor = 0, clip = [], playbackTimer = 0, eventSeen = Object.create(null), eventSeenOrder = [];
    function coreRef() { return controls && (typeof controls.core === "function" ? controls.core() : controls.core); }
    function rendererRef() { return controls && (typeof controls.renderer === "function" ? controls.renderer() : controls.renderer); }
    function trim() {
      while (frames.length > 1 && (bytes > MAX_BYTES || (frames[frames.length - 1].time - frames[0].time) > MAX_SECONDS)) bytes -= frames.shift().bytes;
    }
    function capture(match) {
      if (!match || match.tick % SAMPLE_TICKS !== 0) return;
      var data = snapshot(match), size = JSON.stringify(data).length * 2;
      frames.push({ data: data, time: data.time, bytes: size }); bytes += size; trim();
      if (bytes > MAX_BYTES) { while (frames.length > 1 && bytes > MAX_BYTES) bytes -= frames.shift().bytes; }
    }
    function events(match) {
      if (!match) return;
      var list = match.events || [];
      for (var eventIndex = 0; eventIndex < list.length; eventIndex += 1) {
        var ev = list[eventIndex], key = ev.sequence == null ? String(ev.tick) + ":" + String(ev.type) + ":" + JSON.stringify(ev) : "sequence:" + ev.sequence;
        if (eventSeen[key]) continue;
        eventSeen[key] = true; eventSeenOrder.push(key); if (eventSeenOrder.length > 1200) delete eventSeen[eventSeenOrder.shift()];
        if (controls && ["goal", "save"].indexOf(ev.type) >= 0 && controls.autoReplay && controls.autoReplay.checked && !playing && frames.length > 1) start(ev.tick);
      }
    }
    function renderFrame(data) {
      if (!controls || !controls.renderer) return;
      var facade = { tick: data.tick, seed: data.seed, pitch: data.pitch, teams: data.teams, players: data.players, playersById: {}, ball: data.ball, referee: data.referee, score: data.score, clock: data.clock, state: { score: data.score } };
      data.players.forEach(function (p) { facade.playersById[p.id] = p; });
      controls.renderer.capture(facade); controls.renderer.render(facade, 0);
    }
    function finish() {
      if (!playing) return;
      playing = false; clearInterval(playbackTimer);
      if (controls && controls.badge) controls.badge.hidden = true;
      var renderer = rendererRef(), core = coreRef();
      if (renderer && returnCamera) renderer.setCamera(returnCamera.mode, returnCamera.targetId);
      if (controls && controls.match() && renderer) { renderer.capture(controls.match()); renderer.render(controls.match(), 0); }
      if (core && !returnPaused) core.resume();
      if (controls && controls.match() && !returnPaused) controls.match().clock.running = true;
      if (controls && controls.onState) controls.onState(false);
    }
    function start(tick) {
      if (!controls || !controls.match() || frames.length < 2) return false;
      var match = controls.match(), currentFrame = frames.length - 1;
      var target = Number(tick), nearest = -1;
      for (var i = currentFrame; i >= 0; i -= 1) { if (!isFinite(target) || frames[i].data.tick <= target) { nearest = i; break; } }
      if (nearest < 0) nearest = 0;
      clip = frames.slice(Math.max(0, nearest - 50), Math.min(frames.length, nearest + 11)).map(function (frame) { return frame.data; });
      if (clip.length < 2) clip = frames.slice(-Math.min(60, frames.length)).map(function (frame) { return frame.data; });
      var core = coreRef(), renderer = rendererRef();
      returnPaused = core ? core.isPaused() : !match.clock.running;
      returnCamera = renderer && renderer.camera ? { mode: renderer.camera.mode, targetId: renderer.camera.targetId } : null;
      if (core) core.pause(); match.clock.running = false;
      playing = true; cursor = 0; if (controls.badge) controls.badge.hidden = false;
      if (controls.onState) controls.onState(true);
      if (renderer && renderer.setCamera) renderer.setCamera("full-pitch");
      renderFrame(clip[cursor]); cursor = 1;
      var fixedDt = Number(TF.FIXED_DT) > 0 ? Number(TF.FIXED_DT) : 1 / 60;
      var playbackIntervalMs = SAMPLE_TICKS * fixedDt / PLAYBACK_SPEED * 1000;
      playbackTimer = setInterval(function () {
        if (!playing) return;
        renderFrame(clip[cursor]); cursor += 1;
        if (cursor >= clip.length) finish();
      }, playbackIntervalMs);
      return true;
    }
    function bindCore(core) {
      if (core) core.registerSystem(function (match) { capture(match); events(match); });
    }
    function attachControls(config) {
      controls = config || {};
      var wrap = root.document && root.document.querySelector(".canvas-wrap");
      if (wrap && !root.document.getElementById("replayBadge")) {
        var badge = root.document.createElement("div"); badge.id = "replayBadge"; badge.className = "replay-badge"; badge.hidden = true; badge.innerHTML = '<span>REPLAY</span><b>0.5×</b><button type="button" aria-label="Skip replay">Skip</button>'; wrap.appendChild(badge); badge.querySelector("button").addEventListener("click", finish); controls.badge = badge;
        var toolbar = root.document.querySelector(".toolbar"); if (toolbar && !root.document.getElementById("replayControls")) { var box = root.document.createElement("div"); box.className = "replay-controls"; box.id = "replayControls"; box.innerHTML = '<button type="button" id="replayButton" title="Replay the latest chance">↶ Replay</button><label><input id="autoReplay" type="checkbox"> Auto</label>'; toolbar.appendChild(box); box.querySelector("#replayButton").addEventListener("click", function () { start(); }); controls.autoReplay = box.querySelector("#autoReplay"); }
      }
      var core = coreRef();
      if (core) bindCore(core);
    }
    return { capture: capture, play: start, stop: finish, bindCore: bindCore, attachControls: attachControls, getFrames: function () { return frames.map(function (x) { return x.data; }); }, get bytes() { return bytes; }, get maxBytes() { return MAX_BYTES; }, get playing() { return playing; }, reset: function () { finish(); frames = []; bytes = 0; eventSeen = Object.create(null); eventSeenOrder = []; } };
  }
  TF.replay = create();
})(typeof window !== "undefined" ? window : globalThis);
