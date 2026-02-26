/// <reference types="vite/client" />
import { GoogleGenAI, Modality } from "@google/genai";
import { AudioSegment, PrescreenResult, PageCategory, PrescreenPage } from "../types";

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
        if (attempt >= 5) throw e; // Prevent infinite loop on hard quota limits
        const waitTime = 10000 + (Math.random() * 5000);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        attempt++;
      } else {
        if (attempt >= 3) throw e;
        await new Promise(resolve => setTimeout(resolve, 2000 * Math.pow(2, attempt)));
        attempt++;
      }
    }
  }
}

export const analyzeDocumentStructure = async (
  pages: { pageNum: number; rawText: string }[],
  signal?: AbortSignal
): Promise<PrescreenResult> => {
  const ai = getAIClient();
  const parts: any[] = [];

  // We only need the first 25 pages to determine structure usually, to save massive token costs, 
  // but if it's short we send all. If it's long, we send front and back.
  let pagesToSend = pages;
  if (pages.length > 40) {
    pagesToSend = [...pages.slice(0, 20), ...pages.slice(-20)];
  }

  pagesToSend.forEach((p) => {
    // Truncate text per page to save tokens, we only need enough to classify
    const truncated = p.rawText.substring(0, 800);
    parts.push({ text: `Page ${p.pageNum}:\n${truncated}\n` });
  });

  const prompt = `
You are an AI document structure analyzer. Read the provided text from the pages of this academic document.
Your job is to categorize EACH provided page into one of these categories: 'cover', 'toc' (table of contents), 'main' (actual manuscript/body), 'references' (bibliography/citations), 'appendix', or 'blank' (empty or just a page number).

Output a STRICT JSON ARRAY of objects, one for each page, matching this exact schema:
[
  { "pageNumber": 1, "category": "cover", "reasoning": "Contains only title and author names" },
  { "pageNumber": 2, "category": "main", "reasoning": "Starts with abstract and introduction" }
]

CRITICAL: Return ONLY valid JSON, no markdown blocks, no other text.
  `;

  try {
    const rawResult = await retryGenerate(ai, {
      model: 'gemini-2.5-flash',
      contents: [{ parts: [{ text: prompt }, ...parts] }],
      config: {
        responseMimeType: "application/json",
      }
    }, { signal });

    const parsed = JSON.parse(rawResult) as { pageNumber: number, category: PageCategory, reasoning: string }[];

    // Merge the AI results back into the total page list (since we might have skipped middle pages to save tokens, 
    // infer middle pages as 'main')
    const finalPages: PrescreenPage[] = pages.map(p => {
      const aiGuess = parsed.find(aiP => aiP.pageNumber === p.pageNum);
      const category = aiGuess?.category || 'main'; // Default to main if in the un-sent middle
      const reasoning = aiGuess?.reasoning || 'Inferred as main body text';

      // Auto-select only main text and appendices by default
      const selected = category === 'main' || category === 'appendix';

      return {
        pageNumber: p.pageNum,
        category,
        reasoning,
        selected
      };
    });

    return {
      pages: finalPages,
      totalSelected: finalPages.filter(p => p.selected).length
    };
  } catch (e) {
    console.error("Failed to analyze structure", e);
    // Silent fallback: just select everything and call it main
    const fallbackPages: PrescreenPage[] = pages.map(p => ({
      pageNumber: p.pageNum,
      category: 'main' as PageCategory,
      reasoning: 'Fallback classification',
      selected: true
    }));
    return { pages: fallbackPages, totalSelected: fallbackPages.length };
  }
};

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
    model: 'gemini-2.5-flash',
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
        if (attempt >= retries * 2) throw error; // Allow more retries for 429s but don't loop forever
        await new Promise(resolve => setTimeout(resolve, 15000 + (Math.random() * 5000)));
        attempt++;
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

    // --- ZERO-COST AUDIO SYNC: SILENCE DETECTION & HEURISTICS ---
    // 1. Parse the text into sentences, roughly matching natural pauses
    const rawSentences = page.text.match(/[^.!?\n]+[.!?\n]*(\s+|$)/g) || [page.text];
    const sentences = rawSentences.filter(s => s.trim().length > 0);

    // 2. Scan the highly-clean TTS PCM audio mathematically for silence gaps
    // 24000hz, 1 channel, 16-bit PCM.
    const view = new DataView(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);
    const numSamples = pcmData.length / 2;

    // Silence config
    const silenceThreshold = 50; // Amplitude threshold (0-32768)
    const minSilenceMs = 250;
    const minSilenceSamples = (24000 * minSilenceMs) / 1000;

    const pauseTimestamps: number[] = [];
    let currentSilenceLen = 0;

    for (let i = 0; i < numSamples; i++) {
      // Read 16-bit PCM sample
      const sample = Math.abs(view.getInt16(i * 2, true));
      if (sample < silenceThreshold) {
        currentSilenceLen++;
      } else {
        if (currentSilenceLen > minSilenceSamples) {
          // Record the timestamp of the END of the silence gap (when the next sentence starts)
          pauseTimestamps.push(i / 24000);
        }
        currentSilenceLen = 0;
      }
    }

    // 3. Reconcile text sentences with perfectly physical audio timestamp boundaries
    const sentenceBlocks: { text: string, startTime: number, duration: number }[] = [];
    let currentAnchor = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sText = sentences[i];
      const nextAnchor = pauseTimestamps[i] || duration; // Fallback to end if we miscounted gaps

      let sDuration = nextAnchor - currentAnchor;
      if (sDuration <= 0 && i === sentences.length - 1) {
        sDuration = duration - currentAnchor; // Final catch-all
      }

      sentenceBlocks.push({
        text: sText,
        startTime: currentAnchor,
        duration: Math.max(sDuration, 0.1)
      });

      currentAnchor = nextAnchor;
    }

    // 4. Distribute words inside the anchored sentence using Punctuation Heuristics
    const pageSegments: AudioSegment[] = [];

    for (const block of sentenceBlocks) {
      // Split sentence into words
      const tokens = block.text.split(/(\s+)/).filter(t => t.length > 0);

      // Calculate synthetic weights. Punctuation gets essentially 'more time' in the breakdown
      const tokensWithWeight = tokens.map(t => {
        const isSilence = !t.trim();
        if (isSilence) return { text: t, weight: 0, isSilence };

        let weight = t.length;
        if (t.includes(',')) weight += 3; // roughly +3 chars worth of time
        if (t.includes('.')) weight += 5;
        if (t.includes(':') || t.includes(';')) weight += 4;

        return { text: t, weight, isSilence };
      });

      const totalWeight = tokensWithWeight.reduce((sum, t) => sum + t.weight, 0);

      // Map back to global page segment array
      let intraTime = block.startTime;
      for (const t of tokensWithWeight) {
        const tokenDuration = t.isSilence ? 0 : (t.weight / totalWeight) * block.duration;
        pageSegments.push({
          text: t.text,
          startTime: intraTime,
          duration: tokenDuration,
          isSilence: t.isSilence
        });
        intraTime += tokenDuration;
      }
    }

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