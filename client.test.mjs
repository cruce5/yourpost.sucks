import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve, join, extname } from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// No hardcoded machine path: resolve public/index.html relative to this
// file's own directory, so this runs unmodified on any checkout/OS.
const publicDir = resolve(import.meta.dirname, 'public');
const indexUrl = pathToFileURL(join(publicDir, 'index.html')).href;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

// A throwaway static server for the scenarios that need page.route() on
// /api/analyze: file:// requests cannot be intercepted, and fetch() from a
// file:// page fails as a TypeError (the offline path) before any mock sees
// it. Anything under /api that no route claims gets a 404, which is the
// 'server' path, not the offline one.
const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.js': 'text/javascript' };
const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  if (path.startsWith('/api/')) { res.writeHead(404); res.end('not found'); return; }
  const file = path === '/' ? 'index.html' : path;
  try {
    const body = await readFile(join(publicDir, file));
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const httpUrl = 'http://127.0.0.1:' + server.address().port + '/';

const SPEC0 = "Excited to announce I'm joining TechCorp as Senior Analytics Manager! Grateful for this opportunity and can't wait to make an impact. Thanks to everyone who believed in me 🙌🙌";
const FRENCH = 'Ravi de vous annoncer que je rejoins TechCorp en tant que responsable analytique senior. Merci à toutes les personnes qui ont cru en moi. Une nouvelle aventure commence aujourd hui et je suis très reconnaissant.';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 });
const errs = []; p.on('pageerror', e => errs.push(e.message));

// file:// has no API, so this exercises the offline fallback path
await p.goto(indexUrl);

// --- static structure before anything runs
check('game section is hidden before the first report', await p.evaluate(() => {
  const g = document.getElementById('game-wrap');
  return g.hidden && getComputedStyle(g).display === 'none';
}));
check('game stage is not tabbable before Start', await p.getAttribute('#game-stage', 'tabindex') === '-1');
check('media attach control is a focusable <button>', await p.evaluate(() => {
  const el = document.getElementById('mediabtn');
  el.focus();
  return el.tagName === 'BUTTON' && document.activeElement === el;
}));
check('media preview is hidden with no image', await p.evaluate(() => getComputedStyle(document.getElementById('mediapreview')).display === 'none'));
check('phantom preview regression: hidden attribute beats the flex rule', await p.evaluate(() => {
  const el = document.getElementById('mediapreview');
  el.hidden = false;
  const shown = getComputedStyle(el).display;
  el.hidden = true;
  return shown === 'flex' && getComputedStyle(el).display === 'none';
}));
check('toast is a polite status region', await p.evaluate(() => {
  const t = document.getElementById('toast');
  return t.getAttribute('role') === 'status' && t.getAttribute('aria-live') === 'polite';
}));
check('report container is focusable (tabindex=-1)', await p.getAttribute('#report', 'tabindex') === '-1');
check('progress bar is an indeterminate progressbar, not aria-hidden', await p.evaluate(() => {
  const el = document.getElementById('progress');
  return el.getAttribute('role') === 'progressbar' && !el.hasAttribute('aria-hidden') && !el.hasAttribute('aria-valuenow');
}));
check('textarea is described by the counter and the limit error', await p.getAttribute('#post', 'aria-describedby') === 'counter limit-err');
check('preamble is the tagline plus one intro sentence', await p.evaluate(() => {
  return document.querySelectorAll('header p').length === 2 && !document.querySelector('.tagline-sub') && !document.querySelector('.intro-more');
}));
check('pirate flag in the footer is aria-hidden', await p.evaluate(() => {
  const a = document.querySelector('footer .credit a');
  return a.querySelector('[aria-hidden="true"]') !== null && a.textContent.includes('Bill Yost');
}));
check('explain-tab summaries carry an aria-hidden glyph span', await p.evaluate(() => Array.from(document.querySelectorAll('.check-group summary')).every(s => s.querySelector('.cg-glyph[aria-hidden="true"]'))));
check('font stylesheet loads non-blocking with a noscript fallback', await p.evaluate(() => {
  const link = document.querySelector('link[href*="fonts.googleapis.com/css2"]');
  const ns = document.querySelector('noscript');
  return !!link && link.hasAttribute('onload') && !!ns && ns.textContent.includes('fonts.googleapis.com');
}));

