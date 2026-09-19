# Round 4: testing the two one-author rules

`promo-lede` and `plug-signoff` were tuned on seven flops from one author and
have never been tested anywhere else. This round tests only them, on posts
they have never seen, with the labels fixed before either rule runs.

## The rules under test (frozen)

- **promo-lede** fires when a post opens on logistics: the first sentence is a
  date, a time, a venue, a registration, or an event or show name ("is back",
  "join us", "tune in") instead of a person, a claim, or something that
  happened.
- **plug-signoff** fires when the last line or two is a sign-off that
  advertises something to go consume: an episode, a newsletter, a
  registration, "link in comments".

Do not change either rule, or the text normalisation they use, until the
round is scored. `node round4.mjs lock` records a fingerprint of their code,
and `score` refuses to run if it changed.

## What to collect

Two groups of about 20 posts each, from at least 15 different authors, at
most 3 posts from any one author.

- **target**: posts you would say lead with logistics, or end on a plug, or
  both. Event and webinar announcements, podcast and newsletter promos,
  "Join us Thursday", a "--" sign-off that advertises something.
- **nearmiss**: posts that look like targets but are not. An event post that
  opens on a person or an idea. A sign-off that adds a thought instead of a
  plug. A promo whose first line is the interesting part.

Aim for a spread of engagement. Posts with 150 or more reactions count as
hits, 8 or fewer as flops, and anything in between is kept for the firing test
but left out of the engagement read.

## How to collect (the easy way)

Browse LinkedIn normally, at your own pace, in the normal interface. No
scraping, no scripts or bots driving the page, no unofficial API: LinkedIn's
terms forbid automated collection, which is why this is by hand.

1. When you pass a post that fits, click "…more" so the whole post shows,
   select its text, and copy it.
2. In the app folder, run:

   ```
   node round4.mjs add
   ```

3. Answer five questions: author, how old it is (a week or older only),
   reactions, and your two yes/no judgements. It writes the file, picks the
   group from your answers, refuses duplicates and a fourth post from the same
   author, and tells you how far along you are. It never shows you what the
   tool thinks of the post.

If the clipboard is empty it asks you to paste the post instead.

## Or by hand

Make one file per post in `round4/posts/`, named anything ending in `.txt`
(for example `jane-webinar.txt`). Copy `_example.txt` to start.

Fill in every header line **before you look at what the tool thinks of it**:

```
author: Jane Doe
reactions: 212
group: target
leads_with_logistics: yes
ends_on_plug: no
---
The whole post text goes here, exactly as copied.
```

- `reactions`: the reaction count as shown on the post.
- `leads_with_logistics`: yes if, in your judgement, the first sentence is
  mainly when, where or how to attend, register or tune in.
- `ends_on_plug`: yes if the last line or two mainly advertise something to go
  consume rather than add a thought.
- `group`: `target` needs at least one yes; `nearmiss` has both no.

Do not paste these posts into yourpost.sucks while you are collecting. Seeing
the score first is exactly the bias the lock exists to prevent.

## Running it

```
node round4.mjs status     # progress only; never runs a rule
node round4.mjs lock       # fixes the labels and the two rules
node round4.mjs score      # runs once, reports firing accuracy and engagement
```

`score` reports, for each rule, how many of the posts you said have the
pattern it caught (recall), how many of its firings you agreed with
(precision), and how often it fired on posts you said do not have it (false
alarms), each with a 95% interval. The engagement read compares the flop
share where the rule fired against where it did not. At about 40 posts that
second number is a direction check, not a verdict.

The posts are private. `round4/posts/` and `round4/lock.json` are gitignored,
like `corpus.json`.
