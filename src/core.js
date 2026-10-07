(function (root) {
  "use strict";

  var TF = root.TF = root.TF || {};
  var FIXED_DT = 1 / 60;
  var checkpointExtensions = {};

  function hashSeed(value) {
    var text = String(value == null ? 1 : value);
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function RNG(seed) {
    this.seed = hashSeed(seed);
    this.state = this.seed || 0x6d2b79f5;
  }

  RNG.prototype.next = function () {
    // Mulberry32: a small, reproducible 32-bit generator.
    var t = this.state = (this.state + 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  RNG.prototype.range = function (min, max) {
    return min + (max - min) * this.next();
  };

  RNG.prototype.int = function (min, max) {
    return Math.floor(this.range(min, max + 1));
  };

  RNG.prototype.pick = function (items) {
    return items && items.length ? items[this.int(0, items.length - 1)] : undefined;
  };

  RNG.prototype.fork = function (label) {
    return new RNG(hashSeed(this.seed + ":" + String(label)));
  };

  RNG.prototype.getState = function () { return this.state >>> 0; };

  RNG.prototype.setState = function (state) {
    this.state = Number(state) >>> 0;
    return this.state;
  };

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function copyInto(target, source) {
    Object.keys(target).forEach(function (key) { delete target[key]; });
    Object.keys(source || {}).forEach(function (key) { target[key] = clone(source[key]); });
    return target;
  }

  function captureCheckpoint(match) {
    if (!match) throw new TypeError("A match is required to capture a checkpoint");
    return {
      format: 1,
      engineVersion: TF.VERSION || "development",
      id: match.id,
      seed: match.seed,
      tick: match.tick,
      dt: match.dt,
      eventTick: match._eventTick,
      eventTickCount: match._eventTickCount,
      matchRngState: match.rng && match.rng.getState ? match.rng.getState() : null,
      clock: clone(match.clock),
      state: clone(match.state),
      score: clone(match.score),
      ball: clone(match.ball),
      referee: clone(match.referee),
      teams: (match.teams || []).map(function (team) {
        return {
          id: team.id, name: team.name, attackDirection: team.attackDirection, formation: team.formation,
          tactics: clone(team.tactics), score: team.score, intent: clone(team.intent),
          activePlayerIds: team.activePlayers.map(function (player) { return player.id; }),
          benchPlayerIds: team.bench.map(function (player) { return player.id; })
        };
      }),
      players: (match.players || []).map(function (player) {
        return {
          id: player.id, active: player.active, role: player.role, positionFamily: player.positionFamily,
          formationSlot: clone(player.formationSlot), position: clone(player.position), previousPosition: clone(player.previousPosition),
          velocity: clone(player.velocity), facing: clone(player.facing), stamina: player.stamina, beliefState: clone(player.beliefState),
          intent: clone(player.intent), action: clone(player.action), currentAction: clone(player.currentAction), motor: clone(player.motor),
          movementTarget: clone(player.movementTarget), ai: clone(player.ai), aiScanAngle: player._aiScanAngle,
          physics: clone(player.physics), stats: clone(player.stats),
          rngState: player.rng && player.rng.getState ? player.rng.getState() : null
        };
      }),
      events: clone(match.events),
      telemetry: clone(match.telemetry),
      extensions: Object.keys(checkpointExtensions).sort().reduce(function (saved, name) {
        saved[name] = clone(checkpointExtensions[name].capture(match));
        return saved;
      }, {})
    };
  }

  function restoreCheckpoint(match, checkpoint) {
    if (!match || !checkpoint || checkpoint.format !== 1) throw new TypeError("A supported checkpoint and match are required");
    if (match.id !== checkpoint.id || match.seed !== checkpoint.seed) throw new Error("Checkpoint match ID and seed must match the target match");
    if (match.players.length !== checkpoint.players.length || match.teams.length !== checkpoint.teams.length) throw new Error("Checkpoint roster does not match target match");
    match.tick = checkpoint.tick;
    match.dt = FIXED_DT;
    if (match.rng && checkpoint.matchRngState != null) match.rng.setState(checkpoint.matchRngState);
    copyInto(match.clock, checkpoint.clock);
    copyInto(match.state, checkpoint.state);
    copyInto(match.score, checkpoint.score);
    copyInto(match.ball, checkpoint.ball);
    copyInto(match.referee, checkpoint.referee);
    var teamsById = {};
    match.teams.forEach(function (team) { teamsById[team.id] = team; });
    checkpoint.teams.forEach(function (saved) {
      var team = teamsById[saved.id];
      if (!team) throw new Error("Checkpoint contains an unknown team: " + saved.id);
      team.name = saved.name;
      team.attackDirection = saved.attackDirection;
      team.formation = saved.formation;
      team.score = saved.score;
      team.intent = clone(saved.intent);
      copyInto(team.tactics, saved.tactics);
      team.activePlayers = saved.activePlayerIds.map(function (id) { return match.playersById[id]; }).filter(Boolean);
      team.bench = saved.benchPlayerIds.map(function (id) { return match.playersById[id]; }).filter(Boolean);
    });
    var playersById = {};
    match.players.forEach(function (player) { playersById[player.id] = player; });
    checkpoint.players.forEach(function (saved) {
      var player = playersById[saved.id];
      if (!player) throw new Error("Checkpoint contains an unknown player: " + saved.id);
      player.active = saved.active;
      player.role = saved.role;
      player.positionFamily = saved.positionFamily;
      player.formationSlot = clone(saved.formationSlot);
      player.position = clone(saved.position);
      player.previousPosition = clone(saved.previousPosition);
      player.velocity = clone(saved.velocity);
      player.facing = clone(saved.facing);
      player.stamina = saved.stamina;
      player.beliefState = clone(saved.beliefState);
      player.intent = clone(saved.intent);
      player.action = clone(saved.action);
      player.currentAction = clone(saved.currentAction);
      player.motor = clone(saved.motor);
      player.movementTarget = clone(saved.movementTarget);
      player.ai = clone(saved.ai);
      player._aiScanAngle = saved.aiScanAngle;
      player.physics = clone(saved.physics);
      player.stats = clone(saved.stats);
      if (player.rng && saved.rngState != null) player.rng.setState(saved.rngState);
    });
    match.events = clone(checkpoint.events || []);
    match._eventTick = checkpoint.eventTick == null ? null : checkpoint.eventTick;
    match._eventTickCount = Number(checkpoint.eventTickCount) || 0;
    match.telemetry = clone(checkpoint.telemetry || {});
    match.world.ball = match.ball;
    Object.keys(checkpoint.extensions || {}).sort().forEach(function (name) {
      if (!checkpointExtensions[name]) throw new Error("Checkpoint extension is unavailable: " + name);
      checkpointExtensions[name].restore(match, clone(checkpoint.extensions[name]));
    });
    if (TF.ui && typeof TF.ui.restoreMatchEvents === "function") TF.ui.restoreMatchEvents(match);
    if (TF.studio && typeof TF.studio.restoreMatchEvents === "function") TF.studio.restoreMatchEvents(match);
    return match;
  }

  function hashCheckpoint(checkpoint) {
    return hashSeed(JSON.stringify(checkpoint)).toString(16).padStart(8, "0");
  }

  function stableId(namespace, value) {
    return String(namespace || "id") + "-" + String(value).replace(/[^a-zA-Z0-9_-]+/g, "-");
  }

  function createCore(config) {
    config = config || {};
    var seed = config.seed == null ? 1 : config.seed;
    var dt = FIXED_DT;
    var maxFrame = config.maxFrameSeconds || 0.25;
    var maxSteps = config.maxStepsPerFrame || 15;
    var match = config.match || (typeof TF.createMatch === "function" ? TF.createMatch(config) : null);
    var snapshotsEnabled = config.renderSnapshots !== false;
    var speed = Math.max(0.1, Number(config.speed) || 1);
    var accumulator = 0;
    var paused = config.paused === true;
    var systems = [];

    function capturePositions(targetMatch) {
      var snapshot = { players: {}, ball: null };
      (targetMatch.players || []).forEach(function (player) {
        snapshot.players[player.id] = {
          x: player.position.x, y: player.position.y, z: player.position.z
        };
      });
      if (targetMatch.ball) snapshot.ball = {
        x: targetMatch.ball.position.x,
        y: targetMatch.ball.position.y,
        z: targetMatch.ball.position.z
      };
      return snapshot;
    }

    function runSystems(targetMatch) {
      if (!targetMatch) return;
      targetMatch.dt = dt;
      if (snapshotsEnabled) targetMatch.renderPrevious = targetMatch.renderCurrent || capturePositions(targetMatch);
      targetMatch.tick = (targetMatch.tick || 0) + 1;
      if (typeof TF.updateTactics === "function") TF.updateTactics(targetMatch, dt);
      if (typeof TF.updateAI === "function") TF.updateAI(targetMatch, dt);
      if (typeof TF.updateWorld === "function") TF.updateWorld(targetMatch, dt);
      for (var i = 0; i < systems.length; i += 1) systems[i].fn(targetMatch, dt);
      if (snapshotsEnabled) targetMatch.renderCurrent = capturePositions(targetMatch);
    }

    function step(count) {
      var n = Math.max(1, Math.floor(count || 1));
      for (var i = 0; i < n; i += 1) {
        if (!paused && match && !(match.state && (match.state.finished || match.state.halfTime))) runSystems(match);
        else break;
        if (paused) break;
      }
      return match;
    }

    function advance(realSeconds) {
      if (paused || !match || (match.state && (match.state.finished || match.state.halfTime))) {
        accumulator = 0;
        return { match: match, steps: 0, alpha: 0, droppedSeconds: 0 };
      }
      var offered = Math.max(0, Number(realSeconds) || 0) * speed;
      var accepted = Math.min(maxFrame, offered);
      var droppedSeconds = Math.max(0, offered - accepted);
      accumulator += accepted;
      var steps = 0;
      while (accumulator >= dt && steps < maxSteps && !(match.state && match.state.finished)) {
        runSystems(match);
        accumulator -= dt;
        steps += 1;
        if (paused) { accumulator = 0; break; }
      }
      if (match.state && match.state.finished) accumulator = 0;
      else if (steps === maxSteps && accumulator >= dt) {
        // The hard catch-up cap intentionally drops remaining wall-time debt.
        droppedSeconds += accumulator - (accumulator % dt);
        accumulator %= dt;
      }
      return { match: match, steps: steps, alpha: accumulator / dt, droppedSeconds: droppedSeconds / speed };
    }

    return {
      seed: seed,
      dt: dt,
      match: match,
      step: step,
      advance: advance,
      pause: function () { paused = true; },
      resume: function () { paused = false; },
      isPaused: function () { return paused; },
      setSpeed: function (value) { speed = Math.max(0.1, Number(value) || 1); return speed; },
      getSpeed: function () { return speed; },
      registerSystem: function (fn) {
        if (typeof fn !== "function") throw new TypeError("Tick system must be a function");
        systems.push({ fn: fn });
        return function () {
          var index = systems.findIndex(function (system) { return system.fn === fn; });
          if (index >= 0) systems.splice(index, 1);
        };
      }
    };
  }

  TF.FIXED_DT = FIXED_DT;
  TF.RNG = RNG;
  TF.hashSeed = hashSeed;
  TF.stableId = stableId;
  TF.captureCheckpoint = captureCheckpoint;
  TF.restoreCheckpoint = restoreCheckpoint;
  TF.hashCheckpoint = hashCheckpoint;
  TF.registerCheckpointExtension = function (name, extension) {
    if (!name || !extension || typeof extension.capture !== "function" || typeof extension.restore !== "function") {
      throw new TypeError("Checkpoint extension needs a name, capture(match), and restore(match,state)");
    }
    checkpointExtensions[String(name)] = extension;
    return function () { delete checkpointExtensions[String(name)]; };
  };
  TF.createCore = createCore;
})(typeof window !== "undefined" ? window : globalThis);
