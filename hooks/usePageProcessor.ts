import { useState, useEffect } from 'react';
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

    // Initialize pages when totalPages changes
    useEffect(() => {
        if (totalPages > 0) {
            setPages(Array.from({ length: totalPages }, (_, i) => ({
                pageNumber: i + 1,
                originalText: '',
                status: 'pending',
            })));
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
            await Promise.all(pageNums.map(async (pageNum) => {
                let rawText = "";
                try { rawText = await extractPageText(pdfDoc, pageNum); } catch (e) { }

                let img = pages[pageNum - 1]?.imageUrl;
                if (!img) {
                    try {
                        img = await renderPageToImage(pdfDoc, pageNum);
                        setPages(prev => {
                            const copy = [...prev];
                            if (copy[pageNum - 1]) copy[pageNum - 1] = { ...copy[pageNum - 1], imageUrl: img };
                            return copy;
                        });
                    } catch (e) { }
                }
                if (img) batchPayload.push({ pageNum, base64Image: img, rawText });
            }));

            if (batchPayload.length === 0) return;

            batchPayload.sort((a, b) => a.pageNum - b.pageNum);
            const resultsMap = await extractScriptBatch(batchPayload, language);

            setPages(prev => {
                const copy = [...prev];
                resultsMap.forEach((text, pageNum) => {
                    const idx = pageNum - 1;
                    if (copy[idx]) {
                        const nextStatus = processingMode === 'text' ? 'ready' : 'extracted';
                        if (!text.trim()) {
                            copy[idx] = { ...copy[idx], originalText: text, status: 'ready' };
                        } else {
                            copy[idx] = { ...copy[idx], originalText: text, status: nextStatus };
                        }
                    }
                });
                return copy;
            });

        } catch (error: any) {
            pageNums.forEach(p => updatePageStatus(p, 'error'));
        }
    };

    const performBatchSynthesis = async (batchPages: NarratedPage[]) => {
        if (processingMode === 'text') return;

        const pageNums = batchPages.map(p => p.pageNumber);
        pageNums.forEach(p => updatePageStatus(p, 'synthesizing'));

        try {
            const input = batchPages.map(p => ({ pageNum: p.pageNumber, text: p.originalText }));
            const resultsMap = await synthesizeBatch(input, selectedVoice);

            setPages(prev => {
                const copy = [...prev];
                resultsMap.forEach((result, pageNum) => {
                    const idx = pageNum - 1;
                    if (copy[idx]) {
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
            console.error(`Synthesis Batch error`, error);
            pageNums.forEach(p => updatePageStatus(p, 'error'));
        }
    };

    // Manager 1: Extraction Pool
    useEffect(() => {
        if (!pdfDoc || pages.length === 0) return;

        if (activeExtractionWorkers < MAX_EXTRACTION_WORKERS) {
            const findBatchToExtract = (): number[] => {
                for (let i = currentPlayingPage; i <= totalPages; i++) {
                    if (pages[i - 1]?.status === 'pending') {
                        const batch = [i];
                        for (let j = 1; j < BATCH_SIZE_EXTRACTION; j++) {
                            if (i + j <= totalPages && pages[i + j - 1]?.status === 'pending') batch.push(i + j);
                            else break;
                        }
                        return batch;
                    }
                }
                for (let i = 1; i < currentPlayingPage; i++) {
                    if (pages[i - 1]?.status === 'pending') {
                        const batch = [i];
                        for (let j = 1; j < BATCH_SIZE_EXTRACTION; j++) {
                            if (i + j < currentPlayingPage && pages[i + j - 1]?.status === 'pending') batch.push(i + j);
                            else break;
                        }
                        return batch;
                    }
                }
                return [];
            };

            const batch = findBatchToExtract();
            if (batch.length > 0) {
                setActiveExtractionWorkers(prev => prev + 1);
                performBatchExtraction(batch).finally(() => setActiveExtractionWorkers(prev => prev - 1));
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
        activeSynthesisWorkers
    };
}
