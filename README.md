# Academic Paper Narrator

A local React app that turns PDF pages into narration using Google Gemini. It supports English and German, formula display, page selection, audio playback and EPUB export.

This is a personal reading tool under development. Generated text can omit or misread content, and added explanations may be wrong. Check the original paper when accuracy matters.

## Run locally

Use Node.js 22.12 or newer and npm.

```sh
npm ci
```

Copy `.env.example` to `.env.local`, add your own Gemini API key, then run:

```sh
npm run dev
```

Open the local address printed by Vite. `npm run build` checks TypeScript and creates a local build.

## Data and API key

Selected page text or page images are sent to Google Gemini for processing. Narration text is also sent for speech generation. Use documents you have permission to process with that service. Requests use your account and may incur charges.

The key is used by browser code. Vite embeds `VITE_` variables in builds, so a build made with your key exposes it to anyone receiving that build. Keep this setup for personal local use. Do not publish a build with a personal or shared API key. A hosted version needs server-side credentials and access controls.

Session exports may contain paper text and generated audio. They belong outside this source repository. The included voice previews are short generated sample phrases, not uploaded papers.

## Code

- `components/`: reading and playback interface
- `hooks/usePageProcessor.ts`: processing queue
- `services/`: PDF handling, Gemini requests, EPUB export and local storage
- `scripts/generate-previews.mjs`: optional sample generation using your API account

MIT licensed. Third-party packages retain their own licenses.
