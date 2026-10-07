'use strict';

// Public release artifacts are built from an explicit source allowlist. In
// particular, local reports, checkpoints, logs, credentials and build output
// are never traversed or copied into a distributable.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('../src/product-data.js');
require('../src/product-import.js');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'dist', 'release');
const dirs = ['src', 'tools', 'tests', 'templates', 'agents', 'assets', 'licenses', 'docs'];
const rootFiles = [
  'README.md', 'CONTRIBUTING.md', 'SUPPORT.md', '.gitignore',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json',
  'index.html', 'tacticmesh.html', 'tabletop_football.html', 'ai_lab.html',
  'formation_lab.html', 'physics_lab.html', 'rules_lab.html', 'batch_sim.html',
  'llms.txt', 'TacticMesh_V1_Product_and_Implementation_Spec.md',
  'Tabletop Football — Comprehensive Game & Simulation Specification.md'
];
const maxFile = 200 * 1024 * 1024;
const maxExpanded = 500 * 1024 * 1024;
const maxEntries = 1000;
const maxPath = 240;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const normalize = value => value.replace(/\\/g, '/');

function walkPublic(relative, out) {
  const full = path.join(root, relative);
  const stat = fs.lstatSync(full);
  if (stat.isSymbolicLink()) throw new Error(`Public release rejects symlinks: ${relative}`);
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(full).sort()) walkPublic(`${relative}/${child}`, out);
  } else if (stat.isFile()) {
    out.set(normalize(`tacticmesh/${relative}`), new Uint8Array(fs.readFileSync(full)));
  }
}

function sourceEntries() {
  const out = new Map();
  for (const dir of dirs) if (fs.existsSync(path.join(root, dir))) walkPublic(dir, out);
  for (const file of rootFiles) if (fs.existsSync(path.join(root, file))) walkPublic(file, out);
  return out;
}

function validateEntries(entries, label) {
  if (!entries.size || entries.size > maxEntries) throw new Error(`${label}: archive entry count ${entries.size} is outside 1..${maxEntries}`);
  let expanded = 0;
  const folded = new Set();
  for (const [name, data] of entries) {
    const normalized = normalize(name);
    if (normalized.startsWith('/') || normalized.split('/').some(part => part === '..' || part === '.')) throw new Error(`${label}: unsafe archive path ${name}`);
    if (normalized.length > maxPath) throw new Error(`${label}: archive path exceeds ${maxPath} characters: ${name}`);
    const key = normalized.toLocaleLowerCase('en-US');
    if (folded.has(key)) throw new Error(`${label}: duplicate path under case-insensitive filesystems: ${name}`);
    folded.add(key);
    const size = data.byteLength;
    if (size > maxFile) throw new Error(`${label}: ${name} exceeds 200 MiB`);
    expanded += size;
  }
  if (expanded > maxExpanded) throw new Error(`${label}: expanded size exceeds 500 MiB`);
  return { fileCount: entries.size, expandedBytes: expanded };
}

function addTree(entries, relative, prefix = '') {
  const full = path.join(root, relative);
  const stat = fs.lstatSync(full);
  if (stat.isSymbolicLink()) throw new Error(`Web release rejects symlinks: ${relative}`);
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(full).sort()) addTree(entries, `${relative}/${child}`, prefix);
  } else if (stat.isFile()) {
    entries.set(normalize(`${prefix}${relative}`), new Uint8Array(fs.readFileSync(full)));
  }
}

function put(entries, name, bytes) {
  entries.set(normalize(name), new Uint8Array(bytes));
}

function builtPages() {
  const pages = ['tabletop_football.html', 'ai_lab.html', 'formation_lab.html', 'physics_lab.html', 'rules_lab.html', 'batch_sim.html'];
  const result = new Map();
  result.set('index.html', new Uint8Array(fs.readFileSync(path.join(root, 'dist', 'index.html'))));
  for (const page of pages) result.set(page, new Uint8Array(fs.readFileSync(path.join(root, 'dist', page))));
  return result;
}

