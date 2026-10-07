const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../src/labs.js'), 'utf8');
function element(id) {
  return { id, value: id === 'labSeed' ? '7' : '0', disabled: false, textContent: '', innerHTML: '',
    handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; }, click() { if (this.handlers.click) this.handlers.click(); }, classList: { add() {}, remove() {} },
    getAttribute() { return null; } };
}
function makeMatch() {
  const teams = ['home', 'away'].map((id, t) => {
    const players = Array.from({ length: 11 }, (_, i) => ({
      id: id + '-p' + (i + 1), teamId: id, team: null, active: true, isGoalkeeper: i === 0,
      role: i === 0 ? 'GK' : i < 5 ? 'DEF' : i < 9 ? 'MID' : 'FWD',
      position: { x: t ? 82 : 23, y: 10 + i * 4, z: 0 }, previousPosition: { x: t ? 82 : 23, y: 10 + i * 4, z: 0 },
      velocity: { x: 0, y: 0, z: 0 }, facing: { x: 1, y: 0 }, attributes: {}, traits: {}, stats: {}, stamina: 1
    }));
    return { id, attackDirection: t ? -1 : 1, players, activePlayers: players.slice(), bench: [], tactics: {} };
  });
  teams.forEach(team => team.players.forEach(player => { player.team = team; }));
  const players = teams.flatMap(team => team.players);
  const playersById = Object.fromEntries(players.map(player => [player.id, player]));
  const match = { seed: 7, pitch: { length: 105, width: 68 }, teams, players, playersById,
    ball: { position: { x: 52.5, y: 34, z: .11 }, previousPosition: { x: 52.5, y: 34, z: .11 }, velocity: { x: 0, y: 0, z: 0 }, ownerId: null },
    state: { phase: 'open-play', score: {}, rules: {}, finished: false, halfTime: false },
    score: { home: 0, away: 0 }, clock: { elapsedSeconds: 0, periodSeconds: 0, period: 1, periodLimitSeconds: 2700 },
    events: [], telemetry: { goals: [] }, tick: 0, captureSnapshot() {} };
  return match;
}

for (const page of ['ai', 'formation', 'physics', 'rules', 'batch']) {
  const nodes = new Map();
  const ids = ['labTitle', 'labLead', 'labSeed', 'labOutput', 'labStatus', 'labRun'];
  if (page !== 'batch') ids.push('scenario', 'labCanvas', 'labReset');
  if (page === 'ai') ids.push('labCancel');
  if (page === 'formation') ids.push('oppositionFormation', 'labPhase');
  if (page === 'physics') ids.push('labCancel', 'labSpeed');
  if (page === 'batch') ids.push('cancelBatch', 'batchCount', 'batchMode', 'exportBatch');
  ids.forEach(id => nodes.set(id, element(id)));
  const document = { readyState: 'complete', body: { getAttribute(name) { return name === 'data-lab' ? page : null; } },
    getElementById(id) { return nodes.has(id) ? nodes.get(id) : null; }, addEventListener() {} };
  const scheduled = [];
  let lastMatch = null;
  const TF = { createMatch() { lastMatch = makeMatch(); return lastMatch; } };
  if (page === 'ai') {
    TF.configureAIScenario = () => {};
    TF.updateLabNeutrals = () => {};
    TF.updateTactics = () => {};
    TF.updateAI = () => {};
    TF.updateWorld = match => { match.clock.periodSeconds += 1 / 60; };
  }
  const context = { TF, document, console, setTimeout(fn) { scheduled.push(fn); return scheduled.length; }, clearTimeout() {}, Date, Math, Set };
  context.globalThis = context;
  assert.doesNotThrow(() => vm.runInNewContext(source, context, { filename: 'src/labs.js' }), page + ' lab should boot');
  if (page === 'ai') {
    nodes.get('labRun').click();
    assert.equal(lastMatch.tick, 0, 'AI Run should yield to the browser before simulating');
    scheduled.shift()();
    assert.equal(lastMatch.tick, 30, 'AI Run should advance only one responsive 30-tick chunk');
    nodes.get('labCancel').click();
    scheduled.shift()();
    assert.equal(lastMatch.tick, 30, 'AI cancellation should stop before another chunk');
    assert.match(nodes.get('labStatus').textContent, /Cancelled/);
  }
}
process.stdout.write('lab entrypoints boot with their minimal page DOMs (AI, formation, physics, rules, batch)\n');
