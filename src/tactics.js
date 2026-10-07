(function (root) {
  "use strict";
  var TF = root.TF = root.TF || {};
  var clamp = function (x, a, b) { return Math.max(a, Math.min(b, x)); };
  var mix = function (a, b, t) { return a + (b - a) * clamp(t, 0, 1); };
  var pitchOf = function (m) { return m.pitch || (m.world && m.world.pitch) || { length: 105, width: 68 }; };
  var active = function (p) { return p && p.active !== false; };
  var d2 = function (a, b) { var x = (a.x || 0) - (b.x || 0), y = (a.y || 0) - (b.y || 0); return Math.sqrt(x*x+y*y); };
  var pos = function (p) { return p && (p.estimatedPosition || p.position) || { x: 0, y: 0 }; };
  var observedAge = function (record, tick) {
    if (!record) return Infinity;
    var age = record.ageTicks != null ? Number(record.ageTicks) : record.observedTick != null ? tick - Number(record.observedTick) : Infinity;
    return Number.isFinite(age) && age >= 0 ? age : Infinity;
  };
  var dir = function (team) { return team && team.attackDirection < 0 ? -1 : 1; };
  var attackX = function (x, team, pitch) { return dir(team) > 0 ? x : pitch.length - x; };
  var n01 = function (v, d) { v = Number(v); if (!Number.isFinite(v)) return d; return v > 1 ? clamp(v / 100, 0, 1) : clamp(v, 0, 1); };
  var attr = function (p, k, d) { return n01(p && p.attributes && p.attributes[k], d); };
  var trait = function (p, k, d) { return n01(p && p.traits && p.traits[k], d); };
  var clampPoint = function (q, pitch, margin) { return { x: clamp(q.x, margin || 1, pitch.length - (margin || 1)), y: clamp(q.y, margin || 1, pitch.width - (margin || 1)), z: 0 }; };
  var role = function (p) { return String(p && p.role || '').toUpperCase(); };
  var keeper = function (p) { return p && (p.isGoalkeeper || role(p) === 'GK'); };
  var defender = function (p) { return p && (p.positionFamily === 'DEF' || /^(CB|RCB|LCB|RB|LB|RWB|LWB|DEF)$/.test(role(p))); };
  var centralBack = function (p) { return p && /^(CB|RCB|LCB|CENTREBACK|CENTERBACK)$/.test(role(p)); };
  var forward = function (p) { return p && (p.positionFamily === 'FWD' || /^(ST|CF|RW|LW|FWD)$/.test(role(p))); };
  function beliefList(p) {
    var entities = p && p.beliefState && p.beliefState.entities || {};
    return Object.keys(entities).map(function (k) { var e = entities[k]; return { id: e.id || k, teamId: e.teamId, position: pos(e), velocity: e.velocity || { x: 0, y: 0 }, confidence: Number(e.confidence) || 0, ageTicks: Number(e.ageTicks) || 0 }; });
  }
  function canCommunicate(observer, team) {
    var entities = observer && observer.beliefState && observer.beliefState.entities || {};
    return (team.activePlayers || team.players || []).some(function(mate) {
      if (mate.id === observer.id) return false;
      var seen = entities[mate.id];
      return seen && seen.teamId === team.id && (Number(seen.confidence)||0) > .18 && d2(observer.position, pos(seen)) <= 22;
    });
  }
  function roleAnchor(player, team, pitch, phase, ball) {
    var slot = player.formationSlot || {}, d = dir(team), base = {
      x: Number.isFinite(Number(slot.x)) ? (d > 0 ? Number(slot.x) : pitch.length - Number(slot.x)) : pitch.length * (defender(player) ? .28 : forward(player) ? .76 : .49),
      y: Number.isFinite(Number(slot.y)) ? Number(slot.y) : pitch.width / 2
    };
    if (!ball) return clampPoint(base, pitch, 2);
    var own = phase === 'organizedDefensiveBlock' || phase === 'activePress' || phase === 'emergencyDefending' || phase === 'defensiveTransition';
    var progress = attackX(ball.x, team, pitch) / pitch.length;
    var ballPull = keeper(player) ? .03 : defender(player) ? (own ? .15 : .12) : forward(player) ? (own ? .18 : .28) : (own ? .22 : .23);
    var advance = own ? (defender(player) ? -.015 : -.035) : (forward(player) ? .035 : defender(player) ? .012 : .02);
    base.x = mix(base.x, ball.x - d * (defender(player) ? 8 : forward(player) ? -4 : 1), ballPull) + d * (progress > .66 ? advance * pitch.length : 0);
    if (own && !keeper(player)) {
      // Preserve a goal-side block when the observed opponent carrier is near
      // our goal. Progress is measured from this team's own goal and ball is
      // actor-local perception, so the retreat mirrors for either side.
      var emergency = phase === 'emergencyDefending';
      var threatDepth = progress * pitch.length;
      var roleDepth = defender(player) ? 4 : role(player) === 'DM' ? 9 : forward(player) ? 18 : 13;
      var roleOffset = defender(player) ? 4 : role(player) === 'DM' ? 8 : forward(player) ? 16 : 12;
      var depth = clamp(threatDepth - roleOffset, roleDepth, defender(player) ? 30 : forward(player) ? 39 : 35);
      var goalSideX = (d > 0 ? 0 : pitch.length) + d * depth;
      var retreat = emergency ? (defender(player) ? .72 : role(player) === 'DM' ? .58 : .36) : (defender(player) ? .24 : role(player) === 'DM' ? .16 : .08);
      base.x = mix(base.x, goalSideX, retreat);
      if (emergency) base.y = mix(base.y, ball.y, defender(player) ? .12 : .07);
    }
    var width = Number(team.tactics && (own ? team.tactics.defensiveWidth : team.tactics.attackingWidth));
    width = Number.isFinite(width) ? clamp(width, .25, 1) : .62;
    var centered = pitch.width * .5 + (base.y - pitch.width * .5) * mix(.72, 1, width);
    base.y = mix(centered, ball.y + (centered < pitch.width / 2 ? -1 : 1) * (keeper(player) ? 0 : 1.4), defender(player) ? .08 : .12);
    // The holding midfielder and far-side defenders preserve rest-defense depth.
    if (role(player) === 'DM' || role(player) === 'CM' && defender(player)) base.x = mix(base.x, ball.x - d * 13, own ? .2 : .3);
    return clampPoint(base, pitch, 2);
  }
  function observeTeam(team, tick, pitch) {
    var reports = [], players = team.activePlayers || team.players || [];
    players.forEach(function (p) {
      if (!canCommunicate(p, team)) return;
      var b = p.beliefState;
      if (!b) return;
      var age = Math.max(0, tick - (Number(b.updatedTick) || tick));
      var confidence = Math.pow(.985, age);
      if (b.ball && b.ball.estimatedPosition) reports.push({ source: p.id, kind: 'ball', point: b.ball.estimatedPosition, confidence: confidence * (Number(b.ball.confidence) || .5), ownerId: b.ball.ownerId || null });
      Object.keys(b.entities || {}).forEach(function (id) {
        var e = b.entities[id];
        if (e.teamId === team.id || !e.estimatedPosition) return;
        var ec = (Number(e.confidence) || .3) * confidence;
        if (ec > .12) reports.push({ source: p.id, kind: 'opponent', id: id, point: e.estimatedPosition, confidence: ec });
      });
    });
    var ballReports = reports.filter(function (r) { return r.kind === 'ball'; }).sort(function (a, b) { return b.confidence - a.confidence; });
    var ball = ballReports.length ? ballReports[0] : null;
    var opponentReports = reports.filter(function (r) { return r.kind === 'opponent'; });
    var sideWeight = { left: 0, right: 0 }, uniqueOpponents = {};
    opponentReports.forEach(function (r) { sideWeight[r.point.y < pitch.width / 2 ? 'left' : 'right'] += r.confidence; });
    opponentReports.forEach(function(r) { if(!uniqueOpponents[r.id] || uniqueOpponents[r.id].confidence<r.confidence) uniqueOpponents[r.id]=r; });
    var prior = team.tacticalMemory || { opponentWidth: .5, opponentPressure: .5, leftThreat: .5, rightThreat: .5, observed: 0 };
    // Slow exponential adaptation from only players' decayed observations.
    var seenOpponents = Object.keys(uniqueOpponents).map(function(id){return uniqueOpponents[id];});
    var ys = seenOpponents.map(function(r){return r.point.y;});
    var sampleWidth = ys.length > 1 ? clamp((Math.max.apply(null,ys)-Math.min.apply(null,ys))/pitch.width, 0, 1) : .18;
    var samplePressure = ball && seenOpponents.length ? clamp(seenOpponents.reduce(function(sum,r){return sum+Math.exp(-d2(r.point,ball.point)/15)*r.confidence;},0)/2.5,0,1) : clamp(seenOpponents.length / Math.max(1, players.length * .35), 0, 1);
    var left = sideWeight.left / Math.max(.01, sideWeight.left + sideWeight.right);
    var rate = ball ? .012 : .003;
    team.tacticalMemory = {
      opponentWidth: mix(prior.opponentWidth, sampleWidth, rate),
      opponentPressure: mix(prior.opponentPressure, samplePressure, rate),
      leftThreat: mix(prior.leftThreat, left, rate), rightThreat: mix(prior.rightThreat, 1-left, rate),
      observed: Number(prior.observed || 0) + (reports.length ? 1 : 0),
      lastBall: ball ? { x: ball.point.x, y: ball.point.y, ownerId: ball.ownerId, confidence: ball.confidence } : prior.lastBall || null,
      reportCount: reports.length
    };
    return team.tacticalMemory;
  }
  function pressArrivalEstimate(player, ownerId, tick) {
    var beliefs = player && player.beliefState, ball = beliefs && beliefs.ball;
    var owner = beliefs && beliefs.entities && beliefs.entities[ownerId];
    if (!ball || ball.ownerId !== ownerId || !owner || owner.teamId === player.teamId) return null;
    var ballAge = observedAge(ball, tick), ownerAge = observedAge(owner, tick);
    var ballConfidence = Number(ball.confidence), ownerConfidence = Number(owner.confidence);
    var z = Number(ball.estimatedZ != null ? ball.estimatedZ : ball.position && ball.position.z);
    var ballPoint = pos(ball), ownerPoint = pos(owner), selfPoint = player.position;
    if (!Number.isFinite(ballAge) || ballAge > 18 || !Number.isFinite(ownerAge) || ownerAge > 18
      || !Number.isFinite(ballConfidence) || ballConfidence < .55 || !Number.isFinite(ownerConfidence) || ownerConfidence < .58
      || !Number.isFinite(z) || z < 0 || z > .55
      || !Number.isFinite(Number(ballPoint.x)) || !Number.isFinite(Number(ballPoint.y))
      || !Number.isFinite(Number(ownerPoint.x)) || !Number.isFinite(Number(ownerPoint.y))
      || !selfPoint || !Number.isFinite(Number(selfPoint.x)) || !Number.isFinite(Number(selfPoint.y))) return null;
    var dx = Number(ownerPoint.x) - Number(selfPoint.x), dy = Number(ownerPoint.y) - Number(selfPoint.y);
    var distance = Math.hypot(dx, dy), facing = player.facing || {};
    var facingX = Number(facing.x), facingY = Number(facing.y);
    var dot = Number.isFinite(facingX) && Number.isFinite(facingY) && distance > .01
      ? clamp((facingX * dx + facingY * dy) / distance, -1, 1) : 0;
    var angle = Math.acos(dot), attrs = player.attributes || {};
    var sprint = Number(attrs.sprintSpeed), turning = Number(attrs.turning);
    if (!Number.isFinite(sprint)) sprint = 72;
    if (!Number.isFinite(turning)) turning = 60;
    var speed = (4.1 + sprint * .052) * .72, turnRate = 1.1 + turning / 100 * 3.2;
    return {
      distance: distance,
      eta: distance / Math.max(2.5, speed) + angle / turnRate * .18 + .2,
      ballAge: ballAge, ownerAge: ownerAge, ballConfidence: ballConfidence, ownerConfidence: ownerConfidence
    };
  }
  function publishPressAssignments(team, match, tick) {
    var pitch = pitchOf(match || {});
    var assignments = {}, ownerPoints = {}, threats = {}, centralReports = {};
    var priorCentralAssignments = team._tacticalState && team._tacticalState.centralLaneAssignments || {};
    var priorPressAssignments = team._tacticalState && team._tacticalState.pressAssignments || {};
    (team.activePlayers || team.players || []).forEach(function (p) {
      if (!canCommunicate(p, team)) return;
      var b = p.beliefState, ball = b && b.ball, entities = b && b.entities || {};
      if (!ball || !ball.ownerId || !entities[ball.ownerId] || entities[ball.ownerId].teamId === team.id) return;
      var enemy = entities[ball.ownerId], ep = pos(enemy);
      if (!Number.isFinite(Number(ep.x)) || !Number.isFinite(Number(ep.y))) return;
      var old = ownerPoints[ball.ownerId];
      if (!old || (Number(enemy.confidence) || 0) > old.confidence) ownerPoints[ball.ownerId] = { point: ep, confidence: Number(enemy.confidence) || .3 };
      var ballAge = observedAge(ball, tick), enemyAge = observedAge(enemy, tick);
      var ballHeight = Number(ball.estimatedZ != null ? ball.estimatedZ : ball.position && ball.position.z);
      var ballConfidence = Number(ball.confidence), enemyConfidence = Number(enemy.confidence);
      var carrierVelocity = enemy.velocity;
      if (!Number.isFinite(ballAge) || !Number.isFinite(enemyAge) || !Number.isFinite(ballConfidence) || !Number.isFinite(enemyConfidence)
        || !Number.isFinite(ballHeight) || !carrierVelocity || !Number.isFinite(Number(carrierVelocity.x)) || !Number.isFinite(Number(carrierVelocity.y))
        || ballAge > 18 || enemyAge > 18 || ballConfidence < .55 || enemyConfidence < .58 || ballHeight < 0 || ballHeight > .55) return;
      var ownGoalX = dir(team) > 0 ? 0 : pitch.length, threatDepth = (ep.x - ownGoalX) * dir(team);
      if (threatDepth < 6 || threatDepth > 28 || Math.abs(ep.y - pitch.width / 2) > 9) return;
      var priorLane = priorCentralAssignments[ball.ownerId];
      var priorLaneAge = priorLane && Number.isFinite(Number(priorLane.publishedTick)) ? tick - Number(priorLane.publishedTick) : Infinity;
      var preservedCoverId = priorLane && priorLaneAge >= 0 && priorLaneAge <= 18 ? priorLane.playerId : null;
      var priorPressers = (priorPressAssignments[ball.ownerId] || []).filter(function(id) {
        return id !== preservedCoverId && (team.activePlayers || []).some(function(candidate) { return candidate.id === id && active(candidate) && !candidate.sentOff && !candidate.injured && !keeper(candidate); });
      });
      var pressers = assignments[ball.ownerId] || (priorPressers.length ? priorPressers : null);
      if (!pressers) {
        var pressCount = Number(team.tactics && team.tactics.pressingIntensity) > .68 ? 2 : 1;
        pressers = (team.activePlayers || []).filter(function(candidate) {
          if (keeper(candidate) || candidate.id === preservedCoverId) return false;
          var known = candidate.id === p.id ? { estimatedPosition: p.position, confidence: 1, ageTicks: 0 } : entities[candidate.id];
          if (!known || Number(known.confidence) <= .15) return false;
          var age = Number.isFinite(Number(known.ageTicks)) ? Number(known.ageTicks) : tick - Number(known.observedTick || tick);
          return Number.isFinite(age) && age <= 30;
        }).map(function(candidate) {
          var known = candidate.id === p.id ? { estimatedPosition: p.position } : entities[candidate.id];
          return { id: candidate.id, distance: d2(pos(known), ep) };
        }).sort(function(a,b) { return a.distance-b.distance || a.id.localeCompare(b.id); }).slice(0, pressCount).map(function(candidate) { return candidate.id; });
      }
      if (!Array.isArray(pressers) || !pressers.some(function(id) {
        return (team.activePlayers || []).some(function(candidate) { return candidate.id === id && active(candidate) && !candidate.sentOff && !candidate.injured && !keeper(candidate); });
      })) return;
      var towardGoal = -dir(team), carrierSpeed = Math.max(0, (Number(carrierVelocity.x) || 0) * towardGoal);
      // A fresh carrier snapshot can be partway through accelerating into its
      // observed goalward facing. Use a small, bounded motor allowance when
      // estimating how soon it reaches the danger depth; the raw x velocity
      // alone made marginal cover arrivals appear timely in live movement.
      var carrierPlanarSpeed = Math.hypot(Number(carrierVelocity.x), Number(carrierVelocity.y));
      var carrierFacing = enemy.facing;
      var facingTowardGoal = carrierFacing && Number.isFinite(Number(carrierFacing.x)) && Number.isFinite(Number(carrierFacing.y))
        ? Number(carrierFacing.x) * towardGoal : 0;
      if (facingTowardGoal > .65 && Number.isFinite(carrierPlanarSpeed)) {
        carrierSpeed = Math.max(carrierSpeed, carrierPlanarSpeed + .5);
      }
      var timeToClose = (threatDepth - 6) / Math.max(2.5, carrierSpeed);
      var coverDepth = Math.max(2.5, Math.min(threatDepth - 1.5, 8, Math.max(6, threatDepth - 8)));
      var coverY = pitch.width / 2 + (ep.y - pitch.width / 2) * (coverDepth / threatDepth);
      var coverPoint = clampPoint({ x: ownGoalX + dir(team) * coverDepth, y: coverY }, pitch, 2);
      // Give this one-lane responsibility to the centrally positioned CB.
      // The partner retains far-side width even if the central CB is absent or
      // unavailable; reachability below decides whether the assignment is
      // actually feasible.
      var centralCBId = null, centralCBOffset = Infinity;
      (team.activePlayers || team.players || []).forEach(function(candidate) {
        if (!centralBack(candidate)) return;
        var seen = candidate.id === p.id ? { estimatedPosition: p.position, confidence: 1, ageTicks: 0 } : entities[candidate.id];
        if (!seen || Number(seen.confidence) < .18) return;
        var age = observedAge(seen, tick), point = pos(seen);
        if (!Number.isFinite(age) || age > 30 || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return;
        var offset = Math.abs(Number(point.y) - pitch.width / 2);
        if (offset < centralCBOffset || offset === centralCBOffset && String(candidate.id).localeCompare(String(centralCBId)) < 0) {
          centralCBOffset = offset; centralCBId = candidate.id;
        }
      });
      var options = [];
      (team.activePlayers || team.players || []).forEach(function (candidate) {
        if (!active(candidate) || candidate.sentOff || candidate.injured || !centralBack(candidate) || candidate.id !== centralCBId || pressers.indexOf(candidate.id) >= 0) return;
        var seen = candidate.id === p.id ? { estimatedPosition: p.position, confidence: 1, ageTicks: 0 } : entities[candidate.id];
        if (!seen || Number(seen.confidence) < .18) return;
        var seenAge = observedAge(seen, tick);
        if (!Number.isFinite(seenAge) || seenAge > 30) return;
        var cp = pos(seen), candidateDepth = (cp.x - ownGoalX) * dir(team);
        if (!Number.isFinite(Number(cp.x)) || !Number.isFinite(Number(cp.y))) return;
        var isPreservedCandidate = candidate.id === preservedCoverId && priorLaneAge <= 18;
        if (candidateDepth >= threatDepth && !isPreservedCandidate) return;
        var separation = d2(cp, coverPoint);
        var attrs = candidate.attributes || {};
        var sprint = n01(attrs.sprintSpeed, .72) * 100;
        var turning = n01(attrs.turning, .6) * 100;
        var speed = (4.1 + sprint * .052) * .72;
        var candidateFacing = candidate.id === p.id ? p.facing : seen.facing;
        var turnDot = candidateFacing && Number.isFinite(Number(candidateFacing.x)) && Number.isFinite(Number(candidateFacing.y))
          ? (Number(candidateFacing.x) * (coverPoint.x - cp.x) + Number(candidateFacing.y) * (coverPoint.y - cp.y)) / Math.max(.01, separation)
          : 0;
        var turnAngle = Math.acos(clamp(turnDot, -1, 1));
        var turnRate = 1.1 + turning / 100 * 3.2;
        var arrival = separation / Math.max(2.5, speed) + turnAngle / turnRate * .18 + .2;
        if (arrival <= timeToClose || isPreservedCandidate) {
          options.push({ id: candidate.id, arrival: arrival, distance: separation, confidence: Number(seen.confidence) || .5, preserved: isPreservedCandidate });
        }
      });
      if (!options.length) return;
      options.sort(function(a, b) { return Number(!!b.preserved) - Number(!!a.preserved) || a.arrival - b.arrival || b.confidence - a.confidence || a.id.localeCompare(b.id); });
      var priorReport = centralReports[ball.ownerId];
      var report = { ownerId: ball.ownerId, observerId: p.id, point: ep, confidence: Math.min(ballConfidence, enemyConfidence), ageTicks: Math.max(ballAge, enemyAge), target: coverPoint, playerId: options[0].id, runnerId: null, arrivalTime: options[0].arrival, closeTime: timeToClose, threatDepth: threatDepth, candidateOptions: options };
      var runners = Object.keys(entities).map(function(id) { return entities[id]; }).filter(function(e) {
        if (!e || e.id === ball.ownerId || e.teamId === team.id || Number(e.confidence) < .28) return false;
        var age = observedAge(e, tick);
        var point = pos(e);
        var farSide = ep.y <= pitch.width / 2 ? point.y > pitch.width / 2 + 2 : point.y < pitch.width / 2 - 2;
        return Number.isFinite(age) && age <= 30 && farSide && Math.abs(point.y - ep.y) >= 7 && (point.x - ownGoalX) * dir(team) < threatDepth + 8;
      });
      runners.sort(function(a,b) { return Math.abs(pos(b).y - ep.y) - Math.abs(pos(a).y - ep.y) || String(a.id).localeCompare(String(b.id)); });
      if (runners[0]) report.runnerId = runners[0].id;
      if (!priorReport || report.confidence > priorReport.confidence || report.confidence === priorReport.confidence && report.arrivalTime < priorReport.arrivalTime) centralReports[ball.ownerId] = report;
    });
    (team.activePlayers || team.players || []).forEach(function(observer) {
      if (!canCommunicate(observer, team)) return;
      var entities = observer.beliefState && observer.beliefState.entities || {};
      Object.keys(entities).forEach(function(id) {
        var enemy = entities[id];
        if (enemy.teamId === team.id || (Number(enemy.confidence)||0) <= .2) return;
        var old = threats[id];
        if (!old || (Number(enemy.confidence)||0) > old.confidence) threats[id] = { point: pos(enemy), confidence: Number(enemy.confidence)||.3 };
      });
    });
    var pendingReranks = team._tacticalState.pressRerankPending || (team._tacticalState.pressRerankPending = {});
    Object.keys(pendingReranks).forEach(function(ownerId) {
      if (!ownerPoints[ownerId]) delete pendingReranks[ownerId];
    });
    Object.keys(ownerPoints).forEach(function (ownerId) {
      var point = ownerPoints[ownerId].point, scored = [];
      // Actors send their own perceived carrier distance to nearby teammates.
      (team.activePlayers || team.players || []).forEach(function (observer) {
        if (!canCommunicate(observer, team)) return;
        if (keeper(observer)) return;
        var b = observer.beliefState, enemy = b && b.entities && b.entities[ownerId];
        if (enemy && (Number(enemy.confidence) || 0) > .12) scored.push({ id: observer.id, distance: d2(observer.position, pos(enemy)), confidence: Number(enemy.confidence) || .3 });
      });
      var max = Number(team.tactics && team.tactics.pressingIntensity) > .68 ? 2 : 1;
      var previousLane = priorCentralAssignments[ownerId];
      var previousLaneAge = previousLane && Number.isFinite(Number(previousLane.publishedTick)) ? tick - Number(previousLane.publishedTick) : Infinity;
      var retainedCoverId = previousLane && previousLaneAge >= 0 && previousLaneAge <= 18 && centralReports[ownerId] ? previousLane.playerId : null;
      var preservedPressers = (priorPressAssignments[ownerId] || []).filter(function(id) {
        return id !== retainedCoverId && scored.some(function(s) { return s.id === id; });
      });
      scored.sort(function(a,b) { return a.distance-b.distance || a.id.localeCompare(b.id); });
      var selectedPressers = preservedPressers.slice(0, max);
      scored.forEach(function(s) {
        if (selectedPressers.length < max && s.id !== retainedCoverId && selectedPressers.indexOf(s.id) < 0) selectedPressers.push(s.id);
      });
      var rerankState = team._tacticalState.pressRerankPending || (team._tacticalState.pressRerankPending = {});
      var history = rerankState[ownerId];
      var marksNow = team._tacticalState.markAssignments || {};
      var markedIds = Object.keys(marksNow);
      var protectedLane = previousLane && previousLaneAge >= 0 && previousLaneAge <= 18 ? previousLane.playerId : null;
      var currentLaneCandidates = (centralReports[ownerId] && centralReports[ownerId].candidateOptions || []).map(function(candidate) { return candidate.id; });
      var arrivalCandidates = (team.activePlayers || team.players || []).filter(function(candidate) {
        return active(candidate) && !candidate.sentOff && !candidate.injured && !keeper(candidate)
          && !markedIds.includes(candidate.id) && candidate.id !== protectedLane
          && currentLaneCandidates.indexOf(candidate.id) < 0 && canCommunicate(candidate, team);
      }).map(function(candidate) {
        var estimate = pressArrivalEstimate(candidate, ownerId, tick);
        return estimate ? { id: candidate.id, eta: estimate.eta, distance: estimate.distance, observation: estimate } : null;
      }).filter(Boolean).sort(function(a, b) { return a.eta - b.eta || String(a.id).localeCompare(String(b.id)); });
      var incumbentCandidates = selectedPressers.map(function(id) {
        return arrivalCandidates.find(function(candidate) { return candidate.id === id; });
      }).filter(Boolean);
      // A marked presser may keep its separate marking responsibility while
      // it remains the selected press incumbent. It must not become an
      // alternate, but its fresh local ETA is still needed to compare against
      // an eligible unmarked alternate; otherwise no rerank can be evaluated.
      selectedPressers.forEach(function(id) {
        if (incumbentCandidates.some(function(candidate) { return candidate.id === id; })
          || !markedIds.includes(id) || id === protectedLane || currentLaneCandidates.indexOf(id) >= 0) return;
        var incumbentPlayer = (team.activePlayers || team.players || []).find(function(candidate) { return candidate.id === id; });
        if (!incumbentPlayer || !active(incumbentPlayer) || incumbentPlayer.sentOff || incumbentPlayer.injured
          || keeper(incumbentPlayer) || !canCommunicate(incumbentPlayer, team)) return;
        var incumbentEstimate = pressArrivalEstimate(incumbentPlayer, ownerId, tick);
        if (incumbentEstimate) incumbentCandidates.push({ id: id, eta: incumbentEstimate.eta, distance: incumbentEstimate.distance, observation: incumbentEstimate });
      });
      incumbentCandidates.sort(function(a, b) { return b.eta - a.eta || String(a.id).localeCompare(String(b.id)); });
      var incumbent = incumbentCandidates[0];
      var alternate = arrivalCandidates.find(function(candidate) { return selectedPressers.indexOf(candidate.id) < 0; });
      var advantage = incumbent && alternate ? incumbent.eta - alternate.eta : -Infinity;
      var qualifies = !!(selectedPressers.length && incumbent && alternate && incumbent.eta >= .9 && advantage >= .45);
      if (qualifies) {
        if (history && history.incumbentId === incumbent.id && history.alternateId === alternate.id
          && tick - history.lastTick === 15) {
          history.count += 1;
        } else {
          history = { incumbentId: incumbent.id, alternateId: alternate.id, count: 1 };
        }
        history.lastTick = tick;
        rerankState[ownerId] = history;
        if (history.count >= 2) {
          selectedPressers = selectedPressers.map(function(id) { return id === incumbent.id ? alternate.id : id; });
          delete rerankState[ownerId];
        }
      } else {
        delete rerankState[ownerId];
      }
      assignments[ownerId] = selectedPressers;
    });
    team._tacticalState.pressAssignments = assignments;
    // A fresh central carrier can be covered by one reachable centre-back
    // while the existing press reservation and far-side defensive shape stay
    // intact. This assignment is derived only from communicated perceptions.
    team._tacticalState.centralLaneAssignments = {};
    Object.keys(centralReports).forEach(function(ownerId) {
      var report = centralReports[ownerId];
      var pressers = assignments[ownerId] || [];
      var validPressers = Array.isArray(pressers) ? pressers.filter(function(id) {
        return (team.activePlayers || []).some(function(candidate) { return candidate.id === id && active(candidate) && !candidate.sentOff && !candidate.injured && !keeper(candidate); });
      }) : [];
      var selected = report && validPressers.length && (report.candidateOptions || []).find(function(candidate) { return candidate.preserved && validPressers.indexOf(candidate.id) < 0; });
      if (!selected) selected = report && validPressers.length && (report.candidateOptions || []).find(function(candidate) { return validPressers.indexOf(candidate.id) < 0; });
      if (!report || !selected) return;
      team._tacticalState.centralLaneAssignments[ownerId] = {
        playerId: selected.id, runnerId: report.runnerId, target: report.target,
        observerId: report.observerId, confidence: report.confidence,
        ageTicks: report.ageTicks, publishedTick: tick,
        arrivalTime: selected.arrival, closeTime: report.closeTime,
        threatDepth: report.threatDepth
      };
    });
    // Nearby observers share threat and teammate sightings. The closest suitable
    // defender receives each threat; a three-metre hysteresis avoids churn.
    var oldMarks = team._tacticalState.markAssignments || {}, marks = {};
    Object.keys(threats).forEach(function(threatId) {
      var scored = [];
      (team.activePlayers || []).forEach(function(candidate) {
        if (!defender(candidate)) return;
        (team.activePlayers || []).forEach(function(observer) {
          if (!canCommunicate(observer, team)) return;
          var entities = observer.beliefState && observer.beliefState.entities || {}, enemy = entities[threatId];
          if (!enemy || (Number(enemy.confidence)||0) <= .2) return;
          var seen = observer.id === candidate.id ? { estimatedPosition: observer.position, confidence: .65 } : entities[candidate.id];
          if (!seen || seen !== observer && (Number(seen.confidence)||0) <= .15) return;
          scored.push({ id: candidate.id, distance: d2(pos(seen), pos(enemy)), confidence: Math.min(Number(enemy.confidence)||.3, Number(seen.confidence)||.65) });
        });
      });
      var bestByPlayer = {};
      scored.forEach(function(s) { if(!bestByPlayer[s.id] || s.confidence>bestByPlayer[s.id].confidence) bestByPlayer[s.id]=s; });
      scored = Object.keys(bestByPlayer).map(function(id){return bestByPlayer[id];}).sort(function(a,b){return a.distance-b.distance || a.id.localeCompare(b.id);});
      if (!scored.length) return;
      var best = scored[0], oldId = Object.keys(oldMarks).find(function(id){return oldMarks[id]===threatId;}), old = oldId && bestByPlayer[oldId];
      if (old && old.distance <= best.distance + 3) best = old;
      marks[best.id] = threatId;
    });
    team._tacticalState.markAssignments = marks;
  }
  function decidePhase(match, team, belief, pitch) {
    var state = match.state || {}, ball = belief && belief.ball && belief.ball.confidence > .08 ? pos(belief.ball) : null;
    if (state.phase === 'dead-ball' || state.restartType || state.phase === 'kickoff') return 'deadBall';
    if (state.phase === 'set-piece') return 'setPiece';
    var ownerId = belief && belief.ball && belief.ball.ownerId;
    var owner = ownerId && belief.entities && belief.entities[ownerId];
    var rosterOwner = ownerId && match.playersById && match.playersById[ownerId];
    var ownerTeamId = owner && owner.teamId || rosterOwner && rosterOwner.teamId || (ownerId && (team.activePlayers || []).some(function(p){return p.id===ownerId;}) ? team.id : null);
    // A fresh observed kick remains attributable while the ball is in flight,
    // even when no player currently has perceived control. The last-touch team
    // is published by perception only when the toucher was identified; never
    // infer it from the hidden world ball or from old, decayed memory.
    var perceivedBall = belief && belief.ball;
    if (!ownerTeamId && perceivedBall && perceivedBall.lastTouchTeamId && ball &&
        Number(perceivedBall.confidence) > .28 && Number(perceivedBall.ageTicks) <= 30) {
      var velocity = perceivedBall.velocity || {};
      var flightSpeed = Math.sqrt((Number(velocity.x) || 0) ** 2 + (Number(velocity.y) || 0) ** 2);
      var elevated = Number(perceivedBall.estimatedZ != null ? perceivedBall.estimatedZ : perceivedBall.position && perceivedBall.position.z) > .65;
      if (flightSpeed > 2.8 || elevated && flightSpeed > 1.1) ownerTeamId = perceivedBall.lastTouchTeamId;
    }
    if (ownerId && ownerTeamId === team.id && (keeper(owner) || keeper(rosterOwner))) return 'goalkeeperPossession';
    var tactState = team._tacticalState || {};
    if (ownerId && tactState.lastOwnerTeamId && ownerTeamId && ownerTeamId !== tactState.lastOwnerTeamId) {
      tactState.transitionUntil = (Number(match.tick) || 0) + 90;
      tactState.transitionKind = ownerTeamId === team.id ? 'attackingTransition' : 'defensiveTransition';
    }
    if (ownerTeamId) tactState.lastOwnerTeamId = ownerTeamId;
    if ((Number(match.tick) || 0) < (tactState.transitionUntil || -1)) return tactState.transitionKind || 'attackingTransition';
    if (!ball) return 'midfieldPossession';
    var progress = attackX(ball.x, team, pitch) / pitch.length;
    var owns = ownerTeamId === team.id;
    if (ownerTeamId && ownerTeamId !== team.id) {
      // progress is distance from our own goal, so low progress means the
      // opponent is threatening our goal and needs an emergency block.
      if (progress < .2) return 'emergencyDefending';
      if (progress < Number(team.tactics && team.tactics.engagementLine || .55)) return 'activePress';
      return 'organizedDefensiveBlock';
    }
    if (progress > .72) return 'finalThirdPossession';
    if (progress > .48) return 'attackingProgression';
    if (progress > .28) return 'midfieldPossession';
    if (owns) return 'initialBuildup';
    return 'establishedBuildup';
  }
  var phaseCodes = ['deadBall','goalkeeperPossession','initialBuildup','establishedBuildup','midfieldPossession','attackingProgression','finalThirdPossession','attackingTransition','defensiveTransition','organizedDefensiveBlock','activePress','emergencyDefending','setPiece'];
  function teamIntent(team, phase, memory, match) {
    var tactics = team.tactics || {}, progress = phase === 'finalThirdPossession' ? 1 : phase === 'attackingProgression' ? .7 : phase === 'midfieldPossession' ? .45 : .2;
    var lead = (team.score || 0) - ((match.teams || []).filter(function (t) { return t.id !== team.id; })[0] || {}).score;
    if (phase === 'deadBall' || phase === 'setPiece') return 'build';
    if (phase === 'defensiveTransition' || phase === 'activePress') return Number(tactics.counterpress) > .58 && memory.opponentPressure > .25 ? 'counterpress' : 'recover';
    if (phase === 'organizedDefensiveBlock' || phase === 'emergencyDefending') return 'recover';
    if (phase === 'attackingTransition') return Number(tactics.counterattack) > .45 ? 'counter' : 'advance';
    if (lead > 0 && match.clock && match.clock.periodSeconds > (match.clock.periodLimitSeconds || 2700) * .82 && Number(tactics.timeManagement) > .45) return 'protect';
    if (progress > .68) return 'attack';
    if (Number(tactics.tempo) > .62 || Number(tactics.passingDirectness) > .62) return 'advance';
    if (Number(tactics.patience) > .62 || Number(tactics.buildupRisk) < .32) return 'retain';
    return 'build';
  }
  function updateTactics(match, dt) {
    if (!match || !Array.isArray(match.teams)) return;
    var tick = Number(match.tick) || 0, pitch = pitchOf(match);
    match.teams.forEach(function (team) {
      team.tactics = team.tactics || {};
      if (!team._tacticalState) team._tacticalState = { phase: 'midfieldPossession', phaseWeights: {}, updatedTick: -1, pressAssignments: {} };
      var state = team._tacticalState;
      if (match.state && match.state.labTacticalOverride && match.state.labPhase) {
        state.phase = match.state.labPhase;
        state.phaseWeights = {};
        phaseCodes.forEach(function(ph){state.phaseWeights[ph] = ph === state.phase ? 1 : 0;});
        state.intent = state.phase === 'attackingTransition' ? 'counter' : state.phase === 'defensiveTransition' || state.phase === 'organizedDefensiveBlock' ? 'recover' : state.phase === 'finalThirdPossession' ? 'attack' : 'build';
        state.updatedTick = tick; team.intent = state.intent;
        team.tacticalExpectations = { phase: state.phase, phaseWeights: Object.assign({},state.phaseWeights), intent: state.intent,
          width: Number(team.tactics.attackingWidth || team.tactics.width || .62), defensiveWidth: Number(team.tactics.defensiveWidth || .56),
          compactness: Number(team.tactics.compactness || .62), defensiveLine: Number(team.tactics.defensiveLine || .58), memory: team.tacticalMemory || {}, publishedTick: tick };
        return;
      }
      if (tick % 15 === 0 || state.updatedTick < 0) {
        var memory = observeTeam(team, tick, pitch);
        publishPressAssignments(team, match, tick);
        // Build team phase from a confidence-weighted sample of actors' own beliefs.
        var votes = {}, total = 0;
        (team.activePlayers || team.players || []).forEach(function (p) {
          if (!active(p) || !canCommunicate(p, team)) return;
          var ph = decidePhase(match, team, p.beliefState, pitch), conf = p.beliefState && p.beliefState.ball ? Number(p.beliefState.ball.confidence) || .15 : .12;
          votes[ph] = (votes[ph] || 0) + conf; total += conf;
        });
        var best = total ? 'midfieldPossession' : (state.phase || 'midfieldPossession'), bestV = total ? -1 : 0, weights = {};
        phaseCodes.forEach(function (ph) { weights[ph] = total ? (votes[ph] || 0) / total : 0; if (total && weights[ph] > bestV) { bestV = weights[ph]; best = ph; } });
        // Preserve continuity around fuzzy phase boundaries.
        state.phaseWeights = state.phaseWeights || {};
        phaseCodes.forEach(function (ph) { state.phaseWeights[ph] = mix(Number(state.phaseWeights[ph]) || 0, weights[ph], .48); });
        state.phase = best; state.intent = teamIntent(team, best, memory, match); state.updatedTick = tick;
        team.intent = state.intent;
        team.tacticalExpectations = {
          phase: state.phase, phaseWeights: Object.assign({}, state.phaseWeights), intent: state.intent,
          width: Number(team.tactics.attackingWidth || team.tactics.width || .62), defensiveWidth: Number(team.tactics.defensiveWidth || .56),
          compactness: Number(team.tactics.compactness || .62), defensiveLine: Number(team.tactics.defensiveLine || .58),
          memory: { opponentWidth: memory.opponentWidth, opponentPressure: memory.opponentPressure, leftThreat: memory.leftThreat, rightThreat: memory.rightThreat, observed: memory.observed },
          publishedTick: tick
        };
      }
    });
  }
  function tacticalContext(match, player) {
    if (!player || !match) return {};
    var team = player.team || (match.teams || []).find(function (t) { return t.id === player.teamId; });
    if (!team) return {};
    var pitch = pitchOf(match), beliefs = beliefList(player), mates = beliefs.filter(function (e) { return e.teamId === team.id; }), foes = beliefs.filter(function (e) { return e.teamId !== team.id; });
    var ballBelief = player.beliefState && player.beliefState.ball, ball = ballBelief && Number(ballBelief.confidence) > .06 ? pos(ballBelief) : null;
    var pphase = match.state && match.state.labTacticalOverride && match.state.labPhase || decidePhase(match, team, player.beliefState, pitch), shared = team.tacticalExpectations || { phase: team._tacticalState && team._tacticalState.phase || pphase, phaseWeights: {}, intent: team.intent || 'build', width: Number(team.tactics.width) || .62, defensiveWidth: Number(team.tactics.defensiveWidth) || .56, compactness: Number(team.tactics.compactness) || .62, defensiveLine: Number(team.tactics.defensiveLine) || .58, memory: team.tacticalMemory || {} };
    // Actor phase is softened toward the communicated team expectation according to its confidence.
    var confidence = ballBelief ? clamp(Number(ballBelief.confidence) || .15, 0, 1) : .12;
    var phase = confidence > .55 ? pphase : shared.phase;
    var anchor = roleAnchor(player, team, pitch, phase, ball);
    var d = dir(team), opponentCarrier = ballBelief && ballBelief.ownerId && player.beliefState.entities && player.beliefState.entities[ballBelief.ownerId], carrierPos = opponentCarrier ? pos(opponentCarrier) : null;
    var centralLane = ballBelief && ballBelief.ownerId && team._tacticalState && team._tacticalState.centralLaneAssignments && team._tacticalState.centralLaneAssignments[ballBelief.ownerId];
    var ballAge = observedAge(ballBelief, Number(match.tick));
    var carrierAge = observedAge(opponentCarrier, Number(match.tick));
    var pressReservations = ballBelief && team._tacticalState && team._tacticalState.pressAssignments && team._tacticalState.pressAssignments[ballBelief.ownerId];
    var hasValidPressReservation = Array.isArray(pressReservations) && pressReservations.some(function(id) {
      return (team.activePlayers || []).some(function(candidate) { return candidate.id === id && active(candidate) && !candidate.sentOff && !candidate.injured && !keeper(candidate); });
    });
    var centralLaneActive = !!(centralLane && centralLane.playerId === player.id && opponentCarrier && opponentCarrier.teamId !== team.id
      && hasValidPressReservation && Number.isFinite(Number(centralLane.publishedTick))
      && Number(match.tick) - Number(centralLane.publishedTick) >= 0 && Number(match.tick) - Number(centralLane.publishedTick) <= 18
      && Number.isFinite(ballAge) && ballAge <= 18 && Number(ballBelief.confidence) >= .55
      && Number.isFinite(carrierAge) && carrierAge <= 18 && Number(opponentCarrier.confidence) >= .58
      && Number.isFinite(Number(carrierPos.x)) && Number.isFinite(Number(carrierPos.y))
      && opponentCarrier.velocity && Number.isFinite(Number(opponentCarrier.velocity.x)) && Number.isFinite(Number(opponentCarrier.velocity.y))
      && Number(ballBelief.estimatedZ != null ? ballBelief.estimatedZ : ballBelief.position && ballBelief.position.z) <= .55
      && (carrierPos.x - (d > 0 ? 0 : pitch.length)) * d >= 6
      && (carrierPos.x - (d > 0 ? 0 : pitch.length)) * d <= 28
      && Math.abs(carrierPos.y - pitch.width / 2) <= 9);
    var centralLaneTarget = null;
    if (centralLaneActive) {
      var ownGoalX = d > 0 ? 0 : pitch.length;
      var threatDepth = (carrierPos.x - ownGoalX) * d;
      var carrierSpeed = Math.max(0, (Number(opponentCarrier.velocity && opponentCarrier.velocity.x) || 0) * -d);
      var coverDepth = Math.max(2.5, Math.min(threatDepth - 1.5, 8, Math.max(6, threatDepth - 8)));
      var coverY = pitch.width / 2 + (carrierPos.y - pitch.width / 2) * (coverDepth / threatDepth);
      centralLaneTarget = clampPoint({ x: ownGoalX + d * coverDepth, y: coverY }, pitch, 2);
    }
    var pressRank = carrierPos ? d2(player.position, carrierPos) : Infinity;
    var nearThreat = foes.filter(function (e) { return e.confidence > .18; }).sort(function (a,b) { return d2(pos(a), ball || player.position) - d2(pos(b), ball || player.position); });
    var transferredMark = team._tacticalState && team._tacticalState.markAssignments && team._tacticalState.markAssignments[player.id];
    var assignedPress = false, pressTargetId = null, responsibility = 'shape';
    if (carrierPos && ballBelief.ownerId && opponentCarrier.teamId !== team.id && !keeper(player)) {
      var candidates = (team.activePlayers || []).filter(function (p) { if (keeper(p)) return false; var ent = player.beliefState.entities && player.beliefState.entities[p.id]; return p.id === player.id || ent && ent.confidence > .15; }).sort(function (a,b) { var ea = a.id === player.id ? player.position : pos(player.beliefState.entities[a.id]); var eb = b.id === player.id ? player.position : pos(player.beliefState.entities[b.id]); return d2(ea, carrierPos) - d2(eb, carrierPos); });
      var count = (team.tactics.pressingIntensity || .5) > .68 ? 2 : 1;
      var idx = candidates.findIndex(function (p) { return p.id === player.id; });
      var sharedPressers = team._tacticalState && team._tacticalState.pressAssignments && team._tacticalState.pressAssignments[ballBelief.ownerId];
      assignedPress = sharedPressers ? sharedPressers.indexOf(player.id) >= 0 && pressRank < 18 : idx >= 0 && idx < count && pressRank < 18;
      pressTargetId = assignedPress ? ballBelief.ownerId : null;
      responsibility = assignedPress ? 'press' : idx < count + 2 ? 'cover' : 'screen';
    }
    var adjustment = team.tacticalMemory || {};
    var width = Number(shared.width) || .62, compactness = Number(shared.compactness) || .62;
    var actionWeights = {};
    var intent = shared.intent || 'build';
    if (intent === 'retain' || intent === 'protect') { actionWeights.pass = .035; actionWeights.support = .03; actionWeights.throughBall = -.05; actionWeights.cross = -.02; }
    if (intent === 'counter' || intent === 'advance') { actionWeights.throughBall = .04; actionWeights.carry = .025; actionWeights.switch = .02; }
    if (intent === 'counterpress') { actionWeights.press = .05; actionWeights.recover = .02; }
    if (Number(adjustment.observed) > 4 && Number(adjustment.opponentWidth) < .42) actionWeights.switch = (actionWeights.switch || 0) + .035;
    if (Number(adjustment.observed) > 4 && Number(adjustment.opponentPressure) > .58) actionWeights.pass = (actionWeights.pass || 0) + .02;
    return {
      anchor: anchor, phase: phase, phaseWeights: Object.assign({}, shared.phaseWeights || {}), intent: intent,
      width: width, attackingWidth: width, defensiveWidth: Number(shared.defensiveWidth) || .56, compactness: compactness,
      defensiveLine: Number(shared.defensiveLine) || .58, ballEstimate: ball && { x: ball.x, y: ball.y }, ballConfidence: confidence,
      riskWeight: clamp(Number(team.tactics.buildupRisk) || .45, .05, .95), progressionWeight: clamp(Number(team.tactics.passingDirectness) || .42, 0, 1), pressWeight: clamp(Number(team.tactics.pressingIntensity) || .52, 0, 1),
      responsibilities: { press: assignedPress, pressTargetId: pressTargetId, cover: responsibility === 'cover', screen: responsibility === 'screen', centralShotLane: centralLaneActive, centralShotLaneTarget: centralLaneTarget, centralShotLaneOwnerId: centralLaneActive ? ballBelief.ownerId : null, centralShotLaneRunnerId: centralLaneActive ? centralLane.runnerId : null, centralShotLaneArrival: centralLaneActive ? centralLane.arrivalTime : null, centralShotLaneCloseTime: centralLaneActive ? centralLane.closeTime : null, type: responsibility, markTargetId: transferredMark || nearThreat[0] && nearThreat[0].id || null, markTransferred: !!transferredMark, teammateCount: mates.length, threatCount: foes.length },
      actionWeights: actionWeights, opponentTendency: { width: Number(adjustment.opponentWidth) || .5, pressure: Number(adjustment.opponentPressure) || .5, leftThreat: Number(adjustment.leftThreat) || .5, rightThreat: Number(adjustment.rightThreat) || .5, observations: Number(adjustment.observed) || 0 },
      tacticalTick: Number(shared.publishedTick) || 0
    };
  }
  function augmentCandidates(candidates, context) {
    if (!Array.isArray(candidates) || !context) return candidates;
    var self = context.self || {}, tactical = context.tactical || {}, pitch = context.pitch || { length: 105, width: 68 }, p = self.position || { x: 0, y: 0 }, d = context.attackDirection || 1;
    var ballData = context.ball || {}, ballPosition = ballData.position || {}, ballVelocity = ballData.velocity || {};
    var ball = ballPosition && Number.isFinite(Number(ballPosition.x)) && Number.isFinite(Number(ballPosition.y)) ? ballPosition : tactical.ballEstimate || p;
    var mates = context.teammates || [], foes = context.opponents || [], roleCode = String(self.role || '').toUpperCase(), family = self.positionFamily;
    var carrying = !!context.carrying, anchor = tactical.anchor || p, traits = self.traits || {}, attrs = self.attributes || {};
    var getA = function (k, z) { return n01(attrs[k], z || .5); }, getT = function (k, z) { return n01(traits[k], z || .5); };
    var add = function (type, target, utility, details) { candidates.push({ type: type, target: clampPoint(target, pitch, 1), utility: utility, details: details || {} }); };
    var ownMates = mates.filter(function (e) { return e.teamId === self.teamId && e.confidence > .12; });
    var ownFoes = foes.filter(function (e) { return e.confidence > .12; });
    var finalThird = (attackX(ball.x, { attackDirection: d }, pitch) / pitch.length) > .67, wide = ball.y < pitch.width * .25 || ball.y > pitch.width * .75;
    if (!carrying && !keeper(self) && Number.isFinite(Number(ballPosition.z)) && Number(ballPosition.z) > 1.05 && d2(p, ball) < 3.2) {
      var aerial = Number(ballPosition.z), headWindow = aerial < 2.75 && Math.abs(Number(ballVelocity.z) || 0) < 7;
      if (headWindow) add('header', { x: ball.x + d * 6, y: ball.y }, .36 + getA('heading')*.16 + getA('jumping')*.12 + getA('anticipation')*.08, { physicsAction: 'header', tacticalOpportunity: 'aerial-contest', perceived: true });
    }
    if (carrying && !keeper(self)) {
      // Side changes, crosses and cutbacks compete as utilities using perceived receiver and lane quality.
      ownMates.forEach(function (mate) {
        var mp = pos(mate), prog = (mp.x - p.x) * d, lateral = Math.abs(mp.y - p.y), dist = d2(p, mp);
        var laneThreat = ownFoes.reduce(function (v, e) { var ep = pos(e), mid = { x: (p.x + mp.x)/2, y: (p.y + mp.y)/2 }; return Math.max(v, Math.max(0, 1 - d2(ep, mid)/8) * (Number(e.confidence) || .3)); }, 0);
        if (dist > 16 && lateral > pitch.width * .34 && mate.confidence > .3) add('switch', mp, .38 + getA('vision')*.11 + getA('longPassing')*.1 + (1-laneThreat)*.09 + Math.min(.08, dist/100) - getT('riskAppetite', .5)*.035, { targetId: mate.id, tacticalOpportunity: 'switch', perceived: true, laneRisk: laneThreat });
        if (finalThird && wide && prog > -2 && dist < 29 && getA('crossing') > .2) {
          var box = { x: (d > 0 ? pitch.length - 8 : 8), y: mp.y };
          var boxRun = ownMates.some(function (runner) { return runner.id !== self.id && d2(pos(runner), box) < 18; });
          if (boxRun) add('cross', mp, .35 + getA('crossing')*.17 + getA('vision')*.06 + getT('earlyCrossing', .5)*.08 + Number(tactical.crossingWeight || .04) - laneThreat*.1, { targetId: mate.id, tacticalOpportunity: 'cross', lift: .48, perceived: true });
          if (((d > 0 ? p.x : pitch.length-p.x) > pitch.length - 15) && lateral > 7) add('cutback', { x: p.x - d * 6, y: mp.y }, .43 + getA('vision')*.09 + getA('shortPassing')*.07 + (boxRun ? .12 : 0) - laneThreat*.12, { targetId: mate.id, tacticalOpportunity: 'cutback', perceived: true });
        }
      });
    } else if (!carrying && !keeper(self)) {
      var ownOwner = mates.find(function (e) { return e.id === (context.ball && context.ball.ownerId) && e.confidence > .15; });
      var inSupport = !!ownOwner;
      var lateralDir = anchor.y < pitch.width/2 ? -1 : 1;
      if (inSupport) {
        var overlapOkay = defender(self) && /^(RB|LB|RWB|LWB)$/.test(roleCode);
        // Fullback and wingback lanes are role-fit preferences, never instructions.
        if (overlapOkay && ownOwner.confidence > .2 && d2(p, pos(ownOwner)) < 27) {
          var overlapTarget = { x: pos(ownOwner).x + d * (6 + getA('offBallIntelligence')*5), y: p.y + lateralDir * 2 };
          add('overlap', overlapTarget, .39 + getA('offBallIntelligence')*.14 + getA('sprintSpeed')*.08 + getT('roaming', .5)*.05 - getA('discipline')*.025, { targetId: ownOwner.id, tacticalOpportunity: 'overlap', perceived: true });
        }
        if ((roleCode === 'CM' || roleCode === 'RCM' || roleCode === 'LCM' || roleCode === 'AM' || roleCode === 'RAM' || roleCode === 'LAM') && d2(p, pos(ownOwner)) < 24) {
          var underlap = { x: pos(ownOwner).x + d * 5, y: clamp(pos(ownOwner).y + (anchor.y < pitch.width/2 ? 6 : -6), 3, pitch.width - 3) };
          add('underlap', underlap, .37 + getA('offBallIntelligence')*.13 + getA('anticipation')*.07 + getT('attackSpace', .5)*.05, { targetId: ownOwner.id, tacticalOpportunity: 'underlap', perceived: true });
        }
        var thirdManSpace = ownMates.filter(function (e) { return e.id !== self.id && e.id !== ownOwner.id && d2(pos(e), p) > 5 && d2(pos(e), pos(ownOwner)) < 22; }).sort(function(a,b) { return d2(pos(a),p)-d2(pos(b),p); })[0];
        if (thirdManSpace && getA('anticipation') > .25) {
          var run = { x: pos(thirdManSpace).x + d * 4, y: mix(pos(thirdManSpace).y, anchor.y, .2) };
          add('thirdManRun', run, .4 + getA('teamwork')*.1 + getA('anticipation')*.11 + getA('offBallIntelligence')*.09 - Math.max(0, ((run.x - ball.x)*d - 8)/20)*.1, { targetId: ownOwner.id, runnerId: self.id, receiverId: thirdManSpace.id, tacticalOpportunity: 'third-man', perceived: true });
        }
        if (forward(self) && finalThird) add('attackBox', { x: ball.x + d*8, y: clamp(mix(p.y, pitch.width/2, .18), 3, pitch.width-3) }, .38 + getA('offBallIntelligence')*.12 + getA('anticipation')*.09 + getT('attackSpace', .5)*.05, { tacticalOpportunity: 'box-arrival', perceived: true });
      }
      var responsibilities = tactical.responsibilities || {};
      if (responsibilities.press && responsibilities.pressTargetId && tactical.ballEstimate) {
        var targetOpponent = ownFoes.find(function (e) { return e.id === responsibilities.pressTargetId; });
        if (targetOpponent) add('press', { x: pos(targetOpponent).x - d*1.3, y: pos(targetOpponent).y }, .49 + getA('aggression')*.1 + getA('anticipation')*.08 + getT('pressingEnthusiasm', .5)*.08, { targetId: targetOpponent.id, responsibility: 'assigned-press', coverShadow: true, perceived: true });
      }
      var structural = tactical.phase === 'organizedDefensiveBlock' || tactical.phase === 'defensiveTransition' || tactical.phase === 'activePress' || tactical.phase === 'emergencyDefending';
      if (structural) {
        var highThreat = ownFoes.filter(function(e) { return e.confidence > .25; }).sort(function(a,b) {
          // The most dangerous observed runner is nearest our own goal along
          // this team's attacking axis, not the one furthest ahead.
          return attackX(pos(a).x, { attackDirection: d }, pitch) - attackX(pos(b).x, { attackDirection: d }, pitch);
        })[0];
        if (highThreat && (tactical.responsibilities || {}).markTargetId) {
          var mark = ownFoes.find(function(e) { return e.id === tactical.responsibilities.markTargetId; });
          if (mark) {
            var mp = pos(mark), goalX = d > 0 ? 0 : pitch.length, coverX = mix(p.x, goalX, .13), coverY = mix(p.y, mp.y, .24);
            var markUtility = .37 + getA('positioning')*.1 + getA('teamwork')*.08 + (Number(mark.confidence)||.3)*.08 - Math.max(0,d2(p,mp)-13)*.008;
            add('mark', { x: mix(mp.x, coverX, .36), y: mix(mp.y, coverY, .28) }, markUtility, { targetId: mark.id, responsibility: 'mark-transfer', zoneProtect: true, perceived: true });
          }
        }
        var baseLineDepth = pitch.length * (.24 + (Number(tactical.defensiveLine)||.58)*.25);
        var threatDepth = attackX(ball.x, { attackDirection: d }, pitch);
        var lineDepth = Math.min(baseLineDepth, Math.max(4, threatDepth - (tactical.phase === 'emergencyDefending' ? 2 : 5)));
        var line = (d > 0 ? 0 : pitch.length) + d * lineDepth;
        if (defender(self)) add('holdLine', { x: line, y: anchor.y }, .35 + getA('positioning')*.1 + getA('discipline')*.06 + (tactical.phase === 'emergencyDefending' ? .08 : 0) - (tactical.ballConfidence < .2 ? .02 : 0), { responsibility: 'line', offsideRisk: true, perceived: true });
        if (responsibilities.cover || responsibilities.screen) add('cover', { x: mix(anchor.x, ball.x, .25), y: mix(anchor.y, ball.y, .22) }, .39 + getA('teamwork')*.1 + getA('positioning')*.08, { responsibility: responsibilities.cover ? 'press-cover' : 'lane-screen', coverShadow: true, perceived: true });
      }
    }
    return candidates;
  }
  TF.updateTactics = updateTactics;
  TF.getTacticalContext = tacticalContext;
  TF.augmentCandidates = augmentCandidates;
  if (typeof TF.registerCheckpointExtension === 'function') TF.registerCheckpointExtension('tactics', {
    capture: function (match) { return (match.teams || []).map(function(t) { return { id:t.id, intent:t.intent, tacticalMemory:t.tacticalMemory, tacticalExpectations:t.tacticalExpectations, _tacticalState:t._tacticalState }; }); },
    restore: function (match, saved) { (saved || []).forEach(function(s) { var t=(match.teams||[]).find(function(q){return q.id===s.id;}); if(t){ t.intent=s.intent; t.tacticalMemory=s.tacticalMemory; t.tacticalExpectations=s.tacticalExpectations; t._tacticalState=s._tacticalState; } }); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
