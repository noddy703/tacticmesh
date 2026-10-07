(function (root) {
  "use strict";
  var TF = root.TF = root.TF || {};
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var hypot = function (x, y) { return Math.sqrt(x * x + y * y); };
  var attr = function (p, key, fallback) { var n = Number(p && p.attributes && p.attributes[key]); return Number.isFinite(n) ? clamp(n, 0, 99) : fallback; };
  var norm = function (x, y) { var l = hypot(x, y) || 1; return { x: x / l, y: y / l }; };
  function restartFootApproach(match, player, intent, restart) {
    if (!restart || !player || restart.takerId !== player.id || restart.teamId !== player.teamId
      || ["kickoff", "goal-kick", "corner", "direct-free-kick", "indirect-free-kick", "penalty"].indexOf(restart.type) < 0) return null;
    var type = String(intent && (intent.type || intent.action) || "").toLowerCase();
    if (restart.type === "penalty" ? type !== "shoot"
      : ["pass", "throughball", "through-ball", "cross", "cutback", "switch", "shoot", "clear"].indexOf(type) < 0) return null;
    var target = intent.ballTarget || intent.target;
    if (!target || !restart.point || !Number.isFinite(Number(target.x)) || !Number.isFinite(Number(target.y))
      || !Number.isFinite(Number(restart.point.x)) || !Number.isFinite(Number(restart.point.y))) return null;
    var dx = Number(target.x) - Number(restart.point.x), dy = Number(target.y) - Number(restart.point.y), length = hypot(dx, dy);
    var direction = length > 0.05 ? { x: dx / length, y: dy / length }
      : norm(player.facing && player.facing.x || 1, player.facing && player.facing.y || 0);
    var field = pitch(match);
    return {
      direction: direction,
      stance: { x: clamp(Number(restart.point.x) - direction.x * 0.55, -0.6, field.length + 0.6),
        y: clamp(Number(restart.point.y) - direction.y * 0.55, -0.6, field.width + 0.6) }
    };
  }
  var nearbyOpponents = [];
  function localPressure(m, player, radius) {
    if (TF.analysis && typeof TF.analysis.pressureAtPlayer === "function") return TF.analysis.pressureAtPlayer(m, player, radius);
    var sum = 0;
    m.players.forEach(function (opponent) { if (opponent.active && opponent.teamId !== player.teamId) { var gap = hypot(opponent.position.x - player.position.x, opponent.position.y - player.position.y); if (gap < radius) sum += (radius - gap) / radius; } });
    return sum;
  }
  function sweptDistance(player, ball) {
    var previous = player.previousPosition || player.position;
    var sx = Number(ball.previousPosition.x) - Number(previous.x), sy = Number(ball.previousPosition.y) - Number(previous.y);
    var ex = Number(ball.position.x) - Number(player.position.x), ey = Number(ball.position.y) - Number(player.position.y);
    var dx = ex - sx, dy = ey - sy, length2 = dx * dx + dy * dy;
    var t = length2 > 1e-8 ? clamp(-(sx * dx + sy * dy) / length2, 0, 1) : 0;
    return hypot(sx + dx * t, sy + dy * t);
  }
  function sweptPlayerDistance(one, two) {
    return sweptPlayerContact(one, two).distance;
  }
  function sweptPlayerContact(one, two) {
    var a0 = one.previousPosition || one.position, b0 = two.previousPosition || two.position;
    var sx = Number(a0.x) - Number(b0.x), sy = Number(a0.y) - Number(b0.y);
    var ex = Number(one.position.x) - Number(two.position.x), ey = Number(one.position.y) - Number(two.position.y);
    var dx = ex - sx, dy = ey - sy, length2 = dx * dx + dy * dy;
    var t = length2 > 1e-8 ? clamp(-(sx * dx + sy * dy) / length2, 0, 1) : 0;
    var rx = sx + dx * t, ry = sy + dy * t;
    return { distance: hypot(rx, ry), towardVictim: { x: -rx, y: -ry }, time: t };
  }
  var pitch = function (m) { return m.pitch || (m.world && m.world.pitch) || { length: 105, width: 68, goalWidth: 7.32, goalHeight: 2.44 }; };
  var teamById = function (m, id) { return (m.teams || []).find(function (t) { return t.id === id; }); };
  var event = function (m, type, data) { var e = Object.assign({ type: type, tick: m.tick, time: m.clock && m.clock.elapsedSeconds || 0 }, data || {}); if (typeof TF.appendEvent === "function") TF.appendEvent(m, e); else m.events.push(e); if (Object.freeze) Object.freeze(e); return e; };
  var keeperFootActions = ["pass", "throughBall", "clear", "shoot"];
  function keeperRestrictionForStrike(m, player, action, targetId, isRestartThrow, releasedFromHands) {
    if (player.isGoalkeeper && releasedFromHands && action !== "header") {
      return { teamId: player.teamId, keeperId: player.id, sourcePlayerId: player.id, action: action, targetId: targetId || null };
    }
    if (isRestartThrow) {
      return { teamId: player.teamId, keeperId: null, sourcePlayerId: player.id, action: "throw-in", targetId: targetId || null };
    }
    var recipient = targetId != null && m.playersById && m.playersById[targetId];
    if (keeperFootActions.indexOf(action) >= 0 && recipient && recipient.isGoalkeeper && recipient.teamId === player.teamId) {
      return { teamId: player.teamId, keeperId: recipient.id, sourcePlayerId: player.id, action: action, targetId: recipient.id };
    }
    return null;
  }
  var addTouch = function (m, p, kind) {
    var b = m.ball;
    var assistCandidate = b._passAssistCandidate;
    var handlingRestriction = b._keeperHandlingRestriction;
    if (handlingRestriction && p) {
      var keeperTouch = handlingRestriction.keeperId != null
        ? p.id === handlingRestriction.keeperId
        : !!p.isGoalkeeper && p.teamId === handlingRestriction.teamId;
      if (!keeperTouch) b._keeperHandlingRestriction = null;
    }
    var restartSecondTouch = m.state && m.state.restartSecondTouch;
    var restartRelease = m.state && m.state.restartReleaseThisTick;
    if (restartRelease && !restartRelease.awaitingFieldEntry && m.tick >= restartRelease.kickTick && p) {
      if (p.id === restartRelease.takerId) {
        restartRelease.secondTouchTick = m.tick;
        restartRelease.secondTouchKind = kind || "play";
        if (restartSecondTouch) { restartSecondTouch.secondTouchTick = m.tick; restartSecondTouch.secondTouchKind = kind || "play"; }
      } else {
        // Any intervening player's actual contact ends the restart taker's
        // one-touch restriction, including later in the release tick.
        restartRelease.interveningTouch = true;
        m.state.restartSecondTouch = null;
      }
    } else if (restartSecondTouch && m.tick >= restartSecondTouch.kickTick && p) {
      if (p.id === restartSecondTouch.takerId) {
        restartSecondTouch.secondTouchTick = m.tick;
        restartSecondTouch.secondTouchKind = kind || "play";
      } else {
        m.state.restartSecondTouch = null;
      }
    }
    if (b._keeperRecoveryPlayerId && (!p || p.id !== b._keeperRecoveryPlayerId)) {
      b._keeperRecoveryPlayerId = null; b._keeperRecoveryUntilTick = 0;
    }
    if (b._kickFollowThroughPlayerId && (!p || p.id !== b._kickFollowThroughPlayerId)) {
      b._kickFollowThroughPlayerId = null; b._kickFollowThroughUntil = 0;
    }
    b.lastTouchPlayerId = p ? p.id : null; b.lastTouchTeamId = p ? p.teamId : null;
    b.lastTouchKind = kind || "play"; b.lastTouchTick = m.tick; b._lastTouchTime = m.clock && m.clock.elapsedSeconds || 0;
    // Action and intended-recipient provenance lasts only until another
    // physical touch. A fresh strike sets it again immediately below.
    b.lastTouchAction = null; b.lastTouchTargetId = null; b.lastTouchTarget = null;
    if (assistCandidate && p) {
      var controlled = kind === "control" || kind === "carry" || kind === "deliberate"
        || (kind === "save" && b.ownerId === p.id && b.handControl);
      if (controlled) {
        if (p.teamId !== assistCandidate.teamId) b._passAssistCandidate = null;
        else if (p.id === assistCandidate.targetId && p.id !== assistCandidate.passerId) {
          assistCandidate.receivedById = p.id;
          assistCandidate.receivedTick = m.tick;
        } else if (!(kind === "carry" && assistCandidate.receivedById === p.id)) {
          b._passAssistCandidate = null;
        }
      }
    }
    // Shot attribution follows an uninterrupted live shot through parries and
    // deflections. A deliberate new play or actual control ends that shot;
    // caught keeper handling is control even though its event kind is "save".
    var controlledTouch = kind === "control" || kind === "deliberate" || kind === "carry"
      || (kind === "save" && p && b.ownerId === p.id && b.handControl);
    if (controlledTouch) { b._lastShotId = null; b._lastShotType = null; }
    if (controlledTouch && kind !== "deliberate") b._assistPlayerId = null;
    if (p) { b.previousTouchPlayerId = p.id; b.previousTouchTeamId = p.teamId; }
    if (m.state) m.state.possessionTeamId = p ? p.teamId : null;
  };
  function emitKickSnapshot(m, player, intent, kind) {
    var b = m.ball, side = player.team && player.team.attackDirection || (player.teamId === (m.teams[0] && m.teams[0].id) ? 1 : -1);
    var opponents = m.players.filter(function (p) { return p.active && p.teamId !== player.teamId; }).sort(function (a, c) { return (c.position.x - a.position.x) * side; });
    var line = opponents.length > 1 ? opponents[1].position.x : (side > 0 ? pitch(m).length : 0);
    b.offsideSnapshot = m.players.filter(function (p) { return p.active && p.teamId === player.teamId && p.id !== player.id; }).map(function (p) {
      return { playerId: p.id, teamId: p.teamId, x: p.position.x, y: p.position.y, offside: side > 0 ? p.position.x > pitch(m).length / 2 && p.position.x > line + 0.08 && p.position.x > b.position.x + 0.08 : p.position.x < pitch(m).length / 2 && p.position.x < line - 0.08 && p.position.x < b.position.x - 0.08 };
    });
    b.offsideKick = { tick: m.tick, kickerId: player.id, teamId: player.teamId, kind: kind, line: line, ballX: b.position.x, exempt: !!b._offsideExemptNextTouch, candidates: b.offsideSnapshot };
    b._offsideExemptNextTouch = false;
    b._lastRestartTouchType = b._lastRestartType || null; b._lastRestartType = null;
    var pendingRestart = m.state && m.state.restartInProgress;
    var validRestartRelease = pendingRestart && pendingRestart.takerId === player.id
      && b._lastRestartTouchType === pendingRestart.type
      && (pendingRestart.type === "throw-in" ? kind === "throw" : pendingRestart.type === "penalty" ? kind === "shoot" : ["pass", "throughBall", "shoot", "clear"].indexOf(kind) >= 0);
    if (validRestartRelease && pendingRestart.type === "throw-in") {
      m.state.restartReleaseThisTick = { type: pendingRestart.type, teamId: pendingRestart.teamId, takerId: pendingRestart.takerId,
        point: { x: pendingRestart.point.x, y: pendingRestart.point.y }, kickTick: m.tick, secondTouchTick: null, secondTouchKind: null,
        interveningTouch: false, awaitingFieldEntry: true };
    }
    event(m, "ball-played", { playerId: player.id, teamId: player.teamId, kind: kind, targetId: intent.targetId || intent.details && intent.details.targetId || null, origin: { x: player.position.x, y: player.position.y }, contactPoint: { x: b.position.x, y: b.position.y, z: b.position.z }, offside: b.offsideKick });
    if (validRestartRelease && pendingRestart.type !== "throw-in") {
      if (typeof TF.confirmRestartPhysicalRelease === "function") TF.confirmRestartPhysicalRelease(m, player.id, kind, true);
    }
  }
  function strike(m, p, i, type) {
    var b = m.ball, target = i.ballTarget || i.target;
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return false;
    var pendingAtStrike = m.state && m.state.restartInProgress;
    var isRestartThrow = type === "throw" && pendingAtStrike && pendingAtStrike.type === "throw-in"
      && pendingAtStrike.takerId === p.id && pendingAtStrike.teamId === p.teamId;
    var dx = target.x - b.position.x, dy = target.y - b.position.y, d = hypot(dx, dy) || 1, dir = norm(dx, dy);
    var pressure = localPressure(m, p, 5);
    var rng = p.rng && p.rng.next ? p.rng : null;
    var requestedAction = String(i.action || i.type || "").toLowerCase();
    var skill = type === "throw" || requestedAction === "throw" ? "throwing" : p.isGoalkeeper ? "kicking" : type === "shoot" ? "shooting" : type === "header" ? "heading" : type === "throughBall" ? "throughBalls" : "shortPassing";
    var face = p.facing || { x: 1, y: 0 }, faceDot = clamp(face.x * dir.x + face.y * dir.y, -1, 1);
    var orientation = Math.atan2(face.x * dir.y - face.y * dir.x, faceDot);
    var bodyBalance = clamp(Number(p.balance == null ? 0.9 : p.balance), 0.15, 1), stride = hypot(p.velocity && p.velocity.x || 0, p.velocity && p.velocity.y || 0);
    var stability = clamp((0.78 + bodyBalance * 0.22) * (1 - clamp(stride / 10, 0, 0.55) * 0.22), 0.55, 1);
    var precision = (attr(p, skill, 58) / 100) * (0.95 - pressure * 0.075) * Math.max(0.55, Number(p.stamina) || 1) * stability;
    // Poor balance while still turning leaves a small, directional contact error.
    var bodyBias = clamp(-orientation * (0.08 + (1 - bodyBalance) * 0.32), -0.24, 0.24);
    var error = bodyBias + (1 - precision) * (rng ? (rng.next() - 0.5) : 0) * 0.42;
    var c = Math.cos(error), s = Math.sin(error), vx = (dir.x * c - dir.y * s), vy = (dir.x * s + dir.y * c);
    var requestedPower = clamp(Number(i.power == null ? (type === "shoot" ? 0.83 : 0.62) : i.power), 0.1, 1);
    var powerError = (rng ? rng.next() - 0.5 : 0) * (0.035 + (1 - precision) * 0.17 + Math.min(0.12, pressure * 0.02));
    var power = clamp(requestedPower + powerError, 0.1, 1);
    var speed = type === "shoot" ? 13 + power * 24 : type === "clear" ? 19 + power * 12 : type === "throw" ? 7 + power * 9 : 5.5 + power * 12.5;
    var assistCandidate = b._passAssistCandidate;
    var validAssist = (type === "shoot" || type === "header") && assistCandidate
      && (assistCandidate.receivedById === p.id || (type === "header" && assistCandidate.targetId === p.id))
      && assistCandidate.passerId !== p.id && assistCandidate.teamId === p.teamId
      && m.tick >= assistCandidate.kickTick;
    b.velocity.x = vx * speed; b.velocity.y = vy * speed;
    var requestedLift = clamp(Number(i.lift || 0), 0, 1);
    var angleError = (rng ? rng.next() - 0.5 : 0) * (0.025 + (1 - precision) * 0.2 + Math.min(0.14, pressure * 0.03));
    var executedLift = clamp(requestedLift + angleError, 0, 1);
    b.velocity.z = executedLift * (type === "shoot" ? 7.5 : 8.5);
    b.spin = (Number(i.spin) || 0) + error;
    b.ownerId = null; b.controlState = "flight"; b.handControl = false;
    // The kicker alone is protected by the follow-through exclusion below.
    // A global cooldown here would make every other player immune to a swept
    // interception during the first 0.1s of the ball flight.
    b._touchCooldown = 0;
    b._kickFollowThroughPlayerId = p.id; b._kickFollowThroughUntil = m.tick + 24;
    p.visualMotion = { type: isRestartThrow ? "throw-in" : type === "throughBall" ? "pass" : type,
      action: isRestartThrow ? "throw-in" : type, tick: m.tick, target: { x: target.x, y: target.y } };
    addTouch(m, p, "deliberate");
    b.lastTouchAction = isRestartThrow ? "throw-in" : type;
    b.lastTouchTargetId = i.targetId || i.details && i.details.targetId || null;
    b.lastTouchTarget = { x: target.x, y: target.y };
    var priorHandlingRestriction = b._keeperHandlingRestriction;
    var nextHandlingRestriction = keeperRestrictionForStrike(m, p, type, b.lastTouchTargetId, isRestartThrow, !!b._keeperReleasedFromHandsThisTick);
    // A keeper's own foot play does not end a hand-release restriction. It
    // remains until another player actually touches the ball; likewise, a
    // foot-controlled teammate backpass/direct throw-in stays restricted
    // after the keeper chooses a legal foot response.
    if (!nextHandlingRestriction && priorHandlingRestriction && priorHandlingRestriction.teamId === p.teamId
      && (priorHandlingRestriction.keeperId === p.id || (priorHandlingRestriction.keeperId == null && p.isGoalkeeper))) {
      nextHandlingRestriction = priorHandlingRestriction;
    }
    b._keeperHandlingRestriction = nextHandlingRestriction;
    b._keeperReleasedFromHandsThisTick = false;
    emitKickSnapshot(m, p, i, type);
    p.stats = p.stats || {}; if (type === "shoot") { p.stats.shots = (p.stats.shots || 0) + 1; m.telemetry.shots = (m.telemetry.shots || 0) + 1; }
    else if (type !== "throw" || !isRestartThrow) { p.stats.passes = (p.stats.passes || 0) + 1; m.telemetry.passes = (m.telemetry.passes || 0) + 1; }
    if (type === "shoot") { b._lastShotId = p.id; b._lastShotType = "shot"; b._assistPlayerId = validAssist ? assistCandidate.passerId : null; b._passAssistCandidate = null; }
    else if (type === "header") {
      // A physical one-touch header can finish a targeted pass. If the header
      // is itself addressed to a teammate, retain a fresh receipt candidate
      // for that next player while the current passer assist remains provisional
      // until actual control supersedes it.
      b._lastShotId = null; b._lastShotType = null;
      b._assistPlayerId = validAssist ? assistCandidate.passerId : null;
      b._passAssistCandidate = null;
      var headerTargetId = i.targetId || i.details && i.details.targetId || null;
      var headerRecipient = headerTargetId != null && m.playersById && m.playersById[headerTargetId];
      if (headerRecipient && headerRecipient.teamId === p.teamId && headerRecipient.id !== p.id) {
        b._passAssistCandidate = { passerId: p.id, teamId: p.teamId, targetId: headerRecipient.id,
          kickTick: m.tick, receivedById: null, receivedTick: null };
      }
    } else {
      b._lastShotId = null; b._lastShotType = null; b._assistPlayerId = null;
      b._passAssistCandidate = null;
      var intendedId = i.targetId || i.details && i.details.targetId || null;
      var intended = intendedId != null && m.playersById && m.playersById[intendedId];
      if ((type === "pass" || type === "throughBall") && intended && intended.teamId === p.teamId && intended.id !== p.id) {
        b._passAssistCandidate = { passerId: p.id, teamId: p.teamId, targetId: intended.id, kickTick: m.tick, receivedById: null, receivedTick: null };
      }
    }
    event(m, type === "shoot" ? "shot" : type === "header" ? "header" : isRestartThrow ? "throw-in" : "pass", { playerId: p.id, teamId: p.teamId, targetId: i.targetId || i.details && i.details.targetId || null, origin: { x: p.position.x, y: p.position.y }, target: { x: target.x, y: target.y }, power: power, requestedPower: requestedPower, powerError: powerError, lift: b.velocity.z, executedLift: executedLift, requestedLift: requestedLift, angleError: angleError, precision: precision, executionSkill: skill,
      estimatedArrivalTime: Number(i.details && i.details.arrivalTime) || null, kickSpeed: speed });
    return true;
  }
  function movePlayers(m, dt) {
    var ps = m.players, field = pitch(m);
    for (var j = 0; j < ps.length; j++) {
      var p = ps[j]; if (!p.active) continue;
      var i = p.motor || p.intent || p.currentAction || p.action || {}, target = i.target || i.movementTarget;
      var pendingRestart = m.state && m.state.restartInProgress;
      var restartApproach = restartFootApproach(m, p, i, pendingRestart);
      var restartApproachTarget = restartApproach && restartApproach.stance;
      if (restartApproachTarget) target = restartApproachTarget;
      var x = p.position.x, y = p.position.y, v = p.velocity, a = p.attributes || {};
      p.previousPosition.x = x; p.previousPosition.y = y; p.previousPosition.z = p.position.z || 0;
      var intentType = String(i.type || i.action || "").toLowerCase();
      var diveState = p.isGoalkeeper ? p._keeperDiveState : null;
      if (diveState && m.tick > diveState.recoveryUntilTick) { p._keeperDiveState = diveState = null; }
      if (p.isGoalkeeper && intentType === "save" && target && Number.isFinite(target.y)
        && !diveState && m.tick >= (p._keeperDiveRecoveryUntilTick || 0)) {
        var diveTargetY = clamp(target.y, 0.8, field.width - 0.8), lateralGap = diveTargetY - y;
        if (Math.abs(lateralGap) >= 0.3) {
          var lateralDirection = lateralGap < 0 ? -1 : 1;
          diveState = p._keeperDiveState = { startTick: m.tick, diveUntilTick: m.tick + 17, recoveryUntilTick: m.tick + 35,
            target: { x: clamp(target.x, -0.25, field.length + 0.25), y: diveTargetY }, directionY: lateralDirection };
          p._keeperDiveRecoveryUntilTick = diveState.recoveryUntilTick;
          var launchSpeed = (0.65 + attr(p, "diving", 55) * 0.014) * clamp(Number(p.stamina == null ? 1 : p.stamina), 0.18, 1);
          v.y = clamp(v.y + lateralDirection * launchSpeed, -7.2, 7.2);
          p.visualMotion = { type: "dive", tick: m.tick, target: { x: diveState.target.x, y: diveState.target.y } };
        }
      }
      // A dive commits to one observed intercept point through its landing and
      // recovery window. New save candidates cannot reverse the goalkeeper's
      // body mid-flight or immediately launch another dive.
      if (diveState && m.tick <= diveState.recoveryUntilTick) target = diveState.target;
      var speedAttr = attr(p, "sprintSpeed", 72), fatigue = clamp(Number(p.stamina == null ? 1 : p.stamina), 0.18, 1);
      var maxSpeed = 4.1 + speedAttr * 0.052; // roughly 9 m/s at elite sprint
      maxSpeed *= 0.72 + 0.28 * fatigue;
      var desiredX = 0, desiredY = 0, desired = 0;
      if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) {
        var dx = target.x - x, dy = target.y - y, d = hypot(dx, dy);
        if (d > 0.08) { var want = clamp(Number(restartApproachTarget ? 0.62 : i.desiredSpeed == null ? 0.68 : i.desiredSpeed), 0, 1); desired = Math.min(maxSpeed * want, Math.sqrt(Math.max(0, 2 * (1.3 + attr(p, "acceleration", 65) / 40) * d))); desiredX = dx / d * desired; desiredY = dy / d * desired; }
      }
      var facing = p.facing || (p.facing = { x: 1, y: 0 }), face = norm(facing.x || 0, facing.y || 0);
      var kickTarget = i && (i.ballTarget || i.target), kickType = String(i && (i.action || i.type) || "").toLowerCase();
      var turningToKick = m.ball.ownerId === p.id && kickTarget && ["pass", "throughball", "through-ball", "shoot", "clear", "throw"].indexOf(kickType) >= 0;
      // A perception-guided focal point can differ from the locomotion target
      // (for example, a keeper shuffling across goal while tracking the ball).
      // Keep the turn bounded; lateral movement still pays the ordinary
      // facing/strafe acceleration cost below.
      var faceTarget = i && i.facingTarget && Number.isFinite(i.facingTarget.x) && Number.isFinite(i.facingTarget.y) ? i.facingTarget : null;
      var desiredDir = faceTarget ? norm(faceTarget.x - x, faceTarget.y - y)
        : desired > 0.02 ? norm(desiredX, desiredY)
          : turningToKick && restartApproach ? restartApproach.direction
            : turningToKick ? norm(kickTarget.x - x, kickTarget.y - y) : face;
      var dot = clamp(face.x * desiredDir.x + face.y * desiredDir.y, -1, 1), angle = Math.acos(dot);
      var turnRate = 1.1 + attr(p, "turning", 60) / 100 * 3.2;
      var turnFraction = clamp(turnRate * dt / Math.max(angle, 0.05), 0, 1);
      var cross = face.x * desiredDir.y - face.y * desiredDir.x;
      var ang = Math.min(angle, turnRate * dt) * (cross < 0 ? -1 : 1), ca = Math.cos(ang), sa = Math.sin(ang);
      face = { x: face.x * ca - face.y * sa, y: face.x * sa + face.y * ca };
      facing.x = face.x; facing.y = face.y;
      var acceleration = (1.15 + attr(p, "acceleration", 65) / 27) * fatigue;
      var forwardDemand = Math.max(0, face.x * desiredX + face.y * desiredY);
      var vxWish = face.x * forwardDemand + (desiredX - face.x * forwardDemand) * clamp(0.35 + attr(p, "agility", 60) / 160, 0.35, 0.95);
      var vyWish = face.y * forwardDemand + (desiredY - face.y * forwardDemand) * clamp(0.35 + attr(p, "agility", 60) / 160, 0.35, 0.95);
      var dvx = vxWish - v.x, dvy = vyWish - v.y, dv = hypot(dvx, dvy), maxDv = acceleration * dt;
      if (dv > maxDv) { dvx *= maxDv / dv; dvy *= maxDv / dv; }
      v.x += dvx; v.y += dvy;
      if (diveState && m.tick <= diveState.diveUntilTick) {
        var remainingLateral = diveState.target.y - y;
        var diveAccel = (5.5 + attr(p, "diving", 55) * 0.055 + attr(p, "agility", 60) * 0.018) * fatigue;
        var diveMaxSpeed = 3.2 + attr(p, "diving", 55) * 0.023 + attr(p, "agility", 60) * 0.012;
        var desiredLateral = remainingLateral === 0 ? 0 : Math.sign(remainingLateral) * Math.min(diveMaxSpeed, Math.sqrt(2 * diveAccel * Math.abs(remainingLateral)));
        v.y += clamp(desiredLateral - v.y, -diveAccel * dt, diveAccel * dt);
      }
      if (desired < 0.03) { v.x *= Math.max(0, 1 - 3.4 * dt); v.y *= Math.max(0, 1 - 3.4 * dt); }
      var stride = hypot(v.x, v.y); if (stride > maxSpeed) { v.x *= maxSpeed / stride; v.y *= maxSpeed / stride; }
      p.position.x = clamp(x + v.x * dt, -0.6, field.length + 0.6); p.position.y = clamp(y + v.y * dt, -0.6, field.width + 0.6);
      if (stride > 0.3 && !faceTarget) { var f = norm(v.x, v.y), blend = clamp(turnRate * dt * 0.42, 0, 1); facing.x += (f.x - facing.x) * blend; facing.y += (f.y - facing.y) * blend; }
      var sprinting = desired > maxSpeed * 0.72;
      p.stamina = clamp(fatigue - dt * (sprinting ? 0.00022 : stride > 1 ? 0.000065 : -0.000025) * (0.75 + attr(p, "workRate", 60) / 200), 0.15, 1);
      p.balance = p.balance == null ? 0.9 : clamp(p.balance + dt * 0.025, 0, 1);
    }
    // Soft pairwise body separation. The impulse is small and weighted by balance/strength.
    for (var aIdx = 0; aIdx < ps.length; aIdx++) {
      var one = ps[aIdx]; if (!one.active) continue;
      for (var bIdx = aIdx + 1; bIdx < ps.length; bIdx++) {
        var two = ps[bIdx]; if (!two.active) continue;
        var ox = two.position.x - one.position.x, oy = two.position.y - one.position.y, od = hypot(ox, oy);
        if (od >= 0.66) continue;
        var nn = od < 1e-4 ? { x: (aIdx + bIdx) % 2 ? 1 : 0, y: (aIdx + bIdx) % 2 ? 0 : 1 } : { x: ox / od, y: oy / od };
        var force = (0.66 - od) * 0.26, m1 = 1 + attr(one, "strength", 55) / 100, m2 = 1 + attr(two, "strength", 55) / 100;
        var tot = m1 + m2; one.position.x -= nn.x * force * m2 / tot; one.position.y -= nn.y * force * m2 / tot; two.position.x += nn.x * force * m1 / tot; two.position.y += nn.y * force * m1 / tot;
        var closing = (one.velocity.x - two.velocity.x) * nn.x + (one.velocity.y - two.velocity.y) * nn.y;
        if (closing > 0) { one.velocity.x -= nn.x * closing * 0.16; one.velocity.y -= nn.y * closing * 0.16; two.velocity.x += nn.x * closing * 0.16; two.velocity.y += nn.y * closing * 0.16; }
        one.balance = clamp(one.balance - force * 0.08, 0.15, 1); two.balance = clamp(two.balance - force * 0.08, 0.15, 1);
      }
    }
  }
  function actionPass(m) {
    var b = m.ball, ps = m.players, pendingAtStart = m.state && m.state.restartInProgress;
    if (pendingAtStart) ps = ps.slice().sort(function (a, c) { return (c.id === pendingAtStart.takerId ? 1 : 0) - (a.id === pendingAtStart.takerId ? 1 : 0); });
    for (var k = 0; k < ps.length; k++) {
      var p = ps[k], i = p.motor || p.intent || p.currentAction || p.action;
      if (!p.active || !i || i._physicsDone || (i.expiresTick != null && i.expiresTick < m.tick)) continue;
      var type = String(i.action || i.type || "").toLowerCase();
      if (["pass", "throughball", "through-ball", "shoot", "clear", "throw", "header", "tackle", "slide", "standingtackle", "catch", "dive", "keeperchallenge"].indexOf(type) < 0) continue;
      var pendingRestart = m.state && m.state.restartInProgress;
      var restartRelease = m.state && m.state.restartReleaseThisTick;
      var takerHasReleased = pendingRestart && restartRelease && !restartRelease.awaitingFieldEntry
        && restartRelease.takerId === pendingRestart.takerId && restartRelease.type === pendingRestart.type;
      if (pendingRestart && pendingRestart.takerId !== p.id && !takerHasReleased) {
        // The ball is still dead until the designated player makes the legal
        // restart action. Stale intents from other players cannot release it.
        i._physicsDone = true;
        continue;
      }
      if (pendingRestart && pendingRestart.takerId === p.id) {
        var legalRestartAction = pendingRestart.type === "throw-in" ? type === "throw"
          : pendingRestart.type === "penalty" ? type === "shoot"
            : ["pass", "throughball", "through-ball", "shoot", "clear"].indexOf(type) >= 0;
        if (!legalRestartAction) { i._physicsDone = true; continue; }
      }
      if (["tackle", "slide", "standingtackle"].indexOf(type) >= 0 && m.tick < (p._challengeRecoveryUntilTick || 0)) continue;
      var dist = hypot(p.position.x - b.position.x, p.position.y - b.position.y);
      var carrier = b.ownerId === p.id;
      if (type === "throw") {
        var throwRestart = m.state && m.state.restartInProgress;
        var touchline = throwRestart && throwRestart.point && throwRestart.point.y;
        var target = i.ballTarget || i.target;
        var fieldward = throwRestart && (touchline === 0 ? Number(target && target.y) > 0 : Number(target && target.y) < pitch(m).width);
        var legalThrow = throwRestart && throwRestart.type === "throw-in" && throwRestart.takerId === p.id
          && carrier && b.handControl && target && Number.isFinite(Number(target.x)) && Number.isFinite(Number(target.y))
          && target.x >= 0 && target.x <= pitch(m).length && fieldward;
        i._physicsDone = true;
        if (legalThrow) {
          // Release from the touchline at an overhead hand height. The normal
          // ball flight must then carry it fully into the field before rules
          // declare the throw taken.
          b.handControl = false; b.position.x = b.previousPosition.x = throwRestart.point.x;
          b.position.y = b.previousPosition.y = touchline; b.position.z = b.previousPosition.z = 1.85;
          strike(m, p, i, "throw");
        }
        continue;
      }
      if (type === "keeperchallenge") {
        // A keeper can physically challenge an opponent's foot-controlled
        // ball, but the AI intent alone never awards possession. Recheck the
        // live contact geometry and handling law at the point of contact.
        if (!p.isGoalkeeper || !p.active || carrier || !b.ownerId || b.handControl || b.position.z > 0.32
          || m.tick < (p._challengeRecoveryUntilTick || 0)) { i._physicsDone = true; continue; }
        var opponentCarrier = m.playersById[b.ownerId];
        if (!opponentCarrier || !opponentCarrier.active || opponentCarrier.teamId === p.teamId) { i._physicsDone = true; continue; }
        var keeperDir = p.team && p.team.attackDirection || (p.teamId === m.teams[0].id ? 1 : -1);
        var keeperInOwnBox = keeperDir > 0 ? b.position.x <= 16.5 : b.position.x >= pitch(m).length - 16.5;
        keeperInOwnBox = keeperInOwnBox && Math.abs(b.position.y - pitch(m).width / 2) <= 20.16;
        var ownBackpass = b.lastTouchTeamId === p.teamId && b.lastTouchKind === "deliberate" && b._sameTeamBackpass;
        var keeperBallGap = hypot(p.position.x - b.position.x, p.position.y - b.position.y);
        var carrierBallGap = hypot(opponentCarrier.position.x - b.position.x, opponentCarrier.position.y - b.position.y);
        var keeperBodyGap = hypot(p.position.x - opponentCarrier.position.x, p.position.y - opponentCarrier.position.y);
        var keeperFace = p.facing || { x: -keeperDir, y: 0 }, keeperToBall = norm(b.position.x - p.position.x, b.position.y - p.position.y);
        var facingBall = keeperFace.x * keeperToBall.x + keeperFace.y * keeperToBall.y;
        var carrierFace = opponentCarrier.facing || norm(opponentCarrier.velocity && opponentCarrier.velocity.x || -keeperDir, opponentCarrier.velocity && opponentCarrier.velocity.y || 0);
        var ballAheadOfCarrier = (b.position.x - opponentCarrier.position.x) * carrierFace.x + (b.position.y - opponentCarrier.position.y) * carrierFace.y;
        var keeperBehindCarrier = (p.position.x - opponentCarrier.position.x) * carrierFace.x + (p.position.y - opponentCarrier.position.y) * carrierFace.y;
        var shieldedBall = ballAheadOfCarrier > 0.18 && keeperBehindCarrier < ballAheadOfCarrier - 0.12;
        var keeperContactReach = clamp(0.92 + attr(p, "reach", 55) * 0.003 + attr(p, "handling", 55) * 0.0015, 1.05, 1.35);
        if (!keeperInOwnBox || ownBackpass || shieldedBall || keeperBallGap > keeperContactReach || keeperBodyGap < 0.68 || facingBall < 0.2) { i._physicsDone = true; continue; }
        i._physicsDone = true;
        p._challengeRecoveryUntilTick = m.tick + 30;
        b._keeperRecoveryPlayerId = p.id; b._keeperRecoveryUntilTick = m.tick + 12;
        var keeperSkill = (attr(p, "handling", 55) * 0.36 + attr(p, "catching", 55) * 0.24
          + attr(p, "reflexes", 55) * 0.18 + attr(p, "tackling", 55) * 0.12 + attr(p, "strength", 55) * 0.10) / 100;
        var carrierControl = (attr(opponentCarrier, "dribbling", 55) * 0.45 + attr(opponentCarrier, "balance", 55) * 0.35
          + attr(opponentCarrier, "strength", 55) * 0.20) / 100;
        var contactQuality = clamp(0.38 + keeperSkill * 0.43 - carrierControl * 0.12
          + (1 - clamp(keeperBallGap / keeperContactReach, 0, 1)) * 0.16
          + (Number(p.balance) || 0.8) * 0.04 - (Number(opponentCarrier.velocity && hypot(opponentCarrier.velocity.x, opponentCarrier.velocity.y)) || 0) * 0.008, 0.16, 0.84);
        var keeperRoll = p.rng && p.rng.next ? p.rng.next() : 0.5;
        if (keeperRoll < contactQuality) {
          b.ownerId = p.id; b.handControl = true; b.controlState = "keeper-held";
          b.position.x = p.position.x + keeperFace.x * 0.45; b.position.y = p.position.y + keeperFace.y * 0.45; b.position.z = 0.68;
          b.velocity.x = b.velocity.y = b.velocity.z = 0; b._handStarted = m.clock && m.clock.elapsedSeconds || 0;
          b._keeperHandlingPlayerId = p.id; b._keeperHandlingTouch = b.lastTouchTick;
          b._keeperSourceTouchPlayerId = b.lastTouchPlayerId; b._keeperSourceTouchKind = b.lastTouchKind;
          b._keeperSourceTouchAction = b.lastTouchAction; b._keeperSourceTouchTargetId = b.lastTouchTargetId;
          addTouch(m, p, "control");
          event(m, "keeper-collection", { keeperId: p.id, challengedPlayerId: opponentCarrier.id, caught: true, shotBy: null, contactQuality: contactQuality });
        } else {
          var impulse = clamp(1.15 + (1 - carrierControl) * 1.1 + attr(p, "parrying", 55) * 0.008, 1.2, 2.8);
          var awayFromCarrier = norm(b.position.x - opponentCarrier.position.x, b.position.y - opponentCarrier.position.y);
          b.ownerId = null; b.handControl = false; b.controlState = "loose";
          b.velocity.x = (opponentCarrier.velocity.x || 0) * 0.28 + awayFromCarrier.x * impulse;
          b.velocity.y = (opponentCarrier.velocity.y || 0) * 0.28 + awayFromCarrier.y * impulse;
          b.velocity.z = 0; b.position.z = Math.max(Number(b.radius) || 0.11, b.position.z);
          b._touchCooldown = Math.max(Number(b._touchCooldown) || 0, 0.12);
          addTouch(m, p, "deflection");
          event(m, "keeper-punch", { keeperId: p.id, challengedPlayerId: opponentCarrier.id, caught: false, shotBy: null,
            contactQuality: contactQuality, outgoingVelocity: { x: b.velocity.x, y: b.velocity.y, z: b.velocity.z } });
        }
        continue;
      }
      if (["pass", "throughball", "through-ball", "shoot", "clear", "header"].indexOf(type) >= 0) {
        if (type === "header") {
          var reach = 1.25 + attr(p, "jumping", 55) / 100 * 0.72 + attr(p, "reach", 55) / 100 * 0.16;
          var ballSpeed = hypot(b.velocity.x, b.velocity.y), challenge = 0;
          if (carrier || dist > 1.05 || b.position.z < 1.05 || b.position.z > reach || ballSpeed > 20 || Math.abs(b.velocity.z) > 5.2) continue;
          if (TF.analysis && typeof TF.analysis.fillNearby === "function") {
            var nearby = TF.analysis.fillNearby(m, p.position, 1.3, nearbyOpponents, null, p.teamId);
            for (var nearIdx = 0; nearIdx < nearby.length; nearIdx++) { var challenger = nearby[nearIdx]; if (hypot(challenger.position.x - p.position.x, challenger.position.y - p.position.y) < 1.3) challenge += (attr(challenger, "jumping", 55) - attr(p, "jumping", 55)) / 180; }
          } else m.players.forEach(function (q) { if (q.active && q.teamId !== p.teamId && hypot(q.position.x - p.position.x, q.position.y - p.position.y) < 1.3) challenge += (attr(q, "jumping", 55) - attr(p, "jumping", 55)) / 180; });
          var aerial = clamp(0.56 + attr(p, "heading", 55) / 300 + attr(p, "balance", 55) / 500 - challenge + (Number(p.stamina) - 0.7) * 0.12, 0.2, 0.91);
          p._jumpHeight = reach; p._jumpUntilTick = m.tick + 16; p.visualMotion = { type: "header", tick: m.tick }; i._physicsDone = true;
          if ((p.rng && p.rng.next ? p.rng.next() : 0.5) <= aerial) strike(m, p, i, "header");
          else event(m, "header-missed", { playerId: p.id, teamId: p.teamId, challenge: challenge, aerialSkill: aerial });
          continue;
        }
        if (!carrier && !(dist < 0.9 && b.position.z < (type === "header" ? 2.7 : 1.6) && hypot(b.velocity.x, b.velocity.y) < 5)) continue;
        if (carrier && type !== "header") {
          var kickTarget = i.ballTarget || i.target, face = p.facing || { x: 1, y: 0 };
          var restartGeometry = restartFootApproach(m, p, i, pendingRestart);
          var kickOrigin = restartGeometry ? b.position : p.position;
          var toward = norm(kickTarget.x - kickOrigin.x, kickTarget.y - kickOrigin.y);
          var ballOffsetX = b.position.x - p.position.x, ballOffsetY = b.position.y - p.position.y;
          var ballGap = hypot(ballOffsetX, ballOffsetY) || 1;
          var footAhead = (ballOffsetX * face.x + ballOffsetY * face.y) / ballGap;
          if (restartGeometry && hypot(p.position.x - restartGeometry.stance.x, p.position.y - restartGeometry.stance.y) > 0.12) continue;
          if (face.x * toward.x + face.y * toward.y < 0.86 || ballGap > 1.15 || ballGap > 0.35 && footAhead < 0.78) continue;
        }
        i._physicsDone = true; strike(m, p, i, type === "throughball" || type === "through-ball" ? "throughBall" : type); continue;
      }
      if (carrier || dist > 1.35 || b.position.z > 0.55) continue;
      var dx = b.position.x - p.position.x, dy = b.position.y - p.position.y, toBall = norm(dx, dy), face = p.facing || { x: 1, y: 0 };
      if (face.x * toBall.x + face.y * toBall.y < -0.25) continue;
      var attacker = b.ownerId && m.playersById[b.ownerId];
      // AI actions can outlive a possession change by a decision interval. A
      // stale challenge against a teammate must not turn routine close control
      // into a tackle, turnover, or free kick. Consume the intent and let the
      // ordinary body-contact solver handle any physical bump.
      if (attacker && attacker.teamId === p.teamId) { i._physicsDone = true; continue; }
      i._physicsDone = true; p._challengeRecoveryUntilTick = m.tick + (type === "slide" ? 30 : 24);
      p.visualMotion = { type: type === "slide" ? "tackle" : "tackle", tick: m.tick };
      var attackSkill = attacker ? attr(attacker, "dribbling", 55) + attr(attacker, "balance", 55) * 0.35 : 48;
      var tackleSkill = attr(p, "tackling", 55) + attr(p, "strength", 55) * 0.2;
      var chance = clamp(0.4 + (tackleSkill - attackSkill) * 0.007 + (1 - (Number(p.balance) || 0.8)) * 0.18, 0.12, 0.85);
      var random = p.rng && p.rng.next ? p.rng.next() : 0.5;
      if (random < chance) { b.ownerId = null; b.velocity.x += toBall.x * 2.8; b.velocity.y += toBall.y * 2.8; b._touchCooldown = Math.max(Number(b._touchCooldown) || 0, 0.12); addTouch(m, p, "challenge"); p.stats = p.stats || {}; p.stats.tackles = (p.stats.tackles || 0) + 1; event(m, "tackle", { defenderId: p.id, attackerId: attacker && attacker.id || null, teamId: p.teamId, success: true, ballLoose: true, possessionWon: false }); }
      else { event(m, "tackle", { defenderId: p.id, attackerId: attacker && attacker.id || null, teamId: p.teamId, success: false }); }
      if (attacker) {
        var contactGeometry = sweptPlayerContact(p, attacker), playerContactDistance = contactGeometry.distance;
        var legAxis = toBall, victimOffset = contactGeometry.towardVictim;
        var legAlong = victimOffset.x * legAxis.x + victimOffset.y * legAxis.y;
        var legLateral = Math.abs(victimOffset.x * legAxis.y - victimOffset.y * legAxis.x);
        var isSlide = type === "slide";
        var bodyContact = playerContactDistance <= 0.68;
        // A challenge can trip a player without meaningful torso impact, but
        // only when the actual foot path intersects the victim. Being near a
        // ball poke alone is not a player collision.
        var legReach = isSlide ? 1.24 : 0.96, legHalfWidth = isSlide ? 0.36 : 0.27;
        var legContact = legAlong >= 0.12 && legAlong <= legReach && legLateral <= legHalfWidth;
        if (!bodyContact && !legContact) continue;
        var approachSpeed = hypot(p.velocity.x || 0, p.velocity.y || 0);
        var towardOpponent = norm(attacker.position.x - p.position.x, attacker.position.y - p.position.y);
        var approach = approachSpeed > 0.25 ? clamp((p.velocity.x * towardOpponent.x + p.velocity.y * towardOpponent.y) / approachSpeed, -1, 1) : 0;
        var relativeVx = (p.velocity.x || 0) - (attacker.velocity.x || 0), relativeVy = (p.velocity.y || 0) - (attacker.velocity.y || 0);
        var relativeSpeed = hypot(relativeVx, relativeVy);
        var signedClosingSpeed = relativeSpeed > 1e-5 ? relativeVx * towardOpponent.x + relativeVy * towardOpponent.y : 0;
        var relativeImpact = clamp(Math.max(0, signedClosingSpeed) / 5.5, 0, 1);
        var discipline = attr(p, "discipline", 60) / 99;
        var severity = clamp(0.025 + (1 - discipline) * 0.12 + (1 - clamp(tackleSkill / 150, 0, 1)) * 0.07
          + relativeImpact * (0.25 + Math.max(0, approach) * 0.08)
          + (legContact ? (isSlide ? 0.17 : 0.075) : 0) + (isSlide && !legContact ? 0.035 : 0)
          + (1 - clamp(Number(p.balance) || 0.8, 0, 1)) * 0.055, 0.01, 0.82);
        event(m, "contact", { offenderId: p.id, victimId: attacker.id, point: { x: b.position.x, y: b.position.y }, severity: severity, reckless: severity >= 0.58, ballPlayed: random < chance,
          approachSpeed: approachSpeed, relativeSpeed: relativeSpeed, relativeClosingSpeed: signedClosingSpeed, relativeImpact: relativeImpact,
          approach: approach, direction: toBall, playerSeparation: playerContactDistance, bodyContact: bodyContact, legContact: legContact,
          legAlong: legAlong, legLateral: legLateral });
      }
    }
  }
  function keeperHandling(m) {
    var b = m.ball, ps = m.players, field = pitch(m);
    if (b.ownerId) return;
    for (var j = 0; j < ps.length; j++) {
      var p = ps[j]; if (!p.active || !p.isGoalkeeper || b.lastTouchTeamId === p.teamId && b.lastTouchKind === "deliberate" && b._sameTeamBackpass) continue;
      var handlingRestriction = b._keeperHandlingRestriction;
      var handUseProhibited = handlingRestriction && handlingRestriction.teamId === p.teamId
        && (handlingRestriction.keeperId === p.id || (handlingRestriction.keeperId == null && !!p.isGoalkeeper));
      // Restriction means the keeper may still play the ball with the feet,
      // but automatic hand collection/save handling is unavailable. Generic
      // player contact below remains the normal physical foot-control path.
      if (handUseProhibited) continue;
      if (b._keeperRecoveryPlayerId === p.id && m.tick < (b._keeperRecoveryUntilTick || 0)) continue;
      var dir = p.team && p.team.attackDirection || (p.teamId === m.teams[0].id ? 1 : -1);
      var r = Number(b.radius) || 0.11;
      // Once the whole ball has crossed the goal plane it is already a goal
      // or out. A keeper may still play a ball whose center crossed the line
      // while part of its radius remains on the field side.
      var wholeBallPastOwnGoalLine = dir > 0 ? b.position.x + r < 0 : b.position.x - r > field.length;
      if (wholeBallPastOwnGoalLine) continue;
      var d = hypot(b.position.x - p.position.x, b.position.y - p.position.y);
      if (b._kickFollowThroughPlayerId === p.id) {
        if (m.tick <= b._kickFollowThroughUntil && d < 1.35) continue;
        b._kickFollowThroughPlayerId = null; b._kickFollowThroughUntil = 0;
      }
      var keeperIntent = p.motor || p.intent || {}, isCommittedSave = String(keeperIntent.type || keeperIntent.action || "").toLowerCase() === "save";
      var saveStartTick = p._keeperDiveState ? p._keeperDiveState.startTick : Number.isFinite(Number(keeperIntent.createdTick)) ? Number(keeperIntent.createdTick) : m.tick;
      var diveProgress = isCommittedSave ? clamp((m.tick - saveStartTick + 1) / 10, 0, 1) : 0;
      var saveReach = 1.25 + (isCommittedSave ? (attr(p, "diving", 55) * 0.012 + attr(p, "reach", 55) * 0.004) * diveProgress : 0);
      if (d > saveReach || b.position.z > (isCommittedSave ? 2.65 : 2.35)) continue;
      // Handling is legal only when the ball itself is inside the keeper's
      // penalty area. Keeper proximity alone must not extend the box by 5m.
      var ballInsideOwnBox = dir > 0 ? b.position.x <= 16.5 : b.position.x >= field.length - 16.5;
      if (!ballInsideOwnBox || Math.abs(b.position.y - field.width / 2) > 20.16) continue;
      var quality = clamp((attr(p, "handling", 55) + attr(p, "catching", 55) + attr(p, "reflexes", 55)) / 3 / 100 - hypot(b.velocity.x, b.velocity.y) * 0.006 - b.position.z * 0.025 - Math.max(0, d - 1.25) / Math.max(1, saveReach - 1.25) * (isCommittedSave ? 0.18 : 0), 0.12, 0.93);
      var r = p.rng && p.rng.next ? p.rng.next() : 0.5;
      var shotOnTarget = b._lastShotType === "shot" && !!b._lastShotId;
      var shotPlayerId = shotOnTarget ? b._lastShotId : null;
      b._keeperRecoveryPlayerId = p.id; b._keeperRecoveryUntilTick = m.tick + 18;
      if (r < quality) { p.visualMotion = { type: "save", tick: m.tick, target: { x: b.position.x, y: b.position.y } }; b._keeperHandlingTouch = b.lastTouchTick; b._keeperHandlingPlayerId = p.id; b._keeperSourceTouchPlayerId = b.lastTouchPlayerId; b._keeperSourceTouchKind = b.lastTouchKind; b._keeperSourceTouchAction = b.lastTouchAction; b._keeperSourceTouchTargetId = b.lastTouchTargetId; b._keeperSourceRestartType = b._lastRestartTouchType; b.ownerId = p.id; b.velocity.x = b.velocity.y = b.velocity.z = 0; b.position.z = 0.68; b.handControl = true; b.controlState = "keeper-held"; b._handStarted = m.clock.elapsedSeconds; addTouch(m, p, shotOnTarget ? "save" : "control"); event(m, shotOnTarget ? "save" : "keeper-collection", { keeperId: p.id, caught: true, shotBy: shotPlayerId }); }
      else {
        p.visualMotion = { type: "dive", tick: m.tick, target: { x: b.position.x, y: b.position.y } };
        // A palm contact reflects the ball from the keeper's hand-facing
        // normal. Facing is perception/intent driven by the goalkeeper motor;
        // it also lets a badly positioned keeper produce a poor, non-saving
        // parry with substantial incoming momentum still attached.
        var face = p.facing || { x: -dir, y: 0 }, n = norm(face.x, face.y);
        var incomingSpeed = hypot(b.velocity.x, b.velocity.y);
        var normalSpeed = b.velocity.x * n.x + b.velocity.y * n.y;
        var parryRestitution = clamp(0.16 + attr(p, "parrying", 55) * 0.0042, 0.16, 0.58);
        // Reflect only the component along the actual hand normal. Tangential
        // flight survives, so a mistimed/off-angle parry can still reach goal.
        b.velocity.x -= (1 + parryRestitution) * normalSpeed * n.x;
        b.velocity.y -= (1 + parryRestitution) * normalSpeed * n.y;
        b.velocity.z = Math.max(0.25, Math.min(1.4, Math.abs(b.velocity.z) * 0.35 + 0.45 + attr(p, "parrying", 55) * 0.004));
        b._touchCooldown = 0.25; b.ownerId = null; addTouch(m, p, shotOnTarget ? "save" : "control");
        event(m, shotOnTarget ? "save" : "keeper-punch", { keeperId: p.id, caught: false, shotBy: shotPlayerId,
          contactNormal: { x: n.x, y: n.y }, incomingSpeed: incomingSpeed, parryRestitution: parryRestitution,
          outgoingVelocity: { x: b.velocity.x, y: b.velocity.y, z: b.velocity.z } });
      }
      return;
    }
  }
  function ballStep(m, dt) {
    var b = m.ball, field = pitch(m), r = b.radius || 0.11;
    var controlledCarrier = null;
    b.previousPosition.x = b.position.x; b.previousPosition.y = b.position.y; b.previousPosition.z = b.position.z;
    b._touchCooldown = Math.max(0, (b._touchCooldown || 0) - dt);
    if (b.ownerId) {
      var carrier = m.playersById[b.ownerId];
      if (!carrier || !carrier.active) { b.ownerId = null; b.handControl = false; }
      else if (b.handControl) { b.position.x = carrier.position.x + carrier.facing.x * 0.45; b.position.y = carrier.position.y + carrier.facing.y * 0.45; b.position.z = 0.68; }
      else {
        controlledCarrier = carrier;
        var lastTouchTick = Number(b._lastControlTouchTick || 0), stride = hypot(carrier.velocity.x, carrier.velocity.y);
        var front = carrier.facing || { x: 1, y: 0 }, footOffset = clamp(0.43 + stride * 0.08, 0.43, 0.92);
        var footX = carrier.position.x + front.x * footOffset, footY = clamp(carrier.position.y + front.y * footOffset, 0, field.width);
        var carrierIntent = carrier.motor || carrier.intent || {}, carrierAction = String(carrierIntent.action || carrierIntent.type || "").toLowerCase();
        var isTurningForKick = ["pass", "throughball", "through-ball", "shoot", "clear"].indexOf(carrierAction) >= 0 && carrierIntent.ballTarget;
        var touchIntervalTicks = isTurningForKick ? 5 : stride > 4.5 ? 10 : 14;
        if (m.tick - lastTouchTick >= touchIntervalTicks) {
          // Carry is a sequence of discrete touches. Each touch adjusts ball
          // velocity toward the running foot; the ball continues to travel and
          // roll between contacts instead of being snapped onto the player.
          var touch = clamp(stride * 0.1 + 0.32, 0.32, 0.95);
          var control = clamp(attr(carrier, "firstTouch", 58) / 100 * 0.45 + attr(carrier, "balance", 55) / 100 * 0.35 + (Number(carrier.stamina) || 1) * 0.2, 0.25, 1);
          var blend = clamp(0.38 + control * 0.2, 0.38, 0.58);
          var touchVx = carrier.velocity.x * 0.68 + front.x * touch;
          var touchVy = carrier.velocity.y * 0.68 + front.y * touch;
          var correctionX = clamp((footX - b.position.x) * 0.9, -1.1, 1.1);
          var correctionY = clamp((footY - b.position.y) * 0.9, -1.1, 1.1);
          b.velocity.x += (touchVx - b.velocity.x) * blend + correctionX;
          b.velocity.y += (touchVy - b.velocity.y) * blend + correctionY;
          b.velocity.z = 0;
          b._lastControlTouch = m.clock.elapsedSeconds; b._lastControlTouchTick = m.tick; b.controlState = "controlled";
          var p = carrier, pressureValue = localPressure(m, p, 2.5);
          // A normal running touch should retain possession. Miscontrols emerge
          // from sustained pressure, very high stride speed, fatigue, or weak control.
          var lossChance = clamp((0.004 + Math.min(0.2, pressureValue * 0.045) + Math.max(0, stride - 6) * 0.012 + (1 - control) * 0.025) * (touchIntervalTicks / 14), 0.001, 0.32);
          if (p.rng && p.rng.next && p.rng.next() < lossChance) {
            b.ownerId = null; b.controlState = "loose";
            var heavyTouch = 0.45 + (1 - control) * 0.95 + Math.max(0, stride - 5) * 0.06;
            b.velocity.x += front.x * heavyTouch; b.velocity.y += front.y * heavyTouch;
            event(m, "miscontrol", { playerId: p.id, teamId: p.teamId, speed: stride, control: control, pressure: pressureValue });
          } else addTouch(m, p, "carry");
        }
      }
      if (b.ownerId && b.handControl) return;
    }
    b.position.x += b.velocity.x * dt; b.position.y += b.velocity.y * dt; b.position.z += b.velocity.z * dt;
    if (b.position.z > r) {
      b.velocity.z -= 9.81 * dt;
      b.velocity.x *= Math.max(0, 1 - 0.015 * dt);
      b.velocity.y *= Math.max(0, 1 - 0.015 * dt);
    }
    else {
      b.position.z = r;
      if (b.velocity.z < -1.0) b.velocity.z = -b.velocity.z * 0.42;
      else b.velocity.z = 0;
      b.velocity.x *= Math.max(0, 1 - 0.42 * dt); b.velocity.y *= Math.max(0, 1 - 0.42 * dt);
      if (Math.abs(b.velocity.x) + Math.abs(b.velocity.y) < 0.08) b.velocity.x = b.velocity.y = 0;
    }
    var pendingRelease = m.state && m.state.restartReleaseThisTick;
    if (pendingRelease && pendingRelease.awaitingFieldEntry
      && b.position.x >= r && b.position.x <= field.length - r
      && b.position.y >= r && b.position.y <= field.width - r) {
      // A throw is not in play until its physical flight has entered the pitch.
      // Emit this before resolving any same-tick player contact below.
      if (typeof TF.confirmRestartPhysicalRelease === "function") TF.confirmRestartPhysicalRelease(m, pendingRelease.takerId, "throw", true);
    }
    pendingRelease = m.state && m.state.restartReleaseThisTick;
    if (pendingRelease && pendingRelease.awaitingFieldEntry) {
      var beyondPitch = b.position.x < -r || b.position.x > field.length + r
        || b.position.y < -r || b.position.y > field.width + r;
      var groundBeforeEntry = b.position.z <= r + 0.01
        && !(b.position.x >= r && b.position.x <= field.length - r && b.position.y >= r && b.position.y <= field.width - r);
      if ((beyondPitch || groundBeforeEntry) && typeof TF.retakeUnenteredThrow === "function") {
        TF.retakeUnenteredThrow(m, pendingRelease);
      }
      // The throw is not yet live. Let flight/gravity continue, but do not
      // award a goal, ordinary restart, keeper handling, or player contact.
      return;
    }
    if (controlledCarrier && b.ownerId === controlledCarrier.id) {
      var controlGap = hypot(b.position.x - controlledCarrier.position.x, b.position.y - controlledCarrier.position.y);
      if (controlGap > 1.55 || b.position.z > 0.3) {
        b.ownerId = null; b.controlState = "loose"; controlledCarrier = null;
        event(m, "miscontrol", { playerId: carrier.id, teamId: carrier.teamId, reason: "touch-out-of-reach", distance: controlGap });
      } else return;
    }
    // Goal frame: posts and crossbar reflect the ball back into play.
    var goalHalf = (field.goalWidth || 7.32) / 2, goalH = field.goalHeight || 2.44;
    if ((b.position.x < 0 || b.position.x > field.length) && Math.abs(b.position.y - field.width / 2) <= goalHalf + 0.13 && b.position.z <= goalH + 0.12) {
      if (Math.abs(b.position.y - (field.width / 2 - goalHalf)) < 0.13 || Math.abs(b.position.y - (field.width / 2 + goalHalf)) < 0.13) { b.velocity.y *= -0.72; b.position.y = field.width / 2 + (b.position.y < field.width / 2 ? -goalHalf - 0.13 : goalHalf + 0.13); event(m, "frame-hit", { frame: "post" }); }
      else if (Math.abs(b.position.z - goalH) < 0.13 && b.position.x > -0.2 && b.position.x < field.length + 0.2) { b.velocity.z = Math.abs(b.velocity.z) * 0.68 + 1.2; b.velocity.x *= -0.5; event(m, "frame-hit", { frame: "crossbar" }); }
    }
    // Give a goalkeeper the legitimate handling opportunity before generic
    // outfield foot control, then resolve field contact by closest swept path.
    keeperHandling(m);
    if (!b.ownerId && !b._touchCooldown && Math.min(b.previousPosition.z, b.position.z) < 1.35) {
      var winner = null, closest = 0.67;
      var followPlayer = b._kickFollowThroughPlayerId && m.playersById[b._kickFollowThroughPlayerId];
      if (b._kickFollowThroughPlayerId && (!followPlayer || m.tick > b._kickFollowThroughUntil || hypot(b.position.x - followPlayer.position.x, b.position.y - followPlayer.position.y) >= 1.05)) {
        b._kickFollowThroughPlayerId = null; b._kickFollowThroughUntil = 0;
      }
      for (var k = 0; k < m.players.length; k++) {
        var p = m.players[k]; if (!p.active || (p.id === b.lastTouchPlayerId && m.clock.elapsedSeconds - (b._lastTouchTime || 0) < 0.13)) continue;
        var d = sweptDistance(p, b);
        if (p.id === b._kickFollowThroughPlayerId && m.tick <= b._kickFollowThroughUntil && d < 1.05) continue;
        if (d > closest || d === closest && winner && String(p.id).localeCompare(String(winner.id)) >= 0) continue;
        closest = d; winner = p;
      }
      if (winner) {
        var p = winner;
        var speed = hypot(b.velocity.x, b.velocity.y), face = p.facing || { x: 1, y: 0 };
        var incoming = speed > 0.25 ? norm(-b.velocity.x, -b.velocity.y) : norm(face.x, face.y);
        var facingQuality = clamp((face.x * incoming.x + face.y * incoming.y + 1) * 0.5, 0, 1), pressureValue = localPressure(m, p, 3);
        var control = clamp(0.96 + (attr(p, "firstTouch", 57) - 55) * 0.001 + (attr(p, "balance", 55) - 55) * 0.0006
          - Math.max(0, speed - 2) * 0.016 - (1 - facingQuality) * 0.22 - Math.max(0, b.position.z - 0.2) * 0.12
          - Math.min(0.32, pressureValue * 0.11) - (1 - clamp(Number(p.stamina) || 1, 0, 1)) * 0.1, 0.12, 0.995);
        var random = p.rng && p.rng.next ? p.rng.next() : 0.5;
        if (random < control) { b.ownerId = p.id; b.controlState = "controlled"; b.velocity.x *= 0.22; b.velocity.y *= 0.22; b.velocity.z = 0; b._lastControlTouch = m.clock.elapsedSeconds; b._lastControlTouchTick = m.tick; addTouch(m, p, "control"); event(m, "ball-control", { playerId: p.id, teamId: p.teamId, origin: { x: p.position.x, y: p.position.y }, contactPoint: { x: b.position.x, y: b.position.y, z: b.position.z }, quality: control }); }
        else {
          // Resolve a failed trap as a dissipative collision against the
          // player's moving body; the ball cannot gain energy in its incoming
          // direction merely because the touch was poor.
          var nx = b.position.x - p.position.x, ny = b.position.y - p.position.y;
          var normal = hypot(nx, ny) > 1e-4 ? norm(nx, ny) : norm(-(b.velocity.x || 0), -(b.velocity.y || 0));
          var rvx = b.velocity.x - (p.velocity.x || 0), rvy = b.velocity.y - (p.velocity.y || 0), normalSpeed = rvx * normal.x + rvy * normal.y;
          var restitution = clamp(0.08 + (100 - attr(p, "firstTouch", 57)) * 0.0012 + Math.max(0, speed - 5) * 0.012 + pressureValue * 0.035 + (1 - facingQuality) * 0.07, 0.08, 0.48);
          var tx = rvx - normal.x * normalSpeed, ty = rvy - normal.y * normalSpeed;
          var rebound = normalSpeed < 0 ? -normalSpeed * restitution : normalSpeed * 0.32;
          b.velocity.x = (p.velocity.x || 0) + tx * 0.38 + normal.x * rebound;
          b.velocity.y = (p.velocity.y || 0) + ty * 0.38 + normal.y * rebound;
          b.velocity.z *= 0.35; b._touchCooldown = 0.12; addTouch(m, p, "deflection");
          event(m, "ball-deflection", { playerId: p.id, teamId: p.teamId, restitution: restitution, relativeNormalSpeed: normalSpeed });
        }
      }
    }
  }
  TF.updatePhysics = function (match, dt) {
    if (!match || !match.ball || match.state && (match.state.finished || match.state.halfTime)) return;
    dt = Number(dt) || TF.FIXED_DT || 1 / 60;
    if (match.state && match.state.phase === "dead-ball") { movePlayers(match, dt); return; }
    var restart = match.state && match.state.restartInProgress;
    if (restart && restart.point && match.ball.ownerId === restart.takerId) {
      // Rules may establish restart ownership before a renderer/world tick has
      // put the ball on the marked spot. Complete that legal placement once,
      // while the designated taker still owns it.
      var restartGap = hypot(match.ball.position.x - restart.point.x, match.ball.position.y - restart.point.y);
      if (restartGap > 0.18) {
        match.ball.position.x = match.ball.previousPosition.x = restart.point.x;
        match.ball.position.y = match.ball.previousPosition.y = restart.point.y;
        match.ball.position.z = match.ball.previousPosition.z = 0.11;
        match.ball.velocity.x = match.ball.velocity.y = match.ball.velocity.z = 0;
      }
    }
    if (match.ball.handControl && match.ball.ownerId) {
      var keeper = match.playersById[match.ball.ownerId], intent = keeper && (keeper.motor || keeper.intent);
      var pendingThrow = match.state && match.state.restartInProgress;
      var isThrowInTaker = pendingThrow && pendingThrow.type === "throw-in" && pendingThrow.takerId === match.ball.ownerId;
      if (isThrowInTaker && intent && String(intent.action || intent.type).toLowerCase() === "throw") {
        var throwTarget = intent.ballTarget || intent.target, lineY = pendingThrow.point.y;
        var throwFieldward = throwTarget && (lineY === 0 ? Number(throwTarget.y) > 0 : Number(throwTarget.y) < pitch(match).width);
        var throwInPitch = throwTarget && Number.isFinite(Number(throwTarget.x)) && Number.isFinite(Number(throwTarget.y))
          && Number(throwTarget.x) >= 0 && Number(throwTarget.x) <= pitch(match).length && throwFieldward;
        if (throwInPitch) { match.ball.handControl = false; match.ball.position.x = match.ball.previousPosition.x = pendingThrow.point.x; match.ball.position.y = match.ball.previousPosition.y = lineY; match.ball.position.z = match.ball.previousPosition.z = 1.85; strike(match, keeper, intent, "throw"); }
        intent._physicsDone = true;
      } else if (!isThrowInTaker && keeper && intent && keeper.isGoalkeeper && ["pass", "throughball", "clear", "throw"].indexOf(String(intent.action || intent.type).toLowerCase()) >= 0) {
        var distribution = String(intent.action || intent.type).toLowerCase();
        var strikeType = distribution === "throw" ? "throw" : distribution === "clear" ? "clear" : distribution === "throughball" ? "throughBall" : "pass";
        if (TF.analysis && typeof TF.analysis.rebuild === "function") TF.analysis.rebuild(match);
        match.ball._keeperReleasedFromHandsThisTick = !!match.ball.handControl;
        match.ball.handControl = false; match.ball.position.z = 0.68; strike(match, keeper, intent, strikeType); intent._physicsDone = true;
      }
    }
    movePlayers(match, dt);
    // Invalidate after motion; the first proximity query in this tick rebuilds
    // the shared index lazily. Ticks without a pressure/contact query skip the
    // index work entirely.
    if (TF.analysis && typeof TF.analysis.invalidate === "function") TF.analysis.invalidate(match);
    actionPass(match); ballStep(match, dt);
  };
  if (typeof TF.registerCheckpointExtension === "function") TF.registerCheckpointExtension("physics", {
    capture: function (m) {
      var b = m.ball, names = ["lastTouchKind", "lastTouchAction", "lastTouchTargetId", "lastTouchTarget", "_keeperHandlingRestriction", "lastTouchTick", "_lastTouchTime", "previousTouchPlayerId", "previousTouchTeamId", "offsideKick", "offsideSnapshot", "controlState", "handControl", "_touchCooldown", "_lastControlTouch", "_lastControlTouchTick", "_handStarted", "_keeperHandlingTouch", "_keeperHandlingPlayerId", "_keeperRecoveryPlayerId", "_keeperRecoveryUntilTick", "_keeperSourceTouchPlayerId", "_keeperSourceTouchKind", "_keeperSourceTouchAction", "_keeperSourceTouchTargetId", "_keeperSourceRestartType", "_sameTeamBackpass", "_offsideExemptNextTouch", "_lastRestartType", "_lastRestartTouchType", "_lastShotId", "_lastShotType", "_kickFollowThroughPlayerId", "_kickFollowThroughUntil", "_assistPlayerId", "_passAssistCandidate"];
      var state = {}; names.forEach(function (k) { if (b[k] !== undefined) state.ball = state.ball || {}, state.ball[k] = JSON.parse(JSON.stringify(b[k])); });
      state.players = {}; (m.players || []).forEach(function (p) { state.players[p.id] = { balance: p.balance, jumpHeight: p._jumpHeight, jumpUntilTick: p._jumpUntilTick, challengeRecoveryUntilTick: p._challengeRecoveryUntilTick,
        keeperDiveState: p._keeperDiveState && JSON.parse(JSON.stringify(p._keeperDiveState)), keeperDiveRecoveryUntilTick: p._keeperDiveRecoveryUntilTick,
        intentMotorAlias: !!p.intent && p.intent === p.motor, intentActionAlias: !!p.intent && p.intent === p.currentAction, motorActionAlias: !!p.motor && p.motor === p.currentAction, intentDone: p.intent && p.intent._physicsDone, motorDone: p.motor && p.motor._physicsDone }; });
      return state;
    },
    restore: function (m, state) {
      state = state || {}; Object.keys(state.ball || {}).forEach(function (k) { m.ball[k] = state.ball[k]; });
      (m.players || []).forEach(function (p) { var s = state.players && state.players[p.id]; if (!s) return; p.balance = s.balance; p._jumpHeight = s.jumpHeight; p._jumpUntilTick = s.jumpUntilTick; p._challengeRecoveryUntilTick = s.challengeRecoveryUntilTick;
        p._keeperDiveState = s.keeperDiveState && JSON.parse(JSON.stringify(s.keeperDiveState)); p._keeperDiveRecoveryUntilTick = s.keeperDiveRecoveryUntilTick;
        if (p.intent) p.intent._physicsDone = s.intentDone; if (p.motor) p.motor._physicsDone = s.motorDone; if (s.intentMotorAlias) p.motor = p.intent; if (s.intentActionAlias) p.currentAction = p.intent; else if (s.motorActionAlias) p.currentAction = p.motor; });
    }
  });
  TF.physicsHelpers = { addTouch: addTouch, event: event, pitch: pitch, emitKickSnapshot: emitKickSnapshot };
})(typeof window !== "undefined" ? window : globalThis);
