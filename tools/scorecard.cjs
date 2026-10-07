const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const version = require('./version.cjs');
const root = path.resolve(__dirname, '..');
function args(name) { const out = []; for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === '--' + name && process.argv[i + 1]) out.push(process.argv[++i]); return out; }
function arg(name, fallback) { const values = args(name); return values.length ? values[values.length - 1] : fallback; }
function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function keyValues(name) {
  const out = {};
  args(name).forEach(value => { const i = value.indexOf('='); if (i > 0) out[value.slice(0, i)] = value.slice(i + 1); });
  return out;
}
const sourceHash = version;
const dimensions = [
  ['Possession Intelligence', 'Complete 100+ seeded possession scenarios and report meaningful chain retention, net advancement, actual line breaks, pressure escapes, valuable-space entries and repeat-loop penalties.'],
  ['Off-Ball Intelligence', 'Measure support-option creation, onside timed runs, target stability and static-support failure across controlled attack and transition scenarios.'],
  ['Defensive Cohesion', 'Measure team shape clustering, central cover during pressing, coordinated pressure count and recovery shape under seeded attacks.'],
  ['Transition Intelligence', 'Measure first actions and forward support after turnovers, plus opposing recovery shape over both attack directions.'],
  ['Goalkeeper Intelligence', 'Run paired keeper-role trajectory, sweep, collection, save and restart scenarios with identical shots and player profiles.'],
  ['Physics Realism', 'Compare deterministic pass, shot, bounce, contact and save traces against physical bounds and manually reviewed trajectories.'],
  ['Statistical Realism', 'Review complete distributions from at least 10,000 full-regulation seeded matches against one selected competition-season reference.'],
  ['Visual Readability', 'Review representative scenes at target viewport sizes for player separation, ball visibility, phase recognition and event readability.'],
  ['Rules Correctness', 'Run the complete rules case library across direction-mirrored restarts, offside, advantage, cards, substitutions, goalkeeper laws and clock boundaries.']
];
const evidencePaths = args('evidence');
const evidence = evidencePaths.map(evidencePath => {
  const raw = fs.readFileSync(path.resolve(evidencePath));
  let data = null;
  try { data = JSON.parse(raw.toString('utf8')); } catch (_) { data = null; }
  const evidenceSourceHash = data && (data.sourceHash || data.engineVersion || data.sourceVersion) || null;
  const fileName = path.basename(evidencePath);
  const inferredKind = fileName.includes('possession') || fileName.includes('full-11') ? 'possession-matrix'
    : fileName.includes('physics') ? 'physics-evidence'
    : fileName.includes('integration') ? 'integration-evidence'
    : fileName.includes('presentation') ? 'presentation-evidence'
    : fileName.includes('rules') ? 'rules-evidence'
    : fileName.includes('intelligence') ? 'intelligence-evidence'
    : fileName.includes('tactics') ? 'tactics-evidence' : 'document-evidence';
  return {
    path: evidencePath,
    sha256: sha256(raw),
    kind: data && data.kind || (data && data.matrixMode ? 'possession-matrix' : inferredKind),
    sourceHash: evidenceSourceHash,
    sourceMatch: evidenceSourceHash === sourceHash,
    limitation: !evidenceSourceHash ? 'source hash is not embedded' : evidenceSourceHash !== sourceHash ? `source snapshot ${evidenceSourceHash}` : null,
    shortenedForTesting: !!(data && (data.shortenedForTesting || data.fullRegulation === false))
  };
});
evidence.forEach(item => { if (item.shortenedForTesting) item.limitation = [item.limitation, 'shortened-for-testing; exploratory only'].filter(Boolean).join('; '); delete item.shortenedForTesting; });
const matchingEvidence = evidence.filter(item => item.sourceMatch);
const gradeByDimension = keyValues('grade');
const confidenceByDimension = keyValues('confidence');
const evidenceByDimension = {};
args('dimension-evidence').forEach(value => {
  const i = value.indexOf('='); if (i < 1) return;
  const name = value.slice(0, i), evidencePath = value.slice(i + 1);
  (evidenceByDimension[name] || (evidenceByDimension[name] = [])).push(evidencePath);
});
const previousFile = path.resolve(arg('history', '.project/reports/scorecard-history.json'));
let history = [];
if (fs.existsSync(previousFile)) {
  const parsed = JSON.parse(fs.readFileSync(previousFile, 'utf8'));
  history = Array.isArray(parsed.builds) ? parsed.builds : [];
}
const previous = history.length ? history[history.length - 1] : null;
const report = {
  kind: 'football-quality-scorecard', engineVersion: sourceHash, sourceHash,
  gradeType: Object.keys(gradeByDimension).length ? 'editorial-provisional-coverage-judgment' : 'unscored-evidence-index',
  generatedAt: new Date().toISOString(), scoreScale: '0–100 when scored; null means evidence is insufficient for a defensible numeric score.',
  experimentalMethod: {
    evidence,
    evidenceStatus: evidence.length === 0 ? 'not-supplied' : Object.keys(gradeByDimension).length ? (matchingEvidence.length ? 'editorial provisional judgment; source-matched and historical evidence are listed per item' : 'editorial provisional judgment; evidence is historical or unversioned') : matchingEvidence.length ? 'source-match; dimensions remain unscored pending required coverage' : 'stale-or-unversioned-not-used',
    confidenceRule: Object.keys(gradeByDimension).length ? 'Provisional scores are editorial judgments using the declared coverage rubric and the linked evidence. Source matches are marked individually; historical or unversioned artifacts are not treated as current-source measurements. These scores are not automated statistical estimates, calibrated ratings, or acceptance decisions.' : 'Confidence is qualitative. Final numeric scoring requires a source-hash-matched, repeatable experiment and a predeclared rubric. A single short match cannot support a statistical score.',
    runEnvironment: { node: process.version, platform: process.platform, release: os.release(), arch: os.arch, cpu: (os.cpus()[0] || {}).model || 'unknown' }
  },
  scoreMethod: 'Provisional review rubric: 0–19 repeated critical failure/absent behavior; 20–39 narrow implementation evidence with a major acceptance gap; 40–59 partial controlled success with important gaps; 60–79 repeated focused success but incomplete breadth; 80–100 requires broad, source-matched behavior and reference evidence. Scores here are provisional and cannot close acceptance or balance gates.',
  dimensions: dimensions.map(([name, method]) => {
    const explicit = evidenceByDimension[name];
    const related = explicit ? evidence.filter(item => explicit.includes(item.path)) : matchingEvidence.filter(item => {
      if (name === 'Statistical Realism') return item.kind === 'batch-simulation';
      if (name === 'Possession Intelligence') return item.kind === 'possession-matrix' || item.kind === 'batch-simulation';
      if (name === 'Off-Ball Intelligence' || name === 'Defensive Cohesion' || name === 'Transition Intelligence' || name === 'Goalkeeper Intelligence') return ['possession-matrix', 'batch-simulation', 'tick-benchmark', 'integration-evidence', 'intelligence-evidence', 'tactics-evidence', 'physics-evidence'].includes(item.kind);
      if (name === 'Physics Realism') return item.kind === 'physics-evidence' || item.kind === 'integration-evidence';
      if (name === 'Visual Readability') return item.kind === 'presentation-evidence' || item.kind === 'visual-review';
      return item.kind === 'rules-evidence' || item.kind === 'physics-evidence';
    });
    const score = gradeByDimension[name] == null ? null : Number(gradeByDimension[name]);
    return { name, score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null, status: Number.isFinite(score) ? 'provisional' : 'unscored', confidence: confidenceByDimension[name] || (Number.isFinite(score) ? 'low; mixed or incomplete evidence' : 'insufficient evidence'), method, evidence: related.map(item => ({ path: item.path, sha256: item.sha256, sourceHash: item.sourceHash, sourceMatch: item.sourceMatch, limitation: item.limitation })) };
  }),
  comparison: { previousSourceHash: previous && previous.sourceHash || null, sameSource: !!previous && previous.sourceHash === sourceHash, deltas: null },
  stabilityClaim: false,
  nextEvidenceNeeded: Object.keys(gradeByDimension).length ? 'Complete the remaining source-matched §126 scenario coverage and repeat full-regulation samples. Choose one competition-season reference for statistical comparison and review the required 10,000-full-regulation-match distributions before making a stability claim. Record reviewer evidence and any score changes; these provisional grades do not close acceptance gates.' : 'Attach repeatable, source-matched scenario and batch artifacts, then apply an explicitly recorded scoring rubric.'
};
const sameIndex = history.findIndex(item => item.sourceHash === sourceHash);
if (sameIndex >= 0) history[sameIndex] = report;
else history.push(report);
const historyOut = { kind: 'football-quality-scorecard-history', latestSourceHash: sourceHash, builds: history };
fs.mkdirSync(path.dirname(previousFile), { recursive: true });
fs.writeFileSync(previousFile, JSON.stringify(historyOut, null, 2) + '\n');
const out = arg('out', null);
if (out) fs.writeFileSync(path.resolve(out), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
