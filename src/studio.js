(function (root) {
  "use strict";
  var TF = root.TF = root.TF || {};
  var rng = null, timers = [], eventCursor = TF.createEventCursor ? TF.createEventCursor() : null, eventNonce = 0, activeMatch = null;
  function clearTimers() { timers.forEach(function (id) { root.clearTimeout(id); }); timers = []; }
  function mount(match) {
    if (!root.document || !match) return;
    activeMatch = match; clearTimers(); if (eventCursor) eventCursor.reset(); eventNonce = 0;
    rng = new TF.RNG(String(match.seed) + ":presentation-studio");
    var wrap = root.document.querySelector(".canvas-wrap"); if (!wrap) return;
    var intro = root.document.getElementById("studioIntro");
    if (!intro) { intro = root.document.createElement("div"); intro.id = "studioIntro"; intro.className = "studio-intro"; wrap.appendChild(intro); }
    var home = match.teams[0], away = match.teams[1];
    function teamCard(team, side) {
      return '<section class="studio-team-card ' + side + '"><span>' + side.toUpperCase() + '</span><strong>' + esc(team.name) + '</strong><b>' + esc(team.formation) + '</b></section>';
    }
    intro.innerHTML = '<div class="studio-kicker">MATCHDAY</div><div class="studio-cards">' + teamCard(home, "home") + '<div class="studio-versus">VS</div>' + teamCard(away, "away") + '</div><div class="studio-lineup">90 minutes · 11 a side</div><div class="studio-start">KICK OFF</div>';
    intro.hidden = false; intro.classList.remove("leaving");
    timers.push(root.setTimeout(function () { intro.classList.add("leaving"); }, 2700));
    timers.push(root.setTimeout(function () { intro.hidden = true; }, 3300));
    var overlay = root.document.getElementById("eventOverlay");
    if (!overlay) { overlay = root.document.createElement("div"); overlay.id = "eventOverlay"; overlay.className = "event-overlay"; overlay.hidden = true; wrap.appendChild(overlay); }
    overlay.hidden = true;
    if (TF.audio && TF.audio.attach) TF.audio.attach(match);
    return { rng: rng };
  }
  function esc(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function restartText(event) {
    if (!event || (event.type !== "restart-ready" && event.type !== "restart-taken")) return null;
    if (event.type === "restart-taken" && event.restartType === "dropped-ball") return "Ball dropped";
    var names = { "kickoff": "Kick-off", "goal-kick": "Goal kick", "corner": "Corner", "throw-in": "Throw-in", "direct-free-kick": "Free kick", "indirect-free-kick": "Indirect free kick", "free-kick": "Free kick", "penalty": "Penalty", "dropped-ball": "Dropped ball" };
    return (names[event.restartType] || "Restart") + (event.type === "restart-ready" ? " ready" : " taken");
  }
  function describe(event, match) {
    var playerId = event.type === "goal" ? event.scorerId : event.playerId, player = playerId && match.playersById[playerId], team = event.teamId && match.teams.find(function (t) { return t.id === event.teamId; });
    if (event.type === "goal") return { title: "GOAL", detail: [player ? player.name : '',team ? team.name : ''].filter(Boolean).join(' · '), tone: "goal", players: player ? [{player:player,label:player.number ? '#'+player.number : 'Scorer'}] : [] };
    if (event.type === "yellow-card" || event.type === "red-card" || event.type === "card") return { title: event.card === "red" || event.type === "red-card" ? "RED CARD" : "YELLOW CARD", detail: player ? player.name : team && team.name, tone: "card" };
    if (event.type === "substitution") { var incoming = match.playersById[event.playerOnId], outgoing = match.playersById[event.playerOffId]; return { title: "SUBSTITUTION", detail: (incoming ? incoming.name : "Player on") + " ↔ " + (outgoing ? outgoing.name : "Player off"), tone: "sub", players: [{player:incoming,label:'ON'},{player:outgoing,label:'OFF'}].filter(function(entry){return !!entry.player;}) }; }
    if (event.type === "offside") return { title: "OFFSIDE", detail: player ? player.name : team && team.name, tone: "offside" };
    if (event.type === "added-time" || event.type === "addedTime") return { title: "ADDED TIME", detail: "+" + (event.minutes || event.seconds || "1") + (event.minutes ? " min" : "′"), tone: "time" };
    if (event.type === "half-time" || event.type === "full-time") return { title: event.type === "half-time" ? "HALF-TIME" : "FULL-TIME", detail: match.teams[0].name + "  " + match.score.home + " — " + match.score.away + "  " + match.teams[1].name, tone: "whistle" };
    if (event.type === "second-half") return { title: "SECOND HALF", detail: "Back under way", tone: "whistle" };
    return null;
  }
  function update(match) {
    if (!match || match !== activeMatch || !root.document) return;
    var events = match.events || [], overlay = root.document.getElementById("eventOverlay"); if (!overlay) return;
    var fresh = eventCursor ? eventCursor.read(events) : [];
    for (var eventIndex = 0; eventIndex < fresh.length; eventIndex += 1) {
      var ev = fresh[eventIndex];
      var content = describe(ev, match);
      if (TF.audio && TF.audio.play && ["ball-played", "goal", "save", "keeper-punch", "half-time", "full-time", "second-half", "offside", "card", "foul", "substitution"].indexOf(ev.type) >= 0) TF.audio.play(ev.type, match);
      if (!content) continue;
      overlay.className = "event-overlay " + content.tone; overlay.innerHTML = '<b>' + esc(content.title) + '</b><span>' + esc(content.detail || "") + '</span>'; overlay.hidden = false;
      if (content.players && content.players.length) {
        var faces=root.document.createElement('div');faces.className='event-portraits';
        content.players.forEach(function(entry){var team=match.teams.find(function(t){return t.id===entry.player.teamId;}),img,figure=root.document.createElement('figure');
          if(TF.productUI&&TF.productUI.portrait)img=TF.productUI.portrait(entry.player,team);
          else if(TF.appearance&&TF.appearance.portrait){img=root.document.createElement('img');img.className='player-portrait';img.alt='';img.src=TF.appearance.portrait(entry.player,team);}
          if(!img)return;figure.appendChild(img);var caption=root.document.createElement('figcaption');caption.textContent=entry.label;figure.appendChild(caption);faces.appendChild(figure);
        });if(faces.children.length)overlay.appendChild(faces);
      }
      var rngValue = rng ? rng.next() : 0.5; overlay.style.setProperty("--event-drift", (rngValue * 16 - 8).toFixed(1) + "px");
      (function (node, nonce) { timers.push(root.setTimeout(function () { if (eventNonce === nonce) node.hidden = true; }, ev.type === "goal" ? 2600 : 1900)); })(overlay, ++eventNonce);
    }
  }
  function restoreMatchEvents(match) { if (match && match === activeMatch && eventCursor) eventCursor.skipToEnd(match.events || []); }
  TF.studio = { mount: mount, update: update, restoreMatchEvents: restoreMatchEvents, get rng() { return rng; }, eventLabel: describe, restartText: restartText };
})(typeof window !== "undefined" ? window : globalThis);