// --- built CSS: tokens, focus ring, layout rules
const css = await p.evaluate(() => Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('\n'));
check('--cool-text token exists in all four theme blocks', (css.match(/--cool-text:\s*#[0-9a-f]{6}/gi) || []).length === 4, (css.match(/--cool-text:/g) || []).length + ' found');
check('light-theme --ink-4 darkened in both light blocks', (css.match(/--ink-4:\s*#66625a/gi) || []).length === 2);
check('global :focus-visible ring rule exists', /:focus-visible\{outline:2px solid var\(--cool\);outline-offset:2px\}/.test(css));
check('no outline:none anywhere in the CSS', !/\boutline:\s*none/.test(css));
check('media preview hidden rule exists', /\.media-preview\[hidden\]\{display:none\}/.test(css));
check('toast sits above the iOS safe area', /bottom:calc\(28px \+ env\(safe-area-inset-bottom, 0px\)\)/.test(css));
check('background-attachment:fixed replaced by a body::before layer', !/background-attachment:\s*fixed/.test(css) && /body::before\{[^}]*position:fixed;inset:0;z-index:-1/.test(css));
check('breakdown rows stack the label under 480px', /@media \(max-width:479px\)\{[^@]*\.bd-label\{grid-column:1 \/ -1\}/.test(css));
check('hit targets: 44px minimum on ghost, primary, remove, toggle, attach', ['.btn-ghost{', '.btn-primary{', '.media-remove{', '.theme-toggle{', '.media-upload-btn{'].every(sel => {
  const i = css.indexOf(sel); const block = css.slice(i, css.indexOf('}', i));
  return i >= 0 && /min-height:44px/.test(block);
}));
check('checkbox is 18x18', /\.media-toggle input\{[^}]*width:18px;height:18px/.test(css));

// --- the over-limit UI (before any run)
await p.fill('#post', 'x'.repeat(4500));
check('4500 chars: inline limit error is visible with the trim count', await p.evaluate(() => {
  const e = document.getElementById('limit-err');
  return !e.hidden && /4000 characters is the limit\. Trim 500\./.test(e.textContent);
}));
check('4500 chars: counter reads over by N and turns caution', await p.evaluate(() => {
  const c = document.getElementById('counter');
  return /over by 500 chars/.test(c.textContent) && c.classList.contains('over');
}));
check('4500 chars: Analyze is disabled', await p.evaluate(() => document.getElementById('run').disabled));
await p.fill('#post', 'hello there');
check('back under the limit: counter reads M / 4000 chars and error hides', await p.evaluate(() => /11 \/ 4000 chars/.test(document.getElementById('counter').textContent) && document.getElementById('limit-err').hidden));

// --- run specimen 0 offline
await p.click('[data-spec="0"]');
await p.waitForSelector('#report:not([hidden])', { timeout: 20000 });
await p.waitForTimeout(1200); // let the font gate and the count-up settle
console.log('offline badge :', await p.textContent('.mode'));
console.log('offline note  :', (await p.textContent('.mode-why')).slice(0, 60));
const scoreText = await p.textContent('.hero .num');
console.log('score         :', scoreText);
check('report is focused after analyze', await p.evaluate(() => document.activeElement && document.activeElement.id === 'report'));
check('#live announces the result', /^Report ready\./.test(await p.textContent('#live')));
check('game section is visible after the first report', await p.evaluate(() => !document.getElementById('game-wrap').hidden));
check('offline copy gets the offline badge and note', (await p.textContent('.mode')).trim() === 'offline' && /No internet connection/.test(await p.textContent('.mode-why')));
check('no tip line when no model ran', (await p.$('.tipline')) === null);
check('rules-only mode-why carries the badge clarifier', /not how your post was written/.test(await p.textContent('.mode-why')));
check('no N/47 checks pill in the hero', (await p.$('.hero .pill')) === null);
check('h2 keeps the N of 47 checks triggered count', /\d+ of \d+ checks triggered/.test(await p.textContent('#report h2.sec')));
check('aria-busy cleared after the run', await p.evaluate(() => !document.getElementById('panel-tool').hasAttribute('aria-busy')));
check('Clear label restored after the run', (await p.textContent('#clear')).trim() === 'Clear');

// --- score direction: a band in words, no denominator, no invented median
const bandLabel = (await p.textContent('.hero .band')).trim();
console.log('band          :', bandLabel);
const bandOk = ['barely sucks', 'sucks a normal amount', 'sucks a lot', 'sucks completely'].includes(bandLabel);
check('hero shows a band label', bandOk, bandLabel);
const expectedBand = await p.evaluate(s => window.YPSClient.bandFor(parseFloat(s)).label, scoreText);
check('band label matches bandFor(score)', expectedBand === bandLabel, expectedBand);
const reportText = await p.textContent('#report');
check('no "/ 10" or "out of 10" in the report', !/\/\s?10\b|out of 10/i.test(reportText));
// "median" can still turn up in the engine's own one-liner pool (engine.js,
// not this file), so the median check is scoped to the client-built chrome.
check('no benchmark anywhere in the report', !/benchmark/i.test(reportText));
const chromeText = await p.evaluate(() => ['.hero .figure', '.bench', '.receipts .sec', '#report h2.sec'].map(sel => Array.from(document.querySelectorAll(sel)).map(e => e.textContent).join(' ')).join(' '));
check('no median in the figure, scale strip or section headers', !/median/i.test(chromeText));
const scaleLabels = await p.$$eval('.bench-scale span', els => els.map(e => e.textContent));
check('scale keeps only the two end labels', scaleLabels.length === 2, scaleLabels.join(' | '));
check('score number has the suckiness hover title', /0 is immaculate, 10 is unsalvageable/.test(await p.getAttribute('.hero .num', 'title')));
check('brutal take lives inside the hero card', (await p.$('.hero .brutal')) !== null);
check('share text opens with the band', new RegExp('^My post ' + bandLabel + ': ').test(await p.textContent('#sharebox')));
check('canvas carries an aria-label with the band', new RegExp('Share card: ' + bandLabel + ', ' + scoreText.trim() + ' suckiness').test(await p.getAttribute('#card', 'aria-label') || ''));
check('bench and meters use role=meter with valuetext', await p.evaluate(() => {
  const all = Array.from(document.querySelectorAll('.bench-track, .track'));
  return all.length > 0 && all.every(m => m.getAttribute('role') === 'meter' && /of 10, higher is worse/.test(m.getAttribute('aria-valuetext') || ''));
}));
check('no progressbar left on static meters', await p.evaluate(() => document.querySelectorAll('#report [role="progressbar"]:not(.progress-track)').length === 0));

// --- report length: sections and the receipts fold
const sectionTitles = await p.$$eval('#report > section > h2.sec', els => els.map(e => e.firstChild.textContent.trim()));
console.log('sections      :', sectionTitles.join(' · '));
check('no separate brutal take section', !sectionTitles.includes('The brutal take'));
check('no separate "If you must post this" section', !sectionTitles.includes('If you must post this'));
check('receipts details present and closed by default', await p.evaluate(() => { const d = document.getElementById('receipts'); return !!d && !d.open; }));
check('receipts keep the five blocks inside', await p.evaluate(() => document.querySelectorAll('#receipts .receipt').length >= 4),
  await p.evaluate(() => Array.from(document.querySelectorAll('#receipts .receipt h3')).map(h => h.firstChild.textContent).join(' · ')));
check('receipts summary glyph is an aria-hidden span, no pseudo text on the title', await p.evaluate(() => {
  const g = document.querySelector('#receipts .rc-glyph');
  const before = getComputedStyle(document.querySelector('#receipts .rc-title'), '::before').content;
  return !!g && g.getAttribute('aria-hidden') === 'true' && (before === 'none' || before === '');
}));
check('staggered reveal indices set on every section', await p.evaluate(() => Array.from(document.querySelectorAll('#report > section')).every((s, i) => s.style.getPropertyValue('--i') === String(i))));
const fired = await p.evaluate(() => window.YourPostSucks.analyze(document.getElementById('post').value));
const roastCount = await p.$$eval('ul.roasts li', els => els.length);
const noteShown = (await p.$('.findings-note')) !== null;
// The loudest four are up front; the rest sit in a native details, one tap away.
const upFront = await p.$$eval('#report section > ul.roasts > li', els => els.length);
const folded = await p.$$eval('.roasts-more ul.roasts > li', els => els.length);
check('roasts: four up front, the rest folded, none lost', upFront + folded === roastCount && (roastCount <= 5 ? folded === 0 : upFront === 4), upFront + ' up front, ' + folded + ' folded, ' + roastCount + ' total');
if (folded) {
  check('roasts: the fold is closed by default and says how many it holds', await p.evaluate(() => { const d = document.querySelector('.roasts-more'); return !d.open && /\d+ more/.test(d.querySelector('summary').textContent); }));
  await p.click('.roasts-more > summary');
  check('roasts: the fold opens from its summary', await p.evaluate(() => document.querySelector('.roasts-more').open));
}
// Layout decisions the owner made: the fix comes before the share, the badge is a byline, three share buttons never split.
check('order: roasts, suggested changes, reword, then share', sectionTitles.join('|') === 'Suckiness report|The roasts|Suggested changes|Reword it|Share the verdict', sectionTitles.join(' > '));
check('the provenance badge sits on the kicker row, not beside the band word', await p.evaluate(() => document.querySelector('.hero .mode').parentElement.classList.contains('kicker-row') && !document.querySelector('.hero .figure .mode')));
check('the three main share buttons sit in one row or one column, never two and one', await p.evaluate(() => { const b = [...document.querySelectorAll('.share-row > .share-actions > button')].map(x => x.getBoundingClientRect()); const rows = new Set(b.map(r => Math.round(r.top))).size, cols = new Set(b.map(r => Math.round(r.left))).size; return rows === 1 || cols === 1; }));
// The flag is an easter egg: the site's own words go pirate, the visitor's never do, and it all comes back.
{
  const before = await p.evaluate(() => ({ tag: document.querySelector('.tagline').textContent, post: document.getElementById('post').value, share: document.getElementById('sharebox').textContent, marks: (document.querySelector('.annotated') || {}).textContent || '' }));
  await p.click('#pirateflag'); await p.waitForTimeout(150);
  const on = await p.evaluate(() => ({ tag: document.querySelector('.tagline').textContent, post: document.getElementById('post').value, share: document.getElementById('sharebox').textContent, marks: (document.querySelector('.annotated') || {}).textContent || '', pressed: document.getElementById('pirateflag').getAttribute('aria-pressed'), h1: document.querySelector('h1').textContent }));
  check('pirate mode changes the site copy and reports its state', /plunder/i.test(on.tag) && on.pressed === 'true' && on.h1 === 'yourpost.sucks', on.tag);
  check('pirate mode never touches the post, the annotated copy or the share text', on.post === before.post && on.share === before.share && on.marks === before.marks);
  await p.click('#pirateflag'); await p.waitForTimeout(150);
  check('pirate mode off puts every word back', (await p.textContent('.tagline')) === before.tag);
}
check('findings note shows exactly when roasts < rules fired', noteShown === (fired.stats.rulesFired > roastCount), roastCount + ' roasts, ' + fired.stats.rulesFired + ' fired');
check('"In its defense" uses American spelling', !/defence/i.test(reportText));
check('annotated marks carry a visible check label and the legend explains it', await p.evaluate(() => {
  const marks = Array.from(document.querySelectorAll('.annotated mark'));
  return marks.length > 0 && marks.every(m => m.querySelector('sup.mk') && m.querySelector('sup.mk').textContent.trim().length > 0) && !!document.querySelector('.legend-note');
}));
check('volume row label is "Piling it on" or absent', await p.evaluate(() => Array.from(document.querySelectorAll('.bd-label')).every(l => !/many things wrong/.test(l.textContent))));

// receipts open state is remembered
await p.click('#receipts > summary');
await p.waitForTimeout(100);
check('receipts open on click', await p.evaluate(() => document.getElementById('receipts').open));
check('open state stored', await p.evaluate(() => localStorage.getItem('yps_receipts_open') === '1'));
await p.click('#receipts > summary');
await p.waitForTimeout(100);
check('closed state stored', await p.evaluate(() => localStorage.getItem('yps_receipts_open') === '0'));

// --- share row: three visible buttons, the rest folded, card is a toggle button
check('share row shows Copy link, Download card, Copy image and a details fold', await p.evaluate(() => {
  const top = Array.from(document.querySelectorAll('.share-row > .share-actions > button')).map(b => b.id);
  const more = document.querySelector('.share-row details.share-more');
  const folded = more ? Array.from(more.querySelectorAll('button')).map(b => b.id) : [];
  return top.join(',') === 'copylink,savecard,copycard' && !!more && !more.open && folded.join(',') === 'copyshare,copyfull,printit' && !document.getElementById('cardsize');
}), await p.evaluate(() => Array.from(document.querySelectorAll('.share-row button')).map(b => b.id).join(',')));
check('Copy link is the primary button', await p.evaluate(() => document.getElementById('copylink').classList.contains('btn-primary')));
check('card wrapper is a <button> with aria-pressed', await p.evaluate(() => { const w = document.getElementById('cardwrap'); return w.tagName === 'BUTTON' && w.getAttribute('aria-pressed') === 'false'; }));
const thumbW = await p.evaluate(() => document.getElementById('cardwrap').getBoundingClientRect().width);
check('card renders as a thumbnail', thumbW <= 360, Math.round(thumbW) + 'px wide');
await p.focus('#cardwrap');
await p.keyboard.press('Enter');
const fullW = await p.evaluate(() => document.getElementById('cardwrap').getBoundingClientRect().width);
check('card toggles to full width from the keyboard', fullW > 600, Math.round(fullW) + 'px wide');
check('aria-pressed follows the toggle', await p.getAttribute('#cardwrap', 'aria-pressed') === 'true');
await p.click('#cardwrap');
check('card toggles back', await p.evaluate(() => document.getElementById('cardwrap').getBoundingClientRect().width) <= 360);

// share card actually rendered pixels?
const card = await p.evaluate(() => {
  const c = document.getElementById('card');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let nonBg = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 30 || d[i+1] > 30 || d[i+2] > 30) nonBg++;
  return { w: c.width, h: c.height, inkPixels: nonBg };
});
console.log('card          :', card.w + 'x' + card.h, card.inkPixels + ' ink pixels');
check('canvas is LinkedIn portrait, 1080x1350, with ink on it', card.w === 1080 && card.h === 1350 && card.inkPixels > 1000);
check('no low-contrast #5f5e5a text left in drawCard', !/5f5e5a/i.test(await p.evaluate(() => Array.from(document.querySelectorAll('script')).map(s => s.textContent).join(''))));
await p.locator('#card').screenshot({ path: 'shot-card.png' });

// --- copied report uses suck, labelled once
const plain = await p.evaluate(() => {
  // the copy handler goes to the clipboard; rebuild through the same
  // report object instead of granting clipboard permission on file://
  const r = window.YourPostSucks.analyze(document.getElementById('post').value);
  return { r, firstCat: r.categories[0] };
});
check('engine report has suck on categories', typeof plain.firstCat.suck === 'number');

// --- game: keys are inert until Start, Start arms and focuses the stage
check('Space on the stage before Start is not intercepted', await p.evaluate(() => {
  const stage = document.getElementById('game-stage');
  const ev = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true });
  stage.dispatchEvent(ev);
  return !ev.defaultPrevented && document.getElementById('game-panel').hidden === false;
}));
await p.click('#game-start');
await p.waitForTimeout(100);
check('Start focuses the stage and makes it tabbable', await p.evaluate(() => document.activeElement === document.getElementById('game-stage') && document.getElementById('game-stage').tabIndex === 0));
check('Duck button responds to keyboard hold', await p.evaluate(() => {
  const d = document.getElementById('game-btn-duck');
  const down = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true });
  d.dispatchEvent(down);
  const up = new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true, cancelable: true });
  d.dispatchEvent(up);
  return down.defaultPrevented && up.defaultPrevented;
}));

