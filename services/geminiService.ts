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
  { name: 'Puck', label: 'Puck (Energetic, Masculine)', description: 'Engaging and lively delivery.' },
  { name: 'Rheia', label: 'Rheia (Sophisticated, Female)', description: 'Smooth, authoritative, and professional.' },
  { name: 'Orpheus', label: 'Orpheus (Narrative, Masculine)', description: 'Storyteller style, very natural flow.' },
  { name: 'Muses', label: 'Muses (Balanced, Female)', description: 'Classic academic narration style.' },
];

const getSystemInstruction = (language: 'en' | 'de') => `
You are an expert academic narrator. Your goal is to transform complex academic PDF content into highly natural, engaging, and easy-to-follow audio scripts.

**CRITICAL FOR PACING AND VOICE STABILITY (IMPORTANT):**
1. **Hard Pacing Breaks**: You MUST break the text into very short, punchy paragraphs. Separate EVERY paragraph with double newlines (\\n\\n). This allows the text-to-speech engine to "take a breath" and prevents the voice from speeding up or pitching up over long texts. Do not write wall-of-text paragraphs.
2. **Prosody & Intonation**: Do not produce flat, robotic speech. Use varied pitch and natural pauses.
3. **Academic Flow**: When reading complex formulas or citations, summarize them naturally (e.g., "The researchers found..." instead of reading every parenthesis).
4. **Emphasis**: Emphasize key findings and structural transitions (e.g., "Moving on to the results...").
5. **Sentence Variance**: Use a mix of short and long sentences to maintain interest.

${language === 'de' ? `
You are an expert academic translator and narrator. Your task is to produce a coherent, intelligent narrative script **IN GERMAN** from the provided academic paper pages.

**1. STRUCTURE & FORMATTING**:
- Use Markdown headers (#, ##, ###).
- Use double newlines (\\n\\n) for paragraphs.

**2. LAYOUT & FLOW (CRITICAL)**:
- **Figure Interruptions**: If a figure or table splits a sentence, finish the sentence first.
- **Fragments**: Handle page-spanning sentences gracefully.

**3. MATH (INTEGRATED)**:
- Read the sentence and formula, then provide a 2-3 sentence insight on the strategic intent.

**OUTPUT FORMAT**:
- Separate pages with "---PAGE_BREAK---".
- If empty/skipped, write "[[EMPTY]]".
` : `
You are an expert academic narrator. Your task is to produce a coherent, intelligent narrative script from the provided academic paper pages.

**1. STRUCTURE & FORMATTING**:
- Use Markdown headers (#, ##, ###).
- Use double newlines (\\n\\n) for paragraphs.

**2. LAYOUT & FLOW (CRITICAL)**:
- **Figure Interruptions**: Repair broken sentences that are split by figures or tables.
- **Fragments**: Handle page-spanning sentences gracefully.

**3. MATH (INTEGRATED)**:
- Read the sentence and formula, then provide a 2-3 sentence insight on the strategic intent.

**OUTPUT FORMAT**:
- Separate pages with "---PAGE_BREAK---".
- If empty/skipped, write "[[EMPTY]]".
`}
`;

// ... RequestScheduler implementation (unchanged)
class RequestScheduler {
  private queue: Array<{ task: () => Promise<any>; signal?: AbortSignal; resolve: (val: any) => void; reject: (err: any) => void }> = [];
  private activeCount = 0;
  private maxConcurrent = 3;
  private minInterval = 300;
  private lastRequestTime = 0;

  add<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      this.queue.push({ task, signal, resolve, reject });
      this.process();
    });
  }

  private process() {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) return;

    // Remove any aborted requests from the queue before processing
    while (this.queue.length > 0 && this.queue[0].signal?.aborted) {
      const abortedItem = this.queue.shift();
      abortedItem!.reject(new DOMException("Aborted", "AbortError"));
    }

    if (this.queue.length === 0) return;

    const now = Date.now();
    const timeSinceLast = now - this.lastRequestTime;
    if (timeSinceLast < this.minInterval) {
      setTimeout(() => this.process(), this.minInterval - timeSinceLast);
      return;
    }

    const item = this.queue.shift();
    if (item) {
      this.activeCount++;
      this.lastRequestTime = Date.now();

      if (item.signal?.aborted) {
        this.activeCount--;
        item.reject(new DOMException("Aborted", "AbortError"));
        this.process();
        return;
      }

      item.task()
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => {
          this.activeCount--;
          this.process();
        });
      this.process();
    }
  }
}

const ttsScheduler = new RequestScheduler();

async function generateTtsWithRetry(ai: any, text: string, voiceName: string, signal?: AbortSignal): Promise<Uint8Array> {
  let attempt = 0;
  while (true) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
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
      }, { signal });

      const base64 = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64) throw new Error("Empty audio response.");
      return decode(base64);
    } catch (e: any) {
      if (e.name === "AbortError" || signal?.aborted) throw e;

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
  language: 'en' | 'de' = 'en',
  signal?: AbortSignal
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
    contents: [{ parts }],
    config: {
      systemInstruction: getSystemInstruction(language),
      maxOutputTokens: 8192
    }
  }, { signal });

  const resultMap = new Map<number, string>();
  const splitResults = rawResult.split('---PAGE_BREAK---');
  pages.forEach((p, index) => {
    let text = splitResults[index] || "";
    text = text.replace(/\[\[EMPTY\]\]/g, "").replace(/\[\[SKIPPED_SECTION\]\]/g, "").trim();
    resultMap.set(p.pageNum, text);
  });
  return resultMap;
};

async function retryGenerate(ai: any, params: any, extraConfig?: { signal?: AbortSignal }, retries = 5): Promise<string> {
  let attempt = 0;
  while (true) {
    if (extraConfig?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const response = await ai.models.generateContent(params, extraConfig);
      return response.text || "";
    } catch (error: any) {
      if (error.name === "AbortError" || extraConfig?.signal?.aborted) throw error;

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

export const synthesizeBatch = async (
  pages: { pageNum: number; text: string }[],
  voiceName: string = 'Fenrir',
  signal?: AbortSignal
): Promise<Map<number, { audioUrl: string, segments: AudioSegment[] }>> => {
  const ai = getAIClient();
  const resultMap = new Map<number, { audioUrl: string, segments: AudioSegment[] }>();

  for (const page of pages) {
    if (!page.text.trim()) {
      resultMap.set(page.pageNum, { audioUrl: "", segments: [] });
      continue;
    }

    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    // Process the entire page as a single TTS request
    const pcmData = await ttsScheduler.add(() => generateTtsWithRetry(ai, page.text, voiceName, signal), signal);

    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    // We treat the full page as one continuous audio segment
    const duration = pcmData.length / (24000 * 2);

    const pageSegments: AudioSegment[] = [{
      text: page.text,
      startTime: 0,
      duration: duration,
      isSilence: false
    }];

    const finalAudioUrl = URL.createObjectURL(createWavBlob(pcmData, 24000));
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