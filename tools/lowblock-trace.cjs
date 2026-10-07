const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const sourceVersionPath = path.resolve(__dirname, 'version.cjs');
delete require.cache[sourceVersionPath];
const sourceVersion = require('./version.cjs');
const runnerPath = path.resolve(__filename);
const runnerSha256 = crypto.createHash('sha256').update(fs.readFileSync(runnerPath)).digest('hex');
for (const file of ['core', 'analysis', 'world', 'tactics', 'intelligence', 'physics', 'rules', 'telemetry', 'labs']) {
  require(path.join(root, 'src', file + '.js'));
}
const TF = globalThis.TF;
TF.VERSION = sourceVersion;
delete require.cache[sourceVersionPath];
const loadedSourceVersion = require('./version.cjs');
if (loadedSourceVersion !== sourceVersion) {
  throw new Error(`Source changed while loading runtime modules: ${sourceVersion} -> ${loadedSourceVersion}`);
}
const seed = Number(process.env.TF_LOW_BLOCK_SEED) || 20261006;
const durationSeconds = Math.max(10, Number(process.env.TF_LOW_BLOCK_SECONDS) || 60);
const maxTicks = Math.round(durationSeconds * 60);
const outArg = process.argv.indexOf('--out');
const outputPath = outArg >= 0 ? path.resolve(process.argv[outArg + 1]) : path.resolve(root, '.project', 'reports', `lowblock-trace-${sourceVersion}-seed${seed}-${durationSeconds}s.json`);

const match = TF.createMatch({ seed, halfSeconds: 2700, matchId: 'low-block-trace-' + seed });
TF.configureAIScenario(match, 'Low block');
TF.telemetry.reset(match);
const defending = match.teams[0], attacking = match.teams[1];
const eventCursor = TF.createEventCursor();
const report = {
  kind: 'low-block-behavior-trace', sourceVersion, runner: { file: path.relative(root, runnerPath), sha256: runnerSha256 }, seed, durationSeconds, ticksRequested: maxTicks,
  fixture: { name: 'Low block', defendingTeamId: defending.id, attackingTeamId: attacking.id,
    defendingLineup: defending.activePlayers.map(p => ({ id: p.id, role: p.role, isGoalkeeper: !!p.isGoalkeeper })),
    attackingLineup: attacking.activePlayers.map(p => ({ id: p.id, role: p.role, isGoalkeeper: !!p.isGoalkeeper })),
    defendingTactics: Object.assign({}, defending.tactics), attackingTactics: Object.assign({}, attacking.tactics) },
  actual: { eventCounts: {}, passAttempts: 0, completedPasses: 0, interceptedPasses: 0,
    outOfPlay: 0, shots: 0, goals: 0, widthSwitchAttempts: 0, widthSwitchReceipts: 0,
    progressiveReceipts: 0, lineBreakReceipts: null, sequences: [], passes: [], goalsAndShots: [],
    intentChanges: {}, candidateCounts: {}, selectedByPurpose: {}, supportWidthSelections: 0,
    defensiveFrames: 0, compactFrames: 0, backLineX: [], backLineSpan: [], backLineYSpan: [],
    ballAttackProgress: [], turnoverCount: 0 },
  notes: ['This probe observes a physical 60 Hz scenario; it does not force a pass, reception, switch, or goal. Candidate counts are not behavior acceptance.',
    'Source version is fingerprinted before and after loading the runtime modules; runner SHA-256 and exact team tactics identify the probe configuration.',
    'Line-break receipt count, physical support-triangle occupation, and completed physical carries are not measured by this runner.']
};
const originalAugment = TF.augmentCandidates;
TF.augmentCandidates = function (candidates, context) {
  if (context && context.teamId) {
    const side = context.teamId === attacking.id ? 'attack' : 'defense';
    for (const c of candidates) {
      const key = side + ':' + c.type;
      report.actual.candidateCounts[key] = (report.actual.candidateCounts[key] || 0) + 1;
      if (side === 'attack' && c.type === 'support' && c.details && c.details.purpose === 'support-wide') {
        report.actual.candidateCounts['attack:support-wide'] = (report.actual.candidateCounts['attack:support-wide'] || 0) + 1;
      }
    }
  }
  return originalAugment(candidates, context);
};

