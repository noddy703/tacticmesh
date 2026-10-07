(function (root) {
  "use strict";
  var TF = root.TF = root.TF || {};
  var formations = ["4-3-3", "4-2-3-1", "4-4-2", "3-4-2-1", "3-5-2"];
  var kits = {
    red: { primary: "#cf3d48", secondary: "#f5f0df" }, green: { primary: "#337b56", secondary: "#f0d77d" }, gold: { primary: "#d0a83e", secondary: "#273b43" },
    blue: { primary: "#315aa6", secondary: "#f3cf50" }, black: { primary: "#303a3c", secondary: "#e89a58" }, white: { primary: "#ddd9ca", secondary: "#4b688e" }
  };
  function $(id) { return root.document.getElementById(id); }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function pad(value) { return String(value).padStart(2, "0"); }
  function clockText(match) { var c=match.clock||{}, period=c.period||1, ks=match.state.knockoutState||{}, shootout=ks.phase==='penalties'||ks.phase==='complete'; var minute=period>=3?String(90+(period===4?15:0)+Math.floor((c.periodSeconds||0)/60)):(TF.formatMatchMinute?TF.formatMatchMinute(period,c.periodSeconds):String(Math.floor((c.elapsedSeconds||0)/60))); return shootout?'PEN <i>SHOOTOUT</i>':minute+"′ <i>"+({1:'1ST',2:'2ND',3:'ET 1',4:'ET 2'}[period]||'MATCH')+'</i>'; }
  var restoreFeedForMatch = null;
  function startUI() {
    if (!$('pitchCanvas') || !TF.createMatch || !TF.createCore || !TF.createRenderer) return;
    ["homeFormation", "awayFormation"].forEach(function (id) { $(id).innerHTML = formations.map(function (f) { return '<option value="' + f + '">' + f + '</option>'; }).join(""); });
    $("awayFormation").value = "4-2-3-1";
    var canvas = $("pitchCanvas"), renderer = TF.createRenderer(canvas, { quality: "normal" });
    var match = null, core = null, raf = 0, lastFrame = 0, selected = null, feedCursor = TF.createEventCursor ? TF.createEventCursor() : null, eventTotal = 0, toastTimer = 0, toastNonce = 0, autoHalfTimer = 0, lastMatchOpts = null, pausedForHidden = false, wasRunningBeforeHidden = false, activeHandle = null, lastSavedAt = 0, fastFinishing = false;
    function setStatus(text) { $("statusText").textContent = text; $("app").classList.toggle("match-paused", text === "PAUSED" || text === "HALF-TIME" || text === "FULL-TIME"); }
    function populatePlayerSelector() {
      var select = $("playerProfileSelect"); if (!select) return;
      select.innerHTML = '';
      var prompt = root.document.createElement('option'); prompt.value = ''; prompt.textContent = 'Choose a player'; prompt.disabled = true; select.appendChild(prompt);
      var players = match.players || Object.keys(match.playersById).map(function (id) { return match.playersById[id]; });
      match.teams.forEach(function (team) {
        players.filter(function (player) { return player.teamId === team.id; }).sort(function (a, b) { return a.number - b.number; }).forEach(function (player) {
          var option = root.document.createElement('option'); option.value = player.id; option.textContent = team.name + ' · #' + player.number + ' ' + player.name; select.appendChild(option);
        });
      });
      select.value = '';
    }
    function debugOptions() {
      var options = { pressure: false, control: false, passLanes: false, offside: false, anchors: false, perceptionPaths: false, perceptionCone: false, intent: false, candidates: false };
      root.document.querySelectorAll('[data-debug]').forEach(function (input) {
        if (!input.checked) return;
        if (input.dataset.debug === "movement") { options.anchors = true; options.intent = true; }
        else if (input.dataset.debug === "beliefs") { options.perceptionPaths = true; options.perceptionCone = true; }
        else if (input.dataset.debug === "candidate") { options.candidates = true; options.passLanes = true; }
        else if (Object.prototype.hasOwnProperty.call(options, input.dataset.debug)) options[input.dataset.debug] = true;
      });
      return options;
    }
    function makeMatch(options) {
      options = options || lastMatchOpts || {};
      clearTimeout(autoHalfTimer); $("breakCard").hidden = true; $("fullTimePanel").hidden = true;
      activeHandle = options.handle || (TF.product && TF.product.isReady ? TF.product.startMatch(options) : null);
      match = activeHandle ? activeHandle.match : TF.createMatch({ seed: options.seed, home: { name: options.home, formation: options.homeFormation, colors: options.homeColors }, away: { name: options.away, formation: options.awayFormation, colors: options.awayColors }, autoStart: true });
      core = activeHandle && activeHandle.core || TF.createCore({ match: match, speed: Number($("speedSelect").value) || 1, maxFrameSeconds: .25, maxStepsPerFrame: 15 });
      core.setSpeed(Number($("speedSelect").value) || 1);
      // Restored clocks retain their stopped state; align the transport before the first frame.
      if (options.handle && match.clock && match.clock.running === false) core.pause();
      lastSavedAt = 0; fastFinishing = false;
      if (activeHandle && TF.product) { TF.product.activeMatch = activeHandle; TF.product.saveMatch(activeHandle).catch(function (error) { if ($("productNotice")) { $("productNotice").textContent = error.message; $("productNotice").hidden = false; } }); }
      if (TF.replay && TF.replay.reset) TF.replay.reset();
      if (TF.replay && TF.replay.bindCore) TF.replay.bindCore(core);
      if (TF.studio && TF.studio.mount) TF.studio.mount(match);
      selected = null; if (feedCursor) feedCursor.reset(); eventTotal = 0; clearTimeout(toastTimer); toastNonce += 1; renderer.setSelected(null); $("inspector").innerHTML = '<div class="section-head"><span>PLAYER PROFILE</span><span class="report-num">—</span></div><div class="empty-inspector"><span class="profile-placeholder" aria-hidden="true">11</span><span>Select a player<br>View ratings &amp; match stats</span></div>';
      populatePlayerSelector();
      $("eventList").innerHTML = '<li class="feed-empty">Kick-off</li>';
      $("eventCount").textContent = "0"; $("setupPanel").hidden = true; $("matchPanel").hidden = false;if($("cupSetupPanel"))$("cupSetupPanel").hidden=true; $("app").classList.add("is-match"); if($("viewMatchReportButton"))$("viewMatchReportButton").disabled=true; if(TF.productUI&&TF.productUI.setMatchTab)TF.productUI.setMatchTab("match"); $("playButton").textContent = core.isPaused() ? "Play" : "Pause"; $("playButton").setAttribute("aria-label", core.isPaused() ? "Resume match" : "Pause match");
      $("matchMeta").textContent = match.teams[0].formation + " · " + match.teams[1].formation + " · 90 minutes";
      $("canvasHint").textContent = "Select a player";
      match.captureSnapshot(); renderer.resize(); renderer.capture(match); renderer.render(match, 0);
      lastFrame = 0; if (!raf) raf = root.requestAnimationFrame(frame); setStatus(core.isPaused() ? "PAUSED" : "LIVE"); return activeHandle || { match: match, core: core };
    }
    function setupMatch(newSeed) {
      var seed = newSeed == null ? Number($("seedInput").value) : newSeed;
      if (!isFinite(seed)) seed = 2026;
      $("seedInput").value = seed;
      lastMatchOpts = { seed: seed, homeLineup:TF.productUI&&TF.productUI.matchLineup?TF.productUI.matchLineup("home"):undefined,awayLineup:TF.productUI&&TF.productUI.matchLineup?TF.productUI.matchLineup("away"):undefined, homeId: $("homeTeamSelect") && $("homeTeamSelect").value, awayId: $("awayTeamSelect") && $("awayTeamSelect").value, homeTacticalPreset: $("homeTacticalPreset") && $("homeTacticalPreset").value || undefined, awayTacticalPreset: $("awayTacticalPreset") && $("awayTacticalPreset").value || undefined, home: $("homeName").value.trim() || "Home XI", away: $("awayName").value.trim() || "Away XI", homeFormation: $("homeFormation").value, awayFormation: $("awayFormation").value, homeColors: kits[$("homeKit").value], awayColors: kits[$("awayKit").value] };
      try { return makeMatch(lastMatchOpts); } catch (error) { if ($("productNotice")) { $("productNotice").textContent = error.message; $("productNotice").hidden = false; } }
    }
    function statsText() {
      var summary = TF.telemetry && TF.telemetry.summary ? TF.telemetry.summary(match) : null;
      var records = summary && summary.teams || {}, home = records[match.teams[0].id] || {}, away = records[match.teams[1].id] || {};
      var goals = (match.telemetry.goals || []).length, shots = (home.shots || 0) + (away.shots || 0) || match.telemetry.shots || 0;
      var passes = (home.passes || 0) + (away.passes || 0) || match.telemetry.passes || 0;
      return "Goals " + goals + " · Shots " + shots + " · Passes " + passes + " · Possession " + possessionText();
    }
    function possessionText() {
      var counts = match.telemetry.possessionSeconds || match.telemetry.possession || {};
      var summary = TF.telemetry && TF.telemetry.summary ? TF.telemetry.summary(match) : null;
      var teamRecords = summary && summary.teams || {};
      var home = teamRecords[match.teams[0].id] || {}, away = teamRecords[match.teams[1].id] || {};
      var h = Number(home.possessionSeconds || counts.home || counts[match.teams[0].id] || 0), a = Number(away.possessionSeconds || counts.away || counts[match.teams[1].id] || 0);
      if (!(h + a)) return "—";
      return Math.round(100 * h / (h + a)) + "% / " + Math.round(100 * a / (h + a)) + "%";
    }
    function continueHalf() { if (!match || !match.state.halfTime) return; clearTimeout(autoHalfTimer); $("breakCard").hidden = true; if (activeHandle && TF.engine && TF.engine.continueAfterHalfTime) TF.engine.continueAfterHalfTime(activeHandle); else match.startSecondHalf(); core.resume(); match.clock.running = true; setStatus("LIVE"); }
    function halftime() {
      core.pause(); match.pause(); $("breakCard").hidden = false; $("breakEyebrow").textContent = (match.clock.period >= 3 ? "EXTRA-TIME BREAK · " : "HALF-TIME · ") + match.teams[0].name + " " + match.score.home + " — " + match.score.away + " " + match.teams[1].name; $("breakScore").textContent = match.score.home + " — " + match.score.away; $("breakStats").textContent = statsText(); $("breakCountdown").textContent = "Second half begins in 4 seconds"; setStatus("HALF-TIME");
      var nextPeriod = match.clock.period >= 3 ? "Extra time resumes" : "Second half begins"; $("continueButton").firstChild.textContent = match.clock.period >= 3 ? "Continue extra time " : "Second half "; var seconds = 4; (function tick() { if (!match || !match.state.halfTime || $("breakCard").hidden) return; seconds -= 1; if (seconds <= 0) { continueHalf(); return; } $("breakCountdown").textContent = nextPeriod + " in " + seconds + " seconds"; autoHalfTimer = root.setTimeout(tick, 1000); })();
    }
    function fulltime(skipSave) {
      core.pause(); match.pause(); $("breakCard").hidden = true; var shootout=match.state.knockoutState, winner=shootout&&shootout.phase==="complete"?match.teams[shootout.winnerSide==="home"?0:1]:match.score.home===match.score.away?null:match.teams[match.score.home>match.score.away?0:1];var outcome=winner?winner.name+" win." : "Match drawn.";if(shootout&&shootout.phase==="complete")outcome+=" Penalties "+shootout.scores.home+" — "+shootout.scores.away+".";
      $("fullTimeHeadline").textContent = match.score.home + " — " + match.score.away; $("fullTimeDetail").textContent = match.teams[0].name + " vs " + match.teams[1].name + " · " + outcome + " " + statsText(); $("fullTimePanel").hidden = false; setStatus("FULL-TIME"); if (activeHandle && TF.product && !fastFinishing && !skipSave) TF.product.completeMatch(activeHandle).then(function(record){ if(TF.productUI&&TF.productUI.matchCompleted)TF.productUI.matchCompleted(record,activeHandle); }).catch(function (error) { if ($("productNotice")) { $("productNotice").textContent = error.message; $("productNotice").hidden = false; } });
    }
    function feedNarrative(ev) {
      var type = ev.type || "", player = function (id) { return id && match.playersById[id]; }, team = function (id) { return match.teams.find(function (t) { return t.id === id; }); };
      var actor, side;
      if (type === "goal") { actor = player(ev.scorerId); side = team(ev.teamId); return { text: "GOAL · " + (actor ? actor.name : side && side.name || "Goal"), goal: true }; }
      if (type === "shot") { actor = player(ev.playerId); return { text: "Shot · " + (actor ? actor.name : "attempt") }; }
      if (type === "save" || type === "keeper-punch") { actor = player(ev.keeperId); return { text: (type === "save" ? "Keeper contact" : "Keeper parry") + " · " + (actor ? actor.name : "goalkeeper") }; }
      if (type === "tackle" && ev.success) { actor = player(ev.defenderId); return { text: ev.possessionWon === true ? "Tackle won · " + (actor ? actor.name : "defender") : "Poked loose · " + (actor ? actor.name : "defender") }; }
      if (type === "foul") { actor = player(ev.offenderId); return { text: "Foul · " + (actor ? actor.name : "play stopped") + (ev.card ? " · " + ev.card + " card" : "") }; }
      if (type === "offside") { actor = player(ev.playerId); return { text: "Offside · " + (actor ? actor.name : "attacker") }; }
      if (type === "card") { actor = player(ev.playerId); return { text: (ev.card === "red" ? "Red card" : "Yellow card") + " · " + (actor ? actor.name : "player") }; }
      if (type === "substitution" || type === "substitute-entered") { actor = player(ev.playerOnId); var outgoing = player(ev.playerOffId); return { text: "Substitution · " + (actor ? actor.name : "player on") + (outgoing ? " for " + outgoing.name : "") }; }
      if ((type === "restart-ready" || type === "restart-taken") && TF.studio && TF.studio.restartText) { actor = player(ev.takerId); return { text: TF.studio.restartText(ev) + (actor ? " · " + actor.name : "") }; }
      if (type === "restart-awarded" && ["penalty", "corner", "free-kick", "direct-free-kick", "indirect-free-kick"].indexOf(ev.restartType) >= 0) return { text: (ev.restartType === "penalty" ? "Penalty" : ev.restartType === "corner" ? "Corner" : "Free kick") + " awarded" };
      if (type === "goalkeeper-eight-second") return { text: "Goalkeeper held the ball too long · corner" };
      if (type === "goalkeeper-backpass-handball" || type === "goalkeeper-second-handling") return { text: "Indirect free kick · goalkeeper handling" };
      if (type === "half-time") return { text: "Half-time whistle" };
      if (type === "second-half") return { text: "Second half begins" };
      if (type === "full-time") return { text: "Full-time whistle" };
      if (type === "match-abandoned") return { text: "Match abandoned" };
      return null;
    }
    function renderFeed(silent) {
      var events = match.events || [], list = $("eventList"), fresh = feedCursor ? feedCursor.read(events) : [];
      for (var eventIndex = 0; eventIndex < fresh.length; eventIndex += 1) {
        var ev = fresh[eventIndex], note = feedNarrative(ev); if (!note) continue;
        var time = Number.isFinite(Number(ev.periodSeconds)) && TF.formatMatchMinute ? TF.formatMatchMinute(ev.period || 1, ev.periodSeconds) : Math.floor((ev.time || match.clock.elapsedSeconds) / 60);
        var li = root.document.createElement("li"); li.innerHTML = "<b>" + time + "′</b> " + escapeHtml(note.text); list.appendChild(li); eventTotal += 1;
        while (list.children.length > 60) list.removeChild(list.firstChild);
        if (note.goal && !silent) { var toast = $("eventToast"), nonce = ++toastNonce; clearTimeout(toastTimer); toast.textContent = note.text; toast.classList.add("visible"); toastTimer = root.setTimeout(function () { if (toastNonce === nonce) toast.classList.remove("visible"); }, 2200); }
      }
      $("eventCount").textContent = String(eventTotal);
    }
    restoreFeedForMatch = function (restoredMatch) {
      if (!match || restoredMatch !== match) return;
      if (feedCursor) feedCursor.reset(); eventTotal = 0; clearTimeout(toastTimer); toastNonce += 1;
      $("eventList").innerHTML = ""; renderFeed(true);
    };
    var theatre=false,theatrePlayerId=null,theatreInert=[];
    function resizeView(){if(theatre){var bar=$('matchPanel').querySelector('.toolbar');$('matchPanel').style.setProperty('--theatre-controls-height',(bar?bar.getBoundingClientRect().height:160)+'px');}renderer.resize();if(match&&!(TF.replay&&TF.replay.playing))renderer.render(match,0);}
    function closeTheatrePlayer(clearSelection){$('theatrePlayerCard').hidden=true;theatrePlayerId=null;if(clearSelection){selected=null;renderer.setSelected(null);$('playerProfileSelect').value='';$('theatrePlayerSelect').value='';}canvas.focus();}
    function showTheatrePlayer(player){if(!theatre||!player)return;var card=$('theatrePlayerCard'),team=match.teams.find(function(t){return t.id===player.teamId;}),isNew=theatrePlayerId!==player.id||card.hidden;
      if(isNew){theatrePlayerId=player.id;var host=$('theatrePlayerIdentity');host.textContent='';var image=TF.productUI&&TF.productUI.portrait?TF.productUI.portrait(player,team):null;if(image)host.appendChild(image);var name=root.document.createElement('h2');name.id='theatrePlayerName';name.textContent=player.name;host.appendChild(name);var sub=root.document.createElement('p');sub.textContent=(team?team.name:player.teamId)+' · #'+player.number+' · '+(player.role||player.preferredRole||player.positionFamily);host.appendChild(sub);card.hidden=false;}
      var live=activeHandle&&TF.productUI&&TF.productUI.livePlayer?TF.productUI.livePlayer(activeHandle,player.id):null,stats=live&&live.stats||player.stats||{},minutes=live?live.minutes:match.clock.elapsedSeconds/60,rating=live&&live.rating&&live.rating.value;
      $('theatrePlayerMetrics').textContent=Math.round(minutes)+' min · '+(stats.goals||0)+' goals · '+(stats.assists||0)+' assists · '+(stats.shots||0)+' shots · '+(stats.passes||0)+' passes · '+(stats.tackles||0)+' tackles · Stamina '+Math.round((player.stamina==null?1:player.stamina)*100)+'% · Rating '+(rating==null?'available after 15 minutes':rating+' / 10');
      $('theatrePlayerSelect').value=player.id;if(isNew)$('closeTheatrePlayer').focus();
    }
    function setTheatre(on){if(!on&&root.document.fullscreenElement===$('matchPanel')&&root.document.exitFullscreen)root.document.exitFullscreen().catch(function(){});if(on&&!theatre){var branch=$('matchPanel');while(branch&&branch!==root.document.body){Array.from(branch.parentElement.children).forEach(function(sibling){if(sibling!==branch&&sibling.tagName!=='SCRIPT'&&sibling.tagName!=='STYLE'){theatreInert.push([sibling,sibling.inert]);sibling.inert=true;}});branch=branch.parentElement;}}else if(!on){theatreInert.forEach(function(pair){pair[0].inert=pair[1];});theatreInert=[];}theatre=!!on;$('matchPanel').classList.toggle('is-theatre',theatre);root.document.body.classList.toggle('theatre-open',theatre);$('theatreButton').textContent=theatre?'Exit Theatre':'Theatre';$('theatreButton').setAttribute('aria-pressed',String(theatre));$('theatrePlayerSelect').closest('label').hidden=!theatre;
      if(theatre){var select=$('theatrePlayerSelect');select.textContent='';var first=root.document.createElement('option');first.value='';first.textContent='Choose a player';select.appendChild(first);if(match)match.players.filter(function(p){return p.active!==false;}).forEach(function(p){var o=root.document.createElement('option');o.value=p.id;o.textContent='#'+p.number+' '+p.name;select.appendChild(o);});}else{$('theatrePlayerCard').hidden=true;theatrePlayerId=null;}root.requestAnimationFrame(resizeView);}
    function fullscreenState(){var active=root.document.fullscreenElement===$('matchPanel');$('fullscreenButton').setAttribute('aria-pressed',String(active));$('fullscreenButton').textContent=active?'Exit fullscreen':'Fullscreen';root.requestAnimationFrame(resizeView);}
    $('theatreButton').addEventListener('click',function(){setTheatre(!theatre);});$('closeTheatrePlayer').addEventListener('click',function(){closeTheatrePlayer(true);});$('theatrePlayerSelect').addEventListener('change',function(){if(match&&match.playersById[this.value])updateInspector(match.playersById[this.value]);else closeTheatrePlayer(true);});
    $('fullscreenButton').addEventListener('click',function(){var panel=$('matchPanel'),status=$('viewModeStatus');status.hidden=true;if(!theatre)setTheatre(true);Promise.resolve().then(function(){if(root.document.fullscreenElement===panel)return root.document.exitFullscreen();if(!panel.requestFullscreen)throw new Error('Fullscreen is unavailable in this browser.');return panel.requestFullscreen();}).catch(function(error){status.hidden=false;status.textContent=error.message==='Fullscreen is unavailable in this browser.'?error.message:'Fullscreen could not open here. Theatre is still available.';fullscreenState();});});root.document.addEventListener('fullscreenchange',fullscreenState);root.addEventListener('resize',function(){root.requestAnimationFrame(resizeView);});
    root.document.addEventListener('keydown',function(e){if(e.key!=='Escape'||!theatre)return;if(!$('theatrePlayerCard').hidden){e.preventDefault();closeTheatrePlayer(true);}else if(!root.document.fullscreenElement){setTheatre(false);$('theatreButton').focus();}});
    var lastInspectorTick=-1;
    function updateInspector(player) {
      lastInspectorTick=match.tick;var openSections=Array.from($("inspector").querySelectorAll?$("inspector").querySelectorAll("details[open]"):[]).map(function(d){var summary=d.querySelector("summary");return summary&&summary.textContent;});
      selected = player || null; renderer.setSelected(selected && selected.id);
      if ($("playerProfileSelect")) $("playerProfileSelect").value = selected ? selected.id : '';
      if (!player) return;
      showTheatrePlayer(player);
      var attrs = player.attributes || {}, stats = player.stats || {}, intent = player.intent || {}, belief = player.beliefState || {}, team = match.teams.find(function (t) { return t.id === player.teamId; });
      var debugMode = Array.prototype.some.call(root.document.querySelectorAll('[data-debug]'), function (input) { return input.checked; });
      var label = function (key) { return key.replace(/([A-Z])/g, " $1").replace(/^./, function (c) { return c.toUpperCase(); }); };
      var groups = {
        Physical: ["acceleration", "sprintSpeed", "agility", "turning", "balance", "strength", "stamina", "jumping", "reach", "recoverySpeed"],
        Technical: ["firstTouch", "shortPassing", "longPassing", "throughBalls", "crossing", "shooting", "finishing", "heading", "dribbling", "ballCarrying", "tackling", "interception", "weakFoot"],
        Mental: ["awareness", "vision", "anticipation", "decisionMaking", "composure", "positioning", "teamwork", "creativity", "concentration", "discipline", "aggression", "workRate", "offBallIntelligence"],
        Goalkeeping: ["handling", "reflexes", "catching", "parrying", "diving", "oneOnOne", "aerialCommand", "sweeping", "throwing", "kicking"]
      };
      var primary = ["sprintSpeed", "shortPassing", "firstTouch", "vision", "tackling", "finishing"];
      var report = '<div class="section-head"><span>PLAYER PROFILE</span><span class="report-num">#' + escapeHtml(player.number) + '</span></div><div class="player-card"><h3>' + escapeHtml(player.name) + '</h3><div class="player-sub">' + escapeHtml(team ? team.name : player.teamId) + ' · ' + escapeHtml(player.preferredRole || player.role)  + ' · ' + escapeHtml(player.preferredFoot || "right-footed") + ' foot · age ' + escapeHtml(player.age) + '</div><div class="metric-grid">' + primary.map(function (key) { return '<div class="metric"><b>' + (attrs[key] == null ? "—" : Math.round(attrs[key])) + '</b><span>' + escapeHtml(label(key)) + '</span></div>'; }).join("") + '</div>';
      var liveRecord=activeHandle&&TF.productUI&&TF.productUI.livePlayer?TF.productUI.livePlayer(activeHandle,player.id):null;if(liveRecord){stats=liveRecord.stats;stats.minutes=liveRecord.minutes;report+='<div class="details-block"><b>Match rating</b> · '+(liveRecord.rating.value==null?'Available after 15 minutes':escapeHtml(liveRecord.rating.value)+' / 10')+'</div>';}
      var traits = player.traits || {};
      report += '<div class="details-block"><b>Traits</b> · ' + (Object.keys(traits).length ? Object.keys(traits).map(function (key) { return escapeHtml(label(key)) + ' ' + Math.round(Number(traits[key]) * 100); }).join(' · ') : 'No standout traits') + '</div>';
      report += '<div class="details-block"><b>Stamina</b> · ' + Math.round((player.stamina == null ? 1 : player.stamina) * 100) + '%<br><b>Match</b> · ' + Math.round(stats.minutes == null ? match.clock.elapsedSeconds / 60 : stats.minutes) + ' min · ' + (stats.goals || 0) + ' goals · ' + (stats.assists || 0) + ' assists · ' + (stats.shots || 0) + ' shots · ' + (stats.passes || 0) + ' passes · ' + (stats.tackles || 0) + ' tackles</div>';
      Object.keys(groups).forEach(function (group) {
        var values = groups[group].filter(function (key) { return attrs[key] != null; });
        if (!values.length) return;
        report += '<details class="attribute-group"><summary>' + group + '</summary><div class="metric-grid">' + values.map(function (key) { return '<div class="metric"><b>' + Math.round(attrs[key]) + '</b><span>' + escapeHtml(label(key)) + '</span></div>'; }).join("") + '</div></details>';
      });
      if (debugMode) {
        var current = player.currentAction || player.action || {}, estimate = belief.ball && belief.ball.estimatedPosition;
        report += '<details class="debug-explanation"><summary>Player insight</summary>';
        report += '<div class="details-block"><b>Decision</b> · ' + escapeHtml(intent.action || intent.type || current.type || "reading play") + (intent.target ? ' → (' + Number(intent.target.x).toFixed(1) + ', ' + Number(intent.target.y).toFixed(1) + ')' : '') + '<br><b>Ball awareness</b> · ' + escapeHtml(estimate ? Number(estimate.x).toFixed(1) + ', ' + Number(estimate.y).toFixed(1) : "not currently estimated") + ' · ' + escapeHtml(belief.ball && belief.ball.confidence != null ? Math.round(belief.ball.confidence * 100) + '% confidence, age ' + (belief.ball.ageTicks == null ? "—" : belief.ball.ageTicks) + ' ticks, ' + (belief.ball.source || "unknown source") : "no ball belief") + '<br><b>Observation timing</b> · tick ' + escapeHtml(belief.updatedTick == null ? "—" : belief.updatedTick) + ' · decision tick ' + escapeHtml((player.ai && player.ai.lastDecision) || match.tick) + '</div>';
        var explanation = player.ai && player.ai.decisionExplanation;
        if (explanation) {
          var pointText = function (point) { return point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)) ? '(' + Number(point.x).toFixed(1) + ', ' + Number(point.y).toFixed(1) + ')' : '—'; };
          var detailsText = function (value) {
            if (!value || typeof value !== 'object') return '—';
            var keys = Object.keys(value);
            if (!keys.length) return 'no additional prediction details';
            return keys.map(function (key) { var item = value[key], rendered = item && typeof item === 'object' ? JSON.stringify(item) : String(item); if (typeof item === 'number') rendered = Number(item).toFixed(2); return escapeHtml(key) + '=' + escapeHtml(rendered); }).join(' · ');
          };
          var selection = explanation.selected || {}, winner = explanation.utilityWinner || {}, commitment = explanation.commitment || {};
          report += '<div class="details-block"><b>Selection</b> · ' + escapeHtml(explanation.reason === 'held-valid-commitment' ? 'held valid commitment' : 'highest-utility candidate') + '<br><b>Utility winner</b> · ' + escapeHtml(winner.type || '—') + ' ' + escapeHtml(pointText(winner.target)) + ' · ' + escapeHtml(winner.utility == null ? '—' : Number(winner.utility).toFixed(3)) + '<br><b>Selected</b> · ' + escapeHtml(selection.type || '—') + ' ' + escapeHtml(pointText(selection.target)) + ' · ' + escapeHtml(selection.utility == null ? '—' : Number(selection.utility).toFixed(3)) + (commitment.valid ? '<br><b>Commitment</b> · prior ' + escapeHtml(commitment.previousType || '—') + ' utility ' + escapeHtml(commitment.previousUtility == null ? '—' : Number(commitment.previousUtility).toFixed(3)) + ' · switch threshold ' + escapeHtml(commitment.threshold == null ? '—' : Number(commitment.threshold).toFixed(3)) + ' · urgent receive ' + (commitment.urgentReceive ? 'yes' : 'no') : '') + '</div>';
          var entities = explanation.beliefs && explanation.beliefs.entities || [];
          report += '<div class="details-block"><b>Observations</b> · ' + escapeHtml(explanation.beliefs && explanation.beliefs.entityCount || 0) + ' identities' + (explanation.beliefs && explanation.beliefs.truncated ? ' · display truncated' : '') + '<br>' + (entities.length ? entities.map(function (entity) { return escapeHtml(entity.id) + (entity.role ? ' · ' + escapeHtml(entity.role) : '') + ' · team ' + escapeHtml(entity.teamId || 'unknown') + ' · estimate ' + escapeHtml(pointText(entity.estimatedPosition)) + ' · ' + escapeHtml(entity.confidence == null ? '—' : Math.round(entity.confidence * 100) + '%') + ' confidence · age ' + escapeHtml(entity.ageTicks == null ? '—' : entity.ageTicks) + ' ticks · ' + escapeHtml(entity.source || 'unknown source'); }).join('<br>') : 'No player identities currently remembered') + (explanation.beliefs && explanation.beliefs.ball ? '<br><b>Ball</b> · estimate ' + escapeHtml(pointText(explanation.beliefs.ball.estimatedPosition)) + ' · ' + escapeHtml(explanation.beliefs.ball.confidence == null ? '—' : Math.round(explanation.beliefs.ball.confidence * 100) + '%') + ' confidence · age ' + escapeHtml(explanation.beliefs.ball.ageTicks == null ? '—' : explanation.beliefs.ball.ageTicks) + ' ticks · ' + escapeHtml(explanation.beliefs.ball.source || 'unknown source') : '') + '</div>';
          if (debugOptions().candidates) {
            report += '<div class="details-block"><b>Evaluated alternatives</b> · ' + escapeHtml(explanation.evaluatedCount) + ' scored · ' + escapeHtml(explanation.attentionCount) + ' attention slots · ' + escapeHtml(explanation.storedCount) + ' recorded' + (explanation.truncated ? ' · stored list truncated' : '') + '</div>';
            report += (explanation.candidates || []).map(function (candidate) {
              var components = candidate.utilityComponents || {};
              return '<div class="details-block"><b>#' + escapeHtml(candidate.rank) + ' ' + escapeHtml(candidate.type || 'option') + '</b>' + (candidate.targetId ? ' → ' + escapeHtml(candidate.targetId) : '') + ' · target ' + escapeHtml(pointText(candidate.target)) + ' · utility ' + escapeHtml(candidate.utility == null ? '—' : Number(candidate.utility).toFixed(3)) + '<br><b>Components</b> · raw ' + escapeHtml(components.raw == null ? '—' : Number(components.raw).toFixed(3)) + ' · tactical ' + escapeHtml(components.tactical == null ? '—' : Number(components.tactical).toFixed(3)) + ' · preference ' + escapeHtml(components.playerPreference == null ? '—' : Number(components.playerPreference).toFixed(3)) + ' · noise ' + escapeHtml(components.uncertainty == null ? '—' : Number(components.uncertainty).toFixed(3)) + '<br><b>Prediction</b> · ' + detailsText(candidate.details) + '</div>';
            }).join('');
          }
        } else if (debugOptions().candidates) {
          report += '<div class="details-block"><b>Decision alternatives</b> · no decision explanation recorded for this tick</div>';
        }
        report += '</details>';
      }
      $("inspector").innerHTML = report + '</div>';Array.from($("inspector").querySelectorAll?$("inspector").querySelectorAll("details"):[]).forEach(function(d){var summary=d.querySelector("summary");if(summary&&openSections.includes(summary.textContent))d.open=true;});
      if (TF.productUI && TF.productUI.portrait && team) { var card = $("inspector").querySelector(".player-card"); if (card) { var photo = TF.productUI.portrait(player, team); photo.classList.add("profile-portrait"); card.insertBefore(photo, card.firstChild); } }
    }
    function frame(now) {
      raf = 0; if (!match) return;
      if (!document.hidden && !core.isPaused() && !fastFinishing) {
        var elapsed = lastFrame ? Math.min(.25, (now - lastFrame) / 1000) : 0;
        var result = core.advance(elapsed); if (result.droppedSeconds > .03) { /* bounded catch-up avoids visible clock jumps */ }
      }
      lastFrame = now; if (!(TF.replay && TF.replay.playing)) renderer.render(match, result ? result.alpha : 0); $("clockDisplay").innerHTML = clockText(match); if(TF.productUI&&TF.productUI.updateMatch)TF.productUI.updateMatch(match); renderFeed(); if (TF.studio && TF.studio.update) TF.studio.update(match); if (selected && match.tick - lastInspectorTick >= 12 && match.playersById[selected.id]) updateInspector(match.playersById[selected.id]);
      if (!fastFinishing && match.state.halfTime && $("breakCard").hidden) halftime();
      if (!fastFinishing && match.state.finished && $("fullTimePanel").hidden) fulltime();
      if (activeHandle && TF.product && !$("matchPanel").hidden && !fastFinishing && !match.state.finished && now - lastSavedAt > 20000) { lastSavedAt = now; TF.product.saveMatch(activeHandle).catch(function () {}); }
      if (match && !$("matchPanel").hidden) { var paused = core.isPaused(); $("playButton").textContent = paused ? "Play" : "Pause"; $("playButton").setAttribute("aria-label", paused ? "Resume match" : "Pause match"); ["newSetupButton", "newSeedButton", "restartButton", "replayButton"].forEach(function (id) { if ($(id)) $(id).disabled = fastFinishing; }); if ($("finishSimulationButton")) $("finishSimulationButton").disabled = fastFinishing || !!match.state.finished; $("playButton").disabled = fastFinishing || !!(match.state.halfTime || match.state.finished || (TF.replay && TF.replay.playing)); $("stepButton").disabled = fastFinishing || !paused || !!(match.state.halfTime || match.state.finished || (TF.replay && TF.replay.playing)); setStatus(fastFinishing ? "SIMULATING" : match.state.finished ? "FULL-TIME" : match.state.halfTime ? "HALF-TIME" : TF.replay && TF.replay.playing ? "REPLAY" : paused ? "PAUSED" : "LIVE"); raf = root.requestAnimationFrame(frame); }
    }
    $("startButton").addEventListener("click", function () { setupMatch(); });
    $("playButton").addEventListener("click", function () { if (!core) return;var pauseRequested=!core.isPaused()||(pausedForHidden&&wasRunningBeforeHidden);pausedForHidden=false;wasRunningBeforeHidden=false; if (!pauseRequested) { core.resume(); match.clock.running = true; this.textContent = "Pause"; this.setAttribute("aria-label", "Pause match"); setStatus("LIVE"); } else { core.pause(); match.pause(); this.textContent = "Play"; this.setAttribute("aria-label", "Resume match"); setStatus("PAUSED"); } });
    $("stepButton").addEventListener("click", function () { if (core && core.isPaused() && !match.state.halfTime && !match.state.finished) { match.clock.running = true; core.resume(); core.step(1); core.pause(); match.clock.running = false; renderer.render(match, 0); } });
    function rematchCurrent(exact){if(activeHandle&&TF.product.rematch){var h=TF.product.rematch({kind:"match",teamSnapshots:[activeHandle.config.home,activeHandle.config.away],seed:match.seed,knockout:activeHandle.config.knockout},{exact:exact});TF.ui.watch(h);}else if(exact&&lastMatchOpts)makeMatch(lastMatchOpts);else setupMatch(Math.floor(Math.random()*999999999)+1);}
    $("restartButton").addEventListener("click", function () {rematchCurrent(true); });
    if ($("newSetupButton")) $("newSetupButton").addEventListener("click", function () { if (core) { core.pause(); match.pause(); } clearTimeout(autoHalfTimer); if(TF.ui.closeCurrent)TF.ui.closeCurrent(); $("matchPanel").hidden = true; $("fullTimePanel").hidden = true; $("setupPanel").hidden = false; $("app").classList.remove("is-match");if(TF.productUI&&TF.productUI.showSetup)TF.productUI.showSetup(); setStatus("READY"); });
    $("newSeedButton").addEventListener("click", function () {rematchCurrent(false); });
    $("speedSelect").addEventListener("change", function () { if (core) core.setSpeed(this.value); });
    $("cameraSelect").addEventListener("change", function () { var mode = this.value; renderer.setCamera(mode.indexOf("follow-") === 0 ? "follow" : mode, mode === "follow-ball" ? "ball-1" : (mode === "follow-player" && selected ? selected.id : null)); });
    $("zoomIn").addEventListener("click", function () { renderer.zoomBy(1.16); }); $("zoomOut").addEventListener("click", function () { renderer.zoomBy(.86); });
    $("qualitySelect").addEventListener("change", function () { renderer.setQuality(this.value); });
    $("continueButton").addEventListener("click", continueHalf);
    $("backSetupButton").addEventListener("click", function () { $("fullTimePanel").hidden = true; $("matchPanel").hidden = true; $("setupPanel").hidden = false; $("app").classList.remove("is-match");if(TF.productUI&&TF.productUI.showSetup)TF.productUI.showSetup(); setStatus("READY"); });
    canvas.addEventListener("click", function (event) { if (!match) return; var rect = canvas.getBoundingClientRect(), hit = renderer.hitTest(event.clientX - rect.left, event.clientY - rect.top), player = hit && match.playersById[hit.id]; if (player) updateInspector(player); else if(theatre)closeTheatrePlayer(true); });
    if ($("playerProfileSelect")) $("playerProfileSelect").addEventListener("change", function () { var player = match && match.playersById[this.value]; if (player) updateInspector(player); else if(theatre)closeTheatrePlayer(true); });
    root.document.querySelectorAll('[data-debug]').forEach(function (input) { input.addEventListener("change", function () { renderer.setDebug(debugOptions()); if (selected) updateInspector(selected); }); });
    $("debugToggle").addEventListener("click", function () { var inputs = Array.from(root.document.querySelectorAll('[data-debug]')); var active = inputs.some(function (item) { return item.checked; }); inputs.forEach(function (item) { item.checked = !active; }); renderer.setDebug(debugOptions()); if (selected) updateInspector(selected); });
    root.document.addEventListener("visibilitychange", function () {
      if (!core) return;
      if (document.hidden) { wasRunningBeforeHidden = !core.isPaused(); if (wasRunningBeforeHidden) { core.pause(); match.pause(); pausedForHidden = true; } lastFrame = 0; }
      else { if (pausedForHidden && wasRunningBeforeHidden && !match.state.halfTime && !match.state.finished) { core.resume(); match.clock.running = true; } pausedForHidden = false; lastFrame = 0; }
    });
    root.document.addEventListener("keydown", function (event) { if (!core || $("playScreen").hidden || $("matchPanel").hidden || /INPUT|SELECT|TEXTAREA|BUTTON|A|SUMMARY/.test(event.target.tagName) || event.target.closest("dialog")) return; if (event.code === "Space") { event.preventDefault(); $("playButton").click(); } if (event.key === "1" || event.key === "2" || event.key === "4" || event.key === "8") { $("speedSelect").value = event.key; $("speedSelect").dispatchEvent(new Event("change")); } });
    $("soundToggle").addEventListener("click", function () { var on = TF.audio && typeof TF.audio.toggle === "function" ? TF.audio.toggle() : false; this.classList.toggle("sound-muted", !on); this.setAttribute("aria-pressed", String(on)); this.textContent = on ? "Sound on" : "Sound off"; this.setAttribute("aria-label", on ? "Sound on. Turn sound off" : "Sound off. Turn sound on"); this.title = on ? "Sound on" : "Sound off"; });
    $("soundToggle").classList.toggle("sound-muted", !(TF.audio && TF.audio.isEnabled && TF.audio.isEnabled())); $("soundToggle").setAttribute("aria-pressed", String(!!(TF.audio && TF.audio.isEnabled && TF.audio.isEnabled()))); $("soundToggle").textContent = TF.audio && TF.audio.isEnabled && TF.audio.isEnabled() ? "Sound on" : "Sound off";
    TF.ui = TF.ui || {}; TF.ui.watch = function (handle) { if (!handle || !handle.match) return; lastMatchOpts = { seed: handle.match.seed, homeId: handle.config && handle.config.home && (handle.config.home.libraryId || handle.config.home.id), awayId: handle.config && handle.config.away && (handle.config.away.libraryId || handle.config.away.id) }; makeMatch({ handle: handle }); }; TF.ui.startConfigured = setupMatch; TF.ui.currentMatch = function () { return activeHandle || (match ? { match: match, core: core } : null); };
    TF.ui.closeCurrent=function(skipSave){if(theatre)setTheatre(false);var closing=activeHandle;if(TF.replay&&TF.replay.playing)TF.replay.stop();if(core){core.pause();match.pause();}clearTimeout(autoHalfTimer);activeHandle=null;if(TF.product&&TF.product.activeMatch===closing)TF.product.activeMatch=null;if(closing&&closing._cupLeaseTimer)clearInterval(closing._cupLeaseTimer);var saving=closing&&TF.product&&!closing.match.state.finished&&!skipSave?TF.product.saveMatch(closing):Promise.resolve();if(closing&&closing.cupId&&TF.product)TF.product.releaseCompetition(closing.cupId).catch(function(){});return saving.catch(function(error){if($("productNotice")){$("productNotice").textContent=error.message;$("productNotice").hidden=false;}});};
    TF.ui.setTheatre=setTheatre;TF.ui.viewState=function(){return{theatre:theatre,selectedId:selected&&selected.id,fullscreen:root.document.fullscreenElement===$("matchPanel")};}; TF.ui.pause = function(){pausedForHidden=false;wasRunningBeforeHidden=false;if(core){core.pause();match.pause();}}; TF.ui.selectPlayer=function(id){if(match&&match.playersById[id])updateInspector(match.playersById[id]);};
    TF.ui.finish = function (options) { if (!activeHandle || !TF.product || fastFinishing) return Promise.resolve(); fastFinishing = true; if (TF.replay && TF.replay.playing) TF.replay.stop(); clearTimeout(autoHalfTimer); $("breakCard").hidden = true; core.pause(); return TF.product.finishMatch(activeHandle,options).then(function (result) { fastFinishing = false; if (result&&result.status==='cancelled') {core.pause();match.pause();} if (match.state.finished) { fulltime(true); if(TF.productUI&&TF.productUI.matchCompleted)TF.productUI.matchCompleted(result,activeHandle); } return result; }).catch(function (error) { fastFinishing = false; if ($("productNotice")) { $("productNotice").textContent = error.message; $("productNotice").hidden = false; } throw error; }); };
    if ($("finishSimulationButton")) $("finishSimulationButton").addEventListener("click", function () { if(TF.productUI&&TF.productUI.finishCurrent)TF.productUI.finishCurrent();else TF.ui.finish().catch(function () {}); });
    if (TF.replay && typeof TF.replay.attachControls === "function") TF.replay.attachControls({ match: function () { return match; }, core: function () { return core; }, renderer: renderer });
    var autoReplayInput = $("autoReplay"); if (autoReplayInput && autoReplayInput.parentElement && autoReplayInput.parentElement.lastChild) autoReplayInput.parentElement.lastChild.textContent = " Auto replay";
  }
  if (root.document && root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", startUI); else startUI();
  TF.ui = Object.assign(TF.ui || {}, { start: startUI, restoreMatchEvents: function (match) { if (restoreFeedForMatch) restoreFeedForMatch(match); } });
})(typeof window !== "undefined" ? window : globalThis);