function main() {
  fs.mkdirSync(releaseDir, { recursive: true });
  const source = sourceEntries();
  const sourceLimits = validateEntries(source, 'Source archive');
  const sourceZip = globalThis.TF.productImport.zip(Object.fromEntries(source));
  fs.writeFileSync(path.join(releaseDir, 'tacticmesh-source.zip'), sourceZip);

  const pages = builtPages();
  const web = new Map(pages);
  for (const dir of ['agents', 'assets', 'licenses']) if (fs.existsSync(path.join(root, dir))) addTree(web, dir);
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'tacticmesh-source.zip']) {
    const bytes = file === 'tacticmesh-source.zip' ? sourceZip : fs.readFileSync(path.join(root, file));
    put(web, file, bytes);
  }
  const webLimits = validateEntries(web, 'Itch web archive');
  for (const [name, bytes] of web) {
    if (!/\.html$/i.test(name)) continue;
    const html = Buffer.from(bytes).toString('utf8');
    const refs = [...html.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
    for (const ref of refs) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) continue;
      const pathPart = decodeURIComponent(ref.split(/[?#]/, 1)[0]);
      if (!pathPart) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), pathPart));
      if (resolved.startsWith('../') || !web.has(resolved)) throw new Error(`Itch archive has broken local reference in ${name}: ${ref}`);
    }
  }
  const webZip = globalThis.TF.productImport.zip(Object.fromEntries(web));
  fs.writeFileSync(path.join(releaseDir, 'tacticmesh-itch-web.zip'), webZip);
  fs.writeFileSync(path.join(releaseDir, 'tacticmesh-offline.html'), pages.get('index.html'));

  const kit = require('./pack-creator-kit.cjs')(root);
  const kitZip = globalThis.TF.productImport.zip(kit.entries);
  fs.writeFileSync(path.join(releaseDir, 'tacticmesh-agent-kit.zip'), kitZip);

  const starter = new Map();
  for (const file of ['agents/index.html', 'agents/manifest.json']) if (fs.existsSync(path.join(root, file))) addTree(starter, file);
  addTree(starter, 'agents/v1');
  put(starter, 'LICENSE', fs.readFileSync(path.join(root, 'LICENSE')));
  const starterLimits = validateEntries(starter, 'Pack guide and starter archive');
  const starterZip = globalThis.TF.productImport.zip(Object.fromEntries(starter));
  fs.writeFileSync(path.join(releaseDir, 'tacticmesh-pack-starters.zip'), starterZip);

  const identity = require('./engine-version.cjs');
  const version = require('./version.cjs');
  const outputs = ['tacticmesh-source.zip', 'tacticmesh-itch-web.zip', 'tacticmesh-offline.html', 'tacticmesh-agent-kit.zip', 'tacticmesh-pack-starters.zip'];
  const artifacts = Object.fromEntries(outputs.map(file => {
    const bytes = fs.readFileSync(path.join(releaseDir, file));
    return [file, { bytes: bytes.length, sha256: sha256(bytes) }];
  }));
  const manifest = {
    format: 'tacticmesh-public-release-v1',
    status: 'prepared-not-published',
    applicationBuild: version,
    engineBuild: identity.engineBuild,
    sourceEngineBuild: identity.sourceEngineBuild,
    coreBuild: identity.coreBuild,
    sourceArchiveLimits: sourceLimits,
    itchWebArchiveLimits: webLimits,
    packGuideArchiveLimits: starterLimits,
    webEntry: 'index.html',
    artifacts
  };
  fs.writeFileSync(path.join(releaseDir, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(releaseDir, 'SHA256SUMS'), outputs.map(file => `${artifacts[file].sha256}  ${file}`).join('\n') + '\n');
  console.log(`Prepared ${outputs.length} public artifacts for ${version} / ${identity.engineBuild}; output ${path.relative(root, releaseDir)}.`);
}

main();
