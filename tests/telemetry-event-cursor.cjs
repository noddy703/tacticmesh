const assert = require('node:assert/strict');
for (const file of ['core', 'analysis', 'world', 'tactics', 'intelligence', 'physics', 'rules', 'telemetry']) require('../src/' + file + '.js');
const TF = globalThis.TF;

const match = TF.createMatch({ seed: 118901, halfSeconds: 90, matchId: 'telemetry-event-cursor' });
match.state.phase = 'open-play';
match.tick = 100;
TF.updateTelemetry(match, TF.FIXED_DT);
match.events = Array.from({ length: 12000 }, (_, i) => ({ type: 'old-marker', tick: Math.floor(i / 10), sequence: i + 1 }));
match.telemetry._quality.lastEventIndex = match.events.length;
match.telemetry._quality.lastEventSequence = match.events.length;
match.telemetry._quality.lastEventMarkerSequence = match.events.length;
let numericReads = 0;
const eventTarget = match.events;
match.events = new Proxy(eventTarget, {
  get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) numericReads++;
    return Reflect.get(target, key, receiver);
  }
});
eventTarget.push({ type: 'new-marker', tick: 100, sequence: 12001 });
TF.updateTelemetry(match, TF.FIXED_DT);
assert.equal(numericReads, 2, 'one append reads the previous marker and new row without revisiting history');
assert.equal(match.telemetry.recentEvents.length, 1);
assert.equal(match.telemetry.recentEvents[0].type, 'new-marker');
numericReads = 0;
TF.updateTelemetry(match, TF.FIXED_DT);
assert.equal(numericReads, 1, 'an unchanged history checks only its O(1) sequence marker');
assert.equal(match.telemetry.recentEvents.length, 1, 'repeated ticks never recount consumed events');

// A bounded feed may be compacted and refilled before the next update without
// changing its length. The displaced cursor slot triggers one exceptional
// retained-window scan; sequence high-water prevents replay of old rows.
eventTarget.splice(0, 5);
for (let sequence = 12002; sequence <= 12006; sequence++) eventTarget.push({ type: 'new-marker', tick: 100, sequence });
numericReads = 0;
TF.updateTelemetry(match, TF.FIXED_DT);
assert.equal(match.telemetry.recentEvents.length, 6, 'compaction plus append consumes only the five new sequenced rows');
assert.equal(match.telemetry._quality.lastEventSequence, 12006);
assert.ok(numericReads > 10000, 'compaction detection is exceptional and scans the retained history once');
eventTarget.splice(0, eventTarget.length - 2);
numericReads = 0;
TF.updateTelemetry(match, TF.FIXED_DT);
assert.equal(match.telemetry.recentEvents.length, 6, 'compaction without new rows does not replay retained events');
assert.equal(match.telemetry._quality.lastEventSequence, 12006);
numericReads = 0;
TF.updateTelemetry(match, TF.FIXED_DT);
assert.equal(numericReads, 1, 'after a prune, subsequent updates return to O(1) marker reads');

const restored = TF.createMatch({ seed: 118902, halfSeconds: 90, matchId: 'telemetry-event-restore' });
restored.state.phase = 'open-play';
TF.updateTelemetry(restored, TF.FIXED_DT);
restored.tick = 1;
TF.appendEvent(restored, { type: 'restore-marker', tick: 1 });
TF.updateTelemetry(restored, TF.FIXED_DT);
const checkpoint = TF.captureCheckpoint(restored);
restored.tick = 2;
TF.appendEvent(restored, { type: 'restore-marker', tick: 2 });
TF.updateTelemetry(restored, TF.FIXED_DT);
assert.equal(restored.telemetry.recentEvents.length, 2);
TF.restoreCheckpoint(restored, checkpoint);
assert.equal(restored.telemetry.recentEvents.length, 1, 'checkpoint restore returns telemetry cursor with its event prefix');
restored.tick = 3;
TF.appendEvent(restored, { type: 'restore-marker', tick: 3 });
TF.updateTelemetry(restored, TF.FIXED_DT);
TF.updateTelemetry(restored, TF.FIXED_DT);
assert.deepEqual(restored.telemetry.recentEvents.map(e => e.type), ['restore-marker', 'restore-marker']);
assert.equal(restored.telemetry.recentEvents.length, 2, 'restored suffix is consumed exactly once');
assert.equal(restored.telemetry._quality.lastEventSequence, 3073);

process.stdout.write('telemetry event cursor passes (12k-row incremental read, no duplicate processing, checkpoint suffix consumed once)\n');
