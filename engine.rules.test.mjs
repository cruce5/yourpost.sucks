/* Rule-level tests for src/engine.js: score bands, text normalisation, the
   sensitive gate, saturation, hollow posts, roast correctness, credits vs
   roasts, threshold ramps and the tokenizer. No network, no build step
   needed: loads the UMD source directly. Exits 1 on any failure. */
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
require('./src/engine.js');
const E = globalThis.YourPostSucks;
// corpus.json is real LinkedIn posts by real people, so it is not in the public
// repo. With it, every corpus-backed check below runs. Without it they are
// skipped and said so, and everything that does not need it still runs.
const CORPUS_URL = new URL('./corpus.json', import.meta.url);
const HAS_CORPUS = existsSync(CORPUS_URL);
const corpus = HAS_CORPUS ? JSON.parse(readFileSync(CORPUS_URL, 'utf8')) : [];
if (!HAS_CORPUS) console.log('NOTE: corpus.json is not in this checkout (it is private). Corpus-backed checks are skipped.');
// The owner's own post, inlined so the name-emoji guard runs for everyone.
// Rows written by other people are looked up by a hash of their id, so this
// public file never names anyone whose post is in the private corpus.
const rowKey = id => createHash('sha256').update(id).digest('hex').slice(0, 12);
const byKey = k => corpus.find(p => rowKey(p.id) === k);
const GUARD_POST = "Fatherhood changed how I work.\n\nI'm up at 5:30 for a workout. Somewhere around six my toddler wakes up and needs me to \"make her breakfask\" immediately. That is the end of the workout and the start of a chaos that runs until roughly my first meeting.\n\nBefore kids I had a release valve. A quiet Sunday morning with a hard problem and no Slack pinging. A Tuesday night rerunning a query because something felt off. That time is gone. It now belongs to a 3.5 year old.\n\nSo I have to be locked in during work hours. There is not \"I'll pick this up tonight.\" Tonight is bath time.\n\nAnyway, this is why I write all my LinkedIn content from the bathroom.\n\n--\nI'm 🏴‍☠️ Bill and this post took three flushes";

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
};
const section = t => console.log(`\n=== ${t} ===`);

const ids = r => r.roasts.map(x => x.id);
const ctxOf = text => E.buildContext(E.normalizeText(text));
const ruleById = id => E.RULES.find(r => r.id === id);
const fires = (id, text) => !!ruleById(id).test(ctxOf(text));
const cat = (r, key) => r.categories.find(c => c.key === key);
// Several seeds for the same rule: the roast is picked by hash, so a guard
// bug shows up in some variants and not others. Appending a neutral
// sentence changes the seed without changing which rule fires.
const variants = text => [
  text, text + '\nThat is the whole story.', text + '\nNothing else happened.',
  text + '\nIt is Tuesday.', text + '\nThe end.', text + '\nMore later.'
];
// A post of exactly n words as the engine counts them, all lowercase, with
// no numbers, no proper nouns and no past-tense verbs (a told story is now
// exempt from no-specifics), so only the length-gated rules can move.
const POOL = 'the team keeps asking for another dashboard and nobody opens it after launch because the question is never written down so we build what is easy instead of what is useful and then wonder why the meeting about it goes quiet'.split(' ');
const withWc = n => {
  const words = [];
  while (ctxOf(words.join(' ')).wc < n) words.push(POOL[words.length % POOL.length]);
  return words.join(' ') + '.';
};

/* ------------------------------------------------------------------ */
section('1. score bands');
{
  check('bandFor exposed on the api', typeof E.bandFor === 'function');
  const b = E.bandFor;
  check('barely below 3.2', b(0.2).key === 'barely' && b(3.19).label === 'barely sucks');
  check('normal 3.2..5.6', b(3.2).key === 'normal' && b(5.59).label === 'sucks a normal amount');
  check('lot 5.6..8.0', b(5.6).key === 'lot' && b(7.99).label === 'sucks a lot');
  check('completely at 8.0 and above', b(8.0).key === 'completely' && b(9.9).label === 'sucks completely');
  const r = E.analyze('Nothing humbles a person faster than opening a SQL query you wrote six months ago.');
  check('analyze returns band matching bandFor(overall)', r.band && r.band.key === E.bandFor(r.overall).key, JSON.stringify(r.band));

  const BENCH = /median|distribution|decile|benchmark|percentile|average post/i;
  const samples = [
    'Nothing humbles a person faster than opening a SQL query you wrote six months ago.',
    'Excited to announce I am joining TechCorp! Grateful for this opportunity. Thoughts?\n#leadership #growth',
    'Humbled and honored to share that I have been named to the Top 40 Under 40. Let that sink in. Comment YES below and follow me for more! #blessed #grateful #leadership',
    '🚀🚀 BIG NEWS 🚀🚀\n\nI am beyond excited to announce that I am officially starting a new chapter! 🙌🙌🙌\n\nLet that sink in.\n\nHumbled and grateful. It is not just a job, it is a testament to never giving up.\n\n✅ Stay hungry\n✅ Leverage your network\n\nAgree? Comment YES below 👇 and follow me for more!\n\n#leadership #growth #mindset #hustle #grateful'
  ];
  const bandsSeen = new Set();
  let noBench = true;
  for (const s of variants(samples[0]).concat(samples)) {
    const x = E.analyze(s);
    bandsSeen.add(x.band.key);
    if (BENCH.test(x.oneLiner)) noBench = false;
  }
  check('one-liners never mention a median, distribution, decile or benchmark', noBench);
  check('samples span at least three bands', bandsSeen.size >= 3, [...bandsSeen].join(','));
}

