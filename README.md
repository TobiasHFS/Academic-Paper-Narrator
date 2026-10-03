# Academic Paper Narrator

Read academic PDFs as text or listen to narrated pages. Built with React and Google Gemini, with English and German output, formula display, page selection and EPUB export.

## Local setup

Requires Node.js 22.12 or newer.

```sh
npm ci
```

Copy `.env.example` to `.env.local` and add your Gemini API key.

```sh
npm run dev
```

Open the address printed by Vite. Use `npm run build` to check TypeScript and build the app.

## Before using it

Selected page text and images are sent to Gemini. Speech generation uses the same account and can incur API charges. The transcript and added explanations can contain errors, so keep the original paper available.

The API key runs in the browser. A build made with it contains the key, so keep this setup local. Hosting it for other people would require a backend to handle credentials.

`components/` contains the reading interface; `services/` handles PDFs, Gemini requests, EPUB export and local storage. The included voice samples are short generated previews. `scripts/generate-previews.mjs` can regenerate them using your API account.

[MIT license](LICENSE).
