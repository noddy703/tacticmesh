(function (root) {
  "use strict";
  var TF = root.TF = root.TF || {};
  function byId(id) { return root.document.getElementById(id); }
  function clearActor(p) { p.velocity.x = p.velocity.y = p.velocity.z = 0; p.previousPosition.x = p.position.x; p.previousPosition.y = p.position.y; p.beliefState = null; p.ai = null; p.intent = null; p.motor = null; p.action = null; p.movementTarget = null; }
  function placeActor(match, team, p, x, y) {
    p.position.x = p.previousPosition.x = x; p.position.y = p.previousPosition.y = y; p.position.z = p.previousPosition.z = 0;
    p.facing.x = team.attackDirection; p.facing.y = 0; p.formationSlot = { x: team.attackDirection > 0 ? x : match.pitch.length - x, y: y, role: p.role };
    clearActor(p);
  }
  function chooseRole(team, roleCode, used) {
    var roster = (team.players || []).filter(function(p) { return !p.isGoalkeeper && !used.has(p); });
    var exact = roster.find(function(p){return p.role === roleCode;});
    if (exact) return exact;
    var family = /^(ST|RW|LW|CF)$/.test(roleCode) ? 'FWD' : /^(AM|RAM|LAM|CM|RCM|LCM|DM|RM|LM)$/.test(roleCode) ? 'MID' : 'DEF';
    return roster.find(function(p){return p.positionFamily===family;}) || roster[0] || null;
  }
  function setLineup(match, team, actors, keeperOn) {
    var selected = [], used = new Set();
    actors.forEach(function(spec) { if (Array.isArray(spec)) spec={role:spec[0],x:spec[1],y:spec[2]}; var p = chooseRole(team, spec.role, used); if (!p) return; used.add(p); p.role = spec.role; selected.push({ player:p, spec:spec }); });
    var goalkeeper = keeperOn ? (team.players || []).find(function(p){return p.isGoalkeeper;}) : null;
    if (goalkeeper) { used.add(goalkeeper); selected.unshift({ player:goalkeeper, spec:{ role:'GK', x:team.attackDirection>0?5:match.pitch.length-5, y:match.pitch.width/2 } }); }
    team.activePlayers = selected.map(function(x){return x.player;}); team.bench = (team.players||[]).filter(function(p){return !used.has(p);});
    (team.players||[]).forEach(function(p){p.active=used.has(p); if(!p.active) clearActor(p);});
    selected.forEach(function(x){placeActor(match,team,x.player,x.spec.x,x.spec.y);});
    return selected.filter(function(x){return !x.player.isGoalkeeper;}).map(function(x){return x.player;});
  }
  function applyFormation(team, formation, match) {
    var slots = TF.FORMATIONS && TF.FORMATIONS[formation]; if(!slots) return;
    team.formation = formation;
    var players = (team.activePlayers || []).slice().sort(function(a,b){return a.number-b.number;});
    players.forEach(function(p,i){
      var slot=slots[i]; if(!slot) return;
      p.role=slot[0]; p.positionFamily=slot[1]; p.formationSlot={role:slot[0],x:slot[2],y:slot[3]};
      p.position.x=p.previousPosition.x=team.attackDirection>0?slot[2]:match.pitch.length-slot[2];
      p.position.y=p.previousPosition.y=slot[3]; p.facing.x=team.attackDirection; p.facing.y=0; p.velocity.x=p.velocity.y=0; p.intent=p.motor=p.action=null; p.beliefState=null; p.ai=null;
    });
  }
  function setPatientPossession(team) {
    // These named retention fixtures use an explicit patient style. Full-XI
    // matches and the other lab scenarios continue to use generated tactics.
    team.tactics = Object.assign({}, team.tactics || {}, {
      patience: 0.84,
      passingDirectness: 0.24,
      buildupRisk: 0.22,
      tempo: 0.42,
      width: Math.max(Number(team.tactics && team.tactics.width) || 0.62, 0.68)
    });
  }
  function configureAIScenario(match, name) {
    var h=match.teams[0], a=match.teams[1], gkH=false, gkA=false, hs=[], as=[], ballOwner=null;
    match.state.phase='open-play'; match.state.restartType=null; match.state.restartTeamId=null; match.state.possessionTeamId=null;
    match.rulesConfig=Object.assign({},match.rulesConfig||{},{minPlayers:1});
    match.state.labNeutralIds=[]; match.state.labBaseLineups=null; match.state.labTacticalOverride=false; match.state.labPhase=null;
    match.players.forEach(function(p){p.scenarioNeutralSupport=false;});
    var scenario = {
      '2v1 overload': { home:[['ST',60,32],['RW',67,48]], away:[['CB',75,41]], awayGK:true, owner:0 },
      '3v2 transition': { home:[['AM',54,34],['ST',66,34],['RW',62,49]], away:[['CB',73,31],['LB',72,48]], awayGK:true, owner:0 },
      '4v4+3 possession': { home:[['ST',52,34],['CM',44,25],['RW',50,49],['CB',38,37],['DM',42,43],['LW',47,19],['AM',48,56]], away:[['ST',67,34],['CM',61,24],['RW',66,48],['CB',70,39]], owner:0, neutral:[4,5,6] },
      '6v4 build-up': { home:[['CB',25,25],['LCB',27,43],['RB',31,8],['LB',31,60],['DM',40,32],['CM',43,44]], away:[['ST',49,28],['LW',51,40],['AM',47,51],['CM',56,34]], homeGK:true, awayGK:true, owner:0 },
      'Through ball': { home:[['CM',56,34],['ST',78,37],['RW',56,23]], away:[['CB',82,29],['CB',83,40],['RB',81,50]], awayGK:true, owner:0 },
      'Low block': { home:[['CB',24,27],['CB',24,41],['LB',27,15],['RB',27,53],['DM',34,34]], away:[['CB',76,28],['CB',77,39],['RW',75,57],['LB',76,16],['DM',70,33],['CM',71,44],['LW',67,12],['ST',64,54]], homeGK:true, awayGK:true, lowBlock:true, owner:0 },
      'High press': { home:[['ST',48,34],['RW',52,46],['LW',52,22],['AM',56,34]], away:[['CB',61,27],['CB',62,42],['DM',67,34],['RB',66,53]], awayGK:true, owner:0 },
      'Defensive transition': { home:[['CB',43,26],['CB',45,42],['DM',50,34],['CM',53,48]], away:[['ST',60,34],['RW',63,48],['CM',58,22]], awayGK:true, owner:0 }
    }[name];
    scenario=scenario||{home:[['AM',50,34],['ST',62,34]],away:[['CB',70,34]],owner:0};
    hs=setLineup(match,h,scenario.home,!!scenario.homeGK); as=setLineup(match,a,scenario.away,!!scenario.awayGK);
    gkH=!!scenario.homeGK; gkA=!!scenario.awayGK;
    if (name === '4v4+3 possession') { setPatientPossession(h); setPatientPossession(a); }
    if (name === 'Low block') setPatientPossession(a);
    if (scenario.lowBlock) {
      h.tactics = Object.assign({}, h.tactics || {}, { defensiveLine:0.28, compactness:0.86, defensiveWidth:0.44, pressingIntensity:0.34 });
    }
    function at(roleCode) { return hs.find(function(p){return p.role===roleCode;}) || hs[0]; }
    ballOwner=hs[Math.min(scenario.owner||0,hs.length-1)] || hs[0];
    if(name==='High press') { ballOwner=as.find(function(p){return p.role==='CB';})||as[0]; match.state.possessionTeamId=a.id;
      // Start the pressing unit close enough and oriented to perceive the carrier.
      hs.forEach(function(p){var dx=ballOwner.position.x-p.position.x,dy=ballOwner.position.y-p.position.y,n=Math.sqrt(dx*dx+dy*dy)||1;p.facing.x=dx/n;p.facing.y=dy/n;});
    }
    if(name==='Low block') { ballOwner=as[as.length-1]||as[0]; match.state.possessionTeamId=a.id; }
    if(name==='Defensive transition') { ballOwner=as[0]; match.state.possessionTeamId=a.id; match.state.labPhase='defensiveTransition'; }
    match.players.forEach(function(p){if(!p.active) clearActor(p);});
    if(name==='Through ball' && hs[0]) { ballOwner=hs[0]; hs.forEach(function(p){if(p.role==='ST') { p.position.x=p.previousPosition.x=78; p.velocity.x=1.9; }}); }
    if(scenario.neutral) {
      match.state.labNeutralIds=scenario.neutral.map(function(i){return hs[i]&&hs[i].id;}).filter(Boolean);
      match.state.labBaseLineups={}; match.teams.forEach(function(t){match.state.labBaseLineups[t.id]=t.activePlayers.filter(function(p){return match.state.labNeutralIds.indexOf(p.id)<0;}).map(function(p){return p.id;});});
      match.state.labNeutralTeamId=h.id;
      match.state.labNeutralIds.forEach(function(id){var p=match.playersById[id];if(p)p.scenarioNeutralSupport=true;});
    }
    match.ball.position.x=match.ball.previousPosition.x=ballOwner?ballOwner.position.x:match.pitch.length/2;
    match.ball.position.y=match.ball.previousPosition.y=ballOwner?ballOwner.position.y:match.pitch.width/2;
    match.ball.position.z=match.ball.previousPosition.z=.11; match.ball.velocity.x=match.ball.velocity.y=match.ball.velocity.z=0;
    match.ball.ownerId=ballOwner&&ballOwner.id||null; match.ball.lastTouchPlayerId=ballOwner&&ballOwner.id||null; match.ball.lastTouchTeamId=ballOwner&&ballOwner.teamId||null;
    match.state.possessionTeamId=match.ball.lastTouchTeamId; match.state.labScenario=name; match.state.labTacticalOverride=false;
    match.state.labScenarioMeta={fieldCounts:{home:hs.length,away:as.length},goalkeepers:{home:gkH,away:gkA},neutralSupport:(match.state.labNeutralIds||[]).length,lowBlock:!!scenario.lowBlock,
      patientPossessionTeams: name === '4v4+3 possession' ? [h.id,a.id] : name === 'Low block' ? [a.id] : []};
  }
  function updateLabNeutrals(match) {
    var state=match.state||{}, ids=state.labNeutralIds||[], bases=state.labBaseLineups; if(!ids.length||!bases)return;
    var previousTeamId=state.labNeutralTeamId;
    var holder=match.ball.ownerId&&match.playersById[match.ball.ownerId];
    // A loose ball or deflection does not transfer support. Only actual
    // controlled possession changes the neutral team's affiliation.
    var controlled=holder&&holder.active&&match.ball.ownerId===holder.id&&match.ball.controlState!=='loose';
    var teamId=controlled?holder.teamId:previousTeamId;
    if(!match.teams.some(function(t){return t.id===teamId;}))teamId=state.labNeutralTeamId;
    state.labNeutralTeamId=teamId;
    match.teams.forEach(function(t){
      var list=(bases[t.id]||[]).map(function(id){return match.playersById[id];}).filter(Boolean);
      if(t.id===teamId) ids.forEach(function(id){var p=match.playersById[id];if(p&&list.indexOf(p)<0)list.push(p);});
      t.activePlayers=list; t.bench=(t.players||[]).filter(function(p){return list.indexOf(p)<0&&!ids.includes(p.id);});
      list.forEach(function(p){p.active=true;p.team=t;p.teamId=t.id;});
    });
    ids.forEach(function(id){
      var p=match.playersById[id]; if(!p)return;
      p.active=true; p.team=match.teams.find(function(t){return t.id===teamId;}); p.teamId=teamId;
      if(teamId!==previousTeamId) p.formationSlot.x=p.team.attackDirection>0?p.position.x:match.pitch.length-p.position.x;
    });
  }
  function configureFormationLab(match, homeFormation, awayFormation, phase) {
    var home=match.teams[0], away=match.teams[1], field=match.pitch;
    applyFormation(home,homeFormation,match); applyFormation(away,awayFormation,match);
    match.state.phase='open-play'; match.state.restartType=null; match.state.restartTeamId=null; match.state.possessionTeamId=null;
    match.state.labPhase=phase||'midfieldPossession'; match.state.labTacticalOverride=true;
    match.ball.position.x=match.ball.previousPosition.x=field.length/2; match.ball.position.y=match.ball.previousPosition.y=field.width/2; match.ball.position.z=match.ball.previousPosition.z=.11; match.ball.velocity.x=match.ball.velocity.y=match.ball.velocity.z=0; match.ball.ownerId=null;
    return match;
  }
  TF.configureAIScenario=configureAIScenario;
  TF.updateLabNeutrals=updateLabNeutrals;
  TF.configureFormationLab=configureFormationLab;
  function boot() {
    var page = root.document.body.getAttribute("data-lab"); if (!page || !TF.createMatch) return;
    var titles = { ai: ["AI scenario lab", "Read the shape. Watch the choices."], formation: ["Formation lab", "Move the anchors. Change the picture."], physics: ["Physics lab", "Put the ball in motion."], rules: ["Rules lab", "Probe the laws of the game."], batch: ["Batch simulator", "Run seeded worlds in the background."] };
    var title = titles[page] || titles.ai;
    byId("labTitle").textContent = title[0]; byId("labLead").textContent = title[1];
    var presetNames = page === "ai" ? ["2v1 overload", "3v2 transition", "4v4+3 possession", "6v4 build-up", "Through ball", "Low block", "High press", "Defensive transition"] : page === "physics" ? ["Lob", "Rolling ball", "Shot", "Post", "First touch", "Header", "Tackle", "Goalkeeper dive"] : page === "formation" ? ["4-3-3", "4-2-3-1", "4-4-2", "3-4-2-1", "3-5-2"] : ["Offside", "Throw-in", "Goal kick", "Corner", "Penalty", "Substitution", "Added time", "Goal line"];
    var scenario = byId("scenario"), seed = byId("labSeed"), output = byId("labOutput"), canvas = byId("labCanvas"), status = byId("labStatus");
    if (page !== "batch") scenario.innerHTML = presetNames.map(function (name, i) { return '<option value="' + i + '">' + name + '</option>'; }).join("");
    var match = null, renderer = null, raf = 0, running = false, canceled = false, batchResults = [], physicsRunId = 0, physicsProgress = 0, scenarioRunId = 0;
    if (canvas && TF.createRenderer) renderer = TF.createRenderer(canvas, { quality: "low" });
    function log(text) { output.textContent = text; }
    function chosenScenario() { return presetNames[Math.max(0, Number(scenario.value) || 0)]; }
    function configureScenario(m) {
      var f = m.pitch, name = chosenScenario(), h = m.teams[0], a = m.teams[1], ball = m.ball;
      m.state.phase = "open-play"; m.state.restartType = null; m.state.restartTeamId = null; m.state.possessionTeamId = null; m.state.rules = m.state.rules || {}; if (TF.rulesLab && TF.rulesLab.configure) TF.rulesLab.configure(m, { version: "IFAB 2026/27" });
      if (page === "formation") {
        configureFormationLab(m,name,byId("oppositionFormation").value||a.formation,byId("labPhase").value||"midfieldPossession");
      }
      if (page === "ai") configureAIScenario(m, name);
      if (page === "physics") {
        function place(p, x, y, fx, fy) { if (!p) return; p.position.x = p.previousPosition.x = x; p.position.y = p.previousPosition.y = y; p.position.z = p.previousPosition.z = 0; p.velocity.x = p.velocity.y = p.velocity.z = 0; p.facing.x = fx == null ? 1 : fx; p.facing.y = fy || 0; p.motor = p.intent = p.action = null; }
        function isolate(players) { var keep = new Set(players.filter(Boolean)); m.players.forEach(function (p) { p.active = keep.has(p); if (!p.active) p.motor = p.intent = p.action = null; }); m.teams.forEach(function (t) { t.activePlayers = t.players.filter(function (p) { return p.active; }); }); }
        function freeBall(x, y, z, vx, vy, vz) { ball.position.x = ball.previousPosition.x = x; ball.position.y = ball.previousPosition.y = y; ball.position.z = ball.previousPosition.z = z; ball.velocity.x = vx; ball.velocity.y = vy; ball.velocity.z = vz || 0; ball.ownerId = null; ball.handControl = false; ball.controlState = "flight"; ball._touchCooldown = 0; ball._lastControlTouch = -100; ball.lastTouchPlayerId = null; ball.lastTouchTeamId = null; ball.lastTouchKind = null; ball._lastTouchTime = -100; }
        function action(p, kind, target, power, lift) { p.motor = p.intent = { type: kind, action: kind, target: target, ballTarget: target, power: power, lift: lift, createdTick: 1, expiresTick: 900 }; }
        var kicker = h.activePlayers.filter(function (p) { return !p.isGoalkeeper; })[8] || h.activePlayers[0], keeper = a.activePlayers.filter(function (p) { return p.isGoalkeeper; })[0], tackler = a.activePlayers.filter(function (p) { return !p.isGoalkeeper; })[4];
        var involved = name === "Lob" || name === "Shot" || name === "Header" || name === "First touch" ? [kicker] : name === "Tackle" ? [kicker, tackler] : name === "Goalkeeper dive" ? [kicker, keeper] : [];
        isolate(involved); place(kicker, 55, 34, 1, 0); place(tackler, 54.1, 34, 1, 0); place(keeper, 100, 34, -1, 0); freeBall(55, 34, 0.11, 0, 0, 0);
        kicker.attributes = kicker.attributes || {}; kicker.stamina = 1; kicker.balance = 1;
        if (name === "Lob") { kicker.attributes.shortPassing = 99; ball.ownerId = kicker.id; action(kicker, "pass", { x: 80, y: 24 }, 0.72, 0.72); }
        if (name === "Shot") { kicker.attributes.shooting = 90; ball.ownerId = kicker.id; action(kicker, "shoot", { x: 105, y: 34 }, 0.8, 0.04); }
        if (name === "Post") { isolate([]); freeBall(104.2, 34 - (m.pitch.goalWidth || 7.32) / 2, 0.11, 20, 0, 0); }
        if (name === "Header") { place(kicker, 60, 34, 1, 0); kicker.attributes.heading = 99; kicker.attributes.jumping = 99; kicker.attributes.reach = 99; kicker.attributes.balance = 99; freeBall(60, 34, 1.95, 0.4, 0, 0); action(kicker, "header", { x: 96, y: 34 }, 0.95, 0.08); }
        if (name === "Rolling ball") { isolate([]); freeBall(55, 34, 0.11, 9, 0, 0); }
        if (name === "First touch") { place(kicker, 55, 34, 1, 0); kicker.attributes.firstTouch = 99; kicker.attributes.balance = 99; freeBall(55.45, 34, 0.11, -3, 0, 0); }
        if (name === "Tackle") { kicker.attributes.dribbling = 20; kicker.attributes.balance = 20; tackler.attributes.tackling = 99; tackler.attributes.strength = 99; tackler.balance = 1; ball.ownerId = kicker.id; ball.lastTouchPlayerId = kicker.id; ball.lastTouchTeamId = kicker.teamId; tackler.intent = { type: "tackle", action: "tackle", target: kicker.position, targetId: kicker.id, desiredSpeed: 0, createdTick: 1, expiresTick: 900 }; }
        if (name === "Goalkeeper dive") { kicker.attributes.shooting = 90; ball.position.x = ball.previousPosition.x = 96; ball.position.y = ball.previousPosition.y = 34; ball.ownerId = kicker.id; keeper.attributes.handling = keeper.attributes.catching = keeper.attributes.reflexes = 99; action(kicker, "shoot", { x: 105, y: 34 }, 0.8, 0.04); }
        m.state.labAction = { kind: name, playerId: kicker.id, isolatedPhysicsFixture: true };
      }
      if (page === "rules") {
        var involved = h.activePlayers[8], opponent = a.activePlayers[8];
        m.state.labAssertion = name;
        if (name === "Offside") { involved.position.x = 91; involved.position.y = 34; ball.lastTouchPlayerId = h.activePlayers[6].id; ball.offsideKick = { teamId: h.id, kickerId: h.activePlayers[6].id, tick: -2, line: 75, candidates: [{ playerId: involved.id, offside: true }] }; }
        if (name === "Throw-in") { ball.position.y = f.width + 1; ball.previousPosition.y = f.width - .4; ball.velocity.y = 10; ball.lastTouchTeamId = h.id; m.state.phase = "open-play"; }
        if (name === "Goal kick" || name === "Corner") { ball.position.x = f.length + 1; ball.position.y = 3; ball.previousPosition.x = f.length - .4; ball.velocity.x = 10; ball.lastTouchTeamId = name === "Corner" ? a.id : h.id; m.state.phase = "open-play"; }
        if (name === "Penalty") { m.state.phase = "dead-ball"; m.state.restartType = "penalty"; m.state.restartTeamId = h.id; m.state.restartPoint = { x: 92, y: 34 }; m.state.restartStarted = 0; }
        if (name === "Substitution") { TF.rulesLab.configure(m, { autoRestartSeconds: 100 }); m.state.phase = "dead-ball"; m.state.restartType = "throw-in"; m.state.restartStarted = 0; }
        if (name === "Goal line") { ball.position.x = f.length + .5; ball.previousPosition.x = f.length - .5; ball.position.y = f.width / 2; ball.previousPosition.y = f.width / 2; ball.position.z = .4; ball.previousPosition.z = .4; ball.velocity.x = 10; ball.lastTouchTeamId = h.id; ball.lastTouchPlayerId = h.activePlayers[9].id; m.state.phase = "open-play"; }
      }
    }
    function runRulesScenario() {
      if (!match || !TF.rulesLab) return;
      var name = chosenScenario(), expected = name.toLowerCase().replace(/ /g, "-"), result = "No matching law event", detail = "";
      if (name === "Offside") { var involved = match.teams[0].activePlayers[8]; result = TF.rulesLab.checkOffsideInvolvement(match, involved) ? "PASS · player is in an offside position" : "FAIL · player was not flagged offside"; detail = "Involvement test reads the saved offside kick snapshot."; }
      else if (name === "Penalty") { TF.rulesLab.awardRestart(match, "penalty", match.teams[0].id, { x: 92, y: 34 }, "lab assertion"); result = match.state.restartType === "penalty" ? "PASS · penalty restart awarded" : "FAIL · penalty restart missing"; }
      else if (name === "Goal line") { TF.rulesLab.inspectBoundaries(match); result = match.score.home > 0 ? "PASS · ball crossed the line and goal was awarded" : "FAIL · goal line crossing was not awarded"; }
      else if (name === "Added time") { TF.rulesLab.configure(match, { addedTimeSeconds: 60 }); TF.updateRules(match, TF.FIXED_DT); result = match.clock.periodLimitSeconds === 2760 ? "PASS · one minute added to the period" : "FAIL · added time limit was " + match.clock.periodLimitSeconds; }
      else if (name === "Substitution") { var t = match.teams[0], off = t.activePlayers[10], on = t.bench[0]; match.substitutionRequests = [{ teamId: t.id, playerId: off.id, substituteId: on.id }]; match.tick++; TF.updateRules(match, TF.FIXED_DT); result = on.active ? "PASS · substitution completed" : "FAIL · substitution did not complete"; }
      else { var invoked = TF.rulesLab.inspectBoundaries(match); result = invoked && match.state.restartType === expected ? "PASS · " + match.state.restartType + " awarded" : "FAIL · expected " + expected + ", observed " + (match.state.restartType || "no restart"); }
      renderer && renderer.render(match, 0); status.textContent = result.split(" · ")[0]; log("Rule scenario: " + name + "\nSeed: " + match.seed + "\nAssertion: " + result + (detail ? "\n" + detail : "") + "\nRestart: " + (match.state.restartType || "none") + "\nEvents: " + match.events.map(function (e) { return e.type + (e.restartType ? " · " + e.restartType : ""); }).slice(-8).join("\n"));
    }
    function make() {
      if (page === "batch") return;
      if (page === "ai" && running) { scenarioRunId++; running = false; canceled = true; if (byId("labRun")) byId("labRun").disabled = false; if (byId("labCancel")) byId("labCancel").disabled = true; }
      if (page === "physics" && running) stopPhysics("Stopped · scenario reset");
      var value = Number(seed.value) || 1; var config = { seed: value, autoStart: true }; if (page === "formation") { config.homeFormation = chosenScenario(); config.awayFormation = byId("oppositionFormation").value || "4-3-3"; } match = TF.createMatch(config); configureScenario(match); match.captureSnapshot(); if (renderer) { renderer.capture(match); renderer.render(match, 0); }
      if (page === "rules") runRulesScenario();
      else if (page === "physics") log("Scenario ready · " + chosenScenario() + "\nSeed " + value + " · isolated physics fixture · fixed step 1/60 s\nRun to observe a physics event; AI does not change the fixture.");
      else log("Scenario ready · " + chosenScenario() + "\nSeed " + value + " · fixed step 1/60 s\nUse Run to advance 10 simulation seconds. Drag players to adjust starting positions.");
    }
    if (canvas) {
      canvas.addEventListener("pointerdown", function (e) { if (!match || !renderer) return; var rect = canvas.getBoundingClientRect(), entity = renderer.hitTest(e.clientX - rect.left, e.clientY - rect.top); if (entity && entity.position) { canvas.setPointerCapture(e.pointerId); canvas._dragPlayer = entity; } });
      canvas.addEventListener("pointermove", function (e) { if (!canvas._dragPlayer || !match) return; var rect = canvas.getBoundingClientRect(); var point = renderer.camera.unproject({ x: e.clientX - rect.left, y: e.clientY - rect.top }); canvas._dragPlayer.position.x = Math.max(0, Math.min(match.pitch.length, point.x)); canvas._dragPlayer.position.y = Math.max(0, Math.min(match.pitch.width, point.y)); renderer.render(match, 0); });
      canvas.addEventListener("pointerup", function () { if (canvas._dragPlayer && page === "formation") { var team=canvas._dragPlayer.team; canvas._dragPlayer.formationSlot = { x: team.attackDirection>0?canvas._dragPlayer.position.x:match.pitch.length-canvas._dragPlayer.position.x, y: canvas._dragPlayer.position.y, role: canvas._dragPlayer.role }; } canvas._dragPlayer = null; });
    }
    function run() {
      if (!match) make(); if (!match || running) return;
      var total = 600, done = 0, runId = ++scenarioRunId;
      running = true; canceled = false;
      if (byId("labRun")) byId("labRun").disabled = true;
      if (byId("labCancel")) byId("labCancel").disabled = false;
      status.textContent = "Running · 0 / 600 ticks · 10 simulated seconds";
      function finish(label) {
        if (runId !== scenarioRunId) return;
        running = false;
        if (byId("labRun")) byId("labRun").disabled = false;
        if (byId("labCancel")) byId("labCancel").disabled = true;
        renderer && renderer.render(match, 0);
        status.textContent = (label || "Complete") + " · " + match.clock.periodSeconds.toFixed(1) + " simulated seconds";
        log("Scenario: " + chosenScenario() + "\nSeed: " + match.seed + "\nTick: " + match.tick + "\nScore: " + match.score.home + " — " + match.score.away + "\nShots: " + match.telemetry.shots + " · Passes: " + match.telemetry.passes + "\nEvents: " + match.events.map(function (e) { return e.type; }).slice(-12).join(", "));
      }
      function chunk() {
        if (runId !== scenarioRunId) return;
        if (canceled) { finish("Cancelled"); return; }
        var limit = Math.min(total, done + 30);
        while (done < limit && !match.state.finished && !match.state.halfTime) {
          match.tick++;
          if (page === "ai" && TF.updateLabNeutrals) TF.updateLabNeutrals(match);
          if (typeof TF.updateTactics === "function") TF.updateTactics(match, TF.FIXED_DT);
          if (typeof TF.updateAI === "function") TF.updateAI(match, TF.FIXED_DT);
          TF.updateWorld(match, TF.FIXED_DT);
          done++;
        }
        renderer && renderer.render(match, 0);
        status.textContent = "Running · " + done + " / " + total + " ticks · " + match.clock.periodSeconds.toFixed(1) + " simulated seconds";
        if (done >= total || match.state.finished || match.state.halfTime) { finish(done >= total ? "Complete" : "Stopped at match break"); return; }
        root.setTimeout(chunk, 0);
      }
      root.setTimeout(chunk, 0);
    }
    function stopPhysics(message) {
      if (!running || page !== "physics") return;
      physicsRunId += 1; running = false; canceled = true;
      if (byId("labCancel")) byId("labCancel").disabled = true;
      if (byId("labRun")) byId("labRun").disabled = false;
      status.textContent = message || "Stopped";
    }
    function runPhysics() {
      if (!match) make(); if (!match) return;
      if (running) { stopPhysics("Stopped by user"); return; }
      running = true; canceled = false; var runId = ++physicsRunId, ticks = 600, done = 0, rate = Number(byId("labSpeed").value) || 1, initialX = match.ball.position.x, initialY = match.ball.position.y, initialEvents = match.events.length;
      physicsProgress = 0; byId("labRun").disabled = true; status.textContent = "Isolated physics · " + rate + "× · fixed 1/60-second steps"; byId("labCancel").disabled = false;
      var expectations = {
        "Lob": function (events) { var e = events.find(function (item) { return item.type === "pass" && Number(item.lift) > 0.5; }); return e ? { done: true, passed: true, detail: "pass event with lift " + Number(e.lift).toFixed(2) } : null; },
        "Rolling ball": function () { var moved = Math.sqrt(Math.pow(match.ball.position.x - initialX, 2) + Math.pow(match.ball.position.y - initialY, 2)); return moved >= 3 ? { done: true, passed: true, detail: "free ball travelled " + moved.toFixed(1) + " m" } : null; },
        "Shot": function (events) { var e = events.find(function (item) { return item.type === "shot"; }); return e ? { done: true, passed: true, detail: "shot event · target (" + e.target.x.toFixed(1) + ", " + e.target.y.toFixed(1) + ")" } : null; },
        "Post": function (events) { var e = events.find(function (item) { return item.type === "frame-hit" && item.frame === "post"; }); return e ? { done: true, passed: true, detail: "ball struck the goal post" } : null; },
        "First touch": function (events) { var e = events.find(function (item) { return item.type === "ball-control"; }); return e ? { done: true, passed: true, detail: "controlled first touch by " + (match.playersById[e.playerId] || {}).name } : null; },
        "Header": function (events) { var e = events.find(function (item) { return item.type === "header" || item.type === "header-missed"; }); return e ? { done: true, passed: e.type === "header", result: e.type === "header" ? "PASS" : "MISS", detail: e.type === "header" ? "header struck successfully" : "header challenge missed · aerial skill " + Number(e.aerialSkill).toFixed(2) } : null; },
        "Tackle": function (events) { var e = events.find(function (item) { return item.type === "tackle"; }); return e ? { done: true, passed: e.success === true, detail: e.success ? "tackle won possession" : "tackle attempt did not win the ball" } : null; },
        "Goalkeeper dive": function (events) { var e = events.find(function (item) { return item.type === "save" && item.keeperId; }); return e ? { done: true, passed: true, detail: (e.caught ? "keeper caught the shot" : "keeper parried the shot") + " · " + (match.playersById[e.keeperId] || {}).name } : null; }
      }[chosenScenario()];
      function next() {
        if (runId !== physicsRunId) return;
        var events = match.events.slice(initialEvents), observed = expectations && expectations(events);
        if (observed || done >= ticks || match.state.finished) {
          running = false; byId("labCancel").disabled = true; byId("labRun").disabled = false; renderer && renderer.render(match, 0);
          var result = observed || { done: true, passed: false, detail: "no expected event occurred within " + done + " ticks" };
          var resultLabel = result.result || (result.passed ? "PASS" : "FAIL");
          status.textContent = resultLabel + " · " + result.detail;
          log("Physics scenario: " + chosenScenario() + "\nSeed: " + match.seed + " · isolated physics fixture\nResult: " + resultLabel + " · " + result.detail + "\nTicks: " + done + " · ball (" + match.ball.position.x.toFixed(2) + ", " + match.ball.position.y.toFixed(2) + ", " + match.ball.position.z.toFixed(2) + ")\nEvents: " + events.slice(-12).map(function (e) { return e.type + (e.frame ? " · " + e.frame : "") + (e.success === false ? " · missed" : ""); }).join(", "));
          return;
        }
        match.tick++; match.clock.elapsedSeconds += TF.FIXED_DT; match.clock.periodSeconds += TF.FIXED_DT;
        if (TF.updatePhysics) TF.updatePhysics(match, TF.FIXED_DT); else TF.updateWorld(match, TF.FIXED_DT);
        done++; physicsProgress = done; renderer && renderer.render(match, 0);
        byId("labStatus").textContent = "Running · " + done + " / " + ticks + " fixed ticks · awaiting " + chosenScenario() + " outcome";
        root.setTimeout(next, 1000 / (60 * rate));
      }
      next();
    }
    function runBatch(count) {
      canceled = false; batchResults = []; var index = 0, batchMatch = null, batchTick = 0;
      var totals = { home: 0, away: 0, goals: 0, shots: 0, passes: 0 }, started = Date.now();
      var mode = byId("batchMode"), halfSeconds = mode && Number(mode.value) > 0 ? Number(mode.value) : 2700;
      var batchTickBudget = 30;
      status.textContent = "Running " + count + " seeded matches · " + (halfSeconds === 2700 ? "full 45-minute halves" : "short test halves");
      byId("cancelBatch").disabled = false; byId("labRun").disabled = true;
      function chunk() {
        if (canceled) { status.textContent = "Cancelled after " + index + " matches"; byId("cancelBatch").disabled = true; byId("labRun").disabled = false; return; }
        var processed = 0;
        while (processed < batchTickBudget && index < count) {
          if (!batchMatch) {
            var seedValue = (Number(seed.value) || 1) + index;
            batchMatch = TF.createMatch({ seed: seedValue, halfSeconds: halfSeconds, autoStart: true, matchId: "batch-" + seedValue });
            batchTick = 0;
          }
          var m = batchMatch;
          if (m.state.halfTime) m.startSecondHalf();
          if (m.state.finished) break;
          m.tick++; if (TF.updateTactics) TF.updateTactics(m, TF.FIXED_DT); if (TF.updateAI) TF.updateAI(m, TF.FIXED_DT); TF.updateWorld(m, TF.FIXED_DT);
          batchTick++; processed++;
          if (m.state.finished) {
            totals.home += m.score.home; totals.away += m.score.away; totals.goals += m.score.home + m.score.away;
            totals.shots += m.telemetry.shots || 0; totals.passes += m.telemetry.passes || 0;
            batchResults.push({ seed: m.seed, home: m.score.home, away: m.score.away, goals: m.score.home + m.score.away, shots: m.telemetry.shots || 0, passes: m.telemetry.passes || 0, finished: true, ticks: m.tick });
            batchMatch = null; batchTick = 0; index++;
          }
        }
        var currentProgress = batchMatch ? Math.min(99, Math.floor(batchMatch.clock.elapsedSeconds / (halfSeconds * 2) * 100)) : 0;
        status.textContent = "Simulated " + index + " / " + count + " matches" + (batchMatch ? " · current match " + currentProgress + "%" : "") + " · " + Math.min(99, Math.round(index / count * 100)) + "%";
        if (index < count) root.setTimeout(chunk, 0); else {
          var elapsed = ((Date.now() - started) / 1000).toFixed(1);
          var summary = { matches: count, halfSeconds: halfSeconds, fullRegulation: halfSeconds === 2700, shortenedForTesting: halfSeconds !== 2700, goalsPerMatch: +(totals.goals / count).toFixed(2), avgHomeGoals: +(totals.home / count).toFixed(2), avgAwayGoals: +(totals.away / count).toFixed(2), avgShots: +(totals.shots / count).toFixed(2), avgPasses: +(totals.passes / count).toFixed(2), wallSeconds: Number(elapsed), results: batchResults };
          output.textContent = "Completed " + count + " seeded matches in " + elapsed + " s\nEach match: " + (halfSeconds === 2700 ? "two 45-minute regulation halves." : "two " + halfSeconds + "-second halves, shortened for testing.") + "\nAverage goals: " + summary.goalsPerMatch + " · Home " + summary.avgHomeGoals + " · Away " + summary.avgAwayGoals + "\nAverage shots " + summary.avgShots + " · Passes " + summary.avgPasses;
          byId("exportBatch").disabled = false; byId("exportBatch").onclick = function () { var blob = new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" }), link = root.document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "tabletop-batch-seed-" + seed.value + ".json"; link.click(); URL.revokeObjectURL(link.href); };
          byId("cancelBatch").disabled = true; byId("labRun").disabled = false; status.textContent = "Complete";
        }
      }
      root.setTimeout(chunk, 0);
    }
    byId("labRun").addEventListener("click", function () { if (page === "batch") { var count = Number(byId("batchCount").value) || 100; runBatch(Math.min(10000, Math.max(1, count))); } else if (page === "rules") runRulesScenario(); else if (page === "physics") runPhysics(); else run(); });
    if (byId("labReset")) byId("labReset").addEventListener("click", make);
    if (scenario) scenario.addEventListener("change", make); if (byId("oppositionFormation")) byId("oppositionFormation").addEventListener("change", make); if (byId("labPhase")) byId("labPhase").addEventListener("change", make);
    if (byId("cancelBatch")) byId("cancelBatch").addEventListener("click", function () { canceled = true; }); if (byId("labCancel")) byId("labCancel").addEventListener("click", function () { if (page === "physics") stopPhysics("Cancelled after " + physicsProgress + " ticks"); else canceled = true; });
    if (page === "batch") { if (byId("batchCount")) byId("batchCount").addEventListener("change", function () { this.value = Math.min(10000, Math.max(1, Number(this.value) || 100)); }); }
    else make();
  }
  if (root.document && root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", boot); else if (root.document) boot();
  TF.labs = { version: 1 };
})(typeof window !== "undefined" ? window : globalThis);
