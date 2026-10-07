(function (root) {
  "use strict";

  var TF = root.TF = root.TF || {};
  var FACADE_VERSION = "1.0.0";
  var SCHEMA_VERSION = 1;
  var clone = function (value) { return value == null ? value : JSON.parse(JSON.stringify(value)); };
  function cloneTemplateValue(value) {
    if (!value || typeof value !== "object") return value;
    try { return clone(value); } catch (_) { return value; }
  }
  function clonePlayerTemplate(template) {
    var result = {};
    Object.keys(template || {}).forEach(function (key) {
      var value = template[key];
      result[key] = key === "team" || key === "rng" ? value : cloneTemplateValue(value);
    });
    return result;
  }
  function attributeNames() { return TF.productData && Array.isArray(TF.productData.attributes) ? TF.productData.attributes : []; }
  var allowedFamilies = ["GK", "DEF", "MID", "FWD"];

  function fail(code, message, path) { return { code: code, message: message, path: path || "$" }; }
  function validateTeam(team, path) {
    var errors = [], players = team && team.players;
    if (!team || typeof team !== "object") return [fail("TEAM_REQUIRED", "A compiled team is required.", path)];
    if (typeof team.id !== "string" || !team.id) errors.push(fail("TEAM_ID", "Team ID is required.", path + ".id"));
    if (!TF.FORMATIONS || !TF.FORMATIONS[team.formation]) errors.push(fail("FORMATION", "Choose a supported formation.", path + ".formation"));
    if (!Array.isArray(players) || players.length < 11 || players.length > 30) errors.push(fail("ROSTER_SIZE", "A team roster must contain 11–30 players.", path + ".players"));
    if (!Array.isArray(team.lineup) || team.lineup.length !== 11 || new Set(team.lineup).size !== 11) errors.push(fail("LINEUP", "The starting lineup must contain 11 distinct player IDs.", path + ".lineup"));
    if (Array.isArray(players)) {
      var ids = new Set();
      players.forEach(function (p, i) {
        var pp = path + ".players[" + i + "]";
        if (!p || typeof p !== "object" || Array.isArray(p)) { errors.push(fail("PLAYER", "A player record is required.", pp)); return; }
        if (typeof p.id !== "string" || !p.id || ids.has(p.id)) errors.push(fail("PLAYER_ID", "Player IDs must be unique and nonempty.", pp + ".id"));
        else ids.add(p.id);
        if (!allowedFamilies.includes(p.positionFamily)) errors.push(fail("POSITION_FAMILY", "Unsupported player position family.", pp + ".positionFamily"));
        if (!p.attributes || typeof p.attributes !== "object") errors.push(fail("ATTRIBUTES", "Compiled player attributes are required.", pp + ".attributes"));
        else attributeNames().forEach(function (key) { var value = p.attributes[key]; if (!Number.isInteger(value) || value < 1 || value > 100) errors.push(fail("ATTRIBUTE_INVALID", "Compiled attribute must be an integer from 1 to 100: " + key, pp + ".attributes." + key)); });
        if (!p.traits || typeof p.traits !== "object") errors.push(fail("TRAITS", "Compiled player traits are required.", pp + ".traits"));
      });
      if (Array.isArray(team.lineup)) {
        if (team.lineup.some(function (id) { return !ids.has(id); })) errors.push(fail("LINEUP_MEMBER", "Every starter must belong to the roster.", path + ".lineup"));
        var starters = team.lineup.map(function (id) { return players.find(function (p) { return p.id === id; }); });
        if (starters.filter(function (p) { return p && p.positionFamily === "GK"; }).length !== 1 || !starters[0] || starters[0].positionFamily !== "GK") errors.push(fail("STARTING_GOALKEEPER", "The first lineup slot must be the only starting goalkeeper.", path + ".lineup"));
      }
    }
    return errors;
  }
  function validateMatchConfig(config) {
    var errors = [];
    if (!config || typeof config !== "object") return { ok: false, errors: [fail("CONFIG_REQUIRED", "A match configuration is required.")] };
    if (!Number.isFinite(Number(config.seed))) errors.push(fail("SEED", "A finite numeric seed is required.", "seed"));
    if (typeof config.matchId !== "string" || !config.matchId) errors.push(fail("MATCH_ID", "A stable match ID is required.", "matchId"));
    errors = errors.concat(validateTeam(config.home, "home"), validateTeam(config.away, "away"));
    if (config.home && config.away && config.home.id === config.away.id) errors.push(fail("DUPLICATE_TEAM", "Home and away must be different team IDs."));
    if (config.halfSeconds != null && (!Number.isFinite(Number(config.halfSeconds)) || Number(config.halfSeconds) <= 0)) errors.push(fail("HALF_DURATION", "halfSeconds must be positive when provided.", "halfSeconds"));
    if (config.knockout != null && typeof config.knockout !== "boolean") errors.push(fail("KNOCKOUT", "knockout must be a boolean.", "knockout"));
    return { ok: errors.length === 0, errors: errors };
  }
  function encodeId(value) {
    return Array.from(String(value), function (c) { return c.codePointAt(0).toString(16).padStart(6, "0"); }).join("");
  }
  function teamEngineId(side, team) { return "tm-" + side + "-" + encodeId(team.id); }
  function playerEngineId(side, team, player) { return "tm-" + side + "-" + encodeId(team.id) + "-p-" + encodeId(player.id); }
  function simulationIdentity(config) {
    return {
      matchId: config.matchId, seed: Number(config.seed),
      knockout: Boolean(config.knockout),
      halfSeconds: Number(config.halfSeconds) > 0 ? Number(config.halfSeconds) : 2700,
      rulesVersion: rulesVersion(),
      teams: ["home", "away"].map(function (side) {
        var t = config[side];
        return { side: side, id: t.id, simulationHash: t.simulationHash || (TF.productData && TF.productData.hash ? TF.productData.hash(TF.productData.simulationTeam(t)) : null), formation: t.formation, tactics: t.tactics, lineup: t.lineup };
      })
    };
  }
  function rulesVersion() { return TF.rules && TF.rules.version || (TF.rulesConfig && TF.rulesConfig.version) || "tf-laws-v1"; }
  function checkpointIdentity(config) {
    return TF.productData && TF.productData.hash ? TF.productData.hash(simulationIdentity(config)) : JSON.stringify(simulationIdentity(config));
  }
  function fallbackAIRng(state) {
    return { state: Number(state) | 0, next: function () { this.state = (this.state + 0x6D2B79F5) | 0; var t = this.state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; } };
  }
  if (typeof TF.registerCheckpointExtension === "function") TF.registerCheckpointExtension("engine-auxiliary-state-v1", {
    capture: function (match) {
      return {
        version: 1, rulesConfig: clone(match.rulesConfig), substitutionRequests: clone(match.substitutionRequests), aiTime: match._aiTime,
        players: (match.players || []).map(function (player) {
          return { id: player.id, ballControlState: player.ballControlState, positionGroup: player.positionGroup,
            visualMotion: clone(player.visualMotion), aiRngState: player._aiRng && player._aiRng.state };
        })
      };
    },
    restore: function (match, saved) {
      if (!saved || saved.version !== 1) throw new Error("Unsupported auxiliary-state checkpoint extension");
      if (saved.rulesConfig === undefined) delete match.rulesConfig; else match.rulesConfig = clone(saved.rulesConfig);
      if (saved.substitutionRequests === undefined) delete match.substitutionRequests; else match.substitutionRequests = clone(saved.substitutionRequests);
      if (saved.aiTime === undefined) delete match._aiTime; else match._aiTime = saved.aiTime;
      var players = new Map((match.players || []).map(function (player) { return [player.id, player]; }));
      (saved.players || []).forEach(function (state) {
        var player = players.get(state.id); if (!player) throw new Error("Auxiliary checkpoint contains an unknown player: " + state.id);
        if (state.ballControlState === undefined) delete player.ballControlState; else player.ballControlState = state.ballControlState;
        if (state.positionGroup === undefined) delete player.positionGroup; else player.positionGroup = state.positionGroup;
        if (state.visualMotion === undefined) delete player.visualMotion; else player.visualMotion = clone(state.visualMotion);
        if (state.aiRngState === undefined) delete player._aiRng; else player._aiRng = fallbackAIRng(state.aiRngState);
      });
    }
  });
  function initializeTeam(match, source, side) {
    var team = match.teams[side === "home" ? 0 : 1], originalPlayers = team.players.slice();
    var slotList = TF.FORMATIONS[source.formation];
    team.id = teamEngineId(side, source);
    team.sourceId = source.id;
    team.sourceTeamId = source.id;
    team.sourcePackId = source.packId || null;
    team.packTitle = source.packTitle || null;
    team.revision = source.revision || null;
    team.contentHash = source.contentHash || null;
    team.simulationHash = source.simulationHash || null;
    team.name = source.name;
    team.abbreviation = source.abbreviation || "";
    team.season = source.season || "";
    team.crest = source.crest || null;
    team.kits = clone(source.kits || {});
    team.colors = clone(source.colors || (source.kits && source.kits.home) || team.colors);
    team.formation = source.formation;
    team.tactics = clone(source.tactics || {});
    team.provenance = clone(source.provenance || null);
    team.dataLicense = source.dataLicense || "unknown";
    team.imputed = clone(source.imputed || []);
    var byFamily = {};
    originalPlayers.forEach(function (p) { (byFamily[p.positionFamily] || (byFamily[p.positionFamily] = [])).push(p); });
    var players = source.players.map(function (record, index) {
      var family = record.positionFamily;
      var template = (byFamily[family] && byFamily[family][0]) || originalPlayers[index % originalPlayers.length];
      var p = clonePlayerTemplate(template);
      p.id = playerEngineId(side, source, record);
      p.sourceId = record.id;
      p.sourcePlayerId = record.id;
      p.sourceTeamId = source.id;
      p.teamId = team.id;
      p.team = team;
      p.number = record.number;
      p.name = record.name;
      p.positionFamily = family;
      p.isGoalkeeper = family === "GK";
      p.preferredFoot = record.preferredFoot || "right";
      p.preferredRoleCode = record.preferredRole || (record.roles && record.roles[0]) || family;
      p.height = record.height;
      p.weight = record.weight;
      p.attributes = clone(record.attributes);
      p.traits = clone(record.traits);
      p.portrait = record.portrait || null;
      p.appearance = clone(record.appearance || {});
      p.active = false;
      p.rng = new TF.RNG(String(configSeed(match)) + ":" + side + ":" + source.id + ":" + record.id + ":decisions");
      p.position = { x: side === "home" ? 28 : 77, y: 34, z: 0 };
      p.previousPosition = { x: p.position.x, y: p.position.y, z: 0 };
      p.velocity = { x: 0, y: 0, z: 0 };
      p.facing = { x: team.attackDirection, y: 0 };
      p.stamina = 1;
      p.beliefState = null; p.intent = null; p.action = null; p.currentAction = null; p.motor = null; p.movementTarget = null; p.ai = null;
      p.stats = { minutes: 0, goals: 0, assists: 0, passes: 0, shots: 0, tackles: 0 };
      return p;
    });
    var bySourceId = new Map(players.map(function (p) { return [p.sourceId, p]; }));
    var activePlayers = source.lineup.map(function (id, index) {
      var p = bySourceId.get(id), slot = slotList[index];
      p.active = true;
      p.role = slot[0];
      p.preferredRole = slot[0];
      p.formationSlot = { x: slot[2], y: slot[3], role: slot[0] };
      p.position = { x: team.attackDirection > 0 ? slot[2] : match.pitch.length - slot[2], y: slot[3], z: 0 };
      p.previousPosition = { x: p.position.x, y: p.position.y, z: 0 };
      return p;
    });
    var bench = players.filter(function (p) { return !p.active; });
    bench.forEach(function (p, i) {
      var x = p.isGoalkeeper ? 5 : 26 + (i % 5) * 6;
      p.role = p.preferredRoleCode || p.positionFamily;
      p.preferredRole = p.preferredRoleCode || p.positionFamily;
      p.formationSlot = { x: x, y: 12 + (i % 8) * 6, role: p.role };
      p.position = { x: team.attackDirection > 0 ? x : match.pitch.length - x, y: p.formationSlot.y, z: 0 };
      p.previousPosition = { x: p.position.x, y: p.position.y, z: 0 };
    });
    team.players = players; team.activePlayers = activePlayers; team.bench = bench;
    team.match = match;
    return players;
  }
  function configSeed(match) { return match.seed; }
  function buildMatch(config) {
    var raw = { seed: config.seed, matchId: config.matchId, autoStart: true, halfSeconds: config.halfSeconds,
      home: { id: teamEngineId("home", config.home), name: config.home.name, formation: config.home.formation, tactics: config.home.tactics, colors: config.home.colors },
      away: { id: teamEngineId("away", config.away), name: config.away.name, formation: config.away.formation, tactics: config.away.tactics, colors: config.away.colors } };
    var match = TF.createMatch(raw);
    initializeTeam(match, config.home, "home"); initializeTeam(match, config.away, "away");
    match.players = match.teams[0].players.concat(match.teams[1].players);
    match.playersById = Object.create(null);
    match.players.forEach(function (p) { match.playersById[p.id] = p; });
    match.world.players = match.players; match.world.playersById = match.playersById; match.world.teams = match.teams;
    match.state.restartTeamId = match.teams[0].id;
    return match;
  }
  function engineBuild() { return TF.ENGINE_BUILD || ("tf-core-" + (TF.VERSION || "development")); }
  function createMatch(config) {
    var report = validateMatchConfig(config);
    if (!report.ok) { var error = new TypeError("Invalid match configuration: " + report.errors.map(function (e) { return e.path + " " + e.message; }).join("; ")); error.validation = report; throw error; }
    var frozenConfig = clone(config), match = buildMatch(frozenConfig), core = TF.createCore({ match: match, seed: Number(config.seed), paused: false });
    var handle = { match: match, core: core, config: frozenConfig, status: "running", simulationHash: TF.productData && TF.productData.hash ? TF.productData.hash(simulationIdentity(config)) : null, engineBuild: engineBuild(), knockout: Boolean(config.knockout), _run: null };
    if (handle.knockout) installShootoutScoreHook(handle);
    match.engineHandle = handle;
    installAdvanceAdapter(handle);
    return handle;
  }
  function statusOf(handle) {
    if (handle.status === "cancelled" || handle.status === "error") return handle.status;
    var m = handle.match;
    if (m.state.finished) return "completed";
    if (m.state.halfTime) return "half-time";
    return handle.status === "cancelled" ? "cancelled" : "running";
  }
  function continueAfterHalfTime(handle) {
    if (!handle || !handle.match || !handle.match.state.halfTime) return false;
    var ok;
    if (handle.knockout && handle.match.state.knockoutState && handle.match.state.knockoutState.phase === "extra-time-break") {
      beginExtraTimePeriod(handle, 4, true); ok = true;
    } else ok = handle.match.startSecondHalf();
    if (ok) { handle.status = "running"; handle.core.resume(); }
    return ok;
  }
  function appendEngineEvent(match, event) {
    if (typeof TF.appendEvent === "function") TF.appendEvent(match, event); else match.events.push(event);
    return event;
  }
  function rotateEnds(match) {
    match.teams.forEach(function (team) {
      team.attackDirection *= -1;
      team.activePlayers.forEach(function (p) {
        p.position.x = match.pitch.length - p.position.x; p.previousPosition.x = p.position.x;
        p.velocity.x *= -1; p.facing.x *= -1;
      });
    });
  }
  function prepareKickoff(match, period, rotate) {
    if (rotate) rotateEnds(match);
    var original = match.state.rules && match.state.rules.firstKickoffTeamId;
    var home = match.teams[0].id, away = match.teams[1].id;
    var extraLength = match.clock.shortenedForTesting ? match.halfSeconds : 900;
    match.clock.period = period; match.clock.periodSeconds = 0; match.clock.periodLimitSeconds = period >= 3 ? extraLength : match.halfSeconds;
    match.clock.running = true; match.state.period = period; match.state.halfTime = false; match.state.finished = false;
    match.state.phase = "kickoff"; match.state.possessionTeamId = null; match.state.restartType = "kickoff";
    match.state.restartTeamId = period % 2 === 1 ? (original || home) : (original === home ? away : home);
    match.state.restartPoint = { x: match.pitch.length / 2, y: match.pitch.width / 2 }; match.state.restartStarted = null;
    match.ball.position.x = match.ball.previousPosition.x = match.pitch.length / 2;
    match.ball.position.y = match.ball.previousPosition.y = match.pitch.width / 2;
    match.ball.position.z = match.ball.previousPosition.z = 0.11;
    match.ball.velocity.x = match.ball.velocity.y = match.ball.velocity.z = 0; match.ball.ownerId = null;
  }
  function beginExtraTimePeriod(handle, period, rotate) {
    var m = handle.match;
    if (!m.state.knockoutState.extraTimeHalfSeconds) m.state.knockoutState.extraTimeHalfSeconds = m.clock.shortenedForTesting ? m.halfSeconds : 900;
    if (m.state.knockoutState.regulationHalfSeconds == null) m.state.knockoutState.regulationHalfSeconds = m.halfSeconds;
    m.halfSeconds = m.state.knockoutState.extraTimeHalfSeconds;
    prepareKickoff(m, period, rotate);
    m.state.knockoutState.phase = period === 3 ? "extra-time-first-half" : "extra-time-second-half";
    appendEngineEvent(m, { type: "extra-time-period", period: period, tick: m.tick, time: m.clock.elapsedSeconds });
    handle.status = "running";
  }
  function beginShootout(handle) {
    var m = handle.match;
    m.state.finished = false; m.state.halfTime = false; m.state.phase = "penalty-shootout";
    m.clock.running = false; m.clock.period = 5; m.state.period = 5; m.clock.periodSeconds = 0; m.clock.periodLimitSeconds = 0;
    m.state.knockoutState = { phase: "penalties", scores: { home: 0, away: 0 }, attempts: { home: 0, away: 0 }, history: [], activeAttempt: null, eligible: { home: [], away: [] }, nextSide: "home", reduced: { home: [], away: [] }, extraTimeHalfSeconds: m.clock.shortenedForTesting ? m.halfSeconds : 900 };
    var eligible = m.teams.map(function (t) { return t.activePlayers.filter(function (p) { return p.active && !p.sentOff; }); });
    if (eligible[0].length !== eligible[1].length) {
      var larger = eligible[0].length > eligible[1].length ? 0 : 1, smaller = 1 - larger;
      var removeCount = eligible[larger].length - eligible[smaller].length;
      var rankedForReduction = eligible[larger].filter(function (p) { return !p.isGoalkeeper; }).sort(function (a, b) { return penaltySkill(a) - penaltySkill(b) || a.id.localeCompare(b.id); });
      while (removeCount-- > 0 && rankedForReduction.length) {
        var removed = rankedForReduction.shift(); eligible[larger].splice(eligible[larger].indexOf(removed), 1); m.state.knockoutState.reduced[larger === 0 ? "home" : "away"].push(removed.sourceId);
      }
    }
    m.state.knockoutState.eligible.home = eligible[0].map(function (p) { return p.id; });
    m.state.knockoutState.eligible.away = eligible[1].map(function (p) { return p.id; });
    m.state.knockoutState.clockStoppedAt = m.clock.elapsedSeconds;
    appendEngineEvent(m, { type: "penalty-shootout-start", tick: m.tick, time: m.clock.elapsedSeconds, eligible: { home: eligible[0].length, away: eligible[1].length }, reduced: clone(m.state.knockoutState.reduced) });
    handle.status = "running";
  }
  function penaltySkill(player) { return Number(player.attributes.finishing || 50) + Number(player.attributes.shooting || 50) + Number(player.attributes.composure || 50); }
  function installShootoutScoreHook(handle) {
    var m = handle.match, regularScoreGoal = m.scoreGoal;
    m._regularScoreGoal = regularScoreGoal;
    m.scoreGoal = function (teamId, scorerId, assistId) {
      var shootout = this.state && this.state.knockoutState;
      if (!shootout || shootout.phase !== "penalties" || !shootout.activeAttempt) return regularScoreGoal.call(this, teamId, scorerId, assistId);
      var side = this.teams[0].id === teamId ? "home" : "away";
      shootout.scores[side] += 1;
      shootout.activeAttempt.goal = true;
      appendEngineEvent(this, { type: "penalty-goal", teamId: teamId, side: side, takerId: shootout.activeAttempt.takerId, tick: this.tick, time: this.clock.elapsedSeconds });
      return { type: "penalty-goal", teamId: teamId, scorerId: scorerId || null };
    };
  }
  function penaltyDone(match, shootout) {
    var h = shootout.attempts.home, a = shootout.attempts.away, sh = shootout.scores.home, sa = shootout.scores.away;
    if (h <= 5 && a <= 5 && (sh > sa + (5 - a) || sa > sh + (5 - h))) return true;
    if (h < 5 || a < 5 || h !== a) return false;
    if (h === a && sh !== sa) return true;
    return false;
  }
  function finishShootout(handle) {
    var m = handle.match, s = m.state.knockoutState, winnerSide = s.scores.home > s.scores.away ? "home" : "away";
    s.phase = "complete"; s.winnerSide = winnerSide; m.state.finished = true; m.state.halfTime = false; m.state.phase = "full-time";
    appendEngineEvent(m, { type: "penalty-shootout-winner", winnerTeamId: m.teams[winnerSide === "home" ? 0 : 1].id, score: clone(s.scores), tick: m.tick, time: m.clock.elapsedSeconds });
    handle.status = "completed";
  }
  function startPenaltyAttempt(handle) {
    var m = handle.match, s = m.state.knockoutState;
    if (penaltyDone(m, s)) { finishShootout(handle); return false; }
    var side = s.attempts.home <= s.attempts.away ? "home" : "away", ti = side === "home" ? 0 : 1, team = m.teams[ti], opponent = m.teams[1 - ti];
    var eligible = s.eligible[side].map(function (id) { return m.playersById[id]; }).filter(Boolean);
    if (!eligible.length) { s.phase = "error"; m.state.finished = true; m.state.phase = "abandoned"; handle.status = "error"; return false; }
    eligible.sort(function (a, b) { return penaltySkill(b) - penaltySkill(a) || a.number - b.number || a.id.localeCompare(b.id); });
    var taker = eligible[s.attempts[side] % eligible.length];
    var keeper = opponent.activePlayers.find(function (p) { return p.isGoalkeeper && p.active && !p.sentOff; }) || opponent.activePlayers.filter(function (p) { return p.active && !p.sentOff; }).sort(function (a, b) { return penaltySkill(a) - penaltySkill(b); })[0];
    if (!keeper) { s.phase = "error"; m.state.finished = true; handle.status = "error"; return false; }
    var dir = team.attackDirection, spot = { x: dir > 0 ? m.pitch.length - 11 : 11, y: m.pitch.width / 2 };
    m.players.forEach(function (p, i) {
      if (!p.active || p.sentOff || p === taker || p === keeper) return;
      var span = (i / Math.max(1, m.players.length - 1) - .5) * (m.pitch.width - 12);
      p.position.x = spot.x - dir * 10.2; p.position.y = m.pitch.width / 2 + span; p.previousPosition.x = p.position.x; p.previousPosition.y = p.position.y;
      p.velocity.x = p.velocity.y = p.velocity.z = 0;
    });
    taker.position.x = spot.x - dir * .25; taker.position.y = spot.y; taker.previousPosition.x = taker.position.x; taker.previousPosition.y = spot.y;
    // A shootout taker has time to set up at the mark before the referee's
    // signal. Start balanced and facing goal, but leave the eventual kick and
    // its execution to the normal turn/contact/strike physics.
    taker.velocity.x = taker.velocity.y = taker.velocity.z = 0;
    taker.facing.x = dir; taker.facing.y = 0;
    keeper.position.x = dir > 0 ? m.pitch.length - .03 : .03; keeper.position.y = spot.y; keeper.previousPosition.x = keeper.position.x; keeper.previousPosition.y = spot.y;
    m.ball.position.x = m.ball.previousPosition.x = spot.x; m.ball.position.y = m.ball.previousPosition.y = spot.y; m.ball.position.z = m.ball.previousPosition.z = .11;
    m.ball.velocity.x = m.ball.velocity.y = m.ball.velocity.z = 0; m.ball.ownerId = taker.id; m.ball.handControl = false; m.ball.controlState = "controlled";
    m.ball._lastControlTouchTick = m.tick; m.ball._lastControlTouch = m.clock.elapsedSeconds;
    m.state.restartInProgress = null; m.state.phase = "penalty-shootout"; m.state.possessionTeamId = team.id;
    var bystanderPositions = {};
    m.players.forEach(function (p, i) {
      if (!p.active || p.sentOff || p === taker || p === keeper) return;
      var span = (i / Math.max(1, m.players.length - 1) - .5) * (m.pitch.width - 12);
      bystanderPositions[p.id] = { x: spot.x - dir * 10.2, y: m.pitch.width / 2 + span };
    });
    m.state.knockoutState.activeAttempt = { side: side, teamId: team.id, takerId: taker.id, keeperId: keeper.id, startTick: m.tick, shot: false, goal: false, resolved: false, bystanderPositions: bystanderPositions, statsBefore: clone({ telemetry: m.telemetry, players: m.players.map(function (p) { return { id: p.id, stats: p.stats }; }) }) };
    var sideChoice = taker.rng.next() < .5 ? -1 : 1;
    var aim = { x: dir > 0 ? m.pitch.length + 2 : -2, y: spot.y + sideChoice * 2.05 };
    var kickPosition = { x: taker.position.x, y: taker.position.y };
    var intent = { type: "shoot", action: "shoot", target: kickPosition, ballTarget: aim, desiredSpeed: 0, power: Math.max(.55, Math.min(.96, .63 + Number(taker.attributes.shooting || 50) / 300)), lift: .08, createdTick: m.tick, commitUntilTick: m.tick + 90, committed: true };
    m.state.knockoutState.activeAttempt.intent = intent;
    appendEngineEvent(m, { type: "penalty-attempt", side: side, teamId: team.id, takerId: taker.id, keeperId: keeper.id, attempt: s.attempts[side] + 1, tick: m.tick, time: m.clock.elapsedSeconds });
    return true;
  }
  function restoreShootoutStats(match, attempt) {
    if (!attempt || !attempt.statsBefore) return;
    match.telemetry = clone(attempt.statsBefore.telemetry);
    attempt.statsBefore.players.forEach(function (saved) { var p = match.playersById[saved.id]; if (p) p.stats = clone(saved.stats); });
  }
  function resolvePenaltyAttempt(handle, outcome) {
    var m = handle.match, s = m.state.knockoutState, a = s.activeAttempt;
    if (!a || a.resolved) return;
    a.resolved = true; restoreShootoutStats(m, a); s.attempts[a.side] += 1;
    if (!a.goal) appendEngineEvent(m, { type: "penalty-missed", side: a.side, teamId: a.teamId, takerId: a.takerId, outcome: outcome, tick: m.tick, time: m.clock.elapsedSeconds });
    s.history.push({ side: a.side, teamId: a.teamId, takerId: a.takerId, goal: Boolean(a.goal), outcome: outcome, tick: m.tick });
    s.activeAttempt = null;
    if (penaltyDone(m, s)) finishShootout(handle);
  }
  function penaltyTick(handle) {
    var m = handle.match, s = m.state.knockoutState, dt = m.dt || TF.FIXED_DT || 1 / 60;
    if (!s.activeAttempt && !startPenaltyAttempt(handle)) return;
    var a = s.activeAttempt;
    if (!a) return;
    if (m.captureSnapshot) m.renderPrevious = m.renderCurrent || m.captureSnapshot();
    m.tick += 1;
    if (typeof TF.updateTactics === "function") TF.updateTactics(m, dt);
    if (typeof TF.updateAI === "function") TF.updateAI(m, dt);
    var taker = m.playersById[a.takerId];
    if (taker && m.ball.ownerId === taker.id && !a.shot) { taker.motor = clone(a.intent); taker.intent = taker.motor; taker.currentAction = taker.motor; }
    Object.keys(a.bystanderPositions || {}).forEach(function (id) { var p = m.playersById[id], pos = a.bystanderPositions[id]; if (p) { p.position.x = pos.x; p.position.y = pos.y; p.velocity.x = p.velocity.y = 0; } });
    // Let the ordinary rules boundary resolver see the physical penalty shot.
    // Keeping phase="penalty-shootout" suppresses processBoundaries(), so shots
    // that crossed the goal line were all being downgraded to a 90-tick miss.
    m.state.phase = "open-play";
    var eventStart = m.events.length;
    if (typeof TF.updateWorld === "function") TF.updateWorld(m, dt);
    var newEvents = m.events.slice(eventStart), shotEvent = newEvents.find(function (e) { return e.type === "shot" && e.playerId === a.takerId; });
    if (shotEvent) a.shot = true;
    if (m.captureSnapshot) m.renderCurrent = m.captureSnapshot();
    if (a.goal) { resolvePenaltyAttempt(handle, "goal"); return; }
    if (a.shot && m.ball.ownerId === a.takerId) {
      appendEngineEvent(m, { type: "penalty-double-touch", side: a.side, teamId: a.teamId, takerId: a.takerId, tick: m.tick, reason: "kicker-touched-ball-again-before-another-player" });
      resolvePenaltyAttempt(handle, "double-touch"); return;
    }
    if (a.shot && m.ball.ownerId && m.ball.ownerId !== a.takerId) { resolvePenaltyAttempt(handle, m.playersById[m.ball.ownerId] && m.playersById[m.ball.ownerId].isGoalkeeper ? "saved" : "rebound" ); return; }
    if (a.shot && m.state.phase === "dead-ball") { resolvePenaltyAttempt(handle, "out"); return; }
    if (a.shot && !m.ball.ownerId && Math.hypot(m.ball.velocity.x || 0, m.ball.velocity.y || 0) < 0.12) {
      resolvePenaltyAttempt(handle, "stopped"); return;
    }
    // A physical kick is not over just because it has flown for 1.5 seconds:
    // a weak shot or keeper parry can remain live longer and still cross the
    // line. Only the true football outcomes above resolve it. This long bound
    // is a numerical safeguard; preserve an error checkpoint rather than
    // inventing a miss if a malformed trajectory never settles.
    if (m.tick - a.startTick > 1800) {
      s.phase = "error"; handle.status = "error";
      appendEngineEvent(m, { type: "penalty-resolution-error", side: a.side, takerId: a.takerId, tick: m.tick, reason: "ball-did-not-resolve" });
      return;
    }
  }
  function afterFootballTick(handle) {
    if (!handle.knockout) return;
    var m = handle.match, ks = m.state.knockoutState;
    if (m.state.finished && m.clock.period === 2 && m.score.home === m.score.away && !ks) {
      m.state.finished = false; m.state.knockoutState = { phase: "extra-time-first-half", extraTimeHalfSeconds: m.clock.shortenedForTesting ? m.halfSeconds : 900 };
      beginExtraTimePeriod(handle, 3, false); return;
    }
    if (!ks) return;
    var etLimit = Number(m.clock.periodLimitSeconds) > 0 ? Number(m.clock.periodLimitSeconds) : ks.extraTimeHalfSeconds;
    if (m.clock.period === 3 && m.clock.periodSeconds + 1e-8 >= etLimit && !m.state.halfTime) {
      m.clock.periodSeconds = etLimit; m.clock.running = false; m.state.halfTime = true; m.state.phase = "half-time"; ks.phase = "extra-time-break";
      appendEngineEvent(m, { type: "extra-time-half-time", tick: m.tick, time: m.clock.elapsedSeconds }); return;
    }
    if (m.clock.period === 4 && m.clock.periodSeconds + 1e-8 >= etLimit && !m.state.finished) {
      m.clock.periodSeconds = etLimit; m.clock.running = false;
      if (m.score.home === m.score.away) beginShootout(handle);
      else { m.state.finished = true; m.state.phase = "full-time"; handle.status = "completed"; appendEngineEvent(m, { type: "full-time", tick: m.tick, time: m.clock.elapsedSeconds }); }
      return;
    }
  }
  function tickOne(handle) {
    var m = handle.match;
    if (handle.knockout && m.state.knockoutState && m.state.knockoutState.phase === "penalties") { penaltyTick(handle); return 1; }
    var core = handle.core, paused = core.isPaused();
    if (paused) core.resume();
    var before = m.tick;
    core.step(1);
    if (paused) core.pause();
    var advanced = m.tick - before;
    if (advanced) afterFootballTick(handle);
    return advanced;
  }
  function installAdvanceAdapter(handle) {
    var core = handle.core, accumulator = 0, dt = core.dt, maxFrame = 0.25, maxSteps = 15;
    core.advance = function (realSeconds) {
      var m = handle.match, inPenalties = m.state.knockoutState && m.state.knockoutState.phase === "penalties";
      if (core.isPaused() || !m || !m.clock.running && !inPenalties || (m.state.finished || m.state.halfTime) && !inPenalties) {
        accumulator = 0; return { match: m, steps: 0, alpha: 0, droppedSeconds: 0 };
      }
      var offered = Math.max(0, Number(realSeconds) || 0) * core.getSpeed();
      var accepted = Math.min(maxFrame, offered), dropped = Math.max(0, offered - accepted), steps = 0;
      accumulator += accepted;
      while (accumulator >= dt && steps < maxSteps) {
        var status = statusOf(handle), penalties = m.state.knockoutState && m.state.knockoutState.phase === "penalties";
        if (status !== "running" && !penalties) break;
        var advanced = tickOne(handle);
        if (!advanced) break;
        accumulator -= dt; steps += 1;
      }
      if (steps === maxSteps && accumulator >= dt) { dropped += accumulator - (accumulator % dt); accumulator %= dt; }
      handle.status = statusOf(handle);
      return { match: m, steps: steps, alpha: accumulator / dt, droppedSeconds: dropped / core.getSpeed() };
    };
  }
  function stepMatch(handle, ticks) {
    if (!handle || !handle.core || !handle.match) throw new TypeError("An engine match handle is required");
    var count = Math.max(0, Math.floor(Number(ticks) || 0)), stepped = 0;
    while (stepped < count) {
      if (handle.status === "cancelled" || handle.status === "error") break;
      if (handle.knockout && handle.match.state.knockoutState && handle.match.state.knockoutState.phase === "penalties") {
        penaltyTick(handle); stepped += 1; continue;
      }
      var status = statusOf(handle);
      if (status !== "running") {
        if (handle.knockout && status === "completed" && handle.match.clock.period === 2 && handle.match.score.home === handle.match.score.away && !handle.match.state.knockoutState) {
          afterFootballTick(handle);
          if (statusOf(handle) === "running") continue;
        }
        break;
      }
      var match = handle.match, beforeTick = match.tick, batch = count - stepped;
      if (!match.state.finished && !match.state.halfTime) match.clock.running = true;
      var periodLimit = Number(match.clock.periodLimitSeconds) || Number(match.halfSeconds) || 2700;
      if (match.clock.running && !match.state.halfTime && !match.state.finished) {
        var ticksToBoundary = Math.max(1, Math.ceil((periodLimit - match.clock.periodSeconds - 1e-9) / (match.dt || TF.FIXED_DT || 1 / 60)));
        batch = Math.min(batch, ticksToBoundary);
      }
      var paused = handle.core.isPaused(); if (paused) handle.core.resume();
      handle.core.step(batch);
      if (paused) handle.core.pause();
      var advanced = match.tick - beforeTick;
      if (advanced <= 0) break;
      stepped += advanced; afterFootballTick(handle);
    }
    handle.status = statusOf(handle);
    return { handle: handle, ticks: stepped, status: handle.status, snapshot: readSnapshot(handle) };
  }
  function readSnapshot(handle) {
    var m = handle && handle.match;
    if (!m) return null;
    return { matchId: m.id, tick: m.tick, period: m.clock.period, periodSeconds: m.clock.periodSeconds, elapsedSeconds: m.clock.elapsedSeconds,
      phase: m.state.phase, status: statusOf(handle), score: clone(m.score), ball: clone(m.ball.position),
      teams: m.teams.map(function (t) { return { id: t.sourceId || t.id, name: t.name, abbreviation: t.abbreviation || "", score: t.score, side: t.side }; }),
      players: m.players.map(function (p) { return { id: p.sourceId || p.id, teamId: p.sourceTeamId || p.teamId, position: clone(p.position), active: p.active, stamina: p.stamina }; }) };
  }
  function readEvents(handle, afterSequence) {
    var events = handle && handle.match && handle.match.events || [], cursor = Number(afterSequence) || 0;
    var result = events.filter(function (e) { return Number(e.sequence) > cursor; }).map(clone);
    return { events: result, nextSequence: result.reduce(function (n, e) { return Math.max(n, Number(e.sequence) || 0); }, cursor) };
  }
  function saveCheckpoint(handle) {
    if (!handle || !handle.match) throw new TypeError("An engine match handle is required");
    return { format: "tacticmesh-engine-checkpoint", schemaVersion: SCHEMA_VERSION, facadeVersion: FACADE_VERSION,
      engineBuild: handle.engineBuild, rulesVersion: rulesVersion(), simulationIdentity: checkpointIdentity(handle.config),
      config: clone(handle.config), status: handle.status, knockout: handle.knockout,
      core: TF.captureCheckpoint(handle.match) };
  }
  function restoreCheckpoint(checkpoint) {
    if (!checkpoint || checkpoint.format !== "tacticmesh-engine-checkpoint" || checkpoint.schemaVersion !== SCHEMA_VERSION) throw new TypeError("Unsupported engine checkpoint schema");
    if (checkpoint.engineBuild !== engineBuild()) throw new Error("Checkpoint engine build does not match this runtime");
    if (checkpoint.rulesVersion !== rulesVersion()) throw new Error("Checkpoint rules version does not match this runtime");
    if (checkpoint.simulationIdentity !== checkpointIdentity(checkpoint.config)) throw new Error("Checkpoint configuration identity is invalid");
    var handle = createMatch(checkpoint.config);
    TF.restoreCheckpoint(handle.match, checkpoint.core);
    applyRestoredKnockoutClock(handle);
    handle.status = checkpoint.status || statusOf(handle);
    handle.knockout = Boolean(checkpoint.knockout);
    handle.match.engineHandle = handle;
    return handle;
  }
  function restoreCheckpointInto(handle, checkpoint) {
    if (!handle || !handle.match || !handle.core) throw new TypeError("An existing engine match handle is required");
    if (!checkpoint || checkpoint.format !== "tacticmesh-engine-checkpoint" || checkpoint.schemaVersion !== SCHEMA_VERSION) throw new TypeError("Unsupported engine checkpoint schema");
    if (checkpoint.engineBuild !== engineBuild()) throw new Error("Checkpoint engine build does not match this runtime");
    if (!checkpoint.config || checkpoint.config.matchId !== handle.config.matchId || Number(checkpoint.config.seed) !== Number(handle.config.seed)) throw new Error("Checkpoint does not belong to this match handle");
    var expected = TF.productData && TF.productData.hash ? TF.productData.hash(simulationIdentity(handle.config)) : null;
    var supplied = TF.productData && TF.productData.hash ? TF.productData.hash(simulationIdentity(checkpoint.config)) : null;
    if (expected !== supplied) throw new Error("Checkpoint team simulation data does not match this handle");
    if (checkpoint.rulesVersion !== rulesVersion()) throw new Error("Checkpoint rules version does not match this runtime");
    if (checkpoint.simulationIdentity !== checkpointIdentity(checkpoint.config)) throw new Error("Checkpoint configuration identity is invalid");
    TF.restoreCheckpoint(handle.match, checkpoint.core);
    applyRestoredKnockoutClock(handle);
    handle.config = clone(checkpoint.config);
    handle.status = checkpoint.status || statusOf(handle);
    handle.knockout = Boolean(checkpoint.knockout);
    handle.match.teams.forEach(function (team, index) {
      var savedTeam = checkpoint.config[index === 0 ? "home" : "away"];
      team.name = savedTeam.name; team.abbreviation = savedTeam.abbreviation || ""; team.season = savedTeam.season || "";
      team.crest = savedTeam.crest || null; team.kits = clone(savedTeam.kits || {}); team.colors = clone(savedTeam.colors || (savedTeam.kits && savedTeam.kits.home) || team.colors);
      team.players.forEach(function (player) {
        var savedPlayer = savedTeam.players.find(function (p) { return p.id === player.sourceId; });
        if (savedPlayer) { player.name = savedPlayer.name; player.portrait = savedPlayer.portrait || null; player.appearance = clone(savedPlayer.appearance || {}); }
      });
    });
    handle.match.renderPrevious = null;
    handle.match.renderCurrent = handle.match.captureSnapshot ? handle.match.captureSnapshot() : null;
    handle.match.engineHandle = handle;
    installAdvanceAdapter(handle);
    return handle;
  }
  function applyRestoredKnockoutClock(handle) {
    var m = handle.match, ks = m.state.knockoutState;
    if (!ks || !Number.isFinite(Number(ks.extraTimeHalfSeconds))) return;
    if (m.clock.period >= 3 && m.clock.period <= 4) {
      m.halfSeconds = Number(ks.extraTimeHalfSeconds);
      if (m.clock.periodLimitSeconds > 0 && m.clock.periodLimitSeconds < m.halfSeconds) m.clock.periodLimitSeconds = m.halfSeconds;
    }
  }
  function getResult(handle) {
    if (!handle || !handle.match) return null;
    var m = handle.match, status = statusOf(handle);
    if (status !== "completed" && status !== "cancelled" && status !== "error") return { complete: false, status: status };
    if (status === "cancelled") return { complete: false, status: status, matchId: m.id, seed: m.seed, score: clone(m.score), checkpoint: saveCheckpoint(handle) };
    if (status === "error") return { complete: false, status: status, matchId: m.id, seed: m.seed, score: clone(m.score), checkpoint: saveCheckpoint(handle) };
    var shootout = m.state.knockoutState && m.state.knockoutState.phase === "complete" ? m.state.knockoutState : null;
    var winnerId = shootout ? m.teams[shootout.winnerSide === "home" ? 0 : 1].sourceId : m.score.home === m.score.away ? null : (m.score.home > m.score.away ? m.teams[0].sourceId : m.teams[1].sourceId);
    return { complete: true, status: status, matchId: m.id, seed: m.seed, score: clone(m.score),
      winnerId: winnerId, method: shootout ? "penalties" : null, penaltyScore: shootout ? clone(shootout.scores) : null,
      teamIds: m.teams.map(function (t) { return t.sourceId; }), events: m.events.length, simulationHash: handle.simulationHash, engineBuild: handle.engineBuild };
  }
  function cancelRun(handle) {
    if (!handle) return false;
    if (handle._run) handle._run.cancelled = true;
    handle.status = "cancelled";
    if (handle.core) handle.core.pause();
    return true;
  }
  function finishSimulation(handle, options) {
    options = options || {};
    if (!handle || !handle.match) return Promise.reject(new TypeError("An engine match handle is required"));
    var run = { cancelled: false }; handle._run = run;
    var chunk = Math.max(1, Math.min(600, Math.floor(Number(options.chunkTicks) || 120)));
    return new Promise(function (resolve) {
      function pump() {
        if (run.cancelled || options.signal && options.signal.aborted) { handle.status = "cancelled"; handle.core.pause(); resolve({ status: "cancelled", result: getResult(handle), snapshot: readSnapshot(handle) }); return; }
        if (!handle.match.state.finished && !handle.match.state.halfTime) handle.match.clock.running = true;
        var result = stepMatch(handle, chunk);
        if (typeof options.onProgress === "function") options.onProgress(result.snapshot);
        if (result.status === "completed") { resolve({ status: result.status, result: getResult(handle), snapshot: result.snapshot }); return; }
        if (result.status === "cancelled" || result.status === "error") { resolve({ status: result.status, result: getResult(handle), snapshot: result.snapshot }); return; }
        if (result.status === "half-time") continueAfterHalfTime(handle);
        setTimeout(pump, 0);
      }
      pump();
    });
  }
  function getCapabilities() {
    return { facadeVersion: FACADE_VERSION, engineBuild: engineBuild(), coreBuild: TF.CORE_BUILD || engineBuild(), rulesVersion: rulesVersion(), fixedHz: Math.round(1 / (TF.FIXED_DT || 1 / 60)), formations: Object.keys(TF.FORMATIONS || {}),
      rosterMin: 11, rosterMax: 30, attributes: attributeNames().slice(), modes: ["single-match", "knockout"], checkpointSchemaVersion: SCHEMA_VERSION,
      supportsDraws: true, supportsKnockoutTieResolution: true };
  }
  TF.engine = { version: FACADE_VERSION, getCapabilities: getCapabilities, validateMatchConfig: validateMatchConfig, createMatch: createMatch,
    stepMatch: stepMatch, continueAfterHalfTime: continueAfterHalfTime, readSnapshot: readSnapshot, readEvents: readEvents,
    saveCheckpoint: saveCheckpoint, restoreCheckpoint: restoreCheckpoint, restoreCheckpointInto: restoreCheckpointInto,
    getResult: getResult, cancelRun: cancelRun, finishSimulation: finishSimulation };
})(typeof window !== "undefined" ? window : globalThis);
