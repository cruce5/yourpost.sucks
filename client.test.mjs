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
/* Same reason as the api page below: once this page writes a setting it
 * looks like a returning visitor, and the what's-new notes open over the
 * controls the blocks below are clicking. The notes get their own block. */
await p.evaluate(v => { try { localStorage.setItem('yps_whatsnew_seen', v); } catch (e) {} }, await p.evaluate(() => window.YPSClient.whatsnewVersion));

// --- static structure before anything runs
check('game section is hidden before the first report', await p.evaluate(() => {
  const g = document.getElementById('game-wrap');
  return g.hidden && getComputedStyle(g).display === 'none';
}));
check('game stage is not tabbable before Start', await p.getAttribute('#game-stage', 'tabindex') === '-1');
check('media attach control is a real label on a real, focusable file input (no scripted click to swallow)', await p.evaluate(() => {
  const label = document.getElementById('mediabtn'), input = document.getElementById('mediafile');
  input.focus();
  return label.tagName === 'LABEL' && label.htmlFor === 'mediafile' && input.type === 'file' && !input.hidden && getComputedStyle(input).display !== 'none' && document.activeElement === input;
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
check('textarea is described by the counter, the limit error and the link error', await p.getAttribute('#post', 'aria-describedby') === 'counter limit-err link-err');
check('preamble is the tagline plus one intro sentence', await p.evaluate(() => {
  return document.querySelectorAll('header p').length === 2 && !document.querySelector('.tagline-sub') && !document.querySelector('.intro-more');
}));
check('the footer has a contact address, and it is a working mailto', await p.evaluate(() => {
  const a = document.getElementById('contactmail');
  return !!a && a.closest('footer') && a.getAttribute('href') === 'mailto:hello@yourpost.sucks' && a.textContent === 'hello@yourpost.sucks';
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
  // Every place the site speaks, not just the six it had when the flag was sewn.
  const plain = await p.evaluate(() => ({
    meaner: document.querySelector('label[for="meaner"]').textContent.trim(), note: document.querySelector('.meaner-row .media-note').textContent.trim(),
    media: document.querySelector('label[for="hasmedia"]').textContent.trim(), wnBtn: document.getElementById('whatsnewbtn').textContent.trim(),
    wn: document.getElementById('whatsnew').textContent, run: document.getElementById('run').textContent, theme: document.getElementById('themetoggle').textContent
  }));
  await p.click('#pirateflag'); await p.waitForTimeout(150);
  const arr = await p.evaluate(() => ({
    meaner: document.querySelector('label[for="meaner"]').textContent.trim(), note: document.querySelector('.meaner-row .media-note').textContent.trim(),
    media: document.querySelector('label[for="hasmedia"]').textContent.trim(), wnBtn: document.getElementById('whatsnewbtn').textContent.trim(),
    wn: document.getElementById('whatsnew').textContent, run: document.getElementById('run').textContent, theme: document.getElementById('themetoggle').textContent,
    post: document.getElementById('post').value
  }));
  check('pirate mode reaches the input panel', /walk the plank/i.test(arr.meaner) && /no quarter/i.test(arr.note) && /yer own peril/i.test(arr.note) && arr.media !== plain.media, arr.meaner + ' | ' + arr.note);
  check('pirate mode reaches the header link and the what\'s-new notes', /what be new/i.test(arr.wnBtn) && /buy me a grog/i.test(arr.wn) && /aye aye/i.test(arr.wn) && !/buy me a coffee/i.test(arr.wn), arr.wnBtn);
  check('pirate mode leaves the working buttons and the visitor\'s post alone', arr.run === plain.run && arr.theme === plain.theme && arr.post === before.post);
  // Words written after the flag went up get it too.
  await p.evaluate(() => { document.getElementById('tipask-h').textContent = 'Five reports in. Thank you for using this.'; document.getElementById('tipask-p').textContent = 'If you would like to chip in, one coffee covers the next 500 or so.'; });
  await p.waitForTimeout(200);
  check('pirate mode catches the thank-you card when it is written late', /thankee/i.test(await p.textContent('#tipask-h')) && /one grog/i.test(await p.textContent('#tipask-p')), await p.textContent('#tipask-h'));
  await p.click('#pirateflag'); await p.waitForTimeout(150);
  const back = await p.evaluate(() => ({ meaner: document.querySelector('label[for="meaner"]').textContent.trim(), note: document.querySelector('.meaner-row .media-note').textContent.trim(), wnBtn: document.getElementById('whatsnewbtn').textContent.trim(), wn: document.getElementById('whatsnew').textContent }));
  check('pirate mode off puts every one of those back too', back.meaner === plain.meaner && back.note === plain.note && back.wnBtn === plain.wnBtn && back.wn === plain.wn);
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
/* The what's-new notes open by themselves, once, for a visitor who has been
 * here before, which is what every block below looks like after the first
 * one writes a setting. Mark them seen for this page; the block that tests
 * the notes clears the marker itself and puts it back. */
await api.goto(httpUrl);
const WHATSNEW_VERSION = await api.evaluate(() => window.YPSClient.whatsnewVersion);
await api.evaluate(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) {} }, ['yps_whatsnew_seen', WHATSNEW_VERSION]);
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

// 8a. a pasted link is not a post, and the harsher register is a request
{
  let analyzeCalls = 0, lastBody = null;
  await api.unroute('**/api/analyze');
  await api.route('**/api/analyze', async route => {
    analyzeCalls++;
    lastBody = route.request().postDataJSON();
    const report = await api.evaluate(t => window.YourPostSucks.analyze(t), lastBody.post);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'llm', report }) });
  });
  await api.goto(httpUrl);
  await api.fill('#post', 'https://www.linkedin.com/posts/billyost_i-built-a-website-activity-7506764692472799232-FK65');
  await api.click('#run');
  await api.waitForTimeout(700);
  check('a pasted link is refused with an explanation, and costs no call', analyzeCalls === 0 && /link, not a post/.test(await api.textContent('#link-err')) && await api.evaluate(() => document.getElementById('report').hidden), analyzeCalls + ' calls');
  check('  ...the message is tied to the textarea for screen readers', /link-err/.test(await api.getAttribute('#post', 'aria-describedby')));
  await api.fill('#post', 'Read the thread here: https://example.com/x. We shipped the invoicing redesign this week and support tickets about billing dropped by a third in the first four days. The fix was three renamed fields.');
  await api.click('#run');
  await api.waitForSelector('#report:not([hidden])', { timeout: 20000 });
  check('a post that merely contains a link is analyzed as usual', analyzeCalls === 1 && await api.evaluate(() => document.getElementById('link-err').hidden));

  check('the harsher register is off by default', await api.evaluate(() => !document.getElementById('meaner').checked) && lastBody.meaner === false);
  await api.click('#meaner');
  await api.click('#run');
  await api.waitForTimeout(900);
  check('ticking it sends meaner with the request', analyzeCalls === 2 && lastBody.meaner === true, JSON.stringify({ calls: analyzeCalls, meaner: lastBody.meaner }));
  await api.goto(httpUrl);
  check('  ...and it is remembered on the next visit', await api.evaluate(() => document.getElementById('meaner').checked));
  await api.click('#meaner');
  await api.goto(httpUrl);
  check('  ...and unticking it is remembered too', await api.evaluate(() => !document.getElementById('meaner').checked));
  await api.fill('#post', 'Support tickets about billing dropped by a third in the first four days. We shipped the invoicing redesign this week, and renaming three fields was the whole change.');
  await api.click('#run');
  await api.waitForSelector('#report:not([hidden])', { timeout: 20000 });
  check('the receipts explain why a clean post is not 0.0', /scale stops at 0\.2 and 9\.9/.test(await api.textContent('#report')));
  // Hand the plain mode-llm route back to the blocks below, which count on
  // an AI-written report arriving for every specimen click.
  await api.unroute('**/api/analyze');
  await api.route('**/api/analyze', async route => {
    const report = await api.evaluate(t => window.YourPostSucks.analyze(t), route.request().postDataJSON().post);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'llm', report }) });
  });
}

