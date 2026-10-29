# Unicode screen reader – audio export

Browsers won't let a page record `speechSynthesis`. But that voice is just your OS voice
(Samantha/Alex on macOS, Zira/David on Windows), so `server.mjs` renders the same voice
straight to WAV. Needs only Node 18+, with no npm install.

```bash
node server.mjs --all          # writes all 6 preset clips to ./exports/*.wav
node server.mjs                # then open http://localhost:5178 and click Export
node server.mjs --voices       # list voices
node server.mjs --voice Daniel # pick a different default voice
```

Note: if Chrome is playing **"Google UK English Female"**, that is a cloud voice and can't
be scripted. The closest local voices are `--voice Kate` or `--voice Serena` on macOS
(download them in System Settings → Accessibility → Spoken Content → Manage Voices).
