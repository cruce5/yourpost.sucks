# yourpost.sucks

Paste a LinkedIn post, receive an unsympathetic report.

Rule engine + optional Claude-written prose, on Cloudflare Workers. Designed so
that running out of money makes the site *less funny*, never broken.

---

## The one design rule

**The model never produces the score.**

The rules engine computes every number, client-side and server-side, from the
same source file. Claude only writes prose. Three things follow:

1. **Prompt injection cannot move a score.** The number never passes through the
   model. The worst an injected post achieves is weird roast text, which the
   output validator then rejects anyway. (In testing, an injected post scored
   *higher* (9.0 vs 8.8) because the injection text is itself bad writing.)
2. **The site degrades instead of failing.** No key, spent budget, rate limit,
   timeout, 500, malformed reply: every one of these falls through to the same
   rules-written report. The user sees a provenance badge, not an error.
3. **It works with the API switched off entirely.** `yourpost-sucks.html` is the
   whole product in one file, openable from disk.

### The tone gate: an LLM classifier, not an LLM judge

Rules cannot tell sincere cliché from self-aware parody. Negation is
grammar and a regex can find it, but irony is meaning and a regex cannot.
Rather than approximate that with more pattern-matching, `flags.satire` in
`engine.js` lets an externally-supplied boolean suppress a fixed, small set
of literal cliché-phrase rules (`announce`, `cantwait`, `newchapter`,
`bignews`, `humbled`, `honored`, `sink-in`), the same containment
`sincereCheck()` already uses for warmth. In the worker, that boolean comes
from one narrow, cheap Claude call (`callToneCheck` in `worker.js`) that
answers a single yes/no question and is only asked when a post already
tripped a tone-suppressible rule. Most posts never make this call. A "yes"
can only turn rules off, never on; it never sets a score or writes roast
text directly, so an injection attempt embedded in a post can, at worst,
switch off a few cliché rules. Every structural rule (specificity, bait,
length, ...) still runs at full strength regardless, and the design rule
above still holds: the model still never produces the score. If the tone
call fails, times out, or comes back anything less than a confident "yes,"
the post is scored exactly as if the call had never been made.

---

## Deploy

```bash
npm install -g wrangler
wrangler login

npx wrangler kv namespace create YPS        # paste the id into wrangler.toml
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TURNSTILE_SECRET    # optional

npm test        # five suites: engine, engine rules, worker (incl. the tone gate), node/browser parity, browser client
npm run deploy
```

**Running the tests on Windows.** The `test` script uses POSIX shell syntax. Point
npm at Git Bash for this project only with a local `.npmrc` containing
`script-shell=C:\\Program Files\\Git\\bin\\bash.exe` (the file is gitignored).

Then point `yourpost.sucks` at the Worker in the Cloudflare dashboard.

Without `ANTHROPIC_API_KEY` it deploys fine and runs rules-only. That is a
legitimate way to ship it and see if anyone cares before spending anything.

---

## Deploy to a Porkbun domain

Workers custom domains require the zone to be **on Cloudflare DNS**. There is no
way to point Porkbun's nameservers at a Worker directly, so the domain moves to
Cloudflare's free plan. Porkbun stays your registrar; you are only changing who
answers DNS.

### 1. Turn DNSSEC OFF at Porkbun first

**Do this before anything else.** Cloudflare's docs are blunt about it: *"If your
domain has DNSSEC active, you must turn it off at your registrar before replacing
nameservers"*. Changing nameservers with DNSSEC live *"can cause your domain to
become unreachable."* Porkbun enables DNSSEC on many domains by default, and this
is the single most common way this migration breaks.

Porkbun → **ACCOUNT → Domain Management** → your domain → **Details** → disable
DNSSEC. Wait for it to clear before step 3.

### 2. Add the domain to Cloudflare

Cloudflare dashboard → **Domains → Onboard a domain** → enter `yourpost.sucks` →
Free plan. It will scan for existing records; there will be nothing to keep.
Copy the two assigned nameservers from the Overview page.

