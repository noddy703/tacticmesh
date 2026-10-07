/* Tabletop Football intelligence layer. Loaded as a classic script. */
(function (root) {
  'use strict';
  var TF = root.TF = root.TF || {};
  var clamp = function (x, lo, hi) { return Math.max(lo, Math.min(hi, x)); };
  var hypot = function (x, y) { return Math.sqrt(x * x + y * y); };
  var hash = function (s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  var id = function (p) { return String(p && typeof p === 'object' && p.id != null ? p.id : (p == null ? 'unknown' : p)); };
  var xy = function (p) { var q = p && (p.position || p); return { x: Number(q && q.x) || 0, y: Number(q && q.y) || 0 }; };
  var dist = function (a, b) { var p = xy(a), q = xy(b); return hypot(p.x - q.x, p.y - q.y); };
  var norm = function (v, fallback) { var n = hypot(v.x || 0, v.y || 0); return n < 1e-6 ? fallback : { x: v.x / n, y: v.y / n }; };
  var wrapAngle = function (a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  var mix = function (a, b, t) { return a + (b - a) * t; };
  var unit = function (n) { n = Number(n); return clamp(Number.isFinite(n) ? n / (n > 1 ? 100 : 1) : 0.5, 0, 1); };
  var attr = function (p, name, fallback) {
    var groups = [p && p.attributes, p && p.mental, p && p.technical, p && p.physical, p && p.traits];
    for (var i = 0; i < groups.length; i++) if (groups[i] && Number.isFinite(Number(groups[i][name]))) return unit(groups[i][name]);
    return fallback == null ? 0.5 : fallback;
  };
  var playerTeam = function (p) { return p && (p.team || p._team) || null; };
  var sameTeam = function (a, b) { return (a && a.teamId) === (b && b.teamId); };
  var active = function (p) { return p && p.active !== false; };
  var rngFor = function (p, match) {
    if (p.rng && typeof p.rng.next === 'function') return p.rng;
    if (!p._aiRng) {
      var seed = hash(String(match.seed || 0) + ':' + id(p));
      p._aiRng = { state: seed || 1, next: function () { this.state = (this.state + 0x6D2B79F5) | 0; var t = this.state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; } };
    }
    return p._aiRng;
  };
  var random = function (r) { return r.next(); };
  var hasBall = function (p, ball) { return !!(ball && (ball.ownerId === p.id || p.hasBall || p.ballControlState === 'controlled')); };
  var teamFor = function (p, teams) { return playerTeam(p) || (teams || []).find(function (t) { return t.id === p.teamId; }) || null; };
  var attackDir = function (t) { return Number(t && t.attackDirection) || ((t && t.side === 'away') ? -1 : 1); };
  var pitchOf = function (match) { return (match.world && match.world.pitch) || match.pitch || { length: 105, width: 68 }; };
  var target = function (x, y) { return { x: x, y: y, z: 0 }; };
  var project = function (p, seconds) { var a = xy(p), v = p.velocity || {}; return { x: a.x + (Number(v.x) || 0) * seconds, y: a.y + (Number(v.y) || 0) * seconds }; };
  var roleName = function (p) { return String(p.role || (p.isGoalkeeper ? 'goalkeeper' : '')).toLowerCase().replace(/[ _-]/g, ''); };
  var isDefender = function (p) { var r = roleName(p); return /back|defender|centreback|centerback|stopper|fullback|wingback|defensive/.test(r) || ['def','cb','lcb','rcb','lb','rb','lwb','rwb'].indexOf(r) >= 0 || p.positionFamily === 'DEF' || p.positionGroup === 'DEF'; };
  var isScreenMidfielder = function (p) { return ['dm','cdm','dmc','ldm','rdm'].indexOf(roleName(p)) >= 0; };
  var isForward = function (p) { var r = roleName(p); return /forward|striker|winger|poacher|insideforward|falsenine/.test(r) || ['fwd','st','cf','ss','rw','lw','rf','lf'].indexOf(r) >= 0 || p.positionFamily === 'FWD' || p.positionGroup === 'FWD'; };
  var isKeeper = function (p) { return !!(p.isGoalkeeper || /goalkeeper|keeper/.test(roleName(p))); };
  var ensure = function (o, k, d) { if (!o[k]) o[k] = d; return o[k]; };
  function scanInterval(p, match) {
    var awareness = attr(p, 'awareness', attr(p, 'vision', 0.48));
    var concentration = attr(p, 'concentration', awareness);
    var anticipation = attr(p, 'anticipation', 0.48);
    var team = teamFor(p, match && match.teams || []);
    var phase = String(p.ai && p.ai.tacticalPhase || team && team._tacticalState && team._tacticalState.phase || match && match.state && match.state.tacticalPhase || '');
    var belief = p.beliefState && p.beliefState.entities || {}, pressure = 0;
    Object.keys(belief).forEach(function (key) {
      var entity = belief[key];
      if (!entity || entity.teamId === p.teamId || Number(entity.ageTicks) > 120 || Number(entity.confidence) < 0.12) return;
      var point = entity.estimatedPosition || entity.position;
      if (!point) return;
      var distance = hypot(Number(point.x) - Number(p.position && p.position.x), Number(point.y) - Number(p.position && p.position.y));
      pressure = Math.max(pressure, clamp((13 - distance) / 13, 0, 1) * clamp(Number(entity.confidence) || 0, 0, 1));
    });
    var focus = awareness * 0.44 + concentration * 0.28 + anticipation * 0.28 + pressure * 0.16;
    if (phase === 'defensiveTransition' || phase === 'activePress' || phase === 'emergencyDefending') focus += isDefender(p) || isKeeper(p) ? 0.12 : 0.06;
    if (phase === 'attackingTransition' || phase === 'finalThirdPossession') focus += isForward(p) ? 0.09 : 0.035;
    if (phase === 'organizedDefensiveBlock') focus += isDefender(p) || isKeeper(p) ? 0.075 : 0.025;
    if (isKeeper(p)) focus += 0.035;
    return Math.round(clamp(mix(8, 3, clamp(focus, 0, 1)), 3, 8));
  }
  var cloneData = function (value) {
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(cloneData);
    var result = {};
    Object.keys(value).forEach(function (key) { result[key] = cloneData(value[key]); });
    return result;
  };
  // Diagnostic DTOs live on the player for the inspector/checkpoint only.
  // Keep them primitive, detached from decision objects, and strictly bounded.
  function diagnosticData(value, depth) {
    depth = depth || 0;
    if (value == null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(4)) : null;
    if (typeof value === 'string') return value.slice(0, 120);
    if (depth >= 4 || typeof value !== 'object') return null;
    if (Array.isArray(value)) return value.slice(0, 16).map(function (entry) { return diagnosticData(entry, depth + 1); });
    var out = {}, keys = Object.keys(value).slice(0, 48);
    keys.forEach(function (key) { out[key] = diagnosticData(value[key], depth + 1); });
    return out;
  }

  function visible(observer, object, radius, coneCos, facingOverride) {
    var d = dist(observer, object);
    if (d > radius) return false;
    if (d < 1 || coneCos <= -1) return true;
    var face = norm(facingOverride || observer.facing || { x: 1, y: 0 }, { x: 1, y: 0 });
    var a = xy(observer), b = xy(object), to = norm({ x: b.x - a.x, y: b.y - a.y }, face);
    return face.x * to.x + face.y * to.y >= coneCos;
  }

  function forwardRaySegmentIntersection(origin, facing, start, end) {
    if (!origin || !facing || !start || !end
      || ![origin.x, origin.y, facing.x, facing.y, start.x, start.y, end.x, end.y].every(function (value) { return Number.isFinite(Number(value)); })) return null;
    var fx = Number(facing.x), fy = Number(facing.y), faceLength = hypot(fx, fy);
    if (faceLength <= 1e-9) return null;
    fx /= faceLength; fy /= faceLength;
    var dx = Number(end.x) - Number(start.x), dy = Number(end.y) - Number(start.y);
    var ox = Number(start.x) - Number(origin.x), oy = Number(start.y) - Number(origin.y);
    var denominator = fx * dy - fy * dx;
    if (Math.abs(denominator) <= 1e-9) return null;
    var rayDistance = (ox * dy - oy * dx) / denominator;
    var segmentFraction = (ox * fy - oy * fx) / denominator;
    if (rayDistance < 0 || segmentFraction < 0 || segmentFraction > 1) return null;
    return { x: Number(start.x) + dx * segmentFraction, y: Number(start.y) + dy * segmentFraction };
  }

  function observe(p, players, ball, tick, match) {
    var awareness = attr(p, 'awareness', attr(p, 'concentration', 0.48));
    var cycle = scanInterval(p, match);
    var phase = hash(id(p)) % cycle;
    var runScan = (tick + phase) % cycle === 0 || !p.beliefState;
    var belief = ensure(p, 'beliefState', { entities: {}, ball: null, updatedTick: tick, observations: [] });
    belief.entities = belief.entities || {};
    var facing = norm(p.facing || { x: 1, y: 0 }, { x: 1, y: 0 });
    var bodyAngle = Math.atan2(facing.y, facing.x), remembered = belief.ball, scanTargetAngle;
    if (remembered && remembered.position && tick - remembered.observedTick <= 120 && remembered.confidence > 0.12) {
      var memoryAge = Math.max(0, tick - remembered.observedTick) / 60;
      var rememberedX = remembered.position.x + (Number(remembered.velocity && remembered.velocity.x) || 0) * Math.min(memoryAge, 0.6);
      var rememberedY = remembered.position.y + (Number(remembered.velocity && remembered.velocity.y) || 0) * Math.min(memoryAge, 0.6);
      // Gaze toward the last observed ball estimate, never its hidden current position.
      scanTargetAngle = wrapAngle(Math.atan2(rememberedY - p.position.y, rememberedX - p.position.x) - bodyAngle);
    } else {
      // When no ball memory exists, scan bounded alternating shoulder arcs.
      scanTargetAngle = Math.sin((tick + hash(id(p))) / 24) * 1.3;
    }
    scanTargetAngle = wrapAngle(scanTargetAngle + (Math.floor(tick / 24) % 2 === 0 ? -0.24 : 0.24));
    var scanAngle = Number(p._aiScanAngle) || 0;
    scanAngle += clamp(wrapAngle(scanTargetAngle - scanAngle), -7 / 60, 7 / 60);
    if (runScan) scanAngle += (random(rngFor(p, match)) - 0.5) * (0.14 - awareness * 0.1);
    p._aiScanAngle = wrapAngle(scanAngle);
    var scanFacing = { x: facing.x * Math.cos(scanAngle) - facing.y * Math.sin(scanAngle), y: facing.x * Math.sin(scanAngle) + facing.y * Math.cos(scanAngle) };
    var seen = [];
    if (runScan) {
      var priorObservedOwner = belief.observedSameOwner && Object.assign({}, belief.observedSameOwner);
      var priorObservedBall = belief.ball && {
        ownerId: belief.ball.ownerId,
        observedTick: Number(belief.ball.observedTick),
        teamId: belief.ball.lastTouchTeamId
      };
      var priorObservedCarrier = priorObservedOwner && belief.entities[id(priorObservedOwner.ownerId)];
      var priorObservedCarrierTick = priorObservedCarrier && Number(priorObservedCarrier.observedTick);
      var priorObservedCarrierTeam = priorObservedCarrier && priorObservedCarrier.teamId;
      var ownerKnown = null, observedCarrier = null;
      for (var i = 0; i < players.length; i++) {
        var other = players[i];
        if (!active(other) || other.id === p.id) continue;
        // Use the observer's remembered affiliation to choose perception range.
        // Before first identification, use the neutral acquisition radius; a
        // live teamId change must not leak before the actor can see the player.
        var rememberedEntity = belief.entities[id(other)];
        var knownTeammate = rememberedEntity && rememberedEntity.teamId === p.teamId;
        var r = rememberedEntity ? (knownTeammate ? 33 : 27) : 33;
        var direct = visible(p, other, r, -0.12, scanFacing);
        var peripheral = visible(p, other, Math.min(14, r), -0.68, scanFacing);
        if (!direct && !peripheral) continue;
        var pos = xy(other), vel = other.velocity || {};
        var noise = (1 - awareness) * (peripheral ? 1.1 : 0.35);
        var rr = rngFor(p, match);
        var entity = rememberedEntity || (belief.entities[id(other)] = { id: other.id });
        entity.position = { x: pos.x + (random(rr) - 0.5) * noise, y: pos.y + (random(rr) - 0.5) * noise };
        entity.velocity = { x: Number(vel.x) || 0, y: Number(vel.y) || 0 };
        entity.facing = { x: Number(other.facing && other.facing.x) || 1, y: Number(other.facing && other.facing.y) || 0 };
        // Public identity/role metadata is attached only after this actor has
        // perceived the player. A neutral's changed affiliation is likewise
        // learned only on this observation, not from world state while unseen.
        entity.teamId = other.teamId;
        entity.role = other.role || null;
        entity.positionFamily = other.positionFamily || null;
        entity.isGoalkeeper = !!other.isGoalkeeper;
        // Visual action cues are public only when the actor is actually seen.
        // Keep intended location, not a hidden recipient/player identifier.
        var visual = other.visualMotion;
        entity.releaseCue = visual && Number.isFinite(Number(visual.tick))
          && tick >= Number(visual.tick) && tick - Number(visual.tick) <= 14
          ? { action: String(visual.action || visual.type || ''), tick: Number(visual.tick),
            target: visual.target && Number.isFinite(Number(visual.target.x)) && Number.isFinite(Number(visual.target.y))
              ? { x: Number(visual.target.x), y: Number(visual.target.y) } : null }
          : null;
        entity.baseConfidence = clamp(0.98 - noise * 0.1, 0.55, 0.99);
        entity.confidence = entity.baseConfidence;
        entity.observedTick = tick;
        entity.source = direct ? 'vision' : 'peripheral';
        seen.push(entity);
      }
      var sampledBallVelocity = ball && ball.velocity || {};
      var salientFastBall = hypot(Number(sampledBallVelocity.x) || 0, Number(sampledBallVelocity.y) || 0) > 5.4;
      var ballVisible = ball && (visible(p, ball, 42, -0.42, scanFacing) || (salientFastBall && visible(p, ball, 14, -0.68, scanFacing)));
      if (ballVisible) {
        var bp = xy(ball), bv = ball.velocity || {};
        var noiseB = (1 - awareness) * 0.28, br = rngFor(p, match);
        var visibleOwner = ball.ownerId && belief.entities[id(ball.ownerId)];
        ownerKnown = visibleOwner && visibleOwner.observedTick === tick ? ball.ownerId : null;
        observedCarrier = ownerKnown && belief.entities[id(ownerKnown)] || null;
        var lastTouchEntity = ball.lastTouchPlayerId && belief.entities[id(ball.lastTouchPlayerId)];
        var lastTouchKnown = ball.lastTouchPlayerId === p.id || lastTouchEntity && lastTouchEntity.observedTick === tick ? ball.lastTouchPlayerId : null;
        var lastTouchTeamKnown = lastTouchKnown === p.id ? p.teamId : lastTouchKnown && belief.entities[id(lastTouchKnown)] && belief.entities[id(lastTouchKnown)].teamId;
        var releaseCue = lastTouchKnown === p.id ? p.visualMotion : lastTouchKnown && belief.entities[id(lastTouchKnown)] && belief.entities[id(lastTouchKnown)].releaseCue;
        var releaseVisible = !!(releaseCue && Number(releaseCue.tick) === Number(ball.lastTouchTick)
          && tick >= Number(releaseCue.tick) && tick - Number(releaseCue.tick) <= 14);
        belief.ball = { position: { x: bp.x + (random(br) - 0.5) * noiseB, y: bp.y + (random(br) - 0.5) * noiseB, z: Number(ball.position.z) || 0 }, velocity: { x: Number(bv.x) || 0, y: Number(bv.y) || 0, z: Number(bv.z) || 0 }, ownerId: ownerKnown, lastTouchPlayerId: lastTouchKnown, lastTouchTeamId: lastTouchTeamKnown || null, lastTouchKind: lastTouchKnown ? ball.lastTouchKind || null : null, lastTouchAction: releaseVisible ? releaseCue.action : null, lastTouchTarget: releaseVisible && releaseCue.target ? { x: releaseCue.target.x, y: releaseCue.target.y } : null, baseConfidence: 0.98 - noiseB, confidence: 0.98 - noiseB, observedTick: tick, source: 'vision' };
      }
      var validObservedSameOwner = !!(ballVisible && belief.ball && ownerKnown && observedCarrier
        && observedCarrier.observedTick === tick && observedCarrier.teamId === p.teamId);
      if (validObservedSameOwner) {
        var priorSampleTick = priorObservedOwner && Number(priorObservedOwner.lastObservedTick);
        var priorSampleConsistent = !!(priorObservedOwner && priorObservedBall && priorObservedCarrier
          && Number.isFinite(priorSampleTick)
          && priorSampleTick === Number(priorObservedBall.observedTick)
          && priorSampleTick === priorObservedCarrierTick
          && String(priorObservedOwner.ownerId) === String(priorObservedBall.ownerId)
          && String(priorObservedOwner.ownerId) === String(priorObservedCarrier.id)
          && String(priorObservedOwner.teamId) === String(p.teamId)
          && String(priorObservedOwner.teamId) === String(priorObservedCarrierTeam)
          && Number.isFinite(Number(priorObservedOwner.firstObservedTick))
          && Number(priorObservedOwner.firstObservedTick) <= priorSampleTick
          && Number(priorObservedOwner.sampleCount) >= 1);
        var observationGap = priorSampleConsistent ? tick - priorSampleTick : Infinity;
        var maximumObservationGap = priorSampleConsistent
          ? Math.max(Number(priorObservedOwner.scanIntervalTicks) || 0, cycle) : 0;
        var continuesObservedOwner = priorSampleConsistent
          && String(priorObservedOwner.ownerId) === String(ownerKnown)
          && String(priorObservedOwner.teamId) === String(p.teamId)
          && observationGap > 0 && observationGap <= maximumObservationGap;
        belief.observedSameOwner = {
          ownerId: ownerKnown,
          teamId: p.teamId,
          firstObservedTick: continuesObservedOwner ? Number(priorObservedOwner.firstObservedTick) : tick,
          lastObservedTick: tick,
          sampleCount: continuesObservedOwner ? (Number(priorObservedOwner.sampleCount) || 1) + 1 : 1,
          scanIntervalTicks: cycle
        };
      } else {
        belief.observedSameOwner = null;
      }
      belief.lastScanTick = tick;
      belief.observations = seen.slice(0, 12).map(function (e) { return { id: e.id, source: e.source }; });
    }
    Object.keys(belief.entities).forEach(function (key) {
      var e = belief.entities[key], age = Math.max(0, tick - e.observedTick), dt = age / 60;
      if (age > 0) {
        e.estimatedPosition = { x: e.position.x + e.velocity.x * Math.min(dt, 1.2), y: e.position.y + e.velocity.y * Math.min(dt, 1.2) };
        e.confidence = clamp((e.baseConfidence || 0.8) * Math.pow(0.985, age), 0.03, 0.98);
      } else e.estimatedPosition = { x: e.position.x, y: e.position.y };
      e.ageTicks = age;
      if (age > 240 || e.confidence < 0.08) delete belief.entities[key];
    });
    if (belief.ball) {
      belief.ball.position = belief.ball.position || { x: 0, y: 0, z: 0 };
      belief.ball.velocity = belief.ball.velocity || { x: 0, y: 0, z: 0 };
      var ba = Math.max(0, tick - belief.ball.observedTick);
      belief.ball.estimatedPosition = { x: belief.ball.position.x + belief.ball.velocity.x * Math.min(ba / 60, 1), y: belief.ball.position.y + belief.ball.velocity.y * Math.min(ba / 60, 1) };
      belief.ball.estimatedZ = Math.max(0, Number(belief.ball.position.z || 0) + Number(belief.ball.velocity.z || 0) * Math.min(ba / 60, 1) - 4.905 * Math.pow(Math.min(ba / 60, 1), 2));
      belief.ball.estimatedVelocityZ = Number(belief.ball.velocity.z) - 9.81 * Math.min(ba / 60, 1);
      belief.ball.confidence = clamp((belief.ball.baseConfidence || 0.8) * Math.pow(0.992, ba), 0.05, 0.99);
      belief.ball.ageTicks = ba;
    }
    belief.updatedTick = tick;
    belief.scanDirection = scanFacing;
    return belief;
  }

  function getBeliefs(p) { var b = p.beliefState || { entities: {} }; return Object.keys(b.entities || {}).map(function (k) { return b.entities[k]; }); }
  function estimated(e) { return e.estimatedPosition || e.position || { x: 0, y: 0 }; }
  function nearest(list, point, filter) {
    var best = null, bd = Infinity;
    list.forEach(function (p) { if (filter && !filter(p)) return; var d = dist(p, point); if (d < bd) { best = p; bd = d; } });
    return best ? { player: best, distance: bd } : { player: null, distance: Infinity };
  }
  function pressureAt(point, opponents) { var pressure = 0; opponents.forEach(function (e) { var d = dist(estimated(e), point); pressure += Math.exp(-d / 5.4) * (e.confidence || 0.5); }); return clamp(pressure, 0, 1.5); }
  function danger(p, point, opponents) { var min = Infinity; opponents.forEach(function (e) { min = Math.min(min, dist(estimated(e), point)); }); return min; }
  function attackingGoal(team, pitch) { return { x: attackDir(team) > 0 ? pitch.length : 0, y: pitch.width / 2 }; }
  function progress(team, from, to) { return (to.x - from.x) * attackDir(team); }
  function roleAnchor(p, team, pitch) {
    var slot = p.formationSlot;
    if (slot && Number.isFinite(Number(slot.x)) && Number.isFinite(Number(slot.y))) {
      var slotX = Number(slot.x);
      if (attackDir(team) < 0) slotX = pitch.length - slotX;
      return target(clamp(slotX, 0, pitch.length), clamp(Number(slot.y), 0, pitch.width));
    }
    var d = attackDir(team), x = pitch.length * 0.5, y = pitch.width * 0.5;
    if (isKeeper(p)) return target(d > 0 ? 5 : pitch.length - 5, y);
    if (isDefender(p)) x = d > 0 ? pitch.length * 0.29 : pitch.length * 0.71;
    else if (isForward(p)) x = d > 0 ? pitch.length * 0.76 : pitch.length * 0.24;
    else x = pitch.length * 0.5;
    var roster = (team && (team.activePlayers || team.players)) || [];
    var mids = roster.filter(function (q) { return !isKeeper(q); });
    var index = Math.max(0, mids.indexOf(p));
    var lanes = Math.max(1, Math.min(5, mids.length));
    y = pitch.width * (0.16 + 0.68 * ((index % lanes) / Math.max(1, lanes - 1)));
    return target(x, y);
  }
  function clampPoint(q, pitch, margin) { margin = margin || 1; return target(clamp(q.x, margin, pitch.length - margin), clamp(q.y, margin, pitch.width - margin)); }
  function estimatedPassArrival(distance, power, lift) {
    // Match the rolling drag model in physics.js so receivers move into the
    // ball's actual arrival window instead of a fixed 17 m/s guess.
    var speed = 5.5 + clamp(power, 0.1, 1) * 12.5, drag = 0.42;
    var ratio = clamp(distance * drag / speed, 0, 0.94);
    var rolling = -Math.log(Math.max(0.06, 1 - ratio)) / drag;
    return clamp(rolling + Math.min(0.35, Math.max(0, lift) * 1.2), 0.18, 5.5);
  }
  function playerArrivalTime(observer, point, movementFraction) {
    var here = estimated(observer), dx = point.x - here.x, dy = point.y - here.y, directDistance = hypot(dx, dy), distance = directDistance - 0.9;
    if (distance <= 0) return 0;
    var ux = dx / Math.max(0.001, directDistance), uy = dy / Math.max(0.001, directDistance), v = observer.velocity || {};
    var face = norm(observer.facing || v, { x: 1, y: 0 });
    var turnRate = 1.1 + 0.6 * 3.2, heading = Math.acos(clamp(face.x * ux + face.y * uy, -1, 1));
    var turnDelay = heading / turnRate * 0.62;
    var rawSprint = Number(observer.attributes && observer.attributes.sprintSpeed) || 72;
    var rawAcceleration = Number(observer.attributes && observer.attributes.acceleration) || 65;
    var fatigue = clamp(Number(observer.stamina == null ? 1 : observer.stamina), 0.18, 1);
    var maximum = (4.1 + rawSprint * 0.052) * (movementFraction == null ? 0.9 : movementFraction) * (0.72 + 0.28 * fatigue);
    var acceleration = (1.15 + rawAcceleration / 27) * fatigue;
    var initial = Math.max(0, (Number(v.x) || 0) * ux + (Number(v.y) || 0) * uy);
    var ramp = Math.max(0, (maximum - initial) / acceleration);
    var rampDistance = initial * ramp + 0.5 * acceleration * ramp * ramp;
    var movementTime = distance <= rampDistance
      ? (-initial + Math.sqrt(initial * initial + 2 * acceleration * distance)) / acceleration
      : ramp + (distance - rampDistance) / maximum;
    return turnDelay + movementTime;
  }
  function throughLeadSupportedByObservedMotion(targetPoint, predictedReceiverPoint, velocity) {
    if (!targetPoint || !predictedReceiverPoint || !Number.isFinite(Number(targetPoint.x))
      || !Number.isFinite(Number(targetPoint.y)) || !Number.isFinite(Number(predictedReceiverPoint.x))
      || !Number.isFinite(Number(predictedReceiverPoint.y))) return true;
    velocity = velocity || {};
    var leadX = Number(targetPoint.x) - Number(predictedReceiverPoint.x);
    var leadY = Number(targetPoint.y) - Number(predictedReceiverPoint.y);
    return leadX * (Number(velocity.x) || 0) + leadY * (Number(velocity.y) || 0) >= 0;
  }
  function keeperOpponentWinsRace(keeper, meet, opponents) {
    if (!meet || !meet.point) return false;
    var opponentTime = Infinity;
    (opponents || []).forEach(function (opponent) {
      if (!opponent || opponent.isGoalkeeper || Number(opponent.confidence) < 0.42 || Number(opponent.ageTicks) > 24) return;
      // Opponent reach is estimated from the keeper's own remembered entity
      // state. Age adds uncertainty; the motor model and attributes remain
      // private to the observing keeper.
      var arrival = playerArrivalTime(opponent, meet.point, 0.9) + Math.max(0, Number(opponent.ageTicks) || 0) / 60 * 0.8;
      if (arrival < opponentTime) opponentTime = arrival;
    });
    if (!Number.isFinite(opponentTime)) return false;
    var keeperArrival = Number.isFinite(Number(meet.arrivalTime)) ? Number(meet.arrivalTime) : Number(meet.time);
    return opponentTime + 0.12 < keeperArrival && opponentTime < Number(meet.time) + 0.12;
  }
  function capLeadBeforePitchBoundary(point, velocity, requestedTime, pitch, margin) {
    var maxTime = Math.max(0, Number(requestedTime) || 0), safe = Number(margin) || 1.5;
    var vx = Number(velocity && velocity.x) || 0, vy = Number(velocity && velocity.y) || 0;
    var limits = [
      [Number(point.x), vx, safe, pitch.length - safe],
      [Number(point.y), vy, safe, pitch.width - safe]
    ];
    for (var i = 0; i < limits.length; i++) {
      var axis = limits[i], position = axis[0], speed = axis[1], low = axis[2], high = axis[3];
      if (speed > 0.05) maxTime = Math.min(maxTime, Math.max(0, (high - position) / speed));
      else if (speed < -0.05) maxTime = Math.min(maxTime, Math.max(0, (low - position) / speed));
    }
    return maxTime;
  }
  function passLaneInterceptionRisk(start, end, power, lift, opponents) {
    var length = hypot(end.x - start.x, end.y - start.y), ballSpeed = 5.5 + clamp(power, 0.1, 1) * 12.5, risk = 0;
    if (length < 1 || !opponents.length) return 0;
    // Sample along the projected pass lane and compare ball time with observed
    // defender motor reach. Include the first two metres: a defender beside the
    // passer can contest the released ball before an ordinary midfield sample.
    // All positions/facing/velocity are perception DTOs.
    opponents.forEach(function (defender) {
      var confidence = clamp(Number(defender.confidence) || 0.4, 0, 1);
      var nearOrigin = dist(estimated(defender), start);
      risk = Math.max(risk, clamp((2.25 - nearOrigin) / 1.8, 0, 1) * confidence);
    });
    var fractions = [0.02, 0.04, 0.06, 0.08, 0.1, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
    for (var sample = 0; sample < fractions.length; sample++) {
      var fraction = fractions[sample], q = { x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction };
      var ballTime = estimatedPassArrival(length * fraction, clamp((ballSpeed - 5.5) / 12.5, 0.1, 1), lift);
      for (var i = 0; i < opponents.length; i++) {
        var defender = opponents[i], confidence = clamp(Number(defender.confidence) || 0.4, 0, 1);
        var arrival = playerArrivalTime(defender, q, 1);
        var advantage = ballTime - arrival;
        var chance = clamp((advantage + 0.12) / 0.45, 0, 1) * confidence;
        if (chance > risk) risk = chance;
      }
    }
    return risk;
  }
  function shotLaneInterceptionRisk(start, end, shotSpeed, opponents) {
    var length = hypot(end.x - start.x, end.y - start.y), speed = Math.max(13, Number(shotSpeed) || 20), risk = 0;
    if (length < 1 || !opponents.length) return 0;
    // Shots travel much faster than passes. Sample the perceived lane and ask
    // whether an observed defender can arrive at a point before the ball does.
    // This is a likelihood term, not a possession claim or a hidden-world raycast.
    var fractions = [0.08, 0.16, 0.26, 0.38, 0.5, 0.62, 0.74, 0.86, 0.94];
    for (var sample = 0; sample < fractions.length; sample++) {
      var fraction = fractions[sample], q = { x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction };
      var ballTime = -Math.log(Math.max(0.08, 1 - Math.min(0.9, length * fraction * 0.42 / speed))) / 0.42;
      for (var i = 0; i < opponents.length; i++) {
        var defender = opponents[i], confidence = clamp(Number(defender.confidence) || 0.4, 0, 1);
        var arrival = playerArrivalTime(defender, q, 1);
        var chance = clamp((ballTime + 0.07 - arrival) / 0.28, 0, 1) * confidence;
        if (chance > risk) risk = chance;
      }
    }
    return risk;
  }
  function goalkeeperShotInterceptionRisk(start, end, shotSpeed, keeper) {
    if (!keeper || !Number.isFinite(Number(keeper.confidence))) return 0;
    var age = Math.max(0, Number(keeper.ageTicks) || 0), confidence = clamp(Number(keeper.confidence), 0, 1);
    var sigma = clamp(age / 60 * 1.25, 0, 3);
    var keeperPosition = estimated(keeper), keeperVelocity = keeper.velocity || {};
    var length = hypot(end.x - start.x, end.y - start.y), speed = Math.max(13, Number(shotSpeed) || 20);
    if (length < 1) return 0;
    // Sample the full flight at the physics tick rate. An advanced keeper can
    // meet a shot well before the final fifth.
    var flightTime = length / speed, ticksInFlight = Math.max(1, Math.ceil(flightTime * 60));
    var geometryRisk = 0;
    // Sample at the same fixed-tick spacing as physical keeper handling, then
    // take the strongest reachable contact window. These adjacent windows are
    // highly correlated and the ball touch cooldown prevents treating them as
    // independent save rolls.
    for (var i = 1; i <= ticksInFlight; i++) {
      var fraction = Math.min(1, i / ticksInFlight), q = { x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction };
      var flightTime = length * fraction / speed;
      // Carry the observed velocity forward once, then estimate only the
      // keeper's remaining bounded dive/reach. Do not feed a future position
      // and the original velocity into a second movement-time prediction.
      var predictionTime = Math.min(0.55, flightTime), kx = keeperPosition.x + clamp(Number(keeperVelocity.x) || 0, -6, 6) * predictionTime;
      var ky = keeperPosition.y + clamp(Number(keeperVelocity.y) || 0, -6, 6) * predictionTime;
      var gap = hypot(q.x - kx, q.y - ky);
      // The urgent keeper path checks its cached threat on fixed ticks rather
      // than waiting for the ordinary decision cadence. Use one tick for an
      // already-fresh estimate; a generic 45 ms delay undercounts that response.
      var reaction = (1 / 60) + (1 - confidence) * 0.12 + Math.min(0.12, age / 750);
      var available = Math.max(0, flightTime - reaction);
      // Match the physical keeper's ordinary save envelope: about 1.25m at
      // first contact, growing over ten ticks by a generic 55 diving/55 reach
      // profile. Add only bounded lateral body travel during that window.
      var diveProgress = clamp(available / (10 / 60), 0, 1);
      var saveReach = 1.25 + (55 * 0.012 + 55 * 0.004) * diveProgress;
      var diveAcceleration = 5.5 + 55 * 0.055 + 60 * 0.018, launchSpeed = 0.65 + 55 * 0.014, diveMaxSpeed = 3.2 + 55 * 0.023 + 60 * 0.012;
      var motorTime = Math.min(available, Math.max(0, (diveMaxSpeed - launchSpeed) / diveAcceleration));
      var lateralTravel = launchSpeed * motorTime + 0.5 * diveAcceleration * motorTime * motorTime;
      if (available > motorTime) lateralTravel += diveMaxSpeed * (available - motorTime);
      var margin = saveReach + lateralTravel - gap;
      var contactGeometry = clamp((margin + 0.3 + 0.45 * sigma) / (0.9 + 0.35 * sigma), 0, 1);
      if (contactGeometry > geometryRisk) geometryRisk = contactGeometry;
    }
    // Apply observation reliability once to the combined geometric estimate;
    // repeating confidence each tick would manufacture certainty from one
    // unchanged keeper belief.
    return geometryRisk * confidence;
  }
  function goalMouthAngleScore(position, goal, pitch) {
    var halfWidth = (Number(pitch.goalWidth) || 7.32) * 0.5;
    var dx = goal.x - position.x;
    var low = Math.atan2(pitch.width * 0.5 - halfWidth - position.y, dx);
    var high = Math.atan2(pitch.width * 0.5 + halfWidth - position.y, dx);
    var aperture = Math.abs(high - low);
    if (aperture > Math.PI) aperture = Math.PI * 2 - aperture;
    return clamp(aperture / 0.48, 0, 1);
  }
  function shotMouthExecutionChance(origin, aim, p, pitch, pressure) {
    // Physics rotates the requested kick direction by a bounded body-bias plus
    // uniform shooting-error interval. Estimate how much of that interval still
    // crosses between the posts, using the same foot-contact origin as strike().
    // The small inset accounts for the physical post radius, not a keeper/save
    // probability or a hidden-world ray test.
    var halfWidth = (Number(pitch.goalWidth) || 7.32) * 0.5 - 0.13;
    if (!(halfWidth > 0)) return 0;
    var dx = Number(aim.x) - Number(origin.x), dy = Number(aim.y) - Number(origin.y);
    var distance = hypot(dx, dy);
    if (!(distance > 0)) return 0;
    var aimAngle = Math.atan2(dy, dx), lowerPost = Math.atan2(pitch.width * 0.5 - halfWidth - origin.y, (Number(aim.x) - Number(origin.x)) || 1e-9);
    var upperPost = Math.atan2(pitch.width * 0.5 + halfWidth - origin.y, (Number(aim.x) - Number(origin.x)) || 1e-9);
    var allowedA = wrapAngle(lowerPost - aimAngle), allowedB = wrapAngle(upperPost - aimAngle);
    var allowedLow = Math.min(allowedA, allowedB), allowedHigh = Math.max(allowedA, allowedB);
    var shooting = attr(p, 'shooting', 0.58), balance = clamp(Number(p.balance == null ? 0.9 : p.balance), 0.15, 1);
    var stamina = Math.max(0.55, Number(p.stamina) || 1), stride = hypot(Number(p.velocity && p.velocity.x) || 0, Number(p.velocity && p.velocity.y) || 0);
    var stability = clamp((0.78 + balance * 0.22) * (1 - clamp(stride / 10, 0, 0.55) * 0.22), 0.55, 1);
    var precision = shooting * (0.95 - clamp(Number(pressure) || 0, 0, 1.5) * 0.075) * stamina * stability;
    var facing = norm(p.facing || p.velocity || { x: 1, y: 0 }, { x: 1, y: 0 });
    var faceDot = clamp(facing.x * Math.cos(aimAngle) + facing.y * Math.sin(aimAngle), -1, 1);
    var orientation = Math.atan2(facing.x * Math.sin(aimAngle) - facing.y * Math.cos(aimAngle), faceDot);
    var bodyBias = clamp(-orientation * (0.08 + (1 - balance) * 0.32), -0.24, 0.24);
    var halfError = (1 - precision) * 0.21, errorLow = bodyBias - halfError, errorHigh = bodyBias + halfError;
    if (errorHigh - errorLow < 1e-6) return errorLow >= allowedLow && errorLow <= allowedHigh ? 1 : 0;
    var overlap = Math.max(0, Math.min(errorHigh, allowedHigh) - Math.max(errorLow, allowedLow));
    return clamp(overlap / (errorHigh - errorLow), 0, 1);
  }
  function buildBallTrajectory(belief, horizon) {
    var point = belief.estimatedPosition || belief.position, velocity = belief.velocity || {};
    var x = point.x, y = point.y, z = Number(belief.estimatedZ == null ? belief.position.z : belief.estimatedZ) || 0.11;
    var vx = Number(velocity.x) || 0, vy = Number(velocity.y) || 0;
    var vz = Number(belief.estimatedVelocityZ == null ? velocity.z : belief.estimatedVelocityZ) || 0;
    var steps = Math.ceil(Math.max(0, horizon) * 60), dt = 1 / 60, trajectory = [{ x: x, y: y, z: z, time: 0 }];
    for (var i = 0; i < steps; i++) {
      x += vx * dt; y += vy * dt; z += vz * dt;
      if (z > 0.11) vz -= 9.81 * dt;
      else {
        z = 0.11;
        if (vz < -1) vz = -vz * 0.42; else vz = 0;
        vx *= Math.max(0, 1 - 0.42 * dt); vy *= Math.max(0, 1 - 0.42 * dt);
      }
      if (i % 3 === 2 || i === steps - 1) trajectory.push({ x: x, y: y, z: z, time: (i + 1) * dt });
    }
    return trajectory;
  }
  function reachableBallMeeting(p, belief, anticipation) {
    if (!belief || belief.confidence < 0.18 || belief.ageTicks > 54) return null;
    var bv = belief.velocity || {}, speed = hypot(Number(bv.x) || 0, Number(bv.y) || 0);
    if (speed < 2.2) return null;
    var horizon = clamp(0.75 + anticipation * 1.35, 0.8, 2.1), trajectory = buildBallTrajectory(belief, horizon);
    var best = null;
    for (var sampleIndex = 1; sampleIndex < trajectory.length; sampleIndex++) {
      var q = trajectory[sampleIndex], t = q.time, d = dist(p, q);
      // Match the receive motor's .76 desired speed, stamina-scaled sprint
      // limit, acceleration and body-turn rate before claiming the ball is reachable.
      var actorArrival = playerArrivalTime(p, q, 0.76);
      var slack = actorArrival - t;
      if (!best || slack < best.slack) best = { point: q, time: t, distance: d, arrivalTime: actorArrival, slack: slack };
      if (slack <= 0.05) return best;
    }
    return best && best.slack <= 0.2 ? best : null;
  }
  function observedBallClaimRank(actor, teammates, point, movementFraction, options) {
    var ownArrival = playerArrivalTime(actor, point, movementFraction == null ? 0.76 : movementFraction);
    options = options || {};
    var maxTeammateDistance = Number.isFinite(Number(options.teammateRadius)) ? Number(options.teammateRadius) : 24;
    var arrivals = [{ id: id(actor), arrival: ownArrival }], bestTeammateArrival = Infinity;
    (teammates || []).forEach(function (mate) {
      if (!mate || mate.id == null || Number(mate.confidence) < 0.34 || Number(mate.ageTicks) > 36) return;
      if (options.outfieldOnly && isKeeper(mate)) return;
      if (dist(estimated(mate), point) > maxTeammateDistance) return;
      var arrival = playerArrivalTime(mate, point, 0.76);
      if (Number.isFinite(arrival) && arrival <= ownArrival + 1.15) {
        arrivals.push({ id: String(mate.id), arrival: arrival });
        bestTeammateArrival = Math.min(bestTeammateArrival, arrival);
      }
    });
    arrivals.sort(function (a, b) { return a.arrival - b.arrival || a.id.localeCompare(b.id); });
    var rank = arrivals.findIndex(function (entry) { return entry.id === id(actor); }) + 1;
    return {
      rank: Math.max(1, rank), count: arrivals.length, ownArrival: ownArrival,
      bestTeammateArrival: Number.isFinite(bestTeammateArrival) ? bestTeammateArrival : null,
      claimAdvantage: Number.isFinite(bestTeammateArrival) ? bestTeammateArrival - ownArrival : null,
      canContest: !Number.isFinite(bestTeammateArrival) || ownArrival <= bestTeammateArrival + 0.22
    };
  }
  function predictedGoalCrossing(belief, goalX, attackDirValue, pitch, ownerBelief, defendingTeamId, defendingKeeperId, keeperPosition) {
    if (!belief || belief.confidence < 0.2 || belief.ageTicks > 42) return null;
    // Handling restrictions depend on the observed physical action and intended
    // recipient, not the generic `deliberate` touch label (which also covers
    // headers). A direct teammate throw-in is restricted regardless of its
    // planned receiver; a foot kick is restricted only when aimed at this GK.
    var ownFreshRelease = defendingTeamId != null && belief.lastTouchTeamId === defendingTeamId
      && belief.confidence >= 0.55 && belief.ageTicks <= 30;
    var directTeammateThrowIn = ownFreshRelease && belief.lastTouchAction === 'throw-in';
    var target = belief.lastTouchTarget;
    var footKickToKeeper = ownFreshRelease && defendingKeeperId != null && keeperPosition && target
      && ['pass', 'throughBall', 'clear', 'shoot'].indexOf(belief.lastTouchAction) >= 0
      && dist(target, keeperPosition) <= 2.25;
    if (directTeammateThrowIn || footKickToKeeper) return null;
    // A carried ball can move goalward fast enough to resemble a shot. Only
    // treat it as a shot trajectory when this observer's fresh owner belief
    // and ball estimate no longer describe a controlled touch. A recent,
    // fast flight may retain the last owner's ID briefly after release.
    if (belief.ownerId && ownerBelief && String(ownerBelief.id) === String(belief.ownerId)
      && Number(ownerBelief.confidence) >= 0.3 && Number(ownerBelief.ageTicks) <= 45) {
      var knownBallPoint = belief.estimatedPosition || belief.position;
      var knownCarrierPoint = estimated(ownerBelief);
      var stillAtCarrierTouch = knownBallPoint && knownCarrierPoint && dist(knownBallPoint, knownCarrierPoint) <= 1.8;
      var ballVelocity = belief.velocity || {}, carrierVelocity = ownerBelief.velocity || {};
      var relativeBallSpeed = hypot((Number(ballVelocity.x) || 0) - (Number(carrierVelocity.x) || 0),
        (Number(ballVelocity.y) || 0) - (Number(carrierVelocity.y) || 0));
      var coherentCarry = stillAtCarrierTouch && relativeBallSpeed <= 5.5;
      if (coherentCarry) return null;
      // Speed alone cannot establish a release: a sprinting carrier can be
      // fast. A nearby ball moving with the observed carrier remains controlled;
      // strong relative motion or separation supports a released-flight read.
    }
    var start = belief.estimatedPosition || belief.position;
    // A rolling ball can remain goal-bound after friction drops its speed
    // below the old 2.5 m/s floor. The bounded physical projection below
    // already requires an actual in-mouth crossing within 1.8 seconds, so
    // eligibility depends on direction rather than an arbitrary speed.
    if (!start || (Number(belief.velocity.x) || 0) * attackDirValue >= -0.05) return null;
    var trajectory = buildBallTrajectory(belief, 1.8), previous = trajectory[0];
    for (var i = 1; i < trajectory.length; i++) {
      var point = trajectory[i], crossed = attackDirValue > 0 ? point.x <= goalX : point.x >= goalX;
      if (crossed) {
        var dx = point.x - previous.x, fraction = Math.abs(dx) < 1e-5 ? 0 : clamp((goalX - previous.x) / dx, 0, 1);
        var y = previous.y + (point.y - previous.y) * fraction;
        var z = previous.z + (point.z - previous.z) * fraction;
        if (Math.abs(y - pitch.width / 2) > (pitch.goalWidth || 7.32) / 2 + 0.5 || z > (pitch.goalHeight || 2.44) + 0.2) return null;
        return { x: goalX, y: y, z: z, time: previous.time + (point.time - previous.time) * fraction };
      }
      previous = point;
    }
    return null;
  }
  function coherentGroundOwner(ballBelief, ownerBelief) {
    if (!ballBelief || !ownerBelief || String(ballBelief.ownerId) !== String(ownerBelief.id)) return false;
    var ballConfidence = Number(ballBelief.confidence), ballAge = Number(ballBelief.ageTicks);
    var ownerConfidence = Number(ownerBelief.confidence), ownerAge = Number(ownerBelief.ageTicks);
    if (!Number.isFinite(ballConfidence) || !Number.isFinite(ballAge) || !Number.isFinite(ownerConfidence) || !Number.isFinite(ownerAge)
      || ballConfidence < 0.18 || ballAge > 12 || ownerConfidence < 0.3 || ownerAge > 12) return false;
    var ballPoint = ballBelief.estimatedPosition || ballBelief.position;
    var ownerPoint = estimated(ownerBelief);
    if (!ballPoint || !ownerPoint || !Number.isFinite(Number(ballPoint.x)) || !Number.isFinite(Number(ballPoint.y))
      || !Number.isFinite(Number(ownerPoint.x)) || !Number.isFinite(Number(ownerPoint.y)) || dist(ballPoint, ownerPoint) > 1.3) return false;
    var ballVelocity = ballBelief.velocity || {}, ownerVelocity = ownerBelief.velocity || {};
    var bvx = Number(ballVelocity.x), bvy = Number(ballVelocity.y), ovx = Number(ownerVelocity.x), ovy = Number(ownerVelocity.y);
    if (![bvx, bvy, ovx, ovy].every(Number.isFinite)) return false;
    var relativeSpeed = hypot(bvx - ovx, bvy - ovy);
    var height = Number(ballBelief.estimatedZ == null ? ballBelief.position && ballBelief.position.z : ballBelief.estimatedZ);
    var verticalSpeed = Number(ballBelief.estimatedVelocityZ == null ? ballVelocity.z : ballBelief.estimatedVelocityZ);
    if (!Number.isFinite(height) || !Number.isFinite(verticalSpeed)) return false;
    return relativeSpeed <= 2.8 && height <= 0.3 && Math.abs(verticalSpeed) <= 1.1;
  }
  function pushCandidate(arr, type, point, score, details) { arr.push({ type: type, target: point ? { x: point.x, y: point.y, z: 0 } : null, utility: score, details: details || {} }); }

  function decision(p, team, players, ball, match, pitch, context) {
    var beliefs = getBeliefs(p), teammates = beliefs.filter(function (e) { return e.teamId === p.teamId; }), opponents = beliefs.filter(function (e) { return e.teamId !== p.teamId; });
    var currentThroughLeadContexts = Object.create(null);
    // Teammate eligibility and pass targets come only from this actor's last
    // observed affiliation. Consulting live player.teamId here leaked unseen
    // neutral affiliation changes into candidate discovery.
    var teamPlayers = teammates.filter(function (entity) { return String(entity.id) !== id(p); });
    var pos = xy(p), perceivedBall = p.beliefState.ball, bp = perceivedBall && perceivedBall.estimatedPosition || p.ai.lastKnownBall || pos;
    if (perceivedBall) {
      p.ai.lastKnownBall = { x: bp.x, y: bp.y };
      p.ai.lastKnownBallTick = Number.isFinite(Number(perceivedBall.observedTick)) ? Number(perceivedBall.observedTick) : Number(match.tick) || 0;
    }
    var actionableBall = !!(perceivedBall && perceivedBall.confidence >= 0.18 && perceivedBall.ageTicks <= 54);
    var believedBallSpeed = perceivedBall ? hypot(Number(perceivedBall.velocity && perceivedBall.velocity.x) || 0, Number(perceivedBall.velocity && perceivedBall.velocity.y) || 0) : 0;
    var rememberedOwnerId = actionableBall && perceivedBall.confidence > 0.12 ? perceivedBall.ownerId : null;
    var rememberedOwnerBelief = rememberedOwnerId && p.beliefState.entities[id(rememberedOwnerId)];
    var coherentFastOwner = !!(believedBallSpeed > 6 && coherentGroundOwner(perceivedBall, rememberedOwnerBelief));
    // Fast speed by itself cannot distinguish a sprinting carrier from a
    // released ball. Retain only a fresh, grounded, locally coherent owner
    // claim; separated, aerial, stale, or low-confidence traces stay loose.
    var staleCarrierDuringFlight = !!(actionableBall && perceivedBall.ageTicks <= 12 && believedBallSpeed > 6 && !coherentFastOwner);
    var perceivedOwnerId = actionableBall && perceivedBall.confidence > 0.12 && !staleCarrierDuringFlight ? perceivedBall.ownerId : null;
    var perceivedOwnerBelief = perceivedOwnerId && p.beliefState.entities[id(perceivedOwnerId)];
    var perceivedOwnerTeamId = perceivedOwnerBelief && perceivedOwnerBelief.teamId;
    var dir = attackDir(team), goal = attackingGoal(team, pitch), carrying = hasBall(p, ball);
    var pendingRestart = match.state && match.state.restartInProgress;
    var isRestartTaker = !!(pendingRestart && String(pendingRestart.takerId) === id(p) && String(pendingRestart.teamId) === String(p.teamId));
    var pressure = carrying ? pressureAt(pos, opponents) : pressureAt(pos, opponents);
    var attrs = { vision: attr(p, 'vision', 0.48), decision: attr(p, 'decisionMaking', attr(p, 'decision', 0.48)), anticipation: attr(p, 'anticipation', 0.48), teamwork: attr(p, 'teamwork', 0.5), positioning: attr(p, 'positioning', 0.5), offball: attr(p, 'offBallIntelligence', 0.48), composure: attr(p, 'composure', 0.48), creativity: attr(p, 'creativity', 0.45) };
    var rng = rngFor(p, match), candidates = [], ballClaimRank = null;
    var teamIntent = context && context.intent;
    if (teamIntent && typeof teamIntent === 'object') teamIntent = teamIntent.type || teamIntent.name || teamIntent.mode;
    teamIntent = String(teamIntent || 'balanced').toLowerCase();

    if (carrying) {
      var goalDist = dist(pos, goal), forward = (goal.x - pos.x) * dir;
        var shotRange = isForward(p) ? 25 : 20;
      if (!isKeeper(p) && goalDist < shotRange && forward > 0) {
        var knownKeeper = opponents.filter(function (e) { return e.isGoalkeeper || /goalkeeper|keeper/.test(String(e.role || '').toLowerCase()); })
          .sort(function (a, b) { return dist(pos, estimated(a)) - dist(pos, estimated(b)); })[0];
        var keeperPoint = knownKeeper ? estimated(knownKeeper) : null;
        var goalCenter = pitch.width / 2;
        var preferredShotY = keeperPoint ? clamp(keeperPoint.y <= goalCenter ? goalCenter + 2.8 : goalCenter - 2.8, goalCenter - 3.25, goalCenter + 3.25)
          : clamp(goalCenter + (pos.y < goalCenter ? 2.1 : -2.1), goalCenter - 3.25, goalCenter + 3.25);
        var finishing = attr(p, 'finishing', attr(p, 'shooting', 0.45));
        var shotAngle = goalMouthAngleScore(pos, goal, pitch);
        var shotPower = clamp(0.62 + attr(p, 'shooting', 0.5) * 0.32, 0.55, 1);
        var shotSpeed = 13 + shotPower * 24;
        var shotFacing = norm(p.facing || p.velocity || { x: dir, y: 0 }, { x: dir, y: 0 });
        // A carrier's ball is at the real controlled foot contact point. Reuse
        // that same origin as strike() so the aim-clearance estimate matches the
        // direction physics will execute, including near-post shots.
        var shotOrigin = ball && ball.ownerId === p.id
          ? { x: Number(ball.position.x), y: Number(ball.position.y) }
          : { x: pos.x + shotFacing.x * 0.43, y: pos.y + shotFacing.y * 0.43 };
        var outfieldShotBlockers = opponents.filter(function (e) { return !(e.isGoalkeeper || /goalkeeper|keeper/.test(String(e.role || ''))); });
        var shotBase = 0.73 - goalDist / (shotRange * 1.65) - pressure * 0.17 + attr(p, 'shooting', 0.45) * 0.12 + finishing * 0.11 + attr(p, 'composure', 0.5) * 0.06 - 0.13;
        // Compare the existing far-post choice with central and opposite-side
        // points using the same release-origin/error model. This lets an actor
        // keep a shot when it can choose a more robust ray, while a keeper belief
        // can still make that alternative unattractive.
        var targetLimit = (Number(pitch.goalWidth) || 7.32) * 0.5 - 0.13;
        var shotYs = [preferredShotY, goalCenter, goalCenter - targetLimit, goalCenter + targetLimit];
        var shot = -Infinity, shotTarget = null, shotPlacementChance = 0, shotLaneRisk = 0, keeperThreat = 0, keeperCoverage = 0;
        var seenShotYs = {};
        for (var shotIndex = 0; shotIndex < shotYs.length; shotIndex++) {
          var candidateY = clamp(shotYs[shotIndex], goalCenter - targetLimit, goalCenter + targetLimit);
          var targetKey = candidateY.toFixed(3);
          if (seenShotYs[targetKey]) continue;
          seenShotYs[targetKey] = true;
          var candidateTarget = { x: goal.x, y: candidateY };
          var candidatePlacement = shotMouthExecutionChance(shotOrigin, candidateTarget, p, pitch, pressure);
          var candidateLaneRisk = shotLaneInterceptionRisk(shotOrigin, candidateTarget, shotSpeed, outfieldShotBlockers);
          var candidateKeeperRisk = opponents.filter(function (e) { return e.isGoalkeeper || /goalkeeper|keeper/.test(String(e.role || '')); })
            .reduce(function (risk, e) { return Math.max(risk, goalkeeperShotInterceptionRisk(shotOrigin, candidateTarget, shotSpeed, e)); }, 0);
          // A shot's value is realized only when execution sends it through
          // the legal mouth. Treat the base shot benefit and aperture bonus as
          // conditional on that physical placement chance; keeper/lane risks
          // remain separate observed costs and are each charged once.
          var positiveShotBenefit = Math.max(0, shotBase + shotAngle * 0.25);
          var candidateUtility = clamp(positiveShotBenefit * candidatePlacement - candidateKeeperRisk * 0.35 - candidateLaneRisk * 0.24, 0.02, 0.88);
          if (candidateUtility > shot) {
            shot = candidateUtility; shotTarget = candidateTarget; shotPlacementChance = candidatePlacement;
            shotLaneRisk = candidateLaneRisk; keeperThreat = candidateKeeperRisk;
            keeperCoverage = knownKeeper ? Math.exp(-Math.abs(candidateY - keeperPoint.y) / 2.2) * clamp(knownKeeper.confidence || 0.5, 0.2, 1) : 0;
          }
        }
        pushCandidate(candidates, 'shoot', shotTarget, shot, { goalDistance: goalDist, pressure: pressure, shotAngle: shotAngle, shotPlacementChance: shotPlacementChance, shotLaneRisk: shotLaneRisk, shotSpeed: shotSpeed, keeperCoverage: keeperCoverage, keeperInterceptionRisk: keeperThreat, knownKeeper: !!knownKeeper });
      }
      var passPeers = teamPlayers.filter(function (mate) { return !!p.beliefState.entities[id(mate)]; });
      // Physics places a controlled ball at the carrier's facing foot. Start
      // pass-lane and flight estimates there so a nearby defender can contest
      // the first metres before a midfield sample sees the lane.
      var kickFacing = norm(p.facing || p.velocity || { x: dir, y: 0 }, { x: dir, y: 0 });
      var passOrigin = { x: pos.x + kickFacing.x * 0.43, y: pos.y + kickFacing.y * 0.43 };
      var attentionBudget = clamp(Math.round(1 + attrs.vision * 4 + attrs.decision * 2), 1, 7);
      passPeers.sort(function (a, b) {
        var ae = p.beliefState.entities[id(a)], be = p.beliefState.entities[id(b)];
        var ab = estimated(ae), bb = estimated(be), ad = dist(pos, ab), bd = dist(pos, bb);
        // Attention discovery balances progression with a credible nearby
        // outlet. Rank safety from observed locations before spending detailed
        // lane-TTC scoring; this keeps one-touch recycling options discoverable
        // even when several marked forwards sit far ahead.
        var aPressure = pressureAt(ab, opponents), bPressure = pressureAt(bb, opponents);
        var aMid = pressureAt({ x: (pos.x + ab.x) * 0.5, y: (pos.y + ab.y) * 0.5 }, opponents);
        var bMid = pressureAt({ x: (pos.x + bb.x) * 0.5, y: (pos.y + bb.y) * 0.5 }, opponents);
        var av = progress(team, pos, ab) * 0.014 - ad * 0.006 + (ae.confidence || 0) * 0.07 - clamp(Number(ae.ageTicks) / 120, 0, 1) * 0.045 - aPressure * 0.11 - aMid * 0.13;
        var bv = progress(team, pos, bb) * 0.014 - bd * 0.006 + (be.confidence || 0) * 0.07 - clamp(Number(be.ageTicks) / 120, 0, 1) * 0.045 - bPressure * 0.11 - bMid * 0.13;
        var aOutlet = ad >= 5 && ad <= 18 && aPressure < 0.55 && aMid < 0.65;
        var bOutlet = bd >= 5 && bd <= 18 && bPressure < 0.55 && bMid < 0.65;
        if (aOutlet) av += 0.075;
        if (bOutlet) bv += 0.075;
        return bv - av || id(a).localeCompare(id(b));
      });
      passPeers = passPeers.slice(0, attentionBudget);
      for (var i = 0; i < passPeers.length; i++) {
        var mate = passPeers[i], seenMate = p.beliefState.entities[id(mate)];
        var mp = estimated(seenMate), passDir = progress(team, pos, mp), lane = dist(passOrigin, mp);
        if (lane < 4 || lane > 43) continue;
        var predictedPower = clamp(lane / 35, 0.22, 1);
        // Basic ground passes and through balls use different launch profiles
        // in the motor. Estimate the ball at the actual weighted target rather
        // than using only the receiver's current position as the flight range.
        var predictedLift = 0;
        var flightTime = estimatedPassArrival(lane, predictedPower, predictedLift);
        // Beyond about two seconds, movement direction becomes too uncertain
        // to extend linearly; the target remains a weighted future point.
        var receiverConfidence = clamp(Number(seenMate.confidence) || 0, 0, 1);
        var receiverAge = Math.max(0, Number(seenMate.ageTicks) || 0);
        // Running lead shrinks when the observation is uncertain or old;
        // distant remembered velocity is not a reliable receiving run.
        var predictionReliability = clamp((receiverConfidence - 0.08) / 0.72, 0.25, 1) * clamp(1 - receiverAge / 240, 0.35, 1);
        var leadTime = Math.min(2.1, flightTime * 0.78) * predictionReliability;
        leadTime = capLeadBeforePitchBoundary(mp, seenMate.velocity, leadTime, pitch, 1.5);
        var receiverUncertaintyPenalty = (1 - receiverConfidence) * 0.08 + clamp(receiverAge / 180, 0, 1) * 0.06;
        var predicted = clampPoint({ x: mp.x + (seenMate.velocity.x || 0) * leadTime, y: mp.y + (seenMate.velocity.y || 0) * leadTime }, pitch, 1.5);
        for (var timingPass = 0; timingPass < 2; timingPass++) {
          var predictedRange = dist(passOrigin, predicted), targetPower = clamp(predictedRange / 35, 0.22, 1);
          flightTime = estimatedPassArrival(predictedRange, targetPower, predictedLift);
          leadTime = Math.min(2.1, flightTime * 0.78) * predictionReliability;
          leadTime = capLeadBeforePitchBoundary(mp, seenMate.velocity, leadTime, pitch, 1.5);
          predicted = clampPoint({ x: mp.x + (seenMate.velocity.x || 0) * leadTime, y: mp.y + (seenMate.velocity.y || 0) * leadTime }, pitch, 1.5);
        }
        var targetRange = dist(passOrigin, predicted), targetPower = clamp(targetRange / 35, 0.22, 1);
        flightTime = estimatedPassArrival(targetRange, targetPower, predictedLift);
        var receiverArrivalTime = playerArrivalTime(seenMate, predicted, 0.76);
        var receiverArrivalDeficit = Math.max(0, receiverArrivalTime - flightTime - 0.2);
        var receiverTimingPenalty = clamp(receiverArrivalDeficit * 0.045, 0, 0.14);
        var targetSidelineMargin = Math.min(predicted.y, pitch.width - predicted.y);
        var boundaryRisk = clamp((5 - targetSidelineMargin) / 5, 0, 1);
        var boundaryPenalty = boundaryRisk * (0.025 + (1 - attr(p, 'shortPassing', attr(p, 'passing', 0.5))) * 0.025);
        var receiverPressure = pressureAt(predicted, opponents), interception = pressureAt({ x: (pos.x + predicted.x) / 2, y: (pos.y + predicted.y) / 2 }, opponents);
        var laneValue = clamp(Math.max(0, passDir) / 24, 0, 1), tech = isKeeper(p) ? attr(p, 'kicking', 0.5) : attr(p, 'shortPassing', attr(p, 'passing', 0.5));
        var options = teamPlayers.filter(function (other) {
          var belief = p.beliefState.entities[id(other)];
          return other.id !== mate.id && belief && belief.confidence > 0.35 && dist(estimated(belief), predicted) < 21 && pressureAt(estimated(belief), opponents) < 0.8;
        }).length;
        var laneRisk = passLaneInterceptionRisk(passOrigin, predicted, targetPower, predictedLift, opponents);
        var receiverFacing = seenMate.facing ? norm(seenMate.facing, { x: 0, y: 0 }) : { x: 0, y: 0 };
        var receiveFrom = norm({ x: pos.x - predicted.x, y: pos.y - predicted.y }, { x: 0, y: 0 });
        var receiverOrientation = seenMate.facing ? clamp((receiverFacing.x * receiveFrom.x + receiverFacing.y * receiveFrom.y + 1) * 0.5, 0, 1) : 0.5;
        var receiverSafety = clamp((minOpponentDistance(predicted, opponents) - 3) / 16, 0, 1) * (1 - clamp(receiverPressure, 0, 1)) * (1 - laneRisk);
        var basic = 0.3 + laneValue * 0.18 + attrs.vision * 0.11 + attrs.teamwork * 0.08 + tech * 0.12 + Math.min(options, 3) * 0.024 + (receiverOrientation - 0.5) * 0.07 + receiverSafety * clamp(passDir / 10, 0, 1) * 0.06 - receiverPressure * 0.18 - interception * 0.1 - laneRisk * 0.22 - Math.max(0, 4 - lane) * 0.07 - receiverUncertaintyPenalty - receiverTimingPenalty - boundaryPenalty;
        // Law checks the receiver's position at the instant of the kick, not
        // the future interception point. The latter may legally lie beyond
        // the defensive line for an onside runner.
        var offsidePenalty = thisOffsideRisk(team, mp, opponents, pitch, seenMate, bp.x);
        basic -= offsidePenalty * (0.18 + attrs.anticipation * 0.2);
        var throughEligible = isForward(mate) || progress(team, pos, mp) > 6;
        var runSpace = Math.max(0, minOpponentDistance(predicted, opponents) - 5);
        var runSpeed = (Number(seenMate.velocity.x) || 0) * dir;
        currentThroughLeadContexts[id(mate)] = {
          predicted: predicted,
          velocity: seenMate.velocity || {},
          predictionReliability: predictionReliability,
          runSpeed: runSpeed
        };
        var runBonus = clamp(runSpeed / 4.5, 0, 1) * 0.1;
        var spaceBonus = clamp((runSpace - 5) / 28, 0, 1) * 0.1;
        var throughScore = basic + attrs.vision * 0.04 + attrs.anticipation * 0.04 + attr(p, 'throughBalls', tech) * 0.05 + runBonus + spaceBonus - offsidePenalty * 0.5;
        pushCandidate(candidates, 'pass', predicted, basic, { targetId: mate.id, lane: lane, kickOrigin: passOrigin, pressure: receiverPressure, progression: passDir, progressionValue: laneValue, arrivalTime: flightTime, leadTime: leadTime, receiverConfidence: receiverConfidence, receiverAgeTicks: receiverAge, receiverUncertaintyPenalty: receiverUncertaintyPenalty, receiverArrivalTime: receiverArrivalTime, receiverArrivalDeficit: receiverArrivalDeficit, receiverTimingPenalty: receiverTimingPenalty, targetSidelineMargin: targetSidelineMargin, boundaryRisk: boundaryRisk, boundaryPenalty: boundaryPenalty, laneInterceptionRisk: laneRisk, receiverOrientation: receiverOrientation, nextSupportOptions: options });
        var explicitForwardRun = runSpeed > 0.75;
        var openSpaceFallback = runSpace > 9 && attrs.vision > 0.65 && attrs.anticipation > 0.6;
        var throughOpportunity = explicitForwardRun || openSpaceFallback;
        if (throughEligible && throughOpportunity && forward > 2 && lane < 32) {
          var throughTarget = clampPoint({ x: predicted.x + dir * Math.min(5 + attrs.anticipation * 5, runSpace * 0.55), y: predicted.y }, pitch, 1);
          var fallbackLeadCoherent = throughLeadSupportedByObservedMotion(throughTarget, predicted, seenMate.velocity);
          if (openSpaceFallback && !explicitForwardRun && predictionReliability === 1 && !fallbackLeadCoherent) {
            // The speculative extra lead opposes a fully reliable local run
            // observation. Keep the ordinary pass/carry candidates intact.
          } else {
          var throughRange = dist(passOrigin, throughTarget), throughPower = clamp(throughRange / 35, 0.22, 1), throughLift = 0.12;
          var throughArrivalTime = estimatedPassArrival(throughRange, throughPower, throughLift);
          var throughReceiverArrivalTime = playerArrivalTime(seenMate, throughTarget, 0.76);
          var throughTimingPenalty = clamp(Math.max(0, throughReceiverArrivalTime - throughArrivalTime - 0.2) * 0.11, 0, 0.32);
          var throughBoundaryRisk = clamp((5 - Math.min(throughTarget.y, pitch.width - throughTarget.y)) / 5, 0, 1);
          var throughBoundaryPenalty = throughBoundaryRisk * (0.025 + (1 - tech) * 0.025);
          var throughLaneRisk = passLaneInterceptionRisk(passOrigin, throughTarget, throughPower, throughLift, opponents);
          throughScore -= Math.max(0, throughLaneRisk - laneRisk) * 0.22;
          throughScore -= throughTimingPenalty + throughBoundaryPenalty;
        pushCandidate(candidates, 'throughBall', throughTarget, throughScore, { targetId: mate.id, offsideRisk: offsidePenalty, kickOrigin: passOrigin, arrivalTime: throughArrivalTime, leadTime: leadTime, receiverConfidence: receiverConfidence, receiverAgeTicks: receiverAge, receiverUncertaintyPenalty: receiverUncertaintyPenalty, receiverArrivalTime: throughReceiverArrivalTime, receiverArrivalDeficit: Math.max(0, throughReceiverArrivalTime - throughArrivalTime), receiverTimingPenalty: throughTimingPenalty, targetSidelineMargin: Math.min(throughTarget.y, pitch.width - throughTarget.y), boundaryRisk: throughBoundaryRisk, boundaryPenalty: throughBoundaryPenalty, runnerSpeed: runSpeed, laneInterceptionRisk: throughLaneRisk, receiverOrientation: receiverOrientation, nextSupportOptions: options });
          }
        }
      }
      var closest = nearest(opponents, pos), closestPoint = closest.player ? estimated(closest.player) : { x: pos.x, y: pos.y };
      var centerY = pitch.width / 2, centerPull = clamp((centerY - pos.y) * 0.34, -5.5, 5.5);
      var escapeSide = closestPoint.y <= pos.y ? 1 : -1;
      var keeperOwnGoalX = dir > 0 ? 0 : pitch.length;
      var keeperOwnGoalDepth = Math.abs(pos.x - keeperOwnGoalX);
      var keeperPressOpponent = null, keeperPressDistance = Infinity, keeperPressClosing = 0;
      if (isKeeper(p) && ball && ball.ownerId === p.id && !ball.handControl && keeperOwnGoalDepth <= 20) {
        opponents.forEach(function (opponent) {
          var confidence = Number(opponent.confidence), age = Number(opponent.ageTicks);
          if (!Number.isFinite(confidence) || confidence < 0.55 || !Number.isFinite(age) || age > 18) return;
          var opponentPoint = estimated(opponent), gap = dist(pos, opponentPoint);
          if (gap >= keeperPressDistance) return;
          var relativeX = Number(opponent.velocity && opponent.velocity.x) - Number(p.velocity && p.velocity.x);
          var relativeY = Number(opponent.velocity && opponent.velocity.y) - Number(p.velocity && p.velocity.y);
          var closing = gap > 0.001 ? -((opponentPoint.x - pos.x) * relativeX + (opponentPoint.y - pos.y) * relativeY) / gap : 0;
          keeperPressOpponent = opponent; keeperPressDistance = gap; keeperPressClosing = Number.isFinite(closing) ? closing : 0;
        });
      }
      var keeperSafeOutlet = candidates.some(function (candidate) {
        if (candidate.type !== 'pass') return false;
        var details = candidate.details || {};
        return Number(candidate.utility) >= 0.38 && Number(details.laneInterceptionRisk) <= 0.45
          && Number(details.receiverOrientation) >= 0.16 && Number(details.receiverConfidence) >= 0.62
          && Number(details.receiverAgeTicks) <= 18 && Number(details.nextSupportOptions) >= 1;
      });
      var keeperPressedFootRisk = !!(keeperPressOpponent && keeperPressDistance <= 5.2
        && pressure >= 0.38 && keeperPressClosing >= 0.1);
      var keeperPressedWithoutSafeOutlet = keeperPressedFootRisk && !keeperSafeOutlet;
      // Discover only three compact routes. The straight lane preserves a
      // clear channel, the half-space route connects a wide carrier to goal,
      // and the escape route uses the locally perceived pressure direction.
      var carryRoutes = [
        { name: 'straight-channel', point: { x: pos.x + dir * 5.5, y: pos.y } },
        { name: 'central-halfspace', point: { x: pos.x + dir * 5, y: pos.y + centerPull } },
        { name: 'pressure-escape', point: { x: pos.x + dir * 4, y: pos.y + escapeSide * (pressure > 0.18 ? 4.2 : clamp(centerPull, -2.4, 2.4)) } }
      ];
      var currentSpace = minOpponentDistance(pos, opponents);
      carryRoutes.forEach(function (route) {
        var carryTarget = clampPoint(route.point, pitch, 1), carrySpace = minOpponentDistance(carryTarget, opponents);
        var forwardGain = Math.max(0, progress(team, pos, carryTarget));
        var openSpaceValue = clamp((carrySpace - 4) / 16, 0, 1), escapeGain = clamp((carrySpace - currentSpace + 1) / 10, 0, 1);
        var pathPressure = 0, pathSpace = 40;
        for (var sample = 1; sample <= 3; sample++) {
          var f = sample / 4, pathPoint = { x: pos.x + (carryTarget.x - pos.x) * f, y: pos.y + (carryTarget.y - pos.y) * f };
          pathPressure += pressureAt(pathPoint, opponents) / 3;
          pathSpace = Math.min(pathSpace, minOpponentDistance(pathPoint, opponents));
        }
        var actorArrival = playerArrivalTime(p, carryTarget, 0.88), defenderArrival = Infinity;
        opponents.forEach(function (opponent) { defenderArrival = Math.min(defenderArrival, playerArrivalTime(opponent, carryTarget, 0.9)); });
        var arrivalAdvantage = Number.isFinite(defenderArrival) ? clamp((defenderArrival - actorArrival + 0.35) / 2, 0, 1) : 0.5;
        var centralityGain = clamp((Math.abs(pos.y - centerY) - Math.abs(carryTarget.y - centerY)) / 6, -0.5, 1);
        var goalDistanceGain = dist(pos, goal) - dist(carryTarget, goal);
        var goalConnection = clamp(goalDistanceGain / 7, 0, 1) * (0.45 + (1 - clamp(Math.abs(carryTarget.y - centerY) / (pitch.width * 0.5), 0, 1)) * 0.55);
        var nextOptions = teamPlayers.filter(function (mate) {
          var belief = p.beliefState.entities[id(mate)];
          if (!belief || belief.confidence < 0.35) return false;
          var matePoint = estimated(belief), d = dist(matePoint, carryTarget);
          return d >= 6 && d <= 20 && pressureAt(matePoint, opponents) < 0.85;
        }).length;
        var targetPressure = pressureAt(carryTarget, opponents);
        var carryScore = 0.35 + attr(p, 'dribbling', 0.48) * 0.16 + attr(p, 'ballCarrying', attr(p, 'dribbling', 0.48)) * 0.12
          + clamp(forwardGain / 10, 0, 1) * 0.055 + openSpaceValue * 0.08 + escapeGain * 0.035
          + arrivalAdvantage * 0.075 + centralityGain * 0.055 + goalConnection * 0.045 + Math.min(nextOptions, 3) * 0.012
          - pressure * (0.11 - attrs.composure * 0.035) - targetPressure * 0.12 - pathPressure * 0.1
          - Math.max(0, 4 - pathSpace) * 0.015;
        var keeperRiskPenalty = 0;
        if (keeperPressedFootRisk && forwardGain > 0) {
          var depthExposure = clamp((keeperOwnGoalDepth - 6) / 12, 0, 1);
          var pressExposure = clamp((5.2 - keeperPressDistance) / 3.4, 0, 1) * clamp((pressure - 0.28) / 0.48, 0, 1);
          keeperRiskPenalty = 0.72 * depthExposure * pressExposure * clamp(forwardGain / 5.5, 0, 1);
          carryScore -= keeperRiskPenalty;
        }
        pushCandidate(candidates, 'carry', carryTarget, carryScore, { route: route.name, pressure: pressure, targetPressure: targetPressure, pathPressure: pathPressure, defenderArrival: Number.isFinite(defenderArrival) ? defenderArrival : null, actorArrival: actorArrival, arrivalAdvantage: arrivalAdvantage, progressionGain: forwardGain, spaceAvailable: carrySpace, pathSpace: pathSpace, spaceGain: carrySpace - currentSpace, centralityGain: centralityGain, goalConnection: goalConnection, nextOptions: nextOptions, keeperPressRiskPenalty: keeperRiskPenalty });
      });
      if (keeperPressedWithoutSafeOutlet) {
        var retainDistance = Math.min(2.8, Math.max(0, keeperOwnGoalDepth - 7));
        var retainTarget = clampPoint({ x: pos.x - dir * retainDistance, y: pos.y + escapeSide * 3.2 }, pitch, 1);
        var retainSpace = minOpponentDistance(retainTarget, opponents);
        var retainTargetPressure = pressureAt(retainTarget, opponents);
        var retainUtility = 0.47 + attr(p, 'composure', 0.5) * 0.04 + attr(p, 'firstTouch', 0.5) * 0.035
          + clamp((retainSpace - keeperPressDistance) / 8, 0, 1) * 0.09 - retainTargetPressure * 0.08;
        pushCandidate(candidates, 'carry', retainTarget, retainUtility, { route: 'keeper-goal-depth-retain', pressure: pressure,
          targetPressure: retainTargetPressure, progressionGain: 0, spaceAvailable: retainSpace,
          keeperPressureEscape: true, keeperOwnGoalDepth: keeperOwnGoalDepth,
          observedPresserId: id(keeperPressOpponent), observedPresserDistance: keeperPressDistance,
          observedPresserClosingSpeed: keeperPressClosing });
      }
      pushCandidate(candidates, 'hold', pos, 0.24 + attrs.composure * 0.08 - pressure * 0.08, { pressure: pressure });
      var ownGoalX = dir > 0 ? 0 : pitch.length;
      var ownGoalDistance = Math.abs(pos.x - ownGoalX);
      var credibleOutlet = candidates.some(function (candidate) {
        return candidate.type === 'pass' && Number(candidate.utility) >= 0.39 &&
          Number(candidate.details && candidate.details.pressure) < 0.68 &&
          Number(candidate.details && candidate.details.laneInterceptionRisk) < 0.58;
      });
      // Clearance is an emergency choice near our own goal under pressure when
      // no credible short outlet exists. `forward` is distance to the *opposing*
      // goal, so it must never make a defender clear from the attacking end.
      var clearanceUrgency = ownGoalDistance < 36 && pressure > 0.94 ||
        ownGoalDistance < 22 && pressure > 0.52 && !credibleOutlet;
      if (isDefender(p) && clearanceUrgency) pushCandidate(candidates, 'clear', clampPoint({ x: pos.x + dir * 24, y: pos.y + (random(rng) - 0.5) * 18 }, pitch, 1), 0.33 + pressure * 0.17 + attr(p, 'discipline', 0.5) * 0.03, { pressure: pressure, ownGoalDistance: ownGoalDistance, credibleOutlet: credibleOutlet });
    } else if (isKeeper(p)) {
      var ownX = dir > 0 ? 0 : pitch.length;
      var sweepProfile = attr(p, 'sweeping', 0.5);
      var defensiveLine = clamp(Number(context && context.defensiveLine != null ? context.defensiveLine : team.tactics && team.tactics.defensiveLine) || 0.58, 0.2, 0.95);
      var homeDepth = clamp(3.1 + (sweepProfile - 0.5) * 2.4 + (defensiveLine - 0.58) * 3.2, 1.5, 8);
      var home = target(ownX + dir * homeDepth, pitch.width / 2);
      var isOwnGoalZone = Math.abs(pos.x - ownX) < 17;
      var keeperPoint = actionableBall ? bp : { x: pitch.length / 2, y: pitch.width / 2 };
      var bDistance = dist(p, keeperPoint);
      if (perceivedOwnerId && perceivedOwnerTeamId === p.teamId) {
        pushCandidate(candidates, 'hold', home, 0.62, { keeper: true });
      } else {
        var y = clamp(keeperPoint.y, pitch.width * 0.29, pitch.width * 0.71);
        var keeperBall = actionableBall ? perceivedBall : null;
        var sweep = sweepProfile;
        var flightOwnerBelief = keeperBall && keeperBall.ownerId && p.beliefState.entities[id(keeperBall.ownerId)];
        var goalThreat = predictedGoalCrossing(keeperBall, ownX, dir, pitch, flightOwnerBelief, p.teamId, p.id, p.position);
        var observedCarrier = perceivedOwnerBelief && perceivedOwnerTeamId !== p.teamId &&
          Number(perceivedOwnerBelief.confidence) >= 0.3 && Number(perceivedOwnerBelief.ageTicks) <= 45 ? estimated(perceivedOwnerBelief) : null;
        var carrierGoalDistance = observedCarrier ? Math.abs(observedCarrier.x - ownX) : Infinity;
        var closeCarrierThreat = !!(observedCarrier && (observedCarrier.x - ownX) * dir > 0 && carrierGoalDistance < 24);
        // A keeper may challenge a close, controlled opponent only from a
        // fresh local view of both carrier and ball. This is an intent to
        // contest a reachable foot ball, not knowledge of its hidden owner.
        var keeperBallHeight = perceivedBall ? Number(perceivedBall.estimatedZ == null ? perceivedBall.position.z : perceivedBall.estimatedZ) || 0 : Infinity;
        var keeperOwnBox = actionableBall && (dir > 0 ? bp.x <= 16.5 : bp.x >= pitch.length - 16.5)
          && Math.abs(bp.y - pitch.width / 2) <= 20.16;
        // The fast-flight heuristic above intentionally drops stale owner
        // claims. For a hand challenge, however, retain a fresh owner claim
        // only when the observed ball remains close to that observed carrier
        // and their observed velocities agree. This distinguishes a sprinting
        // dribbler from a released shot without consulting live ownership.
        var keeperChallengeOwnerId = actionableBall && perceivedBall.ownerId || null;
        var keeperChallengeOwner = keeperChallengeOwnerId && p.beliefState.entities[id(keeperChallengeOwnerId)];
        var keeperChallengeCarrier = keeperChallengeOwner && keeperChallengeOwner.teamId !== p.teamId
          && Number(keeperChallengeOwner.confidence) >= 0.72 && Number(keeperChallengeOwner.ageTicks) <= 12
          ? estimated(keeperChallengeOwner) : null;
        var keeperOwnerBallGap = keeperChallengeCarrier ? dist(keeperChallengeCarrier, bp) : Infinity;
        var ownerVelocity = keeperChallengeOwner && keeperChallengeOwner.velocity || {};
        var observedBallVelocity = perceivedBall && perceivedBall.velocity || {};
        var relativeBallOwnerSpeed = hypot((Number(observedBallVelocity.x) || 0) - (Number(ownerVelocity.x) || 0),
          (Number(observedBallVelocity.y) || 0) - (Number(ownerVelocity.y) || 0));
        coherentFastOwner = coherentFastOwner && !!(keeperChallengeCarrier && keeperOwnerBallGap <= 1.3 && relativeBallOwnerSpeed <= 2.8);
        var challengeCarrier = coherentFastOwner ? keeperChallengeCarrier : observedCarrier;
        var challengeCarrierId = coherentFastOwner ? keeperChallengeOwnerId : perceivedOwnerId;
        var challengeCarrierBelief = coherentFastOwner ? keeperChallengeOwner : perceivedOwnerBelief;
        var keeperCarrierFacing = challengeCarrierBelief && norm(challengeCarrierBelief.facing || challengeCarrierBelief.velocity || { x: -dir, y: 0 }, { x: -dir, y: 0 });
        var keeperBallAhead = keeperCarrierFacing && challengeCarrier && ((bp.x - challengeCarrier.x) * keeperCarrierFacing.x + (bp.y - challengeCarrier.y) * keeperCarrierFacing.y);
        var keeperGoalkeeperBehindCarrier = keeperCarrierFacing && challengeCarrier && ((pos.x - challengeCarrier.x) * keeperCarrierFacing.x + (pos.y - challengeCarrier.y) * keeperCarrierFacing.y);
        var carrierShieldsKeeperBall = Number(keeperBallAhead) > 0.18 && Number(keeperGoalkeeperBehindCarrier) < Number(keeperBallAhead) - 0.12;
        var keeperBallGap = challengeCarrier ? dist(challengeCarrier, bp) : Infinity;
        var keeperContactDistance = dist(pos, bp);
        var freshControlledThreat = !!(challengeCarrierId && challengeCarrierBelief && challengeCarrierBelief.teamId !== p.teamId
          && Number(challengeCarrierBelief.confidence) >= 0.72 && Number(challengeCarrierBelief.ageTicks) <= 12
          && actionableBall && Number(perceivedBall.confidence) >= 0.72 && Number(perceivedBall.ageTicks) <= 12
          && (!staleCarrierDuringFlight || coherentFastOwner) && keeperBallHeight <= 0.3 && keeperBallGap <= 1.35 && keeperContactDistance <= 2.25
          && keeperOwnBox && !carrierShieldsKeeperBall && match.tick >= (Number(p._challengeRecoveryUntilTick) || 0));
        if (freshControlledThreat) {
          var keeperToBall = norm({ x: bp.x - pos.x, y: bp.y - pos.y }, { x: dir, y: 0 });
          var keeperFacingBall = (Number(p.facing && p.facing.x) || 0) * keeperToBall.x + (Number(p.facing && p.facing.y) || 0) * keeperToBall.y;
          var keeperBodyGap = dist(pos, challengeCarrier);
          if (keeperFacingBall >= 0.2 && keeperBodyGap >= 0.72) {
            var keeperChallengeQuality = (attr(p, 'handling', 0.5) + attr(p, 'catching', 0.5) + attr(p, 'reflexes', 0.5)) / 3;
            var keeperChallengeScore = 0.66 + (1 - clamp(keeperContactDistance / 2.25, 0, 1)) * 0.09
              + keeperChallengeQuality * 0.07 + challengeCarrierBelief.confidence * 0.04
              + clamp(carrierGoalDistance / 24, 0, 1) * 0.035;
            pushCandidate(candidates, 'challenge', clampPoint(bp, pitch, 0.5), keeperChallengeScore,
              { keeper: true, targetId: challengeCarrierId, physicsAction: 'keeperchallenge', handChallenge: true,
                ballDistance: keeperContactDistance, carrierDistance: keeperBodyGap, carrierBallGap: keeperBallGap,
                keeperFacingBall: keeperFacingBall, keeperOwnBox: true, carrierShieldsKeeperBall: false,
                beliefConfidence: challengeCarrierBelief.confidence, ballConfidence: perceivedBall.confidence,
                coherentFastOwner: coherentFastOwner, relativeBallOwnerSpeed: relativeBallOwnerSpeed });
          }
        }
        var returningForCarrierThreat = !!(observedCarrier && (observedCarrier.x - ownX) * dir > 0 && carrierGoalDistance < 44);
        var advance = clamp((Math.abs(keeperPoint.x - ownX) - 8) * 0.17, 2, 13);
        var keeperY = goalThreat ? goalThreat.y : mix(pitch.width / 2, y, 0.18);
        var profileDepth = clamp(advance + (sweep - 0.5) * 4 + (defensiveLine - 0.58) * 5.2, 2, 13);
        var carrierReturnDepth = null;
        if (returningForCarrierThreat && !closeCarrierThreat) {
          // Begin the return while a freshly observed carrier is still outside
          // immediate shooting range. This gives a goalkeeper time to recover
          // from a legitimate sweep without flattening the normal sweeper
          // profile when play is farther away.
          carrierReturnDepth = clamp(2.6 + (sweep - 0.5) * 2.2
            + clamp((carrierGoalDistance - 24) / 20, 0, 1) * 1.4
            + (defensiveLine - 0.58) * 1.2, 1.6, 6.2);
          profileDepth = Math.min(profileDepth, carrierReturnDepth);
          var returnXForAngle = ownX + dir * profileDepth;
          var returnGoalwardSpan = ownX - observedCarrier.x;
          var returnAngleFraction = Math.abs(returnGoalwardSpan) > 0.001 ? clamp((returnXForAngle - observedCarrier.x) / returnGoalwardSpan, 0, 1) : 0;
          keeperY = observedCarrier.y + (pitch.width / 2 - observedCarrier.y) * returnAngleFraction;
        }
        var oneOnOneNarrowingDepth = 0, oneOnOneCorridorCovered = false, oneOnOneProfile = attr(p, 'oneOnOne', 0.5);
        if (closeCarrierThreat) {
          // Start nearer the line when a fresh, locally observed opponent has
          // entered shooting range. Project the carrier-to-goal-centre angle
          // to the keeper's depth, keeping the opening covered before a shot.
          profileDepth = clamp(0.75 + carrierGoalDistance * 0.045 + sweep * 0.65 + (defensiveLine - 0.58) * 1.2, 0.85, 2.7);
          var keeperXForAngle = ownX + dir * profileDepth;
          var goalwardSpan = ownX - observedCarrier.x;
          var keeperAlongShotRay = Math.abs(goalwardSpan) > 0.001 ? clamp((keeperXForAngle - observedCarrier.x) / goalwardSpan, 0, 1) : 0;
          keeperY = observedCarrier.y + (pitch.width / 2 - observedCarrier.y) * keeperAlongShotRay;
          var localBallHeight = perceivedBall && Number(perceivedBall.estimatedZ == null ? perceivedBall.position && perceivedBall.position.z : perceivedBall.estimatedZ);
          var localCarrierFacing = perceivedOwnerBelief && (perceivedOwnerBelief.facing || perceivedOwnerBelief.velocity);
          var carrierFacingGoal = localCarrierFacing && Number.isFinite(Number(localCarrierFacing.x)) && Number.isFinite(Number(localCarrierFacing.y))
            ? (localCarrierFacing.x * -dir) / (hypot(localCarrierFacing.x, localCarrierFacing.y) || 1) : -1;
          var centralCloseCarrier = carrierGoalDistance <= 10 && Math.abs(observedCarrier.y - pitch.width / 2) <= 9.5
            && Math.abs(observedCarrier.x - ownX) <= 16.5;
          var freshControlledCarrier = !!(perceivedBall && perceivedOwnerId && perceivedBall.ownerId === perceivedOwnerId
            && Number(perceivedBall.confidence) >= 0.72 && Number(perceivedBall.ageTicks) <= 12
            && Number.isFinite(localBallHeight) && localBallHeight <= 0.3
            && perceivedOwnerBelief && Number(perceivedOwnerBelief.confidence) >= 0.72 && Number(perceivedOwnerBelief.ageTicks) <= 12);
          if (centralCloseCarrier && freshControlledCarrier && carrierFacingGoal >= 0.2) {
            var shotVectorX = ownX - observedCarrier.x, shotVectorY = pitch.width / 2 - observedCarrier.y;
            var shotVectorLength2 = shotVectorX * shotVectorX + shotVectorY * shotVectorY;
            teamPlayers.forEach(function (defenderBelief) {
              if (!isDefender(defenderBelief)) return;
              var confidence = Number(defenderBelief.confidence), age = Number(defenderBelief.ageTicks);
              if (!Number.isFinite(confidence) || confidence < 0.58 || !Number.isFinite(age) || age > 18) return;
              var defenderPoint = estimated(defenderBelief), rx = defenderPoint.x - observedCarrier.x, ry = defenderPoint.y - observedCarrier.y;
              var along = shotVectorLength2 > 0.001 ? (rx * shotVectorX + ry * shotVectorY) / shotVectorLength2 : -1;
              if (along <= 0.12 || along >= 0.94) return;
              var laneGap = hypot(rx - shotVectorX * along, ry - shotVectorY * along);
              if (laneGap <= 1.8) oneOnOneCorridorCovered = true;
            });
            if (!oneOnOneCorridorCovered) {
              // A capable one-on-one keeper may close part of the remaining
              // shooting angle before release. The bounded movement stays on
              // the locally observed carrier-to-goal-centre ray; it does not
              // trigger a dive or alter physical save probability.
              var threatUrgency = clamp((10 - carrierGoalDistance) / 4, 0, 1);
              var profileAdvantage = clamp((oneOnOneProfile - 0.35) / 0.65, 0, 1);
              oneOnOneNarrowingDepth = threatUrgency * profileAdvantage * 2.4;
              profileDepth = clamp(profileDepth + oneOnOneNarrowingDepth, 0.85, 4.2);
              keeperXForAngle = ownX + dir * profileDepth;
              keeperAlongShotRay = Math.abs(goalwardSpan) > 0.001 ? clamp((keeperXForAngle - observedCarrier.x) / goalwardSpan, 0, 1) : 0;
              keeperY = observedCarrier.y + (pitch.width / 2 - observedCarrier.y) * keeperAlongShotRay;
            }
          }
        } else if (!goalThreat) keeperY = mix(pitch.width / 2, y, 0.18);
        var keeperX = ownX + dir * (goalThreat ? 1.25 : profileDepth);
        var opponentWinsSweep = false, threatenedMeeting = null;
        if (actionableBall && !perceivedOwnerId && bDistance < 7 + sweep * 13
          && bp.x * dir < pos.x * dir + sweep * 5 && (!goalThreat || goalThreat.time > 0.75)) {
          threatenedMeeting = reachableBallMeeting(p, perceivedBall, attrs.anticipation);
          opponentWinsSweep = keeperOpponentWinsRace(p, threatenedMeeting, opponents);
        }
        var returnForContest = !!(opponentWinsSweep && !goalThreat);
        var holdScore = 0.57 + attrs.positioning * 0.1 + (goalThreat ? 0.06 : 0) + (returnForContest ? 0.055 : 0);
        pushCandidate(candidates, 'hold', target(keeperX, clamp(keeperY, pitch.width * 0.36, pitch.width * 0.64)), holdScore,
          { keeper: true, goalDistance: Math.abs(keeperPoint.x - ownX), predictedThreat: !!goalThreat,
            preShotCarrier: closeCarrierThreat, returningForCarrierThreat: returningForCarrierThreat,
            carrierGoalDistance: returningForCarrierThreat ? carrierGoalDistance : null,
            carrierReturnDepth: carrierReturnDepth, opponentWinsSweep: opponentWinsSweep, returningForContest: returnForContest,
            oneOnOneNarrowing: oneOnOneNarrowingDepth > 0, oneOnOneNarrowingDepth: oneOnOneNarrowingDepth,
            oneOnOneProfile: oneOnOneProfile, oneOnOneCorridorCovered: oneOnOneCorridorCovered });
        var sweepDistance = 7 + sweep * 13;
        if (actionableBall && !perceivedOwnerId && bDistance < sweepDistance && bp.x * dir < pos.x * dir + (sweep * 5) && (!goalThreat || goalThreat.time > 0.75)) {
          var keeperMeet = threatenedMeeting || reachableBallMeeting(p, perceivedBall, attrs.anticipation);
          if (keeperMeet && !opponentWinsSweep) pushCandidate(candidates, 'intercept', clampPoint(keeperMeet.point, pitch, 1), 0.58 + sweep * 0.12 + attrs.anticipation * 0.08 - keeperMeet.slack * 0.025, { ballDistance: bDistance, keeper: true, sweep: sweep, arrivalTime: keeperMeet.time });
        }
        if (goalThreat && actionableBall) {
          var saveScore = 0.69 + attr(p, 'reflexes', 0.5) * 0.08 + attrs.anticipation * 0.1 + attr(p, 'diving', 0.5) * 0.08;
          pushCandidate(candidates, 'save', target(ownX + dir * 0.8, goalThreat.y), saveScore, { keeper: true, perceivedTrajectory: true, goalLineTime: goalThreat.time });
        }
      }
    } else {
      var ownerEstimate = perceivedOwnerBelief && estimated(perceivedOwnerBelief);
      var ownPossession = perceivedOwnerId && perceivedOwnerTeamId === p.teamId;
      var anchor = context && context.anchor ? context.anchor : roleAnchor(p, team, pitch), ballPoint = actionableBall ? bp : anchor;
      var distBall = dist(p, ballPoint), urgency = 1 / (1 + distBall / 14);
      var perceivedBallSpeed = perceivedBall ? hypot(perceivedBall.velocity.x || 0, perceivedBall.velocity.y || 0) : 0;
      var ballHeight = perceivedBall ? Number(perceivedBall.estimatedZ == null ? perceivedBall.position.z : perceivedBall.estimatedZ) || 0 : 0;
      var rawBallHeight = perceivedBall && (perceivedBall.estimatedZ == null
        ? perceivedBall.position && perceivedBall.position.z : perceivedBall.estimatedZ);
      var observedBallHeight = perceivedBall && perceivedBall.position && perceivedBall.position.z;
      var rawBallVerticalSpeed = perceivedBall && perceivedBall.estimatedVelocityZ;
      var observedBallVelocity = perceivedBall && perceivedBall.velocity;
      var recentIdentifiedKick = perceivedBall && perceivedBall.lastTouchTeamId && perceivedBall.ageTicks <= 45 && perceivedBallSpeed > 4.5;
      var flightEvidence = perceivedBall && (ballHeight > 0.28 || Math.abs(Number(perceivedBall.estimatedVelocityZ) || 0) > 1.1 || perceivedBallSpeed > 5.6 || recentIdentifiedKick);
      var teammateOnBall = !staleCarrierDuringFlight && teammates.some(function (e) { return e.confidence > 0.22 && dist(estimated(e), bp) < 1.65; });
      var meet = actionableBall && !carrying && !perceivedOwnerId && flightEvidence && !teammateOnBall ? reachableBallMeeting(p, perceivedBall, attrs.anticipation) : null;
      if (meet) {
        ballClaimRank = observedBallClaimRank(p, teammates, meet.point, 0.76);
        // Teammates unknown or too far away do not reserve this ball. A clear
        // local arrival lead gives one actor the contest; close arrival ties
        // may produce a second contesting runner without a global assignment.
        if (ballClaimRank.canContest) {
          var meetPressure = pressureAt(meet.point, opponents);
          var receiveScore = 0.6 + attrs.anticipation * 0.08 + attr(p, 'firstTouch', 0.5) * 0.08 + attrs.offball * 0.06 + perceivedBall.confidence * 0.06 - meetPressure * 0.13 - Math.max(0, meet.slack) * 0.025;
          var incomingSpeed = hypot(Number(perceivedBall.velocity.x) || 0, Number(perceivedBall.velocity.y) || 0) || 1;
          var facingTarget = { x: meet.point.x - (Number(perceivedBall.velocity.x) || 0) / incomingSpeed * 3, y: meet.point.y - (Number(perceivedBall.velocity.y) || 0) / incomingSpeed * 3 };
          pushCandidate(candidates, 'receive', clampPoint(meet.point, pitch, 1), receiveScore, { arrivalTime: meet.time, ballDistance: meet.distance, confidence: perceivedBall.confidence, slack: meet.slack, ballFlight: true, facingTarget: clampPoint(facingTarget, pitch, 1), contestRank: ballClaimRank.rank, observedContestants: ballClaimRank.count, bestMateArrival: ballClaimRank.bestTeammateArrival, claimAdvantage: ballClaimRank.claimAdvantage });
        }
      }
      if (!perceivedOwnerId && actionableBall && distBall < 16 && !meet) {
        ballClaimRank = observedBallClaimRank(p, teammates, bp, 1);
        if (ballClaimRank.canContest) pushCandidate(candidates, 'intercept', clampPoint(bp, pitch, 1), 0.53 + urgency * 0.26 + attrs.anticipation * 0.05, { ballDistance: distBall, contestRank: ballClaimRank.rank, observedContestants: ballClaimRank.count, bestMateArrival: ballClaimRank.bestTeammateArrival, claimAdvantage: ballClaimRank.claimAdvantage });
      }
      var estimatedBallVerticalSpeed = Number(perceivedBall && perceivedBall.estimatedVelocityZ);
      var hasKnownGroundedLooseBall = actionableBall && perceivedBall.ownerId == null && !perceivedOwnerId
        && !teammateOnBall && perceivedBall.ageTicks <= 18 && perceivedBall.confidence >= 0.62
        && Number.isFinite(Number(bp.x)) && Number.isFinite(Number(bp.y))
        && bp.x >= 0 && bp.x <= pitch.length && bp.y >= 0 && bp.y <= pitch.width
        && observedBallHeight != null && Number.isFinite(Number(observedBallHeight)) && Number(observedBallHeight) <= 0.3
        && rawBallHeight != null && Number.isFinite(Number(rawBallHeight)) && Number(rawBallHeight) >= 0 && Number(rawBallHeight) <= 0.3
        && rawBallVerticalSpeed != null && Number.isFinite(estimatedBallVerticalSpeed) && Math.abs(estimatedBallVerticalSpeed) <= 1.1
        && observedBallVelocity && observedBallVelocity.x != null && observedBallVelocity.y != null
        && Number.isFinite(Number(observedBallVelocity.x)) && Number.isFinite(Number(observedBallVelocity.y))
        && perceivedBallSpeed < 2.2 && distBall >= 16 && distBall <= 42;
      if (hasKnownGroundedLooseBall && !isKeeper(p)) {
        // A settled, ownerless ball beyond the short rolling-flight predictor
        // still needs a local claimant. Rank against recent teammate observations
        // across the ball's visible horizon, using the same arrival model on
        // both sides. Close ties can contest, but the whole group does not chase.
        ballClaimRank = observedBallClaimRank(p, teammates, bp, 0.76, { teammateRadius: 42, outfieldOnly: true });
        if (ballClaimRank.canContest) {
          pushCandidate(candidates, 'intercept', clampPoint(bp, pitch, 1), 0.53 + urgency * 0.26 + attrs.anticipation * 0.05,
            { ballDistance: distBall, stationaryLooseBall: true, contestRank: ballClaimRank.rank,
              observedContestants: ballClaimRank.count, bestMateArrival: ballClaimRank.bestTeammateArrival,
              claimAdvantage: ballClaimRank.claimAdvantage });
        }
      }
      if (ownPossession) {
        var supportX = ballPoint.x - dir * (isDefender(p) ? 9 : 2);
        if (isForward(p)) supportX = ballPoint.x + dir * 12;
        var lateralY = anchor.y + (ballPoint.y - pitch.width / 2) * (isDefender(p) ? 0.3 : 0.18);
        var support = clampPoint({ x: mix(anchor.x, supportX, isForward(p) ? 0.62 : 0.4), y: lateralY }, pitch, 2);
        var supportScore = 0.43 + attrs.teamwork * 0.11 + attrs.offball * 0.14 + attrs.positioning * 0.08 + Math.min(0.12, distBall / 120) - pressureAt(support, opponents) * 0.1;
        if (teamIntent === 'retain' || teamIntent === 'protect') supportScore += 0.04;
        pushCandidate(candidates, 'support', support, supportScore, { purpose: 'support-angle' });

        // Offer a small set of physically plausible outlets around the
        // perceived carrier instead of sending every supporting player to a
        // single formation-anchor blend. These are movement candidates, not
        // pass commands; the carrier still evaluates its own observed lanes.
        var outletOrigin = ownerEstimate || ballPoint;
        var supportTargets = [
          { purpose: 'support-recycle', point: { x: outletOrigin.x - dir * (isDefender(p) ? 8 : 6), y: mix(anchor.y, outletOrigin.y, 0.38) } },
          { purpose: 'support-wide', point: { x: outletOrigin.x + dir * (isForward(p) ? 3 : -2), y: anchor.y <= pitch.width / 2 ? Math.min(7, pitch.width * 0.12) : Math.max(pitch.width - 7, pitch.width * 0.88) } }
        ];
        var supportMates = teammates.filter(function (e) { return e.id !== p.id && e.confidence > 0.3; });
        supportTargets.forEach(function (option) {
          var outlet = clampPoint(option.point, pitch, 3);
          var outletDistance = dist(outletOrigin, outlet);
          if (outletDistance < 4 || outletDistance > (option.purpose === 'support-wide' ? 31 : 23) || dist(outlet, support) < 4) return;
          var outletPressure = pressureAt(outlet, opponents);
          var nearestOutletMate = minTeammateDistance(outlet, supportMates);
          var spacing = clamp((nearestOutletMate - 3) / 8, 0, 1);
          var lanePower = clamp(outletDistance / 35, 0.22, 0.65);
          var laneRisk = passLaneInterceptionRisk(outletOrigin, outlet, lanePower, 0, opponents);
          var widthOpportunity = clamp((Math.abs(outlet.y - outletOrigin.y) - 3) / 13, 0, 1);
          var outletScore = 0.47 + attrs.teamwork * 0.09 + attrs.offball * 0.11 + attrs.positioning * 0.06
            + spacing * 0.075 + widthOpportunity * (option.purpose === 'support-wide' ? 0.045 : 0.015)
            + clamp((13 - Math.abs(outletDistance - 10)) / 13, 0, 1) * 0.045
            - outletPressure * 0.12 - laneRisk * 0.11;
          if ((teamIntent === 'retain' || teamIntent === 'protect') && option.purpose === 'support-recycle') outletScore += 0.025;
          pushCandidate(candidates, 'support', outlet, outletScore, { purpose: option.purpose, outletDistance: outletDistance, pressure: outletPressure, laneInterceptionRisk: laneRisk, spacing: nearestOutletMate });
        });
        if ((isForward(p) || /wing|attack|striker|midfielder/.test(roleName(p))) && progress(team, ballPoint, anchor) > -4) {
          var run = clampPoint({ x: anchor.x + dir * (3 + attrs.anticipation * 5), y: anchor.y }, pitch, 1);
          var risk = thisOffsideRisk(team, run, opponents, pitch, null, bp.x);
          var runScore = 0.42 + attrs.offball * 0.15 + attrs.anticipation * 0.08 - risk * (0.14 + attr(p, 'discipline', 0.5) * 0.1);
          pushCandidate(candidates, 'move', run, runScore, { purpose: 'run-behind', offsideRisk: risk });

          var observedSameOwner = p.beliefState && p.beliefState.observedSameOwner;
          var ownerFreshForSynchronizedRun = !!(observedSameOwner && observedSameOwner.sampleCount >= 2
            && Number(observedSameOwner.lastObservedTick) > Number(observedSameOwner.firstObservedTick)
            && String(observedSameOwner.ownerId) === String(perceivedOwnerId)
            && String(observedSameOwner.teamId) === String(p.teamId)
            && perceivedBall && perceivedBall.ownerId === perceivedOwnerId
            && perceivedBall.confidence >= 0.55 && perceivedBall.ageTicks <= 18
            && perceivedOwnerBelief && perceivedOwnerBelief.teamId === p.teamId
            && perceivedOwnerBelief.confidence >= 0.58 && perceivedOwnerBelief.ageTicks <= 18
            && Number(observedSameOwner.lastObservedTick) === Number(perceivedBall.observedTick)
            && Number(observedSameOwner.lastObservedTick) === Number(perceivedOwnerBelief.observedTick)
            && perceivedOwnerBelief.facing && Number.isFinite(Number(perceivedOwnerBelief.facing.x))
            && Number.isFinite(Number(perceivedOwnerBelief.facing.y)));
          if (ownerFreshForSynchronizedRun) {
            var synchronizedRunPoint = forwardRaySegmentIntersection(ownerEstimate, perceivedOwnerBelief.facing, pos, run);
            if (synchronizedRunPoint) {
              var synchronizedRunArrival = playerArrivalTime(p, synchronizedRunPoint, 0.76);
              var ordinaryRunArrival = playerArrivalTime(p, run, 0.76);
              var synchronizedOffsideRisk = thisOffsideRisk(team, synchronizedRunPoint, opponents, pitch, null, bp.x);
              var synchronizedDistance = dist(ownerEstimate, synchronizedRunPoint);
              var ordinaryDistance = dist(ownerEstimate, run);
              var synchronizedPower = clamp(synchronizedDistance / 35, 0.22, 0.65);
              var ordinaryPower = clamp(ordinaryDistance / 35, 0.22, 0.65);
              var synchronizedLaneRisk = passLaneInterceptionRisk(ownerEstimate, synchronizedRunPoint, synchronizedPower, 0, opponents);
              var ordinaryLaneRisk = passLaneInterceptionRisk(ownerEstimate, run, ordinaryPower, 0, opponents);
              var synchronizedPressure = pressureAt(synchronizedRunPoint, opponents);
              var ordinaryPressure = pressureAt(run, opponents);
              var riskImproves = synchronizedLaneRisk <= ordinaryLaneRisk && synchronizedPressure <= ordinaryPressure
                && (synchronizedLaneRisk < ordinaryLaneRisk || synchronizedPressure < ordinaryPressure);
              if (synchronizedRunArrival <= ordinaryRunArrival && synchronizedOffsideRisk <= risk
                && riskImproves && (isForward(p) || /wing|attack|striker|midfielder/.test(roleName(p)))) {
                var synchronizedRunScore = 0.42 + attrs.offball * 0.15 + attrs.anticipation * 0.08
                  - synchronizedOffsideRisk * (0.14 + attr(p, 'discipline', 0.5) * 0.1);
                pushCandidate(candidates, 'move', clampPoint(synchronizedRunPoint, pitch, 1), synchronizedRunScore, {
                  purpose: 'observed-carrier-lane-run', observedSpanTicks: Number(observedSameOwner.lastObservedTick) - Number(observedSameOwner.firstObservedTick),
                  observedSamples: Number(observedSameOwner.sampleCount), offsideRisk: synchronizedOffsideRisk,
                  laneInterceptionRisk: synchronizedLaneRisk, pressure: synchronizedPressure, arrivalTime: synchronizedRunArrival
                });
              }
            }
          }
        }
      } else {
        var defensiveLine = estimateLine(opponents, pitch, dir);
        var cover = isDefender(p) ? target(mix(pos.x, anchor.x, 0.22), mix(pos.y, anchor.y, 0.25)) : target(mix(pos.x, anchor.x, 0.35), mix(pos.y, anchor.y, 0.28));
        var ballCarrierEnemy = perceivedOwnerId && perceivedOwnerTeamId !== p.teamId;
        var hasPressReservation = context && context.responsibilities && typeof context.responsibilities.press === 'boolean';
        var hasPressAssignment = !hasPressReservation || context.responsibilities.press;
        var shouldPress = hasPressAssignment && ballCarrierEnemy && ownerEstimate && dist(p, ownerEstimate) < (isDefender(p) ? 15 : 11) && (isDefender(p) || !teammateCloserTo(p, ownerEstimate));
        if (shouldPress) {
          var pressTarget = ownerEstimate;
          var approach = { x: pressTarget.x - dir * 1.4, y: pressTarget.y + clamp(pos.y - pressTarget.y, -2, 2) };
        pushCandidate(candidates, 'press', clampPoint(approach, pitch, 1), 0.42 + attr(p, 'aggression', 0.5) * 0.15 + attrs.anticipation * 0.08 + urgency * 0.1, { targetId: perceivedOwnerId, responsibility: 'ball-carrier' });
        }
        // A press becomes a physical standing challenge only when perception
        // says the carrier is close, the ball is playable on the ground, and
        // this actor owns the shared press reservation. Physics still decides
        // reach, tackle success, contact, and any resulting foul.
        var challengeRecoveryUntil = Number(p._challengeRecoveryUntilTick) || 0;
        if (shouldPress && match.tick >= challengeRecoveryUntil && perceivedOwnerBelief && perceivedOwnerBelief.confidence >= 0.58 && perceivedOwnerBelief.ageTicks <= 18 && perceivedBall && perceivedBall.confidence >= 0.55 && perceivedBall.ageTicks <= 18 && ballHeight <= 0.55) {
          var ballGap = dist(ownerEstimate, bp), challengeDistance = dist(p, bp);
          var toBall = norm({ x: bp.x - pos.x, y: bp.y - pos.y }, p.facing || { x: 1, y: 0 });
          var facingBall = (p.facing.x || 0) * toBall.x + (p.facing.y || 0) * toBall.y;
          var carrierDx = ownerEstimate.x - pos.x, carrierDy = ownerEstimate.y - pos.y;
          var carrierAlongFootPath = carrierDx * toBall.x + carrierDy * toBall.y;
          var carrierAcrossFootPath = Math.abs(carrierDx * toBall.y - carrierDy * toBall.x);
          var carrierBlocksFootPath = carrierAlongFootPath > 0.08 && carrierAlongFootPath <= Math.min(challengeDistance, 1.24) && carrierAcrossFootPath < 0.68;
          // Offer a physical tackle only when the actor can actually reach the
          // ball, is oriented toward it, is out of recovery, and its foot path
          // does not run through the observed carrier to a far-side ball.
          if (ballGap <= 1.75 && challengeDistance <= 1.35 && facingBall >= 0.35 && !carrierBlocksFootPath) {
            var discipline = attr(p, 'discipline', 0.5), tackleSkill = attr(p, 'tackling', 0.5), foulRisk = clamp((1 - discipline) * 0.42 + (1 - attr(p, 'balance', 0.75)) * 0.18 + Math.max(0, 1.25 - facingBall) * 0.08, 0, 0.7);
            var challengeScore = 0.61 + tackleSkill * 0.13 + discipline * 0.055 + attr(p, 'aggression', 0.5) * 0.035 + clamp(facingBall, 0, 1) * 0.045 + perceivedOwnerBelief.confidence * 0.035 - foulRisk * 0.12;
            pushCandidate(candidates, 'challenge', clampPoint(bp, pitch, 0.5), challengeScore, { targetId: perceivedOwnerId, physicsAction: 'standingtackle', tackleSkill: tackleSkill, foulRisk: foulRisk, facingBall: facingBall, carrierBlocksFootPath: carrierBlocksFootPath, responsibility: 'ball-carrier' });
          }
        }
        var defensiveTarget = isDefender(p) ? target(mix(anchor.x, ballPoint.x, 0.16), mix(anchor.y, ballPoint.y, 0.08)) : target(mix(anchor.x, ballPoint.x, 0.27), mix(anchor.y, ballPoint.y, 0.18));
        if ((isDefender(p) || isScreenMidfielder(p)) && ballCarrierEnemy && ownerEstimate) {
          // Defenders protect the space between the perceived carrier and
          // their own goal. The role-dependent line remains spread, with
          // center backs and the screen shading toward a central box threat.
          var ownGoalX = dir > 0 ? 0 : pitch.length;
          var threatDepth = progress(team, { x: ownGoalX, y: ownerEstimate.y }, ownerEstimate);
          var holdingMidfielder = isScreenMidfielder(p);
          var roleOffset = holdingMidfielder ? 8 : 4;
          var maxDepth = holdingMidfielder ? 34 : 30;
          // As the observed carrier approaches goal, retain a role-scaled
          // goal-side gap instead of applying a fixed minimum depth that can
          // put the recovery point in front of the attacker. Keep the screen
          // midfielder deeper than the back line while preserving width via
          // the independent role anchor below.
          var goalSideClearance = Math.min(roleOffset, Math.max(0.12, threatDepth * (holdingMidfielder ? 0.5 : 0.32)));
          var maxGoalSideProgress = Math.max(0, threatDepth - goalSideClearance);
          var depth = Math.min(maxDepth, maxGoalSideProgress);
          var goalSide = { x: ownGoalX + dir * depth, y: anchor.y };
          var centerY = pitch.width / 2;
          var centralThreat = clamp((24 - threatDepth) / 24, 0, 1) * clamp(1 - Math.abs(ownerEstimate.y - centerY) / 22, 0, 1);
          var roleCode = String(p.role || '').toUpperCase();
          var centralShade = roleCode === 'RCB' || roleCode === 'LCB' || roleCode === 'CB' ? 0.42 : holdingMidfielder ? 0.34 : 0.1;
          goalSide.y = mix(goalSide.y, centerY, centralThreat * centralShade);
          goalSide.y = mix(goalSide.y, ownerEstimate.y, (isDefender(p) || holdingMidfielder) && !/^(RB|LB|RWB|LWB)$/.test(roleCode) ? 0.1 : 0.025);
          var emergencyRetreat = context && context.phase === 'emergencyDefending' ? 0.84 : threatDepth < 24 ? 0.62 : context && (context.phase === 'organizedDefensiveBlock' || context.phase === 'defensiveTransition') ? 0.34 : 0.12;
          defensiveTarget = target(mix(defensiveTarget.x, goalSide.x, emergencyRetreat), mix(defensiveTarget.y, goalSide.y, emergencyRetreat));
          // The anchor blend can otherwise undo the goal-side target for a
          // carrier already inside the old 4m/8m minimum. Preserve that
          // observed carrier-relative constraint after blending.
          if (progress(team, { x: ownGoalX, y: ownerEstimate.y }, defensiveTarget) > maxGoalSideProgress) {
            defensiveTarget.x = ownGoalX + dir * maxGoalSideProgress;
          }
        }
        var centralLane = context && context.responsibilities && context.responsibilities.centralShotLane
          && context.responsibilities.centralShotLaneTarget;
        if (isDefender(p) && centralLane && perceivedOwnerBelief && perceivedBall
          && perceivedOwnerBelief.confidence >= 0.58 && perceivedOwnerBelief.ageTicks <= 18
          && perceivedBall.confidence >= 0.55 && perceivedBall.ageTicks <= 18 && ballHeight <= 0.55) {
          var laneDepth = Math.abs(centralLane.x - (dir > 0 ? 0 : pitch.length));
          var carrierDepthForLane = ownerEstimate ? Math.abs(ownerEstimate.x - (dir > 0 ? 0 : pitch.length)) : 0;
          var laneProgress = carrierDepthForLane - laneDepth;
          var laneUrgency = clamp((28 - carrierDepthForLane) / 14, 0, 1);
          var laneCoverScore = 0.72 + attrs.positioning * 0.07 + attrs.teamwork * 0.05
            + perceivedOwnerBelief.confidence * 0.05 + laneUrgency * 0.08
            - pressureAt(centralLane, opponents) * 0.025;
          var retainsCentralCover = context.responsibilities.centralShotLane && context.responsibilities.centralShotLaneOwnerId === perceivedOwnerId;
          if (laneProgress >= 1.5 && laneProgress <= 16 || retainsCentralCover) {
            pushCandidate(candidates, 'cover', centralLane, laneCoverScore, {
              responsibility: 'central-shot-lane', targetId: context.responsibilities.centralShotLaneOwnerId,
              runnerId: context.responsibilities.centralShotLaneRunnerId,
              arrivalTime: context.responsibilities.centralShotLaneArrival,
              carrierCloseTime: context.responsibilities.centralShotLaneCloseTime,
              threatDepth: carrierDepthForLane, confidence: Math.min(perceivedBall.confidence, perceivedOwnerBelief.confidence),
              perceived: true
            });
          }
        }
        defensiveTarget = clampPoint(defensiveTarget, pitch, 2);
        pushCandidate(candidates, 'recover', defensiveTarget, 0.43 + attrs.positioning * 0.14 + attrs.teamwork * 0.09 + (isDefender(p) ? 0.07 : 0) - pressureAt(defensiveTarget, opponents) * 0.06, { defensiveLine: defensiveLine });
        var screen = target(mix(anchor.x, ballPoint.x, 0.48), mix(anchor.y, ballPoint.y, 0.4));
        pushCandidate(candidates, 'move', clampPoint(screen, pitch, 2), 0.38 + attrs.teamwork * 0.1 + (isDefender(p) ? 0.07 : 0), { purpose: 'screen-lane' });
      }
    }

    if (!candidates.length) pushCandidate(candidates, 'hold', pos, 0.2, {});
    var nativeStandingChallenges = candidates.filter(function (candidate) {
      return candidate && candidate.type === 'challenge' && candidate.details && candidate.details.physicsAction === 'standingtackle';
    });
    if (typeof TF.augmentCandidates === 'function') {
      var beliefCopy = function (e) { return { id: e.id, teamId: e.teamId, position: { x: estimated(e).x, y: estimated(e).y }, velocity: { x: e.velocity.x, y: e.velocity.y }, facing: e.facing && { x: e.facing.x, y: e.facing.y }, confidence: e.confidence, ageTicks: e.ageTicks, source: e.source }; };
      var tacticalSource = context || {};
      var tacticalCopy = {
        anchor: cloneData(tacticalSource.anchor), phase: tacticalSource.phase,
        intent: cloneData(tacticalSource.intent), actionWeights: cloneData(tacticalSource.actionWeights),
        weights: cloneData(tacticalSource.weights), responsibilities: cloneData(tacticalSource.responsibilities),
        width: tacticalSource.width, attackingWidth: tacticalSource.attackingWidth,
        defensiveWidth: tacticalSource.defensiveWidth, compactness: tacticalSource.compactness,
        defensiveLine: tacticalSource.defensiveLine, riskWeight: tacticalSource.riskWeight,
        progressionWeight: tacticalSource.progressionWeight, pressWeight: tacticalSource.pressWeight,
        ballEstimate: cloneData(tacticalSource.ballEstimate), ballConfidence: tacticalSource.ballConfidence,
        opponentTendency: cloneData(tacticalSource.opponentTendency)
      };
      var safeContext = {
        tick: match.tick,
        self: { id: p.id, position: { x: pos.x, y: pos.y }, velocity: { x: p.velocity.x, y: p.velocity.y }, facing: { x: p.facing.x, y: p.facing.y }, role: p.role, positionFamily: p.positionFamily, formationSlot: p.formationSlot && Object.assign({}, p.formationSlot), attributes: Object.assign({}, p.attributes), traits: Object.assign({}, p.traits) },
        ball: perceivedBall ? { position: { x: bp.x, y: bp.y, z: Number(perceivedBall.estimatedZ == null ? perceivedBall.position.z : perceivedBall.estimatedZ) || 0 }, velocity: { x: perceivedBall.velocity.x, y: perceivedBall.velocity.y, z: Number(perceivedBall.estimatedVelocityZ == null ? perceivedBall.velocity.z : perceivedBall.estimatedVelocityZ) || 0 }, ownerId: perceivedOwnerId, ownerTeamId: perceivedOwnerTeamId, confidence: perceivedBall.confidence, ageTicks: perceivedBall.ageTicks } : null,
        teammates: teammates.map(beliefCopy), opponents: opponents.map(beliefCopy),
        carrying: carrying, teamId: p.teamId, attackDirection: dir, tactical: tacticalCopy,
        attributes: attrs, pitch: { length: pitch.length, width: pitch.width }
      };
      var result = TF.augmentCandidates(candidates, safeContext);
      if (Array.isArray(result)) candidates = result;
      candidates = candidates.filter(function (c) { return c && typeof c.type === 'string' && Number.isFinite(Number(c.utility)); });
    }
    if (isRestartTaker) {
      // A restart stays inactive until the prescribed physical action is
      // played. Physics independently validates the actual release.
      if (pendingRestart.type === 'throw-in') {
        candidates = candidates.filter(function (candidate) { return candidate.type === 'pass'; }).map(function (candidate) {
          return { type: 'throw', target: candidate.target, utility: candidate.utility,
            details: Object.assign({}, candidate.details, { physicsAction: 'throw', restartThrow: true }) };
        });
        if (!candidates.length) {
          var inwardY = pendingRestart.point.y === 0 ? 5 : pitch.width - 5;
          var inwardX = clamp(pos.x + dir * 7, 2, pitch.length - 2);
          pushCandidate(candidates, 'throw', { x: inwardX, y: inwardY }, 0.34 + attrs.teamwork * 0.04,
            { restartThrow: true, physicsAction: 'throw', fallback: true });
        }
      } else {
        var legalRestartActions = pendingRestart.type === 'penalty' ? ['shoot']
          : ['pass', 'throughBall', 'cross', 'cutback', 'switch', 'shoot', 'clear'];
        candidates = candidates.filter(function (candidate) { return legalRestartActions.indexOf(candidate.type) >= 0; });
        if (!candidates.length && pendingRestart.type === 'penalty') {
          pushCandidate(candidates, 'shoot', { x: goal.x, y: goal.y }, 0.72, { restartPenalty: true });
        } else if (!candidates.length) {
          var restartClear = clampPoint({ x: pos.x + dir * 22, y: pos.y + clamp((pitch.width / 2 - pos.y) * 0.25, -6, 6) }, pitch, 1);
          pushCandidate(candidates, 'clear', restartClear, 0.34 + attrs.composure * 0.04, { restartDistributionFallback: true });
        }
      }
    }
    var consideration = Math.max(2, Math.round(mix(2, candidates.length, attrs.vision * 0.55 + attrs.decision * 0.45)));
    candidates.forEach(function (c) {
      var riskPreference = attr(p, 'riskAppetite', attr(p, 'risk', 0.48));
      var noise = (random(rng) - 0.5) * (0.045 + (1 - attrs.decision) * 0.09);
      var skillPreference = c.type === 'throughBall' ? (riskPreference - 0.45) * 0.16 + attrs.creativity * 0.045 : 0;
      var tacticalPreference = 0;
      if ((teamIntent === 'advance' || teamIntent === 'attack' || teamIntent === 'counter') && (c.type === 'throughBall' || c.type === 'carry')) tacticalPreference += 0.055;
      if ((teamIntent === 'retain' || teamIntent === 'protect') && (c.type === 'pass' || c.type === 'hold' || c.type === 'support')) tacticalPreference += 0.035;
      if ((teamIntent === 'retain' || teamIntent === 'protect') && c.type === 'throughBall') tacticalPreference -= 0.06;
      if ((teamIntent === 'recover' || teamIntent === 'counterpress') && (c.type === 'recover' || c.type === 'press')) tacticalPreference += 0.05;
      var explicitWeight = context && context.actionWeights && Number(context.actionWeights[c.type]);
      if (Number.isFinite(explicitWeight)) tacticalPreference += clamp(explicitWeight, -0.2, 0.2);
      c.utilityComponents = { raw: c.utility, tactical: tacticalPreference, playerPreference: skillPreference, uncertainty: noise };
      c.utility = c.utility + noise + skillPreference + tacticalPreference;
      c.utility = clamp(c.utility, 0, 1.2);
    });
    candidates.sort(function (a, b) { return b.utility - a.utility || a.type.localeCompare(b.type) || String(a.details.targetId || '').localeCompare(String(b.details.targetId || '')); });
    var utilityWinner = candidates[0];
    var chosen = utilityWinner;
    var old = p.intent;
    var oldTargetIdForThrough = old && (old.targetId || old.details && old.details.targetId);
    var oldThroughContext = oldTargetIdForThrough != null && currentThroughLeadContexts[String(oldTargetIdForThrough)];
    var oldSpeculativeThroughRejected = !!(old && old.type === 'throughBall' && oldThroughContext
      && oldThroughContext.predictionReliability === 1 && oldThroughContext.runSpeed <= 0.75
      && !throughLeadSupportedByObservedMotion(old.ballTarget || old.target, oldThroughContext.predicted, oldThroughContext.velocity));
    var restartApproachTypes = ['kickoff', 'goal-kick', 'corner', 'direct-free-kick', 'indirect-free-kick', 'penalty'];
    var restartActionTypes = pendingRestart && pendingRestart.type === 'penalty' ? ['shoot']
      : ['pass', 'throughBall', 'cross', 'cutback', 'switch', 'shoot', 'clear'];
    var oldRestartLock = isRestartTaker && old && old.details && old.details.restartApproach
      && !oldSpeculativeThroughRejected
      && Number(old.details.restartApproach.sequence) === Number(match.state.restartSequence || 0)
      && restartApproachTypes.indexOf(pendingRestart.type) >= 0
      && restartActionTypes.indexOf(old.type) >= 0
      && old.target && Number.isFinite(Number(old.target.x)) && Number.isFinite(Number(old.target.y))
      && old.ballTarget && Number.isFinite(Number(old.ballTarget.x)) && Number.isFinite(Number(old.ballTarget.y));
    var restartPassTypes = ['pass', 'throughBall', 'cross', 'cutback', 'switch'];
    if (oldRestartLock && restartPassTypes.indexOf(old.type) >= 0 && actionableBall
      && Number(perceivedBall.confidence) >= 0.45 && Number(perceivedBall.ageTicks) <= 30) {
      // Keep a selected legal restart ray stable while the motor approaches its
      // stance, unless the same actor's fresh local observations now make its
      // pass lane materially risky. Reuse the ordinary lane model and local
      // opponent DTOs; never consult hidden player positions here.
      var priorRestartLaneRisk = Number(old.details && old.details.laneInterceptionRisk);
      var currentRestartLaneRisk = passLaneInterceptionRisk(bp, old.ballTarget, old.power, old.lift, opponents);
      var priorWasCredible = Number.isFinite(priorRestartLaneRisk) && priorRestartLaneRisk < 0.58;
      if (currentRestartLaneRisk >= 0.58 && (!Number.isFinite(priorRestartLaneRisk) || priorWasCredible)) oldRestartLock = false;
    }
    // A legal restart target can require a different body stance from the
    // initial set position (notably for backward kickoff distributions). Keep
    // the selected action stable while the ordinary motor approaches that
    // stance; the physical strike still rechecks the full contact geometry.
    if (oldRestartLock) chosen = { type: old.type, target: old.target, utility: old.utility || 0, details: old.details || {}, committed: true };
    // Keep deliberation in the spec's 5–10 Hz band; movement and ball
    // controllers still run each fixed tick. Urgent contact/goal-line events
    // below get a separate bounded 20 Hz reaction path.
    var decisionPeriod = clamp(Math.round(mix(12, 6, attrs.decision)), 6, 12);
    var oldIsMovement = old && ['support','move','recover','press','challenge','intercept','receive','carry','overlap','underlap','thirdManRun','attackBox','holdLine','cover','mark','header'].indexOf(old.type) >= 0;
    var oldIsBallAction = old && ['pass','throughBall','cross','cutback','switch','shoot','clear'].indexOf(old.type) >= 0;
    var oldTeamChanged = old && old.teamIdAtCreation != null && String(old.teamIdAtCreation) !== String(p.teamId);
    var oldReached = old && old.target && dist(pos, old.target) < (old.type === 'press' || old.type === 'intercept' || old.type === 'receive' || old.type === 'header' ? 1.4 : 1.0);
    var oldPressLost = old && (old.type === 'press' || old.type === 'challenge') && context && context.responsibilities && !context.responsibilities.press;
    var oldCarryLost = old && old.type === 'carry' && !carrying;
    var oldReceiveLost = old && old.type === 'receive' && (!actionableBall || !candidates.some(function (c) { return c.type === 'receive'; }));
    var oldChallengeRecovering = old && old.type === 'challenge' && match.tick < (Number(p._challengeRecoveryUntilTick) || 0);
    var oldBallClaimLost = old && (old.type === 'receive' || old.type === 'intercept') && (!candidates.some(function (c) { return c.type === old.type && (!c.details || c.details.claimAdvantage == null || Number(c.details.claimAdvantage) >= -0.22); }) || (old.type === 'intercept' && candidates.some(function (c) { return c.type === 'receive'; })));
    var validOld = !isRestartTaker && old && old.expiresTick >= match.tick && (old.commitUntilTick == null || old.commitUntilTick >= match.tick) && old.type && !oldTeamChanged && !oldSpeculativeThroughRejected && !oldChallengeRecovering && !(oldIsMovement && oldReached) && !(oldCarryLost) && !(oldReceiveLost) && !(oldBallClaimLost) && !(oldIsBallAction && !carrying) && !(oldIsMovement && carrying && old.type !== 'carry') && !oldPressLost && (!old.target || (old.target.x >= 0 && old.target.x <= pitch.length && old.target.y >= 0 && old.target.y <= pitch.width));
    var urgentReceive = chosen.type === 'receive' && chosen.details && chosen.details.arrivalTime <= 0.8 && chosen.details.confidence >= 0.7;
    var urgentCentralCover = chosen.type === 'cover' && chosen.details && chosen.details.responsibility === 'central-shot-lane'
      && Number.isFinite(Number(chosen.details.arrivalTime)) && Number.isFinite(Number(chosen.details.carrierCloseTime))
      && Number(chosen.details.arrivalTime) <= Number(chosen.details.carrierCloseTime);
    var keeperSweepNoLongerAvailable = isKeeper(p) && old && old.type === 'intercept' && chosen.type === 'hold'
      && !candidates.some(function (candidate) { return candidate.type === 'intercept'; });
    var urgentKeeperReturn = isKeeper(p) && old && old.type === 'intercept' && chosen.type === 'hold'
      && chosen.details && chosen.details.keeper
      && (chosen.details.returningForCarrierThreat || chosen.details.returningForContest || keeperSweepNoLongerAvailable);
    // A fresh, physically eligible standing tackle is the current contact
    // choice, not a speculative movement change. Do not let a prior press
    // commitment suppress that immediate contest when the same observed
    // carrier remains in possession and the native challenge outranks it.
    // Candidate generation and physics continue to own reach and success.
    var oldPressTargetId = old && (old.targetId || old.details && old.details.targetId);
    var challengeBallHeight = perceivedBall && (perceivedBall.estimatedZ != null
      ? Number(perceivedBall.estimatedZ)
      : perceivedBall.position && perceivedBall.position.z != null ? Number(perceivedBall.position.z) : NaN);
    var urgentStandingChallenge = !!(validOld && old.type === 'press'
      && String(oldPressTargetId || '') === String(perceivedOwnerId || '')
      && perceivedOwnerId && perceivedOwnerTeamId !== p.teamId
      && perceivedOwnerBelief
      && perceivedOwnerBelief.id != null && String(perceivedOwnerBelief.id) === String(perceivedOwnerId)
      && Number.isFinite(Number((perceivedOwnerBelief.estimatedPosition || perceivedOwnerBelief.position || {}).x))
      && Number.isFinite(Number((perceivedOwnerBelief.estimatedPosition || perceivedOwnerBelief.position || {}).y))
      && perceivedBall && perceivedBall.ownerId === perceivedOwnerId
      && bp && Number.isFinite(Number(bp.x)) && Number.isFinite(Number(bp.y))
      && Number.isFinite(Number(perceivedOwnerBelief.confidence)) && Number(perceivedOwnerBelief.confidence) >= 0.58
      && Number.isFinite(Number(perceivedOwnerBelief.ageTicks)) && Number(perceivedOwnerBelief.ageTicks) <= 18
      && Number.isFinite(Number(perceivedBall.confidence)) && Number(perceivedBall.confidence) >= 0.55
      && Number.isFinite(Number(perceivedBall.ageTicks)) && Number(perceivedBall.ageTicks) <= 18
      && Number.isFinite(challengeBallHeight) && challengeBallHeight >= 0 && challengeBallHeight <= 0.55
      && match.tick >= challengeRecoveryUntil
      && chosen.type === 'challenge' && chosen.details && chosen.details.physicsAction === 'standingtackle'
      && nativeStandingChallenges.indexOf(chosen) >= 0
      && String(chosen.details.targetId || '') === String(perceivedOwnerId)
      && Number.isFinite(Number(chosen.utility)) && Number(chosen.utility) > Number(old.utility)
      && chosen.details.responsibility === 'ball-carrier'
      && Number.isFinite(Number(chosen.details.tackleSkill)) && Number.isFinite(Number(chosen.details.foulRisk))
      && Number(chosen.details.facingBall) >= 0.35 && chosen.details.carrierBlocksFootPath === false);
    var commitmentThreshold = (Number(old && old.utility) || 0) + 0.12 + (1 - attrs.decision) * 0.14;
    var heldCommitment = !!(validOld && !urgentReceive && !urgentCentralCover && !urgentKeeperReturn && !urgentStandingChallenge && old.type !== 'hold' && chosen.type !== old.type && chosen.utility < commitmentThreshold);
    if (heldCommitment) chosen = { type: old.type, target: old.target, utility: old.utility || 0, details: old.details || {}, committed: true };
    var diagnosticCandidates = candidates.slice(0, 64).map(function (c, index) {
      return {
        rank: index + 1, type: c.type, targetId: c.details && c.details.targetId || null,
        target: diagnosticData(c.target), utility: diagnosticData(c.utility),
        utilityComponents: diagnosticData(c.utilityComponents || {}), details: diagnosticData(c.details || {})
      };
    });
    var diagnosticEntities = Object.keys(p.beliefState && p.beliefState.entities || {}).sort().slice(0, 64).map(function (key) {
      var entity = p.beliefState.entities[key] || {}, point = entity.estimatedPosition || entity.position || null;
      return {
        id: entity.id == null ? key : String(entity.id), teamId: entity.teamId == null ? null : String(entity.teamId),
        role: entity.role == null ? null : String(entity.role), positionFamily: entity.positionFamily == null ? null : String(entity.positionFamily),
        estimatedPosition: diagnosticData(point), confidence: diagnosticData(entity.confidence),
        ageTicks: diagnosticData(entity.ageTicks), observedTick: diagnosticData(entity.observedTick), source: entity.source == null ? null : String(entity.source)
      };
    });
    var diagnosticBall = p.beliefState && p.beliefState.ball;
    var decisionExplanation = {
      tick: match.tick,
      reason: heldCommitment ? 'held-valid-commitment' : 'utility-winner',
      utilityWinner: { type: utilityWinner.type, targetId: utilityWinner.details && utilityWinner.details.targetId || null, target: diagnosticData(utilityWinner.target), utility: diagnosticData(utilityWinner.utility) },
      selected: { type: chosen.type, targetId: chosen.details && chosen.details.targetId || null, target: diagnosticData(chosen.target), utility: diagnosticData(chosen.utility) },
      commitment: {
        previousType: validOld ? String(old.type) : null, previousUtility: validOld ? diagnosticData(old.utility) : null,
        valid: !!validOld, urgentReceive: !!urgentReceive, urgentKeeperReturn: !!urgentKeeperReturn,
        threshold: diagnosticData(commitmentThreshold), held: heldCommitment
      },
      evaluatedCount: candidates.length, storedCount: diagnosticCandidates.length, truncated: candidates.length > diagnosticCandidates.length,
      attentionCount: Math.min(consideration, candidates.length), candidates: diagnosticCandidates,
      beliefs: { updatedTick: diagnosticData(p.beliefState && p.beliefState.updatedTick), entities: diagnosticEntities, entityCount: Object.keys(p.beliefState && p.beliefState.entities || {}).length, truncated: Object.keys(p.beliefState && p.beliefState.entities || {}).length > diagnosticEntities.length,
        ball: diagnosticBall ? { estimatedPosition: diagnosticData(diagnosticBall.estimatedPosition || diagnosticBall.position), confidence: diagnosticData(diagnosticBall.confidence), ageTicks: diagnosticData(diagnosticBall.ageTicks), observedTick: diagnosticData(diagnosticBall.observedTick), source: diagnosticBall.source == null ? null : String(diagnosticBall.source) } : null }
    };
    var movementSpeeds = { press: 1, challenge: 1, intercept: 1, receive: 0.76, save: 1, recover: 0.88, support: 0.7, move: 0.83, carry: 0.88, overlap: 0.82, underlap: 0.8, thirdManRun: 0.88, attackBox: 0.82, holdLine: 0.55, cover: 0.72, mark: 0.72, header: 0.92 };
    var speed = movementSpeeds[chosen.type] == null ? 0 : movementSpeeds[chosen.type];
    if (chosen.type === 'hold' && chosen.details && chosen.details.keeper) speed = 0.38;
    var actionParams = {};
    if (['pass', 'throughBall', 'cross', 'cutback', 'switch', 'throw'].indexOf(chosen.type) >= 0) {
      actionParams.ballTarget = chosen.target;
      actionParams.power = Number.isFinite(Number(chosen.details.power)) ? clamp(Number(chosen.details.power), 0.1, 1) : clamp(dist(p, chosen.target) / 35, 0.22, 1);
      actionParams.lift = Number.isFinite(Number(chosen.details.lift)) ? clamp(Number(chosen.details.lift), 0, 1) : (chosen.type === 'throw' ? 0.44 : chosen.type === 'throughBall' ? 0.12 : chosen.type === 'cross' ? 0.38 : chosen.type === 'switch' ? 0.3 : 0);
    } else if (chosen.type === 'shoot') {
      actionParams.ballTarget = { x: goal.x, y: chosen.target && Number.isFinite(chosen.target.y) ? chosen.target.y : goal.y, z: 0 };
      actionParams.power = clamp(0.62 + attr(p, 'shooting', 0.5) * 0.32, 0.55, 1);
      actionParams.lift = 0.07;
    } else if (chosen.type === 'clear') {
      actionParams.ballTarget = chosen.target; actionParams.power = 1; actionParams.lift = 0.18;
    }
    var createdTick = validOld && old.type === chosen.type ? old.createdTick : match.tick;
    var chosenIsBallAction = ['pass','throughBall','cross','cutback','switch','shoot','clear','throw'].indexOf(chosen.type) >= 0;
    var commitTicks = chosen.type === 'receive' ? 54 : chosen.type === 'carry' ? 72 : chosenIsBallAction ? 24 : 36;
    var commitUntilTick = validOld && old.type === chosen.type && old.commitUntilTick != null ? old.commitUntilTick : createdTick + commitTicks;
    var focusPoint = null;
    if (chosen.type === 'receive' && chosen.details && chosen.details.facingTarget) {
      focusPoint = chosen.details.facingTarget;
    } else if (!carrying && (movementSpeeds[chosen.type] != null || (isKeeper(p) && chosen.type === 'hold'))) {
      if (isKeeper(p) && perceivedOwnerTeamId === p.teamId) {
        focusPoint = { x: pos.x + dir * 12, y: pos.y };
      } else if (isKeeper(p)) {
        var recentKeeperMemory = p.ai.lastKnownBall && p.ai.lastKnownBallTick != null && (Number(match.tick) - p.ai.lastKnownBallTick) <= 90;
        focusPoint = perceivedOwnerBelief ? estimated(perceivedOwnerBelief) : actionableBall ? bp : recentKeeperMemory ? p.ai.lastKnownBall : { x: pos.x + dir * 12, y: pos.y };
      } else if ((isDefender(p) || isScreenMidfielder(p)) && (perceivedOwnerTeamId !== p.teamId || !perceivedOwnerTeamId)) {
        var threatFocus = perceivedOwnerBelief ? estimated(perceivedOwnerBelief) : actionableBall ? bp : p.ai.lastKnownBall;
        if (threatFocus) {
          var ownGoalX = dir > 0 ? 0 : pitch.length;
          var actorDepth = progress(team, { x: ownGoalX, y: pos.y }, pos);
          var threatDepth = progress(team, { x: ownGoalX, y: threatFocus.y }, threatFocus);
          // A defender already goal-side can face the observed threat while
          // holding the line. A beaten defender leaves this unset and sprints
          // toward the recovery target; the motor must not pay a strafe penalty
          // while trying to regain goal-side position.
          if (actorDepth <= threatDepth + 0.6 || chosen.type === 'press' || chosen.type === 'challenge') focusPoint = threatFocus;
        }
      } else if (['support','move','overlap','underlap','thirdManRun','attackBox'].indexOf(chosen.type) >= 0 && chosen.target && dist(pos, chosen.target) < 4.5) {
        // Once an off-ball player reaches a useful support lane, open their body
        // toward the locally perceived carrier so they can see the next pass.
        // This cue is based on the actor's belief and leaves the movement target
        // unchanged; teammates without a fresh carrier observation get no cue.
        var knownTeammateCarrier = perceivedOwnerBelief && perceivedOwnerTeamId === p.teamId && Number(perceivedOwnerBelief.confidence) >= 0.3 && Number(perceivedOwnerBelief.ageTicks) <= 90;
        var observedOwnFlight = perceivedBall && actionableBall && perceivedBall.lastTouchTeamId === p.teamId && Number(perceivedBall.confidence) >= 0.45 && Number(perceivedBall.ageTicks) <= 30;
        if (knownTeammateCarrier) focusPoint = estimated(perceivedOwnerBelief);
        else if (observedOwnFlight) focusPoint = bp;
      }
    }
    if (focusPoint && (!Number.isFinite(Number(focusPoint.x)) || !Number.isFinite(Number(focusPoint.y)))) focusPoint = null;
    var intent = {
      type: chosen.type,
      teamIdAtCreation: p.teamId,
      target: chosen.target || pos,
      targetId: chosen.details.targetId || null,
      desiredSpeed: isRestartTaker && restartApproachTypes.indexOf(pendingRestart.type) >= 0 ? 0.62 : speed,
      createdTick: createdTick,
      commitUntilTick: commitUntilTick,
      expiresTick: match.tick + decisionPeriod,
      utility: chosen.utility,
      details: isRestartTaker && restartApproachTypes.indexOf(pendingRestart.type) >= 0
        ? Object.assign({}, chosen.details, { restartApproach: { sequence: Number(match.state.restartSequence) || 0 } })
        : chosen.details,
      action: chosen.details.physicsAction || (['cross', 'cutback', 'switch'].indexOf(chosen.type) >= 0 ? 'pass' : chosen.type),
      facingTarget: focusPoint ? { x: focusPoint.x, y: focusPoint.y } : null,
      ballTarget: actionParams.ballTarget || null,
      power: actionParams.power || 0,
      lift: actionParams.lift || 0,
      committed: !!chosen.committed
    };
    p.intent = intent;
    p.action = intent.action;
    p.currentAction = intent;
    p.motor = intent;
    p.movementTarget = intent.target;
    p.ai = p.ai || {};
    p.ai.lastDecision = match.tick;
    var cadenceOffset = (hash(id(p)) % 5) - 2;
    p.ai.nextDecision = match.tick + clamp(decisionPeriod + cadenceOffset, 6, 12);
    p.ai.selected = { type: intent.type, targetId: intent.targetId, utility: intent.utility, details: intent.details };
    p.ai.decisionExplanation = decisionExplanation;
    p.ai.candidates = candidates.slice(0, Math.min(8, consideration + 2)).map(function (c) { return { type: c.type, target: c.target, targetId: c.details.targetId || null, utility: Number(c.utility.toFixed(3)), utilityComponents: c.utilityComponents, details: c.details }; });
    p.ai.pressure = Number(pressure.toFixed(3));
    p.ai.considered = Math.min(consideration, candidates.length);
  }

  function thisOffsideRisk(team, targetPos, opponents, pitch, receiver, believedBallX) {
    if (!opponents.length) return 0;
    var dir = attackDir(team), defenders = opponents.map(function (e) { return estimated(e); }).sort(function (a, b) { return dir > 0 ? b.x - a.x : a.x - b.x; });
    var line = defenders[Math.min(1, defenders.length - 1)].x;
    var ballX = Number.isFinite(believedBallX) ? believedBallX : (dir > 0 ? 0 : pitch.length);
    var ahead = dir > 0 ? targetPos.x > line + 0.35 && targetPos.x > ballX + 0.35 : targetPos.x < line - 0.35 && targetPos.x < ballX - 0.35;
    return ahead ? clamp((Math.abs(targetPos.x - line) / 12) * (receiver ? receiver.confidence : 0.65), 0, 1) : 0;
  }
  function minOpponentDistance(point, opponents) { var m = 40; opponents.forEach(function (e) { m = Math.min(m, dist(point, estimated(e))); }); return m; }
  function minTeammateDistance(point, teammates) { var m = 24; teammates.forEach(function (e) { m = Math.min(m, dist(point, estimated(e))); }); return m; }
  function estimateLine(opponents, pitch, dir) {
    if (!opponents.length) return dir > 0 ? pitch.length * 0.62 : pitch.length * 0.38;
    var xs = opponents.map(function (e) { return estimated(e).x; }).sort(function (a, b) { return a - b; });
    return xs[Math.floor(xs.length * (dir > 0 ? 0.65 : 0.35))];
  }
  function teammateCloserTo(p, point) {
    return getBeliefs(p).some(function (e) { return e.teamId === p.teamId && e.confidence > 0.18 && dist(estimated(e), point) + 1 < dist(p, point); });
  }

  TF.updateAI = function (match, dt) {
    if (!match || !Array.isArray(match.players)) return;
    var tick = Number.isFinite(match.tick) ? match.tick : Math.floor((match._aiTime || 0) * 60);
    if (!Number.isFinite(match.tick)) match._aiTime = (match._aiTime || 0) + (Number(dt) || 1 / 60);
    var players = match.players, teams = match.teams || [], ball = match.ball || (match.world && match.world.ball), pitch = pitchOf(match);
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (!active(p)) continue;
      p.ai = p.ai || {};
      var team = teamFor(p, teams);
      if (!team) continue;
      var belief = observe(p, players, ball, tick, match);
      p.ai.beliefSummary = { entities: Object.keys(belief.entities || {}).length, ballConfidence: belief.ball ? Number(belief.ball.confidence.toFixed(2)) : 0, lastScanTick: belief.lastScanTick };
      if (belief.scanDirection) p.ai.scanTarget = { x: p.position.x + belief.scanDirection.x * 5, y: p.position.y + belief.scanDirection.y * 5 };
      p.ai.beliefSamples = Object.keys(belief.entities || {}).slice(0, 6).map(function (key) {
        var e = belief.entities[key];
        return { id: e.id, teamId: e.teamId, position: e.estimatedPosition, confidence: Number(e.confidence.toFixed(2)), ageTicks: e.ageTicks, source: e.source };
      });
      if (p.ai.nextDecision != null && tick < p.ai.nextDecision) {
        var lastDecisionTick = Number(p.ai.lastDecision);
        var urgent = false;
        if (Number.isFinite(lastDecisionTick) && tick - lastDecisionTick >= 3) {
          var perceivedBall = belief.ball;
          var ballActionable = perceivedBall && perceivedBall.confidence >= 0.45 && perceivedBall.ageTicks <= 36;
          var updateBallSpeed = perceivedBall ? hypot(Number(perceivedBall.velocity && perceivedBall.velocity.x) || 0, Number(perceivedBall.velocity && perceivedBall.velocity.y) || 0) : 0;
          var updateBallPoint = perceivedBall && (perceivedBall.estimatedPosition || perceivedBall.position);
          if (isKeeper(p) && ballActionable) {
            var ownX = (team.attackDirection || attackDir(team)) > 0 ? 0 : pitch.length;
            // predictedGoalCrossing expects the observer team's attacking
            // direction: its sign test rejects motion toward that team's own
            // goal. The urgent branch previously inverted it, rejecting the
            // exact fresh goalward flight that should trigger an early save.
            var ownDir = attackDir(team);
            var urgentOwnerBelief = perceivedBall.ownerId && belief.entities[id(perceivedBall.ownerId)];
            var crossing = predictedGoalCrossing(perceivedBall, ownX, ownDir, pitch, urgentOwnerBelief, p.teamId, p.id, p.position);
            urgent = !!(crossing && crossing.time <= 0.5);
            if (!urgent && p.intent && p.intent.type === 'intercept') {
              var keeperKnownOwner = perceivedBall.ownerId && belief.entities[id(perceivedBall.ownerId)];
              if (keeperKnownOwner && keeperKnownOwner.teamId !== p.teamId
                && Number(keeperKnownOwner.confidence) >= 0.3 && Number(keeperKnownOwner.ageTicks) <= 45
                && (estimated(keeperKnownOwner).x - ownX) * ownDir > 0
                && Math.abs(estimated(keeperKnownOwner).x - ownX) < 44) {
                // A fresh observed carrier in the return band can turn an old
                // sweep into a goal-side recovery before the next full cadence.
                urgent = true;
              } else if (!perceivedBall.ownerId) {
                var urgentMeet = reachableBallMeeting(p, perceivedBall, attr(p, 'anticipation', 0.5));
                var knownOpponents = Object.keys(belief.entities || {}).map(function (key) { return belief.entities[key]; })
                  .filter(function (entity) { return entity && entity.teamId !== p.teamId; });
                urgent = !urgentMeet || keeperOpponentWinsRace(p, urgentMeet, knownOpponents);
              }
            }
          } else if (p.intent && p.intent.type === 'receive' && ballActionable && (!perceivedBall.ownerId || (perceivedBall.ageTicks <= 12 && hypot(Number(perceivedBall.velocity && perceivedBall.velocity.x) || 0, Number(perceivedBall.velocity && perceivedBall.velocity.y) || 0) > 6))) {
            var possibleMeeting = reachableBallMeeting(p, perceivedBall, attr(p, 'anticipation', 0.5));
            urgent = !!(possibleMeeting && possibleMeeting.time <= 0.5);
          } else if (ballActionable && (!perceivedBall.ownerId || (perceivedBall.ageTicks <= 12 && updateBallSpeed > 6)) && updateBallSpeed > 5.6 && perceivedBall.ageTicks <= 12 && updateBallPoint && dist(p, updateBallPoint) < 23 && (tick + hash(id(p))) % 3 === 0) {
            // Check imminent loose/pass arrivals at a stable 20 Hz per actor,
            // so a named receiver can react without waiting for its next cadence.
            var urgentMeeting = reachableBallMeeting(p, perceivedBall, attr(p, 'anticipation', 0.5));
            urgent = !!(urgentMeeting && urgentMeeting.time <= 0.65);
          } else if (hasBall(p, ball) && (!p.intent || ['pass','throughBall','cross','cutback','switch','shoot','clear'].indexOf(p.intent.type) < 0)) {
            // The actor's own possession is proprioceptive; this catches a
            // first touch without reading a teammate's physical owner state.
            urgent = true;
          }
        }
        if (!urgent) continue;
      }
      var tactical = TF.getTacticalContext(match, p);
      p.ai.tacticalAnchor = tactical && tactical.anchor ? { x: tactical.anchor.x, y: tactical.anchor.y } : null;
      p.ai.tacticalPhase = tactical && tactical.phase || null;
      p.ai.teamIntent = tactical && tactical.intent || team.intent || null;
      decision(p, team, players, ball, match, pitch, tactical);
    }
  };
  if (typeof TF.getTacticalContext !== 'function') TF.getTacticalContext = function (match, player) {
    var team = teamFor(player, match.teams || []), tactics = team && team.tactics || {};
    return { anchor: roleAnchor(player, team, pitchOf(match)), intent: team && team.intent || 'balanced', phase: match.state && match.state.tacticalPhase || 'open-play', width: tactics.width, compactness: tactics.compactness };
  };
  TF.getPlayerBeliefView = function (player) {
    if (!player || !player.beliefState) return { entities: {}, ball: null, observations: [] };
    return player.beliefState;
  };
  TF.getPerceptionScanInterval = function (player, match) { return scanInterval(player || {}, match || {}); };
})(typeof window !== 'undefined' ? window : globalThis);
