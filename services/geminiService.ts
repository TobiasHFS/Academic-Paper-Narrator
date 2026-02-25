import { GoogleGenAI, Modality } from "@google/genai";
import { AudioSegment } from "../types";

// Initialize the client
const getAIClient = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

const getSystemInstruction = (language: 'en' | 'de') => {
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

  // DEFAULT: ENGLISH
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

/**
 * SMART REQUEST SCHEDULER
 * Prevents "Thundering Herd" issues where parallel workers trigger rate limits (429).
 */
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

async function generateTtsWithRetry(ai: any, text: string): Promise<Uint8Array> {
  let attempt = 0;
  while (true) {
    try {
      const res = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            // "Fenrir" is the intended deep, masculine, 'Kurzgesagt-like' voice.
            // If this sounded female before, it was likely an API fallback to 'Zephyr'.
            // We force it here.
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } },
          },
        },
      });

      const base64 = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64) throw new Error("Empty audio response.");
      return decode(base64);
    } catch (e: any) {
      const isQuota = e.message?.includes('429') || e.status === 429;
      const isOverloaded = e.status === 503 || e.message?.includes('503') || e.message?.includes('overloaded');
      
      if (isQuota || isOverloaded) {
        const waitTime = 10000 + (Math.random() * 5000);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        attempt++;
        if (attempt > 200) throw e; 
      } else {
        if (attempt >= 3) throw e;
        await new Promise(resolve => setTimeout(resolve, 2000 * Math.pow(2, attempt)));
        attempt++;
      }
    }
  }
}

/**
 * BATCH HYBRID EXTRACTOR
 */
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
      const text = response.text || "";
      if (!text.trim() && attempt < 3) throw new Error("Model returned empty text");
      return text;
    } catch (error: any) {
      const isQuota = error.message?.includes('429') || error.status === 429;
      const isOverloaded = error.status === 503 || error.message?.includes('503') || error.message?.includes('overloaded');

      if (isQuota || isOverloaded) {
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
 * BATCH SYNTHESIS
 * Consolidates text from multiple pages (up to 4500 chars) into a single TTS request.
 */
export const synthesizeBatch = async (pages: { pageNum: number; text: string }[]): Promise<Map<number, { audioUrl: string, segments: AudioSegment[] }>> => {
  const ai = getAIClient();
  
  // Combine text from all pages
  const combinedText = pages.map(p => p.text).join("\n\n");
  
  // Max output for Flash Audio is ~8k tokens (~5 mins). 
  // However, to prevent "speeding up" or tone drift over long generations,
  // we enforce a much smaller chunk size (approx 45-60 seconds).
  const SAFE_MAX_CHARS = 1000; 

  const chunksToSynthesize: string[] = [];
  
  // Split by paragraphs to ensure natural breaks
  const paragraphs = combinedText.split(/\n\s*\n/);
  let currentChunk = "";

  for (const para of paragraphs) {
     if (!para.trim()) continue;
     
     // If adding this paragraph exceeds limit, push current chunk and start new
     if (currentChunk.length > 0 && (currentChunk.length + para.length + 2) > SAFE_MAX_CHARS) {
        chunksToSynthesize.push(currentChunk);
        currentChunk = para;
     } else {
        currentChunk = currentChunk ? currentChunk + "\n\n" + para : para;
     }
  }
  if (currentChunk) chunksToSynthesize.push(currentChunk);

  try {
    const audioBlobs: Uint8Array[] = await Promise.all(
        chunksToSynthesize.map(chunk => ttsScheduler.add(() => generateTtsWithRetry(ai, chunk)))
    );

    // Stitch audio if multiple chunks (rare in this new design)
    const totalLength = audioBlobs.reduce((acc, chunk) => acc + chunk.length, 0);
    const stitchedPcm = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of audioBlobs) {
      stitchedPcm.set(chunk, offset);
      offset += chunk.length;
    }

    const finalAudioUrl = URL.createObjectURL(createWavBlob(stitchedPcm, 24000));
    const BYTES_PER_SECOND = 24000 * 2;
    const totalDuration = totalLength / BYTES_PER_SECOND;

    // Distribute results back to pages
    const resultMap = new Map<number, { audioUrl: string, segments: AudioSegment[] }>();
    
    // We need to calculate segments for the *combined* text to know where each page starts
    // Simple heuristic mapping: Proportional length
    let currentStartTime = 0;
    
    pages.forEach(p => {
       const ratio = p.text.length / combinedText.length;
       const duration = ratio * totalDuration;
       
       // Create segments for this page (Relative to the shared audio file)
       // We create a "Virtual" segment list.
       // Note: The UI player will play the WHOLE file from `startTime`. 
       // If P2 starts at 30s, we need to make sure the segment timestamps reflect 30s+.
       
       const pageSegments: AudioSegment[] = [];
       // Granular segments for seeking within the page
       const parts = p.text.split(/(\n\s*\n)/).filter(x => x.trim());
       let localOffset = 0;
       
       parts.forEach(part => {
           const partRatio = part.length / p.text.length;
           const partDuration = partRatio * duration;
           pageSegments.push({
               text: part,
               startTime: currentStartTime + localOffset,
               duration: partDuration,
               isSilence: false
           });
           localOffset += partDuration;
       });

       resultMap.set(p.pageNum, {
           audioUrl: finalAudioUrl,
           segments: pageSegments
       });
       
       currentStartTime += duration;
    });

    return resultMap;

  } catch (error) {
    console.error("Batch Synthesis error:", error);
    throw error;
  }
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