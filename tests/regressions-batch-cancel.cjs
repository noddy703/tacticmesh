const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../src/labs.js'), 'utf8');
const elements = new Map();
function node(id, value) {
  const listeners = {};
  const el = { id, value: value || '', disabled: false, textContent: '', innerHTML: '', onclick: null,
    addEventListener(type, callback) { listeners[type] = callback; }, dispatch(type) { if (listeners[type]) listeners[type].call(this); } };
  elements.set(id, el); return el;
}
['labTitle', 'labLead', 'labSeed', 'labOutput', 'labStatus', 'labRun'].forEach(id => node(id, id === 'labSeed' ? '1' : ''));
node('batchCount', '2'); node('batchMode', '.2'); node('cancelBatch'); node('exportBatch');
const pending = [], created = [];
const document = { readyState: 'complete', body: { getAttribute(name) { return name === 'data-lab' ? 'batch' : null; } },
  getElementById(id) { return elements.get(id) || null; }, addEventListener() {} };
const TF = {
  createMatch(config) {
    const match = { seed: config.seed, tick: 0, halfSeconds: config.halfSeconds,
      clock: { elapsedSeconds: 0, periodSeconds: 0, period: 1 },
      state: { finished: false, halfTime: false }, score: { home: 0, away: 0 }, telemetry: { shots: 0, passes: 0 },
      startSecondHalf() { this.clock.period = 2; this.clock.periodSeconds = 0; this.state.halfTime = false; } };
    created.push(match); return match;
  },
  updateWorld(match) {
    match.clock.periodSeconds += 1 / 60; match.clock.elapsedSeconds += 1 / 60;
    if (match.clock.periodSeconds >= match.halfSeconds) {
      if (match.clock.period === 1) match.state.halfTime = true;
      else match.state.finished = true;
    }
  }
};
const context = { TF, document, Date, Math, Set, Blob: function () {}, URL: {}, setTimeout(fn) { pending.push(fn); return pending.length; } };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'src/labs.js' });
elements.get('labRun').dispatch('click');
pending.shift()();
assert.equal(created.length, 2, 'the second match may start after the first finishes within the chunk');
assert.equal(created[0].state.finished, true, 'the first match should have finished inside the first chunk');
assert.equal(created[1].state.finished, false, 'the second match should remain unfinished when the chunk yields');
assert.equal(pending.length, 1, 'the batch must yield before advancing its next match');
elements.get('cancelBatch').dispatch('click');
pending.shift()();
assert.equal(created.length, 2, 'cancellation must stop progress after the second match has started');
assert.match(elements.get('labStatus').textContent, /Cancelled/);
assert.equal(elements.get('labRun').disabled, false);
process.stdout.write('batch yields and accepts cancellation across a match boundary\n');
