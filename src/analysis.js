/* Shared deterministic match geometry. Truth-based queries are for physics,
 * rendering and diagnostics; player decisions must use pressureFromBeliefs. */
(function (root) {
  "use strict";
  var TF = root.TF = root.TF || {};
  var CELL = 5, CACHED_RADII = [1.3, 2.5, 3, 5];
  var caches = typeof WeakMap === "function" ? new WeakMap() : null;
  var fallbackMatch = null, fallbackCache = null;

  function clampIndex(value, max) { return Math.max(0, Math.min(max, Math.floor((Number(value) || 0) / CELL))); }
  function getCache(match) {
    var cache = caches ? caches.get(match) : (fallbackMatch === match ? fallbackCache : null);
    if (!cache) {
      var cols = Math.ceil((match.pitch && match.pitch.length || 105) / CELL) + 1;
      var rows = Math.ceil((match.pitch && match.pitch.width || 68) / CELL) + 1;
      var cells = new Array(cols * rows);
      for (var i = 0; i < cells.length; i++) cells[i] = [];
      cache = { cells: cells, cols: cols, rows: rows, active: [], usedCells: [], order: Object.create(null), pressure: Object.create(null), pressureKeys: Object.create(null), pressureBuffer: [], generation: 0, builtTick: null };
      cache.sorter = function (a, b) { return cache.order[a.id] - cache.order[b.id]; };
      if (caches) caches.set(match, cache); else { fallbackMatch = match; fallbackCache = cache; }
    }
    return cache;
  }
  function cellIndex(cache, x, y) {
    return clampIndex(y, cache.rows - 1) * cache.cols + clampIndex(x, cache.cols - 1);
  }
  function distanceSquared(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }
  function eachInGrid(cache, point, radius, teamId, excludeTeamId, callback) {
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return;
    var r = Math.max(0, Number(radius) || 0), r2 = r * r;
    var minX = clampIndex(point.x - r, cache.cols - 1), maxX = clampIndex(point.x + r, cache.cols - 1);
    var minY = clampIndex(point.y - r, cache.rows - 1), maxY = clampIndex(point.y + r, cache.rows - 1);
    for (var cy = minY; cy <= maxY; cy++) for (var cx = minX; cx <= maxX; cx++) {
      var cell = cache.cells[cy * cache.cols + cx];
      for (var i = 0; i < cell.length; i++) {
        var player = cell[i];
        if (teamId != null && player.teamId !== teamId) continue;
        if (excludeTeamId != null && player.teamId === excludeTeamId) continue;
        if (distanceSquared(point, player.position) <= r2) callback(player);
      }
    }
  }
  function pressureSum(match, cache, player, radius) {
    var sum = 0, r = Number(radius) || 0, nearby;
    if (r <= 0) return 0;
    nearby = fillNearby(match, player.position, r, cache.pressureBuffer, null, player.teamId);
    for (var i = 0; i < nearby.length; i++) {
      var opponent = nearby[i];
      var gap = Math.sqrt(distanceSquared(player.position, opponent.position));
      sum += (r - gap) / r;
    }
    return sum;
  }
  function rebuild(match) {
    if (!match || !Array.isArray(match.players)) return null;
    var cache = getCache(match), players = match.players;
    cache.active.length = 0;
    for (var c = 0; c < cache.usedCells.length; c++) cache.cells[cache.usedCells[c]].length = 0;
    cache.usedCells.length = 0;
    for (var i = 0; i < players.length; i++) {
      var player = players[i];
      if (!player || player.active === false || !player.position) continue;
      cache.active.push(player);
      cache.order[player.id] = i;
      var bucketIndex = cellIndex(cache, player.position.x, player.position.y), bucket = cache.cells[bucketIndex];
      if (!bucket.length) cache.usedCells.push(bucketIndex);
      bucket.push(player);
      var priorPressure = cache.pressure[player.id], keys = cache.pressureKeys[player.id];
      if (priorPressure && keys) for (var k = 0; k < keys.length; k++) priorPressure[keys[k]] = NaN;
    }
    cache.generation++;
    cache.builtTick = Number.isFinite(Number(match.tick)) ? Number(match.tick) : null;
    return cache;
  }
  function ensure(match) {
    var cache = getCache(match), tick = Number.isFinite(Number(match && match.tick)) ? Number(match.tick) : null;
    if (cache.generation === 0 || cache.builtTick !== tick) rebuild(match);
    return cache;
  }
  function invalidate(match) { if (!match) return; var cache = getCache(match); cache.generation = 0; cache.builtTick = null; }
  function fillNearby(match, point, radius, out, teamId, excludeTeamId) {
    var cache = ensure(match), result = Array.isArray(out) ? out : [];
    result.length = 0;
    eachInGrid(cache, point, radius, teamId, excludeTeamId, function (player) { result.push(player); });
    result.sort(cache.sorter);
    return result;
  }
  function pressureAt(match, teamId, point, radius) {
    var sum = 0, r = Number(radius) || 0;
    if (r <= 0) return 0;
    eachInGrid(ensure(match), point, r, null, teamId, function (opponent) {
      var gap = Math.sqrt(distanceSquared(point, opponent.position));
      sum += (r - gap) / r;
    });
    return sum;
  }
  function pressureAtPlayer(match, player, radius) {
    var cache = ensure(match), pressure = player && cache.pressure[player.id], r = String(Number(radius) || 0);
    if (pressure && Number.isFinite(pressure[r])) return pressure[r];
    if (!player) return 0;
    if (CACHED_RADII.indexOf(Number(radius)) < 0) return pressureSum(cache, player, Number(radius) || 0);
    pressure = cache.pressure[player.id] || (cache.pressure[player.id] = Object.create(null));
    var keys = cache.pressureKeys[player.id] || (cache.pressureKeys[player.id] = []);
    if (keys.indexOf(r) < 0) keys.push(r);
    pressure[r] = pressureSum(match, cache, player, Number(radius) || 0);
    return pressure[r];
  }
  function pressureFromBeliefs(observer, point, radius) {
    var entities = observer && observer.beliefState && observer.beliefState.entities || {};
    var teamId = observer && observer.teamId, r = Number(radius) || 0, sum = 0;
    if (!point || r <= 0) return 0;
    Object.keys(entities).forEach(function (key) {
      var entity = entities[key], estimated = entity && (entity.estimatedPosition || entity.position);
      if (!entity || entity.teamId === teamId || !estimated) return;
      var gap = Math.sqrt(distanceSquared(point, estimated));
      if (gap <= r) sum += ((r - gap) / r) * Math.max(0, Math.min(1, Number(entity.confidence) || 0));
    });
    return sum;
  }
  function stats(match) {
    var cache = ensure(match);
    return { activePlayers: cache.active.length, cells: cache.cells.length, generation: cache.generation, cellSize: CELL };
  }
  TF.analysis = { rebuild: rebuild, invalidate: invalidate, fillNearby: fillNearby, pressureAt: pressureAt, pressureAtPlayer: pressureAtPlayer, pressureFromBeliefs: pressureFromBeliefs, stats: stats };
  if (typeof TF.registerCheckpointExtension === "function") TF.registerCheckpointExtension("analysis", {
    capture: function () { return null; },
    restore: function (match) { invalidate(match); }
  });
})(typeof window !== "undefined" ? window : globalThis);
