# Academic Narrator

Academic Narrator is an intelligent research assistant that converts dense academic PDFs into high-quality narrated audio or cleaned, readable text. Leveraging Google Gemini's multimodal capabilities, it preserves the logical flow of papers by intelligently handling multi-column layouts, figures, and page-spanning sentences while skipping non-narrative elements like footnotes and headers.

## Key Features

- **Multimodal PDF Analysis**: Uses Gemini Vision to "see" the paper layout, ensuring correct reading order in complex academic formats.
- **Intelligent Text Stitching**: Automatically repairs sentences broken across page breaks and removes academic boilerplate.
- **Narrative Audio Synthesis**: Generates natural, high-fidelity narration using Gemini's latest TTS models.
- **Interactive Listening**: Smart-seek functionality allows you to double-click any word in the transcript to jump the audio to that exact moment.
- **Flexible Export**: Export cleaned transcripts as professional EPUB eBooks or download full-length WAV narrations.
- **Parallel Processing**: Concurrent background workers handle document processing while you listen.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- A Google Gemini API Key from [Google AI Studio](https://aistudio.google.com/)

### Installation

1. Clone the repository:

   ```bash
   git clone git@github.com:TobiasHFS/Academic-Paper-Narrator.git
   cd Academic-Paper-Narrator
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Configure your API key:
   Create a `.env` file in the root directory and add your key:

   ```env
   VITE_GEMINI_API_KEY=your_api_key_here
   ```

### Usage

Start the development server:

```bash
npm run dev
```

The application will be available at `http://localhost:5173`.

## Technical Architecture

The project is built with:

- **Frontend**: React, TypeScript, Tailwind CSS
- **AI Engine**: Google Gemini (Flash 1.5/2.0/3.0)
- **PDF Core**: PDF.js
- **State Management**: Concurrent Priority Queue for background processing

For a more detailed breakdown of the internal pipeline, see [TECHNICAL_README.md](TECHNICAL_README.md).

## License

This project is licensed under the MIT License.