/* ------------------------------------------------------------------ */
section('2. normalise before scoring');
{
  const cliche = 'Excited to announce I am joining TechCorp as Senior Manager! Humbled and grateful for this opportunity and can\'t wait to make an impact. Let that sink in. Thanks to everyone who believed in me. Agree? Comment below and follow me for more! #leadership #growth #grateful';
  const base = E.analyze(cliche);
  const doubled = E.analyze(cliche.replace(/ /g, '  '));
  check('double-space attack scores within 0.1', Math.abs(base.overall - doubled.overall) <= 0.1, `${base.overall} vs ${doubled.overall}`);
  check('double-space attack fires the same rules', ids(base).join() === ids(doubled).join());

  check('soft hyphen inside a phrase does not hide it', ids(E.analyze('Exc­ited to an­nounce I am joining TechCorp today as an analyst.')).includes('announce'));
  check('Cyrillic homoglyphs inside Latin words are folded', ids(E.analyze('Exсited tо annоunсe I am joining TechCorp today as an analyst.')).includes('announce'));
  check('a real Cyrillic word is left alone', E.normalizeText('Москва is a city') === 'Москва is a city');
  check('a lone lookalike is left alone', E.normalizeText('с and c') === 'с and c');

  check('curly apostrophe: cantwait still matches', ids(E.analyze('I’m excited to announce I’m joining Acme and I can’t wait to start.')).includes('cantwait'));
  check('curly apostrophe: not-just still matches', ids(E.analyze('It’s not just a dashboard, it’s a mindset. We built it in a week.')).includes('not-just'));
  check('curly double quotes fold to straight', E.normalizeText('“quoted”') === '"quoted"');

  const lf = 'Big news.\n\nI am officially starting a new chapter.\n\nHumbled and grateful.\n\nThoughts?';
  const crlf = lf.replace(/\n/g, '\r\n');
  check('CRLF and LF give byte-identical results (brutal take and verdicts included)',
    JSON.stringify(E.analyze(lf)) === JSON.stringify(E.analyze(crlf)));
  check('CR alone is also LF', JSON.stringify(E.analyze(lf)) === JSON.stringify(E.analyze(lf.replace(/\n/g, '\r'))));

  const cp = E.cleanPaste('Excited  to­announce’ something\r\nnew');
  check('cleanPaste applies the same normalisation', cp.text === E.normalizeText('Excited  to­announce’ something\r\nnew').trim(), JSON.stringify(cp.text));
  check('cleanPaste output re-normalises to itself (client text == scored text)', E.normalizeText(cp.text) === cp.text);
  check('deterministic: same input twice, same JSON', JSON.stringify(E.analyze(cliche)) === JSON.stringify(E.analyze(cliche)));
}

/* ------------------------------------------------------------------ */
section('3. sensitive gate');
{
  const declines = t => !!E.analyze(t).sensitive;
  const byId = id => { const p = corpus.find(x => x.id === id); return p ? p.text : null; };
  const mustDecline = [
    ['corpus cancer-five-years', byId('cancer-five-years')],
    ['corpus row 468859ab3969', (byKey('468859ab3969') || { text: null }).text],
    ['first-person miscarriage', 'I had a miscarriage last spring and I did not tell anyone at work for months.'],
    ['family suicide', 'My brother took his own life in March. I am posting this because nobody at his company knew.'],
    ['suicidal, whole word', 'A year ago I was suicidal and hiding it behind a full calendar.'],
    ['family loss', 'We lost my dad in October and I went back to work the following Monday.'],
    ['lost my mother', 'I lost my mother this year and the out-of-office reply was the hardest thing I wrote.'],
    ['passed away', 'My mentor passed away last week. He hired me when nobody else would.'],
    ['personal cancer, tier 2 with context', 'My wife was diagnosed with cancer in January. We are okay. I am not posting for a while.'],
    ['personal chemo', 'I start chemo on Monday, so the newsletter is paused.'],
    ['personal stroke', 'My father had a stroke on Tuesday and I have been at the hospital since.'],
    ['hospice', 'My mother is in hospice and I am learning what matters.'],
    ['funeral, personal', 'I gave the eulogy at my grandfather\'s funeral yesterday.'],
    ['heart attack, personal', 'My husband had a heart attack at 44. Here is what changed.'],
    ['sexual assault, tier 1', 'I am a survivor of sexual assault and this is the first time I have said so publicly.'],
    ['overdose, tier 1', 'My sister died of an overdose two years ago today.']
  ];
  for (const [name, t] of mustDecline.filter(x => x[1] !== null)) check(`declines: ${name}`, declines(t), t.replace(/\s+/g, ' ').slice(0, 60));

  const mustNotDecline = [
    ['cancer screening model', 'I spent the quarter building a cancer screening model for the radiology team.'],
    ['a cancer research startup', 'My friend just joined a cancer research startup as their first data hire.'],
    ['the project died', 'The project died in committee and I was relieved, honestly.'],
    ['my laptop battery died', 'My laptop battery died halfway through the demo and I finished it from my phone.'],
    ['career suicide (idiom)', 'Quitting in the middle of a launch is career suicide and I did it anyway.'],
    ['political suicide (idiom)', 'Telling the board the forecast was wrong felt like political suicide. I did it.'],
    ['one stroke off my best', 'I finished one stroke off my best and I am still annoyed about it.'],
    ['a stroke of luck', 'It was a stroke of luck that my flight was delayed, or I would have missed her call.'],
    ['remission of fees', 'The remission of fees for our early customers cost us nothing and won us three renewals.'],
    ['the IVF committee', 'I sat on the IVF committee for the benefits review and learned a lot about our policy.'],
    ['chemodynamics', 'My thesis was on chemodynamics and nobody on my team knows what that means.'],
    ['funeral home chain (business)', 'My first client was a funeral home chain in Ohio, which taught me a lot about pricing.'],
    ['anti-harassment policy', 'I rewrote our anti-harassment policy in plain English and the legal team let me.'],
    ['good grief', 'Good grief, I have never seen a deck with this many slides.'],
    ['the stock had a heart attack', 'The stock had a heart attack when I posted the numbers, then recovered by lunch.'],
    ['assaulted by spreadsheets', 'I was assaulted by spreadsheets for the entire month of March.'],
    ['lost my job (not bereavement)', 'I lost my job in June and I am writing about what I did next.'],
    ['we lost the deal (business)', 'We lost the deal on Friday and my team took it better than I did.'],
    ['diagnosed the bug', 'I diagnosed the bug in an hour and my fix took three days.'],
    ['terminal window', 'I opened the terminal and my whole career flashed before me.'],
    ['death by powerpoint', 'The offsite was death by powerpoint and my slides were part of the problem.'],
    ['a plain post', 'Nothing humbles a person faster than opening a SQL query you wrote six months ago.']
  ];
  for (const [name, t] of mustNotDecline) check(`does not decline: ${name}`, !declines(t), t.slice(0, 60));
  check('sensitiveCheck uses word boundaries (hospitality is not hospital)', !declines('My hospitality background made me a better analyst, and I am grateful for it.'));
}