// 8a1. the footer ticker
{
  check('ticker: offline there is no line at all, not a zero', await p.evaluate(() => document.getElementById('ticker').hidden));
  await api.route('**/api/status', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ticker: 12345, turnstileSiteKey: null }) }));
  await api.goto(httpUrl);
  await api.waitForTimeout(1400);
  check('ticker: shows the number the server gave, with thousands separators', await api.evaluate(() => !document.getElementById('ticker').hidden && document.getElementById('ticker-n').textContent === '12,345'), await api.textContent('#ticker'));
  check('ticker: says what the number is', /12,345 posts have been made to suck less since this site launched\./.test((await api.textContent('#ticker')).replace(/\s+/g, ' ')));
  check('ticker: sits in the footer, above the credit', await api.evaluate(() => { const f = document.querySelector('footer'); return f.firstElementChild.id === 'ticker'; }));
  await api.click('[data-spec="0"]');
  await api.waitForSelector('#report:not([hidden])', { timeout: 20000 });
  await api.waitForTimeout(1300);
  check('ticker: clicking Analyze moves it by exactly one, at once', (await api.textContent('#ticker-n')) === '12,346', await api.textContent('#ticker-n'));
  // Reword ticks it too. The mocked rewrite route answers the first click with a rewrite.
  await api.route('**/api/reword', async route => {
    const post = route.request().postDataJSON().post;
    const rewritten = 'We ran a six-week test on 41,000 users. My pick lost by 3 points.';
    const after = await api.evaluate(x => window.YourPostSucks.analyze(x), rewritten);
    const before = await api.evaluate(x => window.YourPostSucks.analyze(x), post);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'reworded', rewritten, summary: 'Shorter.', before, after }) });
  });
  await api.click('#rewordbtn');
  await api.waitForSelector('.reword-text', { timeout: 20000 });
  await api.waitForTimeout(1300);
  check('ticker: clicking Reword moves it by one more', (await api.textContent('#ticker-n')) === '12,347', await api.textContent('#ticker-n'));
  await api.unroute('**/api/reword');

  // Everybody else's posts arrive by asking again. The page asks once a
  // minute; the test runs the clock forward rather than waiting for it.
  await api.unroute('**/api/status');
  let statusAsks = 0;
  await api.route('**/api/status', route => { statusAsks++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ticker: 12400, turnstileSiteKey: null }) }); });
  await api.clock.install();
  await api.goto(httpUrl);
  await api.clock.runFor(2000);
  const asksAtLoad = statusAsks;
  await api.clock.runFor(61000);
  await api.clock.runFor(1500);
  check('ticker: the page asks again after a minute', statusAsks > asksAtLoad, asksAtLoad + ' then ' + statusAsks);
  await api.unroute('**/api/status');
  await api.route('**/api/status', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ticker: 12466, turnstileSiteKey: null }) }));
  await api.clock.runFor(61000);
  await api.waitForTimeout(300);   // let the mocked answer arrive
  await api.clock.runFor(3000);     // and the count-up finish
  check('  ...and other people\'s posts tick it up while you watch', (await api.textContent('#ticker-n')) === '12,466', await api.textContent('#ticker-n'));
  await api.unroute('**/api/status');
  await api.route('**/api/status', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ticker: 12000, turnstileSiteKey: null }) }));
  await api.clock.runFor(61000);
  await api.clock.runFor(1500);
  check('  ...and a stale answer never takes it backwards', (await api.textContent('#ticker-n')) === '12,466', await api.textContent('#ticker-n'));
  await api.unroute('**/api/status');
  await api.route('**/api/status', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ticker: null, turnstileSiteKey: null }) }));
  await api.goto(httpUrl);
  await api.waitForTimeout(900);
  check('ticker: no number from the server means no line', await api.evaluate(() => document.getElementById('ticker').hidden));
  await api.unroute('**/api/status');
}

