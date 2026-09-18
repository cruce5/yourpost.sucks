import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 900, height: 1300 }, deviceScaleFactor: 2 });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file:///home/claude/yourpost/public/index.html');

const bold = s => [...s].map(c => {
  const i = c.charCodeAt(0);
  if (c >= 'A' && c <= 'Z') return String.fromCodePoint(0x1D5D4 + i - 65);
  if (c >= 'a' && c <= 'z') return String.fromCodePoint(0x1D5EE + i - 97);
  return c;
}).join('');

const messy = ['Bill Yost','3rd+','People Analytics @ Netflix','2h • Edited','',
  bold('Big news.'),'',
  "I'm thrilled to announce I'm joining a new company! Grateful 🙌🙌",'',
  'hashtag#Leadership hashtag#Growth','','…see more','',
  'Like','Comment','Repost','47 reactions','12 comments'].join('\n');

// simulate a real paste, not a fill
await p.evaluate(t => {
  const ta = document.getElementById('post');
  ta.focus();
  const dt = new DataTransfer();
  dt.setData('text/plain', t);
  ta.value = t;
  ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
}, messy);
await p.waitForTimeout(300);

console.log('notices shown :', await p.$$eval('#notices li', ns => ns.map(n => n.textContent)));
console.log('cleaned text  :', JSON.stringify(await p.inputValue('#post')));
await p.click('#run');
await p.waitForSelector('#report:not([hidden])', { timeout: 20000 });
await p.waitForTimeout(300);
console.log('score         :', await p.textContent('.hero .num'));
const roasts = await p.$$eval('ul.roasts li .tag', ns => ns.map(n => n.textContent));
console.log('roast tags    :', roasts.join(', '));
console.log('fake bold hit :', roasts.includes('Fake bold'));
await p.screenshot({ path: 'shot-paste.png', fullPage: true });
console.log('ERRORS        :', errs.length ? errs : 'none');
await b.close();
