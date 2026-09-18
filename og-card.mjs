// Regenerates public/og-card.png, the static link-preview image.
// Run it after any change to the rule count, the bands or the card design:
//   node og-card.mjs
// Nothing on the card is typed by hand. The page analyzes its own "Thought
// leader" specimen and this script reads the score, the band word and the
// ramp colour off the rendered report, so the bands and colour thresholds
// live in one place (shell.html and the engine) and cannot drift from here.
// The check count is YPS.RULES.length, and the layout follows drawCard(): a
// band label in words, the scale stated in words, a strip with no tick.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

const here = import.meta.dirname;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(pathToFileURL(join(here, 'public', 'index.html')).href);
await p.click('[data-spec="1"]');
// Opened from disk there is no API, so the page falls back to its local engine.
await p.waitForSelector('#report:not([hidden]) .hero .num', { timeout: 30000 });
await p.waitForTimeout(1500); // let the count-up finish
const out = await p.evaluate(() => {
  const YPS = window.YourPostSucks;
  const numEl = document.querySelector('.hero .num');
  const r = { overall: parseFloat(numEl.textContent) };
  const label = document.querySelector('.hero .band').textContent.trim();
  const W = 1200, H = 630;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  const col = getComputedStyle(numEl).color;
  g.fillStyle = '#0d0d0d'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#1a1a19'; g.fillRect(40, 40, W - 80, H - 80);
  g.strokeStyle = '#2c2c2a'; g.lineWidth = 2; g.strokeRect(41, 41, W - 82, H - 82);
  g.fillStyle = '#ffffff'; g.font = '600 30px ' + MONO; g.fillText('yourpost', 84, 116);
  const wm = g.measureText('yourpost').width;
  g.fillStyle = '#898781'; g.fillText('.sucks', 84 + wm, 116);
  g.font = '17px ' + MONO; g.fillText('POST QUALITY ASSURANCE', 84, 150); // same kicker as drawCard() in shell.html
  g.font = '22px ' + MONO; g.fillText(label.toUpperCase(), 84, 232);
  g.fillStyle = col; g.font = '650 150px ' + SANS; g.fillText(r.overall.toFixed(1), 84, 358);
  g.fillStyle = '#898781'; g.font = '18px ' + MONO; g.fillText('0 IMMACULATE · 10 UNSALVAGEABLE', 84, 388);
  const bx = 84, by = 404, bw = W - 168, bh = 12;
  g.fillStyle = '#141413'; g.fillRect(bx, by, bw, bh);
  g.fillStyle = col; g.fillRect(bx, by, Math.max(6, bw * (r.overall / 10)), bh);
  g.fillStyle = '#e8e7df'; g.font = '400 30px ' + SANS;
  g.fillText('Paste a LinkedIn post. Receive an unsympathetic report.', 84, 474);
  g.fillStyle = '#898781'; g.font = '400 20px ' + SANS;
  g.fillText('Free, instant, and it reads your writing the same way whether you like the answer or not.', 84, 512);
  g.font = '17px ' + MONO;
  g.fillText(YPS.RULES.length + ' CHECKS · NO SIGN-UP', 84, H - 56);
  const right = 'YOURPOST.SUCKS';
  g.fillText(right, W - 84 - g.measureText(right).width, H - 56);
  return { data: cv.toDataURL('image/png'), score: r.overall, label, checks: YPS.RULES.length };
});
await writeFile(join(here, 'public', 'og-card.png'), Buffer.from(out.data.split(',')[1], 'base64'));
console.log('wrote public/og-card.png:', out.score, out.label, out.checks + ' checks');
await b.close();