// 8a2. what's new: the header link, the once-only pop-up, the meaner bar
{
  const SEEN = 'yps_whatsnew_seen';
  await api.goto(httpUrl);
  await api.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await api.goto(httpUrl);
  await api.waitForTimeout(1200);
  check("what's new: a first-time visitor is not interrupted", await api.evaluate(() => !document.getElementById('whatsnew').open));
  check("  ...but the header link is flagged for them", await api.evaluate(() => document.getElementById('whatsnewbtn').classList.contains('flagged')));
  await api.click('#whatsnewbtn');
  check("what's new: the header link opens it as a modal", await api.evaluate(() => document.getElementById('whatsnew').open));
  check('  ...and it says what changed in plain words', await api.evaluate(() => {
    const t = document.getElementById('whatsnew').textContent;
    return /meaner/i.test(t) && /link/i.test(t) && /rewrite keeps your voice/i.test(t) && /shouting/i.test(t);
  }));
  check('  ...and it asks for a coffee, labelled as its own place', await api.evaluate(() => {
    const a = document.querySelector('#whatsnew a[data-tip="whatsnew"]');
    return !!a && a.href === 'https://buymeacoffee.com/billyost' && /penny/.test(document.querySelector('.wn-tip').textContent);
  }));
  check('  ...no em dash in any of it', !/—/.test(await api.textContent('#whatsnew')));
  await api.keyboard.press('Escape');
  await api.waitForTimeout(300);
  check('what\'s new: Escape closes it and marks it seen', await api.evaluate(() => !document.getElementById('whatsnew').open && !!localStorage.getItem('yps_whatsnew_seen')));
  const seenValue = await api.evaluate(k => localStorage.getItem(k), SEEN);
  await api.goto(httpUrl);
  await api.waitForTimeout(1200);
  check('  ...and it does not come back once seen', await api.evaluate(() => !document.getElementById('whatsnew').open && !document.getElementById('whatsnewbtn').classList.contains('flagged')));

  // Someone who has been here before, on a version they have not seen.
  await api.evaluate(k => { try { localStorage.removeItem(k); localStorage.setItem('yps_theme', 'dark'); } catch (e) {} }, SEEN);
  await api.goto(httpUrl);
  await api.waitForSelector('#whatsnew[open]', { timeout: 4000 });
  check("what's new: a returning visitor gets it once, by itself", await api.evaluate(() => document.getElementById('whatsnew').open));
  await api.click('#wn-done');
  await api.waitForTimeout(300);
  check('  ...and Got it closes it', await api.evaluate(() => !document.getElementById('whatsnew').open));

  // The reading bar: a full rule in the page on load, a pinned progress bar once it scrolls away.
  const barState = () => api.evaluate(() => {
    const rule = document.getElementById('readrule'), bar = document.getElementById('readbar');
    const ruleBg = getComputedStyle(rule).backgroundImage, barBg = getComputedStyle(bar.querySelector('i'), '::before').backgroundImage;
    const rr = rule.getBoundingClientRect();
    return {
      ruleOn: rule.classList.contains('on'), ruleBlue: /57, 135, 229/.test(ruleBg), ruleRed: /242, 84, 60/.test(ruleBg),
      ruleInView: rr.bottom > 0 && rr.top < innerHeight, ruleWidth: Math.round(rr.width), ruleHeight: Math.round(rr.height),
      barBlue: /57, 135, 229/.test(barBg), barRed: /242, 84, 60/.test(barBg),
      stuck: bar.classList.contains('stuck'), barOpacity: Number(getComputedStyle(bar).opacity),
      fill: bar.querySelector('i').getBoundingClientRect().width / window.innerWidth
    };
  });
  await api.waitForTimeout(800);
  let bar = await barState();
  check('reading rule: on load the whole gradient is there, in blue, under the masthead', bar.ruleOn && bar.ruleBlue && !bar.ruleRed && bar.ruleInView && bar.ruleWidth > 300 && bar.ruleHeight === 6, JSON.stringify(bar));
  check('reading bar: the pinned one stays out of sight while the rule is in view', !bar.stuck && bar.barOpacity === 0);
  await api.click('#meaner');
  await api.waitForTimeout(800);
  bar = await barState();
  check('reading rule: meaner mode wipes it back on in red', bar.ruleOn && bar.ruleRed && !bar.ruleBlue && bar.barRed, JSON.stringify(bar));
  // With a report on the page there is somewhere to scroll to.
  await api.click('[data-spec="0"]');
  await api.waitForSelector('#report:not([hidden])', { timeout: 20000 });
  // The page scrolls itself to a new report; measure after that has landed.
  await api.waitForTimeout(1500);
  const fillAt = async y => { await api.evaluate(v => window.scrollTo(0, v), y); await api.waitForTimeout(450); return barState(); };
  const top = await fillAt(0);
  check('reading bar: back at the top the rule has the job again', top.ruleInView && !top.stuck && top.barOpacity === 0, JSON.stringify({ stuck: top.stuck, o: top.barOpacity }));
  const mid = await fillAt(await api.evaluate(() => (document.documentElement.scrollHeight - innerHeight) / 2));
  check('reading bar: once the rule scrolls away the pinned bar takes over', !mid.ruleInView && mid.stuck && mid.barOpacity === 1 && mid.barRed, JSON.stringify({ stuck: mid.stuck, o: mid.barOpacity }));
  const end = await fillAt(await api.evaluate(() => document.documentElement.scrollHeight));
  check('  ...and its fill is reading progress: half way, then all the way', mid.fill > 0.4 && mid.fill < 0.6 && end.fill > 0.97, mid.fill.toFixed(2) + ' / ' + end.fill.toFixed(2));
  check('  ...pinned to the top of the window, full width, out of the way of clicks', await api.evaluate(() => {
    const b = document.getElementById('readbar'), cs = getComputedStyle(b), r = b.getBoundingClientRect();
    return cs.position === 'fixed' && Math.round(r.top) === 0 && Math.round(r.width) === window.innerWidth && Math.round(r.height) === 6 && cs.pointerEvents === 'none';
  }));
  check('  ...over a faint track in the same colours', await api.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('readbar'), '::before');
    return /gradient/.test(cs.backgroundImage) && Number(cs.opacity) > 0.15 && Number(cs.opacity) < 0.5;
  }));
  await api.evaluate(() => window.scrollTo(0, 0));
  check('  ...and both pieces are decoration, hidden from screen readers', await api.getAttribute('#readbar', 'aria-hidden') === 'true' && await api.getAttribute('#readrule', 'aria-hidden') === 'true');
  await api.goto(httpUrl);
  await api.waitForTimeout(800);
  bar = await barState();
  check('reading rule: red again on the next visit, with the setting', bar.ruleOn && bar.ruleRed && await api.evaluate(() => document.getElementById('meaner').checked));
  await api.click('#meaner');
  await api.waitForTimeout(800);
  bar = await barState();
  check('  ...and back to blue when the setting goes', bar.ruleOn && bar.ruleBlue && !bar.ruleRed && bar.barBlue, JSON.stringify(bar));
  check('header: both header buttons keep a 44px target', await api.evaluate(() => ['whatsnewbtn', 'themetoggle'].every(id => document.getElementById(id).getBoundingClientRect().height >= 44)));
  // Leave it marked seen. The blocks below click through the page, and a
  // modal opening over them on load is exactly what it should do to a
  // returning visitor and exactly what would break them here.
  await api.evaluate(([k, v]) => { try { localStorage.clear(); localStorage.setItem(k, v); } catch (e) {} }, [SEEN, seenValue]);
}

