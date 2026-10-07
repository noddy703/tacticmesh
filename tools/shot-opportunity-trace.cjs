// Read-only instrumentation for a short, shipped-default AI/physics window.
// It observes decisions/events but does not alter the simulation or its RNG.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const runtimeModules = ['core', 'analysis', 'world', 'tactics', 'intelligence', 'physics', 'rules', 'telemetry'];
function coreSourceFingerprint() {
  const hash = crypto.createHash('sha256');
  for (const name of runtimeModules) {
    const file = `src/${name}.js`;
    hash.update(file); hash.update('\0'); hash.update(fs.readFileSync(path.resolve(__dirname, '..', file))); hash.update('\0');
  }
  return `core-${hash.digest('hex').slice(0, 16)}`;
}
const runnerSha256AtStart = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
const loadedCoreBuild = coreSourceFingerprint();
for (const name of runtimeModules) require(path.resolve(__dirname, '..', 'src', name + '.js'));
if (coreSourceFingerprint() !== loadedCoreBuild) throw new Error('Football source changed while modules were loading.');
const TF = globalThis.TF;
TF.VERSION = loadedCoreBuild;

const SEED = Number(process.env.SHOT_TRACE_SEED || 20261014);
const WINDOW_SECONDS = 2100;
const halfSeconds = 2700;
const uiColors = {
  home: { primary: '#cf3d48', secondary: '#f5f0df' },
  away: { primary: '#315aa6', secondary: '#f3cf50' }
};
const match = TF.createMatch({ seed: SEED, autoStart: true,
  home: { name: 'Redbridge FC', formation: '4-3-3', colors: uiColors.home },
  away: { name: 'Ashford Athletic', formation: '4-2-3-1', colors: uiColors.away } });
const core = TF.createCore({ match, renderSnapshots: false });
assert.equal(match.seed, SEED, 'diagnostic seed must match requested UI seed');
assert.equal(match.teams[0].name, 'Redbridge FC');
assert.equal(match.teams[1].name, 'Ashford Athletic');
assert.equal(match.teams[0].formation, '4-3-3');
assert.equal(match.teams[1].formation, '4-2-3-1');
assert.equal(match.teams[0].activePlayers.length + match.teams[1].activePlayers.length, 22);
assert.ok(match.teams[0].players.length >= 18 && match.teams[0].players.length <= 20, 'home uses the UI default roster size');
assert.ok(match.teams[1].players.length >= 18 && match.teams[1].players.length <= 20, 'away uses the UI default roster size');
assert.equal(match.teams[0].tactics.tempo, 0.46, 'home uses the shipped home tactic profile');
assert.equal(match.teams[0].tactics.buildupRisk, 0.42);
assert.equal(match.teams[0].tactics.passingDirectness, 0.34);
assert.equal(match.teams[1].tactics.tempo, 0.60, 'away uses the shipped away tactic profile');
assert.equal(match.teams[1].tactics.buildupRisk, 0.56);
assert.equal(match.teams[1].tactics.passingDirectness, 0.63);
assert.deepEqual(match.teams[0].colors, uiColors.home);
assert.deepEqual(match.teams[1].colors, uiColors.away);
const startConfig = {
  seed: SEED,
  simulatedWindowSeconds: WINDOW_SECONDS,
  regulationHalfSeconds: halfSeconds,
  home: { id: match.teams[0].id, name: match.teams[0].name, formation: match.teams[0].formation,
    tactics: JSON.parse(JSON.stringify(match.teams[0].tactics)), active: match.teams[0].activePlayers.length, roster: match.teams[0].players.length, kits: match.teams[0].colors },
  away: { id: match.teams[1].id, name: match.teams[1].name, formation: match.teams[1].formation,
    tactics: JSON.parse(JSON.stringify(match.teams[1].tactics)), active: match.teams[1].activePlayers.length, roster: match.teams[1].players.length, kits: match.teams[1].colors }
};