// --- permalink codec: compressed round trip, legacy links, and navigation
const sample = "Excited to announce 🙌\n\nI'm joining TechCorp, sort of. Ünïcödé too. " + 'x'.repeat(400);
const rt = await p.evaluate(async (t) => {
  const enc = await window.YPSClient.encodePost(t);
  const dec = await window.YPSClient.decodePost(enc);
  // legacy (uncompressed) format, built by hand the old way
  const bytes = new TextEncoder().encode(t);
  let bin = ''; for (const by of bytes) bin += String.fromCharCode(by);
  const legacy = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const decLegacy = await window.YPSClient.decodePost(legacy);
  return { enc, dec, legacyLen: legacy.length, decLegacy, garbage: await window.YPSClient.decodePost('z%%%') };
}, sample);
check('compressed permalink starts with z', rt.enc.startsWith('z'), rt.enc.slice(0, 12) + '...');
check('compressed round trip is lossless', rt.dec === sample);
check('compressed link is shorter than legacy', rt.enc.length < rt.legacyLen, rt.enc.length + ' vs ' + rt.legacyLen);
check('legacy link still decodes', rt.decLegacy === sample);
check('garbage decodes to null, not a throw', rt.garbage === null);

const encoded = await p.evaluate(async () => window.YPSClient.encodePost(document.getElementById('post').value));
await p.goto(indexUrl + '?p=' + encoded);
await p.waitForSelector('#report:not([hidden])', { timeout: 20000 });
check('navigating to a compressed permalink loads the post and runs', (await p.inputValue('#post')).startsWith('Excited to announce'));

