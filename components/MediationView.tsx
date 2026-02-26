import React from 'react';
import { motion } from 'framer-motion';
import { PrescreenResult, PrescreenPage } from '../types';
import { FileDown, CheckCircle, Circle, Play, Info } from 'lucide-react';

interface MediationViewProps {
    prescreenData: PrescreenResult;
    onUpdateSelection: (updatedPages: PrescreenPage[]) => void;
    onStartNarration: () => void;
}

export const MediationView: React.FC<MediationViewProps> = ({
    prescreenData,
    onUpdateSelection,
    onStartNarration
}) => {

    const togglePage = (pageNumber: number) => {
        const updated = prescreenData.pages.map(p =>
            p.pageNumber === pageNumber ? { ...p, selected: !p.selected } : p
        );
        onUpdateSelection(updated);
    };

    const selectedCount = prescreenData.pages.filter(p => p.selected).length;
    const totalCount = prescreenData.pages.length;

    return (
        <div className="w-full max-w-4xl mx-auto space-y-8 bg-white p-8 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden">

            {/* Header */}
            <div className="text-center max-w-2xl mx-auto space-y-3">
                <div className="inline-flex items-center justify-center p-3 bg-indigo-50 text-indigo-600 rounded-2xl mb-2">
                    <FileDown className="w-6 h-6" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 font-serif">Select Pages to Narrate</h2>
                <p className="text-slate-500">
                    Our AI has automatically scanned the document and unchecked pages like the Table of Contents, References, or Cover.
                    Please review the selection below before generating the audio to save processing time!
                </p>
            </div>

            {/* Stats Bar */}
            <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-indigo-700 font-medium">
                    <Info className="w-4 h-4" />
                    Skipping {totalCount - selectedCount} unnecessary pages
                </div>
                <div className="text-slate-600 font-medium">
                    Selected: <span className="text-slate-900">{selectedCount}</span> / {totalCount}
                </div>
            </div>

            {/* Pages Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto p-2 scrollbar-hide">
                {prescreenData.pages.map((page) => (
                    <motion.div
                        key={page.pageNumber}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => togglePage(page.pageNumber)}
                        className={`cursor-pointer border-2 rounded-xl p-4 transition-all flex items-start gap-3 ${page.selected
                                ? 'border-indigo-500 bg-indigo-50/50'
                                : 'border-slate-200 bg-white opacity-60 hover:opacity-100 hover:border-slate-300'
                            }`}
                    >
                        <div className={`mt-0.5 ${page.selected ? 'text-indigo-600' : 'text-slate-300'}`}>
                            {page.selected ? <CheckCircle className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                        </div>

                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                                <span className={`font-bold text-sm ${page.selected ? 'text-indigo-900' : 'text-slate-500'}`}>
                                    Page {page.pageNumber}
                                </span>
                                <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${page.category === 'main' ? 'bg-green-100 text-green-700' :
                                        page.category === 'cover' ? 'bg-orange-100 text-orange-700' :
                                            page.category === 'toc' ? 'bg-blue-100 text-blue-700' :
                                                page.category === 'references' ? 'bg-purple-100 text-purple-700' :
                                                    'bg-slate-200 text-slate-600'
                                    }`}>
                                    {page.category}
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                                {page.reasoning}
                            </p>
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Action Footer */}
            <div className="pt-4 border-t border-slate-100 flex justify-end">
                <button
                    onClick={onStartNarration}
                    disabled={selectedCount === 0}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-3 rounded-xl font-bold transition-colors shadow-lg shadow-indigo-200"
                >
                    <Play className="w-4 h-4" />
                    Start Narration ({selectedCount} pages)
                </button>
            </div>

        </div>
    );
};
