import { useState, useEffect, useRef } from 'react';
import { NarratedPage } from '../types';
import { renderPageToImage, extractPageText } from '../services/pdfService';
import { extractScriptBatch, synthesizeBatch } from '../services/geminiService';

interface UsePageProcessorProps {
    pdfDoc: any;
    currentPlayingPage: number;
    totalPages: number;
    processingMode: 'audio' | 'text';
    language: 'en' | 'de';
    selectedVoice?: string;
}

const MAX_EXTRACTION_WORKERS = 3;
const BATCH_SIZE_EXTRACTION = 3;
const MAX_SYNTHESIS_WORKERS = 3;
const MAX_TTS_CHARS_PER_BATCH = 4500;

export function usePageProcessor({
    pdfDoc,
    currentPlayingPage,
    totalPages,
    processingMode,
    language,
    selectedVoice = 'Fenrir'
}: UsePageProcessorProps) {
    const [pages, setPages] = useState<NarratedPage[]>([]);
    const [activeExtractionWorkers, setActiveExtractionWorkers] = useState(0);
    const [activeSynthesisWorkers, setActiveSynthesisWorkers] = useState(0);
    const [apiError, setApiError] = useState<string | undefined>(undefined);

    // Create an abort controller that lives alongside the component instance
    const abortControllerRef = useRef(new AbortController());
    // Track pages already dispatched to workers so state-lag can't cause duplicate batches
    const dispatchedPagesRef = useRef<Set<number>>(new Set());

    // Abort all requests when the component unmounts (e.g., when 'X' is clicked returning to upload screen)
    useEffect(() => {
        const controller = new AbortController();
        abortControllerRef.current = controller;

        return () => {
            console.log("Canceling all pending API/TTS requests for closed document");
            controller.abort();
            // Clear dispatched set when document changes so tracking resets cleanly
            dispatchedPagesRef.current.clear();
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
        }
    }, [totalPages]);

    const updatePageStatus = (pageNum: number, status: NarratedPage['status']) => {
        setPages(prev => {
            const copy = [...prev];
            if (copy[pageNum - 1]) copy[pageNum - 1] = { ...copy[pageNum - 1], status };
            return copy;
        });
    };

    const performBatchExtraction = async (pageNums: number[]) => {
        pageNums.forEach(p => updatePageStatus(p, 'analyzing'));

        try {
            const batchPayload: { pageNum: number; base64Image: string; rawText: string }[] = [];
            // Keep a rawText map as fallback when LLM returns empty (e.g. math-heavy pages)
            const rawTextMap = new Map<number, string>();

            // Serialize local PDF.js extractions to prevent web worker concurrent rendering deadlocks
            for (const pageNum of pageNums) {
                let rawText = "";
                try { rawText = await extractPageText(pdfDoc, pageNum); } catch (e) { console.warn('Text fallthrough', e); }
                rawTextMap.set(pageNum, rawText);

                let img = pages[pageNum - 1]?.imageUrl;
                if (!img) {
                    try {
                        img = await renderPageToImage(pdfDoc, pageNum);
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
                    batchPayload.push({ pageNum, base64Image: img, rawText });
                } else {
                    // Update this specific page to error so it doesn't hang in 'analyzing'
                    updatePageStatus(pageNum, 'error');
                }
            }

            if (batchPayload.length === 0) return;

            batchPayload.sort((a, b) => a.pageNum - b.pageNum);
            const resultsMap = await extractScriptBatch(batchPayload, language, abortControllerRef.current.signal);

            if (abortControllerRef.current.signal.aborted) return;

            setPages(prev => {
                const copy = [...prev];
                pageNums.forEach(pageNum => {
                    const idx = pageNum - 1;
                    if (copy[idx] && copy[idx].status === 'analyzing') {
                        const llmText = resultsMap.get(pageNum) || "";
                        // If LLM returned empty, fall back to raw PDF.js text
                        // (common on math-heavy pages where LLM outputs [[EMPTY]])
                        const text = llmText.trim() ? llmText : (rawTextMap.get(pageNum) || "");
                        const nextStatus = processingMode === 'text' ? 'ready' : 'extracted';
                        copy[idx] = { ...copy[idx], originalText: text, status: nextStatus };
                    }
                    // If status is already 'ready'/'extracted' (written by a faster worker), skip.
                });
                return copy;
            });

        } catch (error: any) {
            if (error.name === "AbortError" || abortControllerRef.current.signal.aborted) {
                return; // Silently fail on abort, do not show error banner
            }
            if (error.status === 429 || error.message?.includes('429')) {
                setApiError("Daily API Limit Reached (429 Quota Exceeded). Please try again tomorrow or upgrade your AI Studio tier.");
            }
            pageNums.forEach(p => {
                updatePageStatus(p, 'error');
                dispatchedPagesRef.current.delete(p);
            });
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
            if (error.status === 429 || error.message?.includes('429')) {
                setApiError("Daily TTS Audio Limit Reached (429 Quota Exceeded). Please try again tomorrow or upgrade your AI Studio tier.");
            }
            // IMPORTANT: Don't set to 'error' — synthesis failure should NOT hide
            // the perfectly good extracted text. Set to 'ready' so the text stays
            // visible; the user just won't have audio for these pages.
            pageNums.forEach(p => updatePageStatus(p, 'ready'));
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
        if (!pdfDoc || pages.length === 0 || processingMode === 'text') return;

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

                const batch: NarratedPage[] = [];
                let currentChars = 0;

                for (let i = startIdx; i < totalPages; i++) {
                    const p = pages[i];
                    if (p.status !== 'extracted') break;
                    const len = p.originalText.length;
                    if (batch.length === 0) {
                        batch.push(p);
                        currentChars += len;
                        if (currentChars >= MAX_TTS_CHARS_PER_BATCH) break;
                    } else {
                        if (currentChars + len <= MAX_TTS_CHARS_PER_BATCH) {
                            batch.push(p);
                            currentChars += len;
                        } else {
                            break;
                        }
                    }
                }
                return batch;
            };

            const batch = findBatchToSynth();
            if (batch && batch.length > 0) {
                setActiveSynthesisWorkers(prev => prev + 1);
                performBatchSynthesis(batch).finally(() => setActiveSynthesisWorkers(prev => prev - 1));
            }
        }
    }, [activeSynthesisWorkers, pages, currentPlayingPage, totalPages, pdfDoc, processingMode]);

    return {
        pages,
        setPages,
        activeExtractionWorkers,
        activeSynthesisWorkers,
        apiError
    };
}
