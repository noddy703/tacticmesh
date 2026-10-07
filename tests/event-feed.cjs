const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
const TF = globalThis.TF;

// The shared cursor remains incremental after the former 1,200-key cache
// capacity and survives a bounded source-history replacement.
const cursor = TF.createEventCursor();
const history = Array.from({ length: 1305 }, (_, i) => ({ sequence: i + 1, tick: i, type: i === 9 ? 'goal' : 'ball-control' }));
assert.equal(cursor.read(history).length, 1305);
assert.equal(cursor.read(history).length, 0, 'a second update with unchanged history emits nothing');
history.push({ sequence: 1306, tick: 1305, type: 'shot' });
assert.deepEqual(cursor.read(history).map(e => e.sequence), [1306]);
history.splice(0, 1000);
assert.equal(cursor.read(history).length, 0, 'trimming old source history does not replay prior events');
history.push({ sequence: 1307, tick: 1306, type: 'save' });
assert.deepEqual(cursor.read(history).map(e => e.sequence), [1307]);
history.splice(0, 500);
for (let sequence = 1308; sequence <= 2807; sequence++) history.push({ sequence, tick: sequence, type: 'foul' });
assert.deepEqual(cursor.read(history).map(e => e.sequence), Array.from({ length: 1500 }, (_, i) => i + 1308),
  'compaction followed by append is detected even when the new window exceeds the old cursor offset');

const elements = Object.create(null), timers = [], audioEvents = [];
function fakeElement(tag) {
  const element = { tagName: tag.toUpperCase(), children: [], hidden: false, style: { setProperty() {} },
    classList: { add() {}, remove() {} }, appendChild(child) { this.children.push(child); }, addEventListener() {}, querySelector() { return fakeElement('button'); } };
  Object.defineProperty(element, 'id', { get() { return this._id || ''; }, set(value) { this._id = value; elements[value] = this; } });
  let html = '';
  Object.defineProperty(element, 'innerHTML', { get() { return html; }, set(value) { html = String(value); element.innerHTMLWrites = (element.innerHTMLWrites || 0) + 1; } });
  return element;
}
const wrap = fakeElement('div');
globalThis.document = {
  querySelector(selector) { return selector === '.canvas-wrap' ? wrap : null; },
  getElementById(id) { return elements[id] || null; },
  createElement(tag) { const node = fakeElement(tag); return node; }
};
globalThis.setTimeout = (callback, delay) => { const id = timers.length + 1; timers.push({ callback, delay }); return id; };
globalThis.clearTimeout = () => {};
TF.audio = { attach() {}, play(name) { audioEvents.push(name); } };
require('../src/studio.js');
const match = { seed: 1, teams: [{ id: 'home', name: 'Home', formation: '4-3-3', activePlayers: [] }, { id: 'away', name: 'Away', formation: '4-3-3', activePlayers: [] }],
  playersById: {}, score: { home: 0, away: 0 }, events: [], clock: { elapsedSeconds: 0 } };
TF.studio.mount(match);
for (let i = 1; i <= 1305; i++) match.events.push({ sequence: i, tick: i, period: 1, periodSeconds: i, type: i === 5 ? 'goal' : i === 6 ? 'ball-played' : 'ball-control', teamId: 'home', scorerId: 'striker' });
TF.studio.update(match);
const overlay = elements.eventOverlay;
assert.ok(overlay.innerHTML.includes('GOAL'), 'the major event overlays once');
const overlayWrites = overlay.innerHTMLWrites, scheduled = timers.length, audioCount = audioEvents.length;
assert.equal(audioCount, 2, 'a goal and the procedural kick contact each play once');
assert.equal(scheduled, 3, 'two intro timers plus one event overlay timer are scheduled');
TF.studio.update(match); TF.studio.update(match);
assert.equal(overlay.innerHTMLWrites, overlayWrites, 'unchanged history does not repeat an old goal overlay');
assert.equal(timers.length, scheduled, 'unchanged history does not create duplicate timers');
assert.equal(audioEvents.length, audioCount, 'unchanged history does not replay old event audio');
match.events.push({ sequence: 1306, tick: 1306, period: 1, periodSeconds: 1306, type: 'goal', teamId: 'away', scorerId: 'striker' });
TF.studio.update(match);
assert.equal(audioEvents.length, audioCount + 1, 'a new goal after the high-water mark plays exactly once');
assert.equal(overlay.innerHTMLWrites, overlayWrites + 1, 'a new goal after the high-water mark overlays exactly once');
const restored = match.events.slice(0, 12);
match.events = restored; TF.studio.restoreMatchEvents(match); TF.studio.update(match);
assert.equal(overlay.innerHTMLWrites, overlayWrites + 1, 'checkpoint restore explicitly skips historical overlay replay');

let uiRestoreCalls = 0, studioRestoreCalls = 0;
TF.ui = { restoreMatchEvents(m) { assert.equal(m.id, restorable.id); uiRestoreCalls++; } };
TF.studio = { restoreMatchEvents(m) { assert.equal(m.id, restorable.id); studioRestoreCalls++; } };
const restorable = TF.createMatch({ seed: 19, matchId: 'event-cursor-checkpoint' });
restorable.tick = 12;
TF.appendEvent(restorable, { type: 'pass', tick: 12 });
TF.appendEvent(restorable, { type: 'goal', tick: 12 });
const checkpoint = TF.captureCheckpoint(restorable);
TF.appendEvent(restorable, { type: 'foul', tick: 12 });
TF.restoreCheckpoint(restorable, checkpoint);
const branchEvent = TF.appendEvent(restorable, { type: 'shot', tick: 12 });
assert.equal(branchEvent.sequence, 12 * 1024 + 3, 'same-tick event sequence resumes from checkpoint state in O(1)');
assert.equal(uiRestoreCalls, 1, 'checkpoint restore explicitly resets the public feed cursor');
assert.equal(studioRestoreCalls, 1, 'checkpoint restore explicitly resets the studio cursor');

process.stdout.write('event cursor and studio narrative remain once-only beyond 1,200 events\n');