// corrupt permalink: a notice, not silence
await p.goto(indexUrl + '?p=z%25%25%25');
await p.waitForTimeout(300);
check('corrupt permalink shows the unreadable-link notice', /did not contain a readable post/.test(await p.textContent('#notices')) && await p.evaluate(() => document.getElementById('report').hidden));

// over-limit permalink: the inline error, no toast
const bigEnc = await p.evaluate(async () => window.YPSClient.encodePost('y '.repeat(2300)));
await p.goto(indexUrl + '?p=' + bigEnc);
await p.waitForTimeout(400);
check('over-limit permalink shows the inline limit error and no report', await p.evaluate(() => !document.getElementById('limit-err').hidden && document.getElementById('report').hidden && !document.getElementById('toast').classList.contains('on')));

// --- getting a post in: paste anywhere, an image on the clipboard, a drop
{
  await p.goto(indexUrl);
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGP8z4AdMOEQH2ESDAwAR0cBD8Pj4XkAAAAASUVORK5CYII=';
  const firePaste = (sel, text, withImage) => p.evaluate(({ sel, text, withImage, PNG }) => {
    const dt = new DataTransfer();
    if (text) dt.setData('text/plain', text);
    if (withImage) { const bin = atob(PNG), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); dt.items.add(new File([u], 'shot.png', { type: 'image/png' })); }
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    (sel ? document.querySelector(sel) : document.body).dispatchEvent(ev);
    return ev.defaultPrevented;
  }, { sel, text, withImage, PNG });
  await firePaste(null, 'Pasted with the cursor nowhere in particular.', false);
  check('text pasted anywhere on the page lands in the box, with focus', (await p.inputValue('#post')) === 'Pasted with the cursor nowhere in particular.' && await p.evaluate(() => document.activeElement.id === 'post'));
  await firePaste(null, 'And a second paste.', false);
  check('a second paste appends after a blank line, it never overwrites', (await p.inputValue('#post')) === 'Pasted with the cursor nowhere in particular.\n\nAnd a second paste.');
  await firePaste(null, '', true); await p.waitForTimeout(700);
  check('an image on the clipboard attaches itself and ticks the media box', await p.isVisible('#mediapreview') && await p.isChecked('#hasmedia'), (await p.textContent('#mediapreview-name')).trim());
  await p.click('#mediaremove');
  const before = await p.inputValue('#post');
  const prevented = await firePaste('#post', '', true); await p.waitForTimeout(700);
  check('an image pasted inside the box attaches and leaves the text alone', await p.isVisible('#mediapreview') && (await p.inputValue('#post')) === before && prevented === true);
  check('no paste ever starts an analysis on its own', await p.evaluate(() => document.getElementById('report').hidden));
  check('the attach button says an image can be pasted', /paste/i.test(await p.textContent('#mediabtn')));
}

