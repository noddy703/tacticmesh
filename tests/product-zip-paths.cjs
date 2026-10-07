'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
require('../src/product-data.js');require('../src/product-import.js');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tacticmesh-zip-paths-'));
const original='Tabletop Football — Comprehensive Game & Simulation Specification.md';
const entries={};entries['tacticmesh/'+original]=new Uint8Array(fs.readFileSync(path.join(root,original)));
entries['tacticmesh/Unicode — Café/日本語.md']='Unicode names preserve their exact UTF-8 text.\n';
try {
  const bytes=global.TF.productImport.zip(entries),view=new DataView(bytes.buffer),archive=path.join(temp,'source.zip');
  fs.writeFileSync(archive,bytes);
  assert.equal(view.getUint32(0,true),0x04034b50);assert.equal(view.getUint16(6,true)&0x800,0x800);
  const central=Buffer.from(bytes).indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  assert.ok(central>0);assert.equal(view.getUint16(central+4,true)>>>8,3,'Unix creator avoids Apple unzip DOS filename conversion');
  assert.equal(view.getUint16(central+8,true)&0x800,0x800);
  assert.equal(view.getUint32(central+38,true)>>>16,0o100644);
  const extracted=path.join(temp,'extracted'),result=cp.spawnSync('unzip',['-q',archive,'-d',extracted],{encoding:'utf8'});
  if(result.error&&result.error.code==='ENOENT') {
    console.log('ZIP UTF-8/Unix filename metadata passed; native unzip roundtrip unavailable on this environment.');
  } else {
    assert.equal(result.status,0,result.stderr);
    for(const [name,data]of Object.entries(entries))assert.deepEqual(fs.readFileSync(path.join(extracted,name)),Buffer.from(data instanceof Uint8Array?data:new TextEncoder().encode(data)));
    console.log('Native unzip extracts the original Unicode specification path and multilingual paths with exact contents.');
  }
} finally {fs.rmSync(temp,{recursive:true,force:true});}
