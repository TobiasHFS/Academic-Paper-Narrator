import JSZip from 'jszip';
import { NarratedPage } from '../types';

/**
 * "Stitches" the text from multiple pages into one continuous stream,
 * intelligently repairing sentences broken across pages.
 */
export const cleanAndStitchText = (pages: NarratedPage[]): string => {
  const sortedPages = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);

  // 1. Combine all pages, but DO NOT use double newlines blindly.
  // We need to check the boundary between Page N and Page N+1.

  let fullText = "";

  for (let i = 0; i < sortedPages.length; i++) {
    let currentText = sortedPages[i].originalText.trim();

    // Skip empty pages
    if (!currentText) continue;

    if (i < sortedPages.length - 1) {
      const nextText = sortedPages[i + 1].originalText.trim();

      // LOGIC: Repair broken sentences.
      // Condition: Current page does NOT end with sentence punctuation (. ! ? :)
      // AND Next page starts with a lowercase letter or a generic character that indicates continuation.

      const endsWithSentenceStopper = /[.!?:]['"]?$/.test(currentText);
      const endsWithHyphen = /-$/.test(currentText);

      // Look at the first character of the next page
      const nextStartsLowerCase = /^[a-z]/.test(nextText);

      if (endsWithHyphen) {
        // "Soft-" + "facts" -> "Softfacts" (or "Soft facts" depending on hyphen type, but usually delete hyphen if newline)
        // Standard English rule: hyphen at line end usually means word break.
        // We replace the trailing hyphen with nothing, and join.
        currentText = currentText.slice(0, -1); // remove hyphen
        // Add nothing (join directly)
      } else if (!endsWithSentenceStopper && nextStartsLowerCase) {
        // "on soft" + "facts" -> "on soft facts"
        // Join with a single space, NO newline.
        currentText += " ";
      } else {
        // Standard paragraph or page separation.
        // Use double newline to preserve paragraph structure.
        currentText += "\n\n";
      }
    }

    fullText += currentText;
  }

  // 2. Final cleanup of any lingering "--- Page X ---" artifacts if the AI hallucinated them inside the text.
  fullText = fullText.replace(/--- Page \d+ ---/g, "");

  return fullText;
};

/**
 * Converts Markdown headings to HTML for the EPUB.
 */
const markdownToHtml = (text: string): string => {
  return text
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n\n/g, '</p><p>') // Basic paragraph conversion
    .replace(/\n/g, ' '); // Soft wraps become spaces within paragraphs
};

/**
 * Generates an EPUB file blob.
 */
export const generateEpub = async (fileName: string, pages: NarratedPage[], language: 'en' | 'de' = 'en'): Promise<Blob> => {
  const zip = new JSZip();
  const cleanText = cleanAndStitchText(pages);
  const htmlContent = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${fileName}</title>
  <style>
    body { font-family: serif; line-height: 1.5; margin: 2em; }
    h1 { text-align: center; margin-bottom: 1em; }
    h2 { margin-top: 1.5em; border-bottom: 1px solid #ccc; }
    p { margin-bottom: 1em; text-align: justify; }
  </style>
</head>
<body>
  <h1>${fileName}</h1>
  <p>${markdownToHtml(cleanText)}</p>
</body>
</html>`;

  // 1. mimetype (must be first, uncompressed)
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  // 2. Container
  zip.folder("META-INF")?.file("container.xml", `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
    </rootfiles>
</container>`);

  // 3. OEBPS Folder
  const oebps = zip.folder("OEBPS");

  // Content
  oebps?.file("content.xhtml", htmlContent);

  // Package Definition (OPF)
  oebps?.file("content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>${fileName}</dc:title>
        <dc:language>${language}</dc:language>
        <dc:identifier id="BookId">urn:uuid:${crypto.randomUUID()}</dc:identifier>
    </metadata>
    <manifest>
        <item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    </manifest>
    <spine toc="ncx">
        <itemref idref="content"/>
    </spine>
</package>`);

  // Table of Contents (NCX) - Basic Implementation
  oebps?.file("toc.ncx", `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
    <head>
        <meta name="dtb:uid" content="urn:uuid:12345"/>
        <meta name="dtb:depth" content="1"/>
        <meta name="dtb:totalPageCount" content="0"/>
        <meta name="dtb:maxPageNumber" content="0"/>
    </head>
    <docTitle><text>${fileName}</text></docTitle>
    <navMap>
        <navPoint id="navPoint-1" playOrder="1">
            <navLabel><text>Start</text></navLabel>
            <content src="content.xhtml"/>
        </navPoint>
    </navMap>
</ncx>`);

  return await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
};