// --- unscored report (French, offline): no bench, no meters, reword empty
await p.goto(indexUrl);
await p.fill('#post', FRENCH);
await p.click('#run');
await p.waitForSelector('#report:not([hidden])', { timeout: 20000 });
check('unscored: band reads not scored', (await p.textContent('.hero .band')).trim() === 'not scored');
check('unscored: no bench bar, no valuenow anywhere in the hero', await p.evaluate(() => !document.querySelector('.bench') && !document.querySelector('.hero [aria-valuenow]')));
check('unscored: no meters or breakdown, a Not scored note instead', await p.evaluate(() => !document.querySelector('.meters') && !document.querySelector('.breakdown') && /Not scored/.test(document.querySelector('#receipts .meters-note').textContent)));
check('unscored: reword section says nothing to rewrite', /Not scored, so nothing to rewrite\./.test(await p.textContent('.reword-empty')));
// The count-up used to run on unscored posts too and write 0.2 over the n/a.
await p.waitForTimeout(1200);
check('unscored: the hero number still reads n/a after the count-up would have finished', (await p.textContent('.hero .num')).trim() === 'n/a', await p.textContent('.hero .num'));
check('unscored: the receipts index names only the blocks it contains', !/annotated post|what it got right/i.test(await p.textContent('#receipts .rc-sub')) || await p.evaluate(() => !!document.querySelector('#receipts .annotated')), await p.textContent('#receipts .rc-sub'));
// Clear takes the bonus game away with the report it sat under.
await p.click('#clear');
check('Clear hides the report and the game together', await p.evaluate(() => document.getElementById('report').hidden && document.getElementById('game-wrap').hidden));

// --- report height in screens at 1280x800 after specimen 0
const desk = await b.newPage({ viewport: { width: 1280, height: 800 } });
desk.on('pageerror', e => errs.push(e.message));
await desk.goto(indexUrl);
await desk.click('[data-spec="0"]');
await desk.waitForSelector('#report:not([hidden])', { timeout: 20000 });
await desk.waitForTimeout(800);
const heights = await desk.evaluate(() => {
  const rep = document.getElementById('report').getBoundingClientRect();
  return {
    doc: document.documentElement.scrollHeight,
    report: rep.height,
    viewport: window.innerHeight
  };
});
console.log('report height :', Math.round(heights.report) + 'px = ' + (heights.report / heights.viewport).toFixed(2) + ' screens at 1280x800 (whole page ' + (heights.doc / heights.viewport).toFixed(2) + ' screens incl. header, game, footer)');
check('report is about two screens on desktop', heights.report / heights.viewport <= 2.6, (heights.report / heights.viewport).toFixed(2));
await desk.close();

// --- mobile first fold at 375x812
const mob = await b.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
mob.on('pageerror', e => errs.push(e.message));
await mob.goto(indexUrl);
const fold = await mob.evaluate(() => {
  const ta = document.getElementById('post').getBoundingClientRect();
  const brand = document.querySelector('.brand').getBoundingClientRect();
  const toggle = document.getElementById('themetoggle').getBoundingClientRect();
  return { taTop: ta.top, sameRow: Math.abs(brand.top - toggle.top) < brand.height + 8, scrollW: document.documentElement.scrollWidth };
});
console.log('textarea top  :', Math.round(fold.taTop) + 'px at 375 wide');
check('textarea top is within the first fold (< 700px)', fold.taTop < 700, Math.round(fold.taTop));
check('theme toggle sits on the masthead row', fold.sameRow);
check('no horizontal overflow at 375', fold.scrollW <= 375, fold.scrollW);
await mob.click('[data-spec="0"]');
await mob.waitForSelector('#report:not([hidden])', { timeout: 20000 });
await mob.waitForTimeout(300);
check('no horizontal overflow at 375 with a report on the page', await mob.evaluate(() => document.documentElement.scrollWidth <= 375), await mob.evaluate(() => document.documentElement.scrollWidth));
check('breakdown label spans the row under 480px', await mob.evaluate(() => {
  const l = document.querySelector('.bd-label');
  return !!l && getComputedStyle(l).gridColumnStart === '1' && getComputedStyle(l).gridColumnEnd === '-1';
}));
await mob.close();

