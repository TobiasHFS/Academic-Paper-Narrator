/// <reference types="vite/client" />
import { GoogleGenAI, Modality } from "@google/genai";
import { AudioSegment } from "../types";

// Initialize the client
const getAIClient = () => new GoogleGenAI({ apiKey: (import.meta.env.VITE_GEMINI_API_KEY as string) });

export const VOICE_PROFILES = [
  { name: 'Fenrir', label: 'Fenrir (Deep, Masculine)', description: 'Professional and calm, great for technical papers.' },
  { name: 'Aoede', label: 'Aoede (Clear, Female)', description: 'Bright and articulate, high clarity.' },
  { name: 'Charon', label: 'Charon (Steady, Masculine)', description: 'Neutral and reliable, easy to follow.' },
  { name: 'Kore', label: 'Kore (Soft, Female)', description: 'Warm and gentle, less robotic.' },
];

const getSystemInstruction = (language: 'en' | 'de') => {
  // ... (keeping existing system instructions)
  if (language === 'de') {
    return `
You are an expert academic translator and narrator. Your task is to produce a coherent, intelligent narrative script **IN GERMAN** from the provided academic paper pages.

**1. STRUCTURE & FORMATTING**:
- Use Markdown headers (\`#\`, \`##\`, \`###\`).
- Use double newlines (\`\\n\\n\`) for paragraphs.

**2. LAYOUT & FLOW (CRITICAL)**:
- **Figure Interruptions**: If a figure splits a sentence (e.g., text above ends with "defined as", text below starts with "a function"), **FINISH THE SENTENCE FIRST**.
  - *Wrong*: "defined as [Figure Description] a function..."
  - *Right*: "defined as a function... [Then describe Figure]"
- **Sentence Fragments**: If a page starts with a lowercase letter (continuation), output it as is.

**3. FIGURES (INTEGRATED)**:
- **Trigger**: Describe figures *after* the sentence referring to them is complete.
- **Style**: Professor-style explanation (Trend/Implication). Keep it integrated.

**4. EXCLUSIONS**:
- No footnotes, metadata, references.

**5. MATHEMATIK (KURZ & PRÄGNANT)**:
- **Regel**: Lesen Sie erst den Satz und die Formel vollständig vor.
- **Einsicht (2-3 Sätze)**: Fügen Sie direkt danach eine kurze Erklärung an, *warum* diese Form gewählt wurde.
- **FORMAT**: **KEINE LABELS** wie "**Modeling Rationale**". Schreiben Sie einfach den Text.
- *Beispiel*: "...berechnet als Integral von f(x). Das Integral wird hier genutzt, um die kontinuierliche Verteilung über den gesamten Bereich zu summieren."

**OUTPUT FORMAT**:
- Separate pages with "---PAGE_BREAK---".
- If empty/skipped, write "[[EMPTY]]".
`;
  }

  return `
You are an expert academic narrator. Your task is to produce a coherent, intelligent narrative script from the provided academic paper pages.

**1. STRUCTURE & FORMATTING**:
- Use Markdown headers (\`#\`, \`##\`, \`###\`).
- Use double newlines (\`\\n\\n\`) for paragraphs.

**2. LAYOUT & FLOW (CRITICAL: REPAIR BROKEN SENTENCES)**:
- **Figure Interruptions**: If a figure or table splits a sentence (e.g., text above ends with "continuous", text below starts with "by assumption"), **YOU MUST SKIP THE FIGURE TEMPORARILY** to finish the sentence.
  - *Wrong*: "continuous [Figure Description] by assumption."
  - *Right*: "continuous by assumption. [Then describe Figure]"
- **Sentence Fragments**: If a page starts with a lowercase letter, just output it as is (it will be stitched later).

**3. FIGURES (SEAMLESS INTEGRATION)**:
- **Trigger**: Insert figure descriptions naturally **AFTER** the sentence containing the reference or the sentence interrupted by the figure is complete.
- **Style**: "Lecturer Mode" - explain the trend/implication. Don't just list data.

**4. EXCLUSIONS**:
- No footnotes, metadata, references.

**5. MATH (CONCISE INSIGHT)**:
- **Flow**: Read the full sentence including the formula first.
- **Insight**: Immediately after, add **2-3 sentences** explaining the *strategic intent* (Why this form? Why Log/Integral/Ratio?).
- **FORMAT**: **NO LABELS** (Do NOT write "**Modeling Rationale**" or "**Analysis**"). Just flow naturally into the explanation.
- *Example*: "...can be expressed as [Formula]. This integral formulation is chosen to capture the cumulative probability across the continuous domain, ensuring total coverage of the risk spectrum."

**OUTPUT FORMAT**:
- Separate pages with "---PAGE_BREAK---".
- If empty/skipped, write "[[EMPTY]]".
`;
};

// ... RequestScheduler implementation (unchanged)
class RequestScheduler {
  private queue: Array<() => Promise<void>> = [];
  private activeCount = 0;
  private maxConcurrent = 3;
  private minInterval = 300;
  private lastRequestTime = 0;

  add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
      this.process();
    });
  }

  private process() {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) return;
    const now = Date.now();
    const timeSinceLast = now - this.lastRequestTime;
    if (timeSinceLast < this.minInterval) {
      setTimeout(() => this.process(), this.minInterval - timeSinceLast);
      return;
    }
    const task = this.queue.shift();
    if (task) {
      this.activeCount++;
      this.lastRequestTime = Date.now();
      task().finally(() => {
        this.activeCount--;
        this.process();
      });
      this.process();
    }
  }
}