/* ------------------------------------------------------------------ */
section('4. saturation and contradiction');
{
  const FINE = /this is fine|nothing here is embarrassing|without asking anybody|simply absent/i;
  const baitWall = 'Comment below. Drop a comment. Tag someone who needs this. Follow me for more. Repost this. Save this post. Link in comments. Agree?';
  const r = E.analyze(baitWall);
  check('bait-saturated post lands at or above 4.0', r.overall >= 4.0, `overall ${r.overall}, bait ${cat(r, 'bait').score}`);
  check('bait-saturated post is not in the barely band', r.band.key !== 'barely', r.band.key);
  check('bait-saturated post never gets a "this is fine" take', !FINE.test(r.brutal), r.brutal.slice(0, 60));

  const emojiHeavy = '🚀🚀🚀🚀🚀🚀🚀🚀 launch day is here 🎉🎉🎉🎉🎉🎉 so proud 🙌🙌🙌🙌';
  const e = E.analyze(emojiHeavy);
  const maxSuck = Math.max(...e.categories.map(c => c.suck));
  check('any dimension at 8.5+ forces overall >= 4.0 + (max - 8.5) * 0.8', maxSuck < 8.5 || e.overall >= Math.round((4.0 + (maxSuck - 8.5) * 0.8) * 10) / 10 - 0.05, `max ${maxSuck}, overall ${e.overall}`);
  check('worst dimension >= 6.5 never yields a "this is fine" take', maxSuck < 6.5 || !FINE.test(e.brutal), e.brutal.slice(0, 60));

  const only = E.analyze('🚀🚀🚀');
  check('emoji-only post has findings and is not scored 0', only.overall > 0.2 && only.stats.rulesFired >= 2, `overall ${only.overall}, fired ${only.stats.rulesFired}`);
  check('emoji-only post is not reported as empty', only.empty === false);
  check('truly empty post is still empty and 0', E.analyze('').empty === true && E.analyze('').overall === 0.2);
}