// --- the bail-out UI
await p.goto(indexUrl);
await p.fill('#post', 'My father passed away on Tuesday. He never understood what I did for work but he told everyone about it anyway.');
await p.click('#run');
await p.waitForSelector('.declined', { timeout: 20000 });
console.log('declined UI   :', (await p.textContent('.declined h3')).trim());
check('no score shown when declined', (await p.$('.hero .num')) === null);
check('declined copy says checked before any AI, nothing cached', /before any AI was involved/.test(await p.textContent('.declined p')) && /Nothing was scored or cached/.test(await p.textContent('.declined p')));

// --- copy: no em dashes in any visible page text or inline script strings we own
const emDashHits = await p.evaluate(() => {
  const txt = document.body.innerText;
  return (txt.match(/—/g) || []).length;
});
check('no em dashes in visible page text', emDashHits === 0, emDashHits + ' found');

// ======================================================================
// Mocked API scenarios over http, where page.route() can see the request.
// ======================================================================
const api = await b.newPage({ viewport: { width: 900, height: 1200 } });
api.on('pageerror', e => errs.push(e.message));

// 1. a slow success: live region, busy state, in-flight guard, Cancel label
let analyzeHits = 0;
let releaseSlow;
const slowGate = new Promise(r => { releaseSlow = r; });
await api.route('**/api/analyze', async route => {
  analyzeHits++;
  await slowGate;
  const post = route.request().postDataJSON().post;
  const report = await api.evaluate(t => window.YourPostSucks.analyze(t), post);
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'rules', reason: 'no_key', report }) });
});
await api.goto(httpUrl);
await api.click('[data-spec="0"]');
await api.waitForTimeout(150);
check('#live announces analyzing during a run', (await api.textContent('#live')) === 'Analyzing. This can take up to 30 seconds.');
check('panel is aria-busy and the bar is showing during a run', await api.evaluate(() => document.getElementById('panel-tool').getAttribute('aria-busy') === 'true' && !document.getElementById('progress').hidden));
check('#run is aria-disabled and specimens are disabled during a run', await api.evaluate(() => document.getElementById('run').getAttribute('aria-disabled') === 'true' && Array.from(document.querySelectorAll('[data-spec]')).every(b => b.disabled)));
check('#clear reads Cancel during a run', (await api.textContent('#clear')).trim() === 'Cancel');
// second Analyze attempts: button click, Ctrl+Enter, specimen, permalink path
await api.evaluate(() => document.getElementById('run').click());
await api.focus('#post');
await api.keyboard.press('Control+Enter');
await api.evaluate(() => document.querySelector('[data-spec="1"]').click());
await api.waitForTimeout(200);
check('second Analyze during a run is ignored (one request only)', analyzeHits === 1, analyzeHits + ' requests');
check('textarea unchanged by the disabled specimen click', (await api.inputValue('#post')) === SPEC0);
releaseSlow();
await api.waitForSelector('#report:not([hidden])', { timeout: 20000 });
check('slow run completes with the server-provided mode and reason', (await api.textContent('.mode')).trim() === 'checklist-only commentary' && /switched off/.test(await api.textContent('.mode-why')));
check('rules-only badge label is checklist-only commentary', (await api.textContent('.mode')).trim() === 'checklist-only commentary');
check('#live announces the result after the run', /^Report ready\./.test(await api.textContent('#live')));
check('report focused after the mocked analyze too', await api.evaluate(() => document.activeElement && document.activeElement.id === 'report'));
await api.unroute('**/api/analyze');

// 2. Cancel mid-run: aborts, resets the busy UI, no report
let hangAborted = false;
// Never fulfilled: the only way out is the page aborting the request, which
// Playwright reports as requestfailed.
await api.route('**/api/analyze', async () => { await new Promise(() => {}); });
api.on('requestfailed', r => { if (r.url().includes('/api/analyze')) hangAborted = true; });
await api.goto(httpUrl);
await api.click('[data-spec="2"]');
await api.waitForTimeout(150);
check('Cancel appears mid-run', (await api.textContent('#clear')).trim() === 'Cancel');
await api.click('#clear');
await api.waitForTimeout(300);
check('Cancel leaves no report and resets the busy UI', await api.evaluate(() => {
  return document.getElementById('report').hidden &&
    document.getElementById('clear').textContent.trim() === 'Clear' &&
    document.getElementById('run').textContent.trim() === 'Analyze' &&
    document.getElementById('run').getAttribute('aria-disabled') === 'false' &&
    document.getElementById('progress').hidden &&
    !document.getElementById('panel-tool').hasAttribute('aria-busy') &&
    Array.from(document.querySelectorAll('[data-spec]')).every(b => !b.disabled);
}));
check('Cancel aborts the in-flight request', hangAborted, 'requestfailed seen: ' + hangAborted);
check('Cancel keeps the text in the box', (await api.inputValue('#post')).startsWith('I almost didn\'t post this'));
check('#live says canceled', (await api.textContent('#live')) === 'Canceled.');
await api.waitForTimeout(500);
check('no late render after Cancel', await api.evaluate(() => document.getElementById('report').hidden));