const ttsScheduler = new RequestScheduler();

async function generateTtsWithRetry(ai: any, text: string, voiceName: string): Promise<Uint8Array> {
  let attempt = 0;
  while (true) {
    try {
      const res = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
        },
      });

      const base64 = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64) throw new Error("Empty audio response.");
      return decode(base64);
    } catch (e: any) {
      const isQuota = e.message?.includes('429') || e.status === 429;
      if (isQuota) {
        const waitTime = 10000 + (Math.random() * 5000);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        attempt++;
        if (attempt > 100) throw e;
      } else {
        if (attempt >= 3) throw e;
        await new Promise(resolve => setTimeout(resolve, 2000 * Math.pow(2, attempt)));
        attempt++;
      }
    }
  }
}

export const extractScriptBatch = async (
  pages: { pageNum: number; base64Image: string; rawText: string }[],
  language: 'en' | 'de' = 'en'
): Promise<Map<number, string>> => {
  const ai = getAIClient();
  const parts: any[] = [];
  pages.forEach((p) => {
    parts.push({ text: `\n\n--- START PAGE ${p.pageNum} ---\n` });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: p.base64Image.split(',')[1] } });
    parts.push({ text: `Context Text for Page ${p.pageNum}: "${p.rawText}"\n` });
  });
  parts.push({ text: `\n\nTask: ${language === 'de' ? 'TRANSLATE and Transcribe' : 'Transcribe'} these ${pages.length} pages. Separate each page with "---PAGE_BREAK---".` });

  const rawResult = await retryGenerate(ai, {
    model: 'gemini-3-flash-preview',
    contents: { parts },
    config: {
      systemInstruction: getSystemInstruction(language),
      maxOutputTokens: 8192
    }
  });

  const resultMap = new Map<number, string>();
  const splitResults = rawResult.split('---PAGE_BREAK---');
  pages.forEach((p, index) => {
    let text = splitResults[index] || "";
    text = text.replace(/\[\[EMPTY\]\]/g, "").replace(/\[\[SKIPPED_SECTION\]\]/g, "").trim();
    resultMap.set(p.pageNum, text);
  });
  return resultMap;
};

async function retryGenerate(ai: any, params: any, retries = 5): Promise<string> {
  let attempt = 0;
  while (true) {
    try {
      const response = await ai.models.generateContent(params);
      return response.text || "";
    } catch (error: any) {
      if (error.status === 429) {
        await new Promise(resolve => setTimeout(resolve, 15000 + (Math.random() * 5000)));
      } else {
        if (attempt >= retries) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        attempt++;
      }
    }
  }
}

/**
 * Split text into sentences for precise timing.
 */
function splitIntoSentences(text: string): string[] {
  // Matches end of sentences but keeps the punctuation
  return text.match(/[^.!?]+[.!?]*(\s+|$)/g) || [text];
}

export const synthesizeBatch = async (
  pages: { pageNum: number; text: string }[],
  voiceName: string = 'Fenrir'
): Promise<Map<number, { audioUrl: string, segments: AudioSegment[] }>> => {
  const ai = getAIClient();
  const resultMap = new Map<number, { audioUrl: string, segments: AudioSegment[] }>();

  // Process each page as a potential "unit" but with sentence-level granular segments
  // We process pages in series here but each page can have many sentences.
  // To keep speed high, we still batch synthesis across pages if they are small.

  for (const page of pages) {
    if (!page.text.trim()) {
      resultMap.set(page.pageNum, { audioUrl: "", segments: [] });
      continue;
    }

    const sentences = splitIntoSentences(page.text).filter(s => s.trim());
    const audioChunks: Uint8Array[] = await Promise.all(
      sentences.map(s => ttsScheduler.add(() => generateTtsWithRetry(ai, s, voiceName)))
    );

    const totalLength = audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const stitchedPcm = new Uint8Array(totalLength);
    let offset = 0;
    const pageSegments: AudioSegment[] = [];
    let currentStartTime = 0;
    const BYTES_PER_SECOND = 24000 * 2;

    audioChunks.forEach((chunk, i) => {
      stitchedPcm.set(chunk, offset);
      const duration = chunk.length / BYTES_PER_SECOND;
      pageSegments.push({
        text: sentences[i],
        startTime: currentStartTime,
        duration: duration,
        isSilence: false
      });
      offset += chunk.length;
      currentStartTime += duration;
    });

    const finalAudioUrl = URL.createObjectURL(createWavBlob(stitchedPcm, 24000));
    resultMap.set(page.pageNum, {
      audioUrl: finalAudioUrl,
      segments: pageSegments
    });
  }

  return resultMap;
};

export const generateVoicePreview = async (voiceName: string, language: 'en' | 'de' = 'en'): Promise<string> => {
  const ai = getAIClient();
  const text = language === 'de'
    ? "Dies ist eine Vorschau meiner Stimme für Ihre wissenschaftlichen Artikel."
    : "This is a preview of my voice for your academic papers.";

  const pcm = await ttsScheduler.add(() => generateTtsWithRetry(ai, text, voiceName));
  const blob = createWavBlob(pcm, 24000);
  return URL.createObjectURL(blob);
};


function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

function createWavBlob(pcmData: Uint8Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + pcmData.length);
  const view = new DataView(buffer);
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmData.length, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, pcmData.length, true);
  new Uint8Array(buffer, 44).set(pcmData);
  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
}