import React, { useRef, useEffect } from 'react';
import { FileText, Loader, Sparkles, AlertCircle } from 'lucide-react';
import { NarratedPage } from '../types';
import katex from 'katex';

interface ScriptViewProps {
    currentPageData: NarratedPage | undefined;
    processingMode: 'audio' | 'text';
    currentTime: number;
    apiError?: string;
    onWordDoubleClick: (index: number) => void;
}

/**
 * Parse text into segments of plain text and LaTeX math.
 * Supports $$...$$ (display) and $...$ (inline).
 */
function parseMathSegments(text: string): { type: 'text' | 'display-math' | 'inline-math'; content: string }[] {
    const segments: { type: 'text' | 'display-math' | 'inline-math'; content: string }[] = [];
    // Regex matches $$...$$ first (display), then $...$ (inline)
    const mathRegex = /\$\$([^$]+?)\$\$|\$([^$\n]+?)\$/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = mathRegex.exec(text)) !== null) {
        // Add any text before this match
        if (match.index > lastIndex) {
            segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
        }
        if (match[1] !== undefined) {
            segments.push({ type: 'display-math', content: match[1] });
        } else if (match[2] !== undefined) {
            segments.push({ type: 'inline-math', content: match[2] });
        }
        lastIndex = match.index + match[0].length;
    }
    // Add remaining text
    if (lastIndex < text.length) {
        segments.push({ type: 'text', content: text.slice(lastIndex) });
    }
    return segments;
}

/**
 * Render a string that may contain LaTeX math into React elements.
 */
function renderMathInText(text: string): React.ReactNode[] {
    const segments = parseMathSegments(text);
    return segments.map((seg, i) => {
        if (seg.type === 'text') {
            return <span key={i}>{seg.content}</span>;
        }
        try {
            const html = katex.renderToString(seg.content, {
                throwOnError: false,
                displayMode: seg.type === 'display-math',
                output: 'html',
            });
            if (seg.type === 'display-math') {
                return <div key={i} className="my-3 overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />;
            }
            return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
        } catch {
            // Fallback: show raw math if KaTeX fails
            return <code key={i} className="text-sm bg-slate-100 px-1 rounded">{seg.type === 'display-math' ? `$$${seg.content}$$` : `$${seg.content}$`}</code>;
        }
    });
}