function round(n, digits = 2) { return Number.isFinite(Number(n)) ? Number(Number(n).toFixed(digits)) : null; }
function point(p) { return p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)) ? { x: round(p.x, 3), y: round(p.y, 3), z: round(p.z, 3) } : null; }
function playerView(p) {
  if (!p) return null;
  const i = p.motor || p.intent || {};
  return { id: p.id, teamId: p.teamId, role: p.role, goalkeeper: !!p.isGoalkeeper, position: point(p.position),
    velocity: { x: round(p.velocity && p.velocity.x, 3), y: round(p.velocity && p.velocity.y, 3) },
    facing: point(p.facing), intent: i.type || i.action || null, target: point(i.target), stamina: round(p.stamina, 3),
    shooting: p.attributes && p.attributes.shooting, finishing: p.attributes && p.attributes.finishing };
}
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function goalMouthAperture(origin, goalX, goalY, width) {
  const half = width / 2, a = Math.atan2(goalX - origin.x, goalY - half - origin.y), b = Math.atan2(goalX - origin.x, goalY + half - origin.y);
  let v = Math.abs(a - b); if (v > Math.PI) v = Math.PI * 2 - v; return round(v, 4);
}
function localKeeperBelief(shooter, defendingTeamId) {
  const entities = shooter && shooter.beliefState && shooter.beliefState.entities || {};
  const values = Object.keys(entities).map(k => entities[k]).filter(e => e && String(e.teamId) === String(defendingTeamId)
    && (e.isGoalkeeper || /goalkeeper|keeper/i.test(String(e.role || ''))));
  return values.map(e => ({ id: e.id, role: e.role || null, estimatedPosition: point(e.estimatedPosition || e.position),
    confidence: round(e.confidence, 3), ageTicks: e.ageTicks, observedTick: e.observedTick, source: e.source || null }));
}
function currentOpportunity(p) {
  const d = p.ai && p.ai.decisionExplanation;
  if (!d) return null;
  return { tick: d.tick, reason: d.reason, selected: d.selected, utilityWinner: d.utilityWinner,
    candidates: (d.candidates || []).map(c => ({ rank: c.rank, type: c.type, targetId: c.targetId || null,
      target: c.target, utility: c.utility, utilityComponents: c.utilityComponents,
      details: c.type === 'shoot' || c.type === 'pass' || c.type === 'throughBall' || c.type === 'carry' ? c.details : undefined })) };
}

