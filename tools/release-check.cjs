const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const run = (command, args) => childProcess.execFileSync(command, args, { cwd: root, stdio: 'inherit' });
const runtimeFiles = fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js')).map(name => path.join('src', name));
const pages = ['tabletop_football.html', 'ai_lab.html', 'formation_lab.html', 'physics_lab.html', 'rules_lab.html', 'batch_sim.html'];

// Product tests write bounded reports under .project/reports. Create that
// runtime-only directory in a clean source checkout before running them.
fs.mkdirSync(path.join(root, '.project', 'reports'), { recursive: true });
run(process.execPath, ['tools/build.cjs']);
for (const file of runtimeFiles) run(process.execPath, ['--check', file]);

for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  if (!html.includes('<script>') || !html.includes('<style>')) throw new Error(`${page} is missing embedded runtime/style`);
  if (html.includes('/*__APP_JS__*/') || html.includes('/*__APP_CSS__*/')) throw new Error(`${page} still has build placeholders`);
  if (/<script\b[^>]*\bsrc\s*=|<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref\s*=/i.test(html)) throw new Error(`${page} depends on an external script or stylesheet`);
  if (/<(?:img|audio|video|source)\b[^>]*\bsrc\s*=\s*["']?https?:|url\(\s*["']?(?:https?:)?\/\//i.test(html)) throw new Error(`${page} references an external runtime asset`);
  for (const module of runtimeFiles) {
    const source = fs.readFileSync(path.join(root, module), 'utf8');
    if (!html.includes(source.replace(/<\/script/gi, '<\\/script'))) throw new Error(`${page} does not contain current ${module}`);
  }
}

run(process.execPath, ['tests/product-build.cjs']);
for(const test of ['product-contracts','product-schema','product-worker','product-images','product-reports','product-cli','product-checkpoints','product-competition']) run(process.execPath,['tests/'+test+'.cjs']);
run(process.execPath, ['tools/run-tests.cjs']);
run(process.execPath, ['tools/pack-release.cjs']);
console.log('Release check passed: syntax, embedded offline runtime, current modules, behavioral smoke checks, lab startup, and repeat-build lab refresh.');
