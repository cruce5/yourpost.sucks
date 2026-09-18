import E from './src/engine.mjs';
const { analyze } = E;

const CASES = {
  'SPEC EXAMPLE (job announcement)':
`Excited to announce I'm joining TechCorp as Senior Analytics Manager! Grateful for this opportunity and can't wait to make an impact. Thanks to everyone who believed in me 🙌🙌`,

  'CLEAN DEADPAN (Bill-style)':
`Nothing humbles a person faster than opening a SQL query you wrote six months ago.

I had a CTE in there named "final_final_v2". It was not final.`,

  'MAXIMUM CARNAGE':
`🚀🚀 BIG NEWS 🚀🚀

I'm beyond excited to announce that I am officially starting a new chapter! 🙌🙌🙌

Two years ago I was rejected from 47 companies.

Let that sink in.

47.

Today I'm humbled and grateful to share that I've been named to the Top 40 Under 40 list. 🏆

Here's the thing: it's not just a list, it's a testament to never giving up.

✅ Stay hungry
✅ Leverage your network
✅ Delve into your why

I couldn't have done it without everyone who believed in me. Special thanks to @Sarah @Mike @Jennifer @David @Priya for taking a chance on me.

Can't wait to make an impact and drive real value at scale 💯

Agree? Comment YES below 👇 and follow me for more!

#leadership #growth #mindset #hustle #grateful`,

  'CORPORATE BUZZWORD SOUP':
`In today's fast-paced digital landscape, organizations must leverage data-driven insights to unlock transformative value across the ecosystem.

Our cross-functional team has been aligning on a robust, best-in-class framework that operationalizes actionable insights at scale — a true game-changer for stakeholders moving forward.

At the end of the day, it's not just about the technology, it's about the people.

Thoughts?`,

  'PERFORMATIVE VULNERABILITY':
`I almost didn't post this.

Real talk: last year I was laid off. It was the lowest point of my career.

But looking back, it was a blessing in disguise. I learned so much about myself.

Now I'm excited for what's next.

If you're going through it right now — DM me. I'll go first.`,

  'GENUINELY GOOD POST':
`We ran an A/B test on the onboarding flow at Netflix for six weeks. 41,000 users. The variant we were sure about lost by 3 points.

I was wrong about which one would win. I have been wrong about this four times now.

The tests keep working anyway.`,

  'SHORT AND EMPTY':
`Big things coming. Stay tuned.`,

  'EMPTY':
``
};

for (const [name, post] of Object.entries(CASES)) {
  const r = analyze(post);
  console.log('\n' + '='.repeat(72));
  console.log(name);
  console.log('='.repeat(72));
  if (r.empty) { console.log('(empty)'); continue; }
  console.log(`SUCKS: ${r.overall}/10  — ${r.oneLiner}`);
  console.log('');
  for (const c of r.categories) {
    const arrow = c.polarity === 'higher-better' ? '↑better' : '↑worse ';
    console.log(`  ${c.label.padEnd(22)} ${String(c.score).padStart(4)}/10 ${arrow}  ${c.verdict}`);
  }
  console.log('\n  ROASTS (' + r.stats.rulesFired + ' rules fired):');
  r.roasts.forEach(x => console.log('   • [' + x.id + '] ' + x.text));
  if (r.credits.length) {
    console.log('\n  CREDITS:');
    r.credits.forEach(x => console.log('   + ' + x));
  }
  console.log('\n  BRUTAL: ' + r.brutal);
  console.log('\n  ADVICE:');
  r.advice.forEach(a => console.log('   → ' + a));
  console.log('\n  stats:', JSON.stringify(r.stats));
}