// 8b. the thank-you card (the /api/analyze route above still answers mode llm)
{
  const tipHits = [];
  await api.route('**/api/tip', async route => {
    tipHits.push(route.request().postData());
    await route.fulfill({ status: 204, body: '' });
  });
  const TA = 'yps_tipask_v1';
  const setTA = v => api.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [TA, v]);
  const getTA = () => api.evaluate(k => JSON.parse(localStorage.getItem(k)), TA);
  const runSpec = async () => { await api.click('[data-spec="0"]'); await api.waitForSelector('#report:not([hidden])', { timeout: 20000 }); };
  await api.goto(httpUrl);
  await setTA({ n: 3, shown: 0, done: false });
  await api.goto(httpUrl);
  await runSpec();
  await api.waitForTimeout(3000);
  check('thank-you card: not shown at the 4th AI report', await api.evaluate(() => document.getElementById('tipask').hidden) && (await getTA()).n === 4);
  await api.goto(httpUrl);
  await runSpec();
  await api.waitForSelector('#tipask.on', { timeout: 6000 });
  check('thank-you card: shown after the 5th, with the first copy', /Five reports in/.test(await api.textContent('#tipask-h')));
  check('thank-you card: does not take focus', await api.evaluate(() => !document.getElementById('tipask').contains(document.activeElement)));
  check('thank-you card: no em dash', !/—/.test(await api.textContent('#tipask')));
  check('thank-you card: coffee link opens safely in a new tab', await api.evaluate(() => { const a = document.getElementById('tipask-go'); return a.href === 'https://buymeacoffee.com/billyost' && a.target === '_blank' && /noopener/.test(a.rel); }));
  check('thank-you card: both actions are 44px tall', await api.evaluate(() => ['tipask-go', 'tipask-no'].every(id => document.getElementById(id).getBoundingClientRect().height >= 44)));
  await api.click('#tipask-no');
  await api.waitForTimeout(400);
  check('thank-you card: Maybe later closes it', await api.evaluate(() => document.getElementById('tipask').hidden));
  await api.goto(httpUrl);
  await runSpec();
  await api.waitForTimeout(3000);
  check('thank-you card: not shown again at the 6th', await api.evaluate(() => document.getElementById('tipask').hidden));
  await setTA({ n: 24, shown: 1, done: false });
  await api.goto(httpUrl);
  await runSpec();
  await api.waitForSelector('#tipask.on', { timeout: 6000 });
  check('thank-you card: back once at the 25th, with the second copy', /Twenty-five reports/.test(await api.textContent('#tipask-h')));
  const [popup] = await Promise.all([api.context().waitForEvent('page'), api.click('#tipask-go')]);
  await popup.close();
  check('thank-you card: clicking the coffee link retires it for good', (await getTA()).done === true);
  await api.waitForTimeout(500);
  check('tip click: the card click is reported as "card", with nothing else in it', tipHits.some(b => b === '{"where":"card"}') && tipHits.every(b => !/post|text|id/i.test(b || '')), JSON.stringify(tipHits));
  check('tip click: every coffee link on the page is labelled', await api.evaluate(() => {
    const seen = Array.from(document.querySelectorAll('a[data-tip]')).map(a => a.getAttribute('data-tip'));
    return ['footer', 'card', 'whatsnew'].every(k => seen.includes(k)) && document.querySelectorAll('a[href*="buymeacoffee"]:not([data-tip])').length === 0;
  }));
  await setTA({ n: 49, shown: 1, done: true });
  await api.goto(httpUrl);
  await runSpec();
  await api.waitForTimeout(3000);
  check('thank-you card: never shown once retired', await api.evaluate(() => document.getElementById('tipask').hidden));
  await api.evaluate(k => localStorage.removeItem(k), TA);
}
check('thank-you card: a rules-only report is not counted', await p.evaluate(() => localStorage.getItem('yps_tipask_v1') === null));

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
check('accept lists avif and bmp too', /image\/avif,image\/bmp/.test(await api.getAttribute('#mediafile', 'accept')));
check('two images dropped at once: the first is used and the page says so', await api.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 8; c.height = 8;
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'first.png', { type: 'image/png' })); dt.items.add(new File([blob], 'second.png', { type: 'image/png' }));
  const panel = document.getElementById('post').closest('.panel') || document.body;
  const ev = new Event('drop', { bubbles: true, cancelable: true }); ev.dataTransfer = dt;
  document.getElementById('post').dispatchEvent(ev);
  await new Promise(r => setTimeout(r, 600));
  return document.getElementById('mediapreview-name').textContent === 'first.png' && /One image per post/.test(document.body.textContent);
}));
await api.click('#mediaremove');
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
check('End moves to the last tab', await api.evaluate(() => document.activeElement.id === 'tab-lab' && document.getElementById('tab-lab').getAttribute('aria-selected') === 'true'));
await api.keyboard.press('Home');
check('Home moves to the first tab', await api.evaluate(() => document.activeElement.id === 'tab-tool' && document.getElementById('tab-tool').getAttribute('aria-selected') === 'true'));
await api.keyboard.press('ArrowLeft');
check('Left from the first tab wraps to the last', await api.evaluate(() => document.activeElement.id === 'tab-lab'));
check('the address follows the tab, so a reload comes back to it', await api.evaluate(() => location.hash === '#soon'));
await api.keyboard.press('ArrowRight');
check('  ...and the first tab has no hash at all', await api.evaluate(() => location.hash === ''));
check('Right from the last tab wraps to the first, and only one tab is in the Tab order', await api.evaluate(() => document.activeElement.id === 'tab-tool' && document.querySelectorAll('.tab-btn[tabindex="0"]').length === 1 && document.querySelectorAll('[role=tabpanel]:not([hidden])').length === 1));

