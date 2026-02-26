import { useEffect, useState, useRef, useMemo } from 'react';
import { FileUpload } from './components/FileUpload';
import { AudioController } from './components/AudioController';
import { TopNavigation } from './components/TopNavigation';
import { ScriptView } from './components/ScriptView';
import { PdfView } from './components/PdfView';
import { loadPdf } from './services/pdfService';
import { generateEpub } from './services/epubService';
import { motion, AnimatePresence } from 'framer-motion';
import { PDFDocument } from 'pdf-lib';

import { BookOpen, Loader2 } from 'lucide-react';
import { useAudioPlayback } from './hooks/useAudioPlayback';
import { usePageProcessor } from './hooks/usePageProcessor';
import { analyzeDocumentStructure } from './services/geminiService';
import { PrescreenResult } from './types';
import { MediationView } from './components/MediationView';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPlayingPage, setCurrentPlayingPage] = useState(() => Number(localStorage.getItem('lastPage')) || 1);
  const [playbackSpeed, setPlaybackSpeed] = useState(() => Number(localStorage.getItem('lastSpeed')) || 1.0);
  const [selectedVoice, setSelectedVoice] = useState(() => localStorage.getItem('lastVoice') || 'Fenrir');
  const [language, setLanguage] = useState<'en' | 'de'>('en');
  const [processingMode, setProcessingMode] = useState<'audio' | 'text'>('audio');

  // Mediation State
  const [prescreenData, setPrescreenData] = useState<PrescreenResult | null>(null);
  const [isPrescreening, setIsPrescreening] = useState(false);
  const [isSlicing, setIsSlicing] = useState(false);
  const [narrationStarted, setNarrationStarted] = useState(false);
  const [originalFile, setOriginalFile] = useState<File | null>(null);

  const pdfDocRef = useRef<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Persistence
  useEffect(() => {
    localStorage.setItem('lastPage', currentPlayingPage.toString());
  }, [currentPlayingPage]);

  useEffect(() => {
    localStorage.setItem('lastSpeed', playbackSpeed.toString());
  }, [playbackSpeed]);

  useEffect(() => {
    localStorage.setItem('lastVoice', selectedVoice);
  }, [selectedVoice]);

  const selectedPagesArray = useMemo(() => {
    if (!prescreenData) return undefined;
    return prescreenData.pages.filter(p => p.selected).map(p => p.pageNumber);
  }, [prescreenData]);

  const {
    pages,
    apiError
  } = usePageProcessor({
    pdfDoc: narrationStarted ? pdfDocRef.current : null, // Only start processing when narration starts
    currentPlayingPage,
    totalPages,
    processingMode,
    language,
    selectedVoice
  });

  const {
    playbackState,
    togglePlayPause,
    handleWordDoubleClick,
    currentTime
  } = useAudioPlayback({
    pages,
    currentPlayingPage,
    setCurrentPlayingPage,
    playbackSpeed,
    processingMode,
    totalPages,
    title: file?.name
  });

  const handleFileSelect = async (selectedFile: File) => {
    setOriginalFile(selectedFile);
    setFile(selectedFile);
    setIsPrescreening(true);
    setPrescreenData(null);
    setNarrationStarted(false);

    abortControllerRef.current = new AbortController();

    try {
      const pdf = await loadPdf(selectedFile);
      pdfDocRef.current = pdf;
      setCurrentPlayingPage(1);
      setTotalPages(pdf.numPages);

      // Pre-extract text for structure analysis
      const extractedPages: { pageNum: number, rawText: string }[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        try {
          // Use our existing extraction hook logic standalone if possible, 
          // or just extract raw text directly for speed
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const rawText = textContent.items.map((item: any) => item.str).join(' ');
          extractedPages.push({ pageNum: i, rawText });
        } catch (e) {
          console.warn("Failed to pre-extract page", i);
        }
      }

      if (abortControllerRef.current.signal.aborted) return;

      const analysis = await analyzeDocumentStructure(extractedPages, abortControllerRef.current.signal);
      setPrescreenData(analysis);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error("Error loading PDF", err);
        alert("Failed to load PDF or analyze structure.");
        setFile(null);
      }
    } finally {
      setIsPrescreening(false);
    }
  };

  const handleAbort = () => {
    abortControllerRef.current?.abort();
    setOriginalFile(null);
    setFile(null);
    pdfDocRef.current = null;
    setPrescreenData(null);
    setIsPrescreening(false);
    setIsSlicing(false);
    setNarrationStarted(false);
    setCurrentPlayingPage(1);
    setTotalPages(0);
  };

  const handleDownloadFull = async () => {
    if (processingMode === 'text') {
      const readyPages = pages.filter(p => p.status === 'ready').sort((a, b) => a.pageNumber - b.pageNumber);
      if (!readyPages.length) return alert("No transcript ready.");

      try {
        const fileName = file?.name.replace('.pdf', '') || 'Document';
        const epubBlob = await generateEpub(fileName, readyPages);

        const link = document.createElement('a');
        link.href = URL.createObjectURL(epubBlob);
        link.download = `${fileName}_cleaned.epub`;
        link.click();
      } catch (e) {
        console.error(e);
        alert("Failed to generate EPUB.");
      }
      return;
    }

    const readyPages = pages.filter(p => p.status === 'ready' && p.audioUrl).sort((a, b) => a.pageNumber - b.pageNumber);
    if (!readyPages.length) return alert("No audio ready.");

    const fullText = pages.filter(p => p.originalText).map(p => `--- Page ${p.pageNumber} ---\n\n${p.originalText}`).join('\n\n');
    const textLink = document.createElement('a');
    textLink.href = URL.createObjectURL(new Blob([fullText], { type: 'text/plain' }));
    textLink.download = `${file?.name.replace('.pdf', '')}_transcript.txt`;
    textLink.click();

    try {
      const uniqueBlobs = new Set<string>();
      const audioBuffers: ArrayBuffer[] = [];
      let totalDataLength = 0;

      for (const page of readyPages) {
        if (!uniqueBlobs.has(page.audioUrl!)) {
          uniqueBlobs.add(page.audioUrl!);
          const buffer = await (await fetch(page.audioUrl!)).arrayBuffer();
          const data = buffer.slice(44);
          audioBuffers.push(data);
          totalDataLength += data.byteLength;
        }
      }

      const firstUrl = readyPages[0].audioUrl!;
      const firstRes = await fetch(firstUrl);
      const firstBuffFull = await firstRes.arrayBuffer();

      const finalBuffer = new Uint8Array(44 + totalDataLength);
      finalBuffer.set(new Uint8Array(firstBuffFull.slice(0, 44)), 0);

      const view = new DataView(finalBuffer.buffer);
      view.setUint32(4, 36 + totalDataLength, true);
      view.setUint32(40, totalDataLength, true);

      let offset = 44;
      for (const buff of audioBuffers) {
        finalBuffer.set(new Uint8Array(buff), offset);
        offset += buff.byteLength;
      }

      const audioLink = document.createElement('a');
      audioLink.href = URL.createObjectURL(new Blob([finalBuffer], { type: 'audio/wav' }));
      audioLink.download = `${file?.name.replace('.pdf', '')}_narration.wav`;
      audioLink.click();
    } catch (e) { console.error(e); alert("Download failed."); }
  };

  const completedCount = pages.filter(p => p.status === 'ready').length;
  const progressPercent = totalPages > 0 ? Math.round((completedCount / totalPages) * 100) : 0;
  const isFullyComplete = completedCount === totalPages && totalPages > 0;
  const currentPageData = pages[currentPlayingPage - 1];

  if (!file) return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <header className="mb-12 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 text-white mb-6 shadow-xl"><BookOpen className="w-8 h-8" /></div>
        <h1 className="text-4xl font-bold text-slate-900 mb-4 tracking-tight font-serif">Academic Narrator</h1>
        <p className="text-lg text-slate-600 max-w-lg mx-auto leading-relaxed">Transform dense academic PDFs into clear, intelligent audio narrations.</p>
      </header>
      <FileUpload
        onFileSelect={handleFileSelect}
        language={language}
        onLanguageChange={setLanguage}
        mode={processingMode}
        onModeChange={setProcessingMode}
        selectedVoice={selectedVoice}
        onVoiceChange={setSelectedVoice}
      />
    </div>
  );

  const handleExportSession = () => {
    const sessionData = {
      fileName: file.name,
      lastPage: currentPlayingPage,
      lastSpeed: playbackSpeed,
      lastVoice: selectedVoice,
      language: language,
      mode: processingMode,
      timestamp: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${file.name.replace('.pdf', '')}_session.json`;
    link.click();
  };

  const handleImportSession = (e: React.ChangeEvent<HTMLInputElement>) => {
    const importFile = e.target.files?.[0];
    if (!importFile) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (data.lastPage) setCurrentPlayingPage(data.lastPage);
        if (data.lastSpeed) setPlaybackSpeed(data.lastSpeed);
        if (data.lastVoice) setSelectedVoice(data.lastVoice);
        if (data.language) setLanguage(data.language);
        if (data.mode) setProcessingMode(data.mode);
        alert("Session imported successfully!");
      } catch (err) {
        alert("Failed to import session. Invalid file format.");
      }
    };
    reader.readAsText(importFile);
  };

  return (
    <div className="min-h-screen bg-slate-50 overflow-x-hidden">
      <AnimatePresence mode="wait">
        {!file ? (
          <motion.div
            key="landing"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, filter: 'blur(4px)' }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="min-h-screen flex flex-col items-center justify-center p-6 relative"
          >
            {/* Background decoration */}
            <div className="absolute top-0 left-0 right-0 h-96 bg-gradient-to-b from-indigo-50 to-transparent -z-10" />

            <header className="mb-12 text-center">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 text-white mb-6 shadow-xl shadow-indigo-200"
              >
                <BookOpen className="w-8 h-8" />
              </motion.div>
              <motion.h1
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="text-4xl font-bold text-slate-900 mb-4 tracking-tight font-serif"
              >
                Academic Narrator
              </motion.h1>
              <motion.p
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-lg text-slate-600 max-w-lg mx-auto leading-relaxed"
              >
                Transform dense academic PDFs into clear, intelligent audio narrations.
              </motion.p>
            </header>

            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="w-full max-w-2xl"
            >
              <FileUpload
                onFileSelect={handleFileSelect}
                language={language}
                onLanguageChange={setLanguage}
                mode={processingMode}
                onModeChange={setProcessingMode}
                selectedVoice={selectedVoice}
                onVoiceChange={setSelectedVoice}
              />
            </motion.div>
          </motion.div>
        ) : isPrescreening ? (
          <motion.div
            key="prescreening-loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center min-h-screen p-6"
          >
            <Loader2 className="w-12 h-12 animate-spin text-indigo-600 mb-6" />
            <h2 className="text-2xl font-bold text-slate-800 mb-2 font-serif">AI Analyzing Document</h2>
            <p className="text-slate-500 max-w-sm text-center">
              Scanning pages to identify formatting, tables of contents, and references so you only listen to what matters...
            </p>
          </motion.div>
        ) : isSlicing ? (
          <motion.div
            key="slicing-loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center min-h-screen p-6"
          >
            <Loader2 className="w-12 h-12 animate-spin text-indigo-600 mb-6" />
            <h2 className="text-2xl font-bold text-slate-800 mb-2 font-serif">Slicing Document</h2>
            <p className="text-slate-500 max-w-sm text-center">
              Physically extracting your selected pages to generate a clean narration file...
            </p>
          </motion.div>
        ) : prescreenData && !narrationStarted ? (
          <motion.div
            key="mediation"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="min-h-screen py-6 px-4 flex items-center justify-center"
          >
            <MediationView
              prescreenData={prescreenData}
              onUpdateSelection={(pages) => setPrescreenData({ ...prescreenData, pages })}
              onStartNarration={async () => {
                if (!originalFile || !selectedPagesArray || selectedPagesArray.length === 0) return;

                setIsSlicing(true);
                try {
                  const arrayBuffer = await originalFile.arrayBuffer();
                  const pdfDoc = await PDFDocument.load(arrayBuffer);
                  const newPdf = await PDFDocument.create();

                  // pdf-lib uses 0-indexed page numbers
                  const pageIndices = selectedPagesArray.map(p => p - 1);
                  const copiedPages = await newPdf.copyPages(pdfDoc, pageIndices);

                  for (const page of copiedPages) {
                    newPdf.addPage(page);
                  }

                  const pdfBytes = await newPdf.save();
                  // Extract only the precise byte window of the Uint8Array into a new ArrayBuffer
                  // to prevent copying the entire underlying memory pool (which could contain the old PDF)
                  const exactBuffer = pdfBytes.buffer.slice(
                    pdfBytes.byteOffset,
                    pdfBytes.byteOffset + pdfBytes.byteLength
                  ) as ArrayBuffer;
                  const slicedBlob = new Blob([exactBuffer], { type: 'application/pdf' });
                  const slicedFile = new File([slicedBlob], originalFile.name, { type: 'application/pdf' });

                  setFile(slicedFile);

                  // Pass the precise exactBuffer to pdfjsLib directly to avoid Blob memory pooling issues
                  // that cause pdfjsLib to misread the byte size and think the old PDF metadata still exists.
                  const pdfjsDoc = await loadPdf(new Uint8Array(exactBuffer));
                  pdfDocRef.current = pdfjsDoc;

                  setTotalPages(pdfjsDoc.numPages);
                  setCurrentPlayingPage(1);
                  setNarrationStarted(true);
                } catch (e) {
                  console.error("Failed to slice PDF", e);
                  alert("Failed to extract the selected pages. Resuming with full document.");
                  setNarrationStarted(true);
                } finally {
                  setIsSlicing(false);
                }
              }}
              onAbort={handleAbort}
            />
          </motion.div>
        ) : (
          <motion.div
            key="app"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col min-h-screen pb-32"
          >
            <TopNavigation
              fileName={file.name}
              isFullyComplete={isFullyComplete}
              processingMode={processingMode}
              progressPercent={progressPercent}
              completedCount={completedCount}
              totalPages={totalPages}
              onImportSession={handleImportSession}
              onExportSession={handleExportSession}
              onDownloadFull={handleDownloadFull}
              onAbort={handleAbort}
            />

            <main className="max-w-7xl w-full mx-auto px-6 py-8 flex-1">
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.5 }}
                className="grid md:grid-cols-2 gap-8 h-[calc(100vh-160px)] min-h-[500px]"
              >
                <ScriptView
                  currentPageData={currentPageData}
                  processingMode={processingMode}
                  currentTime={currentTime}
                  apiError={apiError}
                  onWordDoubleClick={handleWordDoubleClick}
                />
                <PdfView
                  currentPageData={currentPageData}
                  currentPlayingPage={currentPlayingPage}
                />
              </motion.div>
            </main>

            <AnimatePresence>
              <motion.div
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 100, opacity: 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              >
                <AudioController
                  playbackState={playbackState}
                  onPlayPause={togglePlayPause}
                  onNext={() => currentPlayingPage < totalPages && setCurrentPlayingPage(p => p + 1)}
                  onPrevious={() => currentPlayingPage > 1 && setCurrentPlayingPage(p => p - 1)}
                  currentPage={currentPlayingPage}
                  totalPages={totalPages}
                  speed={playbackSpeed}
                  onSpeedChange={setPlaybackSpeed}
                  mode={processingMode}
                />
              </motion.div>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}