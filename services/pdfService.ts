// We access the global pdfjsLib injected via script tag in index.html
declare global {
  interface Window {
    pdfjsLib: any;
  }
}

export const loadPdf = async (file: File | Uint8Array): Promise<any> => {
  const data = file instanceof Uint8Array ? file : await file.arrayBuffer();
  const loadingTask = window.pdfjsLib.getDocument({ data });
  return loadingTask.promise;
};

// Global mutex to serialize PDF.js render operations.
// PDF.js uses a single internal web worker per document — concurrent page.render()
// calls from multiple extraction workers can deadlock or corrupt the output.
let renderLock: Promise<void> = Promise.resolve();
const acquireRenderLock = (): Promise<() => void> => {
  let release: () => void;
  const prev = renderLock;
  renderLock = new Promise(resolve => { release = resolve; });
  return prev.then(() => release!);
};

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> => {
  let timeoutHandle: any;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });
  return Promise.race([
    promise.finally(() => clearTimeout(timeoutHandle)),
    timeoutPromise
  ]);
};

/**
 * Extracts raw text items from a PDF page.
 * Used for the "Text-First" hybrid approach to save bandwidth/time.
 */
export const extractPageText = async (pdfDoc: any, pageNumber: number): Promise<string> => {
  const release = await acquireRenderLock();
  try {
    const page = await pdfDoc.getPage(pageNumber);
    const textContent = await withTimeout<any>(
      page.getTextContent(),
      10000,
      `Timeout extracting text for page ${pageNumber}`
    );
    return textContent.items.map((item: any) => item.str).join(' ');
  } finally {
    release();
  }
};

export const renderPageToImage = async (pdfDoc: any, pageNumber: number): Promise<string> => {
  const release = await acquireRenderLock();
  try {
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.2 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) throw new Error('Could not create canvas context');

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await withTimeout(
      page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise,
      15000,
      `Timeout rendering image for page ${pageNumber}`
    );

    return canvas.toDataURL('image/jpeg', 0.7);
  } finally {
    release();
  }
};