const opportunities = [];
const shots = [];
const goals = [];
const allGoalEvents = [];
const saves = [];
const currentShot = { record: null };
const previousAppend = TF.appendEvent;
const previousUpdateAI = TF.updateAI;
TF.updateAI = function observedUpdateAI(m, ...args) {
  const result = previousUpdateAI.call(this, m, ...args);
  for (const p of m.players) {
    if (!p.active || !p.ai || Number(p.ai.lastDecision) !== m.tick) continue;
    const opportunity = currentOpportunity(p);
    if (!opportunity) continue;
    const ballOwner = m.ball.ownerId === p.id || p.hasBall === true;
    if (!ballOwner || !opportunity.candidates.some(c => c.type === 'shoot') && opportunity.selected.type !== 'shoot') continue;
    const goalX = p.team.attackDirection > 0 ? m.pitch.length : 0;
    const row = { tick: m.tick, time: round(m.clock.elapsedSeconds, 3), player: playerView(p),
      goalDistance: round(dist(p.position, { x: goalX, y: m.pitch.width / 2 }), 3),
      candidateDecision: opportunity, perceivedOpposingKeepers: localKeeperBelief(p, m.teams.find(t => t.id !== p.teamId)?.id || ''),
      physicalOpponentKeepers: undefined };
    opportunities.push(row);
  }
  return result;
};
TF.appendEvent = function observedAppendEvent(m, e) {
  const player = e.playerId && m.playersById[e.playerId];
  if (e.type === 'goal') {
    allGoalEvents.push({ tick: e.tick, time: round(e.time, 3), teamId: e.teamId || null,
      scorerId: e.scorerId || null, shotPlayerId: e.shotPlayerId || null,
      lastTouchPlayerId: m.ball.lastTouchPlayerId || null, lastTouchTeamId: m.ball.lastTouchTeamId || null,
      ball: { position: point(m.ball.position), velocity: { x: round(m.ball.velocity.x, 3), y: round(m.ball.velocity.y, 3), z: round(m.ball.velocity.z, 3) } },
      activeShotId: currentShot.record ? currentShot.record.id : null });
  }
  if (e.type === 'shot') {
    if (currentShot.record && !currentShot.record.terminal) {
      currentShot.record.terminal = 'live-rebound-restrike';
      currentShot.record.followUpShotId = shots.length + 1;
    }
    const attackDir = (m.teams.find(t => t.id === e.teamId) || {}).attackDirection || 1;
    const goalX = attackDir > 0 ? m.pitch.length : 0;
    const goalY = m.pitch.width / 2;
    const physicalKeepers = m.players.filter(p => p.active && p.teamId !== e.teamId && p.isGoalkeeper).map(playerView);
    const opportunity = player ? currentOpportunity(player) : null;
    const row = { id: shots.length + 1, tick: e.tick, time: round(e.time, 3), playerId: e.playerId, teamId: e.teamId,
      origin: point(e.origin), target: point(e.target), distanceToGoal: e.origin ? round(dist(e.origin, { x: goalX, y: goalY }), 3) : null,
      targetMouthApertureRadians: e.origin ? goalMouthAperture(e.origin, goalX, goalY, m.pitch.goalWidth || 7.32) : null,
      speed: round(e.kickSpeed, 3), requestedPower: round(e.requestedPower, 3), executedPower: round(e.power, 3),
      angleError: round(e.angleError, 4), lift: round(e.executedLift, 3), estimatedXg: TF.telemetry?.estimateShotXG ? TF.telemetry.estimateShotXG(m, e) : null,
      shooter: playerView(player), selectedIntent: player && player.intent ? player.intent.type : null,
      localDecision: opportunity, perceivedOpposingKeepers: player ? localKeeperBelief(player, m.teams.find(t => t.id !== e.teamId)?.id || '') : [],
      physicalOpposingKeepers: physicalKeepers, nearestDefenders: m.players.filter(p => p.active && p.teamId !== e.teamId && !p.isGoalkeeper)
        .map(p => ({ player: playerView(p), distance: round(dist(p.position, e.origin || p.position), 3) })).sort((a,b) => a.distance-b.distance).slice(0,4),
      events: [], terminal: null };
    shots.push(row); currentShot.record = row;
  } else if (currentShot.record) {
    const row = currentShot.record;
    const capture = ['ball-control','ball-deflection','save','keeper-punch','keeper-collection','frame-hit','goal','goal-confirmed','restart-awarded','out-of-play','offside','foul','pass','header','ball-played'].includes(e.type);
    if (capture && row.events.length < 30) {
      const actor = e.keeperId ? m.playersById[e.keeperId] : player;
      row.events.push({ type: e.type, tick: e.tick, time: round(e.time, 3), playerId: e.playerId || null,
        keeperId: e.keeperId || null, teamId: e.teamId || null, reason: e.reason || e.restartType || null,
        scorerId: e.scorerId || null, shotPlayerId: e.shotPlayerId || null,
        contactPoint: point(e.contactPoint), origin: point(e.origin), target: point(e.target),
        lastTouchPlayerId: m.ball.lastTouchPlayerId || null, lastTouchTeamId: m.ball.lastTouchTeamId || null,
        ball: { position: point(m.ball.position), velocity: { x: round(m.ball.velocity.x, 3), y: round(m.ball.velocity.y, 3), z: round(m.ball.velocity.z, 3) } },
        actor: actor ? playerView(actor) : null, keeperResult: e.caught == null ? null : e.caught });
    }
    if (e.type === 'save' || e.type === 'keeper-punch' || e.type === 'keeper-collection') saves.push({ shotId: row.id, type: e.type, tick: e.tick, keeperId: e.keeperId || null, caught: e.caught == null ? null : e.caught });
    if (e.type === 'goal') {
      row.terminal = 'goal'; row.goal = { tick: e.tick, teamId: e.teamId, scorerId: e.scorerId || null, shotPlayerId: e.shotPlayerId || null,
        lastTouchPlayerId: m.ball.lastTouchPlayerId || null, lastTouchTeamId: m.ball.lastTouchTeamId || null };
      goals.push(row.goal); currentShot.record = null;
    } else if (e.type === 'save' && e.caught === true) {
      row.terminal = 'saved-caught'; currentShot.record = null;
    } else if (e.type === 'keeper-collection') {
      row.terminal = 'keeper-collected'; currentShot.record = null;
    } else if (e.type === 'ball-control') {
      row.terminal = 'controlled'; row.control = { tick: e.tick, playerId: e.playerId || null, teamId: e.teamId || null }; currentShot.record = null;
    } else if (['restart-awarded','offside','pass','header'].includes(e.type) && row.events.length > 0) {
      if (!row.terminal) row.terminal = e.type === 'restart-awarded' ? `restart:${e.restartType || e.reason || 'unknown'}` : e.type;
      currentShot.record = null;
    }
  }
  return previousAppend(m, e);
};

