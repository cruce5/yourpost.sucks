# Unicode Screen Reader - Audio Export Task

## The Goal
Create a web app that demonstrates how screen readers handle styled text (like 𝗯𝗼𝗹𝗱 𝘁𝗲𝘅𝘁) by contrasting "Literal Mode" (spelling out every mathematical Unicode character) with "Smart Mode" (normalizing text into semantic words).
Crucially, the user needs to export the EXACT spoken audio of these examples to a `.wav` or `.mp3` file to drop into Descript for a video presentation.

## The Problem
We have hit a wall with browser security sandboxes. The browser's native `window.speechSynthesis` engine produces the exact voice we want, but browsers intentionally prevent developers from routing this audio directly into a file or a Web Audio API node.

## What We've Tried
1. **Web Audio API (`MediaStreamDestination`)**: Failed. `speechSynthesis` cannot be piped into an AudioContext.
2. **Tab Capture (`getDisplayMedia`)**: Failed. The AI coding environment runs the preview in a sandboxed iframe, which completely blocks screen/tab sharing.
3. **Microphone Capture (`getUserMedia`)**: Failed. The laptop speakers and mic are low quality, resulting in terrible audio capture.
4. **Offline Tone Generator**: Failed. It just generated a beep tone, not the actual spoken words.

## The Ask for Claude Code
Since you (Claude Code) run locally and are not bound by the browser iframe restrictions, please implement a reliable way to export the TTS audio to a file. 

Possible approaches you can take:
1. **Local Node.js TTS Script**: Create a tiny Express server alongside the frontend that uses a Node TTS library (like `@google-cloud/text-to-speech`, `gtts`, or the `say` command on macOS) to generate the file and serve it back to the frontend.
2. **Puppeteer/Playwright**: If it must be the browser voice, spin up a hidden headless browser locally that CAN use tab capture, record it, and save it.
3. **Direct API Call**: Connect the "Export WAV" button to a reliable, free TTS API endpoint that streams MP3/WAV data directly back as a Blob.

The frontend app code is in `index.html`. Focus on the `startExport()` function inside the `PresentationScreenReader` class.