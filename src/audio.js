(function (root) {
  "use strict";
  var TF = root.TF = root.TF || {};
  var context = null, enabled = false, master = null, ambience = null, crowdGain = null, presentationRng = null;
  function ensureContext() {
    if (context) return context;
    var Audio = root.AudioContext || root.webkitAudioContext;
    if (!Audio) return null;
    context = new Audio(); master = context.createGain(); master.gain.value = enabled ? 0.65 : 0; master.connect(context.destination);
    return context;
  }
  function tone(freq, duration, wave, volume, endFreq) {
    var c = ensureContext(); if (!c || !enabled) return;
    var osc = c.createOscillator(), gain = c.createGain(), now = c.currentTime;
    osc.type = wave || "sine"; osc.frequency.setValueAtTime(freq, now);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(25, endFreq), now + duration);
    gain.gain.setValueAtTime(Math.max(0.001, volume || 0.1), now); gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain); gain.connect(master); osc.start(now); osc.stop(now + duration + 0.02);
  }
  function noise(duration, volume, filterType, frequency) {
    var c = ensureContext(); if (!c || !enabled) return;
    var size = Math.max(1, Math.floor(c.sampleRate * duration)), buffer = c.createBuffer(1, size, c.sampleRate), data = buffer.getChannelData(0);
    for (var i = 0; i < size; i += 1) data[i] = (presentationRng ? presentationRng.next() : Math.random()) * 2 - 1;
    var source = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain(), now = c.currentTime;
    source.buffer = buffer; filter.type = filterType || "lowpass"; filter.frequency.value = frequency || 1800;
    gain.gain.setValueAtTime(volume || 0.12, now); gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter); filter.connect(gain); gain.connect(master); source.start(now); source.stop(now + duration);
  }
  function setAmbience(on) {
    var c = ensureContext(); if (!c || !enabled) return;
    if (on && !ambience) {
      var osc = c.createOscillator(), filter = c.createBiquadFilter(), gain = c.createGain();
      osc.type = "triangle"; osc.frequency.value = 57; filter.type = "lowpass"; filter.frequency.value = 115;
      gain.gain.value = 0; osc.connect(filter); filter.connect(gain); gain.connect(master); osc.start(); ambience = osc; crowdGain = gain;
    }
    if (crowdGain) crowdGain.gain.setTargetAtTime(on ? 0.035 : 0, c.currentTime, 0.5);
  }
  function play(type, match) {
    if (!enabled) return;
    if (type === "kick" || type === "ball-played") { tone(155, 0.065, "triangle", 0.16, 58); noise(0.035, 0.06, "highpass", 2400); }
    else if (type === "whistle" || type === "half-time" || type === "full-time") { tone(1650, 0.62, "sine", 0.15, 1320); tone(1840, 0.54, "sine", 0.11, 1480); }
    else if (type === "goal") { tone(68, 0.7, "sawtooth", 0.22, 33); noise(0.12, 0.18, "lowpass", 720); crowdReaction(0.42); }
    else if (type === "post") { tone(980, 0.24, "triangle", 0.2, 220); }
    else if (type === "save") { tone(360, 0.13, "triangle", 0.09, 120); }
    else if (/card|offside|foul/.test(type)) { tone(1200, 0.3, "sine", 0.08, 850); }
    if (match && match.seed != null && !presentationRng) presentationRng = new TF.RNG(String(match.seed) + ":presentation-audio");
  }
  function crowdReaction(strength) { if (!enabled) return; noise(0.85, strength || 0.2, "lowpass", 650); }
  TF.audio = {
    toggle: function (force) {
      enabled = force == null ? !enabled : !!force;
      var c = ensureContext();
      if (c && c.state === "suspended" && enabled && c.resume) c.resume();
      if (master && c) master.gain.setTargetAtTime(enabled ? 0.65 : 0, c.currentTime, 0.04);
      if (!enabled && crowdGain && c) crowdGain.gain.setTargetAtTime(0, c.currentTime, 0.04);
      else if (enabled) setAmbience(true);
      return enabled;
    },
    play: play,
    crowd: crowdReaction,
    isEnabled: function () { return enabled; },
    attach: function (match) { presentationRng = new TF.RNG(String(match && match.seed || 1) + ":presentation-audio"); setAmbience(true); }
  };
})(typeof window !== "undefined" ? window : globalThis);
