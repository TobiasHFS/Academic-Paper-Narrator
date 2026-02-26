import React from 'react';
import { Loader } from 'lucide-react';
import { NarratedPage } from '../types';

interface PdfViewProps {
    currentPageData: NarratedPage | undefined;
    currentPlayingPage: number;
}

export const PdfView: React.FC<PdfViewProps> = ({ currentPageData, currentPlayingPage }) => {
    return (
        <div className="bg-slate-200 rounded-2xl shadow-inner overflow-hidden flex flex-col relative">
            <div className="absolute top-4 right-4 z-10 bg-black/50 text-white text-xs px-3 py-1 rounded-full backdrop-blur-md">
                Original Page {currentPlayingPage}
            </div>
            <div className="flex-1 overflow-auto bg-slate-800 p-4 text-center">
                {currentPageData?.imageUrl ? (
                    <img src={currentPageData.imageUrl} alt="PDF Page" className="w-full h-auto shadow-2xl rounded-sm mx-auto" />
                ) : (
                    <div className="text-slate-400 flex flex-col items-center justify-center h-full">
                        <Loader className="w-8 h-8 animate-spin mb-2" />
                        <span>Rendering PDF View...</span>
                    </div>
                )}
            </div>
        </div>
    );
};
