import E from './src/engine.mjs';
import { readFileSync, existsSync } from 'node:fs';
if (!existsSync('corpus.json')) {
  console.log('corpus.json is not in this checkout. It holds real LinkedIn posts by real people, so it is kept out of the public repo.');
  console.log('Nothing to validate against. The current figures are in the README.');
  process.exit(0);
}
const corpus = JSON.parse(readFileSync('corpus.json', 'utf8'));

const rows = corpus.map(p => {
  const r = E.analyze(p.text);
  return {
    id: p.id, eng: p.eng, label: p.label, round: p.round,
    declined: !!r.sensitive,
    score: r.sensitive ? null : r.overall,
    fired: r.sensitive ? 0 : r.stats.rulesFired,
    top: r.sensitive ? [] : r.roasts.slice(0,3).map(x => x.label),
    words: r.stats.words,
    cats: r.sensitive ? {} : Object.fromEntries(r.categories.map(c => [c.key, c.suck])),
    weights: r.sensitive ? {} : Object.fromEntries(r.categories.map(c => [c.key, c.weightPct]))
  };
});

const fmt = r => `${String(r.eng ?? '-').padStart(5)}  ${r.id.padEnd(22)} ${r.declined ? 'DECLINED' : String(r.score).padStart(5)+'/10'}  ${String(r.fired).padStart(2)} fired  ${r.top.join(' | ')}`;
const byEng = (a,b) => (b.eng ?? -1) - (a.eng ?? -1);

console.log('=== HIGH PERFORMERS (should score LOW) ===');
rows.filter(r=>r.label==='high').sort(byEng).forEach(r=>console.log(fmt(r)));
console.log('\n=== LOW PERFORMERS (should score HIGH) ===');
rows.filter(r=>r.label==='low').sort(byEng).forEach(r=>console.log(fmt(r)));
console.log('\n=== EXTERNAL ===');
rows.filter(r=>r.label==='external-earnest').forEach(r=>console.log(fmt(r)));
console.log('\n=== UNLABELLED (in the correlation, not in the means) ===');
rows.filter(r=>r.label==='unlabelled').sort(byEng).forEach(r=>console.log(fmt(r)));

const hi = rows.filter(r=>r.label==='high' && !r.declined);
const lo = rows.filter(r=>r.label==='low' && !r.declined);

// ---------------------------------------------------------------------------
// statistics toolkit: plain node, no dependencies.
// ---------------------------------------------------------------------------

const mean = a => a.reduce((s,x)=>s+x,0)/a.length;
const median = a => {
  const s = [...a].sort((x,y)=>x-y), n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n-1)/2] : (s[n/2-1] + s[n/2]) / 2;
};

// Midranks: tied values all receive the average of the ranks they span.
// The no-ties shortcut 1 - 6*sum(d^2)/(n*(n^2-1)) is invalid here: the score
// distribution is roughly 90 percent ties, and sequential ranks make the
// answer depend on the order rows happen to sit in corpus.json.
const midranks = values => {
  const idx = values.map((_,i)=>i).sort((a,b)=>values[a]-values[b]);
  const out = new Array(values.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j+1 < idx.length && values[idx[j+1]] === values[idx[i]]) j++;
    const r = (i+j)/2 + 1;
    for (let k=i;k<=j;k++) out[idx[k]] = r;
    i = j + 1;
  }
  return out;
};

const pearson = (a,b) => {
  const n = a.length, ma = mean(a), mb = mean(b);
  let sa=0, sb=0, sab=0;
  for (let i=0;i<n;i++){ const da=a[i]-ma, db=b[i]-mb; sa+=da*da; sb+=db*db; sab+=da*db; }
  return (sa === 0 || sb === 0) ? NaN : sab / Math.sqrt(sa*sb);
};

// Spearman rho as Pearson on the two midrank vectors. Engagement is ranked
// descending and suckiness ascending, so a positive rho means the tool agrees
// with the audience.
const rhoOf = set => pearson(
  midranks(set.map(x=>-x.eng)),
  midranks(set.map(x=>x.score))
);

// Fisher z interval. tanh(atanh(rho) +/- 1.96/sqrt(n-3)).
const fisherCI = (rho, n) => {
  if (!(n > 3) || !isFinite(rho) || Math.abs(rho) >= 1) return [NaN, NaN];
  const z = Math.atanh(rho), se = 1/Math.sqrt(n-3);
  return [Math.tanh(z - 1.96*se), Math.tanh(z + 1.96*se)];
};