### 3. Point Porkbun at Cloudflare

Porkbun → **ACCOUNT → Domain Management** → your domain → **Details** →
edit the **Nameservers** field → remove every existing entry, add Cloudflare's
two, one per line → **Save Nameservers**.

Usually live within a few hours; allow up to 48. Wait until the zone reads
**Active** in Cloudflare before the next step.

### 4. Attach the Worker

```bash
npm run deploy
```

Then Cloudflare dashboard → **Workers & Pages** → `yourpost-sucks` →
**Settings → Domains & Routes → Add → Custom Domain** → `yourpost.sucks`.

Add `www.yourpost.sucks` as a second custom domain if you want it. Cloudflare
creates the DNS records and issues the certificate itself. Do not add an A or
CNAME record by hand. A custom domain **cannot** be attached to a hostname that
already has a CNAME record, so if you created one while poking around, delete it
first.

### 5. Re-enable DNSSEC

Once the zone is Active: Cloudflare → **DNS → Settings → DNSSEC → Enable**, then
add the DS record it gives you back at Porkbun.

### Gotchas

- **Apex works.** `yourpost.sucks` with no subdomain is fine on a custom domain.
- **Nothing to migrate.** No existing email or hosting on this domain, so there
  are no MX records to preserve. If you ever add email, add those records in
  Cloudflare, not Porkbun.
- **Renewals stay at Porkbun.** Moving DNS is not a registrar transfer.

---

## The money

Haiku 4.5 is **$1/MTok in, $5/MTok out**. The budget breaker reserves a true
worst case before every call, then refunds the difference once the API reports
what the call really used. For the main analysis that reserve is **$0.0146**:
the 1,200-token output cap ($0.006), the system prompt and tool schema billed
as a cache write ($0.0061; it is large, since it carries the voice guide, the
scoring scale, the craft reference and the harsher-register note), and the longest user message a 4,000-character post can
produce ($0.0018), rounded up with a little headroom. Inside the
5-minute cache window the system prompt is billed as a cache read instead and
a call settles well under the reserve. The reserve has to hold for the first
call in every window, so that is the number the breaker uses.

A minority of posts (the ones that already tripped a cliché-announcement rule,
see "The tone gate" above) pay for a second, much smaller call: a single
yes/no classification, capped at 200 output tokens, reserved at **$0.0026**
because the whole post still goes in. An attached image reserves another
**$0.004**. The arithmetic for every reserve is written into the comment on
its constant in `src/worker.js`, and `worker.test.mjs` fails if a reserve
drops below what its own call can bill.

| Daily cap | Model-written analyses/day, worst case (every one pays for the main call and the tone call) | Same, with an image on every one |
|---|---|---|
| $1 | ~60 | ~48 |
| $5 (the fallback if unset) | ~300 | ~240 |
| $10 | ~600 | ~485 |
| $25 | ~1,500 | ~1,210 |
| $30 (shipped in `wrangler.toml` for the launch) | ~1,800 | ~1,455 |

These are floors, not forecasts. Every settled call refunds what it did not
use, so a real day runs well past them.

> **Corrections to earlier estimates.** The first estimate was $0.001 to $0.002
> per analysis; the second was $0.003 before suggested changes existed; the
> third was $0.005 before the tone gate added a second, optional call; the
> fourth was $0.0052 to $0.0061, which was a typical-case figure sitting under
> a header that said worst case, while the reserves in the code sat below
> their own output caps (the tone reserve of $0.0009 was less than its 200
> output tokens cost on their own, so the daily cap could be overrun by about
> 2x). The reserves above are derived from the caps and the measured prompts.
> What a typical call settles at is lower, and this document no longer
> guesses it.

Everyone gets **unlimited rules-based** analyses regardless of budget. The cap
only gates the expensive path.

### The five layers, cheapest first

