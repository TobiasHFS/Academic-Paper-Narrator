# Academic Narrator Development Notes

Notes on extraction, speech generation and possible improvements.

## Goal

Make the app feel less like a PDF summarizer and more like a skilled human academic reader:

- read the paper body close to verbatim
- skip layout artifacts, footnotes, headers, page numbers, and citation noise
- describe figures and dense tables briefly in context
- preserve equations, then add short intuition when the paper does not already explain them
- keep generated speech stable and smooth across long pages

## Current implementation

- Extraction now receives bounded previous/next page text snippets so the model can repair broken sentences across page boundaries without transcribing neighboring pages.
- The extraction prompt now explicitly rejects summary-style output and asks for brief figure/table interpretation after the relevant sentence is complete.
- Narration cleanup has been centralized in `services/narrationText.ts`.
- TTS input is converted into a more speakable form before synthesis, including common LaTeX-to-speech conversions and citation-cluster removal for audio.
- Long page narration is split into smaller TTS chunks and stitched with short pauses to reduce voice drift and speed-up.
- EPUB generation now escapes XML/HTML correctly and uses the same cleanup path as extraction.

## Possible improvements

1. Move Gemini calls behind a backend or serverless API.
   The browser currently needs an API key. For personal local use that may be acceptable, but any shared deployment should protect the key, enforce per-job limits, and store resumable job state.

2. Introduce a structured document model.
   Instead of treating each page as plain text, extract blocks like `body`, `heading`, `equation`, `figure`, `table`, `caption`, `footnote`, and `header`. The final narrator should assemble those blocks into a reading order before TTS.

3. Add a document-level reconciliation pass.
   After page extraction, run a cheap second pass over adjacent page endings/beginnings to fix duplicated text, dangling sentence starts, and page-break artifacts before audio generation.

4. Build an evaluation set.
   Keep 10-20 representative papers: two-column economics, STEM math-heavy papers, scanned papers, table-heavy papers, papers with appendices, and papers with unusual publisher layouts. Save expected snippets and score extraction quality after changes.

5. Improve math speech with a real math parser.
   The current LaTeX speech conversion is heuristic. A MathML/Speech Rule Engine path would produce better spoken equations while preserving rendered LaTeX in the transcript.

6. Add better audio alignment.
   Current seeking is heuristic plus silence detection. If the chosen TTS provider exposes timestamps later, use them. Until then, store chunk boundaries and sentence anchors explicitly.

7. Persist full sessions locally.
   Session export currently stores preferences, not generated page text/audio. IndexedDB persistence for transcripts, page images, and audio blobs would let users resume long papers without paying to regenerate everything.

8. Add provider/model abstraction.
   Keep the app from depending on one exact preview model name. Define `visionModel`, `textModel`, and `ttsModel` in one config file and surface compatibility warnings in the UI.

9. Add cost and quality controls.
   Give users presets: "fast draft", "balanced", and "best narration". Let those presets change render scale, extraction batch size, figure detail, math intuition, and TTS chunk size.

10. Add observability for failed pages.
    Store the raw page text, prompt metadata, model response, cleanup result, and error reason per page. That makes layout failures debuggable instead of mysterious.
