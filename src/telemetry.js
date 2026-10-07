(function (root) {
  "use strict";
  var TF = root.TF = root.TF || {};
  var MAX_DECISIONS = 160, MAX_EVENTS = 256, MAX_AUDIT = 120;
  var EVENT_TYPES = ["passAttempt", "passComplete", "progressivePass", "lineBreak", "throughBall", "carry", "dribble", "runStarted", "runReceived", "pressStarted", "pressSuccess", "pressBypassed", "interception", "tackle", "shot", "save", "goal", "foul", "offside", "turnover", "finalThirdEntry", "boxEntry", "corner", "possessionSeconds", "xG", "repetitiveCirculation", "needlessRetreat", "passLoop", "defensiveError", "yellowCards", "redCards", "possessionCount", "possessionDurationSeconds", "passChainPasses"];
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function distance(a, b) { var x = a.x - b.x, y = a.y - b.y; return Math.sqrt(x * x + y * y); }
  function init(match) {
    if (!match.telemetry || typeof match.telemetry !== "object") match.telemetry = {};
    var t = match.telemetry;
    // Preserve the compact legacy counters consumed directly by world,
    // physics, and UI code when reset() rebuilds this object from scratch.
    if (!Array.isArray(t.goals)) t.goals = [];
    if (!Number.isFinite(t.passes)) t.passes = 0;
    if (!Number.isFinite(t.shots)) t.shots = 0;
    if (!Number.isFinite(t.turnovers)) t.turnovers = 0;
    if (!t.teams) t.teams = {};
    (match.teams || []).forEach(function (team) {
      if (!t.teams[team.id]) { t.teams[team.id] = { teamId: team.id, counters: {}, xG: 0, possessionSeconds: 0, passes: 0, completedPasses: 0, shots: 0, goals: 0, cards: { yellow: 0, red: 0 }, defensiveErrors: 0, goalsByAttackType: {}, passChainHistogram: {}, possessionDurationHistogram: {} }; }
      t.teams[team.id].cards = t.teams[team.id].cards || { yellow: 0, red: 0 };
      t.teams[team.id].goalsByAttackType = t.teams[team.id].goalsByAttackType || {};
      t.teams[team.id].passChainHistogram = t.teams[team.id].passChainHistogram || {};
      t.teams[team.id].possessionDurationHistogram = t.teams[team.id].possessionDurationHistogram || {};
      EVENT_TYPES.forEach(function (key) { if (!Number.isFinite(t.teams[team.id].counters[key])) t.teams[team.id].counters[key] = 0; });
    });
    if (!Array.isArray(t.debugDecisions)) t.debugDecisions = [];
    if (!Array.isArray(t.auditSamples)) t.auditSamples = [];
    if (!Array.isArray(t.recentEvents)) t.recentEvents = [];
    if (!t._quality) t._quality = { possessionStartTick: match.tick || 0, possessionTeamId: null, lastOwnerId: null, lastTeamId: null, lastEventIndex: 0, lastEventSequence: 0, lastDecisionTick: {}, previousPlayerPositions: {}, sampledPlayerPositions: {}, pendingPasses: [], lastPassByTeam: {}, possessionChains: {}, sampledTick: 0, previousBall: null, previousOwnerTeam: null, accumulatedSeconds: 0 };
    if (!Number.isFinite(t._quality.lastEventIndex) || t._quality.lastEventIndex < 0) t._quality.lastEventIndex = 0;
    t._quality.lastEventIndex = Math.floor(t._quality.lastEventIndex);
    if (!t._quality.sampledPlayerPositions) t._quality.sampledPlayerPositions = {};
    if (!Number.isFinite(t._quality.lastEventSequence)) t._quality.lastEventSequence = 0;
    if (!Number.isFinite(t._quality.lastEventMarkerSequence)) t._quality.lastEventMarkerSequence = t._quality.lastEventSequence;
    if (!Array.isArray(t._quality.passPairHistory)) t._quality.passPairHistory = [];
    if (!t._quality.chatterHistory) t._quality.chatterHistory = {};
    if (!t._quality.targetChanges) t._quality.targetChanges = {};
    if (!t._quality.supportStreaks) t._quality.supportStreaks = {};
    if (!t._quality.lastDecisionAction) t._quality.lastDecisionAction = {};
    if (!t._quality.lastDribbleTickByPlayer) t._quality.lastDribbleTickByPlayer = {};
    if (!t._quality.headingTurns) t._quality.headingTurns = {};
    if (!t._quality.keeperThreatStreaks) t._quality.keeperThreatStreaks = {};
    if (!t._quality.auditTotals) t._quality.auditTotals = { samples: 0, passLoopCycles: 0, formationCollapseSamples: 0, chaseBallSamples: 0, staticSupportSamples: 0, pressSuicideSamples: 0, offsideRuns: 0, goalkeeperFreezeSamples: 0, rotationChatterSamples: 0 };
    if (!Number.isFinite(t._quality.auditTotals.samples)) t._quality.auditTotals.samples = 0;
    return t;
  }
  function teamRecord(match, teamId) { var t = match.telemetry.teams[teamId]; return t || null; }
  function bump(match, teamId, name, amount) {
    var t = teamRecord(match, teamId); if (!t) return;
    t.counters[name] = (t.counters[name] || 0) + (amount == null ? 1 : amount);
    if (name === "shot") t.shots += 1;
    if (name === "goal") t.goals += 1;
    if (name === "passAttempt") t.passes += 1;
    if (name === "passComplete") t.completedPasses += 1;
    if (name === "defensiveError") t.defensiveErrors += 1;
    if (name === "yellowCards") t.cards.yellow += 1;
    if (name === "redCards") t.cards.red += 1;
  }
  function binHistogram(histogram, key) { histogram[key] = (histogram[key] || 0) + 1; }
  function finishPossession(match) {
    var q = match.telemetry._quality, current = q.currentPossession;
    if (!current || !current.teamId) return;
    var team = teamRecord(match, current.teamId);
    var ticks = Math.max(1, (Number(match.tick) || current.startTick) - current.startTick);
    var duration = ticks * (Number(match.dt) || TF.FIXED_DT || 1 / 60);
    var passBin = Math.min(20, current.passes || 0), durationBin = Math.floor(duration / 5) * 5;
    if (team) {
      team.counters.possessionCount += 1;
      team.counters.possessionDurationSeconds += duration;
      team.counters.passChainPasses += current.passes || 0;
      binHistogram(team.passChainHistogram, String(passBin));
      binHistogram(team.possessionDurationHistogram, String(durationBin));
    }
    q.lastPossession = { teamId: current.teamId, durationSeconds: duration, passes: current.passes || 0, startTick: current.startTick, endTick: match.tick };
    q.currentPossession = null;
  }
  function goalX(match, teamId) { var team = match.teams.find(function (x) { return x.id === teamId; }); return team && team.attackDirection > 0 ? match.pitch.length : 0; }
  function shotXG(match, e) {
    var p = match.playersById[e.playerId], source = e.origin || (p && p.position) || match.ball.position;
    var point = { x: Number(source.x), y: Number(source.y) };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) point = { x: 0, y: match.pitch.width / 2 };
    var goal = goalX(match, e.teamId), centerY = match.pitch.width / 2, halfGoal = (match.pitch.goalWidth || 7.32) / 2;
    var ax = goal - point.x, ay = centerY - halfGoal - point.y, bx = goal - point.x, by = centerY + halfGoal - point.y;
    var angle = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
    var shotDistance = Math.sqrt(ax * ax + (centerY - point.y) * (centerY - point.y));
    var distanceFactor = Math.exp(-Math.max(0, shotDistance - 10) / 20), angleFactor = clamp(angle / 0.68, 0.12, 1);
    var pressure = 0, goalie = null;
    match.players.forEach(function (o) {
      if (!o.active) return;
      if (o.teamId !== e.teamId && !o.isGoalkeeper && distance(o.position, point) < 3.8) pressure += 0.08;
      if (o.teamId !== e.teamId && o.isGoalkeeper) goalie = o;
    });
    var keeperPenalty = goalie ? clamp(0.12 + Math.abs(goal - goalie.position.x) * 0.008, 0.08, 0.28) : 0.15;
    var heightPenalty = Number(e.lift) > 5 ? 0.08 : 0;
    return Number(clamp((0.035 + 0.34 * distanceFactor * angleFactor) * (1 - pressure) * (1 - keeperPenalty) - heightPenalty, 0.01, 0.72).toFixed(4));
  }
  function completePass(match, pending, receiverId, receivePoint) {
    var q = match.telemetry._quality, receiver = match.playersById[receiverId];
    if (!pending || !receiver || pending.teamId !== receiver.teamId || pending.playerId === receiverId) return false;
    bump(match, pending.teamId, "passComplete");
    receivePoint = receivePoint && Number.isFinite(Number(receivePoint.x)) && Number.isFinite(Number(receivePoint.y)) ? receivePoint : null;
    if (receivePoint) {
      var receivedProgress = (receivePoint.x - pending.x) * pending.direction;
      if (receivedProgress >= 8) bump(match, pending.teamId, "progressivePass");
      if (pending.line != null && (pending.x - pending.line) * pending.direction < 0 && (receivePoint.x - pending.line) * pending.direction > 0) bump(match, pending.teamId, "lineBreak");
    }
    var activePossession = q.currentPossession;
    if (activePossession && activePossession.teamId === pending.teamId) activePossession.passes += 1;
    if (pending.underPressure) bump(match, pending.teamId, "pressBypassed");
    if (pending.targetId === receiverId) bump(match, pending.teamId, "runReceived");
    var chain = q.possessionChains[pending.teamId] || (q.possessionChains[pending.teamId] = { passes: 0, startX: pending.x, endX: pending.x, repeats: 0, sampledRepeats: 0, lastTarget: null });
    chain.passes += 1; if (receivePoint) chain.endX = receivePoint.x;
    if (chain.previousTarget === receiverId) { chain.repeats += 1; chain.sampledRepeats += 1; bump(match, pending.teamId, "repetitiveCirculation"); }
    chain.previousTarget = chain.lastTarget; chain.lastTarget = receiverId;
    var pair = { from: pending.playerId, to: receiverId, teamId: pending.teamId, tick: match.tick };
    q.passPairHistory.push(pair);
    if (q.passPairHistory.length > 32) q.passPairHistory.shift();
    var h = q.passPairHistory;
    if (h.length >= 4) {
      var a = h.slice(-4), repeatedTwoPlayerLoop = a[0].from === a[2].from && a[0].to === a[2].to && a[1].from === a[3].from && a[1].to === a[3].to && a[0].from === a[1].to && a[0].to === a[1].from && a.every(function (step) { return step.teamId === pending.teamId && match.tick - step.tick <= 600; });
      if (repeatedTwoPlayerLoop) { bump(match, pending.teamId, "passLoop"); q.auditTotals.passLoopCycles += 1; }
    }
    return true;
  }
  function recordEvent(match, event) {
    var q = match.telemetry._quality, type = event.type, tid = event.teamId || (event.playerId && match.playersById[event.playerId] && match.playersById[event.playerId].teamId);
    match.telemetry.recentEvents.push({ type: type, tick: event.tick, teamId: tid || null, playerId: event.playerId || null });
    if (match.telemetry.recentEvents.length > MAX_EVENTS) match.telemetry.recentEvents.splice(0, match.telemetry.recentEvents.length - MAX_EVENTS);
    if (type === "restart-awarded" || type === "offside" || type === "goal" || type === "turnover" || type === "interception") {
      finishPossession(match);
      q.pendingPasses.length = 0;
      q.possessionChains = {};
      q.passPairHistory = [];
    }
    if (type === "foul" || type === "advantage" || type === "interception" || type === "turnover") q.pendingPasses.length = 0;
    if (type === "pass") {
      bump(match, tid, "passAttempt");
      var p = match.playersById[event.playerId], dir = p && p.team.attackDirection || 1;
      var target = event.target || null;
      var origin = event.origin || (p && p.position);
      var retreat = !!(target && origin && (target.x - origin.x) * dir < -5);
      if (retreat) bump(match, tid, "needlessRetreat");
      var defenders = match.players.filter(function (op) { return op.active && op.teamId !== tid; }).map(function (op) { return op.position.x; }).sort(function (a, b) { return (b - a) * dir; });
      var line = defenders.length > 1 ? defenders[1] : (dir > 0 ? match.pitch.length : 0);
      if (target && origin && (origin.x - line) * dir < 0 && (target.x - line) * dir > 0) bump(match, tid, "lineBreak");
      var kind = String(q.lastKickPlayerId === event.playerId ? q.lastKickKind : event.kind || "").toLowerCase();
      if (kind === "throughball" || kind === "through-ball") bump(match, tid, "throughBall");
      var underPressure = !!(p && match.players.some(function (op) { return op.active && op.teamId !== tid && distance(op.position, p.position) < 6; }));
      // A new launch ends any older unresolved attempt. Keep the launch-time
      // origin: player state and the source event may be frozen later.
      q.pendingPasses.length = 0;
      q.pendingPasses.push({ teamId: tid, playerId: event.playerId, targetId: event.targetId || null, tick: event.tick, x: origin ? origin.x : 0, y: origin ? origin.y : 0, line: line, direction: dir, through: kind.indexOf("through") >= 0, underPressure: underPressure });
    } else if (type === "ball-control") {
      var pending = q.pendingPasses[q.pendingPasses.length - 1];
      if (!pending) return;
      q.pendingPasses.length = 0;
      // Resolve from actual contact, not an arbitrary elapsed-time window.
      // Loose-ball deflections can delay a receiver; every terminal control
      // consumes the attempt, and completePass only credits another teammate.
      completePass(match, pending, event.playerId, event.contactPoint || event.origin);
    } else if (type === "shot") {
      // A direct shot is terminal for an unresolved attempt. Normal one-touch
      // shots have already resolved on their preceding ball-played event.
      q.pendingPasses.length = 0;
      bump(match, tid, "shot"); var xg = shotXG(match, event), tr = teamRecord(match, tid);
      if (tr) { tr.xG += xg; tr.counters.xG += xg; }
    } else if (type === "save") bump(match, event.keeperId && match.playersById[event.keeperId] && match.playersById[event.keeperId].teamId || tid, "save");
    else if (type === "goal") {
      bump(match, tid, "goal");
      var goalTeam = teamRecord(match, tid), attackType = event.attackType || "unclassified";
      if (goalTeam) goalTeam.goalsByAttackType[attackType] = (goalTeam.goalsByAttackType[attackType] || 0) + 1;
    }
    else if (type === "card") {
      if (event.card === "yellow") bump(match, tid, "yellowCards");
      if (event.card === "red") bump(match, tid, "redCards");
    }
    else if (type === "miscontrol") {
      var errorPlayer = match.playersById[event.playerId], errorTeam = errorPlayer && errorPlayer.team;
      var ownProgress = errorTeam && errorTeam.attackDirection > 0 ? errorPlayer.position.x : errorTeam ? match.pitch.length - errorPlayer.position.x : match.pitch.length;
      if (errorPlayer && errorTeam && (errorPlayer.isGoalkeeper || errorPlayer.positionFamily === "DEF") && ownProgress < match.pitch.length / 3) bump(match, errorTeam.id, "defensiveError");
    }
    else if (type === "foul" || type === "advantage") bump(match, tid, "foul");
    else if (type === "offside") bump(match, tid, "offside");
    else if (type === "tackle") bump(match, tid, "tackle");
    else if (type === "restart-awarded" && event.restartType === "corner") bump(match, tid, "corner");
    else if (type === "press-started") bump(match, tid, "pressStarted");
    else if (type === "press-success") bump(match, tid, "pressSuccess");
    else if (type === "press-bypassed") bump(match, tid, "pressBypassed");
    else if (type === "dribble") bump(match, tid, "dribble");
    if (type === "ball-played") {
      var incoming = q.pendingPasses[q.pendingPasses.length - 1];
      if (incoming) {
        q.pendingPasses.length = 0;
        var completed = completePass(match, incoming, event.playerId, event.origin || event.contactPoint);
        if (!completed && incoming.teamId !== tid) delete q.possessionChains[incoming.teamId];
      }
      q.lastKickKind = event.kind || null; q.lastKickPlayerId = event.playerId || null;
    }
  }
  function decisionRecord(match, p) {
    var ai = p.ai, chosen = ai && ai.selected, tick = match.tick;
    if (!chosen || match.telemetry._quality.lastDecisionTick[p.id] === tick) return;
    match.telemetry._quality.lastDecisionTick[p.id] = tick;
    var candidates = (ai.candidates || []).slice(0, 6).map(function (c) { return { type: c.type, targetId: c.targetId || null, utility: Number(c.utility) || 0, components: c.utilityComponents || null }; });
    match.telemetry.debugDecisions.push({ tick: tick, time: match.clock.elapsedSeconds, playerId: p.id, teamId: p.teamId, role: p.role, action: chosen.type, targetId: chosen.targetId || null, utility: Number(chosen.utility) || 0, alternatives: candidates, perceptionConfidence: p.beliefState && p.beliefState.ball && p.beliefState.ball.confidence || 0, teamIntent: p.team.intent || null, playerIntent: p.intent && { type: p.intent.type, target: p.intent.target, details: p.intent.details } });
    if (match.telemetry.debugDecisions.length > MAX_DECISIONS) match.telemetry.debugDecisions.splice(0, match.telemetry.debugDecisions.length - MAX_DECISIONS);
    var q = match.telemetry._quality, history = q.chatterHistory[p.id] || (q.chatterHistory[p.id] = []), target = p.intent && (p.intent.target || p.intent.movementTarget);
    history.push({ tick: tick, type: chosen.type, x: target && Number(target.x), y: target && Number(target.y) });
    while (history.length > 12 || (history.length && tick - history[0].tick > 180)) history.shift();
    var q = match.telemetry._quality, prior = q.lastDecisionAction[p.id], action = chosen.type;
    var runAction = ["move", "overlap", "underlap", "thirdManRun", "attackBox"].indexOf(action) >= 0;
    if (runAction && (!prior || ["move", "overlap", "underlap", "thirdManRun", "attackBox"].indexOf(prior.type) < 0 || prior.targetId !== chosen.targetId)) bump(match, p.teamId, "runStarted");
    if (action === "press" && (!prior || prior.type !== "press" || prior.targetId !== chosen.targetId)) bump(match, p.teamId, "pressStarted");
    if (action === "carry" && (!prior || prior.type !== "carry")) bump(match, p.teamId, "carry");
    q.lastDecisionAction[p.id] = { type: action, targetId: chosen.targetId || null };
  }
  function audit(match, dt) {
    var t = match.telemetry, q = t._quality, ball = match.ball, owner = ball.ownerId && match.playersById[ball.ownerId], ownerTeam = owner && owner.teamId;
    if (q.lastOwnerId !== (ball.ownerId || null) && owner) {
      var priorTeam = q.lastTeamId;
      if (priorTeam && priorTeam !== owner.teamId) {
        bump(match, owner.teamId, "turnover"); finishPossession(match); delete q.possessionChains[priorTeam]; q.pendingPasses.length = 0; q.passPairHistory = [];
        if (ball.lastTouchTeamId === owner.teamId && ["challenge", "control", "deflection"].indexOf(ball.lastTouchKind) >= 0) bump(match, owner.teamId, "interception");
        var priorOwner = match.playersById[q.lastOwnerId];
        if (priorOwner && match.players.some(function (op) { return op.active && op.teamId === owner.teamId && distance(op.position, priorOwner.position) < 4.5; })) bump(match, owner.teamId, "pressSuccess");
      }
      if (!q.currentPossession || q.currentPossession.teamId !== owner.teamId) {
        finishPossession(match);
        q.currentPossession = { teamId: owner.teamId, startTick: match.tick, passes: 0 };
      }
      q.lastOwnerId = owner.id; q.lastTeamId = owner.teamId;
    } else if (!owner) q.lastOwnerId = null;
    if (ownerTeam) { var record = teamRecord(match, ownerTeam); if (record) { record.possessionSeconds += dt; record.counters.possessionSeconds += dt; } }
    var qBall = ball.position;
    if (q.previousBall && ball.ownerId && q.lastOwnerId === ball.ownerId) {
      var carrier = match.playersById[ball.ownerId], prev = q.previousPlayerPositions[carrier.id];
      var lastDribbleTick = q.lastDribbleTickByPlayer[carrier.id] == null ? -60 : q.lastDribbleTickByPlayer[carrier.id];
      if (prev && distance(carrier.position, prev) > 0.018 && carrier.intent && ["carry", "dribble"].indexOf(carrier.intent.type) >= 0 && match.tick - lastDribbleTick >= 30) {
        bump(match, carrier.teamId, "dribble"); q.lastDribbleTickByPlayer[carrier.id] = match.tick;
      }
      if (prev && ownerTeam) {
        var attack = owner.team.attackDirection, beforeProgress = attack > 0 ? prev.x : match.pitch.length - prev.x, afterProgress = attack > 0 ? carrier.position.x : match.pitch.length - carrier.position.x;
        if (beforeProgress <= match.pitch.length * 2 / 3 && afterProgress > match.pitch.length * 2 / 3) bump(match, ownerTeam, "finalThirdEntry");
        var beforeBox = beforeProgress > match.pitch.length - 16.5 && Math.abs(prev.y - match.pitch.width / 2) <= 20.16;
        var afterBox = afterProgress > match.pitch.length - 16.5 && Math.abs(carrier.position.y - match.pitch.width / 2) <= 20.16;
        if (!beforeBox && afterBox) bump(match, ownerTeam, "boxEntry");
      }
    }
    if (q.sampledTick === 0 || match.tick - q.sampledTick >= 60) {
      q.sampledTick = match.tick;
      var active = match.players.filter(function (p) { return p.active; }), sample = {
        tick: match.tick, passLoops: 0, formationCollapse: 0, chaseBall: 0, staticSupport: 0,
        pressSuicide: 0, offsideRuns: 0, goalkeeperFreeze: 0, rotationChatter: 0
      };
      var teams = match.teams || [], centerY = match.pitch.width / 2;
      teams.forEach(function (team) {
        var members = active.filter(function (p) { return p.teamId === team.id && !p.isGoalkeeper; });
        var maxCluster = 0;
        members.forEach(function (p) {
          var neighbors = members.reduce(function (sum, other) { return sum + (p.id !== other.id && distance(p.position, other.position) <= 6 ? 1 : 0); }, 1);
          maxCluster = Math.max(maxCluster, neighbors);
        });
        if (maxCluster >= 5) sample.formationCollapse += maxCluster;
        var opponentsOwning = owner && owner.teamId !== team.id ? owner : null;
        var chasers = members.filter(function (p) {
          if (!opponentsOwning || !p.intent || ["press", "intercept", "tackle", "slide"].indexOf(p.intent.type) < 0) return false;
          var target = p.intent.target || p.intent.movementTarget;
          return distance(p.position, opponentsOwning.position) <= 18 && (!target || distance(target, opponentsOwning.position) <= 5);
        });
        if (chasers.length > 3) sample.chaseBall += chasers.length - 3;
        var pressing = members.filter(function (p) { return p.intent && p.intent.type === "press"; });
        if (opponentsOwning && pressing.length >= 2) {
          var ownGoalX = team.attackDirection > 0 ? 0 : match.pitch.length;
          var centralCover = members.filter(function (p) {
            var fromOwnGoal = Math.abs(p.position.x - ownGoalX);
            return Math.abs(p.position.y - centerY) <= 11 && fromOwnGoal >= 10 && fromOwnGoal <= 34 && !(p.intent && p.intent.type === "press");
          }).length;
          if (centralCover < 2) sample.pressSuicide += 1;
        }
        if (ownerTeam === team.id && owner) {
          var staticSupports = members.filter(function (p) {
            if (p.id === owner.id) return false;
            var prev = q.sampledPlayerPositions[p.id], moved = prev ? distance(prev, p.position) : 99;
            var supportIntent = p.intent && ["support", "move", "overlap", "underlap", "thirdManRun", "attackBox"].indexOf(p.intent.type) >= 0;
            var target = p.intent && (p.intent.target || p.intent.movementTarget);
            var noOption = !target || distance(target, owner.position) < 2.5;
            var isStatic = moved < 0.5 && noOption;
            q.supportStreaks[p.id] = isStatic ? (q.supportStreaks[p.id] || 0) + 1 : 0;
            return supportIntent && q.supportStreaks[p.id] >= 3;
          });
          if (staticSupports.length >= 4) sample.staticSupport += staticSupports.length;
        } else members.forEach(function (p) { q.supportStreaks[p.id] = 0; });
      });
      teams.forEach(function (team) {
        var attackers = active.filter(function (p) { return p.teamId === team.id && p.positionFamily === "FWD"; });
        var defenders = active.filter(function (p) { return p.teamId !== team.id; }).map(function (p) { return p.position.x; });
        var dir = team.attackDirection || 1;
        var ordered = defenders.sort(function (a, b) { return (b - a) * dir; });
        var secondLast = ordered.length > 1 ? ordered[1] : (dir > 0 ? match.pitch.length : 0);
        var ballProgress = dir > 0 ? ball.position.x : match.pitch.length - ball.position.x;
        var lineProgress = dir > 0 ? secondLast : match.pitch.length - secondLast;
        attackers.forEach(function (p) {
          var progress = dir > 0 ? p.position.x : match.pitch.length - p.position.x;
          if (progress > match.pitch.length / 2 && progress > lineProgress + 0.15 && progress > ballProgress + 0.15 && p.id !== ball.ownerId) sample.offsideRuns++;
        });
      });
      active.forEach(function (p) {
        var prev = q.sampledPlayerPositions[p.id], moved = prev ? distance(prev, p.position) : 99;
        var movementIntent = p.intent && ["move", "support", "recover", "press", "carry", "dribble", "intercept", "overlap", "underlap", "holdLine", "mark", "cover", "thirdManRun", "attackBox", "save"].indexOf(p.intent.type) >= 0;
        var movementTarget = p.intent && (p.intent.target || p.intent.movementTarget);
        if (moved < 0.08 && movementIntent && movementTarget && distance(p.position, movementTarget) > 1.5) sample.staticSupport++;
        if (p.isGoalkeeper) {
          var threat = false;
          if (!ball.ownerId) {
            var ownGoal = p.team.attackDirection > 0 ? 0 : match.pitch.length, vx = ball.velocity.x || 0, vy = ball.velocity.y || 0;
            var timeToLine = (ownGoal - ball.position.x) / vx;
            if (timeToLine > 0 && timeToLine < 4.5 && Math.abs(vx) > 1 && ball.position.z < 2.8) {
              var crossingY = ball.position.y + vy * timeToLine;
              threat = Math.abs(crossingY - centerY) <= (match.pitch.goalWidth || 7.32) / 2 + 2;
            }
          }
          var reacted = moved > 0.45 || p.intent && ["save", "intercept", "sweep", "dive"].indexOf(p.intent.type) >= 0;
          q.keeperThreatStreaks[p.id] = threat && !reacted ? (q.keeperThreatStreaks[p.id] || 0) + 1 : 0;
          if (q.keeperThreatStreaks[p.id] >= 2) sample.goalkeeperFreeze++;
        }
        var history = q.chatterHistory[p.id] || [], changes = 0;
        for (var h = 1; h < history.length; h++) {
          var old = history[h - 1], recent = history[h];
          if (match.tick - recent.tick > 180) continue;
          if (old.type !== recent.type || Number.isFinite(old.x) && Number.isFinite(recent.x) && Math.sqrt(Math.pow(old.x - recent.x, 2) + Math.pow(old.y - recent.y, 2)) > 2.2) changes++;
        }
        if (changes >= 5 && moved < 3 && q.headingTurns[p.id] >= 1.6) sample.rotationChatter++;
        q.headingTurns[p.id] = 0;
      });
      var loopCount = Object.keys(t.teams || {}).reduce(function (sum, id) { return sum + (t.teams[id].counters.passLoop || 0); }, 0);
      sample.passLoops = loopCount;
      q.auditTotals.samples++;
      q.auditTotals.formationCollapseSamples += sample.formationCollapse > 0 ? 1 : 0;
      q.auditTotals.chaseBallSamples += sample.chaseBall > 0 ? 1 : 0;
      q.auditTotals.staticSupportSamples += sample.staticSupport > 0 ? 1 : 0;
      q.auditTotals.pressSuicideSamples += sample.pressSuicide > 0 ? 1 : 0;
      q.auditTotals.offsideRuns += sample.offsideRuns;
      q.auditTotals.goalkeeperFreezeSamples += sample.goalkeeperFreeze > 0 ? 1 : 0;
      q.auditTotals.rotationChatterSamples += sample.rotationChatter > 0 ? 1 : 0;
      match.telemetry.auditSamples.push(sample);
      if (match.telemetry.auditSamples.length > MAX_AUDIT) match.telemetry.auditSamples.splice(0, match.telemetry.auditSamples.length - MAX_AUDIT);
      active.forEach(function (p) { q.sampledPlayerPositions[p.id] = { x: p.position.x, y: p.position.y }; });
    }
    q.previousBall = { x: qBall.x, y: qBall.y, z: qBall.z };
    match.players.forEach(function (p) {
      var priorFacing = q.previousFacing && q.previousFacing[p.id];
      if (priorFacing && p.facing) q.headingTurns[p.id] = (q.headingTurns[p.id] || 0) + Math.acos(clamp(priorFacing.x * p.facing.x + priorFacing.y * p.facing.y, -1, 1));
      q.previousFacing = q.previousFacing || {};
      q.previousFacing[p.id] = { x: p.facing.x, y: p.facing.y };
      q.previousPlayerPositions[p.id] = { x: p.position.x, y: p.position.y };
      decisionRecord(match, p);
    });
    if (match.state && (match.state.finished || match.state.halfTime)) finishPossession(match);
  }
  function updateTelemetry(match, dt) {
    if (!match || !match.telemetry) return;
    var t = init(match), q = t._quality, events = match.events || [];
    // The usual path reads only the last consumed row (to detect replacement)
    // and any appended suffix. If a bounded feed was compacted and refilled,
    // its old slot no longer matches the last sequence; scan the retained
    // window once and let the sequence high-water mark discard old entries.
    var historyCompacted = q.lastEventIndex > events.length;
    var startIndex = historyCompacted ? events.length : q.lastEventIndex;
    if (q.lastEventIndex > 0) {
      var prior = events[q.lastEventIndex - 1];
      if (!prior || Number(prior.sequence) !== q.lastEventMarkerSequence) startIndex = 0;
    }
    var cursorMarker = q.lastEventMarkerSequence;
    for (var i = startIndex; i < events.length; i++) {
      var sourceEvent = events[i], sequence = Number(sourceEvent && sourceEvent.sequence);
      cursorMarker = Number.isFinite(sequence) ? sequence : 0;
      if (Number.isFinite(sequence)) {
        if (sequence <= q.lastEventSequence) continue;
        recordEvent(match, sourceEvent);
        q.lastEventSequence = Math.max(q.lastEventSequence, sequence);
      } else recordEvent(match, sourceEvent);
    }
    q.lastEventIndex = events.length;
    if (historyCompacted) {
      var cursorTail = events.length ? events[events.length - 1] : null;
      cursorMarker = cursorTail && Number.isFinite(Number(cursorTail.sequence)) ? Number(cursorTail.sequence) : 0;
    }
    q.lastEventMarkerSequence = cursorMarker;
    audit(match, Number(dt) || TF.FIXED_DT || 1 / 60);
  }
  function summary(match) {
    var t = init(match), teams = {};
    Object.keys(t.teams).forEach(function (id) {
      var x = t.teams[id];
      teams[id] = { counters: Object.assign({}, x.counters), xG: x.xG, possessionSeconds: x.possessionSeconds, passes: x.passes,
        completedPasses: x.completedPasses, passCompletion: x.passes ? x.completedPasses / x.passes : null, shots: x.shots,
        goals: x.goals, cards: Object.assign({}, x.cards), defensiveErrors: x.defensiveErrors,
        goalsByAttackType: Object.assign({}, x.goalsByAttackType), passChainHistogram: Object.assign({}, x.passChainHistogram),
        possessionDurationHistogram: Object.assign({}, x.possessionDurationHistogram),
        possessionCount: x.counters.possessionCount, meanPossessionDurationSeconds: x.counters.possessionCount ? x.counters.possessionDurationSeconds / x.counters.possessionCount : null,
        meanPassesPerPossession: x.counters.possessionCount ? x.counters.passChainPasses / x.counters.possessionCount : null };
    });
    return { teams: teams, debugDecisionCount: t.debugDecisions.length, auditSamples: t.auditSamples.slice(), quality: TF.telemetry.quality(match) };
  }
  function quality(match) {
    var t = init(match), values = Object.keys(t.teams).map(function (id) { var x = t.teams[id], c = x.counters; var value = c.progressivePass * 1.2 + c.lineBreak * 1.7 + c.finalThirdEntry * 1.6 + c.boxEntry * 2.2 + c.passComplete * 0.12 + c.runReceived * 0.5 + c.goal * 5 + c.shot * 0.22 - c.repetitiveCirculation * 0.9 - c.needlessRetreat * 0.35 - c.turnover * 0.8 - c.offside * 0.6; return { teamId: id, score: Math.max(0, Math.min(100, Math.round(50 + value * 0.65))), repetitivePenalty: (c.repetitiveCirculation || 0) * 0.9, needlessRetreatPenalty: (c.needlessRetreat || 0) * 0.35, pressureEscapes: c.pressSuccess + c.pressBypassed }; });
    return values;
  }
  function decisionLog(match, playerId) { return init(match).debugDecisions.filter(function (item) { return !playerId || item.playerId === playerId; }); }
  function behaviorAudit(match) {
    var t = init(match), q = t._quality, s = q.auditTotals, n = Math.max(1, s.samples), last = t.auditSamples;
    var rates = { formationCollapse: s.formationCollapseSamples / n, chaseBall: s.chaseBallSamples / n, staticSupport: s.staticSupportSamples / n, pressSuicide: s.pressSuicideSamples / n, offsideRunsPerSample: s.offsideRuns / n, goalkeeperFreeze: s.goalkeeperFreezeSamples / n, rotationChatter: s.rotationChatterSamples / n };
    var warnings = [];
    if (s.passLoopCycles >= 2) warnings.push("pass-loop");
    if (rates.formationCollapse > 0.1) warnings.push("formation-collapse");
    if (rates.chaseBall > 0.1) warnings.push("chase-ball");
    if (rates.staticSupport > 0.2) warnings.push("static-support");
    if (rates.pressSuicide > 0.08) warnings.push("press-suicide");
    if (rates.offsideRunsPerSample > 2) warnings.push("offside-run");
    if (rates.goalkeeperFreeze > 0.04) warnings.push("goalkeeper-freeze");
    if (rates.rotationChatter > 0.08) warnings.push("rotation-chatter");
    return { samples: s.samples, totals: Object.assign({}, s), rates: rates, recentSamples: last.slice(-12), warnings: warnings };
  }
  TF.telemetry = { eventTypes: EVENT_TYPES.slice(), summary: summary, quality: quality, decisions: decisionLog, audit: behaviorAudit, estimateShotXG: shotXG, reset: function (match) { if (match) { match.telemetry = {}; init(match); } } };
  TF.updateTelemetry = updateTelemetry;
  if (typeof TF.registerCheckpointExtension === "function") TF.registerCheckpointExtension("telemetry", {
    capture: function (match) { return JSON.parse(JSON.stringify(init(match))); },
    restore: function (match, state) { match.telemetry = JSON.parse(JSON.stringify(state || {})); init(match); }
  });
})(typeof window !== "undefined" ? window : globalThis);