let pendingPass = null;
let activeChain = { teamId: null, passerIds: [], passes: 0, progressive: 0, widthSwitches: 0 };
let lastOwnerTeamId = null;
const seenIntent = new Map();
function attackProgress(x) { return (105 - Number(x || 0)) / 105; }
function increment(map, key) { map[key] = (map[key] || 0) + 1; }
function consume(events) {
  for (const event of events) {
    const type = event.type || 'unknown';
    increment(report.actual.eventCounts, type);
    if (type === 'pass' && event.teamId === attacking.id) {
      report.actual.passAttempts++;
      const origin = event.origin || match.playersById[event.playerId]?.position || match.ball.position;
      const target = event.target || null;
      const lateral = target ? Math.abs(target.y - origin.y) : 0;
      const progressive = target ? (origin.x - target.x) >= 3 : false;
      const pass = { tick: event.tick, playerId: event.playerId, targetId: event.targetId || null,
        origin: { x: origin.x, y: origin.y }, target: target && { x: target.x, y: target.y },
        lateralMeters: Number(lateral.toFixed(2)), progressive, resolution: 'pending', resolutionPlayerId: null };
      report.actual.passes.push(pass);
      if (lateral >= 12) report.actual.widthSwitchAttempts++;
      pendingPass = { pass, teamId: event.teamId, passerId: event.playerId,
        originProgress: attackProgress(origin.x), progressive, widthSwitch: lateral >= 12 };
    } else if (type === 'ball-control' || type === 'keeper-collection') {
      const playerId = event.playerId || event.keeperId;
      const actor = match.playersById[playerId];
      const teamId = event.teamId || actor && actor.teamId || null;
      if (pendingPass) {
        if (teamId === pendingPass.teamId && playerId && playerId !== pendingPass.passerId) {
          pendingPass.pass.resolution = 'teammate-control';
          pendingPass.pass.resolutionPlayerId = playerId;
          report.actual.completedPasses++;
          if (pendingPass.widthSwitch) report.actual.widthSwitchReceipts++;
          const point = event.contactPoint || event.origin || actor && actor.position;
          if (point && pendingPass.originProgress != null && attackProgress(point.x) - pendingPass.originProgress >= 3 / 105) report.actual.progressiveReceipts++;
          if (activeChain.teamId !== teamId) activeChain = { teamId, passerIds: [], passes: 0, progressive: 0, widthSwitches: 0 };
          activeChain.passes++;
          activeChain.passerIds.push(pendingPass.passerId);
          if (pendingPass.progressive) activeChain.progressive++;
          if (pendingPass.widthSwitch) activeChain.widthSwitches++;
          if (activeChain.passes > 0) report.actual.sequences.push({ teamId: activeChain.teamId, length: activeChain.passes,
            progressive: activeChain.progressive, widthSwitches: activeChain.widthSwitches,
            distinctPassers: new Set(activeChain.passerIds).size, tick: event.tick });
        } else if (teamId && teamId !== pendingPass.teamId) {
          pendingPass.pass.resolution = 'opponent-control';
          pendingPass.pass.resolutionPlayerId = playerId || null;
          report.actual.interceptedPasses++;
          activeChain = { teamId, passerIds: [], passes: 0, progressive: 0, widthSwitches: 0 };
        } else if (playerId === pendingPass.passerId) {
          pendingPass.pass.resolution = 'same-player-control';
        }
        pendingPass = null;
      }
      if (teamId && lastOwnerTeamId && teamId !== lastOwnerTeamId) report.actual.turnoverCount++;
      if (teamId) lastOwnerTeamId = teamId;
    } else if (type === 'restart-awarded' && pendingPass) {
      pendingPass.pass.resolution = 'restart-or-out';
      report.actual.outOfPlay++;
      pendingPass = null;
      activeChain = { teamId: null, passerIds: [], passes: 0, progressive: 0, widthSwitches: 0 };
    } else if (type === 'shot') {
      report.actual.shots++;
      report.actual.goalsAndShots.push({ type: 'shot', tick: event.tick, teamId: event.teamId, playerId: event.playerId,
        origin: event.origin || null, target: event.target || null, xG: event.xG == null ? null : event.xG });
    } else if (type === 'goal') {
      report.actual.goals++;
      report.actual.goalsAndShots.push({ type: 'goal', tick: event.tick, teamId: event.teamId,
        scorerId: event.scorerId || null, shotPlayerId: event.shotPlayerId || null, origin: event.origin || null });
    } else if (type === 'ball-out') {
      if (pendingPass) pendingPass.pass.resolution = 'out-of-play';
      report.actual.outOfPlay++;
      pendingPass = null;
      activeChain = { teamId: null, passerIds: [], passes: 0, progressive: 0, widthSwitches: 0 };
    }
  }
}