// 11a. the numbers
{
  const figures = (scored) => ({ ok: true, live: true, at: '2026-09-21T20:00:00.000Z', since: '2026-09-21', scored, clean: Math.round(scored * 0.1),
    bands: { barely: Math.round(scored * 0.6), normal: Math.round(scored * 0.3), lot: Math.round(scored * 0.08), completely: Math.round(scored * 0.02) },
    scores: [2, 20, 38, 18, 8, 4, 5, 3, 1, 1].map(p => Math.round(scored * p / 100)),
    rules: [{ id: 'announce', label: 'Excited to announce', dim: 'auth', n: Math.round(scored * 0.44) }, { id: 'hashwall', label: 'A wall of hashtags', dim: 'bait', n: Math.round(scored * 0.2) }, { id: 'quiet', label: 'A check nobody trips', dim: 'clar', n: 0 }, { id: 'not-english', label: 'Not in English', dim: 'clar', n: 0, countable: false }],
    flags: { media: Math.round(scored * 0.25), satire: 3, narrative: 12 },
    reword: { tried: { better: 50, couldNotBeat: 15, unusable: 5 }, notAttempted: 10, gain: { under1: 10, '1to2': 25, '2plus': 15 } },
    wait: { lt5s: 30, '5to10s': 50, '10to20s': 15, gt20s: 5 } });
  let body = figures(500), hits = 0;
  await api.goto(httpUrl);
  check('the numbers: the what\'s-new line about it is last, and hidden while the tab is', await api.evaluate(() => { const li = document.getElementById('wn-metrics'); return li.hidden && li === li.parentElement.lastElementChild && li.parentElement.children.length >= 6; }));
  {
    const open = await b.newPage();
    await open.route('**/api/status', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, metricsOpen: true, ticker: 10 }) }));
    await open.goto(httpUrl);
    await open.waitForFunction(() => !document.getElementById('tab-metrics').hidden, null, { timeout: 5000 });
    check('the numbers: once the site says it is open, everyone gets the tab and the what\'s-new line', await open.evaluate(() => !document.getElementById('wn-metrics').hidden && document.querySelectorAll('.tab-btn:not([hidden])').length === 4));
    await open.close();
  }
  check('the numbers: the tab is not on the page until it is open to everyone', await api.evaluate(() => document.getElementById('tab-metrics').hidden && document.querySelectorAll('.tab-btn:not([hidden])').length === 3));

  // Behind its door: the address shows the tab, the figures are refused, the padlock answers.
  let unlocked = false, guesses = [];
  await api.route('**/api/metrics/unlock', async route => { const g = JSON.parse(route.request().postData()).password; guesses.push(g); if (g === 'open sesame'){ unlocked = true; return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); } return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"wrong"}' }); });
  await api.route('**/api/metrics', route => { hits++; return unlocked ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }) : route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"locked"}' }); });
  await api.goto(httpUrl + '#the-numbers'); await api.reload();
  await api.waitForSelector('#mx-lock:not([hidden])', { timeout: 5000 });
  check('the numbers: locked, the address shows the tab and a padlock, with no email form and no figures', await api.evaluate(() => !document.getElementById('tab-metrics').hidden && document.querySelectorAll('#panel-metrics .mx-sec').length === 0 && !document.querySelector('#mx-lock input[type="email"]') && document.getElementById('mx-pass').type === 'password'));
  await api.fill('#mx-pass', 'wrong guess'); await api.click('#mx-go');
  await api.waitForSelector('#mx-err:not([hidden])', { timeout: 5000 });
  check('the numbers: a wrong password says so, clears the box and keeps the door shut', await api.evaluate(() => document.getElementById('mx-err').textContent === 'That is not it.' && document.getElementById('mx-pass').value === '' && document.activeElement.id === 'mx-pass' && document.querySelectorAll('#panel-metrics .mx-sec').length === 0));
  await api.fill('#mx-pass', 'open sesame'); await api.click('#mx-go');
  await api.waitForSelector('#panel-metrics .mx-sec', { timeout: 5000 });
  check('the numbers: the right one draws the figures, hides the padlock and moves focus to the first finding', await api.evaluate(() => document.getElementById('mx-lock').hidden && document.activeElement.classList.contains('mx-h') && !/open sesame/.test(document.documentElement.innerHTML)), JSON.stringify(guesses));
  check('the numbers: the footer says how fresh the figures are, and what a post is', await api.evaluate(() => { const t = document.getElementById('mx-foot').textContent; return /live, because you are behind the door/.test(t) && /A post is something a person pasted/.test(t) && !/no post text is kept/i.test(document.getElementById('panel-metrics').textContent); }));
  await api.unroute('**/api/metrics'); await api.unroute('**/api/metrics/unlock');

  // Headline drift: every headline is a template over live figures, so the
  // risk is a template that reads wrong at an edge. Sweep the edges.
  const edges = [
    ['an exact tie for the biggest group', d => { d.bands = { barely: 200, normal: 200, lot: 80, completely: 20 }; }],
    ['exactly half', d => { d.bands = { barely: 250, normal: 150, lot: 80, completely: 20 }; }],
    ['a top check under one percent', d => { d.rules.forEach((r, i) => r.n = i === 0 ? 2 : 0); }],
    ['no check has fired at all', d => { d.rules.forEach(r => r.n = 0); d.clean = d.scored; }],
    ['Reword never asked', d => { d.reword = { tried: { better: 0, couldNotBeat: 0, unusable: 0 }, notAttempted: 0, gain: {} }; }],
    ['Reword tried, never once won', d => { d.reword = { tried: { better: 0, couldNotBeat: 50, unusable: 10 }, notAttempted: 5, gain: {} }; }],
    ['the top two sins within noise of each other', d => { d.rules[0].n = 100; d.rules[1].n = 95; }],
    ['one post short of all', d => { d.flags.media = d.scored - 1; }],
    ['nobody waited on the AI', d => { d.wait = { lt5s: 0, '5to10s': 0, '10to20s': 0, gt20s: 0 }; }],
    ['every post in one score bucket', d => { d.scores = [0, 0, 500, 0, 0, 0, 0, 0, 0, 0]; d.bands = { barely: 500 }; }],
    ['a check whose name has a quote and an angle bracket in it', d => { d.rules[0].label = 'Says "synergy" <b>twice</b>'; }]
  ];
  const drift = [];
  for (const [name, bend] of edges) {
    const d = figures(500); bend(d);
    await api.route('**/api/metrics', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) }));
    await api.goto(httpUrl + '#how-it-works'); await api.goto(httpUrl + '#the-numbers'); await api.reload();
    await api.waitForSelector('#panel-metrics .mx-sec', { timeout: 5000 });
    const bad = await api.evaluate(() => { const p = document.getElementById('panel-metrics'); const t = p.textContent; const heads = [...p.querySelectorAll('.mx-h')].map(h => h.textContent);
      return [/NaN|undefined|null|Infinity/.test(t) && 'a broken number', heads.some(h => !h.trim() || /""|, in 0% of posts| 0% of the times|^0% of AI|100%|^Every post so far came/.test(h)) && 'a headline that says nothing, or all when it is not all: ' + heads.join(' | '), p.querySelector('.mx-h b, .mx-bars b') && 'markup from a label was rendered', document.documentElement.scrollWidth > innerWidth + 1 && 'sideways scroll'].filter(Boolean); });
    if (bad.length) drift.push(name + ': ' + bad.join('; '));
    await api.unroute('**/api/metrics');
  }
  check('the numbers: no headline reads wrong at the edges (ties, zeros, a single bucket, an awkward label)', drift.length === 0, drift.join(' || '));

  await api.route('**/api/metrics', route => { hits++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }); });
  hits = 0;
  await api.goto(httpUrl + '#how-it-works'); await api.goto(httpUrl + '#the-numbers'); await api.reload();
  await api.waitForSelector('#panel-metrics .mx-sec', { timeout: 5000 });
  const seen = await api.evaluate(() => ({
    selected: document.getElementById('tab-metrics').getAttribute('aria-selected'),
    heads: [...document.querySelectorAll('#panel-metrics .mx-h')].map(h => h.textContent),
    tiles: [...document.querySelectorAll('#panel-metrics .mx-tile .v')].map(v => v.textContent),
    bars: document.querySelectorAll('#panel-metrics svg rect[rx="2"]').length,
    rows: [...document.querySelectorAll('#panel-metrics .mx-sec:nth-of-type(2) .mx-bars li')].map(li => li.textContent),
    text: document.getElementById('panel-metrics').textContent,
    scroll: document.documentElement.scrollWidth <= innerWidth + 1
  }));
  check('the numbers: the address opens the tab, and it draws from api/metrics', seen.selected === 'true' && hits >= 1 && seen.tiles[0] === '500' && seen.bars === 10, JSON.stringify(seen.tiles) + ' bars=' + seen.bars + ' hits=' + hits);
  check('the numbers: every headline states a finding, written from the figures', /^60% of posts barely suck$/.test(seen.heads[0]) && /"Excited to announce", in 44% of posts/.test(seen.heads[1]) && /beat the original 71% of the times it tried/.test(seen.heads[2]) && /^80% of AI write-ups take under ten seconds$/.test(seen.heads[3]) && /^25% of posts came with an image or video$/.test(seen.heads[4]), JSON.stringify(seen.heads));
  check('the numbers: the sins are one grey, with the category written under each name', await api.evaluate(() => { const li = document.querySelector('#mx-rules li'); return /Inauthenticity/.test(li.querySelector('.c').textContent) && !document.querySelector('#mx-rules .mx-fill[style*="--c"]'); }));
  check('the numbers: "Not in English" is listed as not countable, not as never fired', await api.evaluate(() => { document.getElementById('mx-more') && document.getElementById('mx-more').click(); const li = [...document.querySelectorAll('#mx-rules li')].find(l => /Not in English/.test(l.textContent)); const ok = li && /not counted here/.test(li.textContent); document.getElementById('mx-more') && document.getElementById('mx-more').click(); return ok; }));
  check('the numbers: checks that fired are ranked, and one that never fired is kept out of the top list', seen.rows.length === 2 && /Excited to announce/.test(seen.rows[0]), JSON.stringify(seen.rows));
  await api.click('#mx-more');
  check('the numbers: "show all" lists the check that never fired, and says never', await api.evaluate(() => /A check nobody trips[\s\S]*never/.test(document.querySelector('#panel-metrics .mx-bars li.zero').textContent) && document.activeElement.id === 'mx-more' && document.activeElement.getAttribute('aria-expanded') === 'true'));
  check('the numbers: no em dash, no sample notice off localhost data, no sideways scroll', !/\u2014/.test(seen.text) && !/Sample figures/.test(seen.text) && seen.scroll);
  check('the numbers: the chart says what it shows to a screen reader', await api.evaluate(() => (l => /^Posts by score\. 0 to 0\.9, barely sucks: 2%;/.test(l) && /3 to 3\.9, barely sucks or sucks a normal amount: /.test(l))(document.querySelector('#panel-metrics svg').getAttribute('aria-label'))));

  body = figures(12);
  await api.goto(httpUrl + '#how-it-works'); await api.goto(httpUrl + '#the-numbers'); await api.reload();
  await api.waitForSelector('#panel-metrics .mx-sec', { timeout: 5000 });
  check('the numbers: under 30 posts the headlines refuse to generalise', await api.evaluate(() => /^Too few posts to say anything true yet: 12 so far$/.test(document.querySelector('#panel-metrics .mx-h').textContent)));
  check('  ...and the tiles and bars print counts, not percentages', await api.evaluate(() => { const tiles = [...document.querySelectorAll('#panel-metrics .mx-tile .v')].map(v => v.textContent); return tiles[1] === '1 of 12' && ![...document.querySelectorAll('#panel-metrics .mx-bars .p')].some(p => /%/.test(p.textContent)); }));

  body = { ok: false };
  await api.reload();
  await api.waitForFunction(() => /did not answer/.test(document.getElementById('mx-live').textContent), null, { timeout: 5000 });
  check('the numbers: when they cannot be read the tab says so and draws nothing', await api.evaluate(() => document.querySelectorAll('#panel-metrics .mx-sec').length === 0));
  await api.unroute('**/api/metrics');
}

