import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import E from './src/engine.mjs';

const POSTS = [
  "Excited to announce I'm joining TechCorp as Senior Analytics Manager! Grateful for this opportunity and can't wait to make an impact. Thanks to everyone who believed in me 🙌🙌",
  "In today's fast-paced digital landscape, organizations must leverage data-driven insights to unlock transformative value across the ecosystem. Our cross-functional team has been aligning on a robust, best-in-class framework that operationalizes actionable insights at scale — a true game-changer for stakeholders moving forward. Thoughts?",
  "We ran an A/B test on the onboarding flow for six weeks. 41,000 users. The variant I was certain about lost by 3 points.\n\nI was wrong about which one would win.",
  "🚀 BIG NEWS 🚀\n\nHumbled and grateful to announce my new chapter!\n\nLet that sink in.\n\n✅ Stay hungry\n✅ Leverage your network\n\nAgree? Comment YES below 👇\n\n#leadership #growth"
];

// No hardcoded machine path: resolve public/index.html relative to this
// file's own directory, so this runs unmodified on any checkout/OS.
const indexUrl = pathToFileURL(resolve(import.meta.dirname, 'public/index.html')).href;

const b = await chromium.launch();
const p = await b.newPage();
await p.goto(indexUrl);

let ok = true;
for (const [i, post] of POSTS.entries()) {
  const node = E.analyze(post);
  const browser = await p.evaluate(t => {
    const r = window.YourPostSucks.analyze(t);
    return { overall: r.overall, fired: r.stats.rulesFired, cats: r.categories.map(c => c.score) };
  }, post);
  const match = node.overall === browser.overall &&
                node.stats.rulesFired === browser.fired &&
                JSON.stringify(node.categories.map(c => c.score)) === JSON.stringify(browser.cats);
  if (!match) ok = false;
  console.log(`${match ? 'MATCH' : 'DRIFT'}  post ${i}: node ${node.overall}/${node.stats.rulesFired} vs browser ${browser.overall}/${browser.fired}`);
}
console.log(ok ? '\nclient and server engines agree — fallback is safe' : '\nENGINE DRIFT — fallback would show different numbers');
await b.close();
process.exit(ok ? 0 : 1);