| Layer | Where | What it does |
|---|---|---|
| Bail-out | engine, pre-network | Sensitive posts are declined. Zero cost. |
| Cache | KV, 30d, keyed on post hash | On a viral day everyone pastes the same famous posts. Free after the first. |
| Turnstile | edge | Kills bots. Skipped if the secret is unset. |
| Per-IP limit | Durable Object (KV fallback), hourly | Fairness. `RATE_LIMIT_PER_HOUR`, 30 in `wrangler.toml` for the launch, 12 if unset. |
| **Daily budget** | Durable Object (KV fallback), per UTC day | **The actual ceiling.** `DAILY_BUDGET_USD`, 30 in `wrangler.toml` for the launch, 5 if unset. |

The budget is charged *before* the call, so a crash mid-flight cannot
double-spend. Check it any time: `GET /api/status`.

**The ticker.** The footer says how many times the AI has been called in to
make a post suck less since the site launched, after the counter a certain
kind of website has always had. It is a real count of calls to the model that
were actually billed: reports, tone checks, rewrites and their retries. A
cached or rules-only report called nothing and counts nothing; a call that
failed before the provider billed it is not counted either. Every call already
passes through `settleCharge()` with a meter that knows whether it was billed,
so that is the one place it is counted, and it needs no abuse guard of its own:
a model call is already behind the rate limit, Turnstile and the daily budget.

Calls and not posts, deliberately: Cloudflare has recorded every request this
Worker made to `api.anthropic.com` since launch, so the part of the number
from before the counter existed can be read off a dashboard instead of
guessed. That figure is `TICKER_BASELINE` in `wrangler.toml` (3000, which is
Cloudflare's own rounding; the comment there says how to make it exact). The
total comes back in `GET /api/status` as `aiCalls`, and the page shows no line
at all when there is no number.

**Which coffee link earns its keep.** There are three: a line under an
AI-written report, the card that appears at the 5th AI report, and the one in
the footer. `POST /api/tip` takes exactly one field, the name of the place
that was clicked, and adds one to two counters in the same Durable Object (a
lifetime total per place, and a per-UTC-day total kept 40 days). No
identifier, no post text, no referrer, no third-party script; the beacon is
same-origin and fire-and-forget, so a blocked or failed send can never keep a
reader's link from opening. Counted clicks are capped at 10 per IP per hour,
which only blunts someone curling the endpoint in a loop. The totals come
back in `GET /api/status` as `tipClicks`.

**A rewrite has to still sound like the writer.** Reader report, in public:
"the proposed rewrite did little more than change the flow while scraping away
my voice". So every rewrite is measured against the post it came from: the
share of the writer's distinctive words that survived (`keptRatio` in
`src/worker.js`). Under 45%, on a post the checks mostly liked (fewer than 5
findings), the model is asked once more for a closer edit, and the closer of
the two valid attempts is the one shown. Both attempts are kept, so the floor
can never cost a visitor a rewrite they would otherwise have had. A post that
tripped everything is exempt: there the writer asked for a rescue, not a trim.

**"Be meaner about it."** A checkbox, off by default, remembered per browser.
It sends one extra system block that turns up the register and nothing else:
same checks, same findings, same score, same validators, and the same hard
rule that nothing about the person, their job or their life is ever a target.
It is part of the cache key, so a gentle report is never replayed to someone
who asked for the harsh one.

**A link is not a post.** Pasting the URL of a post used to score the URL, which
is how at least one reader got a number about nothing (2.7 for the link, 0.7
for the text). Text that is a web address with under 12 other words is refused
in the page, before any call, with a line saying what to paste instead. A post
that merely contains a link is analysed exactly as before.

**The budget counter and the per-IP rate limiter live in a Durable Object** (the `Counters` class in `src/worker.js`, bound as `COUNTERS`). A Durable Object handles one request at a time, so "is there room, and if so charge it" is a single atomic step: a burst of simultaneous requests cannot all read the same stale count and all get through. If the binding is missing (a KV-only dev setup) the Worker falls back to KV counters, which are eventually consistent and can leak calls under a burst; do not run production that way. Either way, put a hard spend limit on the API key in the Anthropic Console as well. That cap holds even if this code is wrong.

