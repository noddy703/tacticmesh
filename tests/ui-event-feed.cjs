const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/studio.js');
const TF = globalThis.TF;

const elements = Object.create(null), frames = [], timers = [], windowListeners = Object.create(null);
globalThis.addEventListener = (type, callback) => { (windowListeners[type] ||= []).push(callback); };
globalThis.dispatchEvent = event => { for (const callback of windowListeners[event.type] || []) callback.call(globalThis, event); return true; };
const debugCandidates = { checked: false, dataset: { debug: 'candidate' }, addEventListener(type, callback) { (this.listeners ||= {})[type] = callback; } };
function element(tag = 'div') {
  const out = { tagName: tag.toUpperCase(), value: '', textContent: '', children: [], hidden: false, checked: false, dataset: {}, style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {} }, addEventListener(type, callback) { (this.listeners ||= {})[type] = callback; },
    appendChild(node) { this.children.push(node); }, removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); },
    setAttribute() {}, dispatchEvent() {}, getBoundingClientRect() { return { left: 0, top: 0 }; } };
  Object.defineProperty(out, 'innerHTML', { get() { return this._html || ''; }, set(value) { this._html = String(value); if (!value) this.children = []; } });
  return out;
}
const document = globalThis.document = {
  readyState: 'complete', hidden: false,
  getElementById(id) { return elements[id] || (elements[id] = element(id === 'pitchCanvas' ? 'canvas' : 'div')); },
  createElement(tag) { return element(tag); }, querySelectorAll() { return [debugCandidates]; }, querySelector() { return null; }, addEventListener() {}
};
globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
globalThis.setTimeout = callback => { timers.push(callback); return timers.length; };
globalThis.clearTimeout = () => {};

