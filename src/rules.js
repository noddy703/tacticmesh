(function (root) {
  "use strict";
  var TF = root.TF = root.TF || {};
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var dist = function (a, b) { var x = a.x - b.x, y = a.y - b.y; return Math.sqrt(x * x + y * y); };
  var field = function (m) { return m.pitch || (m.world && m.world.pitch) || { length: 105, width: 68 }; };
  var event = function (m, type, data) { var e = Object.assign({ type: type, tick: m.tick, time: m.clock && m.clock.elapsedSeconds || 0 }, data || {}); if (typeof TF.appendEvent === "function") TF.appendEvent(m, e); else m.events.push(e); if (Object.freeze) Object.freeze(e); return e; };
  var team = function (m, id) { return (m.teams || []).find(function (t) { return t.id === id; }) || null; };
  var player = function (m, id) { return m.playersById && m.playersById[id] || (m.players || []).find(function (p) { return p.id === id; }) || null; };
  var opponent = function (m, id) { return (m.teams || []).find(function (t) { return t.id !== id; }) || null; };
  function config(m) {
    var c = m.rulesConfig || m.config && m.config.rules || {};
    return Object.assign({ version: "IFAB 2026/27", substitutes: 5, substitutionWindows: 3, minPlayers: 7, addedTimeSeconds: null, autoRestartSeconds: 1.1, advantageSeconds: 6, allowReturnSubstitutions: false, strictClock: true }, c);
  }
  function restart(m, type, teamId, point, reason) {
    var f = field(m), b = m.ball, p = point || { x: b.position.x, y: b.position.y };
    p = type === "throw-in" ? { x: clamp(p.x, 0, f.length), y: p.y <= f.width / 2 ? 0 : f.width }
      : type === "corner" ? { x: p.x <= f.length / 2 ? 0 : f.length, y: p.y <= f.width / 2 ? 0 : f.width }
        : { x: clamp(p.x, 0.05, f.length - 0.05), y: clamp(p.y, 0.05, f.width - 0.05) };
    m.state.restartType = type; m.state.restartTeamId = teamId || null; m.state.phase = "dead-ball"; m.state.possessionTeamId = null;
    // A newly awarded restart supersedes any not-yet-released restart setup.
    m.state.restartInProgress = null;
    m.state.restartSecondTouch = null;
    m.state.restartReleaseThisTick = null;
    m.state.restartPoint = p; m.state.restartStarted = m.clock.elapsedSeconds; m.state.restartReason = reason || type;
    m.state.restartSequence = (Number(m.state.restartSequence) || 0) + 1;
    if (m.state.rules) m.state.rules.dropBallActive = false;
    b.position.x = p.x; b.position.y = p.y; b.position.z = 0.11; b.previousPosition.x = p.x; b.previousPosition.y = p.y; b.previousPosition.z = 0.11;
    b.velocity.x = b.velocity.y = b.velocity.z = 0; b.ownerId = null; b.handControl = false; b.controlState = "dead";
    b.offsideKick = null; b.offsideSnapshot = null; b.lastTouchPlayerId = null; b.lastTouchTeamId = null; b.lastTouchKind = "restart";
    b.lastTouchAction = null; b.lastTouchTargetId = null; b.lastTouchTarget = null; b._keeperHandlingRestriction = null;
    b._passAssistCandidate = null; b._assistPlayerId = null;
    b._lastRestartTouchType = null; b._lastRestartType = null;
    m.state.offsidePhase = null;
    if (m.state.advantageCardPending) { var pending = m.state.advantageCardPending, offender = player(m, pending.offenderId); if (offender) administerCard(m, offender, pending.card, pending.cause || "advantage-stoppage"); m.state.advantageCardPending = null; }
    event(m, "restart-awarded", { restartType: type, teamId: teamId || null, point: p, reason: reason || type });
  }
  function nearTouchlinePoint(m) { var f = field(m), b = m.ball; return { x: clamp(b.position.x, 0, f.length), y: b.position.y < f.width / 2 ? 0 : f.width }; }
  function goalLinePoint(m, attackPositive, y) { var f = field(m); return { x: attackPositive ? f.length : 0, y: clamp(y, f.width / 2 - (f.goalWidth || 7.32) / 2, f.width / 2 + (f.goalWidth || 7.32) / 2) }; }
  function insidePenalty(m, p, defendTeam) {
    var f = field(m), t = team(m, defendTeam), attackDir = t && t.attackDirection || (m.teams[0] && m.teams[0].id === defendTeam ? 1 : -1);
    var x = attackDir > 0 ? p.x : f.length - p.x;
    return x <= 16.5 + 1e-6 && Math.abs(p.y - f.width / 2) <= 20.16;
  }
  function goalAward(m, attackingTeamId) {
    var scorerId = m.ball.lastTouchPlayerId, scorer = player(m, scorerId), assistId = m.ball._assistPlayerId || null;
    // A keeper's unsuccessful save or another non-controlling deflection does
    // not end the shot. Credit its shooter if that continuous shot crosses
    // the line; addTouch clears this provenance as soon as anyone controls it.
    if ((!scorer || scorer.teamId !== attackingTeamId)
      && (m.ball.lastTouchKind === "save" || m.ball.lastTouchKind === "deflection")
      && m.ball._lastShotId) {
      var shotPlayer = player(m, m.ball._lastShotId);
      if (shotPlayer && shotPlayer.teamId === attackingTeamId) scorerId = shotPlayer.id;
    }
    scorer = player(m, scorerId);
    if (scorer && scorer.teamId !== attackingTeamId) scorerId = null;
    var assist = player(m, assistId);
    if (!scorerId || !assist || assist.teamId !== attackingTeamId || assist.id === scorerId) assistId = null;
    var goal = m.scoreGoal(attackingTeamId, scorerId, assistId);
    if (!goal) return;
    event(m, "goal-confirmed", { teamId: attackingTeamId, scorerId: goal.scorerId || null, assistId: goal.assistId || null, lastTouchPlayerId: m.ball.lastTouchPlayerId });
    m.state.phase = "dead-ball"; m.state.restartType = "kickoff"; m.state.restartTeamId = opponent(m, attackingTeamId).id;
    m.state.restartPoint = { x: field(m).length / 2, y: field(m).width / 2 }; m.state.restartStarted = m.clock.elapsedSeconds;
    m.state.restartSequence = (Number(m.state.restartSequence) || 0) + 1;
    m.ball.position.x = field(m).length / 2; m.ball.position.y = field(m).width / 2; m.ball.position.z = 0.11;
    m.ball.offsideKick = null; m.ball.offsideSnapshot = null; m.ball._lastRestartTouchType = null; m.ball._lastRestartType = null;
    m.ball._passAssistCandidate = null; m.ball._assistPlayerId = null;
    m.state.restartSecondTouch = null;
    m.state.restartReleaseThisTick = null;
  }
  function setPosition(p, x, y) {
    p.position.x = x; p.position.y = y; p.previousPosition.x = x; p.previousPosition.y = y;
    p.velocity.x = 0; p.velocity.y = 0;
  }
  function positionRestartPlayers(m, type, taker, restartTeam, point) {
    var f = field(m), dir = restartTeam.attackDirection || 1, other = opponent(m, restartTeam.id), active = m.players.filter(function (p) { return p.active; });
    if (type === "kickoff") {
      active.forEach(function (p) {
        if (p.id === taker.id) return;
        var ownDirection = (team(m, p.teamId) || {}).attackDirection || 1;
        if (ownDirection > 0 && p.position.x > f.length / 2 - 0.2) setPosition(p, f.length / 2 - 0.2, p.position.y);
        if (ownDirection < 0 && p.position.x < f.length / 2 + 0.2) setPosition(p, f.length / 2 + 0.2, p.position.y);
        if (p.teamId !== restartTeam.id && dist(p.position, point) < 9.15) setPosition(p, f.length / 2 - ownDirection * 9.25, f.width / 2);
      });
      return;
    }
    if (type === "penalty") {
      var goalX = dir > 0 ? f.length : 0;
      active.forEach(function (p, index) {
        if (p.id === taker.id) return;
        if (p.isGoalkeeper && p.teamId === other.id) { setPosition(p, goalX + (goalX === f.length ? -0.03 : 0.03), f.width / 2); return; }
        var spread = active.length <= 1 ? 0 : (index / (active.length - 1) - 0.5) * (f.width - 12);
        setPosition(p, point.x - dir * 10.2, clamp(f.width / 2 + spread, 5, f.width - 5));
      });
      return;
    }
    if (["direct-free-kick", "indirect-free-kick", "corner", "throw-in"].indexOf(type) < 0) {
      if (type === "goal-kick") {
        active.forEach(function (p) {
          if (p.teamId !== other.id) return;
          // Opponents must stay outside the restart taker's penalty area until
          // the goal kick is in play. Only move a player who is actually inside
          // that area; elsewhere on the pitch their legal tactical position
          // must survive the restart. Exit through the nearest edge so the
          // correction does not drag the opposition back toward its own goal.
          var ownGoalX = dir > 0 ? 0 : f.length;
          var depth = dir > 0 ? p.position.x : f.length - p.position.x;
          var lateral = p.position.y - f.width / 2;
          if (depth > 16.5 + 1e-6 || Math.abs(lateral) > 20.16 + 1e-6) return;
          var exitByDepth = 16.55 - depth, exitByWidth = 20.21 - Math.abs(lateral);
          if (exitByDepth <= exitByWidth) {
            setPosition(p, ownGoalX + dir * 16.55, clamp(p.position.y, 2, f.width - 2));
          } else {
            var side = lateral < 0 ? -1 : 1;
            setPosition(p, clamp(p.position.x, 1, f.length - 1), f.width / 2 + side * 20.21);
          }
        });
      }
      return;
    }
    var minimum = type === "throw-in" ? 2 : 9.15;
    var opponents = active.filter(function (p) { return p.teamId !== restartTeam.id; });
    var wall = [];
    if (type === "direct-free-kick" || type === "indirect-free-kick") {
      wall = opponents.filter(function (p) { return !p.isGoalkeeper; }).sort(function (a, b) { return dist(a.position, point) - dist(b.position, point); }).slice(0, 3);
    }
    opponents.forEach(function (p, index) {
      if (wall.indexOf(p) >= 0) {
        var wallIndex = wall.indexOf(p) - (wall.length - 1) / 2;
        setPosition(p, clamp(point.x + dir * 9.25, 0.5, f.length - 0.5), clamp(point.y + wallIndex * 0.75, 0.5, f.width - 0.5));
        return;
      }
      var dx = p.position.x - point.x, dy = p.position.y - point.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d >= minimum) return;
      if (d < 0.001) { dx = -dir; dy = index % 2 ? 1 : -1; d = Math.sqrt(dx * dx + dy * dy); }
      var x = point.x + dx / d * (minimum + 0.1), y = point.y + dy / d * (minimum + 0.1);
      x = clamp(x, 0.02, f.length - 0.02); y = clamp(y, 0.02, f.width - 0.02);
      // A player close to their own goal may form the wall on the goal line.
      if (Math.sqrt((x - point.x) * (x - point.x) + (y - point.y) * (y - point.y)) < minimum && type !== "throw-in") {
        var defender = team(m, p.teamId), defendedGoal = defender && defender.attackDirection > 0 ? 0 : f.length;
        if (Math.abs(point.x - defendedGoal) < minimum) {
          x = defendedGoal === 0 ? 0.02 : f.length - 0.02;
          var goalHalf = (f.goalWidth || 7.32) / 2;
          y = clamp(f.width / 2 + (index - opponents.length / 2) * 0.7, f.width / 2 - goalHalf, f.width / 2 + goalHalf);
        }
      }
      setPosition(p, x, y);
    });
    if (wall.length >= 3) {
      var attackers = active.filter(function (p) { return p.teamId === restartTeam.id && p.id !== taker.id; });
      attackers.forEach(function (p) {
        for (var j = 0; j < wall.length; j++) {
          if (dist(p.position, wall[j].position) < 1.05) setPosition(p, clamp(wall[j].position.x - dir * 1.1, 0.2, f.length - 0.2), clamp(wall[j].position.y + (p.position.y < point.y ? -1.1 : 1.1), 0.2, f.width - 0.2));
        }
      });
    }
  }
  function sweptCrossing(a, b, edge) { if ((a - edge) * (b - edge) > 0 || a === b) return null; return clamp((edge - a) / (b - a), 0, 1); }
  function boundaries(m) {
    var b = m.ball, f = field(m), r = Number(b.radius) || 0.11, p = b.position, old = b.previousPosition || p;
    var xGoal = p.x < -r ? 0 : p.x > f.length + r ? f.length : null;
    if (xGoal != null) {
      var t = sweptCrossing(old.x, p.x, xGoal), y = t == null ? p.y : old.y + (p.y - old.y) * t, z = t == null ? p.z : old.z + (p.z - old.z) * t;
      var half = (f.goalWidth || 7.32) / 2, scoring = Math.abs(y - f.width / 2) <= half - r && z + r <= (f.goalHeight || 2.44);
      if (scoring) {
        var attackDirection = xGoal === f.length ? 1 : -1, attacking = m.teams.find(function (t2) { return t2.attackDirection === attackDirection; });
        var restartKick = b.offsideKick && b.offsideKick.kickerId === b.lastTouchPlayerId && b.offsideKick.tick === b.lastTouchTick ? b._lastRestartTouchType : null;
        if (m.state.rules && m.state.rules.dropBallActive) {
          if (attacking && b.lastTouchTeamId === attacking.id) restart(m, "goal-kick", opponent(m, attacking.id).id, { x: xGoal === f.length ? f.length - 5.5 : 5.5, y: f.width / 2 }, "dropped-ball-two-players");
          else restart(m, "corner", attacking && attacking.id, { x: xGoal, y: y < f.width / 2 ? 0 : f.width }, "dropped-ball-two-players");
          return true;
        }
        var directOwnGoal = restartKick && b.lastTouchTeamId !== (attacking && attacking.id);
        if (directOwnGoal) { var cornerTeam = team(m, b.lastTouchTeamId); restart(m, "corner", cornerTeam && opponent(m, cornerTeam.id).id, { x: xGoal, y: y < f.width / 2 ? 0 : f.width }, "own-goal-from-restart"); return true; }
        if (restartKick === "indirect-free-kick" || restartKick === "throw-in" || restartKick === "dropped-ball") {
          restart(m, "goal-kick", attacking && opponent(m, attacking.id).id, { x: xGoal === f.length ? f.length - 5.5 : 5.5, y: f.width / 2 }, "direct-goal-prohibited"); return true;
        }
        if (attacking) goalAward(m, attacking.id); return true;
      }
      var endDefender = m.teams.find(function (t3) { return t3.attackDirection === (xGoal === f.length ? -1 : 1); });
      var lastTeam = b.lastTouchTeamId, restartTeam = opponent(m, lastTeam);
      if (!lastTeam) restartTeam = m.teams[0];
      // Goal kicks and corners are decided by the last touch anywhere over the goal line.
      var type = lastTeam === (endDefender && endDefender.id) ? "corner" : "goal-kick";
      if (type === "goal-kick") restartTeam = endDefender; else restartTeam = opponent(m, endDefender && endDefender.id);
      restart(m, type, restartTeam && restartTeam.id, type === "corner" ? { x: xGoal === f.length ? f.length : 0, y: y < f.width / 2 ? 0 : f.width } : { x: xGoal === f.length ? f.length - 5.5 : 5.5, y: f.width / 2 }, "goal-line");
      return true;
    }
    if (p.y < -r || p.y > f.width + r) {
      var edge = p.y < 0 ? 0 : f.width, t2 = sweptCrossing(old.y, p.y, edge), x = t2 == null ? p.x : old.x + (p.x - old.x) * t2;
      var defendingTeam = b.lastTouchTeamId, awarding = opponent(m, defendingTeam);
      restart(m, "throw-in", awarding && awarding.id, { x: clamp(x, 0, f.length), y: edge }, "touchline"); return true;
    }
    return false;
  }
  function offsideAtTouch(m, p) {
    var phase = m.ball.offsideKick;
    if (!phase || phase.exempt || phase.teamId !== p.teamId || phase.tick === m.tick && phase.kickerId === p.id) return null;
    var candidate = (phase.candidates || []).find(function (c) { return c.playerId === p.id; });
    return candidate && candidate.offside ? phase : null;
  }
  function offsideCheck(m) {
    var b = m.ball, p = player(m, b.lastTouchPlayerId), phase = b.offsideKick;
    if (!phase || !p || b.lastTouchTick === m.state._offsideCheckedTouchTick) return;
    m.state._offsideCheckedTouchTick = b.lastTouchTick;
    if (p.teamId === phase.teamId) {
      if (p.id === phase.kickerId) return;
      var c = offsideAtTouch(m, p);
      if (c) { event(m, "offside", { playerId: p.id, teamId: p.teamId, kickerId: phase.kickerId, line: phase.line, restart: "indirect-free-kick" }); restart(m, "indirect-free-kick", opponent(m, p.teamId).id, { x: p.position.x, y: p.position.y }, "offside"); return; }
    } else if (["control", "deliberate"].indexOf(b.lastTouchKind) >= 0) {
      // A defender's deliberate play resets offside; a save or deflection does not.
      b.offsideKick = null;
    }
  }
  function passiveOffsideCheck(m) {
    var b = m.ball, phase = b.offsideKick;
    if (!phase || phase.exempt || m.state.phase !== "open-play" || b.lastTouchTeamId !== phase.teamId) return;
    var candidates = phase.candidates || [], opposing = m.players.filter(function (p) { return p.active && p.teamId !== phase.teamId; });
    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i]; if (!candidate.offside) continue;
      var p = player(m, candidate.playerId); if (!p || !p.active) continue;
      var ballDistance = dist(p.position, b.position), challenging = false, defender = null, defenderDistance = Infinity;
      if (ballDistance < 2.25) opposing.forEach(function (o) { var d = dist(o.position, p.position); if (d < defenderDistance) { defender = o; defenderDistance = d; } });
      if (defender && defenderDistance < 1.35 && dist(defender.position, b.position) < 3.2) challenging = true;
      // An offside attacker in the keeper's view of a shot is interfering with an opponent.
      var screenedKeeper = null, screened = false;
      if (b._lastShotId && Math.abs(b.velocity.x) > 3) {
        opposing.forEach(function (o) {
          if (!o.isGoalkeeper) return;
          var sx = o.position.x - b.position.x, sy = o.position.y - b.position.y, seg = sx * sx + sy * sy || 1;
          var t = ((p.position.x - b.position.x) * sx + (p.position.y - b.position.y) * sy) / seg;
          if (t > 0.12 && t < 0.96) { var q = { x: b.position.x + sx * t, y: b.position.y + sy * t }; if (dist(q, p.position) < 0.8) { screened = true; screenedKeeper = o; } }
        });
      }
      if (challenging || screened) {
        event(m, "offside", { playerId: p.id, teamId: p.teamId, kickerId: phase.kickerId, line: phase.line, involvement: challenging ? "challenge" : "screen", opponentId: challenging ? defender.id : screenedKeeper.id, restart: "indirect-free-kick" });
        restart(m, "indirect-free-kick", opponent(m, p.teamId).id, { x: p.position.x, y: p.position.y }, "offside-involvement"); return true;
      }
    }
    return false;
  }
  function awardFoul(m, contact) {
    var offender = player(m, contact.offenderId), victim = player(m, contact.victimId); if (!offender || !victim) return;
    // A same-team collision or stale challenge intent is not a Laws foul and
    // must never award the victim's side a restart or card.
    if (offender.teamId === victim.teamId) return;
    var point = contact.point || offender.position, pen = insidePenalty(m, point, offender.teamId) && !contact.indirect, restartType = pen ? "penalty" : (contact.indirect ? "indirect-free-kick" : "direct-free-kick");
    var severity = clamp(Number(contact.severity) || 0.2, 0, 1), tactical = Number(contact.deniedOpportunity) || 0;
    var serious = contact.seriousFoulPlay === true || contact.violentConduct === true;
    var dogso = contact.deniedGoalScoringOpportunity === true || tactical > 0.9;
    var card = serious ? "red" : contact.reckless === true || severity >= 0.58 || contact.stoppedPromisingAttack === true || tactical > 0.65 ? "yellow" : null;
    if (dogso && !serious) card = pen && contact.ballPlayed ? "yellow" : "red";
    // Persistent offences are judged from the offender's recent pattern, not
    // an arbitrary incident count. Minor infringements add weighted pressure;
    // the pressure fades with time and a caution resets the warning history.
    // This is an explicit referee heuristic, since the Laws prescribe no fixed
    // number of fouls that automatically merits a caution.
    var ruleState = m.state.rules || (m.state.rules = {}), now = Number(m.clock.elapsedSeconds) || 0;
    var offenseMap = ruleState.persistentOffenses || (ruleState.persistentOffenses = {});
    var history = (offenseMap[offender.id] || []).filter(function (item) { return now - item.time <= 600 && now >= item.time; });
    var persistentScore = history.reduce(function (sum, item) {
      return sum + Math.exp(-(now - item.time) / 240) * clamp((Number(item.severity) - 0.05) / 0.45, 0.1, 1.25);
    }, 0) + clamp((severity - 0.05) / 0.45, 0.1, 1.25);
    var persistentCaution = !card && persistentScore >= 1.75;
    if (persistentCaution) card = "yellow";
    if (card) offenseMap[offender.id] = [];
    else offenseMap[offender.id] = history.concat([{ time: now, severity: severity, victimId: victim.id }]);
    var cardCause = persistentCaution ? "persistent-offenses" : "foul";
    var advantage = m.state.possessionTeamId === victim.teamId && dist(m.ball.position, victim.position) < 13 && severity < 0.85;
    if (advantage) {
      var nearby = m.players.filter(function (p) { return p.active && dist(p.position, point) <= 9; }).map(function (p) { return { id: p.id, position: { x: p.position.x, y: p.position.y }, velocity: { x: p.velocity.x, y: p.velocity.y } }; });
      m.state.advantage = { teamId: victim.teamId, offenderId: offender.id, victimId: victim.id, point: { x: point.x, y: point.y }, restartType: restartType, card: card, cardCause: cardCause, persistentScore: persistentScore, started: m.clock.elapsedSeconds, deadline: m.clock.elapsedSeconds + config(m).advantageSeconds, ballPosition: { x: m.ball.position.x, y: m.ball.position.y }, ballVelocity: { x: m.ball.velocity.x, y: m.ball.velocity.y, z: m.ball.velocity.z }, nearby: nearby };
      event(m, "advantage", { teamId: victim.teamId, offenderId: offender.id, victimId: victim.id, severity: severity, card: card, persistentCaution: persistentCaution, persistentScore: Number(persistentScore.toFixed(3)), restartType: restartType });
      if (m.referee) m.referee.signal = "advantage";
    } else { event(m, "foul", { teamId: victim.teamId, offenderId: offender.id, victimId: victim.id, point: point, severity: severity, card: card, persistentCaution: persistentCaution, persistentScore: Number(persistentScore.toFixed(3)), restartType: restartType }); if (card) administerCard(m, offender, card, cardCause); restart(m, restartType, victim.teamId, point, "foul"); }
    if (m.referee) m.referee.signal = advantage ? "advantage" : "foul";
  }
  function administerCard(m, p, card, cause) {
    p.cards = p.cards || { yellow: 0, red: 0 };
    if (card === "yellow") { p.cards.yellow += 1; if (p.cards.yellow >= 2) card = "red"; }
    if (card === "red") { p.cards.red += 1; p.active = false; p.sentOff = true; if (p.team && p.team.activePlayers) p.team.activePlayers = p.team.activePlayers.filter(function (q) { return q.id !== p.id; }); }
    event(m, "card", { playerId: p.id, teamId: p.teamId, card: card, cause: cause, yellowCount: p.cards.yellow, redCount: p.cards.red });
  }
  function handleContacts(m) {
    // Contact/foul events cannot cancel a restart that has not yet been
    // physically released. Readiness is dead-ball time, even though the world
    // continues ticking players into their legal positions.
    if (m.state.restartInProgress) { m.state._contactEventCursor = m.events.length; return; }
    var start = Number(m.state._contactEventCursor) || 0;
    for (var i = start; i < m.events.length; i++) { var e = m.events[i]; if (e.type !== "contact" || e.tick !== m.tick) continue; var offender = player(m, e.offenderId); if (!offender) continue; var foulChance = clamp(Number(e.severity) * 0.86 + (e.reckless ? 0.18 : 0) - (e.ballPlayed ? 0.2 : 0), 0.03, 0.95); var rng = offender.rng && offender.rng.next ? offender.rng.next() : 0.5; if (rng < foulChance) awardFoul(m, e); }
    m.state._contactEventCursor = m.events.length;
  }
  function advantageUpdate(m) {
    var a = m.state.advantage; if (!a) return;
    var attacking = m.ball.ownerId && player(m, m.ball.ownerId), hasAdvantage = attacking && attacking.teamId === a.teamId;
    var advanced = (m.ball.position.x - a.ballPosition.x) * ((team(m, a.teamId) || {}).attackDirection || 1) > 2.5;
    if (hasAdvantage && (advanced || m.clock.elapsedSeconds - a.started > 2.2)) {
      if (a.card) m.state.advantageCardPending = { offenderId: a.offenderId, card: a.card, cause: a.cardCause || "advantage-foul" };
      event(m, "advantage-played", { teamId: a.teamId, offenderId: a.offenderId, victimId: a.victimId, cardPending: !!a.card });
      m.state.advantage = null; if (m.referee) m.referee.signal = "play-on"; return;
    }
    if (!hasAdvantage && m.clock.elapsedSeconds >= a.started + 0.35 || m.clock.elapsedSeconds >= a.deadline) {
      event(m, "advantage-recalled", { teamId: a.teamId, offenderId: a.offenderId, victimId: a.victimId, kept: !!a.kept });
      var offender = player(m, a.offenderId); if (a.card && offender) administerCard(m, offender, a.card, a.cardCause || "advantage-foul");
      (a.nearby || []).forEach(function (saved) { var p = player(m, saved.id); if (p && p.active) { setPosition(p, saved.position.x, saved.position.y); p.velocity.x = saved.velocity.x; p.velocity.y = saved.velocity.y; } });
      restart(m, a.restartType, a.teamId, a.point, "advantage-recalled"); m.state.advantage = null;
    }
  }
  function processBoundaries(m) { if (m.state.phase === "open-play") boundaries(m); }
  function setupRestart(m) {
    if (m.state.phase !== "dead-ball") return;
    var now = m.clock.elapsedSeconds, type = m.state.restartType, f = field(m), point = m.state.restartPoint || { x: f.length / 2, y: f.width / 2 }, waiting = config(m).autoRestartSeconds;
    if (!m.state.restartStarted) m.state.restartStarted = now;
    // Place ball and let each team recover its shape during the pause.
    if (type === "kickoff") { point = { x: f.length / 2, y: f.width / 2 }; m.ball.position.x = point.x; m.ball.position.y = point.y; }
    if (now - m.state.restartStarted < waiting) return;
    var restartTeam = team(m, m.state.restartTeamId) || m.teams[0];
    if (!restartTeam) return;
    if (type === "dropped-ball") {
      var dropTaker = restartTeam.activePlayers.filter(function (p) { return p.active; }).sort(function (a, b) { return dist(a.position, point) - dist(b.position, point); })[0];
      if (dropTaker) setPosition(dropTaker, point.x, point.y);
      m.ball.position.x = point.x; m.ball.position.y = point.y; m.ball.position.z = 1.05; m.ball.velocity.x = m.ball.velocity.y = m.ball.velocity.z = 0;
      m.ball.ownerId = null; m.ball.handControl = false; m.ball.controlState = "dropped"; m.ball._lastRestartType = "dropped-ball";
      m.state.rules.dropBallPlayers = []; m.state.rules.dropBallLastTouchTick = m.ball.lastTouchTick; m.state.rules.dropBallActive = true;
      m.state.phase = "open-play"; m.state.possessionTeamId = null; m.state.restartType = null; m.state.restartStarted = null;
      event(m, "restart-taken", { restartType: type, teamId: restartTeam.id, takerId: dropTaker && dropTaker.id || null, point: point }); return;
    }
    var taker = restartTeam.activePlayers.filter(function (p) { return p.active; }).sort(function (a, b) { return dist(a.position, point) - dist(b.position, point); })[0];
    if (type === "penalty") {
      var defending = opponent(m, restartTeam.id), atkDir = restartTeam.attackDirection || 1;
      point = { x: (atkDir > 0 ? f.length - 11 : 11), y: f.width / 2 };
      m.ball.position.x = point.x; m.ball.position.y = point.y;
      taker = restartTeam.activePlayers.filter(function (p) { return p.active && !p.isGoalkeeper; }).sort(function (a, b) { return Number(b.attributes.finishing || 50) - Number(a.attributes.finishing || 50); })[0];
      if (defending) defending.activePlayers.forEach(function (p) { if (p.isGoalkeeper) setPosition(p, atkDir > 0 ? f.length - 0.03 : 0.03, f.width / 2); });
    }
    if (!taker) return;
    positionRestartPlayers(m, type, taker, restartTeam, point);
    if (type === "kickoff") setPosition(taker, point.x - (restartTeam.attackDirection || 1) * 0.35, point.y);
    else if (type === "corner") {
      var cornerKickX = point.x <= f.length / 2 ? 1 : -1;
      var cornerKickY = point.y <= f.width / 2 ? 1 : -1;
      setPosition(taker, point.x - cornerKickX * 0.55, point.y - cornerKickY * 0.55);
    }
    else if (type === "throw-in") setPosition(taker, point.x, point.y);
    // Keep the designated kicker behind the ball so the controlled restart
    // starts at a real foot-contact geometry rather than an overlapping
    // player/ball origin that can never satisfy the motor's kick path.
    else if (type === "goal-kick") setPosition(taker, clamp(point.x - (restartTeam.attackDirection || 1) * 0.55, 0.2, f.length - 0.2), point.y);
    else if (type === "direct-free-kick" || type === "indirect-free-kick") setPosition(taker, clamp(point.x - (restartTeam.attackDirection || 1) * 0.55, 0.2, f.length - 0.2), point.y);
    else if (type === "penalty") setPosition(taker, point.x - (restartTeam.attackDirection || 1) * 0.25, point.y);
    m.ball.ownerId = taker.id; m.ball.controlState = type === "throw-in" ? "throw-in-held" : "controlled"; m.ball.handControl = type === "throw-in"; m.ball.position.z = type === "throw-in" ? 1.85 : 0.11; m.ball._offsideExemptNextTouch = ["goal-kick", "throw-in", "corner"].indexOf(type) >= 0; m.ball._lastRestartType = type; m.state.phase = "open-play"; m.state.possessionTeamId = restartTeam.id;
    m.state.restartSecondTouch = null;
    m.state.restartReleaseThisTick = null;
    m.state.restartInProgress = { type: type, teamId: restartTeam.id, takerId: taker.id, point: { x: point.x, y: point.y } };
    m.state.restartType = null; m.state.offsidePhase = null; m.state.advantage = null; m.state.restartStarted = null;
    var intent = taker.motor || taker.intent;
    if (intent) { intent._physicsDone = false; intent.committed = false; }
    event(m, "restart-ready", { restartType: type, teamId: restartTeam.id, takerId: taker.id, point: point, restartSequence: m.state.restartSequence || 0 });
  }
  function enforceRestartReady(m) {
    var r = m.state.restartInProgress;
    if (!r) return;
    var b = m.ball;
    var release = m.state.restartReleaseThisTick;
    if (release && release.awaitingFieldEntry) return;
    var taker = player(m, r.takerId), restartTeam = team(m, r.teamId);
    if (!taker || !restartTeam || !taker.active || taker.teamId !== r.teamId) {
      // The restart cannot become live without its designated active taker.
      // Keep the mark and pending state so a corrected lineup can resolve it.
      return;
    }
    // A control/carry touch is not a restart kick. Keep the ball dead and
    // return it to the mark until the designated taker physically releases it.
    b.ownerId = taker.id; b.handControl = r.type === "throw-in"; b.controlState = r.type === "throw-in" ? "throw-in-held" : "controlled";
    b.velocity.x = b.velocity.y = b.velocity.z = 0;
    if (taker && restartTeam) positionRestartPlayers(m, r.type, taker, restartTeam, r.point);
    // Setup establishes the original stance once. While a foot restart is
    // pending, the designated taker may then move under the ordinary motor
    // toward the target-aligned approach point computed by physics. Throwers
    // remain fixed on the touchline with the ball in their hands.
    if (taker && r.type === "throw-in") setPosition(taker, r.point.x, r.point.y);
    b.position.x = b.previousPosition.x = r.point.x;
    b.position.y = b.previousPosition.y = r.point.y;
    b.position.z = b.previousPosition.z = r.type === "throw-in" ? 1.85 : 0.11;
    b.lastTouchPlayerId = null; b.lastTouchTeamId = null; b.lastTouchKind = "restart";
    b._lastRestartType = r.type; b._lastRestartTouchType = null;
  }
  function enforceRestartSecondTouch(m) {
    var marker = m.state.restartSecondTouch;
    if (!marker || marker.secondTouchTick == null || marker.secondTouchTick !== m.tick) return;
    var offender = player(m, marker.takerId);
    event(m, "restart-second-touch", { restartType: marker.type, playerId: marker.takerId, teamId: marker.teamId, restart: "indirect-free-kick" });
    m.state.restartSecondTouch = null;
    restart(m, "indirect-free-kick", opponent(m, marker.teamId).id, { x: m.ball.position.x, y: m.ball.position.y }, "restart-second-touch");
    if (offender && m.referee) m.referee.signal = "indirect-free-kick";
  }
  TF.confirmRestartPhysicalRelease = function (m, takerId, kind, enteredField) {
    var r = m && m.state && m.state.restartInProgress;
    if (!r || r.takerId !== takerId) return false;
    var validKind = r.type === "throw-in" ? kind === "throw" && enteredField === true
      : r.type === "penalty" ? kind === "shoot" : ["pass", "throughBall", "shoot", "clear"].indexOf(kind) >= 0;
    if (!validKind) return false;
    var taker = player(m, takerId);
    if (!taker || !taker.active || taker.teamId !== r.teamId) return false;
    m.state.restartSecondTouch = { type: r.type, teamId: r.teamId, takerId: r.takerId, kickTick: m.tick, secondTouchTick: null, secondTouchKind: null };
    m.state.restartReleaseThisTick = { type: r.type, teamId: r.teamId, takerId: r.takerId,
      point: { x: r.point.x, y: r.point.y }, kickTick: m.tick, secondTouchTick: null, secondTouchKind: null,
      interveningTouch: false, awaitingFieldEntry: false };
    m.state.restartInProgress = null;
    event(m, "restart-taken", { restartType: r.type, teamId: r.teamId, takerId: r.takerId,
      point: r.point, restartSequence: m.state.restartSequence || 0 });
    return true;
  };
  TF.retakeUnenteredThrow = function (m, release) {
    var r = m && m.state && m.state.restartInProgress;
    if (!r || !release || !release.awaitingFieldEntry || r.type !== "throw-in"
      || r.takerId !== release.takerId || r.teamId !== release.teamId) return false;
    var point = { x: r.point.x, y: r.point.y }, teamId = r.teamId;
    restart(m, "throw-in", teamId, point, "throw-did-not-enter");
    return true;
  };
  function keeperRestrictions(m) {
    var b = m.ball, keeper = b.ownerId && player(m, b.ownerId); if (!keeper || !keeper.isGoalkeeper || !b.handControl) { if (b._handStarted != null && !b.handControl) b._handStarted = null; return; }
    var elapsed = m.clock.elapsedSeconds - (b._handStarted || m.clock.elapsedSeconds);
    if (elapsed > 8) {
      var f = field(m), dir = keeper.team && keeper.team.attackDirection || 1, cornerY = keeper.position.y < f.width / 2 ? 0 : f.width;
      var corner = opponent(m, keeper.teamId);
      event(m, "goalkeeper-eight-second", { keeperId: keeper.id, teamId: keeper.teamId, heldSeconds: elapsed, restartType: "corner" });
      restart(m, "corner", corner && corner.id, { x: dir > 0 ? 0 : f.length, y: cornerY }, "goalkeeper-eight-second");
    }
    // A goalkeeper who releases a hand-held ball may not handle it again until
    // another player has touched it. The physics collector records the touch
    // that immediately preceded each catch, so a self-release is distinguishable
    // from a teammate backpass or a new opponent touch.
    var handlingRestriction = b._keeperHandlingRestriction;
    if (handlingRestriction && handlingRestriction.teamId === keeper.teamId
      && handlingRestriction.keeperId === keeper.id && handlingRestriction.sourcePlayerId === keeper.id
      && b._keeperHandlingPlayerId === keeper.id) {
      event(m, "goalkeeper-second-handling", { keeperId: keeper.id, teamId: keeper.teamId, restartType: "indirect-free-kick" });
      restart(m, "indirect-free-kick", opponent(m, keeper.teamId).id, { x: keeper.position.x, y: keeper.position.y }, "goalkeeper-second-handling");
      return;
    }
    // Law 12 restrictions use physical action and recipient provenance. A
    // header is not a deliberate kick, and a teammate foot pass is restricted
    // only when addressed to this keeper. A direct teammate throw-in remains
    // restricted until another player touches the ball.
    var sameTeamSource = handlingRestriction && handlingRestriction.teamId === keeper.teamId
      && handlingRestriction.sourcePlayerId !== keeper.id;
    var footKickToKeeper = sameTeamSource && handlingRestriction.keeperId === keeper.id
      && handlingRestriction.targetId === keeper.id
      && ["pass", "throughBall", "clear", "shoot"].indexOf(handlingRestriction.action) >= 0;
    var directTeammateThrowIn = sameTeamSource && handlingRestriction.action === "throw-in";
    var illegalBackpass = (footKickToKeeper || directTeammateThrowIn) && b._keeperHandlingPlayerId === keeper.id;
    if (illegalBackpass) {
      event(m, "goalkeeper-backpass-handball", { keeperId: keeper.id, teamId: keeper.teamId, restartType: "indirect-free-kick" });
      restart(m, "indirect-free-kick", opponent(m, keeper.teamId).id, { x: keeper.position.x, y: keeper.position.y }, "goalkeeper-backpass");
    }
  }
  function referee(m, dt) {
    var r = m.referee, b = m.ball; if (!r || !b || m.state.phase === "dead-ball") return;
    var f = field(m), target = { x: clamp(b.position.x + (b.velocity.x || 0) * 0.65, 2, f.length - 2), y: clamp(b.position.y + (b.velocity.y || 0) * 0.5, 2, f.width - 2) };
    target.y = clamp(target.y + (b.position.y < f.width / 2 ? 5 : -5), 2, f.width - 2);
    r.position = r.position || { x: f.length / 2, y: f.width / 2, z: 0 }; r.velocity = r.velocity || { x: 0, y: 0 };
    var dx = target.x - r.position.x, dy = target.y - r.position.y, d = Math.sqrt(dx * dx + dy * dy), speed = Math.min(6, d * 1.8);
    if (d > 0.1) { r.velocity.x = dx / d * speed; r.velocity.y = dy / d * speed; r.position.x = clamp(r.position.x + r.velocity.x * dt, 0, f.length); r.position.y = clamp(r.position.y + r.velocity.y * dt, 0, f.width); }
    r.facing = d > 0 ? { x: dx / d, y: dy / d } : r.facing;
  }
  function substitutions(m) {
    var c = config(m), queues = m.substitutionRequests || [];
    var halftime = m.state.halfTime || m.state.phase === "half-time";
    serviceDelayedSubstitutions(m);
    for (var i = 0; i < m.teams.length; i++) {
      var t = m.teams[i], tally = t.substitutionState || (t.substitutionState = { used: 0, windows: 0, usedThisStoppage: false });
      var request = queues.find(function (q) { return q.teamId === t.id; }); if (!request) continue;
      var outgoing = player(m, request.playerId), incoming = player(m, request.substituteId);
      if (!outgoing || !incoming || outgoing.teamId !== t.id || incoming.teamId !== t.id || outgoing.active !== true || incoming.active === true || (!c.allowReturnSubstitutions && incoming.substitutedOff) || tally.used >= c.substitutes || (m.state.phase === "open-play") || t.activePlayers.length < c.minPlayers) continue;
      var windows = m.state.period === 1 ? "first" : "second";
      if (tally._periodWindow !== windows) { tally._periodWindow = windows; }
      var delayed = Number(request.exitSeconds || request.actualExitSeconds || 0) > 10;
      if (!halftime && !tally.usedThisStoppage) { if (tally.windows >= c.substitutionWindows) continue; tally.windows += 1; tally.usedThisStoppage = true; }
      if (delayed && t.activePlayers.filter(function (p) { return p.active; }).length <= c.minPlayers) continue;
      outgoing.active = false; incoming.position.x = outgoing.position.x; incoming.position.y = outgoing.position.y; incoming.previousPosition.x = incoming.position.x; incoming.previousPosition.y = incoming.position.y; incoming.velocity.x = incoming.velocity.y = 0;
      outgoing.substitutedOff = true;
      t.activePlayers = t.activePlayers.filter(function (p) { return p.active && p.id !== outgoing.id; });
      t.bench = (t.bench || []).filter(function (p) { return p.id !== incoming.id; });
      if (t.bench.indexOf(outgoing) < 0) t.bench.push(outgoing);
      tally.used += 1;
      if (delayed) {
        incoming.active = false;
        var delayedList = m.state.delayedSubstitutions || (m.state.delayedSubstitutions = []);
        delayedList.push({ teamId: t.id, playerOffId: outgoing.id, playerOnId: incoming.id, earliestTime: m.clock.elapsedSeconds + 60, restartSequence: Number(m.state.restartSequence) || 0 });
        if (request.excessiveDelay === true) administerCard(m, outgoing, "yellow", "substitution-delay");
      } else { incoming.active = true; if (t.activePlayers.indexOf(incoming) < 0) t.activePlayers.push(incoming); }
      queues.splice(queues.indexOf(request), 1); event(m, "substitution", { teamId: t.id, playerOffId: outgoing.id, playerOnId: incoming.id, used: tally.used, windows: tally.windows, delayedEntry: delayed }); break;
    }
    if (m.state.phase !== "dead-ball" && !halftime) m.teams.forEach(function (t) { if (t.substitutionState) t.substitutionState.usedThisStoppage = false; });
  }
  function serviceDelayedSubstitutions(m) {
    var queue = m.state.delayedSubstitutions || [];
    if (m.state.phase !== "dead-ball") return;
    for (var i = 0; i < queue.length; i++) {
      var q = queue[i], sub = player(m, q.playerOnId), t = team(m, q.teamId);
      if (!sub || !t || m.clock.elapsedSeconds < q.earliestTime || (Number(m.state.restartSequence) || 0) <= q.restartSequence) continue;
      sub.active = true; t.bench = (t.bench || []).filter(function (p) { return p.id !== sub.id; });
      if (t.activePlayers.indexOf(sub) < 0) t.activePlayers.push(sub);
      event(m, "substitute-entered", { teamId: t.id, playerOffId: q.playerOffId, playerOnId: sub.id }); queue.splice(i, 1); return;
    }
  }
  function trackDroppedBallTouches(m) {
    var b = m.ball, s = m.state.rules || (m.state.rules = {});
    if (!s.dropBallActive || !b.lastTouchPlayerId || b.lastTouchTick === s.dropBallLastTouchTick) return;
    s.dropBallLastTouchTick = b.lastTouchTick;
    var touches = s.dropBallPlayers || (s.dropBallPlayers = []);
    if (touches.indexOf(b.lastTouchPlayerId) < 0) touches.push(b.lastTouchPlayerId);
    if (touches.length >= 2) { s.dropBallActive = false; b._lastRestartTouchType = null; }
  }
  function timeManagement(m, dt) {
    var s = m.state.rules || (m.state.rules = {}), c = config(m), clock = m.clock;
    if (s.periodSetup !== clock.period) { s.periodSetup = clock.period; s.stoppageStart = null; s.stoppageSeconds = 0; s.periodStartTick = m.tick; }
    if (m.state.phase === "dead-ball") { if (s.stoppageStart == null) s.stoppageStart = clock.elapsedSeconds; }
    else if (s.stoppageStart != null) { s.stoppageSeconds += Math.max(0, clock.elapsedSeconds - s.stoppageStart); s.stoppageStart = null; }
    var added = c.addedTimeSeconds == null ? Math.min(180, Math.ceil(s.stoppageSeconds / 60) * 60) : Math.max(0, Number(c.addedTimeSeconds) || 0);
    clock.periodLimitSeconds = (Number(m.halfSeconds) || 2700) + added;
    s.addedTimeSeconds = added;
  }
  function belowMinimum(m) {
    var min = config(m).minPlayers;
    m.teams.forEach(function (t) { var count = t.activePlayers.filter(function (p) { return p.active; }).length; if (count < min && !m.state.finished) { m.state.finished = true; m.state.phase = "abandoned"; m.state.abandonedTeamId = t.id; event(m, "match-abandoned", { teamId: t.id, activePlayers: count, minimum: min }); } });
  }
  TF.updateRules = function (match, dt) {
    if (!match || !match.state || match.state.finished) return;
    if (match.state.halfTime || match.state.phase === "half-time") { substitutions(match); return; }
    var s = match.state.rules || (match.state.rules = {});
    if (!s.initialized) { s.initialized = true; s.lawVersion = config(match).version; s.offsideCheckedTouchTick = -1; match.clock.periodLimitSeconds = Number(match.halfSeconds) || 2700; }
    if (match.state.phase === "kickoff") {
      match.state.restartType = match.state.restartType || "kickoff";
      match.state.restartTeamId = match.state.restartTeamId || (match.teams[0] && match.teams[0].id);
      if (match.clock.period === 1 && !s.firstKickoffTeamId) s.firstKickoffTeamId = match.state.restartTeamId;
      if (match.clock.period === 2 && s.firstKickoffTeamId) match.state.restartTeamId = (opponent(match, s.firstKickoffTeamId) || match.teams[1]).id;
      match.state.phase = "dead-ball"; match.state.restartPoint = { x: field(match).length / 2, y: field(match).width / 2 }; match.state.restartStarted = match.clock.elapsedSeconds;
    }
    match.teams.forEach(function (t) { if (t.substitutionState) t.substitutionState.usedThisStoppage = match.state.phase === "dead-ball" ? t.substitutionState.usedThisStoppage : false; });
    handleContacts(match); advantageUpdate(match); keeperRestrictions(match);
    enforceRestartReady(match); enforceRestartSecondTouch(match);
    if (match.state.restartReleaseThisTick && !match.state.restartReleaseThisTick.awaitingFieldEntry
      && match.state.restartReleaseThisTick.kickTick <= match.tick) match.state.restartReleaseThisTick = null;
    if (match.state.phase === "dead-ball") setupRestart(match);
    var awaitingThrowEntry = match.state.restartReleaseThisTick && match.state.restartReleaseThisTick.awaitingFieldEntry;
    if (!awaitingThrowEntry) {
      trackDroppedBallTouches(match); passiveOffsideCheck(match); offsideCheck(match); processBoundaries(match);
    }
    substitutions(match); referee(match, Number(dt) || TF.FIXED_DT || 1 / 60); belowMinimum(match);
    timeManagement(match, Number(dt) || TF.FIXED_DT || 1 / 60);
  };
  if (typeof TF.registerCheckpointExtension === "function") TF.registerCheckpointExtension("rules", {
    capture: function (m) {
      return { state: { rules: JSON.parse(JSON.stringify(m.state.rules || {})), advantage: m.state.advantage && JSON.parse(JSON.stringify(m.state.advantage)), restartPoint: m.state.restartPoint && JSON.parse(JSON.stringify(m.state.restartPoint)), restartStarted: m.state.restartStarted, restartReason: m.state.restartReason, restartType: m.state.restartType, restartTeamId: m.state.restartTeamId, restartInProgress: m.state.restartInProgress && JSON.parse(JSON.stringify(m.state.restartInProgress)), restartSecondTouch: m.state.restartSecondTouch && JSON.parse(JSON.stringify(m.state.restartSecondTouch)), restartReleaseThisTick: m.state.restartReleaseThisTick && JSON.parse(JSON.stringify(m.state.restartReleaseThisTick)), phase: m.state.phase, _contactEventCursor: m.state._contactEventCursor, advantageCardPending: m.state.advantageCardPending && JSON.parse(JSON.stringify(m.state.advantageCardPending)) }, clock: { periodLimitSeconds: m.clock.periodLimitSeconds }, teams: (m.teams || []).map(function (t) { return { id: t.id, substitutionState: t.substitutionState && JSON.parse(JSON.stringify(t.substitutionState)) }; }), players: (m.players || []).map(function (p) { return { id: p.id, cards: p.cards && JSON.parse(JSON.stringify(p.cards)), sentOff: p.sentOff }; }) };
    },
    restore: function (m, saved) {
      if (!saved) return; var s = saved.state || {}; ["rules", "advantage", "restartPoint", "restartStarted", "restartReason", "restartType", "restartTeamId", "restartInProgress", "restartSecondTouch", "restartReleaseThisTick", "phase", "_contactEventCursor", "advantageCardPending"].forEach(function (k) { if (s[k] !== undefined) m.state[k] = s[k]; });
      if (saved.clock) m.clock.periodLimitSeconds = saved.clock.periodLimitSeconds;
      (saved.teams || []).forEach(function (x) { var t = team(m, x.id); if (t && x.substitutionState) t.substitutionState = x.substitutionState; });
      (saved.players || []).forEach(function (x) { var p = player(m, x.id); if (p) { if (x.cards) p.cards = x.cards; p.sentOff = x.sentOff; } });
    }
  });
  TF.rulesLab = {
    positionAtPlay: function (match, kicker, kind) {
      var i = kicker && (kicker.motor || kicker.intent) || {}, b = match.ball;
      if (!kicker) throw new TypeError("A kicker is required");
      if (typeof TF.physicsHelpers === "object") TF.physicsHelpers.emitKickSnapshot(match, kicker, i, kind || "pass");
      return b.offsideKick;
    },
    checkOffsideInvolvement: function (match, receiver) { return !!offsideAtTouch(match, receiver); },
    awardRestart: function (match, type, teamId, point, reason) { restart(match, type, teamId, point, reason); return match.state; },
    awardFoul: function (match, contact) { awardFoul(match, contact); return match.state; },
    inspectBoundaries: function (match) { return boundaries(match); },
    requestSubstitution: function (match, request) {
      if (!match || !request || !request.teamId || !request.playerId || !request.substituteId) throw new TypeError("A team, outgoing player, and substitute are required");
      match.substitutionRequests = match.substitutionRequests || []; match.substitutionRequests.push(Object.assign({}, request));
      if (match.state.halfTime || match.state.phase === "half-time") substitutions(match);
      return match.substitutionRequests;
    },
    configure: function (match, options) { match.rulesConfig = Object.assign({}, match.rulesConfig || {}, options || {}); match.state.rules = match.state.rules || {}; match.state.rules.initialized = false; return match.rulesConfig; }
  };
})(typeof window !== "undefined" ? window : globalThis);
