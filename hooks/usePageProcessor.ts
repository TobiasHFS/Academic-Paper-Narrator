import { useState, useEffect, useRef } from 'react';
import { NarratedPage } from '../types';
import { renderPageToImage, extractPageText } from '../services/pdfService';
import { extractScriptBatch, synthesizeBatch } from '../services/geminiService';
import { ExtractionPageInput, cleanExtractedPageText, dedupePageStart } from '../services/narrationText';

interface UsePageProcessorProps {
    pdfDoc: any;
    currentPlayingPage: number;
    totalPages: number;
    processingMode: 'audio' | 'text';
    language: 'en' | 'de';
    selectedVoice?: string;
    selectedPages?: number[];  // Original PDF page numbers to process (if provided, maps virtual->real)
}

const MAX_EXTRACTION_WORKERS = 1;
const BATCH_SIZE_EXTRACTION = 1;
const MAX_SYNTHESIS_WORKERS = 1;

export function usePageProcessor({
    pdfDoc,
    currentPlayingPage,
    totalPages,
    processingMode,
    language,
    selectedVoice = 'Fenrir',
    selectedPages
}: UsePageProcessorProps) {
    // When selectedPages is provided, map virtual page index (1-based) to real PDF page number
    const getRealPageNum = (virtualPage: number): number => {
        if (!selectedPages) return virtualPage;
        return selectedPages[virtualPage - 1] ?? virtualPage;
    };
    const [pages, setPages] = useState<NarratedPage[]>([]);
    const [activeExtractionWorkers, setActiveExtractionWorkers] = useState(0);
    const [activeSynthesisWorkers, setActiveSynthesisWorkers] = useState(0);
    const [apiError, setApiError] = useState<string | undefined>(undefined);
    const [ttsUnavailable, setTtsUnavailable] = useState(false);

    // Create an abort controller that lives alongside the component instance
    const abortControllerRef = useRef(new AbortController());
    // Track pages already dispatched to workers so state-lag can't cause duplicate batches
    const dispatchedPagesRef = useRef<Set<number>>(new Set());
    const rawTextCacheRef = useRef<Map<number, string>>(new Map());

    // Abort all requests when the component unmounts (e.g., when 'X' is clicked returning to upload screen)
    useEffect(() => {
        const controller = new AbortController();
        abortControllerRef.current = controller;

        return () => {
            console.log("Canceling all pending API/TTS requests for closed document");
            controller.abort();
            // Clear dispatched set when document changes so tracking resets cleanly
            dispatchedPagesRef.current.clear();
            rawTextCacheRef.current.clear();
        };
    }, [pdfDoc]);

    // Initialize pages when totalPages changes
    // Setup initial pages with optional filtering
    useEffect(() => {
        if (totalPages > 0) {
            setPages(Array.from({ length: totalPages }, (_, i) => ({
                pageNumber: i + 1,
                originalText: '',
                status: 'pending'
            })));
            // Clear dispatched set when page list is re-initialized
            dispatchedPagesRef.current.clear();
            rawTextCacheRef.current.clear();
            setApiError(undefined);
            setTtsUnavailable(false);
        }
    }, [totalPages]);

    const updatePageStatus = (pageNum: number, status: NarratedPage['status'], errorMessage?: string) => {
        setPages(prev => {
            const copy = [...prev];
            if (copy[pageNum - 1]) {
                copy[pageNum - 1] = { ...copy[pageNum - 1], status, errorMessage };
            }
            return copy;
        });
    };

    const getNextTextStatus = (): NarratedPage['status'] =>
        processingMode === 'text' || ttsUnavailable ? 'ready' : 'extracted';

    const isQuotaError = (error: any): boolean => {
        const message = String(error?.message || error || '');
        return error?.status === 429 || /429|quota|rate limit|resource_exhausted|exceeded/i.test(message);
    };

    const getRawTextForPage = async (pageNum: number): Promise<string> => {
        if (!pdfDoc || pageNum < 1 || pageNum > totalPages) return "";

        const cached = rawTextCacheRef.current.get(pageNum);
        if (cached !== undefined) return cached;

        const realPageNum = getRealPageNum(pageNum);
        let rawText = "";
        try {
            rawText = await extractPageText(pdfDoc, realPageNum);
        } catch (e) {
            console.warn('Text extraction failed for page context', pageNum, e);
        }
        rawTextCacheRef.current.set(pageNum, rawText);
        return rawText;
    };

    const performBatchExtraction = async (pageNums: number[]) => {
        pageNums.forEach(p => updatePageStatus(p, 'analyzing'));

        // Hoist outside try  -  so catch block can access them for per-page retry
        const rawTextMap = new Map<number, string>();
        const batchPayload: ExtractionPageInput[] = [];

        try {

            // Serialize local PDF.js extractions to prevent web worker concurrent rendering deadlocks
            for (const pageNum of pageNums) {
                const realPageNum = getRealPageNum(pageNum);
                const rawText = await getRawTextForPage(pageNum);
                rawTextMap.set(pageNum, rawText);

                let img = pages[pageNum - 1]?.imageUrl;
                if (!img) {
                    try {
                        img = await renderPageToImage(pdfDoc, realPageNum);
                        setPages(prev => {
                            const copy = [...prev];
                            if (copy[pageNum - 1]) copy[pageNum - 1] = { ...copy[pageNum - 1], imageUrl: img };
                            return copy;
                        });
                    } catch (e) {
                        console.error('PDF.js Render failed for page', pageNum, e);
                    }
                }
                if (img) {
                    batchPayload.push({ pageNum, realPageNum, base64Image: img, rawText });
                } else if (rawText.trim()) {
                    const nextStatus = getNextTextStatus();
                    setPages(prev => {
                        const copy = [...prev];
                        if (copy[pageNum - 1] && copy[pageNum - 1].status === 'analyzing') {
                            const cleanedText = cleanExtractedPageText(rawText, { rawText, pageNum, realPageNum, source: 'raw' });
                            const text = dedupePageStart(copy[pageNum - 2]?.originalText, cleanedText);
                            copy[pageNum - 1] = {
                                ...copy[pageNum - 1],
                                originalText: text,
                                status: nextStatus,
                                errorMessage: 'PDF image rendering failed; using embedded PDF text instead.'
                            };
                        }
                        return copy;
                    });
                } else {
                    updatePageStatus(pageNum, 'error', 'PDF image rendering and embedded text extraction both failed.');
                }
            }

            if (batchPayload.length === 0) return;

            for (const payload of batchPayload) {
                payload.previousRawText = await getRawTextForPage(payload.pageNum - 1);
                payload.nextRawText = await getRawTextForPage(payload.pageNum + 1);
            }

            batchPayload.sort((a, b) => a.pageNum - b.pageNum);
            const resultsMap = await extractScriptBatch(batchPayload, language, abortControllerRef.current.signal);

            if (abortControllerRef.current.signal.aborted) return;

            setPages(prev => {
                const copy = [...prev];
                pageNums.forEach(pageNum => {
                    const idx = pageNum - 1;
                    if (copy[idx] && copy[idx].status === 'analyzing') {
                        const llmText = resultsMap.get(pageNum) || "";
                        const unverifiedText = llmText.trim() ? llmText : (rawTextMap.get(pageNum) || "");
                        const text = dedupePageStart(copy[idx - 1]?.originalText, unverifiedText);
                        const nextStatus = getNextTextStatus();
                        copy[idx] = { ...copy[idx], originalText: text, status: nextStatus, errorMessage: undefined };
                    }
                });
                return copy;
            });

        } catch (error: any) {
            if (error.name === "AbortError" || abortControllerRef.current.signal.aborted) {
                return; // Silently fail on abort, do not show error banner
            }
            console.warn('Batch extraction failed, retrying pages individually:', error.message || error);

            // Per-page retry: Don't let one problematic page crash its neighbors.
            // Try each page one at a time  -  most will succeed even if the batch failed.
            for (const pageNum of pageNums) {
                if (abortControllerRef.current.signal.aborted) return;

                const payload = batchPayload.find(p => p.pageNum === pageNum);
                if (!payload) continue; // Page had no image, already set to 'error'

                try {
                    const singleResult = await extractScriptBatch(
                        [payload], language, abortControllerRef.current.signal
                    );
                    const llmText = singleResult.get(pageNum) || "";
                    const unverifiedText = llmText.trim() ? llmText : (rawTextMap.get(pageNum) || "");
                    const nextStatus = getNextTextStatus();
                    setPages(prev => {
                        const copy = [...prev];
                        if (copy[pageNum - 1] && copy[pageNum - 1].status === 'analyzing') {
                            const text = dedupePageStart(copy[pageNum - 2]?.originalText, unverifiedText);
                            copy[pageNum - 1] = { ...copy[pageNum - 1], originalText: text, status: nextStatus, errorMessage: undefined };
                        }
                        return copy;
                    });
                } catch (retryErr: any) {
                    if (retryErr.name === "AbortError") return;
                    console.error(`Individual retry failed for page ${pageNum}:`, retryErr.message);
                    // Final fallback: use raw PDF.js text
                    const fallbackText = rawTextMap.get(pageNum) || "";
                    const nextStatus = getNextTextStatus();
                    setPages(prev => {
                        const copy = [...prev];
                        if (copy[pageNum - 1] && copy[pageNum - 1].status === 'analyzing') {
                            if (fallbackText.trim()) {
                                const realPageNum = getRealPageNum(pageNum);
                                const cleanedText = cleanExtractedPageText(fallbackText, { rawText: fallbackText, pageNum, realPageNum, source: 'raw' });
                                const text = dedupePageStart(copy[pageNum - 2]?.originalText, cleanedText);
                                copy[pageNum - 1] = {
                                    ...copy[pageNum - 1],
                                    originalText: text,
                                    status: nextStatus,
                                    errorMessage: `AI extraction failed; using embedded PDF text. ${retryErr.message || ''}`.trim()
                                };
                            } else {
                                copy[pageNum - 1] = {
                                    ...copy[pageNum - 1],
                                    status: 'error',
                                    errorMessage: retryErr.message || 'AI extraction failed and no embedded PDF text was available.'
                                };
                            }
                        }
                        return copy;
                    });
                    dispatchedPagesRef.current.delete(pageNum);
                }
            }
        }
    };

    const performBatchSynthesis = async (batchPages: NarratedPage[]) => {
        if (processingMode === 'text') return;

        const pageNums = batchPages.map(p => p.pageNumber);
        pageNums.forEach(p => updatePageStatus(p, 'synthesizing'));

        try {
            const input = batchPages.map(p => ({ pageNum: p.pageNumber, text: p.originalText }));
            const resultsMap = await synthesizeBatch(input, selectedVoice, abortControllerRef.current.signal);

            if (abortControllerRef.current.signal.aborted) return;

            setPages(prev => {
                const copy = [...prev];
                resultsMap.forEach((result, pageNum) => {
                    const idx = pageNum - 1;
                    if (copy[idx]) {
                        // Revoke the old audio blob URL before replacing it to prevent memory leaks
                        if (copy[idx].audioUrl?.startsWith('blob:')) {
                            URL.revokeObjectURL(copy[idx].audioUrl!);
                        }
                        copy[idx] = {
                            ...copy[idx],
                            audioUrl: result.audioUrl,
                            segments: result.segments,
                            status: 'ready'
                        };
                    }
                });
                return copy;
            });

        } catch (error: any) {
            if (error.name === "AbortError" || abortControllerRef.current.signal.aborted) {
                return; // Silently exit without causing errors on unmount
            }
            console.error(`Synthesis Batch error`, error);
            if (isQuotaError(error)) {
                setTtsUnavailable(true);
                setApiError("TTS quota/rate limit reached. Continuing in text-only mode for this document.");
                setPages(prev => prev.map(page => (
                    page.status === 'extracted' || page.status === 'synthesizing'
                        ? { ...page, status: 'ready', errorMessage: 'Audio generation skipped because the TTS quota/rate limit was reached.' }
                        : page
                )));
                return;
            }
            // IMPORTANT: Don't set to 'error'  -  synthesis failure should NOT hide
            // the perfectly good extracted text. Set to 'ready' so the text stays
            // visible; the user just won't have audio for these pages.
            pageNums.forEach(p => updatePageStatus(p, 'ready', error.message || 'Audio generation failed; text is still available.'));
        }
    };

    // Revoke all audio blob URLs when the component unmounts to prevent memory leaks
    useEffect(() => {
        return () => {
            setPages(prev => {
                prev.forEach(p => {
                    if (p.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(p.audioUrl);
                });
                return prev; // No state change needed, just cleanup side-effect
            });
        };
    }, []);

    // Manager 1: Extraction Pool
    useEffect(() => {
        if (!pdfDoc || pages.length === 0) return;

        if (activeExtractionWorkers < MAX_EXTRACTION_WORKERS) {
            const findBatchToExtract = (): number[] => {
                for (let i = currentPlayingPage; i <= totalPages; i++) {
                    if (pages[i - 1]?.status === 'pending' && !dispatchedPagesRef.current.has(i)) {
                        const batch = [i];
                        for (let j = 1; j < BATCH_SIZE_EXTRACTION; j++) {
                            const next = i + j;
                            if (next <= totalPages && pages[next - 1]?.status === 'pending' && !dispatchedPagesRef.current.has(next)) batch.push(next);
                            else break;
                        }
                        return batch;
                    }
                }
                for (let i = 1; i < currentPlayingPage; i++) {
                    if (pages[i - 1]?.status === 'pending' && !dispatchedPagesRef.current.has(i)) {
                        const batch = [i];
                        for (let j = 1; j < BATCH_SIZE_EXTRACTION; j++) {
                            const next = i + j;
                            if (next < currentPlayingPage && pages[next - 1]?.status === 'pending' && !dispatchedPagesRef.current.has(next)) batch.push(next);
                            else break;
                        }
                        return batch;
                    }
                }
                return [];
            };

            const batch = findBatchToExtract();
            if (batch.length > 0) {
                // Mark as dispatched synchronously BEFORE incrementing worker count,
                // so rapid re-runs of this effect (caused by state changes) don't pick the same pages
                batch.forEach(p => dispatchedPagesRef.current.add(p));
                setActiveExtractionWorkers(prev => prev + 1);
                performBatchExtraction(batch).finally(() => {
                    // Remove from dispatched set when done so retry logic can re-use them if needed
                    batch.forEach(p => dispatchedPagesRef.current.delete(p));
                    setActiveExtractionWorkers(prev => prev - 1);
                });
            }
        }
    }, [activeExtractionWorkers, pages, currentPlayingPage, totalPages, pdfDoc]);

    // Manager 2: Synthesis Pool
    useEffect(() => {
        if (!pdfDoc || pages.length === 0 || processingMode === 'text' || ttsUnavailable) return;

        if (activeSynthesisWorkers < MAX_SYNTHESIS_WORKERS) {
            const findBatchToSynth = (): NarratedPage[] | null => {
                let startIdx = -1;
                for (let i = currentPlayingPage - 1; i < totalPages; i++) {
                    if (pages[i].status === 'extracted') { startIdx = i; break; }
                }
                if (startIdx === -1) {
                    for (let i = 0; i < totalPages; i++) {
                        if (pages[i].status === 'extracted') { startIdx = i; break; }
                    }
                }

                if (startIdx === -1) return null;

                return [pages[startIdx]];
            };

            const batch = findBatchToSynth();
            if (batch && batch.length > 0) {
                setActiveSynthesisWorkers(prev => prev + 1);
                performBatchSynthesis(batch).finally(() => setActiveSynthesisWorkers(prev => prev - 1));
            }
        }
    }, [activeSynthesisWorkers, pages, currentPlayingPage, totalPages, pdfDoc, processingMode, ttsUnavailable]);

    return {
        pages,
        setPages,
        activeExtractionWorkers,
        activeSynthesisWorkers,
        apiError
    };
}
