'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),kit=require('../tools/pack-creator-kit.cjs')(root),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tm-agent-kit-'));
try{for(const [file,text] of Object.entries(kit.entries)){const dest=path.join(temp,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,text);}for(const f of ['pack.schema.json','attributes.json','formations.json','examples/minimal-fictional-pack.json'])assert.equal(kit.entries['agents/v1/'+f],fs.readFileSync(path.join(root,'agents/v1',f),'utf8'));
const validate=file=>cp.spawnSync(process.execPath,['tools/validate-pack.cjs','--pack',file],{cwd:temp,encoding:'utf8'});
let run=validate('./agents/v1/examples/minimal-fictional-pack.json');assert.equal(run.status,0,run.stderr+run.stdout);assert.equal(JSON.parse(run.stdout).ok,true);
const bad=JSON.parse(kit.entries['agents/v1/examples/minimal-fictional-pack.json']);bad.teams[0].players[0].attributes={invented:88};fs.writeFileSync(path.join(temp,'bad.json'),JSON.stringify(bad));run=validate('./bad.json');assert.equal(run.status,1);assert.equal(JSON.parse(run.stdout).ok,false);assert.match(run.stdout,/UNKNOWN_ATTRIBUTE/);
fs.writeFileSync(path.join(temp,'oversize.json'),' '.repeat(8*1024*1024+1));run=validate('./oversize.json');assert.equal(run.status,1);assert.match(run.stdout,/JSON_TOO_LARGE/);assert.ok(kit.prompt.includes('node tools/validate-pack.cjs --pack ./pack.json'));console.log('Agent kit: exact contracts, independent legal XI validation, unknown attribute rejection, 8 MiB JSON limit passed.');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
