(function (root) {
  "use strict";

  var TF = root.TF = root.TF || {};
  var HALF = Math.PI / 4;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function makeCamera(options) {
    options = options || {};
    var width = 1;
    var height = 1;
    var pitchLength = options.pitchLength || 105;
    var pitchWidth = options.pitchWidth || 68;
    var margin = options.margin == null ? 34 : options.margin;
    var mode = "full-pitch";
    var center = { x: pitchLength / 2, y: pitchWidth / 2, z: 0 };
    var userZoom = 1;
    var smoothCenter = { x: center.x, y: center.y };
    var currentCenter = { x: center.x, y: center.y };
    var projectScale = 1;
    var tilt = 0.38;
    var spin = 0;
    var targetId = null;
    var target = null;
    var tactical = false;

    function iso(point) {
      var x = Number(point && point.x) || 0;
      var y = Number(point && point.y) || 0;
      var z = Number(point && point.z) || 0;
      if (tactical) return { x: x, y: y - z };
      var cs = Math.cos(spin);
      var sn = Math.sin(spin);
      var rx = (x - pitchLength / 2) * cs - (y - pitchWidth / 2) * sn;
      var ry = (x - pitchLength / 2) * sn + (y - pitchWidth / 2) * cs;
      return { x: rx * Math.cos(HALF) - ry * Math.sin(HALF), y: (rx * Math.sin(HALF) + ry * Math.cos(HALF)) * tilt - z * 0.88 };
    }

    function calculateFit() {
      var points = [
        { x: 0, y: 0 }, { x: pitchLength, y: 0 },
        { x: pitchLength, y: pitchWidth }, { x: 0, y: pitchWidth }
      ];
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var i = 0; i < points.length; i += 1) {
        var p = iso(points[i]);
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      var pad = Math.max(12, margin);
      var fitX = (width - pad * 2) / Math.max(1, maxX - minX);
      var fitY = (height - pad * 2) / Math.max(1, maxY - minY);
      projectScale = Math.max(0.05, Math.min(fitX, fitY)) * userZoom;
    }

    function screen(point) {
      var p = iso(point);
      var c = iso(currentCenter);
      return { x: width * 0.5 + (p.x - c.x) * projectScale, y: height * 0.5 + (p.y - c.y) * projectScale };
    }

    function world(point) {
      var px = (point.x - width * 0.5) / projectScale;
      var py = (point.y - height * 0.5) / projectScale;
      if (tactical) return { x: currentCenter.x + px, y: currentCenter.y + py, z: 0 };
      // Inverse of the isometric projection, including rotation and tilt.
      var ix = (px / Math.cos(HALF) + py / (Math.sin(HALF) * tilt)) * 0.5;
      var iy = (-px / Math.sin(HALF) + py / (Math.cos(HALF) * tilt)) * 0.5;
      var cs = Math.cos(spin), sn = Math.sin(spin);
      return {
        x: currentCenter.x + ix * cs + iy * sn,
        y: currentCenter.y - ix * sn + iy * cs,
        z: 0
      };
    }

    function setMode(next, nextTarget) {
      mode = next || "full-pitch";
      targetId = nextTarget == null ? null : nextTarget;
      target = null;
      tactical = mode === "tactical";
      spin = 0;
      tilt = tactical ? 1 : 0.38;
      userZoom = mode === "broadcast" ? 1.45 : (mode === "follow" ? 1.75 : 1);
      smoothCenter.x = currentCenter.x;
      smoothCenter.y = currentCenter.y;
      calculateFit();
      return mode;
    }

    function resolveTarget(match) {
      if (mode === "broadcast") return match && match.ball && match.ball.position;
      if (mode !== "follow" || targetId == null || !match) return null;
      var players = match.players || (match.world && match.world.players) || [];
      for (var i = 0; i < players.length; i += 1) {
        if (players[i] && String(players[i].id) === String(targetId)) return players[i].position;
      }
      if (match.ball && String(match.ball.id) === String(targetId)) return match.ball.position;
      if (match.referee && String(match.referee.id) === String(targetId)) return match.referee.position;
      return null;
    }

    function update(match, dt) {
      target = resolveTarget(match);
      if (target && (mode === "broadcast" || mode === "follow")) {
        var smoothing = 1 - Math.exp(-Math.max(0, dt || 0) * 4.5);
        smoothCenter.x += (target.x - smoothCenter.x) * smoothing;
        smoothCenter.y += (target.y - smoothCenter.y) * smoothing;
        currentCenter.x = smoothCenter.x;
        currentCenter.y = smoothCenter.y;
      } else if (mode === "full-pitch" || mode === "tactical") {
        currentCenter.x = smoothCenter.x = pitchLength / 2;
        currentCenter.y = smoothCenter.y = pitchWidth / 2;
      }
      calculateFit();
    }

    function resize(w, h) {
      width = Math.max(1, w || 1);
      height = Math.max(1, h || 1);
      calculateFit();
    }

    function zoomBy(multiplier) {
      userZoom = clamp(userZoom * multiplier, 0.7, 2.8);
      calculateFit();
      return userZoom;
    }

    function pan(dx, dy) {
      var delta = world({ x: width / 2 + dx, y: height / 2 + dy });
      var origin = world({ x: width / 2, y: height / 2 });
      currentCenter.x += origin.x - delta.x;
      currentCenter.y += origin.y - delta.y;
      smoothCenter.x = currentCenter.x;
      smoothCenter.y = currentCenter.y;
    }

    calculateFit();
    return {
      project: screen,
      unproject: world,
      resize: resize,
      update: update,
      setMode: setMode,
      zoomBy: zoomBy,
      pan: pan,
      get mode() { return mode; },
      get targetId() { return targetId; },
      get scale() { return projectScale; },
      get width() { return width; },
      get height() { return height; },
      get center() { return { x: currentCenter.x, y: currentCenter.y }; },
      get pitchLength() { return pitchLength; },
      get pitchWidth() { return pitchWidth; }
    };
  }

  TF.createCamera = makeCamera;
})(typeof window !== "undefined" ? window : globalThis);
