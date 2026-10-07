'use strict';
const assert = require('assert/strict'), fixture = require('./fixtures/keeper-contact-sequences.json');
for (const name of ['core','analysis','world','tactics','intelligence','physics','rules','telemetry','product-data','engine-facade','product-reports']) require('../src/'+name+'.js');
const TF=global.TF, R=TF.productReports, teams=TF.productData.compilePack(TF.productData.starterPack()).teams;
const h=TF.engine.createMatch({matchId:'keeper-continuity-fixture',seed:20261014,home:teams[0],away:teams[1],halfSeconds:2700});
const home=h.match.teams[0], away=h.match.teams[1], keeper=away.activePlayers.find(p=>p.isGoalkeeper);
const shooter=home.activePlayers.find(p=>p.role==='RW'), defender=away.activePlayers.find(p=>p.role==='RB');
const ids={'home-p09':shooter.id,'away-p01':keeper.id,'away-p02':defender.id};
const originalRead=TF.engine.readEvents;
function reduce(pattern) {
  const events=pattern.map((raw,i)=>{
    const e={...raw,sequence:i+1,period:1,periodSeconds:raw.time||0};
    for(const key of ['playerId','keeperId','shotBy','shotPlayerId','scorerId']) if(e[key])e[key]=ids[e[key]]||e[key];
    if(e.teamId)e.teamId=e.teamId==='home'?home.id:away.id;
    return e;
  });
  TF.engine.readEvents=()=>({events}); h.match.clock.elapsedSeconds=2102;
  const result=R.reduce(h); return {result,row:result.players.find(p=>p.id===keeper.id)};
}
try {
  for(const key of ['directParryGoal','secondDirectParryGoal']) {
    const {row}=reduce(fixture.cases[key]);
    assert.equal(row.stats.keeperShotContacts,1);assert.equal(row.stats.shotStops,0);assert.equal(row.stats.saves,null);
    assert.ok(!row.rating.ledger.some(l=>l.component==='shotStops'));
  }
  const rebound=reduce(fixture.cases.parryControlThenNewShotGoal);
  assert.equal(rebound.row.stats.shotStops,1);assert.equal(rebound.row.stats.keeperShotContacts,1);
  assert.ok(rebound.row.rating.ledger.some(l=>l.component==='shotStops'&&l.value>0));
  const own=reduce(fixture.cases.defenderControlThenOwnGoal);
  assert.equal(own.row.stats.shotStops,1);
  assert.equal(own.result.players.find(p=>p.id===shooter.id).stats.goals,0,'stale shotPlayerId must never override the source null scorer');
  assert.equal(own.result.players.find(p=>p.id===defender.id).stats.goals,0);
  const caught=reduce(fixture.cases.caught);assert.equal(caught.row.stats.shotStops,1);assert.equal(caught.row.stats.keeperShotContacts,1);
  const repeated=fixture.cases.parryControlThenNewShotGoal.slice(0,3);
  repeated.splice(2,0,{...repeated[1],tick:repeated[1].tick+1,time:repeated[1].time+1/60});
  const twice=reduce(repeated);assert.equal(twice.row.stats.keeperShotContacts,2);assert.equal(twice.row.stats.shotStops,1);
  const unresolved=reduce(fixture.cases.directParryGoal.slice(0,2));assert.equal(unresolved.row.stats.keeperShotContacts,1);assert.equal(unresolved.row.stats.shotStops,0);
  const pens=reduce([{type:'penalty-shootout-start',tick:1,time:0},...fixture.cases.caught]);
  assert.equal(pens.row.stats.keeperShotContacts,0);assert.equal(pens.row.stats.shotStops,0);
  assert.equal(pens.row.stats.saves,null);
  const aggregate=R.aggregate([{ratingModelVersion:R.ratingModelVersion,keeperMetricsModelVersion:R.keeperMetricsModelVersion,players:[rebound.row,caught.row]}]);
  assert.equal(aggregate.players[0].shotStops,2);assert.equal(aggregate.players[0].keeperShotContacts,2);assert.equal(aggregate.players[0].saves,null);
  const legacy={ratingModelVersion:'tm-event-rating-1',players:[{...caught.row,stats:{...caught.row.stats,saves:32}}]};
  const before=JSON.stringify(legacy);R.aggregate([legacy]);assert.equal(JSON.stringify(legacy),before,'historical values must remain untouched');
  const legacyPlayer={...caught.row,minutes:90,stats:{...caught.row.stats,goals:3,assists:1,saves:32},rating:{...caught.row.rating,value:8,modelVersion:'tm-event-rating-1'}};
  const modernPlayer={...caught.row,minutes:45,stats:{...caught.row.stats,goals:1,assists:2,shotStops:2,keeperShotContacts:2},rating:{...caught.row.rating,value:7}};
  const legacyReport={ratingModelVersion:'tm-event-rating-1',players:[legacyPlayer]},modernReport={ratingModelVersion:R.ratingModelVersion,keeperMetricsModelVersion:R.keeperMetricsModelVersion,players:[modernPlayer]};
  const unchanged=JSON.stringify(legacyReport),mixed=R.aggregate([legacyReport,modernReport]).players[0];
  assert.equal(mixed.goals,4);assert.equal(mixed.assists,3);assert.equal(mixed.minutes,135);assert.equal(mixed.appearances,2);
  assert.equal(mixed.shotStops,null);assert.equal(mixed.saves,null);assert.equal(mixed.keeperShotContacts,34);
  assert.equal(mixed.averageRating,null);assert.equal(mixed.ratingMinutes,45);
  assert.deepEqual(mixed.ratingsByModel,[{modelVersion:'tm-event-rating-1',ratedMinutes:90,averageRating:8},{modelVersion:'tm-event-rating-2',ratedMinutes:45,averageRating:null}]);
  const enough=R.aggregate([legacyReport,modernReport,modernReport]).players[0];assert.equal(enough.averageRating,7);assert.equal(enough.ratingMinutes,90);
  const unknown=R.aggregate([{ratingModelVersion:'unknown-model',players:[legacyPlayer]},modernReport]).players[0];assert.equal(unknown.keeperShotContacts,null,'unrecognized numeric legacy saves must not be relabelled as contact evidence');
  assert.equal(JSON.stringify(legacyReport),unchanged);
  assert.equal(R.ratingModelVersion,'tm-event-rating-2');assert.equal(R.keeperMetricsModelVersion,'tm-keeper-shot-continuity-1');
  console.log('Archived parry-goal, rebound/control, own-goal, repeated/caught/unresolved contacts, shootout exclusion and nullable cup keeper metrics passed.');
} finally {TF.engine.readEvents=originalRead;}
