const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
const TF = globalThis.TF;
const match = TF.createMatch({ seed: 9882, halfSeconds: 2700, matchId: 'period-event-time' });

match.clock.period = 1;
match.clock.periodSeconds = 47 * 60;
match.clock.elapsedSeconds = 47 * 60;
const firstHalfAdded = TF.appendEvent(match, { type: 'added-time-event', tick: 11, time: match.clock.elapsedSeconds });
assert.equal(firstHalfAdded.period, 1);
assert.equal(firstHalfAdded.periodSeconds, 47 * 60);
assert.equal(TF.formatMatchMinute(firstHalfAdded.period, firstHalfAdded.periodSeconds), '45+2');

match.clock.period = 2;
match.clock.periodSeconds = 60;
match.clock.elapsedSeconds = 46 * 60 + 60;
const secondHalfFirstMinute = TF.appendEvent(match, { type: 'second-half-event', tick: 12, time: match.clock.elapsedSeconds });
assert.equal(secondHalfFirstMinute.period, 2);
assert.equal(secondHalfFirstMinute.periodSeconds, 60);
assert.equal(TF.formatMatchMinute(secondHalfFirstMinute.period, secondHalfFirstMinute.periodSeconds), '46');
assert.notEqual(Math.floor(secondHalfFirstMinute.time / 60), Number(TF.formatMatchMinute(secondHalfFirstMinute.period, secondHalfFirstMinute.periodSeconds)), 'rendered event time uses its period clock, not cumulative elapsed time');

match.clock.periodSeconds = 47 * 60;
const secondHalfAdded = TF.appendEvent(match, { type: 'late-event', tick: 13, time: match.clock.elapsedSeconds });
assert.equal(TF.formatMatchMinute(secondHalfAdded.period, secondHalfAdded.periodSeconds), '90+2');

const twin = TF.createMatch({ seed: 9882, halfSeconds: 2700, matchId: 'period-event-time' });
twin.clock.period = 2; twin.clock.periodSeconds = 60; twin.clock.elapsedSeconds = 46 * 60 + 60;
const twinEvent = TF.appendEvent(twin, { type: 'second-half-event', tick: 12, time: twin.clock.elapsedSeconds });
assert.deepEqual({ period: secondHalfFirstMinute.period, periodSeconds: secondHalfFirstMinute.periodSeconds, sequence: secondHalfFirstMinute.sequence }, { period: twinEvent.period, periodSeconds: twinEvent.periodSeconds, sequence: twinEvent.sequence });

process.stdout.write('match/event clocks remain period-relative through added time and second-half kickoff\n');