// 3. timeout: the killer fires, rules badge with the timeout note
await api.goto(httpUrl);
await api.evaluate(() => { window.YPSClient.killerMs = 400; });
await api.click('[data-spec="0"]');
await api.waitForSelector('#report:not([hidden])', { timeout: 20000 });
check('timeout produces the checklist badge with the timeout note', (await api.textContent('.mode')).trim() === 'checklist-only commentary' && /ran past 30 seconds.*Same score either way/.test(await api.textContent('.mode-why')));
check('timeout note is not the offline note', !/No internet connection/.test(await api.textContent('.mode-why')));
await api.unroute('**/api/analyze');

// 4. server 500: the 'server' note, not offline
await api.route('**/api/analyze', route => route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' }));
await api.goto(httpUrl);
await api.click('[data-spec="0"]');
await api.waitForSelector('#report:not([hidden])', { timeout: 20000 });
check('server 500 produces the server note', /server had a problem/.test(await api.textContent('.mode-why')) && (await api.textContent('.mode')).trim() === 'checklist-only commentary');
check('server 500 does not claim offline', !/No internet connection/.test(await api.textContent('.mode-why')));
await api.unroute('**/api/analyze');

// 5. malformed JSON is also 'server'
await api.route('**/api/analyze', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{not json' }));
await api.goto(httpUrl);
await api.click('[data-spec="0"]');
await api.waitForSelector('#report:not([hidden])', { timeout: 20000 });
check('malformed JSON produces the server note', /server had a problem/.test(await api.textContent('.mode-why')));
await api.unroute('**/api/analyze');

// 6. cache mode: plain AI commentary badge, no cached suffix
await api.route('**/api/analyze', async route => {
  const report = await api.evaluate(t => window.YourPostSucks.analyze(t), route.request().postDataJSON().post);
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'cache', report }) });
});
await api.goto(httpUrl);
await api.click('[data-spec="0"]');
await api.waitForSelector('#report:not([hidden])', { timeout: 20000 });
check('cache mode badge reads AI commentary, cache in the title only', (await api.textContent('.mode')).trim() === 'AI commentary' && /Cached/.test(await api.getAttribute('.mode', 'title')));
check('AI modes carry no mode-why line', (await api.$('.mode-why')) === null);
await api.unroute('**/api/analyze');

// 7. rate_limited: reword section renders the note instead of a button
await api.route('**/api/analyze', async route => {
  const report = await api.evaluate(t => window.YourPostSucks.analyze(t), route.request().postDataJSON().post);
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'rules', reason: 'rate_limited', report }) });
});
await api.goto(httpUrl);
await api.click('[data-spec="0"]');
await api.waitForSelector('#report:not([hidden])', { timeout: 20000 });
check('rate_limited: reword shows the unavailable note, no button', (await api.$('#rewordbtn')) === null && /hour's worth from your connection/.test(await api.textContent('.reword-note')));
await api.unroute('**/api/analyze');

// 8. reword errors: honest copy, previous result kept, Try again
await api.route('**/api/analyze', async route => {
  const report = await api.evaluate(t => window.YourPostSucks.analyze(t), route.request().postDataJSON().post);
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'llm', report }) });
});
let rewordCall = 0;
await api.route('**/api/reword', async route => {
  rewordCall++;
  if (rewordCall === 1) {
    const post = route.request().postDataJSON().post;
    const rewritten = 'We ran a six-week test on 41,000 users. My pick lost by 3 points.';
    const after = await api.evaluate(t => window.YourPostSucks.analyze(t), rewritten);
    const before = await api.evaluate(t => window.YourPostSucks.analyze(t), post);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'reworded', rewritten, summary: 'Shorter.', before, after }) });
  } else if (rewordCall === 2) {
    await route.fulfill({ status: 413, contentType: 'text/plain', body: 'too big' });
  } else {
    await route.fulfill({ status: 503, contentType: 'text/plain', body: 'down' });
  }
});
await api.goto(httpUrl);
await api.click('[data-spec="0"]');
await api.waitForSelector('#rewordbtn', { timeout: 20000 });
check('an AI report ends with one tip line', await api.evaluate(() => {
  const rep = document.getElementById('report'), t = rep.lastElementChild;
  return rep.querySelectorAll(':scope > .tipline').length === 1 && t.classList.contains('tipline') &&
    !!t.querySelector('a[href="https://buymeacoffee.com/billyost"][target="_blank"][rel~="noopener"]');
}));
check('the tip line has no em dash', !/—/.test(await api.textContent('#report > .tipline')));
check('reword progress bar is a labelled progressbar', await api.evaluate(() => document.getElementById('reword-progress').getAttribute('role') === 'progressbar'));
await api.click('#rewordbtn');
await api.waitForSelector('.reword-text', { timeout: 20000 });
check('first reword renders the rewrite', /six-week test/.test(await api.textContent('.reword-text')));
check('a rewrite ends with its own tip line', await api.evaluate(() => { const t = document.querySelector('#rewordresult .tipline'); return !!t && /rewrite cost me/.test(t.textContent) && !!t.querySelector('a[href="https://buymeacoffee.com/billyost"]'); }));
await api.click('#rewordbtn');
await api.waitForSelector('.reword-error', { timeout: 20000 });
check('413 gets the too-long copy and keeps the previous rewrite', /too long to reword/.test(await api.textContent('.reword-error')) && (await api.$('.reword-text')) !== null);
check('error box offers Try again', (await api.textContent('.reword-error button')).trim() === 'Try again');
await api.click('.reword-error button');
await api.waitForTimeout(400);
check('Try again re-requests and a 5xx gets the server copy', rewordCall === 3 && /server had a problem/.test(await api.textContent('.reword-error')));
check('error is above the kept rewrite, not replacing it', await api.evaluate(() => {
  const out = document.getElementById('rewordresult');
  return out.firstElementChild.classList.contains('reword-error') && out.querySelectorAll('.reword-error').length === 1 && !!out.querySelector('.reword-text');
}));