// 11a2. where the text came from
{
  const sources = [];
  await api.route('**/api/analyze', route => { sources.push(route.request().headers()['x-yps-source']); return route.fulfill({ status: 500, contentType: 'text/plain', body: 'no' }); });
  await api.goto(httpUrl);
  await api.evaluate(() => { try { localStorage.setItem('yps_whatsnew_seen', window.YPSClient.whatsnewVersion); } catch (e) {} const d = document.querySelector('dialog[open]'); if (d) d.close(); });
  await api.click('[data-spec]');
  await api.waitForFunction(n => n, sources.length, { timeout: 100 }).catch(() => {});
  await new Promise(r => setTimeout(r, 400));
  await api.fill('#post', 'I typed this one myself about the quarterly review, which ran long.');
  await api.click('#run');
  await new Promise(r => setTimeout(r, 400));
  check('a specimen click says so, and a typed post says paste', sources[0] === 'specimen' && sources[sources.length - 1] === 'paste', JSON.stringify(sources));
  await api.unroute('**/api/analyze');
}

// 11b. the masthead at 320, the narrowest phone still in use
{
  const narrow = await b.newPage({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
  await narrow.goto(httpUrl);
  await narrow.evaluate(v => { try { localStorage.setItem('yps_whatsnew_seen', v); } catch (e) {} }, WHATSNEW_VERSION);
  await narrow.goto(httpUrl);
  await narrow.waitForTimeout(400);
  const m = await narrow.evaluate(() => {
    const br = document.querySelector('.brand').getBoundingClientRect(), ha = document.querySelector('.head-actions').getBoundingClientRect();
    return { overlap: br.right > ha.left + 0.5 && br.bottom > ha.top && ha.bottom > br.top, sideways: document.documentElement.scrollWidth > innerWidth, targets: ['whatsnewbtn', 'themetoggle'].every(id => document.getElementById(id).getBoundingClientRect().height >= 44) };
  });
  check('320px: the header buttons do not sit on the logo', !m.overlap, JSON.stringify(m));
  check('320px: nothing scrolls sideways and the targets are still 44px', !m.sideways && m.targets, JSON.stringify(m));
  await narrow.close();
}

// 12. the locked room: a door, and nothing about what is behind it
{
  let uiAsks = 0, unlockBodies = [], interestBodies = [], unlockStatus = 401, uiOpen = false;
  await api.route('**/api/lab/ui', route => { uiAsks++; return uiOpen
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ css: '.lab-proof{color:rgb(1,2,3)}', html: '<div class="panel"><p class="lab-proof" id="lab-proof">inside</p></div>', js: 'window.__labRan = typeof window.YPSLab.handoff === "function" && typeof window.YPSLab.token === "function";' }) })
    : route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"locked"}' }); });
  await api.route('**/api/lab/unlock', route => { unlockBodies.push(route.request().postDataJSON()); if (unlockStatus === 200) uiOpen = true; return route.fulfill({ status: unlockStatus, contentType: 'application/json', body: '{}' }); });
  await api.route('**/api/lab/interest', route => { interestBodies.push(route.request().postDataJSON()); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });

  await api.goto(httpUrl);
  await api.waitForTimeout(500);
  check('locked room: an ordinary visit never asks the server about it', uiAsks === 0, uiAsks + ' asks');
  // The words that must never appear in the public page live in a local,
  // gitignored file, one per line, so this public test does not spell out
  // the thing it is guarding. Without the file the check says it was
  // skipped, the way the corpus-backed checks do.
  {
    let words = null;
    try { words = (await readFile(resolve(import.meta.dirname, '.private-words'), 'utf8')).split(/\r?\n/).map(w => w.trim().toLowerCase()).filter(Boolean); } catch {}
    if (!words || !words.length) console.log('NOTE: .private-words is not in this checkout. The page-source guard is skipped.');
    else {
      const found = await api.evaluate(list => { const src = document.documentElement.outerHTML.toLowerCase(); return list.filter(w => src.includes(w)).length; }, words);
      check('locked room: the page source says nothing about what is behind the door', found === 0, found + ' of ' + words.length + ' private words found');
    }
  }
  await api.click('#tab-lab');
  await api.waitForTimeout(500);
  check('locked room: opening the tab asks once, and shows the padlock when the answer is no', uiAsks === 1 && await api.evaluate(() => !document.getElementById('lab-lock').hidden && document.getElementById('lab-mount').hidden));
  check('locked room: a password field that browsers will not offer to fill or remember', await api.evaluate(() => { const i = document.getElementById('lab-pass'); return i.type === 'password' && i.autocomplete === 'off'; }));
  check('locked room: every control is a 44px target', await api.evaluate(() => ['lab-pass', 'lab-go', 'lab-email', 'lab-int-go'].every(id => document.getElementById(id).getBoundingClientRect().height >= 44)));
  check('locked room: no em dash at the door', !/—/.test(await api.textContent('#lab-lock')));

  await api.fill('#lab-pass', 'not-the-password');
  await api.click('#lab-go');
  await api.waitForTimeout(500);
  check('locked room: a guess goes with a bot-check field, null here because this test site has no widget', 'turnstileToken' in unlockBodies[0]);
  check('locked room: a wrong password is told so, and the field is emptied', /That is not it/.test(await api.textContent('#lab-err')) && (await api.inputValue('#lab-pass')) === '' && unlockBodies.length === 1 && unlockBodies[0].password === 'not-the-password');
  check('  ...and nothing about it is kept in the browser', await api.evaluate(() => !JSON.stringify(Object.assign({}, localStorage, sessionStorage)).includes('not-the-password')));
  unlockStatus = 404;
  await api.fill('#lab-pass', 'x'); await api.click('#lab-go'); await api.waitForTimeout(400);
  check('locked room: no secret on the server reads as no door', /nothing behind this door yet/.test(await api.textContent('#lab-err')));
  unlockStatus = 429;
  await api.fill('#lab-pass', 'x'); await api.click('#lab-go'); await api.waitForTimeout(400);
  check('locked room: too many tries is said plainly', /Too many tries/.test(await api.textContent('#lab-err')));

  await api.fill('#lab-email', 'not an email'); await api.click('#lab-int-go'); await api.waitForTimeout(200);
  check('locked room: a bad email never leaves the page', interestBodies.length === 0 && /does not look like an email/.test(await api.textContent('#lab-int-msg')));
  await api.fill('#lab-email', 'reader@example.com'); await api.click('#lab-int-go'); await api.waitForTimeout(400);
  check('locked room: a good email is sent, alone, and acknowledged', interestBodies.length === 1 && JSON.stringify(interestBodies[0]) === '{"email":"reader@example.com"}' && /Noted/.test(await api.textContent('#lab-int-msg')) && (await api.inputValue('#lab-email')) === '');

  unlockStatus = 200;
  await api.fill('#lab-pass', 'right'); await api.click('#lab-go');
  await api.waitForSelector('#lab-proof', { timeout: 5000 });
  check('locked room: the right password mounts what the server hands over', await api.evaluate(() => document.getElementById('lab-lock').hidden && !document.getElementById('lab-mount').hidden && getComputedStyle(document.getElementById('lab-proof')).color === 'rgb(1, 2, 3)' && window.__labRan === true));
  check('  ...and the padlock on the tab opens', await api.evaluate(() => document.getElementById('lab-ico').textContent === '\u{1F513}'));
  // A real reload: going to the same address with only a new hash keeps the
  // old document, and the mount from the unlock above with it.
  await api.goto('about:blank');
  await api.goto(httpUrl + '#soon');
  await api.waitForSelector('#lab-proof', { timeout: 5000 });
  check('locked room: someone already let in does not meet the padlock again', await api.evaluate(() => document.getElementById('lab-lock').hidden && !document.getElementById('panel-lab').hidden));
  await api.evaluate(() => window.YPSLab.handoff('We shipped the invoicing redesign this week and support tickets about billing dropped by a third in four days.', 'A note from the room.'));
  await api.waitForSelector('#report:not([hidden])', { timeout: 20000 });
  check('locked room: a handoff is said aloud, since a tab changed without being pressed', /Sent to the first tab/.test(await api.textContent('#live')) || /Report ready/.test(await api.textContent('#live')));
  // Text that needs cleaning: the hygiene notice and the room's own note must both survive.
  await api.evaluate(() => window.YPSLab.handoff('hashtag#leadership is the future ​ of work, and we shipped the invoicing redesign this week with a third fewer billing tickets.', 'A second note.'));
  await api.waitForSelector('#report:not([hidden])', { timeout: 20000 });
  check('locked room: a handoff keeps the hygiene notices as well as its own note', await api.evaluate(() => { const n = document.getElementById('notices').textContent; return /A second note/.test(n) && n.replace('A second note.', '').trim().length > 20; }), await api.textContent('#notices'));
  check('locked room: a handoff lands in the analyzer like a paste, with its note', await api.evaluate(() => !document.getElementById('panel-tool').hidden && /invoicing redesign/.test(document.getElementById('post').value) && /A second note/.test(document.getElementById('notices').textContent)));
  await api.unroute('**/api/lab/ui'); await api.unroute('**/api/lab/unlock'); await api.unroute('**/api/lab/interest');
}

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
