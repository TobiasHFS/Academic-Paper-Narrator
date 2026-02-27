/**
 * Generate Voice Preview WAV Files
 * 
 * Run this script once to generate all voice preview audio files.
 * They will be saved to public/voices/ and loaded locally by the app.
 * 
 * Usage: node scripts/generate-previews.mjs
 */
import { GoogleGenAI, Modality } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'voices');

// Read API key from .env file
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const apiKey = envContent.match(/VITE_GEMINI_API_KEY=(.+)/)?.[1]?.trim();

if (!apiKey) {
    console.error('Could not find VITE_GEMINI_API_KEY in .env file');
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

const VOICES = ['Fenrir', 'Aoede', 'Charon', 'Kore', 'Puck', 'Leda', 'Orus', 'Zephyr'];
const LANGUAGES = ['en', 'de'];

const PREVIEW_TEXTS = {
    en: "This is a preview of my voice for your academic papers.",
    de: "Dies ist eine Vorschau meiner Stimme für Ihre wissenschaftlichen Artikel."
};

function createWavBuffer(pcmData, sampleRate) {
    const buffer = Buffer.alloc(44 + pcmData.length);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + pcmData.length, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(pcmData.length, 40);
    pcmData.copy(buffer, 44);
    return buffer;
}

async function generatePreview(voiceName, language, retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const res = await ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: PREVIEW_TEXTS[language] }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName } },
                    },
                },
            });

            const base64 = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (!base64) throw new Error("Empty audio response");

            const pcmData = Buffer.from(base64, 'base64');
            return createWavBuffer(pcmData, 24000);
        } catch (e) {
            console.warn(`  Attempt ${attempt + 1} failed for ${voiceName}_${language}: ${e.message}`);
            if (attempt < retries - 1) {
                await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
            }
        }
    }
    return null;
}

async function main() {
    // Create output directory
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    console.log(`Generating voice previews to ${OUTPUT_DIR}...\n`);

    for (const voice of VOICES) {
        for (const lang of LANGUAGES) {
            const filename = `${voice}_${lang}_preview.wav`;
            const filepath = path.join(OUTPUT_DIR, filename);

            // Skip if already exists
            if (fs.existsSync(filepath)) {
                console.log(`  ✓ ${filename} (already exists, skipping)`);
                continue;
            }

            console.log(`  Generating ${filename}...`);
            const wavBuffer = await generatePreview(voice, lang);

            if (wavBuffer) {
                fs.writeFileSync(filepath, wavBuffer);
                console.log(`  ✓ ${filename} (${(wavBuffer.length / 1024).toFixed(1)} KB)`);
            } else {
                console.error(`  ✗ Failed to generate ${filename}`);
            }

            // Rate limiting
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    console.log('\nDone! All voice previews generated.');
}

main().catch(console.error);
