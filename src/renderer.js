(function (root) {
  "use strict";

  var TF = root.TF = root.TF || {};
  var TAU = Math.PI * 2;
  var PALETTE = ["#f2644a", "#36a9c6", "#f0c447", "#8b73cf", "#e883b8", "#f2f0e8"];

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function num(value, fallback) { value = Number(value); return isFinite(value) ? value : fallback; }
  function position(entity) { return entity && entity.position ? entity.position : entity || { x: 0, y: 0, z: 0 }; }
  function mix(a, b, t) { return a + (b - a) * t; }

  function createRenderer(canvas, options) {
    options = options || {};
    if (!canvas || typeof canvas.getContext !== "function") throw new TypeError("TF.createRenderer requires a canvas");
    var ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) throw new Error("Canvas 2D is unavailable");
    var doc = canvas.ownerDocument || root.document;
    var camera = options.camera || (typeof TF.createCamera === "function" ? TF.createCamera(options.cameraOptions) : null);
    if (!camera) throw new Error("Load camera.js before renderer.js");
    var quality = options.quality === "low" ? "low" : "normal";
    var dpr = 1;
    var width = 1;
    var height = 1;
    var disposed = false;
    var pitchCache = null;
    var pitchCtx = null;
    var cacheLength = camera.pitchLength;
    var cacheWidth = camera.pitchWidth;
    var cacheUnit = 12;
    var localPrevious = null;
    var localCurrent = null;
    var localTick = -1;
    var lastMatch = null;
    var entitiesOnScreen = [];
    var selectedId = null;
    var showNumbers = options.showNumbers !== false;
    var showDebug = false;
    var frameCounter = 0;
    var palette = options.palette || {};
    var background = null;
    var resizeObserver = null;

    function makeBackground() {
      var gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "#252a2d");
      gradient.addColorStop(0.62, "#171b1d");
      gradient.addColorStop(1, "#111416");
      background = gradient;
    }

    function makePitchCache() {
      if (!doc || !doc.createElement) return;
      if (!pitchCache) {
        pitchCache = doc.createElement("canvas");
        pitchCtx = pitchCache.getContext("2d");
      }
      var margin = 4;
      pitchCache.width = Math.round((cacheLength + margin * 2) * cacheUnit);
      pitchCache.height = Math.round((cacheWidth + margin * 2) * cacheUnit);
      pitchCtx.setTransform(cacheUnit, 0, 0, cacheUnit, margin * cacheUnit, margin * cacheUnit);
      pitchCtx.clearRect(-margin, -margin, cacheLength + margin * 2, cacheWidth + margin * 2);
      var grass = pitchCtx.createLinearGradient(0, 0, 0, cacheWidth);
      grass.addColorStop(0, "#38895b");
      grass.addColorStop(0.52, "#2d8052");
      grass.addColorStop(1, "#28764b");
      pitchCtx.fillStyle = grass;
      pitchCtx.fillRect(0, 0, cacheLength, cacheWidth);
      pitchCtx.save();
      pitchCtx.beginPath();
      pitchCtx.rect(0, 0, cacheLength, cacheWidth);
      pitchCtx.clip();
      for (var stripe = 0; stripe < 14; stripe += 1) {
        if (stripe % 2) {
          pitchCtx.fillStyle = "rgba(178,221,159,0.045)";
          pitchCtx.fillRect(stripe * cacheLength / 14, 0, cacheLength / 14, cacheWidth);
        }
      }
      pitchCtx.restore();
      pitchCtx.strokeStyle = "rgba(244,248,227,0.78)";
      pitchCtx.lineWidth = 0.16;
      pitchCtx.lineJoin = "round";
      pitchCtx.strokeRect(0.12, 0.12, cacheLength - 0.24, cacheWidth - 0.24);
      pitchCtx.beginPath();
      pitchCtx.moveTo(cacheLength / 2, 0);
      pitchCtx.lineTo(cacheLength / 2, cacheWidth);
      pitchCtx.stroke();
      pitchCtx.beginPath();
      pitchCtx.arc(cacheLength / 2, cacheWidth / 2, 9.15, 0, TAU);
      pitchCtx.stroke();
      pitchCtx.fillStyle = "rgba(244,248,227,0.8)";
      pitchCtx.beginPath();
      pitchCtx.arc(cacheLength / 2, cacheWidth / 2, 0.22, 0, TAU);
      pitchCtx.fill();
      pitchCtx.strokeRect(0, cacheWidth / 2 - 20.16, 16.5, 40.32);
      pitchCtx.strokeRect(cacheLength - 16.5, cacheWidth / 2 - 20.16, 16.5, 40.32);
      pitchCtx.strokeRect(0, cacheWidth / 2 - 9.16, 5.5, 18.32);
      pitchCtx.strokeRect(cacheLength - 5.5, cacheWidth / 2 - 9.16, 5.5, 18.32);
      pitchCtx.beginPath();
      pitchCtx.arc(11, cacheWidth / 2, 9.15, -0.93, 0.93);
      pitchCtx.stroke();
      pitchCtx.beginPath();
      pitchCtx.arc(cacheLength - 11, cacheWidth / 2, 9.15, Math.PI - 0.93, Math.PI + 0.93);
      pitchCtx.stroke();
      pitchCtx.fillStyle = "rgba(246,249,229,0.88)";
      pitchCtx.beginPath(); pitchCtx.arc(11, cacheWidth / 2, 0.2, 0, TAU); pitchCtx.fill();
      pitchCtx.beginPath(); pitchCtx.arc(cacheLength - 11, cacheWidth / 2, 0.2, 0, TAU); pitchCtx.fill();
      pitchCtx.strokeStyle = "rgba(225,239,202,0.22)";
      pitchCtx.lineWidth = 0.65;
      for (var x = 8; x < cacheLength; x += 8) {
        pitchCtx.beginPath(); pitchCtx.moveTo(x, 0); pitchCtx.lineTo(x, cacheWidth); pitchCtx.stroke();
      }
      pitchCtx.strokeStyle = "rgba(255,255,255,0.10)";
      pitchCtx.lineWidth = 0.8;
      pitchCtx.strokeRect(0.6, 0.6, cacheLength - 1.2, cacheWidth - 1.2);
      // The goals sit beyond the end lines, with open netting visible from above.
      pitchCtx.save();
      pitchCtx.strokeStyle = "rgba(248,246,228,0.9)";
      pitchCtx.lineWidth = 0.24;
      [-1, 1].forEach(function (side) {
        var gx = side < 0 ? 0 : cacheLength, back = gx + side * 2.35;
        var gy1 = cacheWidth / 2 - 3.66, gy2 = cacheWidth / 2 + 3.66;
        pitchCtx.beginPath(); pitchCtx.moveTo(gx, gy1); pitchCtx.lineTo(back, gy1); pitchCtx.lineTo(back, gy2); pitchCtx.lineTo(gx, gy2); pitchCtx.stroke();
        pitchCtx.strokeStyle = "rgba(248,246,228,0.38)"; pitchCtx.lineWidth = 0.09;
        for (var gy = gy1 + 0.7; gy < gy2; gy += 0.7) { pitchCtx.beginPath(); pitchCtx.moveTo(gx, gy); pitchCtx.lineTo(back, gy); pitchCtx.stroke(); }
        pitchCtx.beginPath(); pitchCtx.moveTo(back, gy1); pitchCtx.lineTo(back, gy2); pitchCtx.stroke();
        pitchCtx.strokeStyle = "rgba(248,246,228,0.9)"; pitchCtx.lineWidth = 0.24;
      });
      pitchCtx.restore();
    }

    function setQuality(next) {
      quality = next === "low" ? "low" : "normal";
      resize();
      return quality;
    }

    function resize() {
      if (disposed) return;
      var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      var parentRect = canvas.parentElement && canvas.parentElement.getBoundingClientRect ? canvas.parentElement.getBoundingClientRect() : null;
      var cssWidth = rect && rect.width > 0 ? rect.width : parentRect && parentRect.width > 0 ? parentRect.width : canvas.clientWidth;
      var cssHeight = rect && rect.height > 0 ? rect.height : parentRect && parentRect.height > 0 ? parentRect.height : canvas.clientHeight;
      // A canvas hidden during page setup reports zero dimensions. Keep its last
      // valid backing store until it becomes visible and can be sized properly.
      if (!(cssWidth > 0 && cssHeight > 0)) return;
      width = Math.max(1, Math.round(cssWidth));
      height = Math.max(1, Math.round(cssHeight));
      var deviceScale = root.devicePixelRatio || 1;
      dpr = Math.min(deviceScale, quality === "low" ? 1 : (width < 700 ? 1.35 : 1.75));
      var backingWidth = Math.round(width * dpr);
      var backingHeight = Math.round(height * dpr);
      if (canvas.width !== backingWidth) canvas.width = backingWidth;
      if (canvas.height !== backingHeight) canvas.height = backingHeight;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      camera.resize(width, height);
      makeBackground();
      makePitchCache();
    }

    function copyPositionMap(match) {
      var copy = Object.create(null);
      var players = match && (match.players || (match.world && match.world.players)) || [];
      for (var i = 0; i < players.length; i += 1) {
        var player = players[i];
        if (!player || player.active === false) continue;
        var p = position(player);
        copy[String(player.id)] = { x: num(p.x, 0), y: num(p.y, 0), z: num(p.z, 0) };
      }
      var ball = match && (match.ball || (match.world && match.world.ball));
      if (ball) {
        var bp = position(ball);
        copy["ball:" + String(ball.id == null ? "main" : ball.id)] = { x: num(bp.x, 0), y: num(bp.y, 0), z: num(bp.z, 0) };
      }
      if (match && match.referee) {
        var rp = position(match.referee);
        copy[String(match.referee.id == null ? "referee" : match.referee.id)] = { x: num(rp.x, 0), y: num(rp.y, 0), z: num(rp.z, 0) };
      }
      return copy;
    }

    function capture(match) {
      if (!match) return;
      var tick = num(match.tick, localTick + 1);
      if (tick === localTick) return;
      var next = copyPositionMap(match);
      localPrevious = localCurrent || next;
      localCurrent = next;
      localTick = tick;
      lastMatch = match;
    }

    function snapshotLookup(snapshot, id, key) {
      if (!snapshot) return null;
      if (key && String(key).indexOf("ball:") === 0 && snapshot.ball) return snapshot.ball.position || snapshot.ball;
      if (snapshot.players && snapshot.players[String(id)]) return snapshot.players[String(id)].position || snapshot.players[String(id)];
      var collection = snapshot.positions || snapshot.entities || snapshot;
      var item = collection[String(key == null ? id : key)];
      if (!item && Array.isArray(collection)) {
        for (var i = 0; i < collection.length; i += 1) {
          if (collection[i] && String(collection[i].id) === String(id)) { item = collection[i]; break; }
        }
      }
      if (!item) return null;
      return item.position || item;
    }

    function interpolated(entity, alpha, match) {
      var key = entity === (match && (match.ball || (match.world && match.world.ball))) ? "ball:" + String(entity.id == null ? "main" : entity.id) : String(entity.id);
      var prev = snapshotLookup(match && match.renderPrevious, entity.id, key) || (localPrevious && localPrevious[key]);
      var current = snapshotLookup(match && match.renderCurrent, entity.id, key) || (localCurrent && localCurrent[key]);
      var currentSource = current || position(entity);
      var previousSource = prev || currentSource;
      var t = clamp(num(alpha, 1), 0, 1);
      return { x: mix(num(previousSource.x, currentSource.x), num(currentSource.x, 0), t), y: mix(num(previousSource.y, currentSource.y), num(currentSource.y, 0), t), z: mix(num(previousSource.z, currentSource.z), num(currentSource.z, 0), t) };
    }

    function transformWorld() {
      // The static pitch cache and actors use the same 2.5D affine projection.
      var center = camera.center;
      var s = camera.scale;
      if (camera.mode === "tactical") {
        ctx.setTransform(dpr * s, 0, 0, dpr * s,
          dpr * (width / 2 - center.x * s), dpr * (height / 2 - center.y * s));
        return;
      }
      var cs = Math.SQRT1_2;
      var tilt = camera.mode === "tactical" ? 1 : 0.38;
      var a = cs * s;
      var b = cs * tilt * s;
      var c = -cs * s;
      var d = cs * tilt * s;
      var e = width / 2 + (-center.x + center.y) * cs * s;
      var f = height / 2 + (-center.x - center.y) * cs * tilt * s;
      ctx.setTransform(dpr * a, dpr * b, dpr * c, dpr * d, dpr * e, dpr * f);
    }

    function drawTable() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
      var vignette = ctx.createRadialGradient(width * 0.5, height * 0.46, Math.min(width, height) * 0.15, width * 0.5, height * 0.5, Math.max(width, height) * 0.72);
      vignette.addColorStop(0, "rgba(255,255,255,0.035)");
      vignette.addColorStop(1, "rgba(0,0,0,0.22)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);
      if (!pitchCache) return;
      transformWorld();
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.56)";
      ctx.shadowBlur = quality === "normal" ? 20 / camera.scale : 0;
      ctx.shadowOffsetY = 5 / camera.scale;
      ctx.fillStyle = "#b78554";
      ctx.fillRect(-3.3, -3.3, cacheLength + 6.6, cacheWidth + 6.6);
      ctx.shadowColor = "transparent";
      ctx.fillStyle = "#815936";
      ctx.fillRect(-2.7, -2.7, cacheLength + 5.4, cacheWidth + 5.4);
      ctx.fillStyle = "#d4a36c";
      ctx.fillRect(-1.9, -1.9, cacheLength + 3.8, cacheWidth + 3.8);
      ctx.drawImage(pitchCache, -4, -4, cacheLength + 8, cacheWidth + 8);
      ctx.restore();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function teamColor(player, index) {
      var team = player && player.team;
      if (team && (team.color || team.kitColor || team.colors && team.colors.primary)) return team.color || team.kitColor || team.colors.primary;
      var id = player && player.teamId;
      var teams = lastMatch && lastMatch.teams || [];
      for (var i = 0; i < teams.length; i += 1) {
        if (teams[i] && String(teams[i].id) === String(id)) return teams[i].color || teams[i].kitColor || teams[i].colors && teams[i].colors.primary || PALETTE[i % 2];
      }
      return PALETTE[(index || 0) % 2];
    }

    function contrasting(color) {
      if (typeof color !== "string" || color.charAt(0) !== "#") return "#f6f3e9";
      var hex = color.slice(1);
      if (hex.length === 3) hex = hex.replace(/(.)/g, "$1$1");
      var n = parseInt(hex, 16);
      var lum = (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000;
      return lum > 155 ? "#142127" : "#f8f4e8";
    }

    function teamTrim(player, color) {
      var team = player && player.team;
      var secondary = team && team.colors && team.colors.secondary;
      if (typeof secondary === "string" && /^#[0-9a-f]{6}$/i.test(secondary)) return secondary;
      var teams = lastMatch && lastMatch.teams || [];
      for (var i = 0; i < teams.length; i += 1) {
        if (teams[i] && String(teams[i].id) === String(player && player.teamId)) {
          secondary = teams[i].colors && teams[i].colors.secondary;
          if (typeof secondary === "string" && /^#[0-9a-f]{6}$/i.test(secondary)) return secondary;
        }
      }
      return contrasting(color);
    }

    function facingAngle(player) {
      var f = player && player.facing;
      if (typeof f === "number") return f;
      if (f && typeof f.x === "number" && typeof f.y === "number") return Math.atan2(f.y, f.x);
      var v = player && player.velocity;
      if (v && (Math.abs(v.x) + Math.abs(v.y) > 0.2)) return Math.atan2(v.y, v.x);
      return 0;
    }

    function drawPlayer(player, p, index, match, selected) {
      var velocity = player.velocity || { x: 0, y: 0 };
      var speed = Math.sqrt(num(velocity.x, 0) * num(velocity.x, 0) + num(velocity.y, 0) * num(velocity.y, 0));
      var tick = num(match.tick, 0);
      var gaitPhase = tick * 0.34 + (num(player.id, index + 1) * 2.17);
      var stride = Math.min(0.23, speed * 0.06);
      var run = clamp(speed / 5.8, 0, 1);
      var face = facingAngle(player);
      var color = teamColor(player, index);
      var trim = teamTrim(player, color);
      var appearance = TF.appearance ? TF.appearance.resolved(player) : { skinColor: '#e9d0b6', hairColor: '#46352c', hairStyle: 'short' };
      var radius = player.isGoalkeeper ? 12 : 10;
      var bob = run * (1.2 + Math.sin(gaitPhase * 2) * 0.8);
      var motion = player.visualMotion || player._visualMotion || null;
      var age = motion ? Math.max(0, num(match.tick, 0) - num(motion.tick, 0)) : Infinity;
      var motionAge = age / 60;
      var motionType = String(motion && motion.type || "").toLowerCase();
      var kick = motion && /pass|shoot|clear|header|throw/i.test(motionType) && motionAge < 0.24 ? Math.sin(Math.PI * clamp(motionAge / 0.24, 0, 1)) * 11 : 0;
      var tackle = motion && /tackle|contact|dive|save/i.test(motionType) && motionAge < 0.55 ? Math.sin(Math.PI * clamp(motionAge / 0.55, 0, 1)) : 0;
      var keeperDive = player.isGoalkeeper && /dive|save/.test(motionType) && motionAge < 0.65 ? Math.sin(Math.PI * clamp(motionAge / 0.65, 0, 1)) : 0;
      var header = motionType === "header" && motionAge < 0.34 ? Math.sin(Math.PI * clamp(motionAge / 0.34, 0, 1)) : 0;
      var scan = player.ai && player.ai.scanTarget;
      var scanTurn = scan && typeof scan.x === "number" ? clamp(Math.atan2(scan.y - p.y, scan.x - p.x) - face, -0.55, 0.55) : 0;

      var projected = camera.project(p), screenFace;
      var forwardPoint = camera.project({ x: p.x + Math.cos(face), y: p.y + Math.sin(face), z: 0 });
      screenFace = Math.atan2(forwardPoint.y - projected.y, forwardPoint.x - projected.x);
      var facingScreenX = clamp(Math.cos(screenFace), -1, 1);
      var yawWidth = 0.62 + 0.38 * Math.abs(facingScreenX);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      ctx.translate(projected.x, projected.y);
      if (quality === "normal") {
        ctx.fillStyle = "rgba(10,22,16,0.36)";
        ctx.beginPath(); ctx.ellipse(1.8, 1.5, radius * 0.92, radius * 0.44, 0, 0, TAU); ctx.fill();
      }
      // Keep the figure upright in screen space. Facing changes horizontal
      // foreshortening and gaze, never the orientation of the whole sprite.
      var fall = /tackle|contact/.test(motionType) ? tackle * 0.58 : 0;
      var diveSign = motion && motion.target && motion.target.x < p.x ? -1 : 1;
      ctx.translate(0, -(bob + header * 4));
      var bodyTilt = fall + diveSign * keeperDive * 1.18;
      if (Math.abs(bodyTilt) > 0.001) ctx.rotate(bodyTilt);
      var figureScale = width < 500 ? 0.86 : 1.08;
      ctx.scale(yawWidth * figureScale, 1);
      var legA = Math.sin(gaitPhase) * stride * 12 + kick + header * 4;
      var legB = -Math.sin(gaitPhase) * stride * 12 - kick * 0.45 + header * 4;
      ctx.lineCap = "round"; ctx.strokeStyle = appearance.skinColor; ctx.lineWidth = 3.3;
      ctx.beginPath(); ctx.moveTo(-3.0, -7); ctx.lineTo(-3.0 + legA, -1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(3.0, -7); ctx.lineTo(3.0 + legB, -1); ctx.stroke();
      // Team socks, dark boots and distinct shorts remain visual only.
      ctx.strokeStyle = trim; ctx.lineWidth = 3.7;
      ctx.beginPath(); ctx.moveTo(-3 + legA * 0.65, -3); ctx.lineTo(-3 + legA, -0.5); ctx.moveTo(3 + legB * 0.65, -3); ctx.lineTo(3 + legB, -0.5); ctx.stroke();
      ctx.fillStyle = "#111821";
      ctx.beginPath(); ctx.ellipse(-3 + legA + 1, 0, 3.4, 1.8, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(3 + legB + 1, 0, 3.4, 1.8, 0, 0, TAU); ctx.fill();
      var armSwing = Math.sin(gaitPhase + Math.PI) * stride * 8;
      var diveReach = keeperDive * 8, headerReach = header * 6;
      ctx.strokeStyle = color; ctx.lineWidth = 3.1; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-4.4, -14); ctx.lineTo(-7.4 - armSwing - diveReach, -9 - headerReach); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(4.4, -14); ctx.lineTo(7.4 + armSwing + diveReach, -9 - headerReach); ctx.stroke();
      ctx.fillStyle = color; ctx.strokeStyle = "rgba(10,18,21,0.9)"; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(-3.3,-17); ctx.lineTo(-7,-14); ctx.lineTo(-5.8,-10); ctx.lineTo(-4.7,-11); ctx.lineTo(-4.3,-6); ctx.lineTo(4.3,-6); ctx.lineTo(4.7,-11); ctx.lineTo(5.8,-10); ctx.lineTo(7,-14); ctx.lineTo(3.3,-17); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#15212d";ctx.fillRect(-4.5,-7,9,3.8);
      ctx.strokeStyle=trim;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(-4,-6);ctx.lineTo(-4,-3);ctx.moveTo(4,-6);ctx.lineTo(4,-3);ctx.stroke();
      ctx.fillStyle=appearance.skinColor;ctx.beginPath();ctx.arc(-7.4-armSwing-diveReach,-9-headerReach,1.6,0,TAU);ctx.arc(7.4+armSwing+diveReach,-9-headerReach,1.6,0,TAU);ctx.fill();
      ctx.fillStyle = trim; ctx.globalAlpha = 0.9; ctx.fillRect(-4.1, -13, 1.5, 5.5); ctx.globalAlpha = 1;
      ctx.fillStyle = appearance.skinColor; ctx.beginPath(); ctx.arc(0, -19, 3.6, 0, TAU); ctx.fill();
      if (appearance.hairStyle !== "bald") { ctx.fillStyle = appearance.hairColor; ctx.beginPath(); ctx.arc(0, -19.5, appearance.hairStyle === "crop" ? 3.1 : 3.5, Math.PI, TAU); ctx.fill(); }
      // A small gaze mark shifts with the horizontal component of facing;
      // scanning stays a subtle head cue and does not rotate the body.
      ctx.fillStyle = "rgba(20,27,30,0.85)"; ctx.beginPath(); ctx.arc(2.2 * facingScreenX, -19, 0.8, 0, TAU); ctx.fill();
      if (player.isGoalkeeper) {
        ctx.strokeStyle = "#f3dc68";
        ctx.lineWidth = 1.7;
        ctx.beginPath(); ctx.arc(-5.7, -9, 1.8, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(5.7, -9, 1.8, 0, TAU); ctx.stroke();
      }
      if (scanTurn) {
        ctx.save(); ctx.rotate(scanTurn); ctx.fillStyle = "rgba(255,245,185,0.28)";
        ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(-3.8, -25); ctx.lineTo(3.8, -25); ctx.closePath(); ctx.fill(); ctx.restore();
      }
      ctx.restore();

      if (showNumbers && width > 360) {
        ctx.save();
        ctx.font = "bold 8px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = trim;
        ctx.fillText(String(player.number == null ? "" : player.number), projected.x, projected.y - 10);
        ctx.restore();
      }
      transformWorld();

      entitiesOnScreen.push({ id: player.id, entity: player, x: projected.x, y: projected.y - 10, radius: Math.max(11, radius), selected: selected });
      if (selected) drawSelectionRing(p, 1.7);
    }

    function drawSelectionRing(p, radius) {
      ctx.save();
      var screen = camera.project(p);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = "#f5d766";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 2.5]);
      ctx.beginPath(); ctx.ellipse(screen.x, screen.y, radius * 1.58, radius * 0.93, 0, 0, TAU); ctx.stroke();
      ctx.restore();
    }

    function drawBall(ball, p, match) {
      // Minimum screen size makes the real ball readable without changing physics.
      var screen=camera.project(p),ground=camera.project({x:p.x,y:p.y,z:0}),r=Math.max(4.2,Math.min(6.2,width/220));
      ctx.save();ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.fillStyle="rgba(5,13,9,0.55)";ctx.beginPath();ctx.ellipse(ground.x+2,ground.y+2,r*1.15,r*.55,0,0,TAU);ctx.fill();
      if(p.z>.2){ctx.strokeStyle="rgba(255,255,255,0.25)";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(ground.x,ground.y);ctx.lineTo(screen.x,screen.y);ctx.stroke();}
      ctx.shadowColor="#07170b";ctx.shadowBlur=4;ctx.fillStyle="#fffdf1";ctx.strokeStyle="#14241b";ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(screen.x,screen.y,r,0,TAU);ctx.fill();ctx.stroke();ctx.shadowBlur=0;
      ctx.fillStyle="#263039";ctx.beginPath();ctx.arc(screen.x-.5,screen.y-.5,r*.29,0,TAU);ctx.fill();ctx.beginPath();ctx.arc(screen.x+r*.6,screen.y+r*.22,r*.17,0,TAU);ctx.fill();
      ctx.restore();entitiesOnScreen.push({id:"ball",entity:ball,x:screen.x,y:screen.y,radius:12,ball:true});
    }

    function drawReferee(referee, p) {
      if (!referee) return;
      var screen = camera.project(p);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      ctx.translate(screen.x, screen.y);
      if (quality === "normal") {
        ctx.fillStyle = "rgba(8,17,15,0.28)";
        ctx.beginPath(); ctx.ellipse(1, 1, 9, 4, 0, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = "#12191c";
      ctx.strokeStyle = "rgba(248,245,231,0.68)";
      ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.ellipse(0, -9, 4.3, 7.2, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "#e4c44f";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-2.8, -11); ctx.lineTo(2.8, -7); ctx.stroke();
      ctx.fillStyle = "#e9d0b6";
      ctx.beginPath(); ctx.arc(0, -19, 3.3, 0, TAU); ctx.fill();
      ctx.restore();
      transformWorld();
      entitiesOnScreen.push({ id: referee.id || "referee", entity: referee, x: screen.x, y: screen.y - 10, radius: 10 });
    }

    function drawDebug(match) {
      if (!showDebug) return;
      var players = match.players || (match.world && match.world.players) || [];
      var all = showDebug === true;
      var on = function (name) { return all || !!showDebug[name]; };
      ctx.save();
      for (var i = 0; i < players.length; i += 1) {
        var player = players[i];
        if (!player || player.active === false) continue;
        var p = interpolated(player, 1, match);
        var intent = player.intent;
        var targetPoint = intent && (intent.target || intent.ballTarget);
        if (on("intent") && targetPoint) {
          ctx.strokeStyle = player.team && player.team.color || "rgba(255,255,255,0.65)";
          ctx.lineWidth = 0.055;
          ctx.setLineDash([0.35, 0.22]);
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(num(targetPoint.x, p.x), num(targetPoint.y, p.y)); ctx.stroke();
        }
        if (on("anchors") && player.ai && player.ai.tacticalAnchor) {
          var a = player.ai.tacticalAnchor;
          ctx.strokeStyle = "rgba(255,239,116,0.76)"; ctx.lineWidth = 0.08; ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(a.x, a.y, 0.8, 0, TAU); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(a.x, a.y); ctx.stroke();
        }
        if (on("pressure")) {
          var pressure = clamp(num(player.ai && player.ai.pressure, 0), 0, 1.5);
          if (pressure > 0.08) { ctx.strokeStyle = "rgba(255,76,65," + clamp(0.25 + pressure * 0.35, 0.25, 0.8) + ")"; ctx.lineWidth = 0.16; ctx.beginPath(); ctx.arc(p.x, p.y, 1.2 + pressure * 2.6, 0, TAU); ctx.stroke(); }
        }
        if (on("control")) {
          var ball = match.ball || (match.world && match.world.ball);
          if (ball && ball.ownerId === player.id) { ctx.fillStyle = "rgba(255,233,91,0.22)"; ctx.strokeStyle = "rgba(255,233,91,0.95)"; ctx.lineWidth = 0.12; ctx.beginPath(); ctx.arc(p.x, p.y, 1.25, 0, TAU); ctx.fill(); ctx.stroke(); }
        }
        if (on("passLanes") && player.ai && player.ai.candidates) {
          player.ai.candidates.forEach(function (candidate) {
            if ((candidate.type === "pass" || candidate.type === "throughBall") && candidate.target) {
              ctx.strokeStyle = candidate.type === "throughBall" ? "rgba(75,236,214,0.64)" : "rgba(232,242,210,0.36)";
              ctx.lineWidth = 0.045 + clamp(num(candidate.utility, 0), 0, 1) * 0.055;
              ctx.setLineDash(candidate.type === "throughBall" ? [0.65, 0.22] : [0.2, 0.2]);
              ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(candidate.target.x, candidate.target.y); ctx.stroke();
            }
          });
        }
        if (on("candidates") && player.ai && player.ai.candidates) {
          player.ai.candidates.slice(0, 6).forEach(function (candidate, j) {
            if (!candidate.target) return;
            ctx.fillStyle = ["#f5d766", "#64d9c4", "#8bc5ff", "#f5a45f", "#d08bf4", "#f27d7d"][j];
            ctx.beginPath(); ctx.arc(candidate.target.x, candidate.target.y, 0.26 + clamp(num(candidate.utility, 0), 0, 1) * 0.22, 0, TAU); ctx.fill();
          });
        }
        if (on("perceptionPaths") && player.ai && player.ai.beliefSamples) {
          player.ai.beliefSamples.forEach(function (sample) {
            var q = sample.position;
            if (!q) return;
            ctx.strokeStyle = sample.teamId === player.teamId ? "rgba(106,201,255,0.24)" : "rgba(255,126,101,0.31)";
            ctx.lineWidth = 0.035; ctx.setLineDash([0.12, 0.2]); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          });
        }
        if (on("perceptionCone")) {
          var facing = player.facing || { x: 1, y: 0 };
          var heading = Math.atan2(num(facing.y, 0), num(facing.x, 1));
          var vision = clamp(num(player.attributes && player.attributes.vision, 55) / 100, 0.25, 1);
          var range = 12 + vision * 20, halfAngle = (0.52 + vision * 0.2);
          ctx.fillStyle = "rgba(105,196,255,0.075)"; ctx.strokeStyle = "rgba(105,196,255,0.24)"; ctx.lineWidth = 0.045;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.arc(p.x, p.y, range, heading - halfAngle, heading + halfAngle); ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      }
      if (on("offside") && match.ball && match.ball.offsideKick) {
        var line = num(match.ball.offsideKick.line, NaN);
        if (isFinite(line)) { ctx.strokeStyle = "rgba(255,88,83,0.8)"; ctx.lineWidth = 0.1; ctx.setLineDash([1.2, 0.35]); ctx.beginPath(); ctx.moveTo(line, 0); ctx.lineTo(line, cacheWidth); ctx.stroke(); }
      }
      ctx.restore();
    }

    function drawScorebug(match) {
      var teams = match.teams || [];
      var left = teams[0] || {};
      var right = teams[1] || {};
      var score = match.state && match.state.score || match.score || {};
      var leftScore = score[left.id] == null ? (score.home == null ? 0 : score.home) : score[left.id];
      var rightScore = score[right.id] == null ? (score.away == null ? 0 : score.away) : score[right.id];
      var minute = match.clock && (match.clock.minute != null ? match.clock.minute : match.clock.elapsedMinutes);
      if (minute == null && match.clock && Number.isFinite(Number(match.clock.periodSeconds))) {
        var baseHalf = Number(match.halfSeconds) > 0 ? Number(match.halfSeconds) : 2700;
        var nominal = match.clock.periodSeconds;
        var period = Number(match.clock.period) || 1;
        var baseMinute = period === 2 ? 45 : 0;
        var periodMinutes = Math.floor(nominal / 60);
        if (nominal > baseHalf && baseHalf === 2700) minute = baseMinute + 45 + "+" + Math.max(1, Math.floor((nominal - baseHalf) / 60));
        else minute = baseMinute + periodMinutes;
      }
      if (minute == null && match.state) minute = match.state.minute;
      var timeText = minute == null ? "LIVE" : String(typeof minute === "string" ? minute : Math.floor(num(minute, 0))) + "′";
      var boxWidth = Math.min(380, Math.max(252, width * 0.31));
      var x = (width - boxWidth) / 2;
      var y = 14;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.32)"; ctx.shadowBlur = 12;
      ctx.fillStyle = "rgba(14,20,23,0.92)";
      roundRect(ctx, x, y, boxWidth, 48, 10); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#d9bb69"; roundRect(ctx, x, y, boxWidth, 3, 2); ctx.fill();
      ctx.fillStyle = "#f2eee2";
      ctx.font = "650 12px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "right";
      ctx.fillText(String(left.shortName || left.name || "HOME"), x + boxWidth * 0.36, y + 25, boxWidth * 0.27);
      ctx.textAlign = "left";
      ctx.fillText(String(right.shortName || right.name || "AWAY"), x + boxWidth * 0.64, y + 25, boxWidth * 0.27);
      ctx.fillStyle = "#101719";
      roundRect(ctx, x + boxWidth * 0.39, y + 8, boxWidth * 0.22, 32, 6); ctx.fill();
      ctx.fillStyle = "#fff8e9";
      ctx.textAlign = "center";
      ctx.font = "700 17px system-ui, sans-serif";
      ctx.fillText(String(leftScore) + "  :  " + String(rightScore), x + boxWidth / 2, y + 20);
      ctx.fillStyle = "#e1c774";
      ctx.font = "600 9px system-ui, sans-serif";
      ctx.fillText(timeText, x + boxWidth / 2, y + 34);
      ctx.restore();
    }

    function roundRect(context, x, y, w, h, r) {
      var radius = Math.min(r, w / 2, h / 2);
      context.beginPath();
      context.moveTo(x + radius, y); context.arcTo(x + w, y, x + w, y + h, radius);
      context.arcTo(x + w, y + h, x, y + h, radius); context.arcTo(x, y + h, x, y, radius);
      context.arcTo(x, y, x + w, y, radius); context.closePath();
    }

    function render(match, alpha) {
      if (disposed || !match) return;
      lastMatch = match;
      if (num(match.tick, 0) !== localTick) capture(match);
      camera.update(match, num(options.renderDt, 1 / 60));
      drawTable();
      entitiesOnScreen.length = 0;
      transformWorld();
      var players = match.players || (match.world && match.world.players) || [];
      var sorted = [];
      for (var i = 0; i < players.length; i += 1) {
        if (players[i] && players[i].active !== false) {
          var playerPoint = interpolated(players[i], alpha, match);
          sorted.push({ kind: "player", entity: players[i], index: i, point: playerPoint, depth: camera.mode === "tactical" ? playerPoint.y : playerPoint.x + playerPoint.y });
        }
      }
      var ball = match.ball || (match.world && match.world.ball);
      if (ball) {
        var ballPoint = interpolated(ball, alpha, match);
        sorted.push({ kind: "ball", entity: ball, point: ballPoint, depth: camera.mode === "tactical" ? ballPoint.y : ballPoint.x + ballPoint.y });
      }
      var referee = match.referee;
      if (referee) {
        var refereePoint = interpolated(referee, alpha, match);
        sorted.push({ kind: "referee", entity: referee, point: refereePoint, depth: camera.mode === "tactical" ? refereePoint.y : refereePoint.x + refereePoint.y });
      }
      sorted.sort(function (a, b) { return a.depth - b.depth; });
      for (var j = 0; j < sorted.length; j += 1) {
        var item = sorted[j];
        if (item.kind === "player") drawPlayer(item.entity, item.point, item.index, match, String(item.entity.id) === String(selectedId));
        else if (item.kind === "ball") drawBall(item.entity, item.point, match);
        else drawReferee(item.entity, item.point);
      }
      drawDebug(match);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawScorebug(match);
      frameCounter += 1;
    }

    function hitTest(x, y) {
      var best = null;
      var bestDistance = Infinity;
      for (var i = entitiesOnScreen.length - 1; i >= 0; i -= 1) {
        var entry = entitiesOnScreen[i];
        var dx = x - entry.x, dy = y - entry.y;
        var d2 = dx * dx + dy * dy;
        var limit = entry.radius + (entry.ball ? 4 : 6);
        if (d2 <= limit * limit && d2 < bestDistance) { best = entry.entity; bestDistance = d2; }
      }
      if (best) selectedId = best.id;
      return best;
    }

    function destroy() {
      disposed = true;
      if (resizeObserver) resizeObserver.disconnect();
      root.removeEventListener && root.removeEventListener("resize", resize);
      pitchCache = pitchCtx = null;
      entitiesOnScreen.length = 0;
    }

    if (typeof root.ResizeObserver === "function") {
      resizeObserver = new root.ResizeObserver(resize);
      resizeObserver.observe(canvas.parentElement || canvas);
    } else if (root.addEventListener) root.addEventListener("resize", resize);
    resize();

    return {
      capture: capture,
      render: render,
      resize: resize,
      setCamera: function (mode, targetId) { camera.setMode(mode, targetId); return camera.mode; },
      zoomBy: function (factor) { return camera.zoomBy(factor); },
      pan: function (dx, dy) { camera.pan(dx, dy); },
      setQuality: setQuality,
      setSelected: function (id) { selectedId = id == null ? null : id; },
      setShowNumbers: function (visible) { showNumbers = visible !== false; },
      setDebug: function (visible) {
        if (visible === true) showDebug = true;
        else if (visible && typeof visible === "object") {
          showDebug = Object.assign({}, visible);
          if (showDebug.movement) showDebug.intent = true;
          if (showDebug.beliefs) showDebug.perceptionPaths = true;
          if (showDebug.candidate) showDebug.candidates = true;
        } else showDebug = false;
      },
      hitTest: hitTest,
      destroy: destroy,
      camera: camera,
      get quality() { return quality; },
      get frameCount() { return frameCounter; },
      get selectedId() { return selectedId; }
    };
  }

  TF.createRenderer = createRenderer;
})(typeof window !== "undefined" ? window : globalThis);
