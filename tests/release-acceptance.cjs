const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tabletop-release-'));
const copy = (relative) => fs.cpSync(path.join(root, relative), path.join(temp, relative), { recursive: true });

try {
  for (const entry of [
    'index.html', 'templates', 'src', 'tools', 'package.json', 'package-lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
    'llms.txt', 'assets', 'licenses', 'agents'
  ]) copy(entry);
  const build = () => childProcess.execFileSync(process.execPath, ['tools/build.cjs'], { cwd: temp, stdio: 'pipe' });
  build();

  const marker = `/* release-repeat-build-${process.pid} */`;
  const labsPath = path.join(temp, 'src/labs.js');
  fs.appendFileSync(labsPath, `\n${marker}\n`);
  build();

  for (const page of ['ai_lab.html', 'formation_lab.html', 'physics_lab.html', 'rules_lab.html', 'batch_sim.html']) {
    const html = fs.readFileSync(path.join(temp, page), 'utf8');
    assert(html.includes(marker), `${page} did not receive the updated lab source on the second build`);
    assert(!html.includes('/*__APP_JS__*/'), `${page} retained the JavaScript placeholder`);
    assert(!html.includes('/*__APP_CSS__*/'), `${page} retained the CSS placeholder`);
  }

  const batch = fs.readFileSync(path.join(temp, 'batch_sim.html'), 'utf8');
  assert(batch.includes('id="batchMode"'), 'batch page is missing its match-length selector');
  assert(batch.includes('value="2700" selected'), 'full regulation must be the batch default');
  console.log('Release acceptance passed: repeated builds refresh all lab pages from source templates.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
