# Academic Paper Narrator

> **Hey!** This is a side project where I'm experimenting with Google's [AntiGravity](https://blog.google/technology/google-deepmind/antigravity/) AI coding platform to see how far I can push it to build something actually useful for me. The entire codebase was built collaboratively with AI — I just love tinkering with new technology and seeing where it goes. Don't expect perfection, but it works surprisingly well!

## What is this?

A browser-based tool that turns academic PDFs into narrated audio. Upload a paper, and it uses Google Gemini to read it, clean up the text, and generate natural-sounding narration — all running in your browser.

It exists because I got tired of trying to read dense papers on screens and wanted something that could just *read them to me* properly, without mangling multi-column layouts or reading footnotes in the middle of sentences.

## What it does

- **Reads PDFs visually** — Uses Gemini's vision model to "see" the page layout instead of extracting raw text, so it handles multi-column papers, figures, and weird formatting without issues
- **Generates audio narration** — Turns the cleaned-up text into natural speech using Gemini's TTS models
- **Smart seeking** — Double-click any word in the transcript to jump the audio to that spot
- **Page pre-screening** — Automatically detects cover pages, table of contents, references, etc. and lets you choose which pages to process
- **Background processing** — Processes pages in parallel so you can start listening while the rest is still being prepared
- **Export options** — Download the full audio as WAV or export the cleaned text as an EPUB eBook
- **Save/load sessions** — Save your progress and come back to it later

## Tech stack

- React + TypeScript + Vite
- Google Gemini API (vision, text processing, TTS)
- PDF.js for rendering
- Tailwind CSS
- No backend — everything runs client-side

## Getting started

### You'll need

- [Node.js](https://nodejs.org/) (v18+)
- A [Google Gemini API key](https://aistudio.google.com/)

### Setup

```bash
git clone https://github.com/TobiasHFS/Academic-Paper-Narrator.git
cd Academic-Paper-Narrator
npm install
```

Create a `.env` file:

```env
VITE_GEMINI_API_KEY=your_api_key_here
```

### Run it

```bash
npm run dev
```

Then open `http://localhost:5173` in your browser.

There's also a `start.bat` if you're on Windows and just want to double-click something.

## How it works (roughly)

1. You upload a PDF
2. Each page gets rendered as an image
3. Gemini's vision model reads the page and extracts clean text (ignoring headers, footers, footnotes)
4. The text gets split into chunks and sent to Gemini's TTS model
5. Audio chunks get stitched together with timing data so seeking works
6. You listen, read along, or export

Pages are processed with a priority queue — the current page and the next couple get top priority, while the rest fills in the background.

## License

[MIT](LICENSE) — do whatever you want with it.