try {
  for (let i = 0; i < maxTicks && !match.state.finished; i++) {
    match.tick++;
    TF.updateLabNeutrals(match);
    TF.updateTactics(match, TF.FIXED_DT);
    TF.updateAI(match, TF.FIXED_DT);
    for (const player of match.players) {
      if (!player.active || !player.intent) continue;
      const signature = [player.intent.type, player.intent.targetId || '', player.intent.details && player.intent.details.purpose || ''].join(':');
      if (seenIntent.get(player.id) !== signature) {
        seenIntent.set(player.id, signature);
        const key = (player.teamId === attacking.id ? 'attack:' : 'defense:') + signature;
        increment(report.actual.intentChanges, key);
        if (player.teamId === attacking.id && player.intent.type === 'support' && player.intent.details && player.intent.details.purpose === 'support-wide') report.actual.supportWidthSelections++;
      }
    }
    TF.updateWorld(match, TF.FIXED_DT);
    TF.updateTelemetry(match, TF.FIXED_DT);
    consume(eventCursor.read(match.events));
    const holder = match.ball.ownerId && match.playersById[match.ball.ownerId];
    if (holder && holder.teamId === attacking.id) {
      const defenders = defending.activePlayers.filter(p => ['CB', 'RCB', 'LCB', 'LB', 'RB', 'DM'].includes(p.role));
      const xs = defenders.map(p => p.position.x), ys = defenders.map(p => p.position.y);
      const xMean = xs.reduce((sum, x) => sum + x, 0) / Math.max(1, xs.length);
      const xSpan = Math.max(...xs) - Math.min(...xs), ySpan = Math.max(...ys) - Math.min(...ys);
      report.actual.defensiveFrames++;
      report.actual.backLineX.push(xMean);
      report.actual.backLineSpan.push(xSpan);
      report.actual.backLineYSpan.push(ySpan);
      if (xMean >= 17 && xMean <= 42 && ySpan <= 44 && xSpan <= 18) report.actual.compactFrames++;
      if (match.tick % 30 === 0) report.actual.ballAttackProgress.push({ tick: match.tick,
        ball: { x: Number(match.ball.position.x.toFixed(2)), y: Number(match.ball.position.y.toFixed(2)) },
        attackProgress: Number(attackProgress(match.ball.position.x).toFixed(3)), holder: holder.id,
        defendingLineX: Number(xMean.toFixed(2)), defendingXSpan: Number(xSpan.toFixed(2)), defendingYSpan: Number(ySpan.toFixed(2)) });
    }
  }
} finally {
  TF.augmentCandidates = originalAugment;
}

const telemetry = TF.telemetry.summary(match);
const t = report.actual;
const mean = values => values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null;
t.finishedSeconds = Number((match.tick * TF.FIXED_DT).toFixed(2));
t.finalScore = Object.assign({}, match.score);
t.telemetryTeams = telemetry.teams;
t.audit = TF.telemetry.audit(match);
t.maxCompletedChain = t.sequences.reduce((best, row) => Math.max(best, row.length), 0);
t.maxDistinctPassersInChain = t.sequences.reduce((best, row) => Math.max(best, row.distinctPassers), 0);
t.meanDefendingLineX = mean(t.backLineX);
t.meanDefendingLineXSpan = mean(t.backLineSpan);
t.meanDefendingLineYSpan = mean(t.backLineYSpan);
t.compactShapeRatio = t.defensiveFrames ? Number((t.compactFrames / t.defensiveFrames).toFixed(3)) : null;
t.openPasses = t.passes.filter(p => p.resolution === 'teammate-control');
t.unresolvedPasses = t.passes.filter(p => p.resolution === 'pending').length;
delete t.backLineX; delete t.backLineSpan; delete t.backLineYSpan;
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ report: path.relative(process.cwd(), outputPath), sourceVersion, runnerSha256,
  seconds: t.finishedSeconds, score: t.finalScore, passes: t.passAttempts, teammateControls: t.completedPasses,
  interceptions: t.interceptedPasses, outOfPlay: t.outOfPlay, shots: t.shots, goals: t.goals,
  maxCompletedChain: t.maxCompletedChain, maxDistinctPassersInChain: t.maxDistinctPassersInChain,
  compactShapeRatio: t.compactShapeRatio, supportWidthSelections: t.supportWidthSelections,
  qualityAudit: t.audit && t.audit.rates }, null, 2) + '\n');