const match = {
  id: 'ui-feed-match', seed: 41, teams: [{ id: 'home', name: 'Home', formation: '4-3-3', activePlayers: [] }, { id: 'away', name: 'Away', formation: '4-2-3-1', activePlayers: [] }],
  playersById: {
    scorer: { id: 'scorer', name: 'Forward', teamId: 'home', number: 9, role: 'ST', positionFamily: 'FWD', preferredFoot: 'right', age: 25, attributes: {}, traits: {}, stats: {}, stamina: 1,
      intent: { type: 'pass', action: 'pass', target: { x: 72, y: 33 }, utility: .74 },
      beliefState: { updatedTick: 20, entities: { 'away-1': { id: 'away-1', teamId: 'away', role: 'CB', estimatedPosition: { x: 69, y: 30 }, confidence: .73, ageTicks: 4, source: 'vision' } }, ball: { estimatedPosition: { x: 70, y: 34 }, confidence: .9, ageTicks: 1, source: 'vision' } },
      ai: { lastDecision: 20, decisionExplanation: { tick: 20, reason: 'utility-winner', utilityWinner: { type: 'pass', target: { x: 72, y: 33 }, utility: .74 }, selected: { type: 'pass', target: { x: 72, y: 33 }, utility: .74 }, commitment: { valid: false }, evaluatedCount: 1, storedCount: 1, truncated: false, attentionCount: 1, candidates: [{ rank: 1, type: 'pass', targetId: 'mate-1', target: { x: 72, y: 33 }, utility: .74, utilityComponents: { raw: .7, tactical: .03, playerPreference: .02, uncertainty: -.01 }, details: { arrivalTime: 1.2, leadTime: .3, laneInterceptionRisk: .12, receiverConfidence: .88, pressure: .2, userLabel: '<script>alert(1)</script>' } }], beliefs: { entityCount: 1, truncated: false, entities: [{ id: 'away-1', teamId: 'away', role: 'CB', estimatedPosition: { x: 69, y: 30 }, confidence: .73, ageTicks: 4, source: 'vision' }], ball: { estimatedPosition: { x: 70, y: 34 }, confidence: .9, ageTicks: 1, source: 'vision' } } } }
  }, defender: { id: 'defender', name: 'Defender' } }, score: { home: 1, away: 0 }, telemetry: { goals: [], shots: 0, passes: 0 },
  events: [], clock: { period: 1, periodSeconds: 20, elapsedSeconds: 20 }, state: { halfTime: false, finished: false },
  captureSnapshot() {}, pause() {}
};
for (let sequence = 1; sequence <= 1305; sequence++) match.events.push({ sequence, tick: sequence, type: sequence === 5 ? 'goal' : sequence === 6 ? 'ball-played' : 'ball-control', scorerId: 'scorer', teamId: 'home', period: 1, periodSeconds: sequence });
TF.createMatch = () => match;
TF.createCore = () => ({ advance() { return { alpha: 0, droppedSeconds: 0 }; }, isPaused() { return false; }, setSpeed() {}, pause() {}, resume() {}, step() {} });
const selectedRenderIds = []; let rendererResizeCount = 0;
TF.createRenderer = () => ({ setSelected(id) { selectedRenderIds.push(id); }, resize() { rendererResizeCount++; }, capture() {}, render() {}, setCamera() {}, zoomBy() {}, setQuality() {}, hitTest() { return { id: 'scorer' }; }, setDebug() {} });
Object.assign(TF.studio, { mount() {}, update() {} });
TF.audio = { isEnabled() { return true; } };
require('../src/ui.js');
elements.startButton.listeners.click();
assert.ok(frames.length, 'starting the match schedules its frame loop');
assert.equal(windowListeners.resize.length, 1, 'the UI registers one window resize listener');
const resizeFramesBefore = frames.length, resizeCallsBefore = rendererResizeCount;
globalThis.dispatchEvent({ type: 'resize' });
assert.equal(frames.length, resizeFramesBefore + 1, 'a window resize schedules a view update');
frames.pop()(0);
assert.equal(rendererResizeCount, resizeCallsBefore + 1, 'the resize event resizes the renderer');
const profileSelect = elements.playerProfileSelect;
assert.ok(profileSelect.children.some(option => option.value === 'scorer' && /Home.*Forward/.test(option.textContent)), 'player selector exposes named team/player options');
const selectionClock = match.clock.elapsedSeconds, selectionEvents = match.events.length;
profileSelect.value = 'scorer';
profileSelect.listeners.change.call(profileSelect);
assert.match(elements.inspector.innerHTML, /<h3>Forward<\/h3>/, 'native keyboard-select change opens the existing player profile without a canvas click');
assert.equal(selectedRenderIds.at(-1), 'scorer', 'selector highlights the same pitch player');
assert.equal(match.clock.elapsedSeconds, selectionClock, 'profile selection does not advance the match');
assert.equal(match.events.length, selectionEvents, 'profile selection does not alter football events');
frames.shift()(16);
elements.pitchCanvas.listeners.click({ clientX: 1, clientY: 1 });
assert.equal(profileSelect.value, 'scorer', 'canvas selection stays in sync with the accessible selector');
assert.doesNotMatch(elements.inspector.innerHTML, /Player insight|Evaluated alternatives/, 'normal player report exposed debug decision data');
assert.equal(elements.eventCount.textContent, '1', 'the bounded public feed counts the single goal and filters raw internal contacts');
assert.equal(elements.eventList.children.length, 1, 'the feed only renders meaningful match notes');
assert.equal(timers.length, 1, 'one goal creates one toast timer');
frames.shift()(32);
assert.equal(elements.eventCount.textContent, '1', 'unchanged history does not recount after more than 1,200 events');
assert.equal(timers.length, 1, 'unchanged history does not create a duplicate toast');

debugCandidates.checked = true;
debugCandidates.listeners.change();
assert.match(elements.inspector.innerHTML, /<details class="debug-explanation"><summary>Player insight/, 'debug explanation is not in a collapsible section');
assert.match(elements.inspector.innerHTML, /highest-utility candidate/, 'debug inspector did not explain the selected utility winner');
assert.match(elements.inspector.innerHTML, /away-1.*estimate \(69\.0, 30\.0\).*73% confidence.*age 4 ticks.*vision/, 'debug inspector omitted local belief identity, estimate, confidence, age, or source');
assert.match(elements.inspector.innerHTML, /raw 0\.700.*tactical 0\.030.*preference 0\.020.*noise -0\.010/, 'debug inspector omitted the existing utility components');
assert.match(elements.inspector.innerHTML, /arrivalTime=1\.20.*leadTime=0\.30.*laneInterceptionRisk=0\.12.*receiverConfidence=0\.88/, 'debug inspector omitted candidate prediction detail');
assert.doesNotMatch(elements.inspector.innerHTML, /<script>alert\(1\)<\/script>/, 'debug candidate detail was not escaped');