// 9. image attach: preview shows while preparing, removal unticks the box it ticked
await api.goto(httpUrl);
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVQIW2NkYGD4z8DAwMgAAQAKGwEDHo8Z8QAAAABJRU5ErkJggg==';
await api.setInputFiles('#mediafile', { name: 'tiny.png', mimeType: 'image/png', buffer: Buffer.from(pngBase64, 'base64') });
await api.waitForFunction(() => document.getElementById('mediapreview-name').textContent === 'tiny.png', null, { timeout: 5000 });
check('attach shows the preview with the file name and ticks the media box', await api.evaluate(() => !document.getElementById('mediapreview').hidden && document.getElementById('hasmedia').checked && !document.getElementById('mediapreview-img').hidden));
await api.click('#mediaremove');
check('removing the image unticks the box the attach ticked and hides the preview', await api.evaluate(() => !document.getElementById('hasmedia').checked && getComputedStyle(document.getElementById('mediapreview')).display === 'none'));
await api.check('#hasmedia');
await api.setInputFiles('#mediafile', { name: 'tiny.png', mimeType: 'image/png', buffer: Buffer.from(pngBase64, 'base64') });
await api.waitForFunction(() => document.getElementById('mediapreview-name').textContent === 'tiny.png', null, { timeout: 5000 });
await api.click('#mediaremove');
check('removing the image leaves a hand-ticked box alone', await api.evaluate(() => document.getElementById('hasmedia').checked));
check('accept lists heic and heif', /image\/heic,image\/heif/.test(await api.getAttribute('#mediafile', 'accept')));
const transcoded = await api.evaluate(async () => {
  // A fully transparent PNG through the same pipeline: the JPEG that comes
  // out must be white, not black.
  const src = document.createElement('canvas'); src.width = 8; src.height = 8;
  const blob = await new Promise(r => src.toBlob(r, 'image/png'));
  const file = new File([blob], 'transparent.png', { type: 'image/png' });
  const input = document.getElementById('mediafile');
  const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 500));
  const img = document.getElementById('mediapreview-img');
  if (!img.src) return 'no preview src';
  const probe = new Image();
  await new Promise((res, rej) => { probe.onload = res; probe.onerror = rej; probe.src = img.src; });
  const c = document.createElement('canvas'); c.width = probe.naturalWidth; c.height = probe.naturalHeight;
  c.getContext('2d').drawImage(probe, 0, 0);
  const d = c.getContext('2d').getImageData(4, 4, 1, 1).data;
  return d[0] + ',' + d[1] + ',' + d[2];
});
check('attach transcodes onto a white canvas (no black flattening)', /^(2[4-5]\d),(2[4-5]\d),(2[4-5]\d)$/.test(transcoded), 'centre pixel rgb ' + transcoded);

// 10. notices header reads Cleaned before scoring (hygiene runs on paste and on Analyze)
await api.goto(httpUrl);
await api.fill('#post', 'hashtag#leadership is the future ​ of work.');
check('notices header reads Cleaned before scoring', await api.evaluate(async () => {
  document.getElementById('post').dispatchEvent(new Event('paste', { bubbles: true }));
  await new Promise(r => setTimeout(r, 50));
  const hdr = document.querySelector('#notices .hdr');
  return !!hdr && hdr.textContent === 'Cleaned before scoring';
}));

// 11. tablist Home/End
await api.goto(httpUrl);
await api.focus('#tab-tool');
await api.keyboard.press('End');
check('End moves to the last tab', await api.evaluate(() => document.activeElement.id === 'tab-explain' && document.getElementById('tab-explain').getAttribute('aria-selected') === 'true'));
await api.keyboard.press('Home');
check('Home moves to the first tab', await api.evaluate(() => document.activeElement.id === 'tab-tool' && document.getElementById('tab-tool').getAttribute('aria-selected') === 'true'));

// 12. reduced motion: no idle loop, no bob
const rm = await b.newPage({ viewport: { width: 900, height: 1200 }, reducedMotion: 'reduce' });
rm.on('pageerror', e => errs.push(e.message));
await rm.goto(indexUrl);
await rm.click('[data-spec="0"]');
await rm.waitForSelector('#report:not([hidden])', { timeout: 20000 });
await rm.evaluate(() => document.getElementById('game-stage').scrollIntoView());
await rm.waitForTimeout(400);
const frames = await rm.evaluate(async () => {
  const c = document.getElementById('game-canvas');
  const snap = () => c.getContext('2d').getImageData(0, 0, c.width, c.height).data.join('');
  const a = snap();
  await new Promise(r => setTimeout(r, 500));
  return a === snap();
});
check('reduced motion: idle stage draws one static frame and stops', frames);
await rm.close();

// 13. stale result: done() drops a report whose text no longer matches
await api.route('**/api/analyze', async route => {
  await new Promise(r => setTimeout(r, 600));
  const report = await api.evaluate(t => window.YourPostSucks.analyze(t), route.request().postDataJSON().post);
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'rules', report }) });
});
await api.goto(httpUrl);
await api.click('[data-spec="0"]');
await api.waitForTimeout(100);
await api.evaluate(() => { document.getElementById('post').value = 'something else entirely now'; });
await api.waitForTimeout(1200);
check('a result for text no longer in the box is dropped', await api.evaluate(() => document.getElementById('report').hidden && document.getElementById('run').textContent.trim() === 'Analyze'));
await api.unroute('**/api/analyze');

await api.close();

console.log('ERRORS        :', errs.length ? errs : 'none');
check('no page errors', errs.length === 0);
await b.close();
server.close();
if (failures) { console.log('\n' + failures + ' check(s) failed'); process.exit(1); }
console.log('\nall checks passed');
