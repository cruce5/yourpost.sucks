#!/usr/bin/env node
// Zero-dependency local TTS export server.
// Serves index.html and renders speech to WAV with the OS's own voices —
// the same engine the browser's speechSynthesis uses on macOS / Windows.
//
//   node server.mjs                 -> http://localhost:5178
//   node server.mjs --voice Daniel  -> default voice override
//   node server.mjs --voices        -> list installed voices and exit
//   node server.mjs --all           -> write all presets (literal + smart) to ./exports and exit
//
// POST /export  { text, voice? }  -> audio/wav

import http from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argVal = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const PORT = Number(argVal('--port') || 5178);
const OS = platform();
const DEFAULT_VOICE = argVal('--voice') || (OS === 'darwin' ? 'Samantha' : OS === 'win32' ? 'Microsoft Zira Desktop' : 'en-us');

const run = (cmd, cmdArgs) => new Promise((resolve, reject) => {
    execFile(cmd, cmdArgs, { maxBuffer: 1 << 26 }, (err, stdout, stderr) => err ? reject(new Error(stderr || err.message)) : resolve(stdout));
});

const psQuote = (s) => `'${s.replace(/'/g, "''")}'`;

async function listVoices() {
    if (OS === 'darwin') return (await run('say', ['-v', '?'])).trim();
    if (OS === 'win32') return (await run('powershell', ['-NoProfile', '-Command',
        'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | % { $_.VoiceInfo.Name }'])).trim();
    return (await run('espeak-ng', ['--voices=en'])).trim();
}

async function synthesize(text, voice) {
    const dir = await mkdtemp(join(tmpdir(), 'tts-'));
    const txt = join(dir, 'in.txt');
    const wav = join(dir, 'out.wav');
    try {
        await writeFile(txt, text, 'utf8');
        if (OS === 'darwin') {
            await run('say', ['-v', voice, '-f', txt, '-o', wav, '--file-format=WAVE', '--data-format=LEI16@48000']);
        } else if (OS === 'win32') {
            await run('powershell', ['-NoProfile', '-Command', [
                'Add-Type -AssemblyName System.Speech',
                '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
                `$s.SelectVoice(${psQuote(voice)})`,
                `$s.SetOutputToWaveFile(${psQuote(wav)}, (New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo 48000, ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono)))`,
                `$s.Speak([IO.File]::ReadAllText(${psQuote(txt)}, [Text.Encoding]::UTF8))`,
                '$s.Dispose()'
            ].join('; ')]);
        } else {
            await run('espeak-ng', ['-v', voice, '-f', txt, '-w', wav]);
        }
        return await readFile(wav);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

// Mirrors normalizeUnicode / generateSpeechText in index.html.
function normalizeUnicode(text) {
    const ranges = [
        { start: 0x1D400, end: 0x1D419, base: 65 }, { start: 0x1D41A, end: 0x1D433, base: 97 },
        { start: 0x1D56C, end: 0x1D585, base: 65 }, { start: 0x1D586, end: 0x1D59F, base: 97 }
    ];
    let result = '';
    for (const char of text) {
        const code = char.codePointAt(0);
        const r = ranges.find(r => code >= r.start && code <= r.end);
        result += r ? String.fromCharCode(r.base + (code - r.start)) : char;
    }
    return result.normalize('NFC').replace(/[\u0300-\u036f]/g, '');
}

function generateSpeechText(rawText, literal) {
    if (!literal) return normalizeUnicode(rawText);
    if (!Array.from(rawText).some(c => c.codePointAt(0) > 127)) return rawText;
    let translated = '';
    for (const char of rawText) {
        const code = char.codePointAt(0);
        const hex = code.toString(16).toUpperCase().padStart(4, '0');
        if (code === 32) translated += ' space ';
        else if (code > 127) translated += ` mathematical unicode character U plus ${hex}. `;
        else translated += char + ' ';
    }
    return translated;
}

const PRESETS = {
    bold: '𝘁𝘆𝗽𝗲𝗴𝗿𝗼𝘄.𝗰𝗼𝗺',
    zalgo: 'H̷e̷l̷l̷o̷! T̈ḧïs̈ ḧäs̈ c̈öm̈b̈ïn̈ïn̈g̈ d̈ïäc̈r̈ïẗïc̈s̈.',
    emoji: 'Astronaut: 👩‍🚀🚀 family: 👨‍👩‍👦'
};

if (args.includes('--all')) {
    const { mkdir } = await import('node:fs/promises');
    const out = join(process.cwd(), 'exports');
    await mkdir(out, { recursive: true });
    for (const [name, raw] of Object.entries(PRESETS)) {
        for (const literal of [true, false]) {
            const file = join(out, `${literal ? 'literal' : 'smart'}-${name}.wav`);
            await writeFile(file, await synthesize(generateSpeechText(raw, literal), DEFAULT_VOICE));
            console.log('wrote', file);
        }
    }
    process.exit(0);
}

if (args.includes('--voices')) {
    console.log(await listVoices());
    process.exit(0);
}

http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.end();
    try {
        if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.end(await readFile(join(here, 'index.html')));
        }
        if (req.method === 'GET' && req.url === '/voices') {
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ os: OS, default: DEFAULT_VOICE, voices: (await listVoices()).split('\n') }));
        }
        if (req.method === 'POST' && req.url === '/export') {
            let body = '';
            for await (const chunk of req) body += chunk;
            const { text, voice } = JSON.parse(body || '{}');
            if (!text || !text.trim()) { res.statusCode = 400; return res.end('No text'); }
            const audio = await synthesize(text, voice || DEFAULT_VOICE);
            console.log(`exported ${audio.length} bytes (${voice || DEFAULT_VOICE})`);
            res.setHeader('Content-Type', 'audio/wav');
            return res.end(audio);
        }
        res.statusCode = 404;
        res.end('Not found');
    } catch (err) {
        console.error(err);
        res.statusCode = 500;
        res.end(String(err.message || err));
    }
}).listen(PORT, () => {
    console.log(`Open http://localhost:${PORT}  (voice: ${DEFAULT_VOICE}, os: ${OS})`);
});