match.events.splice(0, 500);
for (let sequence = 1306; sequence <= 2805; sequence++) match.events.push({ sequence, tick: sequence, type: sequence === 2805 ? 'shot' : 'ball-control', playerId: 'scorer', teamId: 'home', period: 1, periodSeconds: sequence });
frames.shift()(48);
assert.equal(elements.eventCount.textContent, '2', 'a compacted history plus fresh meaningful event advances the count once');
assert.equal(elements.eventList.children.length, 2, 'raw events in the compacted window stay filtered');

match.events.push({ sequence: 2806, tick: 2806, type: 'tackle', success: true, possessionWon: false, defenderId: 'defender', teamId: 'away', period: 1, periodSeconds: 44 });
frames.shift()(64);
assert.equal(elements.eventCount.textContent, '3', 'a loose-ball tackle is a single meaningful public note');
assert.match(elements.eventList.children[2].innerHTML, /Poked loose · Defender/,
  'the public feed does not claim a challenge won possession when the ball is only loose');
match.events.push({ sequence: 2807, tick: 2807, type: 'save', keeperId: 'scorer', teamId: 'home', period: 1, periodSeconds: 45 });
frames.shift()(80);
assert.match(elements.eventList.children[3].innerHTML, /Keeper contact · Forward/, 'raw keeper contact is not described as a validated save');

// Readiness and the recorded physical release remain distinct in the actual live feed.
const readyEvent = { sequence: 2808, tick: 2808, type: 'restart-ready', restartType: 'goal-kick', takerId: 'scorer', teamId: 'home', period: 1, periodSeconds: 46 };
const readyBytes = JSON.stringify(readyEvent), restartClock = match.clock.elapsedSeconds;
match.events.push(readyEvent);
frames.shift()(96);
assert.match(elements.eventList.children[4].innerHTML, /Goal kick ready · Forward/);
assert.doesNotMatch(elements.eventList.children[4].innerHTML, /taken/, 'preparation is not described as a completed kick');
assert.equal(JSON.stringify(readyEvent), readyBytes, 'formatting leaves the authored readiness event unchanged');
match.events.push({ sequence: 2809, tick: 2809, type: 'ball-played', playerId: 'scorer' }, { sequence: 2810, tick: 2809, type: 'restart-taken', restartType: 'goal-kick', takerId: 'scorer', period: 1, periodSeconds: 47 });
frames.shift()(112);
assert.equal(elements.eventCount.textContent, '6', 'the physical release adds one public restart note, without duplicating ball-played');
assert.match(elements.eventList.children[5].innerHTML, /Goal kick taken · Forward/);
frames.shift()(128);
assert.equal(elements.eventCount.textContent, '6', 'unchanged restart history is not narrated twice');
assert.equal(match.clock.elapsedSeconds, restartClock, 'event wording does not advance match time');
for (const [type, name] of [['kickoff', 'Kick-off'], ['corner', 'Corner'], ['throw-in', 'Throw-in'], ['direct-free-kick', 'Free kick'], ['indirect-free-kick', 'Indirect free kick'], ['penalty', 'Penalty']]) {
  assert.equal(TF.studio.restartText({ type: 'restart-ready', restartType: type }), name + ' ready');
  assert.equal(TF.studio.restartText({ type: 'restart-taken', restartType: type }), name + ' taken');
}
assert.equal(TF.studio.restartText({ type: 'restart-taken', restartType: 'dropped-ball' }), 'Ball dropped', 'a dropped-ball release is not described as a kick');
assert.equal(TF.studio.restartText({ type: 'shot' }), null, 'other event wording is untouched');