export const ScriptView: React.FC<ScriptViewProps> = ({
    currentPageData,
    processingMode,
    currentTime,
    apiError,
    onWordDoubleClick
}) => {
    const activeWordRef = useRef<HTMLSpanElement>(null);
    const activeIndexRef = useRef<number>(-1);

    // Auto-scroll to active word
    useEffect(() => {
        if (!currentPageData?.segments || processingMode === 'text') return;

        // Find current active index
        const activeIndex = currentPageData.segments.findIndex(s =>
            currentTime >= s.startTime && currentTime < (s.startTime + s.duration) && !s.isSilence
        );

        // Only scroll if we exist, and index changed
        if (activeIndex !== -1 && activeWordRef.current && activeIndex !== activeIndexRef.current) {
            activeIndexRef.current = activeIndex;

            activeWordRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'nearest'
            });
        }
    }, [currentTime, currentPageData, processingMode]);

    const renderTextWithEvents = (text: string) => {
        if (processingMode === 'text' || !currentPageData?.segments) {
            return <span className="text-slate-700">{renderMathInText(text)}</span>;
        }

        // Fallback for old sessions that only have 1 segment per page
        if (currentPageData.segments.length <= 1) {
            return <span className="text-slate-700">{renderMathInText(text)}</span>;
        }

        return currentPageData.segments.map((segment, index) => {
            const isActive = currentTime >= segment.startTime && currentTime < (segment.startTime + segment.duration);
            const isWhitespace = segment.isSilence || !segment.text.trim();

            if (isWhitespace) {
                return <span key={index}>{segment.text}</span>;
            }

            // Check if this segment's text contains LaTeX
            const hasMath = segment.text.includes('$');

            return (
                <span
                    key={index}
                    ref={isActive ? activeWordRef : null}
                    onDoubleClick={() => onWordDoubleClick(index)}
                    className={`cursor-pointer hover:underline decoration-indigo-300 underline-offset-4 transition-colors duration-200 rounded px-0.5 mx-0 -my-0.5 ${isActive ? 'bg-indigo-100/80 text-indigo-950 font-medium shadow-[inset_0_-2px_0_theme(colors.indigo.400)]' : 'text-slate-700'}`}
                >
                    {hasMath ? renderMathInText(segment.text) : segment.text}
                </span>
            );
        });
    };

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col relative">
            {apiError && (
                <div className="absolute top-0 left-0 right-0 z-20 bg-red-500 text-white px-4 py-2 text-sm font-medium flex items-center justify-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    {apiError}
                </div>
            )}
            <div className={`p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 ${apiError ? 'mt-9' : ''}`}>
                <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-indigo-500" />Narrative Script
                </h2>
                <span className={`text-xs px-2 py-1 rounded-full border ${currentPageData?.status === 'ready' ? 'bg-green-50 text-green-700 border-green-200' : currentPageData?.status === 'synthesizing' ? 'bg-purple-50 text-purple-700 border-purple-200' : currentPageData?.status === 'extracted' ? 'bg-blue-50 text-blue-700 border-blue-200' : currentPageData?.status === 'analyzing' ? 'bg-orange-50 text-orange-700 border-orange-200' : currentPageData?.status === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                    {currentPageData?.status === 'ready' ? 'Ready' : currentPageData?.status === 'synthesizing' ? 'Speaking...' : currentPageData?.status === 'extracted' ? 'Text Ready' : currentPageData?.status === 'analyzing' ? 'Reading...' : currentPageData?.status === 'error' ? 'Error' : 'Pending'}
                </span>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4 relative scroll-smooth">
                {(currentPageData?.status === 'analyzing' || currentPageData?.status === 'synthesizing' || currentPageData?.status === 'extracted') && !currentPageData.originalText && (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                        <Loader className="w-8 h-8 animate-spin text-indigo-500" />
                        <div className="text-center">
                            <p>{currentPageData?.status === 'analyzing' ? 'Batch Processing Pages...' : 'Queued for audio...'}</p>
                            <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">High-speed mode active</p>
                        </div>
                    </div>
                )}
                {(currentPageData?.status === 'synthesizing' || currentPageData?.status === 'extracted') && currentPageData.originalText && (
                    <div className="relative">
                        {processingMode === 'audio' && (
                            <div className="absolute inset-0 bg-white/50 z-10 flex items-start justify-center pt-20 backdrop-blur-[1px]">
                                <div className="bg-white px-4 py-2 rounded-full shadow-lg border border-indigo-100 flex items-center gap-2">
                                    <Sparkles className="w-4 h-4 text-purple-500 animate-pulse" />
                                    <span className="text-sm font-medium text-slate-700">Generating audio...</span>
                                </div>
                            </div>
                        )}
                        <div className={`prose prose-slate max-w-none ${processingMode === 'audio' ? 'opacity-50' : ''}`}>
                            <div className="font-serif text-lg leading-relaxed text-slate-800 whitespace-pre-wrap">{renderMathInText(currentPageData.originalText)}</div>
                        </div>
                    </div>
                )}
                {currentPageData?.status === 'error' && (
                    <div className="flex flex-col items-center justify-center h-full text-red-500 gap-2 p-8 text-center">
                        <AlertCircle className="w-8 h-8" />
                        <p>An error occurred processing this page.</p>
                    </div>
                )}
                {currentPageData?.status === 'ready' && currentPageData?.originalText && (
                    <div className="prose prose-slate max-w-none">
                        <div className="font-serif text-lg leading-relaxed text-slate-800 whitespace-pre-wrap">
                            {renderTextWithEvents(currentPageData.originalText)}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