**The reword is a separate, explicitly opt-in third call**, priced and charged
independently (reserved at **$0.0162** worst case, a larger output cap than the
main call since it returns a full rewritten post rather than a diff list, and
up to **$0.0324** for one click when the single retry fires, since each
attempt is charged). It shares the same
budget counter and per-IP limiter as everything else, but it is never
triggered automatically. A visitor has to click for it, and it skips the
model entirely (charging nothing) when the post already has zero rules fired.
Unlike the main analysis, there is no rules-only fallback for it: generating
replacement prose is exactly the thing rules cannot do, so when the budget is
spent or the model is unavailable, the reword says so plainly instead of
faking a result.

---

## Validation against a labelled corpus

> **The corpus is not in this repository.** `corpus.json` is real LinkedIn posts
> by real people, with their engagement numbers, so it stays private, along with
> `corpus-results.txt`, `corpus-scores.json` and `VALIDATION_REPORT.md`, which
> discuss those posts by name. The figures below come from the private corpus.
> Without it, `npm test` skips the corpus-backed checks and says so, and
> `node corpus.test.mjs` explains itself and exits. Bring your own `corpus.json`
> (rows of `{id, eng, label, round, text}`) to run the harness on your own posts.

`corpus.json` holds 104 posts, collected in three rounds (26 from one
creator, then 30 and 47 from many authors) plus one owner-supplied regression
guard. 99 carry a real engagement number (4,967 down to 1); the other five are
two external-earnest rows, two unlabelled rows and the guard.
`corpus.test.mjs` scores them all, prints rank statistics with their
intervals, and exits non-zero if the signal disappears. Run it with
`node corpus.test.mjs`. **This is the only honest measure of whether the tool
works, and it should be re-run after any rule change.**

### The current run (2026-09-18, 47 rules)

| | |
|---|---|
| Spearman rho, midranks, suckiness rank vs engagement rank (n=98) | **0.217**, 95% CI 0.02 to 0.40 |
| Same, with the ten highest-engagement posts removed (n=88) | 0.072 |
| AUC: the chance a flop outscores a hit (44 hits, 22 flops) | **0.666**, permutation p = 0.013, one-sided |
| Separation, mean flop score minus mean hit score | +0.45, permutation p = 0.052, one-sided |
| Held out, every round after round 1: AUC (26 hits, 15 flops) | 0.619, permutation p = 0.10, one-sided |
| Held out: rho (n=73) | 0.113, 95% CI -0.12 to 0.34 |
| Separation, medians | +0.80 |

Read it plainly: on the whole corpus the tool ranks flops above hits more
often than chance, and weakly. Round 1 is the single author the omission
rules were first tuned against (AUC 0.76), so it is training data. On the
posts from everyone else it cannot be told from chance (AUC 0.62, p = 0.10,
26 hits and 15 flops; rho 0.11 with an interval through zero). Every figure
here is in-sample to some degree, because each rule change in
`VALIDATION_REPORT.md` was found against a row in this corpus. Two thirds of
the rows behind rho were also selected for extreme engagement: rho is 0.37 on
those 66 and -0.20 on the 32 that were not. Round 3's flop arm is four posts
and carries no read on its own. Labels in rounds 1 and 2 are relative to the author's normal
range; round 3 uses an absolute rule (150 or more reactions is a hit, 8 or
fewer is a flop). Every row records its `round`, and the harness prints each
statistic per round as well as pooled. The round-by-round history is in
`VALIDATION_REPORT.md`.

### What the first run found (history: 25 scored posts, one author)

These numbers describe the original one-author smoke test and an engine many
versions old. They are kept as history, not as the tool's validation.

| | before | after |
|---|---|---|
| Spearman rho (suckiness rank vs engagement rank) | 0.044 | **0.432** |
| Separation (mean flop score − mean hit score) | −0.10 | **+0.47** |

