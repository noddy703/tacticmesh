const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const modules = ['core', 'world', 'physics', 'labs'].map(name => [name, fs.readFileSync(path.resolve(__dirname, '../src', `${name}.js`), 'utf8')]);
const scenarios = ['Lob', 'Rolling ball', 'Shot', 'Post', 'First touch', 'Header', 'Tackle', 'Goalkeeper dive'];

function runScenario(scenario, { interrupt = null } = {}) {
  const nodes = new Map(), queued = [], matches = [];
  function element(id, value) {
    const listeners = Object.create(null);
    const el = { id, value: value == null ? '' : String(value), disabled: false, textContent: '', innerHTML: '',
      addEventListener(type, callback) { listeners[type] = callback; }, dispatch(type) { if (listeners[type]) listeners[type].call(this); },
      classList: { add() {}, remove() {} } };
    nodes.set(id, el); return el;
  }
  ['labTitle', 'labLead', 'labOutput', 'labStatus', 'labSeed', 'scenario', 'labRun', 'labReset', 'labCancel', 'labSpeed'].forEach(id => element(id, ({ labSeed: 2026, scenario: 0, labSpeed: 1 })[id]));
  const document = { readyState: 'complete', body: { getAttribute: name => name === 'data-lab' ? 'physics' : null }, getElementById: id => nodes.get(id) || null, addEventListener() {} };
  const TF = {};
  const context = { TF, document, console, Date, Math, Set, setTimeout(callback) { queued.push(callback); return queued.length; }, clearTimeout() {} };
  context.globalThis = context;
  for (const [, source] of modules.slice(0, 3)) vm.runInNewContext(source, context);
  const originalCreate = TF.createMatch;
  TF.createMatch = function (config) { const created = originalCreate(config); matches.push(created); return created; };
  vm.runInNewContext(modules[3][1], context);
  const index = scenarios.indexOf(scenario);
  nodes.get('scenario').value = index;
  nodes.get('scenario').dispatch('change');
  nodes.get('labRun').dispatch('click');
  if (interrupt === 'reset') {
    const oldQueued = queued.shift(), nextMatch = matches[matches.length - 1];
    nodes.get('scenario').value = scenarios.indexOf('Shot'); nodes.get('scenario').dispatch('change');
    const replacement = matches[matches.length - 1];
    oldQueued();
    assert.equal(replacement.tick, 0, 'a stale physics callback must not advance a reset fixture');
    return { status: nodes.get('labStatus').textContent, replacement, nextMatch };
  }
  if (interrupt === 'cancel') {
    const oldQueued = queued.shift(), activeMatch = matches[matches.length - 1];
    nodes.get('labCancel').dispatch('click'); oldQueued();
    assert.equal(activeMatch.tick, 1, 'cancelled physics callbacks must not advance the fixture again');
    assert.match(nodes.get('labStatus').textContent, /Cancelled/);
    return { status: nodes.get('labStatus').textContent };
  }
  let ticks = 0;
  while (queued.length && ticks < 700) { queued.shift()(); ticks++; }
  return { status: nodes.get('labStatus').textContent, output: nodes.get('labOutput').textContent, match: matches[matches.length - 1] };
}

for (const scenario of scenarios) {
  const result = runScenario(scenario);
  assert.match(result.output, /Result: PASS/, `${scenario}: ${result.output}`);
  const types = result.match.events.map(event => event.type);
  if (scenario === 'Lob') assert(result.match.events.some(event => event.type === 'pass' && event.lift > 0.5), 'lob must record an elevated pass');
  if (scenario === 'Rolling ball') assert(Math.abs(result.match.ball.position.x - 55) >= 3, 'rolling ball must travel at least 3 m');
  if (scenario === 'Shot') assert(types.includes('shot'), 'shot must be a physics shot event');
  if (scenario === 'Post') assert(result.match.events.some(event => event.type === 'frame-hit' && event.frame === 'post'), 'post must record frame contact');
  if (scenario === 'First touch') assert(types.includes('ball-control'), 'first touch must produce control, not just a deflection');
  if (scenario === 'Header') assert(types.includes('header'), 'header fixture must produce a successful header event for the default seed');
  if (scenario === 'Tackle') assert(result.match.events.some(event => event.type === 'tackle' && event.success), 'tackle must win the ball');
  if (scenario === 'Goalkeeper dive') assert(result.match.events.some(event => event.type === 'save' && event.keeperId), 'keeper must save the shot');
}
runScenario('Rolling ball', { interrupt: 'cancel' });
runScenario('Rolling ball', { interrupt: 'reset' });
process.stdout.write('all eight seeded physics-lab outcomes and cancel/reset lifecycle checks passed\n');
