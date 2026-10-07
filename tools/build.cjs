const fs = require('fs');
const path = require('path');
const version = require('./version.cjs');

const root = path.resolve(__dirname, '..');
const ordered = [
  'src/core.js', 'src/analysis.js', 'src/world.js', 'src/tactics.js', 'src/intelligence.js',
  'src/physics.js', 'src/rules.js', 'src/telemetry.js', 'src/replay.js',
  'src/audio.js', 'src/camera.js', 'src/renderer.js', 'src/product-appearance.js', 'src/product-data.js', 'src/engine-facade.js',
  'src/product-import.js', 'src/product-storage.js', 'src/product-reports.js', 'src/product-cup.js',
  'src/product-runner.js', 'src/product.js', 'src/studio.js', 'src/ui.js', 'src/product-ui.js', 'src/labs.js'
];
for (const file of ordered) if (!fs.existsSync(path.join(root,file))) throw new Error('Required runtime module missing: '+file);
const scripts = ordered
  .map(file => `\n/* ${file} */\n${fs.readFileSync(path.join(root, file), 'utf8')}`)
  .join('\n');
const identity = require('./engine-version.cjs');
const engineBuild = identity.engineBuild;
const licenseNotice = fs.readFileSync(path.join(root,'LICENSE'),'utf8');
const workerFiles = ordered.slice(0,8).concat(['src/product-data.js','src/engine-facade.js']).filter(file => fs.existsSync(path.join(root,file)));
const workerSource = 'globalThis.TF={VERSION:'+JSON.stringify(version)+',ENGINE_BUILD:'+JSON.stringify(engineBuild)+',CORE_BUILD:'+JSON.stringify(identity.coreBuild)+',SOURCE_ENGINE_BUILD:'+JSON.stringify(identity.sourceEngineBuild)+',LEGACY_SOURCE_ENGINE_BUILD:'+JSON.stringify(identity.legacySourceEngineBuild)+'};\n' + workerFiles.map(file => fs.readFileSync(path.join(root,file),'utf8')).join('\n');
const packCreator = require('./pack-creator-kit.cjs')(root);
const runtime = `\n/*\n${licenseNotice}\n*/\n/* source fingerprint: ${version} */\nwindow.TF = window.TF || {};\nwindow.TF.VERSION = ${JSON.stringify(version)};\nwindow.TF.ENGINE_BUILD = ${JSON.stringify(engineBuild)};\nwindow.TF.CORE_BUILD = ${JSON.stringify(identity.coreBuild)};\nwindow.TF.SOURCE_ENGINE_BUILD = ${JSON.stringify(identity.sourceEngineBuild)};\nwindow.TF.LEGACY_SOURCE_ENGINE_BUILD = ${JSON.stringify(identity.legacySourceEngineBuild)};\nwindow.TF.ENGINE_WORKER_SOURCE = ${JSON.stringify(workerSource)};\nwindow.TF.PACK_CREATOR = ${JSON.stringify(packCreator)};\n${scripts}`;
const css = fs.readFileSync(path.join(root, 'src/app.css'), 'utf8');
const pages = [
  ['index.html', 'tabletop_football.html'],
  ...['ai_lab.html', 'formation_lab.html', 'physics_lab.html', 'rules_lab.html', 'batch_sim.html']
    .map(page => [`templates/${page}`, page])
];

for (const [templatePath, outputPath] of pages) {
  const source = fs.readFileSync(path.join(root, templatePath), 'utf8');
  if (!source.includes('/*__APP_CSS__*/') || !source.includes('/*__APP_JS__*/')) {
    throw new Error(`${templatePath} must contain the CSS and JS build placeholders`);
  }
  const assetURL = (file,mime) => 'data:'+mime+';base64,'+fs.readFileSync(path.join(root,file)).toString('base64');
  const mainPage = templatePath === 'index.html';
  const pageCss = css.replaceAll('/*__HERO_URL__*/', mainPage ? assetURL('assets/brand/tacticmesh-hero.webp','image/webp') : 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E');
  const pageSource = source.replaceAll('/*__LOGO_URL__*/',mainPage ? assetURL('assets/brand/tacticmesh-logo.webp','image/webp') : '').replaceAll('/*__ICON_URL__*/',mainPage ? assetURL('assets/brand/favicon-192.png','image/png') : '').replaceAll('/*__FAVICON_URL__*/',mainPage ? assetURL('assets/brand/favicon-32.png','image/png') : '');
  const safeRuntime = runtime.replace(/<\/script/gi, '<\\/script');
  const html = pageSource.replace('/*__APP_CSS__*/', () => pageCss).replace('/*__APP_JS__*/', () => safeRuntime);
  fs.writeFileSync(path.join(root, outputPath), html);
}
fs.copyFileSync(path.join(root,'tabletop_football.html'),path.join(root,'tacticmesh.html'));
const dist = path.join(root,'dist');
fs.mkdirSync(dist,{recursive:true});
fs.copyFileSync(path.join(root,'tacticmesh.html'),path.join(dist,'index.html'));
for (const [,file] of pages) fs.copyFileSync(path.join(root,file),path.join(dist,file));
for (const file of ['tacticmesh.html','LICENSE','THIRD_PARTY_NOTICES.md','llms.txt']) if(fs.existsSync(path.join(root,file))) fs.copyFileSync(path.join(root,file),path.join(dist,file));
if(fs.existsSync(path.join(root,'assets'))) fs.cpSync(path.join(root,'assets'),path.join(dist,'assets'),{recursive:true});
if(fs.existsSync(path.join(root,'licenses'))) fs.cpSync(path.join(root,'licenses'),path.join(dist,'licenses'),{recursive:true});
const manifestPath=path.join(root,'agents/manifest.json');if(fs.existsSync(manifestPath)){const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));Object.assign(manifest,{applicationBuild:version,engineBuild:engineBuild,coreBuild:identity.coreBuild,sourceEngineBuild:identity.sourceEngineBuild,legacySourceEngineBuild:identity.legacySourceEngineBuild});fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');}
if(fs.existsSync(path.join(root,'agents'))) fs.cpSync(path.join(root,'agents'),path.join(dist,'agents'),{recursive:true});
console.log(`Built tabletop_football.html with ${ordered.filter(f => fs.existsSync(path.join(root, f))).length} runtime modules.`);
