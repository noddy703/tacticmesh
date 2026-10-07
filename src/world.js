(function (root) {
  "use strict";

  var TF = root.TF = root.TF || {};
  TF.createEventCursor = TF.createEventCursor || function () {
    var index = 0, highWater = 0, lastConsumed = null;
    return {
      reset: function () { index = 0; highWater = 0; lastConsumed = null; },
      skipToEnd: function (events) {
        events = Array.isArray(events) ? events : [];
        index = events.length; highWater = 0; lastConsumed = events.length ? events[events.length - 1] : null;
        events.forEach(function (event) { var sequence = Number(event && event.sequence); if (Number.isFinite(sequence)) highWater = Math.max(highWater, sequence); });
      },
      read: function (events) {
        events = Array.isArray(events) ? events : [];
        // Detect compaction even when new events were appended before this read
        // and the replacement window is still longer than our old offset.
        if (index > events.length || (index > 0 && lastConsumed && events[index - 1] !== lastConsumed &&
            Number(events[index - 1] && events[index - 1].sequence) !== Number(lastConsumed.sequence))) index = 0;
        var result = [];
        for (var i = index; i < events.length; i++) {
          var event = events[i], sequence = Number(event && event.sequence);
          if (Number.isFinite(sequence)) {
            if (sequence <= highWater) continue;
            highWater = sequence;
          }
          result.push(event);
        }
        index = events.length;
        lastConsumed = events.length ? events[events.length - 1] : null;
        return result;
      },
      get sequence() { return highWater; },
      get index() { return index; }
    };
  };
  TF.appendEvent = function (match, event) {
    if (!match || !event) return event;
    var clock = match.clock || {}, period = Number(event.period || clock.period) || 1;
    if (!Number.isFinite(Number(event.periodSeconds))) event.periodSeconds = Number(clock.periodSeconds) || 0;
    if (!Number.isFinite(Number(event.period))) event.period = period;
    var tick = Number.isFinite(Number(event.tick)) ? Number(event.tick) : Number(match.tick) || 0;
    var count = match._eventTick === tick ? (Number(match._eventTickCount) || 0) : 0;
    if (match._eventTick !== tick && Array.isArray(match.events) && match.events.length) {
      var lastEvent = match.events[match.events.length - 1];
      if (lastEvent && Number(lastEvent.tick) === tick && Number.isFinite(Number(lastEvent.sequence))) count = Math.max(count, Number(lastEvent.sequence) - tick * 1024);
    }
    count = Math.floor(count) + 1;
    match._eventTick = tick; match._eventTickCount = count;
    event.sequence = tick * 1024 + count;
    match.events.push(event);
    return event;
  };
  TF.formatMatchMinute = function (period, periodSeconds) {
    var minutes = Math.floor(Math.max(0, Number(periodSeconds) || 0) / 60);
    if (Number(period) === 2) return minutes > 45 ? "90+" + (minutes - 45) : String(45 + minutes);
    return minutes > 45 ? "45+" + (minutes - 45) : String(minutes);
  };
  var PITCH = { length: 105, width: 68, goalWidth: 7.32, goalHeight: 2.44, penaltyAreaDepth: 16.5 };
  var FORMATIONS = {
    "4-3-3": [
      ["GK", "GK", 5, 34], ["RB", "DEF", 24, 58], ["RCB", "DEF", 20, 45], ["LCB", "DEF", 20, 23], ["LB", "DEF", 24, 10],
      ["DM", "MID", 38, 34], ["RCM", "MID", 48, 47], ["LCM", "MID", 48, 21],
      ["RW", "FWD", 70, 58], ["ST", "FWD", 76, 34], ["LW", "FWD", 70, 10]
    ],
    "4-2-3-1": [
      ["GK", "GK", 5, 34], ["RB", "DEF", 24, 58], ["RCB", "DEF", 20, 45], ["LCB", "DEF", 20, 23], ["LB", "DEF", 24, 10],
      ["DM", "MID", 36, 43], ["DM", "MID", 38, 25], ["RW", "MID", 56, 57], ["AM", "MID", 59, 34], ["LW", "MID", 56, 11],
      ["ST", "FWD", 77, 34]
    ],
    "4-4-2": [
      ["GK", "GK", 5, 34], ["RB", "DEF", 24, 58], ["RCB", "DEF", 20, 45], ["LCB", "DEF", 20, 23], ["LB", "DEF", 24, 10],
      ["RM", "MID", 45, 58], ["RCM", "MID", 42, 43], ["LCM", "MID", 42, 25], ["LM", "MID", 45, 10],
      ["ST", "FWD", 74, 43], ["ST", "FWD", 74, 25]
    ],
    "3-4-2-1": [
      ["GK", "GK", 5, 34], ["RCB", "DEF", 20, 48], ["CB", "DEF", 18, 34], ["LCB", "DEF", 20, 20],
      ["RWB", "MID", 42, 59], ["RCM", "MID", 39, 43], ["LCM", "MID", 39, 25], ["LWB", "MID", 42, 9],
      ["RAM", "MID", 59, 44], ["LAM", "MID", 59, 24], ["ST", "FWD", 77, 34]
    ],
    "3-5-2": [
      ["GK", "GK", 5, 34], ["RCB", "DEF", 20, 48], ["CB", "DEF", 18, 34], ["LCB", "DEF", 20, 20],
      ["RWB", "MID", 42, 60], ["RCM", "MID", 40, 46], ["CM", "MID", 38, 34], ["LCM", "MID", 40, 22], ["LWB", "MID", 42, 8],
      ["ST", "FWD", 74, 43], ["ST", "FWD", 74, 25]
    ]
  };
  var FIRST_NAMES = ["Alex", "Amari", "Ben", "Cameron", "Diego", "Eli", "Ethan", "Felix", "Gabriel", "Hugo", "Isaac", "Jamal", "Jonas", "Kai", "Leo", "Luis", "Mateo", "Micah", "Noah", "Omar", "Rafael", "Sam", "Theo", "Yusuf"];
  var LAST_NAMES = ["Adams", "Baptiste", "Costa", "Diallo", "Edwards", "Fraser", "Grant", "James", "King", "Lewis", "Mendes", "Morgan", "Nolan", "Pereira", "Reid", "Silva", "Thomas", "Walker", "Young", "Carter", "Joseph", "Williams", "Campbell", "Clarke"];
  var ATTRIBUTE_NAMES = [
    "acceleration", "sprintSpeed", "agility", "turning", "balance", "strength", "stamina", "jumping", "reach", "recoverySpeed",
    "firstTouch", "shortPassing", "longPassing", "throughBalls", "crossing", "shooting", "finishing", "heading", "dribbling", "ballCarrying", "tackling", "interception", "weakFoot",
    "awareness", "vision", "anticipation", "decisionMaking", "composure", "positioning", "teamwork", "creativity", "concentration", "discipline", "aggression", "workRate", "offBallIntelligence",
    "handling", "reflexes", "catching", "parrying", "diving", "oneOnOne", "aerialCommand", "sweeping", "throwing", "kicking"
  ];
  var ROLE_DEFAULTS = {
    GK: { family: "GK", preferred: { handling: 72, reflexes: 74, catching: 70, diving: 73, kicking: 63, positioning: 74, awareness: 73, anticipation: 72, composure: 70, strength: 65, reach: 72, stamina: 70 } },
    DEF: { preferred: { strength: 72, heading: 69, tackling: 72, interception: 72, positioning: 73, discipline: 72, anticipation: 70, awareness: 68, shortPassing: 62, longPassing: 58, stamina: 72 } },
    MID: { preferred: { shortPassing: 72, firstTouch: 70, vision: 70, teamwork: 71, positioning: 70, awareness: 71, stamina: 76, workRate: 75, anticipation: 68, tackling: 60 } },
    FWD: { preferred: { acceleration: 75, sprintSpeed: 75, dribbling: 72, offBallIntelligence: 72, finishing: 72, shooting: 70, composure: 68, anticipation: 70, stamina: 72 } }
  };
  var ROLE_NAMES = {
    GK: "Goalkeeper", RB: "Fullback", LB: "Fullback", RCB: "Centre-back", LCB: "Centre-back", CB: "Centre-back",
    DM: "Holding midfielder", RDM: "Holding midfielder", LDM: "Holding midfielder", RCM: "Central midfielder", LCM: "Central midfielder", CM: "Central midfielder",
    AM: "Attacking midfielder", RAM: "Attacking midfielder", LAM: "Attacking midfielder", RM: "Wide midfielder", LM: "Wide midfielder",
    RWB: "Wing-back", LWB: "Wing-back", RW: "Winger", LW: "Winger", ST: "Striker"
  };

  function rng(seed) {
    if (typeof TF.RNG !== "function") throw new Error("Load src/core.js before src/world.js; seeded TF.RNG is required.");
    return new TF.RNG(seed);
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function gaussian(random) {
    var u = Math.max(1e-9, random.next());
    var v = Math.max(1e-9, random.next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function option(config, teamKey, key, fallback) {
    var team = config[teamKey] || {};
    return team[key] != null ? team[key] : config[teamKey + key.charAt(0).toUpperCase() + key.slice(1)] != null ? config[teamKey + key.charAt(0).toUpperCase() + key.slice(1)] : fallback;
  }
  function makeAttributes(random, family, role) {
    var defaults = ROLE_DEFAULTS[family] || ROLE_DEFAULTS.MID;
    var result = {};
    var physicalLatent = gaussian(random) * 7;
    var technicalLatent = gaussian(random) * 7;
    var mentalLatent = gaussian(random) * 7;
    var goalkeeperLatent = gaussian(random) * 7;
    var groups = {
      acceleration: "physical", sprintSpeed: "physical", agility: "physical", turning: "physical", balance: "physical", strength: "physical", stamina: "physical", jumping: "physical", reach: "physical", recoverySpeed: "physical",
      firstTouch: "technical", shortPassing: "technical", longPassing: "technical", throughBalls: "technical", crossing: "technical", shooting: "technical", finishing: "technical", heading: "technical", dribbling: "technical", ballCarrying: "technical", tackling: "technical", interception: "technical", weakFoot: "technical",
      awareness: "mental", vision: "mental", anticipation: "mental", decisionMaking: "mental", composure: "mental", positioning: "mental", teamwork: "mental", creativity: "mental", concentration: "mental", discipline: "mental", aggression: "mental", workRate: "mental", offBallIntelligence: "mental",
      handling: "goalkeeper", reflexes: "goalkeeper", catching: "goalkeeper", parrying: "goalkeeper", diving: "goalkeeper", oneOnOne: "goalkeeper", aerialCommand: "goalkeeper", sweeping: "goalkeeper", throwing: "goalkeeper", kicking: "goalkeeper"
    };
    var latent = { physical: physicalLatent, technical: technicalLatent, mental: mentalLatent, goalkeeper: goalkeeperLatent };
    ATTRIBUTE_NAMES.forEach(function (key) {
      var base = (defaults.preferred[key] != null ? defaults.preferred[key] : family === "GK" && key.indexOf("handling") === 0 ? 64 : 57);
      // One shared player profile per skill family creates correlated attributes;
      // the independent residual keeps unusual players possible.
      var personal = gaussian(random) * 9;
      result[key] = Math.round(clamp(base + latent[groups[key]] * 0.42 + personal, 20, 99));
    });
    if (family !== "GK") ["handling", "reflexes", "catching", "parrying", "diving", "oneOnOne", "aerialCommand", "sweeping", "throwing", "kicking"].forEach(function (key) { result[key] = Math.round(clamp(18 + gaussian(random) * 4, 10, 35)); });
    if (role === "ST") result.finishing = Math.round(clamp(result.finishing + 7, 20, 99));
    return result;
  }
  function makeTraits(random) {
    var keys = ["riskAppetite", "directness", "patience", "selfishness", "roaming", "pressingEnthusiasm", "receiveToFeet", "attackSpace", "earlyCrossing", "dribbleTendency", "longShotTendency", "conservativePassing", "switchPlay", "weakFootUse"];
    var result = {};
    keys.forEach(function (key) { result[key] = Number(random.range(0.2, 0.8).toFixed(3)); });
    return result;
  }
  function slotFamily(family) { return family === "GK" ? "GK" : family; }
  function createPlayer(random, team, index, family, roleCode, formationSlot, isActive) {
    var playerId = team.id + "-p" + String(index + 1).padStart(2, "0");
    var playerRandom = random.fork(playerId);
    var role = roleCode || (family === "GK" ? "GK" : family);
    var height = family === "GK" ? playerRandom.range(1.82, 1.98) : family === "DEF" ? playerRandom.range(1.73, 1.94) : family === "FWD" ? playerRandom.range(1.66, 1.91) : playerRandom.range(1.66, 1.90);
    var player = {
      id: playerId,
      teamId: team.id,
      team: team,
      number: index + 1,
      name: playerRandom.pick(FIRST_NAMES) + " " + playerRandom.pick(LAST_NAMES),
      age: playerRandom.int(17, 35),
      height: Number(height.toFixed(2)),
      weight: Math.round(66 + (height - 1.7) * 45 + playerRandom.range(-7, 8)),
      preferredFoot: playerRandom.next() < 0.72 ? "right" : "left",
      preferredRole: ROLE_NAMES[role] || ROLE_NAMES[family] || "Utility player",
      positionFamily: slotFamily(family),
      role: role,
      formationSlot: formationSlot || null,
      isGoalkeeper: family === "GK",
      active: Boolean(isActive),
      position: { x: 0, y: 0, z: 0 },
      previousPosition: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      facing: { x: team.attackDirection, y: 0 },
      stamina: 1,
      attributes: makeAttributes(playerRandom, family, role),
      traits: makeTraits(playerRandom),
      beliefState: null,
      intent: null,
      action: null,
      rng: playerRandom.fork("decisions"),
      stats: { minutes: 0, goals: 0, assists: 0, passes: 0, shots: 0, tackles: 0 }
    };
    return player;
  }
  function composeTactics(value) {
    var defaults = { width: 0.62, attackingWidth: 0.72, defensiveWidth: 0.56, defensiveLine: 0.58, pressingIntensity: 0.52, engagementLine: 0.55, compactness: 0.62, tempo: 0.52, buildupRisk: 0.45, passingDirectness: 0.42, counterattack: 0.5, counterpress: 0.5, crossingFrequency: 0.4, overlapPreference: 0.48, centralOverload: 0.5, goalkeeperDistribution: "mixed", markingBias: "zonal", timeManagement: 0.35 };
    Object.keys(value || {}).forEach(function (key) { defaults[key] = value[key]; });
    return defaults;
  }
  var DEFAULT_TACTIC_PROFILES = {
    home: { tempo: 0.46, buildupRisk: 0.42, passingDirectness: 0.34, counterattack: 0.42, counterpress: 0.48, pressingIntensity: 0.48, defensiveLine: 0.56, compactness: 0.62, goalkeeperDistribution: "short" },
    away: { tempo: 0.60, buildupRisk: 0.56, passingDirectness: 0.63, counterattack: 0.66, counterpress: 0.55, pressingIntensity: 0.57, defensiveLine: 0.61, compactness: 0.58, goalkeeperDistribution: "mixed" }
  };
  function makeTeam(config, side, seed) {
    var prefix = side === "home" ? "home" : "away";
    var id = option(config, prefix, "id", prefix);
    var configuredTactics = option(config, prefix, "tactics", null);
    var team = {
      id: String(id),
      name: option(config, prefix, "name", side === "home" ? "Redbridge FC" : "Ashford Athletic"),
      side: side,
      attackDirection: side === "home" ? 1 : -1,
      formation: option(config, prefix, "formation", "4-3-3"),
      tactics: composeTactics(configuredTactics == null ? DEFAULT_TACTIC_PROFILES[side] : configuredTactics),
      players: [], activePlayers: [], bench: [],
      colors: option(config, prefix, "colors", side === "home" ? { primary: "#cf3d48", secondary: "#f5f0df" } : { primary: "#315aa6", secondary: "#f3cf50" }),
      score: 0
    };
    if (!FORMATIONS[team.formation]) team.formation = "4-3-3";
    var random = rng(seed).fork(team.id);
    var slots = FORMATIONS[team.formation];
    var squadSize = clamp(Math.floor(option(config, prefix, "squadSize", random.int(18, 20))), 18, 20);
    var slotCounts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    slots.forEach(function (slot) { slotCounts[slot[1]] += 1; });
    var rosterPlan = [];
    slots.forEach(function (slot) { rosterPlan.push({ family: slot[1], role: slot[0], slot: { x: slot[2], y: slot[3] }, active: true }); });
    var benchPlan = ["GK", "DEF", "DEF", "MID", "MID", "FWD", "FWD", "MID", "DEF"];
    while (rosterPlan.length < squadSize) {
      var family = benchPlan[(rosterPlan.length - 11) % benchPlan.length];
      rosterPlan.push({ family: family, role: family, slot: null, active: false });
    }
    rosterPlan.forEach(function (spec, index) {
      var player = createPlayer(random, team, index, spec.family, spec.role, spec.slot, spec.active);
      team.players.push(player);
      if (spec.active) team.activePlayers.push(player); else team.bench.push(player);
    });
    team.players.forEach(function (player) {
      if (!player.formationSlot) {
        var sideNoise = player.rng.range(-5, 5);
        player.formationSlot = { x: player.isGoalkeeper ? 5 : 28 + player.rng.range(-8, 42), y: 34 + sideNoise, role: player.role };
      }
      var localX = player.formationSlot.x;
      player.position.x = team.attackDirection > 0 ? localX : PITCH.length - localX;
      player.position.y = player.formationSlot.y;
      player.previousPosition.x = player.position.x;
      player.previousPosition.y = player.position.y;
      player.facing.x = team.attackDirection;
    });
    return team;
  }

  function copyVec(position) { return { x: position.x, y: position.y, z: position.z || 0 }; }
  function advanceClock(match, dt) {
    var clock = match.clock;
    if (!clock.running || match.state.finished) return;
    clock.periodSeconds += dt;
    clock.elapsedSeconds += dt;
    var limit = Number(clock.periodLimitSeconds) > 0 ? Number(clock.periodLimitSeconds) : match.halfSeconds;
    if (clock.periodSeconds >= limit && clock.period === 1) {
      clock.periodSeconds = limit;
      clock.running = false;
      match.state.halfTime = true;
      match.state.phase = "half-time";
      TF.appendEvent(match, { type: "half-time", tick: match.tick, time: clock.elapsedSeconds });
    }
    if (clock.periodSeconds >= limit && clock.period === 2) {
      clock.periodSeconds = limit;
      clock.running = false;
      match.state.finished = true;
      match.state.phase = "full-time";
      TF.appendEvent(match, { type: "full-time", tick: match.tick, time: clock.elapsedSeconds });
    }
  }

  function minimalPhysicsStep(match, dt) {
    if (match.state.finished || match.state.halfTime) return;
    match.players.forEach(function (player) {
      if (!player.active) return;
      var intent = player.motor || player.intent || player.currentAction || player.action;
      var target = intent && (intent.target || intent.movementTarget);
      if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) {
        var dx = target.x - player.position.x;
        var dy = target.y - player.position.y;
        var distance = Math.sqrt(dx * dx + dy * dy) || 1;
        var pace = player.attributes.sprintSpeed * 0.055 * Math.max(0.45, player.stamina);
        var desiredSpeed = Math.min(pace, intent.desiredSpeed == null ? pace * 0.7 : intent.desiredSpeed);
        var desiredX = dx / distance * desiredSpeed;
        var desiredY = dy / distance * desiredSpeed;
        var change = Math.min(1, (player.attributes.acceleration / 99) * dt * 4);
        player.velocity.x += (desiredX - player.velocity.x) * change;
        player.velocity.y += (desiredY - player.velocity.y) * change;
      } else {
        player.velocity.x *= Math.max(0, 1 - 2.2 * dt);
        player.velocity.y *= Math.max(0, 1 - 2.2 * dt);
      }
      player.previousPosition.x = player.position.x;
      player.previousPosition.y = player.position.y;
      player.position.x = clamp(player.position.x + player.velocity.x * dt, 0.5, PITCH.length - 0.5);
      player.position.y = clamp(player.position.y + player.velocity.y * dt, 0.5, PITCH.width - 0.5);
      if (Math.abs(player.velocity.x) + Math.abs(player.velocity.y) > 0.01) {
        var length = Math.sqrt(player.velocity.x * player.velocity.x + player.velocity.y * player.velocity.y) || 1;
        player.facing.x = player.velocity.x / length;
        player.facing.y = player.velocity.y / length;
      }
      player.stamina = clamp(player.stamina - (Math.abs(player.velocity.x) + Math.abs(player.velocity.y)) * dt * 0.0005, 0, 1);
    });
    var ball = match.ball;
    // Minimal contact/action handling keeps development builds playable until the
    // full physics system replaces this fallback.
    match.players.forEach(function (player) {
      var intent = player.motor || player.intent || player.currentAction || player.action;
      if (!player.active || !intent || intent.executed) return;
      var type = String(intent.action || intent.type || "").toLowerCase();
      if (["pass", "throughball", "through-ball", "shoot", "clear"].indexOf(type) < 0) return;
      if (ball.ownerId !== player.id && player.hasBall !== true) return;
      var target = intent.ballTarget || intent.target;
      if (!target) return;
      var dx = target.x - ball.position.x;
      var dy = target.y - ball.position.y;
      var length = Math.sqrt(dx * dx + dy * dy) || 1;
      var power = clamp(Number(intent.power == null ? 0.6 : intent.power), 0.1, 1);
      var speed = (type === "shoot" || type === "clear" ? 21 : 10 + power * 12);
      ball.velocity.x = dx / length * speed;
      ball.velocity.y = dy / length * speed;
      ball.velocity.z = clamp(Number(intent.lift || 0), 0, 1) * 8;
      ball.ownerId = null;
      ball.lastTouchPlayerId = player.id;
      ball.lastTouchTeamId = player.teamId;
      intent.executed = true;
      if (type === "shoot") match.telemetry.shots += 1;
      else match.telemetry.passes += 1;
    });
    var owner = ball.ownerId && match.playersById[ball.ownerId];
    if (owner && owner.active) {
      ball.position.x = owner.position.x + owner.facing.x * 0.75;
      ball.position.y = clamp(owner.position.y + owner.facing.y * 0.75, 0, PITCH.width);
      ball.position.z = 0.11;
      ball.velocity.x = owner.velocity.x;
      ball.velocity.y = owner.velocity.y;
    } else {
      ball.position.x += ball.velocity.x * dt;
      ball.position.y += ball.velocity.y * dt;
      ball.position.z = Math.max(0, ball.position.z + ball.velocity.z * dt);
      ball.velocity.x *= Math.max(0, 1 - 0.3 * dt);
      ball.velocity.y *= Math.max(0, 1 - 0.3 * dt);
      ball.velocity.z -= 9.81 * dt;
      if (ball.position.z < 0.04) { ball.position.z = 0.04; ball.velocity.z = 0; }
      if (ball.position.x < 0 || ball.position.x > PITCH.length) {
        if (ball.position.y >= (PITCH.width - PITCH.goalWidth) / 2 && ball.position.y <= (PITCH.width + PITCH.goalWidth) / 2 && ball.position.z <= PITCH.goalHeight) {
          var scorerTeam = ball.velocity.x > 0 ? match.teams.find(function (team) { return team.attackDirection > 0; }) : match.teams.find(function (team) { return team.attackDirection < 0; });
          if (scorerTeam) {
            match.scoreGoal(scorerTeam.id, ball.lastTouchPlayerId);
            ball.position.x = PITCH.length / 2; ball.position.y = PITCH.width / 2; ball.position.z = 0.11;
          }
        } else ball.velocity.x *= -0.45;
      }
      if (ball.position.y < 0 || ball.position.y > PITCH.width) ball.velocity.y *= -0.45;
      ball.position.x = clamp(ball.position.x, 0, PITCH.length);
      ball.position.y = clamp(ball.position.y, 0, PITCH.width);
    }
  }

  function updateWorld(match, dt) {
    if (typeof TF.updatePhysics === "function") TF.updatePhysics(match, dt);
    else minimalPhysicsStep(match, dt);
    if (typeof TF.updateRules === "function") TF.updateRules(match, dt);
    advanceClock(match, dt);
    if (typeof TF.updateTelemetry === "function") TF.updateTelemetry(match, dt);
  }

  function createMatch(config) {
    config = config || {};
    var seed = config.seed == null ? 1 : config.seed;
    var home = makeTeam(config, "home", seed);
    var away = makeTeam(config, "away", seed);
    var teams = [home, away];
    var players = home.players.concat(away.players);
    var playersById = {};
    players.forEach(function (player) { playersById[player.id] = player; });
    var ball = {
      id: "ball-1", position: { x: PITCH.length / 2, y: PITCH.width / 2, z: 0.11 },
      previousPosition: { x: PITCH.length / 2, y: PITCH.width / 2, z: 0.11 },
      velocity: { x: 0, y: 0, z: 0 }, spin: 0,
      lastTouchPlayerId: null, lastTouchTeamId: null, ownerId: null
    };
    var match = {
      id: String(config.matchId || "match-" + String(seed)),
      seed: seed, rng: rng(seed).fork("match"), tick: 0, dt: TF.FIXED_DT || 1 / 60,
      world: { pitch: Object.assign({}, PITCH), teams: teams, players: players, playersById: playersById, ball: ball },
      pitch: Object.assign({}, PITCH), teams: teams, players: players, playersById: playersById, ball: ball,
      referee: { id: "referee-1", position: { x: PITCH.length / 2, y: PITCH.width / 2, z: 0 }, velocity: { x: 0, y: 0 }, active: true },
      state: { period: 1, phase: "kickoff", finished: false, halfTime: false, possessionTeamId: null, restartType: "kickoff", restartTeamId: home.id, rules: {} },
      halfSeconds: Number(config.halfSeconds) > 0 ? Number(config.halfSeconds) : 2700,
      clock: { elapsedSeconds: 0, periodSeconds: 0, period: 1, periodLimitSeconds: Number(config.halfSeconds) > 0 ? Number(config.halfSeconds) : 2700, running: config.autoStart !== false, shortenedForTesting: Number(config.halfSeconds) > 0 && Number(config.halfSeconds) !== 2700 },
      events: [], telemetry: { goals: [], passes: 0, shots: 0, turnovers: 0 },
      score: { home: 0, away: 0 }, renderPrevious: null, renderCurrent: null,
      startSecondHalf: function () {
        if (!this.state.halfTime) return false;
        this.teams.forEach(function (team) {
          team.attackDirection *= -1;
          team.activePlayers.forEach(function (player) {
            player.position.x = PITCH.length - player.position.x;
            player.previousPosition.x = player.position.x;
            player.velocity.x *= -1;
            player.facing.x *= -1;
          });
        });
        this.ball.position.x = PITCH.length / 2;
        this.ball.position.y = PITCH.width / 2;
        this.ball.position.z = 0.11;
        this.ball.velocity.x = this.ball.velocity.y = this.ball.velocity.z = 0;
        this.ball.ownerId = null;
        this.clock.period = 2;
        this.clock.periodSeconds = 0;
        this.clock.periodLimitSeconds = this.halfSeconds;
        this.clock.running = true;
        this.state.period = 2;
        this.state.halfTime = false;
        this.state.phase = "kickoff";
        TF.appendEvent(this, { type: "second-half", tick: this.tick, time: this.clock.elapsedSeconds });
        return true;
      }
    };
    match.world.match = match;
    match.teams.forEach(function (team) { team.match = match; });
    match.captureSnapshot = function () {
      var snapshot = { players: {}, ball: copyVec(this.ball.position) };
      this.players.forEach(function (player) { snapshot.players[player.id] = copyVec(player.position); });
      return snapshot;
    };
    match.start = function () { this.clock.running = true; this.state.phase = "open-play"; };
    match.pause = function () { this.clock.running = false; };
    match.scoreGoal = function (teamId, scorerId, assistId) {
      var team = this.teams.find(function (item) { return item.id === teamId; });
      if (!team || this.state.finished) return false;
      var scorer = scorerId && this.playersById[scorerId];
      if (!scorer || scorer.teamId !== teamId) scorerId = null;
      var assist = assistId && this.playersById[assistId];
      if (!scorerId || !assist || assist.teamId !== teamId || assist.id === scorerId) assistId = null;
      team.score += 1;
      if (team === home) this.score.home += 1; else this.score.away += 1;
      scorer = scorerId && this.playersById[scorerId];
      assist = assistId && this.playersById[assistId];
      if (scorer) scorer.stats.goals += 1;
      if (assist) assist.stats.assists += 1;
      var event = { type: "goal", teamId: teamId, scorerId: scorerId || null, assistId: assistId || null,
        attackType: this.ball._lastShotType || (this.ball.lastTouchKind === "deliberate" ? "direct-play" : "loose-ball"),
        shotPlayerId: this.ball._lastShotId || null,
        goalPosition: { x: this.ball.position.x, y: this.ball.position.y, z: this.ball.position.z },
        tick: this.tick, time: this.clock.elapsedSeconds };
      TF.appendEvent(this, event);
      this.telemetry.goals.push(event);
      this.ball._passAssistCandidate = null;
      this.ball._assistPlayerId = null;
      this.state.restartType = "kickoff";
      this.state.restartTeamId = team === home ? away.id : home.id;
      this.state.phase = "dead-ball";
      this.state.possessionTeamId = null;
      this.ball.ownerId = null;
      this.ball.velocity.x = this.ball.velocity.y = this.ball.velocity.z = 0;
      return event;
    };
    match.teams.forEach(function (team) {
      team.activePlayers.forEach(function (player) { player.team = team; });
      team.bench.forEach(function (player) { player.team = team; });
    });
    return match;
  }

  TF.PITCH = PITCH;
  TF.FORMATIONS = FORMATIONS;
  TF.createMatch = createMatch;
  TF.updateWorld = updateWorld;
  TF.updatePhysics = TF.updatePhysics || minimalPhysicsStep;
  TF.defaultWorldStep = minimalPhysicsStep;
})(typeof window !== "undefined" ? window : globalThis);
