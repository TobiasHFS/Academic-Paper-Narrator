// We access the global pdfjsLib injected via script tag in index.html
declare global {
  interface Window {
    pdfjsLib: any;
  }
}

export const loadPdf = async (file: File): Promise<any> => {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
  return loadingTask.promise;
};

/**
 * Extracts raw text items from a PDF page.
 * Used for the "Text-First" hybrid approach to save bandwidth/time.
 */
export const extractPageText = async (pdfDoc: any, pageNumber: number): Promise<string> => {
  const page = await pdfDoc.getPage(pageNumber);
  const textContent = await page.getTextContent();
  // Join all text items with a space. This effectively flattens columns, 
  // so the LLM will need to reconstruct logical flow, which Gemini is good at.
  return textContent.items.map((item: any) => item.str).join(' ');
};

export const renderPageToImage = async (pdfDoc: any, pageNumber: number): Promise<string> => {
  const page = await pdfDoc.getPage(pageNumber);
  
  // Reduced scale from 1.5 to 1.2 to fix local lag issues.
  // 1.2 is still high enough for legible UI and OCR fallback if needed.
  const viewport = page.getViewport({ scale: 1.2 });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) throw new Error('Could not create canvas context');

  canvas.height = viewport.height;
  canvas.width = viewport.width;

  await page.render({
    canvasContext: context,
    viewport: viewport,
  }).promise;

  // Compress to JPEG with 0.7 quality
  return canvas.toDataURL('image/jpeg', 0.7);
};