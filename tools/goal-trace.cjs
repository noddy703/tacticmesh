const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function currentSourceVersion() {
  delete require.cache[require.resolve('./version.cjs')];
  return require('./version.cjs');
}
const sourceVersion = currentSourceVersion();
for (const f of ['core', 'analysis', 'world', 'tactics', 'intelligence', 'physics', 'rules', 'telemetry']) require(path.resolve(__dirname, '..', 'src', f + '.js'));
const TF = globalThis.TF;
TF.VERSION = sourceVersion;
if (currentSourceVersion() !== sourceVersion) throw new Error('Source changed while loading modules; rerun the trace on one source snapshot.');

function teamOptions(id, name, style) {
  const styles = {
    possession: { tempo: .42, patience: .70, buildupRisk: .30, passingDirectness: .28, compactness: .68, width: .68 },
    direct: { tempo: .7, buildupRisk: .7, passingDirectness: .8, counterattack: .78, attackingWidth: .63 }
  };
  return { id, name, formation: '4-3-3', squadSize: 20, tactics: Object.assign({ width: .62, attackingWidth: .72, defensiveWidth: .56, defensiveLine: .58, pressingIntensity: .52, engagementLine: .55, compactness: .62, tempo: .52, buildupRisk: .45, passingDirectness: .42, counterattack: .5, counterpress: .5, crossingFrequency: .4, overlapPreference: .48 }, styles[style] || {}) };
}
function snapshotPlayer(p) {
  const i = p.motor || p.intent || p.currentAction || {};
  return { id: p.id, teamId: p.teamId, goalkeeper: !!p.isGoalkeeper, role: p.role || null,
    x: Number(p.position.x.toFixed(3)), y: Number(p.position.y.toFixed(3)), z: Number((p.position.z || 0).toFixed(3)),
    vx: Number((p.velocity.x || 0).toFixed(3)), vy: Number((p.velocity.y || 0).toFixed(3)),
    facing: { x: Number((p.facing.x || 0).toFixed(3)), y: Number((p.facing.y || 0).toFixed(3)) },
    intent: i.type || i.action || null, intentCreatedTick: Number.isFinite(Number(i.createdTick)) ? Number(i.createdTick) : null,
    intentCommitUntilTick: Number.isFinite(Number(i.commitUntilTick)) ? Number(i.commitUntilTick) : null,
    target: i.target ? { x: Number(i.target.x.toFixed(2)), y: Number(i.target.y.toFixed(2)) } : null,
    facingTarget: i.facingTarget ? { x: Number(i.facingTarget.x.toFixed(2)), y: Number(i.facingTarget.y.toFixed(2)) } : null,
    diveState: p._keeperDiveState ? JSON.parse(JSON.stringify(p._keeperDiveState)) : null,
    stamina: Number((p.stamina || 0).toFixed(3)), diving: p.attributes.diving, reflexes: p.attributes.reflexes, handling: p.attributes.handling, reach: p.attributes.reach };
}
function snapshotContext(m, point, attackTeamId) {
  const defenders = m.players.filter(p => p.active && p.teamId !== attackTeamId).map(p => ({ p, d: Math.hypot(p.position.x - point.x, p.position.y - point.y) })).sort((a, b) => a.d - b.d).slice(0, 4);
  const keepers = m.players.filter(p => p.active && p.teamId !== attackTeamId && p.isGoalkeeper).map(snapshotPlayer);
  return { nearestDefenders: defenders.map(({ p, d }) => Object.assign(snapshotPlayer(p), { distance: Number(d.toFixed(3)) })), opposingKeepers: keepers };
}