// Seeded PRNG (mulberry32) so every resampled figure below is reproducible.
const prng = seed => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const shuffle = (arr, rnd) => {
  const a = [...arr];
  for (let i=a.length-1;i>0;i--){ const j = Math.floor(rnd()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; }
  return a;
};

// AUC: probability that a flop outscores a hit, ties counted half.
const aucOf = (hits, flops) => {
  if (!hits.length || !flops.length) return NaN;
  let win = 0, tie = 0;
  for (const h of hits) for (const f of flops) { if (f > h) win++; else if (f === h) tie++; }
  return (win + 0.5*tie) / (hits.length * flops.length);
};

// An arm under MIN_ARM posts carries no read: a median of four numbers and an
// AUC over a handful of pairs print as figures and mean nothing.
const MIN_ARM = 5;

// One-sided permutation p for both group statistics, by relabelling the pooled
// scores B times. One-sided because the direction was stated before the data
// (flops should score higher); every printed p says so. p = (count at or above observed + 1) / (B + 1).
const PERMS = 5000;
const groupStats = (hitScores, flopScores, seed) => {
  const nh = hitScores.length, nl = flopScores.length;
  const out = {
    nHits: nh, nFlops: nl, pairs: nh*nl,
    sepMean: NaN, sepMedian: NaN, auc: NaN, pSep: NaN, pAuc: NaN
  };
  if (!nh || !nl) return out;
  out.sepMean = mean(flopScores) - mean(hitScores);
  out.sepMedian = median(flopScores) - median(hitScores);
  out.auc = aucOf(hitScores, flopScores);
  const pool = hitScores.concat(flopScores);
  const rnd = prng(seed);
  let geSep = 0, geAuc = 0;
  for (let b=0;b<PERMS;b++){
    const p = shuffle(pool, rnd);
    const a = p.slice(0, nh), z = p.slice(nh);
    if (mean(z) - mean(a) >= out.sepMean) geSep++;
    if (aucOf(a, z) >= out.auc) geAuc++;
  }
  out.pSep = (geSep + 1) / (PERMS + 1);
  out.pAuc = (geAuc + 1) / (PERMS + 1);
  return out;
};

// ---------------------------------------------------------------------------

const pooled = groupStats(hi.map(r=>r.score), lo.map(r=>r.score), 20260917);

console.log('\n=== VERDICT ===');
console.log('mean score, high performers:', mean(hi.map(r=>r.score)).toFixed(2), `(n=${hi.length})`);
console.log('mean score, low performers :', mean(lo.map(r=>r.score)).toFixed(2), `(n=${lo.length})`);
console.log('separation                 :', pooled.sepMean.toFixed(2), `(positive = tool agrees with the audience) (n=${hi.length} hits / ${lo.length} flops)`);
console.log('declined                   :', rows.filter(r=>r.declined).map(r=>r.id+' ('+r.eng+' eng)').join(', ') || 'none');

// rank correlation between suckiness and engagement among scored posts.
// eng != null, not truthiness: a zero-engagement post is the most informative
// flop the corpus could hold and it must stay in rho.
const scored = rows.filter(r=>r.eng != null && !r.declined);
const rho = rhoOf(scored);
const rhoCI = fisherCI(rho, scored.length);
const top10 = [...scored].sort((a,b)=>b.eng-a.eng).slice(0,10).map(r=>r.id);
const trimmed = scored.filter(r=>!top10.includes(r.id));
const rhoTrimmed = rhoOf(trimmed);
console.log('Spearman rho (eng rank vs suckiness rank):', rho.toFixed(3),
  `(n=${scored.length}, midranks, 95% CI ${rhoCI[0].toFixed(3)} to ${rhoCI[1].toFixed(3)}, Fisher z)`);
console.log('  top ten by engagement removed          :', rhoTrimmed.toFixed(3), `(n=${trimmed.length})`);

// worst offenders, cut at the engine's own band boundary rather than at 4.1,
// a constant the product deleted in Update 13.
let BAND = null, BAND_LABEL = 'sucks a normal amount';
if (typeof E.bandFor === 'function') {
  for (let v = 0; v <= 10.0001; v = Math.round((v + 0.01) * 100) / 100) {
    const b = E.bandFor(v);
    if (b && b.key !== 'barely') { BAND = v; BAND_LABEL = b.label; break; }
  }
}
if (BAND == null) BAND = 3.2; // fallback if bandFor is not exported: see src/engine.js:1894
const aboveHi = hi.filter(r=>r.score >= BAND);
const aboveLo = lo.filter(r=>r.score >= BAND);
console.log(`\n=== FALSE POSITIVES (top posts the tool put at or above "${BAND_LABEL}", ${BAND}) ===`);
aboveHi.sort((a,b)=>b.score-a.score).forEach(r=>console.log(fmt(r)));
console.log(`\n=== FALSE NEGATIVES (flop posts the tool left below "${BAND_LABEL}", ${BAND}) ===`);
lo.filter(r=>r.score < BAND).sort((a,b)=>a.score-b.score).forEach(r=>console.log(fmt(r)));
console.log(`\nabove the band: hits ${aboveHi.length}/${hi.length}, flops ${aboveLo.length}/${lo.length}`);

// ---------------------------------------------------------------------------

const noEng = rows.filter(r=>r.eng == null).length;
const unlabelledInRho = scored.filter(r=>r.label==='unlabelled').length;
const printed = rows.filter(r=>['high','low','external-earnest','unlabelled'].includes(r.label)).length;

console.log('\n=== STATISTICS ===');
console.log('corpus rows                :', rows.length);
console.log('reconciliation             :',
  `${rows.length} rows total, ${rows.filter(r=>r.declined).length} declined, ${noEng} with no engagement figure, ` +
  `${unlabelledInRho} unlabelled but in rho, ${printed} printed above, ${scored.length} correlated`);
console.log('separation (mean)          :', pooled.sepMean.toFixed(3),
  `(n=${pooled.nHits} hits / ${pooled.nFlops} flops, permutation p=${pooled.pSep.toFixed(3)} one-sided, ${PERMS} relabellings)`);
console.log('separation (median)        :', pooled.sepMedian.toFixed(3),
  `(n=${pooled.nHits} hits / ${pooled.nFlops} flops)`);
console.log('AUC (flop outscores hit)   :', pooled.auc.toFixed(3),
  `(n=${pooled.pairs} hit/flop pairs, permutation p=${pooled.pAuc.toFixed(3)} one-sided, ${PERMS} relabellings)`);
console.log('Spearman rho (midrank)     :', rho.toFixed(3),
  `(n=${scored.length}, 95% CI ${rhoCI[0].toFixed(3)} to ${rhoCI[1].toFixed(3)}, Fisher z)`);
console.log('rho, top ten removed       :', rhoTrimmed.toFixed(3), `(n=${trimmed.length})`);

// Two thirds of the rows behind rho were selected into a label for having
// extreme engagement; the unlabelled rows are the unselected middle. One
// pooled rho hides that, so both halves are printed.
{
  const tails = scored.filter(r=>r.label==='high'||r.label==='low');
  const middle = scored.filter(r=>r.label==='unlabelled');
  const engRange = a => a.length ? `${Math.min(...a.map(r=>r.eng))} to ${Math.max(...a.map(r=>r.eng))}` : 'n/a';
  const line = (name, a, note) => { const v = rhoOf(a), ci = fisherCI(v, a.length);
    console.log(`  ${name}: ${v.toFixed(3)} (n=${a.length}, 95% CI ${ci[0].toFixed(3)} to ${ci[1].toFixed(3)}, engagement ${engRange(a)}, ${note})`); };
  console.log('rho by how the row got into the sample:');
  line('labelled tails only   ', tails, 'selected on engagement');
  line('unlabelled middle only', middle, 'not selected on engagement');
}

// Held out. Round 1 is the author the omission rules were first tuned
// against, so it is training data. Every later round is the closest thing to
// an out-of-sample arm this corpus has, and it is only an upper bound: rule
// changes in later updates were found against later rows too.
{
  const FIRST = Math.min(...rows.map(r=>r.round));
  const hh = hi.filter(r=>r.round!==FIRST).map(r=>r.score), hl = lo.filter(r=>r.round!==FIRST).map(r=>r.score);
  const g = groupStats(hh, hl, 20260918);
  const later = scored.filter(r=>r.round!==FIRST), rl = rhoOf(later), rc = fisherCI(rl, later.length);
  console.log(`held out (every round after round ${FIRST}): AUC ${g.auc.toFixed(3)} (n=${g.nHits} hits / ${g.nFlops} flops, permutation p=${g.pAuc.toFixed(3)} one-sided), ` +
    `rho ${rl.toFixed(3)} (n=${later.length}, 95% CI ${rc[0].toFixed(3)} to ${rc[1].toFixed(3)})`);
}

// Which dimension carries the separation. Printed, not acted on: five tests
// on 66 labelled posts cannot rank the dimensions against each other.
{
  console.log('\nper dimension (each category\'s own number, same hits and flops):');
  const keys = Object.keys(hi[0].cats);
  keys.forEach((k, i) => {
    const g = groupStats(hi.map(r=>r.cats[k]), lo.map(r=>r.cats[k]), 20260930 + i);
    console.log(`  ${k.padEnd(13)} weight ${String(hi[0].weights[k]).padStart(2)}%  AUC ${g.auc.toFixed(3)}  median hit ${median(hi.map(r=>r.cats[k])).toFixed(1)}  median flop ${median(lo.map(r=>r.cats[k])).toFixed(1)}  p=${g.pAuc.toFixed(3)} one-sided, uncorrected for ${keys.length} tests`);
  });
}

// Per round, because the label field mixes two rules. Rounds 1 and 2 are
// author-relative ("big for this author"), round 3 is absolute (150+ reactions
// is high, 8 or fewer is low, VALIDATION_REPORT.md:182).
const ROUND_NOTES = {
  1: 'one author, author-relative labels',
  2: '30 authors, author-relative labels',
  3: '47 posts, absolute labels 150+ / 8 or fewer',
  4: 'owner-supplied regression guards'
};
// Derived from the data: a round nobody described still prints.
const ROUNDS = [...new Set(rows.map(r=>r.round))].sort((a,b)=>a-b)
  .map(n => [n, `round ${n}, ${ROUND_NOTES[n] || 'no description on file'}`]);
console.log('\nper round (the label field mixes an author-relative rule with an absolute one):');
for (const [n, desc] of ROUNDS) {
  const rh = hi.filter(r=>r.round===n).map(r=>r.score);
  const rl = lo.filter(r=>r.round===n).map(r=>r.score);
  const g = groupStats(rh, rl, 20260917 + n);
  const small = g.nHits < MIN_ARM || g.nFlops < MIN_ARM;
  const cell = v => (!isFinite(v) || small) ? (small && (g.nHits || g.nFlops) ? '   n<5' : '   n/a') : v.toFixed(3).padStart(6);
  console.log(`  ${desc}`);
  console.log(`    separation mean ${cell(g.sepMean)}  median ${cell(g.sepMedian)}  AUC ${cell(g.auc)}` +
    `  n=${g.nHits} hits / ${g.nFlops} flops` +
    (isFinite(g.pSep) && !small ? `, permutation p sep=${g.pSep.toFixed(3)} auc=${g.pAuc.toFixed(3)} one-sided` : (small && (g.nHits || g.nFlops) ? ', an arm under 5 posts carries no read' : '')));
}
{
  const g = pooled;
  console.log('  pooled, both rules together');
  console.log(`    separation mean ${g.sepMean.toFixed(3).padStart(6)}  median ${g.sepMedian.toFixed(3).padStart(6)}  AUC ${g.auc.toFixed(3).padStart(6)}` +
    `  n=${g.nHits} hits / ${g.nFlops} flops, permutation p sep=${g.pSep.toFixed(3)} auc=${g.pAuc.toFixed(3)} one-sided`);
}

// Round 3 is the only round with a stated absolute rule, so it is the only one
// that can be checked against the data. Reported, not fatal.
const r3v = rows.filter(r=>r.round===3).filter(r=>
  (r.label==='high' && r.eng != null && r.eng < 150) ||
  (r.label==='low'  && r.eng != null && r.eng > 8));
console.log('\nround 3 label rule (high means 150+ reactions, low means 8 or fewer):',
  r3v.length ? `${r3v.length} violation(s): ` + r3v.map(r=>`${r.id} ${r.label} ${r.eng}`).join(', ') : 'no violations');

// ---------------------------------------------------------------------------
// Checks. This file is the only honest measure of whether the tool works, so
// it has to be able to fail rather than just print.
// ---------------------------------------------------------------------------

const SHUFFLES = 8;
let shuffleWorst = 0, shuffleSeen = rho;
for (let s=1;s<=SHUFFLES;s++){
  const v = rhoOf(shuffle(scored, prng(1000 + s)));
  shuffleWorst = Math.max(shuffleWorst, Math.abs(v - rho));
  shuffleSeen = v;
}
const shuffleOk = shuffleWorst < 5e-7;

console.log('\n=== CHECKS ===');
console.log('thresholds: rho 95% CI lower bound must be above 0, AUC must be above 0.55,');
console.log('            rho must be identical to 6 decimals after a seeded row shuffle.');
const line = (name, val, ok) => console.log(`  ${name.padEnd(28)} ${String(val).padStart(10)}  ${ok ? 'PASS' : 'FAIL'}`);
line('rho 95% CI lower bound > 0', rhoCI[0].toFixed(3), rhoCI[0] > 0);
line('AUC > 0.55', pooled.auc.toFixed(3), pooled.auc > 0.55);
line(`row order invariance (${SHUFFLES} shuffles)`, shuffleWorst.toExponential(1), shuffleOk);
if (!shuffleOk) console.log(`  rho ${rho.toFixed(9)} vs shuffled ${shuffleSeen.toFixed(9)}`);

const failures = [];
if (!(rhoCI[0] > 0)) failures.push(`rho 95% CI lower bound ${rhoCI[0].toFixed(3)} is at or below 0`);
if (!(pooled.auc > 0.55)) failures.push(`AUC ${pooled.auc.toFixed(3)} is at or below 0.55`);
if (!shuffleOk) failures.push(`rho is not invariant to row order (max drift ${shuffleWorst.toExponential(3)})`);

if (failures.length) {
  console.log('\nFAILED: ' + failures.join('; '));
  process.exit(1);
}
console.log('\nall checks passed.');
