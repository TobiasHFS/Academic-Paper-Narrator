# Academic Narrator - Technical Documentation

## Architecture Overview

The application is a **Single Page Application (SPA)** built with React, TypeScript, and Tailwind CSS. It operates primarily client-side but relies on Google Gemini API for heavy AI processing (Vision and Text-to-Speech).

### Data Flow Pipeline

1. **Input**: User uploads a PDF.
2. **PDF Parsing (Client-side)**:
    - `pdf.js` runs in the browser.
    - It rasterizes each PDF page into a high-resolution `canvas` element.
    - These canvases are converted to JPEG blobs (`services/pdfService.ts`).
3. **Vision Analysis (Gemini 1.5/3 Flash)**:
    - The JPEG image is sent to the multimodal model.
    - **Prompt Engineering**: The prompt instructs the model to ignore footnotes/headers and describe visuals contextually (`services/geminiService.ts`).
    - **Output**: Cleaned, narrative-ready text string.
4. **Audio Synthesis (Gemini 2.5 Flash TTS)**:
    - **Splitting**: To prevent TTS tone drift and speed-up, text is split into chunks of max 1000 characters, respecting paragraph boundaries.
    - **Parallel Processing**: Each chunk is sent to `gemini-2.5-flash-preview-tts` *simultaneously* via `Promise.all`.
    - **Retry Logic**: Includes exponential backoff to handle rate limits or "empty response" errors.
    - **Stitching**: The resulting raw PCM audio chunks are concatenated into a single buffer.
    - **Mapping**: A map of `[Segment Text -> Start Time]` is created.
    - **Output**: A single WAV Blob URL + Timing Metadata.
5. **Background Processing (Queue Manager)**:
    - Instead of a simple sliding window, the app uses a **Concurrent Priority Queue** managed in `App.tsx`.
    - **Workers**: Up to **3 pages** are processed simultaneously to maximize throughput without hitting rate limits.
    - **Priority Logic**:
        1. **High Priority**: The page currently being listened to + the next 2 pages (Buffer).
        2. **Background Priority**: The first unprocessed page in the document (Linear fill).
    - This allows the user to listen immediately while the rest of the document prepares for export in the background.

## Key Technical Decisions

### 1. Seeking Accuracy & TTS Stability

**Challenge**: Simple character-count heuristics drift significantly over long texts. Furthermore, generating >2 minutes of continuous TTS often causes the model to speed up unnaturally or change tone.
**Solution**: **Paragraph-Based Segmentation & 1000-Char Chunking**.

- By splitting the page into smaller chunks (max 1000 chars) during synthesis, we force the TTS model to "reset" its prosody, maintaining a consistent reading speed and tone.
- When a user double-clicks a word, we identify which paragraph it belongs to and apply the heuristic *only* within that paragraph.
- **Result**: The accumulated error resets to zero at every new paragraph, keeping seeking accurate to within ~0.2s, and the voice remains stable.

### 2. PDF Rendering (Vision vs Text Extraction)

- **Why Vision?**: Academic papers often have multi-column layouts, sidebars, and footnotes. Standard PDF text extraction libraries (like `pdf.js` text layer) often mangle the reading order (reading across columns) or interleave footnotes with body text.
- **Approach**: By rendering the page as an image and sending it to a Multimodal AI (`gemini-3-flash-preview`), we allow the model to "see" the layout. It can spatially distinguish between the main body text, the sidebar, and the footer, ensuring a coherent narrative flow.
- **Optimization**: We render PDF pages at `scale: 1.5`. This reduces the payload size sent to the Vision API significantly while maintaining legibility for OCR.

### 3. Audio Stitching & EPUB Export

- **Audio Export**: When the user downloads the full audio, we concatenate multiple WAV files by stripping the 44-byte WAV header from all files *except the first*, concatenating the raw PCM data, and rewriting the RIFF header.
- **EPUB Export**: In "Text-Only" mode, the app uses `jszip` to generate a valid EPUB 3.0 file. It intelligently stitches text across page boundaries (e.g., removing trailing hyphens, joining broken sentences) before converting the Markdown output to HTML.

## State Management (`App.tsx`)

- `pages` State: An array of `NarratedPage` objects.
  - `status`: 'pending' -> 'analyzing' -> 'extracted' -> 'synthesizing' -> 'ready'.
  - `segments`: Contains the timing data for seeking.
- `activeWorkers`: Integer tracking how many async operations are currently running. Used to enforce the concurrency limit.
- `playbackState`: 'IDLE' | 'BUFFERING' | 'PLAYING' | 'PAUSED'.
- `processingMode`: 'audio' | 'text'. Toggles whether the app proceeds to TTS synthesis or stops at text extraction.