**rho = 0.044 was not a weak signal. It was a hash function.** A "nothing is
perfect" flourish spread low scores using `seed % 88`, where `seed` is the FNV
hash of the post text. Every clean post fell through that branch, so 20 of 25
corpus scores were pseudorandom. Deleting it dropped the measured separation to
**−0.37**. The tool was ranking flops *better* than hits, and the noise had
been hiding it. It looked worse before it looked better; that was the point.

### The structural finding

Every original rule detects a sin of **commission**: emoji, bait, cliché,
buzzwords. The corpus flops commit none of them. "Dashboard Confessionals is
back tomorrow and we'd love for you to join" is clean English and a bad post.
30 of the 39 original rules could never fire on a competent writer.

What separates a 4,967 from a 40 is a sin of **omission**: no hook, no
specific, no payoff, no reason for a stranger to care. Five rules now cover the
deterministic part of that: `promo-lede`, `hedging`, `question-opener`,
`fragment`, `plug-signoff`. The LLM's suggested changes cover the rest.

### Known limits: do not overstate this tool

- **n=98 scored, many authors, one of them dominant.** The 95% CI on rho is
  roughly ±0.19 and its lower bound sits at 0.02. Remove the original author's
  ten biggest posts and rho falls to 0.07. This is still closer to a smoke test
  than a validation study.
- **The corpus cannot validate the original rules at all.** This author never
  writes "humbled," never stacks hashtags, never uses emoji bullets. A predictor
  with zero variance cannot correlate with anything. The corpus *bounds* the
  tool's applicability; it does not prove the convention rules are empty.
- **The score does not predict reach.** It never did. The tool measures
  convention density and craft omissions in the text. That is a different thing
  from performance, and the invented `percentile` statistic that implied
  otherwise has been removed.
- **Image posts cannot be judged.** Two of the corpus's high performers are
  captions where the image carries the joke ("Wait, what?" at 898). From text
  alone these are indistinguishable from genuinely empty captions.
- **Risk of overfitting.** `promo-lede` and `plug-signoff` were tuned against
  seven flops from one author. They encode real and general patterns, but they
  have not been tested anywhere else. Round 4 exists to test exactly these
  two on new authors, with the labels and the rules frozen before scoring:
  see `round4/README.md` and `node round4.mjs`.

---

## Suggested changes (the useful half)

A second, separate axis from the score. The rule engine says what is wrong with
the *conventions*; the model says what is wrong with the *craft* and gives you
the edit.

The prompt is compiled from `post-craft-rules.md` at build time, so the
human-readable doc and the prompt can never drift. That document is 12 craft
principles, 12 diagnostic questions, 13 edit types and 12 anti-guidance rules,
derived from the labelled corpus and then **stripped of the source author**:
no persona, no employer, no recurring bits, no subject matter, and crucially no
instruction to be funny. Register belongs to the writer; craft is the tool's.

Guardrails in the prompt and the validator:
- Rewrites may only use facts already in the post. Where a specific is missing
  it must be requested as a `[bracketed slot]`, never invented.
- The writer's register is preserved. An earnest post gets earnest rewrites.
- Few excellent changes beat many mediocre ones; an already-good post returns
  none, and the UI says so rather than manufacturing work.

---

## Copy variety

Most of the roast/credit copy already ran through `pick(arr, seed, salt)`:
same post, same phrasing every time; a different post, a different variant
from the pool, so the same rule never reads like a template. Three spots
had fallen through that pattern and repeated verbatim regardless of the post:
the four-band `oneLiner` summary, the report `headline`, and all five
`POSITIVES` credit notes. All three now draw from `pick()`-backed pools sized
to the post's seed. Separately, `headline` turned out to be computed and
never rendered anywhere in the client. Every report showed the same fixed
"This post sucks" kicker regardless of what the engine picked. It is now
wired into the hero and the plain-text report, so the four headline variants
are actually visible.

---

## Explainability: the breakdown and the annotated post

Two additions on top of the same design rule: nothing here is written by the
model, and nothing asserts a match the post does not literally contain.

