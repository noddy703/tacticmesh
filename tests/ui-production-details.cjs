const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = path.join(__dirname, '..');
const timers = [];
const context = vm.createContext({ console, setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}, URL, Blob, TextEncoder });
for (const file of ['core', 'world', 'product-data', 'product-appearance']) vm.runInContext(fs.readFileSync(path.join(base, 'src', file + '.js'), 'utf8'), context);
const TF = context.TF, D = TF.productData, pack = D.starterPack();
const teams = D.compilePack(pack).teams.map(t => D.clone(t));
teams.forEach((t, i) => { t.libraryId = 'library-' + i; t.season = '2026/27'; });
function validate(team) { const input = D.clone(pack); input.teams = [D.rawTeam(team)]; return D.validatePack(input); }
const roots = new Map();
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.attrs = {}; this.dataset = {}; this.style = { setProperty(key, value) { this[key] = value; } }; this.hidden = false; this.value = ''; this.textContent = ''; this.classes = new Set(); this.classList = { add: (...v) => v.forEach(x => this.classes.add(x)), remove: (...v) => v.forEach(x => this.classes.delete(x)), toggle: (v, on) => { if (on === undefined) on = !this.classes.has(v); on ? this.classes.add(v) : this.classes.delete(v); } }; }
  appendChild(child) { this.children.push(child); child.parent = this; return child; }
  append(...children) { children.forEach(c => this.appendChild(c)); }
  get firstChild() { return this.children[0]; }
  get lastChild() { return this.children.at(-1); }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parent = null; }
  remove() { if (this.parent) this.parent.removeChild(this); }
  insertBefore(child, before) { const i = this.children.indexOf(before); this.children.splice(i < 0 ? 0 : i, 0, child); child.parent = this; }
  after(child) { const siblings = this.parent.children; siblings.splice(siblings.indexOf(this) + 1, 0, child); child.parent = this.parent; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  fire(type, event = {}) { return this.listeners[type]?.call(this, event); }
  click() { this.fire('click'); }
  focus() { context.document.activeElement = this; }
  scrollIntoView() { this.scrolled = true; }
  matches(selector) { return selector.startsWith('.') ? this.className?.split(' ').includes(selector.slice(1)) : this.tagName.toLowerCase() === selector; }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector); }
  querySelector(selector) { return descendants(this).find(e => e !== this && e.matches(selector)) || null; }
  set innerHTML(value) { this._html = value; this.children = []; }
  get innerHTML() { return this._html || ''; }
}
function descendants(el) { return [el, ...el.children.flatMap(descendants)]; }
function text(el) { return [el.textContent, ...el.children.map(text)].filter(Boolean).join(' '); }
function root(id, tag = 'div') { const e = new Element(tag); e.id = id; roots.set(id, e); return e; }
context.document = { readyState: 'loading', createElement(tag) { return new Element(tag); }, addEventListener() {}, getElementById(id) { return [...roots.values()].flatMap(descendants).find(e => e.id === id) || null; }, querySelector(selector) { return [...roots.values()].flatMap(descendants).find(e => e.matches(selector)) || null; } };
const editor = root('teamEditor'), library = root('teamsLibrary'), notice = root('productNotice'), search = root('teamSearch', 'input'); new Element('label').appendChild(search);
let checkpoints = [], reports = [], started = 0, watched = 0, resolvedAssets = [];
TF.ENGINE_BUILD = 'ui-fixture-build';
TF.product = { getTeam(key) { return teams.find(t => t.libraryId === key); }, listTeams() { return teams; }, validateTeam: validate, listCheckpoints() { return checkpoints; }, listResults() { return reports; }, nextCupMatch() { started++; throw new Error('Selection must not start a match'); }, assetURL(team, asset) { resolvedAssets.push({ team, asset }); return team.assetHashes?.[asset] ? 'blob:stored-portrait' : null; } };
TF.ui = { currentMatch() { return null; }, watch() { watched++; } };
let source = fs.readFileSync(path.join(base, 'src/product-ui.js'), 'utf8');
source = source.replace('  TF.productUI = {', '  TF.__uiTest = {lineupAssignment:lineupAssignment,openEditor:openEditor,renderEditor:renderEditor,renderBracket:renderBracket,renderTeams:renderTeams,applySelectedTeam:applySelectedTeam,getDraft:function(){return draft;}};\n  TF.productUI = {');
vm.runInContext(source, context);
const ui = TF.__uiTest;
function get(id) { return context.document.getElementById(id); }
ui.openEditor(teams[0].libraryId);
let draft = ui.getDraft(), original = draft.lineup.slice();
assert.equal(validate(draft).ok, true);
// Starting-player swaps are legal and preserve eleven unique IDs.
get('lineup-slot-1').value = original[2]; get('lineup-slot-1').fire('change');
assert.equal(draft.lineup[1], original[2]); assert.equal(draft.lineup[2], original[1]); assert.equal(validate(draft).ok, true);
assert.equal(new Set(draft.lineup).size, 11);
const beforeInvalid = JSON.stringify(draft.lineup);
assert.equal(ui.lineupAssignment(draft, 0, draft.lineup[1]).ok, false);
assert.equal(ui.lineupAssignment(draft, 1, draft.lineup[0]).ok, false);
assert.equal(ui.lineupAssignment(draft, 1, 'foreign-player').ok, false);
const invalidDuplicate = D.clone(draft); invalidDuplicate.lineup[10] = invalidDuplicate.lineup[9];
assert.equal(ui.lineupAssignment(invalidDuplicate, 1, invalidDuplicate.lineup[2]).ok, false, 'a proposal leaving duplicate starters is rejected');
assert.equal(JSON.stringify(draft.lineup), beforeInvalid, 'rejected proposals leave the saved draft untouched');
// The actual drag/drop listeners replace a starter with a bench player.
const benchPlayer = draft.players.find(p => p.positionFamily !== 'GK' && !draft.lineup.includes(p.id));
const pick = descendants(editor).find(e => e.dataset.playerId === benchPlayer.id);
assert.equal(pick.draggable, true);
const transfer = { values: {}, setData(k, v) { this.values[k] = v; }, getData(k) { return this.values[k]; } };
pick.fire('dragstart', { dataTransfer: transfer });
const target = descendants(editor).find(e => e.className === 'formation-player' && Number(e.dataset.lineupSlot) === 1);
let allowed = false; target.fire('dragover', { dataTransfer: transfer, preventDefault() { allowed = true; } }); assert.equal(allowed, true);
const replaced = draft.lineup[1]; target.fire('drop', { dataTransfer: transfer, preventDefault() {} });
assert.equal(draft.lineup[1], benchPlayer.id); assert.equal(draft.lineup.includes(replaced), false); assert.equal(validate(draft).ok, true);
assert.equal(get('lineup-slot-1'), context.document.activeElement, 'assignment preserves native keyboard focus');
const groups = descendants(editor).filter(e => e.className === 'roster-group');
assert.equal(groups.length, 2);
const groupIDs = groups.map(g => descendants(g).filter(e => e.dataset.playerId).map(e => e.dataset.playerId));
assert.equal(groupIDs[0].length, 11); assert.equal(groupIDs[1].length, draft.players.length - 11);
assert.equal(new Set(groupIDs.flat()).size, draft.players.length);
assert.ok(groupIDs[1].includes(replaced)); assert.ok(!groupIDs[1].includes(benchPlayer.id));
for (let i = 0; i < 11; i++) for (const option of get('lineup-slot-' + i).children) assert.equal(draft.players.find(p => p.id === option.value).positionFamily === 'GK', i === 0, 'native options use the same canonical goalkeeper restriction');
// Invalid drag onto the GK slot is not offered as a drop target.
const freshPick = descendants(editor).find(e => e.dataset.playerId === benchPlayer.id);freshPick.fire('dragstart', { dataTransfer: transfer });
const keeperTarget = descendants(editor).find(e => e.className === 'formation-player' && Number(e.dataset.lineupSlot) === 0);allowed = false; keeperTarget.fire('dragover', { dataTransfer: transfer, preventDefault() { allowed = true; } });assert.equal(allowed, false);const beforeDrop = JSON.stringify(draft.lineup);keeperTarget.fire('drop', { dataTransfer: transfer, preventDefault() {} });assert.equal(JSON.stringify(draft.lineup), beforeDrop);
assert.ok(descendants(editor).some(e => e.className === 'team-crest'));
assert.ok(text(editor).includes('2026/27'));
assert.equal(descendants(editor).filter(e => e.className === 'kit-shirt').length, 2);
const seasonField=descendants(editor).find(e=>e.tagName==='LABEL'&&e.textContent==='Season').children[0];seasonField.value='2027/28';seasonField.fire('change');assert.ok(text(get('editorTeamIdentity')).includes('2027/28'),'source metadata reflects the edited draft');
const shirtField=descendants(editor).find(e=>e.tagName==='LABEL'&&e.textContent==='Shirt colour').children[0];shirtField.value='#334455';shirtField.fire('change');assert.ok(descendants(get('editorKitPreview')).some(e=>e.className==='kit-shirt'&&e.style['--kit-primary']==='#334455'),'kit preview uses edited cosmetic colours');
ui.renderTeams();assert.equal(descendants(library).filter(e => e.className === 'team-validation').length, 2);assert.ok(text(library).includes('2026/27'));
const bad = D.clone(teams[1]); bad.lineup[10] = bad.lineup[9];teams[1] = bad;ui.renderTeams();assert.ok(descendants(library).find(e => e.className === 'team-validation' && e.classes.has('needs-attention')));teams[1] = D.compilePack(pack).teams[1];
for (const side of ['home','away']) { const card = root(side + 'Card');card.className = 'setup-team';const name = root(side + 'Name', 'input');card.appendChild(name);for(const id of ['TeamSelect','Formation','TacticalPreset','Kit','LineupPreview']) { const e=root(side+id,id==='LineupPreview'?'ol':'select');if(id==='TeamSelect')e.value=side==='home'?teams[0].libraryId:teams[1].libraryId;card.appendChild(e); } }
teams[1] = D.clone(teams[1]); teams[1].libraryId='library-1';get('awayTeamSelect').value='library-1';root('startButton','button').appendChild(new Element('span'));root('fastSimulateButton','button');root('setupValidation');ui.applySelectedTeam('home');assert.ok(text(get('homeCard')).includes('2026/27'));
// All fixture states open a canonical detail panel without restoring or starting football.
const cup = { id: 'cup', engineBuild: TF.ENGINE_BUILD, complete: false, entrants: [teams[0], teams[1], {...teams[0],id:'third'}, {...teams[1],id:'fourth'}], fixtures: [
  { id:'done',round:1,index:0,status:'completed',homeTeamId:teams[0].id,awayTeamId:teams[1].id,seed:10,score:{home:1,away:0},reportId:'report' },
  { id:'running',round:1,index:1,status:'running',homeTeamId:'third',awayTeamId:'fourth',seed:11 },
  { id:'pending',round:2,index:2,status:'pending',homeTeamId:teams[0].id,awayFrom:'running',seed:12 }
] };
reports = [{id:'report',kind:'match',score:{home:1,away:0}}]; checkpoints = [{id:'running',savedAt:'2026-10-06T12:00:00Z',checkpoint:{core:{clock:{elapsedSeconds:2880},score:{home:2,away:1}}}}];
const cupBefore = JSON.stringify(cup), cpBefore = JSON.stringify(checkpoints), host = root('cupHost');ui.renderBracket(host,cup);
const fixtureChoices = descendants(host).filter(e => e.className === 'fixture-select');assert.equal(fixtureChoices.length, 3);
fixtureChoices[2].click();assert.ok(text(get('cupFixtureDetails')).includes('Winner of fixture 2'));assert.ok(text(get('cupFixtureDetails')).includes('12'));assert.equal(get('cupFixtureTitle'),context.document.activeElement);assert.equal(fixtureChoices[2].attrs['aria-pressed'],'true');
fixtureChoices[1].click();assert.ok(text(get('cupFixtureDetails')).includes('48′'));assert.ok(text(get('cupFixtureDetails')).includes('2 — 1'));assert.ok(descendants(get('cupFixtureDetails')).some(e => e.tagName === 'BUTTON' && e.textContent==='Continue fixture'));
fixtureChoices[0].click();assert.ok(text(get('cupFixtureDetails')).includes('1 — 0'));assert.ok(descendants(get('cupFixtureDetails')).some(e => e.tagName==='BUTTON' && e.textContent==='Match report'));
assert.equal(started,0);assert.equal(watched,0);assert.equal(JSON.stringify(cup),cupBefore);assert.equal(JSON.stringify(checkpoints),cpBefore);
const tiedCup=D.clone(cup);tiedCup.fixtures[0].regulationScore={home:1,away:1};tiedCup.fixtures[0].penaltyScore={home:5,away:4};tiedCup.fixtures[0].decisionMethod='penalties';const tiedHost=root('tiedHost');ui.renderBracket(tiedHost,tiedCup);descendants(tiedHost).filter(e=>e.className==='fixture-select')[0].click();const tiedDetail=tiedHost.children.at(-1);assert.ok(text(tiedDetail).includes('After 90 minutes · 1 — 1'));assert.ok(text(tiedDetail).includes('Penalties · 5 — 4'));
const oldCup=D.clone(cup);oldCup.engineBuild='older-build';const oldHost=root('oldCupHost');ui.renderBracket(oldHost,oldCup);const oldDetail=oldHost.children.at(-1);assert.ok(text(oldDetail).includes('original game version'));assert.equal(descendants(oldDetail).filter(e=>e.tagName==='BUTTON').length,0,'an incompatible running fixture offers no continuation or simulation');assert.equal(started,0);
// The authoritative error checkpoint overrides a still-running fixture's copy;
// selecting/retrying never mutates its locked inputs or the stored error record.
const interruptedCup=D.clone(cup);interruptedCup.status='error';interruptedCup.activeFixtureId='running';interruptedCup.error={code:'SIMULATION_ERROR',message:'Interrupted test job'};
checkpoints[0].status='error';checkpoints[0].checkpoint.status='error';
const interruptedBefore=JSON.stringify(interruptedCup),errorCPBefore=JSON.stringify(checkpoints),interruptedHost=root('interruptedHost');ui.renderBracket(interruptedHost,interruptedCup);
const interruptedDetail=interruptedHost.children.at(-1);
assert.ok(text(interruptedDetail).includes('Interrupted'));assert.ok(!text(interruptedDetail).includes('In progress'));
const retryFixtureButton=descendants(interruptedDetail).find(e=>e.tagName==='BUTTON'&&e.textContent==='Retry fixture');assert.ok(retryFixtureButton);
assert.ok(!descendants(interruptedDetail).some(e=>e.tagName==='BUTTON'&&e.textContent==='Continue fixture'));
assert.equal(JSON.stringify(interruptedCup),interruptedBefore);assert.equal(JSON.stringify(checkpoints),errorCPBefore);assert.equal(started,0);
const pausedCup=D.clone(cup);checkpoints[0].status='paused';checkpoints[0].checkpoint.status='paused';const pausedHost=root('pausedHost');ui.renderBracket(pausedHost,pausedCup);assert.ok(text(pausedHost.children.at(-1)).includes('Continue fixture'));
checkpoints[0].status='error';checkpoints[0].checkpoint.status='error';
const incompatibleErrorCup=D.clone(interruptedCup);incompatibleErrorCup.engineBuild='older-build';const incompatibleErrorHost=root('incompatibleErrorHost');ui.renderBracket(incompatibleErrorHost,incompatibleErrorCup);assert.equal(descendants(incompatibleErrorHost.children.at(-1)).filter(e=>e.tagName==='BUTTON').length,0);
// Runtime portraits resolve locked appearance assets while procedural portraits use current kits.
const configTeam = {...teams[0],assetHashes:{'portraits/face.png':'hash'}}, runtimeTeam = {...teams[0],id:'runtime-home',sourceId:teams[0].id,colors:{primary:'#112233',secondary:'#ddeeff'}};
TF.ui.currentMatch=()=>({match:{teams:[runtimeTeam,{id:'runtime-away'}]},config:{home:configTeam}});
const facePlayer = {...draft.players[1],portrait:'portraits/face.png'}; const identityBefore=D.hash(D.simulationTeam(configTeam));
const photo = TF.productUI.portrait(facePlayer,runtimeTeam);assert.equal(photo.src,'blob:stored-portrait');assert.equal(resolvedAssets.at(-1).team.assetHashes['portraits/face.png'],'hash');
const procedural = TF.productUI.portrait({...facePlayer,portrait:null},runtimeTeam);assert.ok(decodeURIComponent(procedural.src).includes('#112233'));assert.ok(decodeURIComponent(procedural.src).includes(facePlayer.appearance.skinColor));
photo.fire('error');assert.equal(photo.src,TF.appearance.portrait(facePlayer,runtimeTeam));assert.equal(D.hash(D.simulationTeam(configTeam)),identityBefore);
// Actual recorded scorer/substitution events choose the corresponding identities, not unrelated playerId.
const wrap=root('canvasWrap');wrap.className='canvas-wrap';vm.runInContext(fs.readFileSync(path.join(base,'src/studio.js'),'utf8'),context);
const match=TF.createMatch({seed:57});match.teams[0].id=runtimeTeam.id;match.teams[0].colors=runtimeTeam.colors;const scorer=match.teams[0].players[1],incoming=match.teams[0].players[12];scorer.teamId=runtimeTeam.id;incoming.teamId=runtimeTeam.id;scorer.portrait='portraits/face.png';TF.ui.currentMatch=()=>({match,config:{home:configTeam,away:teams[1]}});match.teams[0].sourceId=teams[0].id;
const rngBefore=match.rng.getState(), eventsBefore=match.events.length;TF.studio.mount(match);match.events.push({type:'goal',sequence:100,scorerId:scorer.id,playerId:incoming.id,teamId:runtimeTeam.id});TF.studio.update(match);
let overlay=get('eventOverlay');assert.ok(overlay.innerHTML.includes(scorer.name));assert.ok(!overlay.innerHTML.includes(incoming.name));assert.equal(descendants(overlay).filter(e=>e.tagName==='IMG').length,1);assert.equal(descendants(overlay).find(e=>e.tagName==='IMG').src,'blob:stored-portrait');
match.events.push({type:'substitution',sequence:101,playerOnId:incoming.id,playerOffId:scorer.id,teamId:runtimeTeam.id});TF.studio.update(match);assert.equal(descendants(overlay).filter(e=>e.tagName==='IMG').length,2);assert.ok(text(overlay).includes('ON'));assert.ok(text(overlay).includes('OFF'));assert.equal(match.rng.getState(),rngBefore);assert.equal(match.events.length,eventsBefore+2,'presentation does not manufacture events');
console.log('production UI assignment/bench, fixture state, metadata and recorded-event portraits passed');

