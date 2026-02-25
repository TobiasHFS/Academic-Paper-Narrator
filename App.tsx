import { useState, useRef, useEffect } from 'react';
import { FileUpload } from './components/FileUpload';
import { AudioController } from './components/AudioController';
import { loadPdf } from './services/pdfService';
import { generateEpub } from './services/epubService';

import { FileText, Loader, BookOpen, AlertCircle, CheckCircle2, Sparkles, FileType } from 'lucide-react';
import { useAudioPlayback } from './hooks/useAudioPlayback';
import { usePageProcessor } from './hooks/usePageProcessor';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPlayingPage, setCurrentPlayingPage] = useState(() => Number(localStorage.getItem('lastPage')) || 1);
  const [playbackSpeed, setPlaybackSpeed] = useState(() => Number(localStorage.getItem('lastSpeed')) || 1.0);
  const [selectedVoice, setSelectedVoice] = useState(() => localStorage.getItem('lastVoice') || 'Fenrir');
  const [language, setLanguage] = useState<'en' | 'de'>('en');
  const [processingMode, setProcessingMode] = useState<'audio' | 'text'>('audio');

  const pdfDocRef = useRef<any>(null);

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

  const {
    pages
  } = usePageProcessor({
    pdfDoc: pdfDocRef.current,
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
    setFile(selectedFile);
    try {
      const pdf = await loadPdf(selectedFile);
      pdfDocRef.current = pdf;
      // Reset progress when new file is loaded
      setCurrentPlayingPage(1);
      setTotalPages(pdf.numPages);
    } catch (err) {
      console.error("Error loading PDF", err);
      alert("Failed to load PDF.");
      setFile(null);
    }
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

  const renderTextWithEvents = (text: string) => {
    if (processingMode === 'text' || !currentPageData?.segments) {
      return <span className="text-slate-700">{text}</span>;
    }

    // Split by sentences (matching the generator)
    const sentences = text.match(/[^.!?]+[.!?]*(\s+|$)/g) || [text];
    let tokenCounter = 0;

    return sentences.map((sentence, sIndex) => {
      const segment = currentPageData.segments?.[sIndex];
      const isCurrentSentence = segment &&
        currentTime >= segment.startTime &&
        currentTime < (segment.startTime + segment.duration);

      const tokens = sentence.split(/(\s+)/);
      const startTokenIndex = tokenCounter;
      tokenCounter += tokens.length;

      return (
        <span
          key={sIndex}
          className={`transition-all duration-300 rounded px-1 -mx-1 py-0.5 ${isCurrentSentence ? 'bg-indigo-100 text-indigo-900 border-b-2 border-indigo-400 font-medium' : 'text-slate-700'}`}
        >
          {tokens.map((token, tIndex) => {
            const wordIdx = startTokenIndex + tIndex;
            return !token.trim() ? (
              <span key={tIndex}>{token}</span>
            ) : (
              <span
                key={tIndex}
                onDoubleClick={() => handleWordDoubleClick(wordIdx)}
                className="cursor-pointer hover:underline decoration-indigo-300 underline-offset-4"
              >
                {token}
              </span>
            );
          })}
        </span>
      );
    });
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
    <div className="min-h-screen bg-slate-50 pb-32">
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 text-white p-1.5 rounded-lg"><BookOpen className="w-4 h-4" /></div>
            <span className="font-semibold text-slate-900">Academic Narrator</span>
          </div>
          <div className="flex items-center gap-3">
            <label className="hidden sm:flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors border border-slate-200 px-3 py-1.5 rounded-lg bg-white cursor-pointer" title="Import session from file">
              Import Session
              <input type="file" accept=".json" onChange={handleImportSession} className="hidden" />
            </label>
            <button
              onClick={handleExportSession}
              className="hidden sm:flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors border border-slate-200 px-3 py-1.5 rounded-lg bg-white"
              title="Export session for another device"
            >
              Export Session
            </button>
            <button onClick={handleDownloadFull} className={`flex items-center gap-2 text-sm font-medium border px-3 py-1.5 rounded-lg transition-all ${isFullyComplete ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-200 hover:text-indigo-600'}`}>
              {isFullyComplete ? (processingMode === 'text' ? <FileType className="w-4 h-4 text-indigo-600" /> : <CheckCircle2 className="w-4 h-4 text-indigo-600" />) : <div className="relative w-4 h-4"><svg className="w-full h-full -rotate-90" viewBox="0 0 36 36"><path className="text-slate-200" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4" /><path className="text-indigo-600" strokeDasharray={`${progressPercent}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4" /></svg></div>}
              <span className="hidden sm:inline">{isFullyComplete ? (processingMode === 'text' ? "Download Cleaned EPUB" : "Download Full Audio") : `Processing ${completedCount}/${totalPages}`}</span>
            </button>
            <div className="text-sm font-medium text-slate-600 truncate max-w-xs md:max-w-md">{file.name}</div>
          </div>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid lg:grid-cols-2 gap-8 h-[calc(100vh-160px)]">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h2 className="font-semibold text-slate-800 flex items-center gap-2"><FileText className="w-4 h-4 text-indigo-500" />Narrative Script</h2>
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
                  <div className={`prose prose-slate max-w-none ${processingMode === 'audio' ? 'opacity-50' : ''}`}><p className="font-serif text-lg leading-relaxed text-slate-800 whitespace-pre-wrap">{currentPageData.originalText}</p></div>
                </div>
              )}
              {currentPageData?.status === 'error' && <div className="flex flex-col items-center justify-center h-full text-red-500 gap-2 p-8 text-center"><AlertCircle className="w-8 h-8" /><p>An error occurred processing this page.</p></div>}
              {currentPageData?.status === 'ready' && currentPageData?.originalText && <div className="prose prose-slate max-w-none"><p className="font-serif text-lg leading-relaxed text-slate-800 whitespace-pre-wrap">{renderTextWithEvents(currentPageData.originalText)}</p></div>}
            </div>
          </div>
          <div className="bg-slate-200 rounded-2xl shadow-inner overflow-hidden flex flex-col relative">
            <div className="absolute top-4 right-4 z-10 bg-black/50 text-white text-xs px-3 py-1 rounded-full backdrop-blur-md">Original Page {currentPlayingPage}</div>
            <div className="flex-1 overflow-auto bg-slate-800 p-4 text-center">{currentPageData?.imageUrl ? <img src={currentPageData.imageUrl} alt="PDF Page" className="w-full h-auto shadow-2xl rounded-sm mx-auto" /> : <div className="text-slate-400 flex flex-col items-center justify-center h-full"><Loader className="w-8 h-8 animate-spin mb-2" /><span>Rendering PDF View...</span></div>}</div>
          </div>
        </div>
      </main>

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
    </div>
  );
}