const markup = require('node:fs').readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
for (const name of ['import', 'backup', 'storage', 'simulation', 'about']) {
  assert.match(markup, new RegExp('<dialog[^>]*id="' + name + 'Dialog"[^>]*aria-labelledby="' + name + 'DialogTitle"'), name + ' dialog has an accessible name');
  assert.match(markup, new RegExp('<h2 id="' + name + 'DialogTitle">[^<]+</h2>'), name + ' dialog references its visible heading');
}
assert.match(markup, /<progress[^>]*id="simulationProgress"[^>]*aria-label="Simulation progress"/, 'simulation progress is named');
assert.match(markup, /<label[^>]*>Player profile<select id="playerProfileSelect">/, 'native player selector has a visible associated label');
for (const [tab, panel] of [['tabMatch', 'matchPitchView'], ['tabEvents', 'eventFeedView'], ['tabStats', 'liveStats']]) {
  assert.match(markup, new RegExp('<button[^>]*id="' + tab + '"[^>]*role="tab"[^>]*aria-controls="' + panel + '"'), tab + ' controls its match panel');
  assert.match(markup, new RegExp('<(?:section|div)[^>]*id="' + panel + '"[^>]*role="tabpanel"[^>]*aria-labelledby="' + tab + '"'), panel + ' is named by its tab');
}

// Exercise the real report-tab factory with a small DOM fixture, without booting or changing a match.
const productSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/product-ui.js'), 'utf8');
const tabFactory = productSource.slice(productSource.indexOf('  function tabs('), productSource.indexOf('  function hasKeeperMetrics('));
function namedNode() {
  return { children: [], attrs: {}, appendChild(child) { this.children.push(child); }, setAttribute(key, value) { this.attrs[key] = value; }, addEventListener(key, listener) { this.listeners ||= {}; this.listeners[key] = listener; } };
}
const tabContext = { root: { document: {} }, node: namedNode, button(title, action) { const out = namedNode(); out.textContent = title; out.click = action; return out; } };
require('node:vm').createContext(tabContext);
require('node:vm').runInContext(tabFactory, tabContext);
const reportHost = namedNode();
tabContext.tabs(reportHost, [{ key: 'overview', title: 'Overview', render() {} }, { key: 'players', title: 'Players', render() {} }]);
const reportBar = reportHost.children[0], reportPanels = reportHost.children.slice(1);
reportBar.children.forEach((tab, index) => {
  assert.ok(tab.id, 'report tab has an identity for accessible naming');
  assert.equal(tab.attrs['aria-controls'], reportPanels[index].id, 'report tab controls its own panel');
  assert.equal(reportPanels[index].attrs['aria-labelledby'], tab.id, 'report panel is named by its own tab');
});
assert.equal(new Set(reportBar.children.map(tab => tab.id)).size, 2, 'report tab names are distinct');
reportBar.children[1].click();
assert.equal(reportPanels[0].hidden, true);
assert.equal(reportPanels[1].hidden, false);
assert.equal(reportBar.children[1].attrs['aria-selected'], 'true', 'accessible relationships survive tab selection');

// The real report timeline uses the same wording and preserves its existing highlight filter.
const reportFactory = productSource.slice(productSource.indexOf('  function reportEvents('), productSource.indexOf('  function reportPlayers('));
const reportContext = { TF, node(tag, cls, value) { const out = element(tag); out.className = cls; if (value != null) out.textContent = value; return out; }, clear(out) { out.children = []; }, labelText(key) { return key.replace(/^./, c => c.toUpperCase()); } };
require('node:vm').createContext(reportContext);
require('node:vm').runInContext(reportFactory, reportContext);
const record = { events: [
  { type: 'restart-ready', restartType: 'goal-kick', takerId: 'scorer', playerName: 'Forward', minute: '46', category: 'football' },
  { type: 'restart-taken', restartType: 'goal-kick', takerId: 'scorer', playerName: 'Forward', minute: '46', category: 'football' },
  { type: 'restart-taken', restartType: 'dropped-ball', minute: '47', category: 'football' }
] }, recordBytes = JSON.stringify(record), reportTimeline = element();
reportContext.reportEvents(reportTimeline, record, 'scorer');
const reportFilter = reportTimeline.children[0].children[0], reportList = reportTimeline.children[1];
assert.equal(reportList.children[0].textContent, 'No events in this view.', 'restart preparation does not inflate report highlights');
reportFilter.value = 'All football events'; reportFilter.listeners.change();
assert.deepEqual(reportList.children.map(row => row.children[1].textContent), ['Goal kick ready · Forward', 'Goal kick taken · Forward'], 'player timeline associates both truthful restart stages with the designated taker');
const fullTimeline = element(); reportContext.reportEvents(fullTimeline, record);
const fullFilter = fullTimeline.children[0].children[0]; fullFilter.value = 'All football events'; fullFilter.listeners.change();
assert.equal(fullTimeline.children[1].children[2].children[1].textContent, 'Ball dropped');
assert.equal(JSON.stringify(record), recordBytes, 'presentation does not rewrite exported event data');