/* ------------------------------------------------------------------ */
section('5. hollow posts');
{
  const rep = E.analyze('We ship on Friday. We ship on Friday. We ship on Friday. Nobody asked why.');
  check('repetition fires on a sentence repeated three times', ids(rep).includes('repetition'));
  const repRoast = rep.roasts.find(x => x.id === 'repetition');
  check('repetition roast quotes the repeated sentence or counts the repeats', /We ship on Friday|of the 4 sentences/.test(repRoast.text), repRoast.text);
  check('repetition fires when repeats are most of a longer post', fires('repetition', 'Yes we can. Yes we can. No we cannot. No we cannot. Maybe. Yes we can.'));
  check('repetition does not fire on four distinct sentences', !fires('repetition', 'We shipped on Friday. Nobody opened it. Monday was quiet. Tuesday was quieter.'));
  check('repetition suppresses credits', rep.credits.length === 0);

  const lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';
  const purple = 'Purple elevator sandwich quantum banana whispers loudly beneath the fluorescent parking ostrich while seventeen marmalade tractors negotiate velvet thunder.';
  check('gibberish fires on lorem ipsum', ids(E.analyze(lorem)).includes('gibberish'));
  check('gibberish fires on word salad', ids(E.analyze(purple)).includes('gibberish'));
  check('gibberish suppresses credits', E.analyze(lorem).credits.length === 0 && E.analyze(purple).credits.length === 0);
  check('gibberish does not fire on jargon-heavy real prose', !fires('gibberish', 'We leveraged cross-functional synergies to operationalize a holistic, data-driven ecosystem of actionable insights at scale for our stakeholders.'));

  const spanish = 'Hola a todos, hoy quiero compartir con ustedes una reflexión sobre el trabajo en equipo y la importancia de la comunicación para lograr los objetivos de la empresa.';
  const german = 'Heute möchte ich mit euch teilen, was ich in den letzten Monaten über Führung gelernt habe. Es ist nicht einfach, aber es lohnt sich für das ganze Team und für mich.';
  const portuguese = 'Hoje quero compartilhar com vocês uma reflexão sobre o trabalho em equipe e a importância da comunicação para alcançar os objetivos da empresa.';
  for (const [name, t] of [['Spanish', spanish], ['German', german], ['Portuguese', portuguese]]) {
    const x = E.analyze(t);
    check(`not-english fires on ${name}`, ids(x).includes('not-english'));
    check(`  ${name}: unscored flag, floor overall, no credits, no gibberish`,
      x.unscored === true && x.overall === 0.2 && x.credits.length === 0 && !ids(x).includes('gibberish'),
      `unscored ${x.unscored}, overall ${x.overall}, credits ${x.credits.length}`);
    check(`  ${name}: advice is the not-english line`, x.advice.length === 1 && /English/.test(x.advice[0]));
  }
  check('not-english does not fire on English', !fires('not-english', 'I built a dashboard for the sales team last quarter and nobody opened it, which taught me more than the dashboard did.'));

  check('ADVICE has entries for all three', ['repetition', 'gibberish', 'not-english'].every(id => {
    const x = E.analyze(id === 'repetition' ? 'We ship on Friday. We ship on Friday. We ship on Friday. Nobody asked why.' : id === 'gibberish' ? lorem : spanish);
    return x.advice.some(a => typeof a === 'string' && a.length > 20);
  }));

  // negative: the whole corpus, with three named posts called out
  const named = ['netflix-90', 'exec-dashboard', 'jeans-petty'];
  for (const id of (HAS_CORPUS ? named : [])) {
    const t = corpus.find(p => p.id === id).text;
    check(`normal corpus post ${id} fires none of the hollow rules`,
      !fires('repetition', t) && !fires('gibberish', t) && !fires('not-english', t));
  }
  const offenders = corpus.filter(p => fires('repetition', p.text) || fires('gibberish', p.text) || fires('not-english', p.text)).map(p => p.id);
  check('no corpus post fires a hollow rule', offenders.length === 0, offenders.join(', '));
}