**What's driving the score.** `analyze()` already computed a weighted
contribution per category (`(10-auth)*0.26`, `(10-clar)*0.20`, `cring*0.20`,
`bait*0.17`, `brag*0.17`) to build `overall`. It just never left the
function. It now comes back on the report as `categories[].contribution`,
alongside a `volumeBonus` for the small tax/credit applied when a post trips
an unusual number of rules at once. The five contributions plus the bonus sum
to `overall` exactly; the UI renders them as a sorted bar list so the number
at the top stops being an assertion and starts being arithmetic anyone can
re-add.

**The annotated post.** Every rule that fires already captures the literal
substring that tripped it (a phrase from the corpus of phrase lists, a
regex capture, or a raw match recovered from the original text via `locate()`,
which looks it up case-insensitively and returns it in its original casing).
Those substrings are now collected into `spans`, deduplicated, and returned
alongside `roasts`. The client resolves each span back to a character range
in the pasted text, sorts and drops overlaps, and wraps the surviving ranges
in `<mark>` tags color-coded by category, with a legend. A rule that fires but
matched no specific span (whole-post checks like sentence length or emoji
count) contributes to the score and the roast list as before; it just has
nothing to underline.

Both features are additive fields on the existing report shape. Nothing
about the LLM prose path changes: `worker.js`'s response merge overrides the prose fields only
(`oneLiner`, `roasts`, `brutal`, `advice`, `changes`, `headline`, `credits`
and the three aside notes, see "Sprinkle AI" below). `categories`,
`contribution`, `volumeBonus`, and `spans` pass through untouched in rules mode
and LLM mode alike, always computed by the engine.

**The five category colors are validated, not eyeballed, and color is never
the only channel.** A user flagged a real problem in the first shipped
version: the Inauthenticity (blue) and Vagueness (teal) underlines, then still labelled
Authenticity and Clarity, were close
enough to misread on a phone screen. Run through a proper categorical-palette
validator (OKLab ΔE under simulated color-vision deficiency, plus a
normal-vision floor), five mutually-distinguishable colors turn out to not be
achievable at all from this palette's dark-mode steps once every pair can sit
next to every other pair in running text. An exhaustive search over all 56
five-of-eight combinations found zero that clear the strict gate; the best
achievable leaves one pair (Vagueness↔Bait) short of the target. Rather than
pretend the numbers work, color is backed by underline **style** as a second,
color-independent channel (solid / dashed / dotted / double / wavy), so no two categories rely on hue alone, in both the annotated post
and its legend. Chosen colors also reuse the site's existing "good" blue and
"bad" red (`COOL`/`WARM`, already used for the overall score) for
Inauthenticity and Cringe Factor specifically, so the annotation legend and the score
color both use the same vocabulary rather than two unrelated palettes.

---

## The reword: model-written, rules-verified

Everything above is prose *about* the post. This is the one feature that
writes a *replacement* for it, and it is the one place in the product where
generating something genuinely needs the model. Rules can detect a cliché;
they cannot produce the sentence that isn't one. So this is a deliberate,
narrow exception to "the rules do the work," made without breaking "the model
never produces the score":

**The model writes the rewrite. It never gets to say whether the rewrite
worked.** `POST /api/reword` sends the post plus the rule engine's findings to
a Claude call scoped to one job, return a full rewritten post, under the
same guardrails as suggested changes: facts only from the original post
(missing specifics become a `[bracketed slot]`, never an invention), the
writer's own register preserved exactly, no reach predictions, no score
claims, injected instructions inside `<post>` ignored. Whatever comes back is
then run through the *exact same* `ENGINE.analyze()` that scored the
original. The response ships both numbers, `before` and `after`, computed
the same way, by the same code, every time. A rewrite that does not come out strictly ahead is a
failed attempt: the model gets one retry with the list of what fired on it,
and if that fails too the visitor is told plainly that neither rewrite beat
their post. Nobody is shown a worse version of their own writing with a tag
under it explaining that it is worse. A model summary claiming "dramatically improved"
cannot make the number move; only different text can, and only in the
direction the deterministic rules independently agree with. `worker.test.mjs`
has a case that proves exactly this: a mocked model returns the *original
text verbatim* with a summary calling it "dramatically improved," and the
engine scores it identical to `before`, so it is rejected and never shown. The
claim is simply ignored.