// Summarize real validator notes by user impact without suppressing their original evidence.
require('../src/product-data.js');
const pack = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '../agents/v1/examples/two-team-pack.json'), 'utf8'));
const validated = TF.productData.validatePack(pack);
assert.equal(validated.ok, true);
assert.ok(validated.warnings.length > 100);
assert.ok(validated.warnings.every(warning => warning.code === 'EXPERIMENTAL_ATTRIBUTE'));
const notesFactory = productSource.slice(productSource.indexOf('  function packNotesText('), productSource.indexOf('  function notify('));
require('node:vm').runInContext(notesFactory, reportContext);
const originalWarnings = JSON.stringify(validated.warnings);
const summary = reportContext.packNotesText(validated.warnings);
assert.match(summary, /ratings.*outside.*range/i, 'allowed extreme values are explained as rating ranges without claiming unused values affect match results');
assert.doesNotMatch(summary, /\d+|still be imported|active/i, 'the banner does not alarm with repeated counts or claim unused attributes affect play');
assert.ok(summary.length < 150, 'hundreds of same-category notes produce one short explanation');
assert.equal(JSON.stringify(validated.warnings), originalWarnings, 'full notes and their paths remain available for the pack report');
const missingRatings = JSON.parse(JSON.stringify(pack));
delete missingRatings.teams[0].players[0].attributes.shortPassing;
const withDefaults = TF.productData.validatePack(missingRatings);
assert.equal(withDefaults.ok, true);
assert.ok(withDefaults.warnings.some(warning => warning.code === 'ROLE_DEFAULTS_APPLIED'));
assert.match(reportContext.packNotesText(withDefaults.warnings), /position defaults/, 'actual fallback ratings are not described as ignored input');
const invalidPack = JSON.parse(JSON.stringify(pack));
invalidPack.teams[0].players[0].attributes.shortPassing = 101;
assert.equal(TF.productData.validatePack(invalidPack).ok, false, 'presentation summaries do not weaken invalid-rating rejection');
process.stdout.write('public UI feed counts meaningful events once across append and compaction\n');

// A real watch adapter must synchronize a restored stopped clock with its newly created runner.
let restoredPaused = false;
const restoredCore = { setSpeed() {}, isPaused() { return restoredPaused; }, pause() { restoredPaused = true; }, resume() { restoredPaused = false; }, advance() { return { alpha: 0, droppedSeconds: 0 }; } };
match.clock.running = false;
match.pause = function () { this.clock.running = false; };
const restoredHandle = { match, core: restoredCore, config: {}, status: 'running' };
const restoredFootball = JSON.stringify({ clock: match.clock, score: match.score, events: match.events });
TF.ui.watch(restoredHandle);
assert.equal(restoredCore.isPaused(), true, 'a stopped restored clock does not return with a live runner');
assert.equal(elements.playButton.textContent, 'Play', 'restored paused match offers a working resume control immediately');
assert.equal(JSON.stringify({ clock: match.clock, score: match.score, events: match.events }), restoredFootball, 'transport synchronization preserves saved football state');
elements.playButton.listeners.click.call(elements.playButton);
assert.equal(restoredCore.isPaused(), false);
assert.equal(match.clock.running, true, 'resume starts both runner and saved clock');
elements.playButton.listeners.click.call(elements.playButton);
assert.equal(restoredCore.isPaused(), true);
assert.equal(match.clock.running, false, 'pause stops both transport components');
// Both worker and main-thread cancellation return through the same UI finish adapter.
TF.product = { finishMatch() { restoredCore.resume(); match.clock.running = true; return Promise.resolve({ status: 'cancelled', complete: false }); } };
const beforeCancelledEvents = JSON.stringify(match.events);
TF.ui.finish().then(result => {
  assert.equal(result.status, 'cancelled');
  assert.equal(restoredCore.isPaused(), true, 'cancelled fast finish returns a stopped runner');
  assert.equal(match.clock.running, false, 'cancelled fast finish stops the clock before another save or Continue');
  assert.equal(JSON.stringify(match.events), beforeCancelledEvents, 'transport cancellation does not invent football events');
}).catch(error => { console.error(error); process.exitCode = 1; });