const startWall = process.hrtime.bigint();
let nextProgress = 60;
while (!match.state.finished && match.clock.elapsedSeconds < WINDOW_SECONDS) {
  core.step(120);
  if (match.clock.elapsedSeconds >= nextProgress) {
    process.stderr.write(`[shot-trace] ${round(match.clock.elapsedSeconds,1)}s tick=${match.tick} shots=${shots.length} opportunities=${opportunities.length}\n`);
    nextProgress += 60;
  }
}
TF.appendEvent = previousAppend;
TF.updateAI = previousUpdateAI;
const coreBuildAtEnd = coreSourceFingerprint();
if (coreBuildAtEnd !== loadedCoreBuild) throw new Error(`Football source changed during run: ${loadedCoreBuild} -> ${coreBuildAtEnd}`);
const runnerSha256AtEnd = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
if (runnerSha256AtStart !== runnerSha256AtEnd) throw new Error('Diagnostic driver changed during run.');
const summarize = (values) => values.reduce((out, value) => { out[value] = (out[value] || 0) + 1; return out; }, {});
const opportunitySummaries = opportunities.reduce((out, o) => {
  const types = new Set(o.candidateDecision.candidates.map(c => c.type));
  const key = `${o.candidateDecision.selected.type}${types.has('pass') ? '+pass-option' : ''}${types.has('carry') ? '+carry-option' : ''}`;
  out[key] = (out[key] || 0) + 1; return out;
}, {});
const out = process.env.SHOT_TRACE_OUT || `.project/reports/shot-opportunity-${loadedCoreBuild}-seed${SEED}-${WINDOW_SECONDS}s-ui-default.json`;
const report = { kind: 'shot-opportunity-physical-outcome-trace', coreBuild: loadedCoreBuild, coreBuildAtStart: loadedCoreBuild,
  coreBuildAtEnd: coreBuildAtEnd, runnerFile: path.basename(__filename), runnerSha256AtStart, runnerSha256AtEnd,
  sourceModules: runtimeModules, scenario: 'UI-default setup (Redbridge FC 4-3-3 vs Ashford Athletic 4-2-3-1), no explicit tactics or roster-size override',
  startConfig, simulatedSeconds: round(match.clock.elapsedSeconds, 3), ticks: match.tick,
  wallSeconds: Number((Number(process.hrtime.bigint() - startWall) / 1e9).toFixed(3)), score: match.score,
  shotCount: shots.length, goalCount: allGoalEvents.length, shotLinkedGoalCount: goals.length,
  unlinkedGoalCount: allGoalEvents.filter(g => !g.activeShotId).length,
  shotOutcomeCounts: summarize(shots.map(s => s.terminal || 'unresolved-at-window-end')),
  keeperEventCounts: summarize(saves.map(s => s.type)), opportunityCount: opportunities.length, opportunityDecisionSummary: opportunitySummaries,
  limitations: ['Candidate details are the actor-local AI diagnostic state at a real decision; no unobserved opponent data enters AI.',
    'The trace counts physical outcomes and diagnostic xG only; xG is an uncalibrated heuristic and no distribution target is imposed.',
    'Every goal event is archived independently; activeShotId is the current shot-event window, not a causal scoring attribution.'],
  opportunities, shots, goals, allGoalEvents, keeperEvents: saves };
fs.writeFileSync(path.resolve(process.cwd(), out), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ out, coreBuild: loadedCoreBuild, runnerSha256AtStart, seed: SEED,
  simulatedSeconds: report.simulatedSeconds, ticks: report.ticks, wallSeconds: report.wallSeconds,
  shots: shots.length, goals: allGoalEvents.length, shotLinkedGoals: goals.length,
  unlinkedGoals: report.unlinkedGoalCount, opportunities: opportunities.length,
  shotOutcomeCounts: report.shotOutcomeCounts, keeperEventCounts: report.keeperEventCounts,
  opportunityDecisionSummary: opportunitySummaries }, null, 2) + '\n');