**Never invent a fact: enforced twice, not just asked for once.** The system
prompt is explicit and specific about this (not just "use only facts already
in the post," but a named list: no invented numbers, names, companies, times,
causes, sequences of events, or other people's actions or dialogue) and warns
the model directly against a real failure mode: the craft reference's own
before/after examples are written in vivid, specific-sounding language to
illustrate *structure*, and a model can be tempted to imitate that surface
texture for a post that doesn't actually contain it. Prompting alone is not
enough to trust, so `validateReword()` backs it with one mechanical check on
both the rewrite and its summary: it extracts every number from each, in
digit form ("6") or spelled out ("six"), and compares against the same from
the original post, folding both forms to the same value so a fact merely
reformatted (post says "10", rewrite says "ten") is never flagged. Anything
introduced that wasn't already there in either form gets the whole rewrite
rejected outright. This can't catch every kind of fabrication (an invented
name or a line of dialogue is not a number), so the UI says as much directly
under the button, rather than implying a guarantee the tool cannot back up.
Read the rewrite before you post it.

**Cheap by default.** A post with zero rules fired never reaches the model.
`stats.rulesFired === 0` short-circuits to a free "nothing to fix" response,
the same condition the engine itself uses elsewhere for "no action required."
Identical reword requests are cached for 30 days, same as the main analysis.
There is no rules-only fallback: when the budget is spent, the key is
missing, or the model times out, the reword says so honestly instead of
returning something. The client only offers the button at all when the
worker is known reachable. The standalone `yourpost-sucks.html` copy running
from `file://` has no server to call, so it shows a plain note instead.

---

## Sprinkle AI: five more places the model gets to write

Everything above still holds: the model never produces the score. But for a
long time the model's voice only reached four fields (`oneLiner`, `roasts`,
`brutal`, `advice`/`changes`), and every other section of the report (the
kicker headline, the credits list, the breakdown, the diagnostics table, the
annotated post) stayed template-rendered even in full `llm` mode, because
nothing had ever generated prose for them. That felt more rules-boxed than it
needed to be, so five more optional fields were added to the *same* `report`
tool call (`headline`, `credits`, `breakdown_note`, `diagnostics_note`,
`annotated_note`), giving the model a light, one-line touch on sections that
used to be 100% template. **The score and every number underneath it, category
scores, contributions, volume bonus, stats, spans, remain exactly as rules-only
as before.** This was a deliberate scope decision, not a default: asked
directly whether the numeric score itself should also flex, the answer chosen
was to keep the score rules-only and put all the new "AI flavor" into prose,
preserving both of the score's structural guarantees (prompt-injection
resistance, and a full working product with the API switched off) while still
making the finished report read as more voiced throughout.

**One call, not six.** All five fields ride on the existing `report` call.
`max_tokens` grew from 900 to 1200 and `buildUserMessage()` sends richer
context (every category's contribution and weight, the rule engine's own
`credits` list, the literal highlighted spans, and the full stats line), but
no new round-trip was added. `COST_MICROS_PER_CALL` moved from $0.0052 to $0.0068 to reflect the larger cap,
and later to $0.013 when all three reserves were recalibrated to a true worst
case, then to $0.014 when the prompt gained the owner's voice guide and an
explanation of the scoring scale (see "The money").