/* ------------------------------------------------------------------ */
section('6. roast text correctness');
{
  const list = '5 things I noticed after a year of running weekly dashboards for a sales team in Denver.\n\n1. Nobody reads the second tab.\n2. The filter defaults matter more than the charts.\n3. A date picker is a trap.';
  check('listicle roast never says "I learned" when the post does not', variants(list).every(t => !/I learned/.test(E.analyze(t).roasts.find(x => x.id === 'listicle')?.text || '')));
  check('listicle roast may say "I learned" when the post does', variants(list.replace('I noticed', 'I learned')).some(t => /I learned/.test(E.analyze(t).roasts.find(x => x.id === 'listicle')?.text || '')));

  const thoughts = 'Shipped the quarterly dashboard on time for once and the team actually opened it. Thoughts?';
  check('"Thoughts?." never renders', variants(thoughts).every(t => !/\?\."/.test(E.analyze(t).roasts.map(x => x.text).join(' '))));

  const oneTag = 'Shipped the quarterly dashboard on time for once and the team actually opened it. #analytics';
  const hv = ruleById('hashtags').test(ctxOf(oneTag)).vars;
  check('hashtags vars pluralise: 1 hashtag is 1 attempt', hv.hs === 'hashtag' && hv.isare === 'is' && hv.att === 'attempt');
  const twoTags = oneTag + ' #data';
  const hv2 = ruleById('hashtags').test(ctxOf(twoTags)).vars;
  check('hashtags vars pluralise: 2 hashtags are 2 attempts', hv2.hs === 'hashtags' && hv2.isare === 'are' && hv2.att === 'attempts');
  check('no rendered hashtag roast says "1 hashtags" or "hashtags is"', variants(oneTag).every(t => !/1 hashtags|hashtags is/.test(E.analyze(t).roasts.map(x => x.text).join(' '))));

  const real = 'We closed R$ 38 mil in the first month and R$ 120 mil by December, mostly from referrals.';
  const nf = ruleById('numeric-flex').test(ctxOf(real));
  check('"R$ 38 mil" is never captured as "$ 38 m"', !nf || (nf.vars.v !== '$ 38 m' && !/^\$ /.test(nf.vars.v)), nf ? nf.vars.v : 'no match');
  const tight = 'We closed R$38k in the first month, mostly from referrals.';
  const nf2 = ruleById('numeric-flex').test(ctxOf(tight));
  check('currency prefix kept intact: R$38k', nf2 && nf2.vars.v === 'R$38k', nf2 ? nf2.vars.v : 'no match');
  const nf3 = ruleById('numeric-flex').test(ctxOf('We hit $5 million ARR and $2M in bookings.'));
  check('"$5 million" captured exactly as written', nf3 && nf3.vars.v === '$5 million', nf3 ? nf3.vars.v : 'no match');

  const cmp = 'We grew from $12k MRR to $40k MRR in six months, up from a flat year before that.';
  check('"no denominator" roasts ineligible when a comparison marker is present',
    variants(cmp).every(t => !/denominator|without a baseline/.test(E.analyze(t).roasts.find(x => x.id === 'numeric-flex')?.text || '')));
  const noCmp = 'We hit $40k MRR and $2M in bookings this year.';
  check('"no denominator" roasts still eligible without a marker', variants(noCmp).some(t => /denominator|without a baseline/.test(E.analyze(t).roasts.find(x => x.id === 'numeric-flex')?.text || '')));

  const code = 'Every analyst has written this query at least once.\n\nSELECT user_id, COUNT(*) AS orders\nFROM orders\nWHERE created_at >= \'2024-01-01\'\nGROUP BY user_id\nHAVING COUNT(*) > 5;\n\nIt runs. It is also wrong, and it took me a week to see why.';
  const cr = E.analyze(code);
  check('code block suppresses allcaps, broetry and orphan-line', !ids(cr).some(id => ['allcaps', 'broetry', 'orphan-line'].includes(id)), ids(cr).join(','));
  const py = 'Two lines of Python replaced a 40-tab workbook.\n\ndef clean(df):\n    return df.dropna()\n\nThe workbook is still open on someone\'s desk.';
  check('Python block also detected as code', ctxOf(py).codeLines >= 2);
  check('a single English "if" line is not code', ctxOf('if you build it\nthey will not come\nfor a while').codeLines === 0);

  const sincere = 'Grateful to Marcus Alvarez for staying on the call until 11pm so the migration landed before the board meeting. It worked, and the dashboards were up by 6am.';
  check('gratitude aimed at a named person for a specific thing is not roasted', !ids(E.analyze(sincere)).includes('gratitude'), ids(E.analyze(sincere)).join(','));
  check('audience-aimed gratitude still fires', ids(E.analyze('So grateful for this opportunity and blessed to be part of such an incredible journey with this team.')).includes('gratitude'));
  check('"thankful for my network" is not read as sincere gratitude', ids(E.analyze('So grateful for this opportunity and thankful for my incredible network. Blessed.')).includes('gratitude'));

  const tc = E.analyze('Thank you to the team. Thanks again to everyone who showed up on Saturday.');
  check('thanks-count never says "0 people tagged"', !/\b0 people|reaches 0 inboxes/.test(tc.roasts.map(x => x.text).join(' ')));
}

/* ------------------------------------------------------------------ */
section('7. credits vs roasts');
{
  const NOASK = /No call to action|No ask at the end|Nothing is being requested/;
  const link = 'I wrote up the whole migration, including the part where we lost a week to a timezone bug. Link in comments.';
  check('"link in comments" gets no no-ask credit', !E.analyze(link).credits.some(c => NOASK.test(c)), E.analyze(link).credits.join(' | '));
  const call = 'If your dashboards are gathering dust, book a call and I will show you what we did with ours.';
  check('"book a call" gets no no-ask credit', !E.analyze(call).credits.some(c => NOASK.test(c)));
  const clean = 'I wrote up the whole migration, including the part where we lost a week to a timezone bug.';
  check('a post with no ask still gets the credit', E.analyze(clean).credits.some(c => NOASK.test(c)));

  const oneTag = E.analyze('Shipped the quarterly dashboard on time for once and the team actually opened it. #analytics');
  check('one hashtag is scored primarily as cringe', ids(oneTag).includes('hashtags') && oneTag.roasts.find(x => x.id === 'hashtags').dim === 'cring');
  check('one hashtag leaves the bait verdict in the no-ask band', cat(oneTag, 'bait').score < 2.5, `bait ${cat(oneTag, 'bait').score}: ${cat(oneTag, 'bait').verdict}`);
  const fiveTags = E.analyze('Shipped the quarterly dashboard on time for once and the team actually opened it. #analytics #data #sql #dashboards #leadership');
  check('five hashtags push cringe up more than bait', cat(fiveTags, 'cringe').score > cat(fiveTags, 'bait').score);
}

/* ------------------------------------------------------------------ */
{
  // "the pivot table" fired Career pivot vocabulary.
  check('"the pivot table" is a spreadsheet, not career-pivot jargon', !E.analyze('I have spent three weeks trying to understand the pivot table in the Q3 budget file at Vanguard.').roasts.some(r => r.id === 'pivot-lang'));
  check('  ...while "the pivot" as a career move still fires', E.analyze('Making the pivot into product management was the best decision. The pivot changed everything for me this year at Vanguard.').roasts.some(r => r.id === 'pivot-lang'));
}

{
  // Reader report: a comment citing a paper scored 1.1, and the heaviest
  // weight was Shouting, for the conference name in the citation.
  const CITED = 'In this n=6,720 SANER 2025 study, identical resumes were scored lower when the name was a woman\'s. The authors published the prompts, which is the part I keep coming back to.';
  check('an acronym inside a citation is not shouting', !ids(E.analyze(CITED)).includes('allcaps'), ids(E.analyze(CITED)).join(','));
  check('  ...and it still counts as a concrete reference', ctxOf(CITED).acronyms.includes('SANER'));
  for (const s of [
    'The ASHRAE standard says one thing and the building does another.',
    'We ran it against the NHANES dataset from 2019 and the effect vanished.',
    'Our paper is at https://example.org/x: the GENDER benchmark is the interesting half.'
  ]) check('  ...same for: ' + s.slice(0, 34), !ids(E.analyze(s)).includes('allcaps'), ids(E.analyze(s)).join(','));

  // The exemption must not become a way to shout near a citation.
  const shoutNearCite = 'I read the 2024 study last night and it was INSANE. Everyone in this industry should be ASHAMED of themselves.';
  check('a shouted word beside a citation still fires', ids(E.analyze(shoutNearCite)).includes('allcaps'));
  for (const s of [
    'This is FANTASTIC news and I am NEVER going back to the old way of working.',
    'LISTEN to me for one second. This matters more than whatever else is in your feed.',
    'PLEASE READ THIS before you write another word of your next performance review.',
    // A citation word shouted is still shouting: it must not excuse itself.
    'Join the WORKSHOP on Tuesday, it is the one thing that will change how your team plans.',
    'The RESEARCH is clear and the people ignoring it are the ones running your company.'
  ]) check('shouting still fires: ' + s.slice(0, 30), ids(E.analyze(s)).includes('allcaps'), ids(E.analyze(s)).join(','));
}

section('8. threshold cliffs');
{
  const a = E.analyze(withWc(44)), b = E.analyze(withWc(45));
  check('no-specifics: 44 vs 45 words differ by < 0.6', Math.abs(a.overall - b.overall) < 0.6, `${a.overall} vs ${b.overall}`);
  const c = E.analyze(withWc(60));
  check('no-specifics ramps in to full strength by 60 words', c.overall > b.overall, `${b.overall} -> ${c.overall}`);

  const s12 = E.analyze(withWc(12)), s14 = E.analyze(withWc(14)), s15 = E.analyze(withWc(15)), s16 = E.analyze(withWc(16));
  check('too-short-empty: 12 vs 14 words differ by < 0.6', Math.abs(s12.overall - s14.overall) < 0.6, `${s12.overall} vs ${s14.overall}`);
  check('too-short-empty: gone by 16 words', !fires('too-short-empty', withWc(16)));
  check('too-short-empty: 15 vs 16 words differ by < 0.6', Math.abs(s15.overall - s16.overall) < 0.6, `${s15.overall} vs ${s16.overall}`);
  check('too-short-empty: monotone ramp 12 >= 14 >= 15 >= 16', s12.overall >= s14.overall && s14.overall >= s15.overall && s15.overall >= s16.overall, [s12, s14, s15, s16].map(x => x.overall).join(' >= '));

  const bro = n => { const w = withWc(n).replace(/\.$/, '').split(' '); const lines = []; for (let i = 0; i < w.length; i += 4) lines.push(w.slice(i, i + 4).join(' ')); return lines.join('\n\n') + '.'; };
  const b29 = E.analyze(bro(29)), b31 = E.analyze(bro(31));
  check('broetry: 29 vs 31 words differ by < 0.6', Math.abs(b29.overall - b31.overall) < 0.6, `${b29.overall} vs ${b31.overall}`);
}

/* ------------------------------------------------------------------ */
section('9. tokenizer');
{
  const time = t => { E.analyze(t); let best = Infinity; for (let i = 0; i < 5; i++) { const s = performance.now(); E.analyze(t); best = Math.min(best, performance.now() - s); } return best; };
  const dots = time('.'.repeat(4000)), dashes = time('-'.repeat(4000));
  check('4,000 dots analyse in under 3 ms', dots < 3, dots.toFixed(2) + ' ms');
  check('4,000 dashes analyse in under 3 ms', dashes < 3, dashes.toFixed(2) + ' ms');
  check('word regex anchors on an alphanumeric', ctxOf('...hello --world 42').words.join('|') === 'hello|world|42', ctxOf('...hello --world 42').words.join('|'));
}

/* ------------------------------------------------------------------ */
section('10. one occurrence, one count');
{
  // Independent reimplementation of "distinct match offsets": every entry's
  // matches pooled, overlapping ones merged, the merged stretches counted.
  // Deliberately not the engine's code, so the two have to agree.
  const distinctOffsets = (text, list) => {
    const lower = E.normalizeText(text).toLowerCase();
    const ranges = [];
    for (const p of list) {
      const body = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp((/^\w/.test(p) ? '\\b' : '') + body + (/\w$/.test(p) ? '\\b' : ''), 'g');
      let m;
      while ((m = re.exec(lower)) !== null) {
        ranges.push([m.index, m.index + m[0].length]);
        if (!m[0].length) re.lastIndex++;
      }
    }
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let n = 0, end = -1;
    for (const [s, e] of ranges) {
      if (s >= end) { n++; end = e; } else if (e > end) end = e;
    }
    return n;
  };

  // The lists the counting rules actually pass the helpers, recorded off a
  // run over the whole corpus plus a few fixtures aimed at the rules the
  // corpus never trips.
  E.collectPhraseLists(true);
  for (const p of corpus) E.analyze(p.text);
  for (const t of ['Thrilled to announce I am joining Acme as a Director.',
                   'Drop a comment below and follow me for more, and tag someone who needs this.',
                   'Two years ago I hit rock bottom after eleven rejections. Today I run the team.',
                   'I am humbled and grateful and so thankful and truly humbled, blessed even.',
                   'Excited to announce an exciting new chapter as I join Acme this month.']) E.analyze(t);
  const lists = E.collectPhraseLists(false);
  check('phrase lists were recorded off the run', lists.length > 10, `${lists.length} lists`);

  // The general form of the double count: a list holding a phrase and a
  // substring of it must still score one occurrence as one.
  let nested = 0, doubled = [];
  for (const list of lists) {
    for (const long of list) {
      const inner = list.filter(s => s !== long && long.indexOf(s) >= 0);
      if (!inner.length) continue;
      nested++;
      const total = E.totalOf(E.anyPhrase(ctxOf(long + '.'), list));
      if (total !== 1) doubled.push(`${long} [${inner.join(', ')}] counted ${total}`);
    }
  }
  check('phrase lists hold nested entries (the shape that caused C2)', nested > 0, `${nested} nested pairs`);
  check('a nested entry never double counts its own container', doubled.length === 0, doubled.join(' | '));

  const ANNOUNCE = lists.find(l => l.indexOf('thrilled to announce') >= 0);
  check('the announce list is one of the recorded lists', !!ANNOUNCE);
  const nOf = (id, text) => (ruleById(id).test(ctxOf(text)) || {}).n;

  const thrilled = 'Thrilled to announce I am joining Acme as a Director.';
  const excited = 'Excited to announce I am joining Acme as a Director.';
  check('"Thrilled to announce" counts once, like "Excited to announce"',
    nOf('announce', thrilled) === 1 && nOf('announce', excited) === 1,
    `${nOf('announce', thrilled)} vs ${nOf('announce', excited)}`);
  check('both announce sentences score the same overall',
    E.analyze(thrilled).overall === E.analyze(excited).overall,
    `${E.analyze(thrilled).overall} vs ${E.analyze(excited).overall}`);
  check('"thrilled to" on its own is still caught', nOf('announce', 'Sarah is thrilled to join us at Acme and starts on Monday.') === 1);

  // finding n is the number of distinct match offsets, not the sum over
  // entries. Two corpus rows that used to report 2 off a single span.
  const fixed = [['f9ceac61953a', 'announce'], ['de2513324886', 'announce']];
  for (const [k, rule] of (HAS_CORPUS ? fixed : [])) {
    const text = byKey(k).text;
    check(`corpus row ${k}: announce n equals the distinct match offsets`,
      nOf(rule, text) === distinctOffsets(text, ANNOUNCE),
      `n ${nOf(rule, text)}, offsets ${distinctOffsets(text, ANNOUNCE)}`);
  }
  if (HAS_CORPUS) check('corpus row f9ceac61953a: one span, one count', nOf('announce', byKey('f9ceac61953a').text) === 1);
  check('announce n on the fixture equals its distinct match offsets',
    nOf('announce', thrilled) === distinctOffsets(thrilled, ANNOUNCE));

  check('every rule id has an ADVICE entry',
    E.RULES.every(r => typeof E.ADVICE[r.id] === 'string' && E.ADVICE[r.id].length > 20),
    E.RULES.filter(r => typeof E.ADVICE[r.id] !== 'string').map(r => r.id).join(', ') || 'all 47 present');
  check('every ADVICE key is a rule id or the synthetic unicode-bold',
    Object.keys(E.ADVICE).every(k => k === 'unicode-bold' || E.RULES.some(r => r.id === k)),
    Object.keys(E.ADVICE).filter(k => k !== 'unicode-bold' && !E.RULES.some(r => r.id === k)).join(', ') || 'none spare');

  // The two rules that had no advice: the suggestions list used to come up
  // short without saying so.
  for (const id of ['officially', 'plug-signoff']) {
    check(`ADVICE has an entry for ${id}`, typeof E.ADVICE[id] === 'string' && E.ADVICE[id].length > 20);
  }

  const NO_POP = /most posts|statistically|rarest|average post|median|percentile/i;
  const popClaims = corpus.map(p => E.analyze(p.text)).flatMap(r => r.credits).filter(c => NO_POP.test(c));
  check('no credit asserts a population statistic the tool does not have', popClaims.length === 0, popClaims.slice(0, 2).join(' | '));
}

section('11. one emoji is not a finding');
{
  // The check's own advice allows one emoji, so one must not fire it. The
  // guard post is the owner's: a clean 132-word post whose only emoji is a
  // pirate flag in a name slot in the sign-off, which used to be told the
  // flag was doing a verb's job.
  const guard = corpus.find(p => p.id === 'bill-fatherhood-bathroom') || { text: GUARD_POST };
  if (HAS_CORPUS) check('the regression guard is in the corpus and matches the inlined copy', guard.text === GUARD_POST);
  const r = E.analyze(guard.text);
  check('an emoji in the author\'s own sign-off name is not counted at all', r.stats.emoji === 0 && r.nameEmoji.length === 1 && r.stats.rulesFired === 0, 'emoji=' + r.stats.emoji + ' fired=' + r.stats.rulesFired + ' overall=' + r.overall);
  // The whole cost of one emoji is the forfeited pos-clean credit (cring -1.0,
  // bait -0.6), which is worth 0.2 on a post this clean. No penalty on top.
  const bare = E.analyze(guard.text.replace('\u{1F3F4}\u200D\u2620\uFE0F ', ''));
  const gap = Math.round((r.overall - bare.overall) * 10) / 10;
  check('  ...and scores exactly what the same post scores with the emoji removed', gap === 0 && r.band.key === bare.band.key, 'with=' + r.overall + ' without=' + bare.overall);
  check('  ...and keeps the no-emoji credit, because a name is not decoration', r.credits.some(c => /no emoji|zero decoration|visual scaffolding/i.test(c)), r.credits.join(' | '));
  const body = 'We shipped the quarterly report on Tuesday and the finance team signed off by noon.';
  check('exactly one emoji does not fire emoji-volume', !fires('emoji-volume', body + ' \u{1F389}'));
  check('two emoji still fire it', fires('emoji-volume', body + ' \u{1F389} Onwards. \u{1F680}'));
  // Never penalise an emoji that is part of a name, wherever the name sits.
  const clean = E.analyze(body).overall;
  const NAMES = {
    'I am [flag] Name': body + "\n\n--\nI'm \u{1F3F4}\u200D\u2620\uFE0F Bill and the flag is clickable",
    'no space after the emoji': body + "\n\n-- I'm \u{1F3F4}\u200D\u2620\uFE0FBill and this took three flushes",
    'First [emoji] Last': body + ' Thanks to Sarah \u{1F33B} Johnson for the help.',
    'sign-off: dash, emoji, Name': body + '\n\n-- \u{1F3F4}\u200D\u2620\uFE0F Bill',
    'sign-off: dash, Name, emoji': body + '\n\n-- Bill \u{1F3F4}\u200D\u2620\uFE0F'
  };
  for (const [name, text] of Object.entries(NAMES)) {
    const x = E.analyze(text);
    check('name emoji, ' + name + ': not counted, nothing fired, no credit lost', x.stats.emoji === 0 && x.nameEmoji.length === 1 && !ids(x).includes('emoji-volume') && x.credits.some(c => /no emoji|zero decoration|visual scaffolding/i.test(c)), 'emoji=' + x.stats.emoji + ' overall=' + x.overall + ' clean=' + clean);
  }
  check('a line-opening decoration is still the author\'s emoji', E.analyze('\u{1F680} Big News for the team today. ' + body).stats.emoji === 1);
  check('a name emoji does not shelter real decoration beside it', E.analyze(body + ' So proud \u{1F389} of this \u{1F64C}\n\n-- I\'m \u{1F3F4}\u200D\u2620\uFE0F Bill').stats.emoji === 2);
  check('the advice and the floor agree', /at most one/.test(E.ADVICE['emoji-volume']));
}

section('12. promises the engine makes about its own output');
{
  // The emoji skip list. It was declared twice and applied never, so a
  // trademark sign was scored as emoji abuse.
  const skip = ['\u00a9', '\u00ae', '\u3030', '\u2b1b', '\u2b1c'];
  const body = 'We rebuilt the onboarding flow at Acme and the drop-off fell by six points over four weeks.';
  for (const ch of skip) {
    check('skip-list character U+' + ch.codePointAt(0).toString(16) + ' is not counted as an emoji', E.analyze(body + ' ' + ch + ' ' + ch).stats.emoji === 0);
  }
  check('a progress bar of squares is not emoji abuse', !ids(E.analyze('Progress on the migration:\n\u2b1b\u2b1b\u2b1c\u2b1c\n60% done. Two services left and the team is on track.')).includes('emoji-volume'));
  const src = readFileSync(new URL('./src/engine.js', import.meta.url), 'utf8');
  const decls = [...src.matchAll(/^\s*var ([A-Z][A-Z0-9_]{2,}) =/gm)].map(m => m[1]);
  const dupes = decls.filter((d, i) => decls.indexOf(d) !== i);
  check('no upper-case constant is declared twice in src/engine.js', dupes.length === 0, dupes.join(', '));

  // "A span is included only when it is a literal match": enforced, across the corpus.
  let notLiteral = [];
  let bandMismatch = [];
  for (const p of corpus) {
    const r = E.analyze(p.text);
    for (const sp of (r.spans || [])) for (const m of sp.matches) {
      if (E.normalizeText(p.text).toLowerCase().indexOf(String(m).toLowerCase()) < 0) notLiteral.push(p.id + ':' + sp.id);
    }
    if (r.band && r.band.key !== E.bandFor(r.overall).key) bandMismatch.push(p.id);
  }
  check('every span the engine emits is literally in the post, on every corpus row', notLiteral.length === 0, notLiteral.slice(0, 3).join(', '));
  check('the band word always matches the rounded score the reader sees', bandMismatch.length === 0, bandMismatch.join(', '));
  const clean = corpus.map(p => E.analyze(p.text)).filter(r => r.stats && r.stats.rulesFired === 0);
  const rate = /once per hundred|almost never|one in a hundred/i;
  check('no clean-post line invents a rate', clean.every(r => !rate.test(r.oneLiner + ' ' + (r.advice || []).join(' ') + ' ' + r.brutal)));
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('FAILED:', failed.map(f => f.name).join(', ')); process.exit(1); }
