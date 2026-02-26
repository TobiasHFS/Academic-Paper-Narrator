import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PrescreenResult, PrescreenPage, PageCategory } from '../types';
import { FileDown, CheckCircle, Circle, Play, Info, X, ChevronDown, ChevronRight, CheckSquare, Square } from 'lucide-react';

interface MediationViewProps {
    prescreenData: PrescreenResult;
    onUpdateSelection: (updatedPages: PrescreenPage[]) => void;
    onStartNarration: () => void;
    onAbort: () => void;
}

const CATEGORY_LABELS: Record<PageCategory, string> = {
    main: "Main Text",
    cover: "Cover Pages",
    toc: "Table of Contents",
    references: "References",
    appendix: "Appendices",
    blank: "Blank / Uncategorized"
};

const CATEGORY_COLORS: Record<PageCategory, { bg: string, text: string }> = {
    main: { bg: 'bg-green-100', text: 'text-green-700' },
    cover: { bg: 'bg-orange-100', text: 'text-orange-700' },
    toc: { bg: 'bg-blue-100', text: 'text-blue-700' },
    references: { bg: 'bg-purple-100', text: 'text-purple-700' },
    appendix: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
    blank: { bg: 'bg-slate-200', text: 'text-slate-600' }
};

export const MediationView: React.FC<MediationViewProps> = ({
    prescreenData,
    onUpdateSelection,
    onStartNarration,
    onAbort
}) => {
    // Keep all categories closed by default so users can see the overall structure clearly
    const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

    const togglePage = (pageNumber: number) => {
        const updated = prescreenData.pages.map(p =>
            p.pageNumber === pageNumber ? { ...p, selected: !p.selected } : p
        );
        onUpdateSelection(updated);
    };

    const toggleCategory = (category: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const pagesInCategory = prescreenData.pages.filter(p => p.category === category);
        const allSelected = pagesInCategory.every(p => p.selected);

        const updated = prescreenData.pages.map(p =>
            p.category === category ? { ...p, selected: !allSelected } : p
        );
        onUpdateSelection(updated);
    };

    const toggleExpand = (category: string) => {
        setExpandedCategories(prev => ({
            ...prev,
            [category]: !prev[category]
        }));
    };

    const selectedCount = prescreenData.pages.filter(p => p.selected).length;
    const totalCount = prescreenData.pages.length;

    // Group pages by category
    const groupedPages = prescreenData.pages.reduce((acc, page) => {
        if (!acc[page.category]) acc[page.category] = [];
        acc[page.category].push(page);
        return acc;
    }, {} as Record<string, PrescreenPage[]>);

    // Sort categories (Main first, then logical order)
    const categoryOrder: PageCategory[] = ['main', 'cover', 'toc', 'appendix', 'references', 'blank'];
    const activeCategories = categoryOrder.filter(cat => groupedPages[cat] && groupedPages[cat].length > 0);

    return (
        <div className="w-full max-w-5xl mx-auto bg-white p-6 sm:p-8 rounded-3xl border border-slate-200 shadow-xl relative overflow-hidden flex flex-col h-[90vh]">

            {/* Top Right Abort Button */}
            <button
                onClick={onAbort}
                className="absolute top-6 right-6 p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors z-10"
                title="Cancel and return to home screen"
            >
                <X className="w-6 h-6" />
            </button>

            {/* Header */}
            <div className="text-center max-w-2xl mx-auto space-y-2 mb-4 shrink-0">
                <div className="inline-flex items-center justify-center p-2.5 bg-indigo-50 text-indigo-600 rounded-2xl mb-1">
                    <FileDown className="w-5 h-5" />
                </div>
                <h2 className="text-xl font-bold text-slate-900 font-serif">Select Pages to Narrate</h2>
                <p className="text-sm text-slate-500">
                    Our AI has automatically scanned and clustered the document. You can instantly toggle entire sections below, or expand them to fine-tune exactly what gets read!
                </p>
            </div>

            {/* Stats Bar */}
            <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl flex items-center justify-between text-sm mb-4 shrink-0">
                <div className="flex items-center gap-2 text-indigo-700 font-medium">
                    <Info className="w-4 h-4" />
                    Skipping {totalCount - selectedCount} unnecessary pages
                </div>
                <div className="text-slate-600 font-medium">
                    Selected: <span className="text-slate-900">{selectedCount}</span> / {totalCount}
                </div>
            </div>

            {/* Categories List */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-2 scrollbar-hide pb-4">
                {activeCategories.map((category) => {
                    const pages = groupedPages[category];
                    const selectedInCategory = pages.filter(p => p.selected).length;
                    const allSelected = selectedInCategory === pages.length;
                    const someSelected = selectedInCategory > 0 && !allSelected;
                    const isExpanded = !!expandedCategories[category];
                    const colors = CATEGORY_COLORS[category];

                    return (
                        <div key={category} className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
                            {/* Category Header (Accordion Tile) */}
                            <div
                                onClick={(e) => toggleCategory(category, e)}
                                className={`flex items-center justify-between p-3 cursor-pointer hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-slate-50 border-b border-slate-100' : ''}`}
                            >
                                <div className="flex items-center gap-3">
                                    <button
                                        className={`transition-colors flex-shrink-0 pointer-events-none ${allSelected ? 'text-indigo-600' : someSelected ? 'text-indigo-400' : 'text-slate-300'}`}
                                    >
                                        {allSelected ? <CheckSquare className="w-5 h-5" /> : someSelected ? <CheckSquare className="w-5 h-5 opacity-60" /> : <Square className="w-5 h-5" />}
                                    </button>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-bold text-slate-800 text-base">{CATEGORY_LABELS[category]}</h3>
                                            <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${colors.bg} ${colors.text}`}>
                                                {pages.length} Pages
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            {selectedInCategory} selected for narration
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleExpand(category);
                                    }}
                                    className="text-slate-500 py-1.5 px-3 rounded-xl hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 transition-all flex items-center gap-2 hover:-translate-y-0.5 hover:shadow-sm"
                                    title={isExpanded ? "Hide individual pages" : "View individual pages"}
                                >
                                    <span className="text-[10px] font-bold uppercase tracking-wider hidden sm:block">View Pages</span>
                                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                </button>
                            </div>

                            {/* Expanded Individual Pages Grid */}
                            <AnimatePresence>
                                {isExpanded && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden"
                                    >
                                        <div className="p-4 bg-slate-50/50 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                            {pages.map((page) => (
                                                <motion.div
                                                    key={page.pageNumber}
                                                    whileHover={{ scale: 1.02 }}
                                                    whileTap={{ scale: 0.98 }}
                                                    onClick={() => togglePage(page.pageNumber)}
                                                    className={`cursor-pointer border-2 rounded-xl p-3 transition-all flex items-start gap-3 bg-white ${page.selected
                                                        ? 'border-indigo-500 shadow-sm'
                                                        : 'border-slate-200 opacity-60 hover:opacity-100 hover:border-slate-300'
                                                        }`}
                                                >
                                                    <div className={`mt-0.5 ${page.selected ? 'text-indigo-600' : 'text-slate-300'}`}>
                                                        {page.selected ? <CheckCircle className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                                                    </div>

                                                    <div className="flex-1 min-w-0">
                                                        <span className={`font-bold text-sm block mb-1 ${page.selected ? 'text-indigo-900' : 'text-slate-500'}`}>
                                                            Page {page.pageNumber}
                                                        </span>
                                                        <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                                                            {page.reasoning}
                                                        </p>
                                                    </div>
                                                </motion.div>
                                            ))}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    );
                })}
            </div>

            {/* Action Footer */}
            <div className="pt-4 border-t border-slate-100 flex justify-between items-center shrink-0">
                <p className="text-xs text-slate-400 hidden sm:block">You can always abort or restart from the top navigation later.</p>
                <button
                    onClick={onStartNarration}
                    disabled={selectedCount === 0}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-2.5 rounded-xl font-bold transition-colors shadow-lg shadow-indigo-200 ml-auto"
                >
                    <Play className="w-4 h-4" />
                    Start Narration ({selectedCount} pages)
                </button>
            </div>

        </div>
    );
};