// Typed input must reach the draft before Save, even without a blur/change event.
// Use the actual product controller, compiler and memory store rather than a save stub.
(async function verifyTypedSave() {
  const retryHandle={match:{},config:{seed:11}},previousNext=TF.product.nextCupMatch,previousWatch=TF.ui.watch;root('cupSetupPanel');TF.ui.watch=function(handle){assert.equal(handle,retryHandle);watched++;};
  TF.product.nextCupMatch=function(selected){assert.equal(selected,interruptedCup);started++;return Promise.resolve(retryHandle);};
  retryFixtureButton.click();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(started,1,'the Retry action calls the same canonical controller exactly once');assert.equal(watched,1,'the returned existing handle enters the same watch flow');
  assert.equal(JSON.stringify(interruptedCup),interruptedBefore);assert.equal(JSON.stringify(checkpoints),errorCPBefore);
  TF.product.nextCupMatch=previousNext;TF.ui.watch=previousWatch;
  for(const file of ['product-storage','product'])vm.runInContext(fs.readFileSync(path.join(base,'src',file+'.js'),'utf8'),context);
  const P=TF.product;await P.ready;ui.openEditor(P.listTeams()[0].libraryId);
  const typedDraft=ui.getDraft(), identityNode=get('editorTeamIdentity').firstChild;
  const season=descendants(editor).find(e=>e.tagName==='LABEL'&&e.textContent==='Season').children[0];
  season.value='2026/27';season.fire('input',{type:'input'});
  assert.equal(typedDraft.season,'2026/27','typed text is captured without a change/blur');
  assert.equal(get('editorTeamIdentity').firstChild,identityNode,'typing does not reconstruct the editor identity');
  const colour=descendants(editor).find(e=>e.tagName==='LABEL'&&e.textContent==='Shirt colour').children[0];
  colour.value='#345678';colour.fire('input',{type:'input'});assert.equal(typedDraft.kits.home.primary,'#345678');
  const player=typedDraft.players.find(p=>p.positionFamily!=='GK');descendants(editor).find(e=>e.className==='roster-player'&&e.dataset.playerId===player.id).click();
  const acceleration=descendants(get('playerEditor')).find(e=>e.tagName==='LABEL'&&e.textContent==='Acceleration').children[0];
  acceleration.value='73';acceleration.fire('input',{type:'input'});assert.equal(player.attributes.acceleration,73);assert.equal(typeof player.attributes.acceleration,'number');
  acceleration.fire('change',{type:'change'});assert.equal(player.attributes.acceleration,73,'subsequent change remains idempotent');
  assert.equal(get('lineup-slot-0').listeners.input,undefined,'native selectors retain their change-only assignment path');
  const saved=await P.saveTeam(typedDraft);assert.equal(saved.ok,true);
  const stored=P.getTeam(saved.team.libraryId);assert.equal(stored.season,'2026/27');assert.equal(stored.kits.home.primary,'#345678');assert.equal(stored.players.find(p=>p.id===player.id).attributes.acceleration,73);
  ui.openEditor(stored.libraryId);assert.ok(text(get('editorTeamIdentity')).includes('2026/27'),'saved season is visible after reopening');
  assert.ok(descendants(get('editorKitPreview')).some(e=>e.style['--kit-primary']==='#345678'));
  const invalid=D.clone(stored);invalid.players[0].attributes.acceleration=101;const refused=await P.saveTeam(invalid);assert.equal(refused.ok,false,'capturing input does not bypass canonical bounds');
  assert.equal(P.getTeam(stored.libraryId).players[0].attributes.acceleration,stored.players[0].attributes.acceleration,'rejected numeric input cannot replace stored data');
  console.log('typed text/number/colour input survives actual validated product save and reopen');
})().catch(e=>{console.error(e);process.exitCode=1;});