const seconds = Math.max(600, Math.min(900, Number(process.argv[2]) || 900));
const seeds = process.argv.slice(3).map(Number).filter(Number.isFinite);
const runSeeds = seeds.length ? seeds : [20261010, 20261011];
const traceTeams = { home: teamOptions('home', 'Redbridge FC', 'possession'), away: teamOptions('away', 'Ashford Athletic', 'direct') };
const results = [];
const appendEvent = TF.appendEvent;
for (const seed of runSeeds) {
  const wallStart = process.hrtime.bigint();
  const core = TF.createCore({ seed, halfSeconds: 2700, renderSnapshots: false,
    home: JSON.parse(JSON.stringify(traceTeams.home)), away: JSON.parse(JSON.stringify(traceTeams.away)) });
  const m = core.match, shots = [], goals = [], saves = [], fouls = [], advantages = [], advantageOutcomes = [], cards = [], contacts = [], tackles = [], recentSuccessfulTackles = [];
  let wrappedAppend = function (match, e) {
    if (e.type === 'shot') {
      const shotPlayer = match.playersById[e.playerId];
      shots.push({ tick: e.tick, time: Number(e.time.toFixed(2)), playerId: e.playerId, teamId: e.teamId,
        origin: e.origin, target: e.target, kickSpeed: e.kickSpeed, lift: e.lift, power: e.requestedPower,
        estimatedXg: TF.telemetry && typeof TF.telemetry.estimateShotXG === 'function' ? TF.telemetry.estimateShotXG(match, e) : null,
        ballAtKick: { ...match.ball.position, vx: match.ball.velocity.x, vy: match.ball.velocity.y, vz: match.ball.velocity.z },
        precedingPossessionEvents: match.events.slice(-20).filter(q => ['pass', 'throughBall', 'ball-control', 'ball-played', 'carry', 'dribble'].includes(q.type)).slice(-10).map(q => ({ type: q.type, tick: q.tick, playerId: q.playerId, teamId: q.teamId, origin: q.origin || q.contactPoint || null, target: q.target || null })),
        shooter: shotPlayer ? snapshotPlayer(shotPlayer) : null, ...snapshotContext(match, shotPlayer ? shotPlayer.position : e.origin, e.teamId) });
    } else if (e.type === 'goal') {
      const scorerTeam = match.teams.find(t => t.id === e.teamId), defendedGoalX = scorerTeam && scorerTeam.attackDirection > 0 ? match.pitch.length : 0;
      const gk = match.players.filter(p => p.active && p.teamId !== e.teamId && p.isGoalkeeper).map(p => {
        const s = snapshotPlayer(p); return Object.assign(s, { goalPlaneDistance: Number(Math.abs(defendedGoalX - p.position.x).toFixed(3)), distanceToBall: Number(Math.hypot(p.position.x - match.ball.position.x, p.position.y - match.ball.position.y).toFixed(3)) });
      });
      const linked = [...shots].reverse().find(s => s.playerId === e.shotPlayerId && s.tick <= e.tick) || null;
      goals.push({ tick: e.tick, time: Number(e.time.toFixed(2)), teamId: e.teamId, scorerId: e.scorerId, shotPlayerId: e.shotPlayerId,
        attackType: e.attackType, goalPosition: e.goalPosition, ball: { ...match.ball.position, vx: match.ball.velocity.x, vy: match.ball.velocity.y, vz: match.ball.velocity.z },
        scoreAfterGoal: { ...match.score }, defendingKeepers: gk, linkedShot: linked });
    } else if (e.type === 'save' || e.type === 'keeper-punch' || e.type === 'keeper-collection') {
      const keeper = match.playersById[e.keeperId];
      saves.push({ tick: e.tick, time: Number(e.time.toFixed(2)), type: e.type, ...e,
        ball: { ...match.ball.position, vx: match.ball.velocity.x, vy: match.ball.velocity.y, vz: match.ball.velocity.z },
        keeper: keeper ? snapshotPlayer(keeper) : null,
        nearestOpponents: keeper ? snapshotContext(match, keeper.position, keeper.teamId).nearestDefenders : [] });
    } else if (e.type === 'foul') fouls.push({ tick: e.tick, time: Number(e.time.toFixed(2)), ...e });
    else if (e.type === 'advantage') advantages.push({ tick: e.tick, time: Number(e.time.toFixed(2)), ...e });
    else if (e.type === 'advantage-recalled' || e.type === 'advantage-played') advantageOutcomes.push({ tick: e.tick, time: Number(e.time.toFixed(2)), type: e.type, ...e });
    else if (e.type === 'card') cards.push({ tick: e.tick, time: Number(e.time.toFixed(2)), ...e });
    else if (e.type === 'contact') {
      const offender = match.playersById[e.offenderId], victim = match.playersById[e.victimId];
      contacts.push({ tick: e.tick, time: Number(e.time.toFixed(2)), ...e,
        offender: offender ? snapshotPlayer(offender) : null, victim: victim ? snapshotPlayer(victim) : null,
        playerSeparation: offender && victim ? Number(Math.hypot(offender.position.x - victim.position.x, offender.position.y - victim.position.y).toFixed(3)) : null });
    }
    else if (e.type === 'tackle') {
      const record = { tick: e.tick, time: Number(e.time.toFixed(2)), ...e, ballOwnerAfterEvent: match.ball.ownerId,
        ball: { x: match.ball.position.x, y: match.ball.position.y, vx: match.ball.velocity.x, vy: match.ball.velocity.y },
        tackler: match.playersById[e.defenderId] ? snapshotPlayer(match.playersById[e.defenderId]) : null,
        attacker: match.playersById[e.attackerId] ? snapshotPlayer(match.playersById[e.attackerId]) : null };
      tackles.push(record);
      if (e.success) recentSuccessfulTackles.push(record);
    } else if (e.type === 'ball-control') {
      for (let i = recentSuccessfulTackles.length - 1; i >= 0; i--) {
        const tackle = recentSuccessfulTackles[i];
        if (e.tick - tackle.tick > 8) { recentSuccessfulTackles.splice(i, 1); continue; }
        if (!tackle.followingControl) tackle.followingControl = { tick: e.tick, playerId: e.playerId, teamId: e.teamId, origin: e.origin,
          sameTick: e.tick === tackle.tick, ballOwnerAfterEvent: match.ball.ownerId };
      }
    }
    return appendEvent(match, e);
  };
  TF.appendEvent = wrappedAppend;
  const until = seconds;
  let reportedMinute = 0;
  while (!m.state.finished && m.clock.elapsedSeconds < until) {
    core.step(120);
    const minute = Math.floor(m.clock.elapsedSeconds / 60);
    if (minute >= reportedMinute + 5) {
      reportedMinute = minute - minute % 5;
      process.stderr.write(`goal-trace seed=${seed} simulated=${reportedMinute}m/${Math.ceil(until / 60)}m tick=${m.tick}\n`);
    }
  }
  TF.appendEvent = appendEvent;
  const wallSeconds = Number((Number(process.hrtime.bigint() - wallStart) / 1e9).toFixed(3));
  const xgByTeam = {};
  for (const team of m.teams) { const rec = m.telemetry.teams && m.telemetry.teams[team.id]; xgByTeam[team.id] = rec ? rec.xG : null; }
  results.push({ seed, sourceVersion, simulatedSeconds: Number(m.clock.elapsedSeconds.toFixed(2)), wallSeconds,
    ticks: m.tick, ticksPerSecond: wallSeconds > 0 ? Number((m.tick / wallSeconds).toFixed(1)) : null, shots, goals, saves, fouls,
    foulIncidentCount: fouls.length + advantages.length, advantages, advantageOutcomes, cards,
    contacts: { count: contacts.length, severe58Plus: contacts.filter(e => e.severity >= .58).length,
      severityMean: contacts.length ? Number((contacts.reduce((s, e) => s + e.severity, 0) / contacts.length).toFixed(3)) : null,
      playerSeparationBins: contacts.reduce((bins, e) => { const d = e.playerSeparation; const key = d == null ? 'unknown' : d < .8 ? '<0.8' : d < 1 ? '0.8-1.0' : d < 1.2 ? '1.0-1.2' : d < 1.5 ? '1.2-1.5' : d < 2 ? '1.5-2.0' : '>=2.0'; bins[key] = (bins[key] || 0) + 1; return bins; }, {}),
      highest: contacts.slice().sort((a, b) => b.severity - a.severity).slice(0, 12), trace: contacts },
    tackles: { count: tackles.length, successful: tackles.filter(t => t.success).length,
      sameTickAttackerRecaptures: tackles.filter(t => t.success && t.followingControl && t.followingControl.sameTick && t.followingControl.playerId === t.attackerId).length,
      attackerRecapturesWithin8Ticks: tackles.filter(t => t.success && t.followingControl && t.followingControl.playerId === t.attackerId).length,
      trace: tackles }, xgByTeam, score: m.score });
}
const runnerSha256 = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
const report = { kind: 'goalkeeper-shot-contact-trace', sourceVersion, runnerSha256, simulatedMinutesPerSeed: seconds / 60,
  matchup: 'Redbridge FC (possession) vs Ashford Athletic (direct), 4-3-3',
  teams: ['home', 'away'].map(id => ({ id, formation: traceTeams[id].formation, tactics: traceTeams[id].tactics })), results };
const out = process.env.GOAL_TRACE_OUT || `.project/reports/goal-trace-${sourceVersion}-${seconds}s.json`;
fs.writeFileSync(path.resolve(process.cwd(), out), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ out, sourceVersion, seeds: results.map(r => ({ seed: r.seed, minutes: r.simulatedSeconds / 60,
  wallSeconds: r.wallSeconds, ticks: r.ticks, ticksPerSecond: r.ticksPerSecond,
  shots: r.shots.length, goals: r.goals.length, saves: r.saves.length, fouls: r.fouls.length,
  foulIncidents: r.foulIncidentCount, cards: r.cards.length,
  tackles: r.tackles.count, successfulChallengesRecapturedSameTick: r.tackles.sameTickAttackerRecaptures,
  successfulChallengesRecapturedWithin8Ticks: r.tackles.attackerRecapturesWithin8Ticks,
  meanXgEstimate: r.shots.length ? r.shots.reduce((sum, s) => sum + s.estimatedXg, 0) / r.shots.length : 0 })) }, null, 2) + '\n');
