import React from 'react';
import { BookOpen, FileType, CheckCircle2, X } from 'lucide-react';

interface TopNavigationProps {
    fileName: string;
    isFullyComplete: boolean;
    processingMode: 'audio' | 'text';
    progressPercent: number;
    completedCount: number;
    totalPages: number;
    onImportSession: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onExportSession: () => void;
    onDownloadFull: () => void;
    onAbort: () => void;
}

export const TopNavigation: React.FC<TopNavigationProps> = ({
    fileName,
    isFullyComplete,
    processingMode,
    progressPercent,
    completedCount,
    totalPages,
    onImportSession,
    onExportSession,
    onDownloadFull,
    onAbort
}) => {
    return (
        <nav className="bg-white border-b border-slate-200 sticky top-0 z-40">
            <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="bg-indigo-600 text-white p-1.5 rounded-lg"><BookOpen className="w-4 h-4" /></div>
                    <span className="font-semibold text-slate-900">Academic Narrator</span>
                </div>
                <div className="flex items-center gap-3">
                    <label className="hidden sm:flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors border border-slate-200 px-3 py-1.5 rounded-lg bg-white cursor-pointer" title="Import session from file">
                        Import Session
                        <input type="file" accept=".json" onChange={onImportSession} className="hidden" />
                    </label>
                    <button
                        onClick={onExportSession}
                        className="hidden sm:flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors border border-slate-200 px-3 py-1.5 rounded-lg bg-white"
                        title="Export session for another device"
                    >
                        Export Session
                    </button>
                    <button onClick={onDownloadFull} className={`flex items-center gap-2 text-sm font-medium border px-3 py-1.5 rounded-lg transition-all ${isFullyComplete ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-200 hover:text-indigo-600'}`}>
                        {isFullyComplete ? (processingMode === 'text' ? <FileType className="w-4 h-4 text-indigo-600" /> : <CheckCircle2 className="w-4 h-4 text-indigo-600" />) : <div className="relative w-4 h-4"><svg className="w-full h-full -rotate-90" viewBox="0 0 36 36"><path className="text-slate-200" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4" /><path className="text-indigo-600" strokeDasharray={`${progressPercent}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4" /></svg></div>}
                        <span className="hidden sm:inline">{isFullyComplete ? (processingMode === 'text' ? "Download Cleaned EPUB" : "Download Full Audio") : `Processing ${completedCount}/${totalPages}`}</span>
                    </button>
                    <div className="text-sm font-medium text-slate-600 truncate max-w-xs md:max-w-md hidden lg:block">{fileName}</div>
                    <div className="w-px h-6 bg-slate-200 mx-2"></div>
                    <button
                        onClick={onAbort}
                        className="p-2 -mr-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                        title="Close paper and return to upload screen"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </nav>
    );
};