**Every field degrades independently, and never invents a number.** Unlike
`roasts`/`brutal`, none of the five are load-bearing. A rejected or omitted
field simply doesn't render (or falls back to the rules-written default for
`headline`/`credits`), and never drops the rest of the response. Each one
runs through the same `noFabricatedNumbers()` guard the reword feature uses
(digit or spelled-out form, both count), checked against the full prompt
context: a number in a `breakdown_note` or `diagnostics_note` has to already
have been shown to the model as a fact, or the field is discarded. That
broad baseline is deliberately *not* used for the model's other prose:
`clean()`, the shared content-safety gate every field goes through first,
also runs on roasts/one_liner/brutal/advice/changes, and those check
fabrication (where they check it at all) against the post alone, not the
full prompt. The two-baseline split exists because the broad baseline caused
a real false rejection in testing: a roast citing a real stat (word count,
emoji count) that happens to share a value with an unrelated fabricated
number elsewhere in the response. `credits` gets one more structural
guardrail on top: it's capped to `report.credits.length`, the rule engine's
own detected-positive count, so the model can rewrite the rule engine's
findings in its own voice but cannot introduce a positive the rules never
found. The same "never invents a fact the rules didn't produce" principle
the score itself already lived by, extended to a new field type.

**No rules-only equivalent, and that's fine.** `headline` and `credits` fall
back to the rules-written defaults, because those sections always needed
*something* to show. The three "aside" notes (`breakdownNote`,
`diagnosticsNote`, `annotatedNote`) have no rules-written equivalent at all.
In rules mode, or whenever the model chooses to omit one, the section simply
shows no aside, styled with a `.ai-aside` left-border treatment so it reads as
commentary layered on top of unchanged data, not as part of it.

---

## Safety

**The bail-out.** Posts mentioning bereavement, serious illness, self-harm,
abuse, hate-motivated violence (lynching, hate crimes, police brutality, mass
shootings, genocide), or pregnancy loss return "analysis declined" with no
score and no model call. It runs before the network, so it costs nothing and
works offline. It is deliberately over-inclusive: declining a roastable post
is a much cheaper mistake than roasting a real one.

**Output policing.** `clean()` in `src/worker.js` discards any AI-written
field, in either the analyze or the reword path, that contains an em dash,
tries to state or imply a score, shows signs of having followed injected
instructions, or predicts reach. The tool has no predictive validity about
impressions and is not allowed to pretend otherwise, in either direction. The
em dash rule exists because it is the single most reliable tell of AI-written
prose, and a tool that roasts posts for sounding machine-written cannot let
its own output sound machine-written. `validateLLM()` wraps this with the
other structural checks (malformed, over-long). `changes[].rewrite`, the one
field in that response that is ready-to-paste replacement prose, additionally
gets reword's fabrication guard: a number introduced there that wasn't already
in the post drops just that rewrite line, not the whole change.

---

## Build

One engine, three targets, generated by `build.mjs`:

```
src/engine.js   →  source of truth (UMD: node + browser)
src/engine.mjs  →  ESM wrapper for the Worker
public/index.html + yourpost-sucks.html  →  page with the engine inlined
```

**`parity.mjs` is not optional.** It runs the same posts through node and a real
browser and fails the build if any score differs by so much as a decimal. It
exists because it caught a live bug: `String.replace(marker, engineSource)`
makes JS interpret `$&` inside the engine as a backreference, which silently
corrupted `countPhrase`'s regex escaping and broke every phrase containing a
metacharacter: `thoughts?`, `agree?`. The build now passes a function instead.
If the client and server engines ever drift, the fallback starts quietly lying.

---

## Extending the rules

A rule is a detector plus roast variants. Two guards on roast strings:

- `2+|...`: only usable when the rule fired twice or more
- `has:phrase|...`: only usable when that exact phrase is in the post

**A roast must never assert something the post does not contain.** That is the
worst failure this tool has, worse than a wrong score. Early versions told a post
about moving to Denver that "it was a job change," and told a buzzword post that
"learnings" should be "lessons" when the post never used the word.

Dialect rules use `anyPhraseAnnounceOnly()`, which requires announcement context
in the same sentence. "Moved to Denver for a new adventure" is a sentence;
"excited for this new adventure" is a genre. Only the second is a sin.
