import { useState, useEffect, useRef } from 'react';
import { FileUpload } from './components/FileUpload';
import { AudioController } from './components/AudioController';
import { loadPdf, renderPageToImage, extractPageText } from './services/pdfService';
import { extractScriptBatch, synthesizeBatch } from './services/geminiService';
import { generateEpub } from './services/epubService';
import { NarratedPage, PlaybackState } from './types';
import { FileText, Loader, BookOpen, AlertCircle, CheckCircle2, Sparkles, FileType } from 'lucide-react';

// PIPELINE CONFIGURATION
const MAX_EXTRACTION_WORKERS = 3; 
const BATCH_SIZE_EXTRACTION = 3; 
const MAX_SYNTHESIS_WORKERS = 3; 
const MAX_TTS_CHARS_PER_BATCH = 4500; 

const SEEK_WEIGHTS = { paragraph: 15, sentence: 10, comma: 5, space: 1, char: 1 };
const getWeightedLength = (text: string) => {
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\n') length += SEEK_WEIGHTS.paragraph;
    else if (/[.?!]/.test(char)) length += SEEK_WEIGHTS.sentence;
    else if (/[;,]/.test(char)) length += SEEK_WEIGHTS.comma;
    else if (/\s/.test(char)) length += SEEK_WEIGHTS.space;
    else length += SEEK_WEIGHTS.char;
  }
  return length;
};

const SEEK_SAFETY_BUFFER_SECONDS = 0.1; 

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [pages, setPages] = useState<NarratedPage[]>([]);
  const [currentPlayingPage, setCurrentPlayingPage] = useState(1);
  const [playbackState, setPlaybackState] = useState<PlaybackState>(PlaybackState.IDLE);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [language, setLanguage] = useState<'en' | 'de'>('en');
  const [processingMode, setProcessingMode] = useState<'audio' | 'text'>('audio');
  
  const [activeExtractionWorkers, setActiveExtractionWorkers] = useState(0);
  const [activeSynthesisWorkers, setActiveSynthesisWorkers] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pdfDocRef = useRef<any>(null);
  
  useEffect(() => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = "auto";
      audio.preservesPitch = true;
      audioRef.current = audio;
    }
  }, []);

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    try {
      const pdf = await loadPdf(selectedFile);
      pdfDocRef.current = pdf;
      setTotalPages(pdf.numPages);
      setPages(Array.from({ length: pdf.numPages }, (_, i) => ({
        pageNumber: i + 1,
        originalText: '',
        status: 'pending',
      })));
    } catch (err) {
      console.error("Error loading PDF", err);
      alert("Failed to load PDF.");
      setFile(null);
    }
  };

  // --- STAGE 1: BATCH EXTRACTION ---
  const performBatchExtraction = async (pageNums: number[]) => {
    pageNums.forEach(p => updatePageStatus(p, 'analyzing'));

    try {
      const batchPayload: { pageNum: number; base64Image: string; rawText: string }[] = [];
      await Promise.all(pageNums.map(async (pageNum) => {
        let rawText = "";
        try { rawText = await extractPageText(pdfDocRef.current, pageNum); } catch (e) {}
        
        let img = pages[pageNum-1]?.imageUrl;
        if (!img) {
          try {
             img = await renderPageToImage(pdfDocRef.current, pageNum);
             setPages(prev => {
                const copy = [...prev];
                if(copy[pageNum-1]) copy[pageNum-1] = { ...copy[pageNum-1], imageUrl: img };
                return copy;
             });
          } catch(e) {}
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
             // If mode is TEXT ONLY, we skip 'extracted' status and go straight to 'ready'.
             // If mode is AUDIO, we go to 'extracted' so synthesis can pick it up.
             const nextStatus = processingMode === 'text' ? 'ready' : 'extracted';
             
             if (!text.trim()) {
                copy[idx] = { ...copy[idx], originalText: text, status: 'ready' }; // Empty pages are always ready
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

  // --- STAGE 2: BATCH SYNTHESIS ---
  const performBatchSynthesis = async (batchPages: NarratedPage[]) => {
    // Safety check
    if (processingMode === 'text') return;

    const pageNums = batchPages.map(p => p.pageNumber);
    pageNums.forEach(p => updatePageStatus(p, 'synthesizing'));

    try {
      const input = batchPages.map(p => ({ pageNum: p.pageNumber, text: p.originalText }));
      const resultsMap = await synthesizeBatch(input);
      
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

  const updatePageStatus = (pageNum: number, status: NarratedPage['status']) => {
    setPages(prev => {
      const copy = [...prev];
      if (copy[pageNum - 1]) copy[pageNum - 1] = { ...copy[pageNum - 1], status };
      return copy;
    });
  };

  // --- WORKER MANAGERS ---

  // Manager 1: Extraction Pool
  useEffect(() => {
    if (!pdfDocRef.current || pages.length === 0) return;

    if (activeExtractionWorkers < MAX_EXTRACTION_WORKERS) {
      const findBatchToExtract = (): number[] => {
        for (let i = currentPlayingPage; i <= totalPages; i++) {
          if (pages[i-1]?.status === 'pending') {
            const batch = [i];
            for (let j = 1; j < BATCH_SIZE_EXTRACTION; j++) {
               if (i+j <= totalPages && pages[i+j-1]?.status === 'pending') batch.push(i+j);
               else break;
            }
            return batch;
          }
        }
        for (let i = 1; i < currentPlayingPage; i++) {
          if (pages[i-1]?.status === 'pending') {
             const batch = [i];
             for (let j = 1; j < BATCH_SIZE_EXTRACTION; j++) {
               if (i+j < currentPlayingPage && pages[i+j-1]?.status === 'pending') batch.push(i+j);
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
  }, [activeExtractionWorkers, pages, currentPlayingPage, totalPages]);

  // Manager 2: Synthesis Pool (Greedy Char Batching)
  useEffect(() => {
    if (!pdfDocRef.current || pages.length === 0) return;
    
    // IF TEXT MODE, DO NOT RUN SYNTHESIS
    if (processingMode === 'text') return;

    if (activeSynthesisWorkers < MAX_SYNTHESIS_WORKERS) {
      const findBatchToSynth = (): NarratedPage[] | null => {
        // Find first extracted page
        let startIdx = -1;
        
        // Priority: current page forward
        for(let i=currentPlayingPage-1; i<totalPages; i++) {
            if (pages[i].status === 'extracted') { startIdx = i; break; }
        }
        // Fallback: search from start
        if (startIdx === -1) {
            for(let i=0; i<totalPages; i++) {
                if (pages[i].status === 'extracted') { startIdx = i; break; }
            }
        }

        if (startIdx === -1) return null;

        // Found start. Now look ahead to fill the char bucket
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
                    break; // Batch full
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
  }, [activeSynthesisWorkers, pages, currentPlayingPage, totalPages, processingMode]);

  // --- AUDIO PLAYBACK LOGIC ---

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  useEffect(() => {
    // If text mode, no playback logic needed
    if (processingMode === 'text') return;

    const audio = audioRef.current;
    if (!audio) return;
    const page = pages[currentPlayingPage - 1];

    if (['analyzing', 'extracted', 'synthesizing', 'pending'].includes(page?.status || '')) {
      if (playbackState === PlaybackState.PLAYING) setPlaybackState(PlaybackState.BUFFERING);
      return;
    }

    if (page?.status === 'ready' && !page.audioUrl) {
       if (playbackState === PlaybackState.PLAYING) {
           if (currentPlayingPage < totalPages) {
              setCurrentPlayingPage(p => p + 1); 
           } else {
              setPlaybackState(PlaybackState.IDLE);
           }
       }
       return;
    }

    if (page?.status === 'ready' && page.audioUrl) {
       const isNewSrc = audio.src !== page.audioUrl;
       
       if (isNewSrc) {
         audio.src = page.audioUrl;
         audio.load();
         if (page.segments && page.segments.length > 0) {
             audio.currentTime = page.segments[0].startTime;
         }
         
         if (playbackState === PlaybackState.PLAYING) {
            audio.play().catch(e => console.log("Auto-play prevented", e));
         }
       } else {
           if (page.segments && page.segments.length > 0) {
               const start = page.segments[0].startTime;
               const end = page.segments[page.segments.length-1].startTime + page.segments[page.segments.length-1].duration;
               if (audio.currentTime < start - 0.5 || audio.currentTime > end + 0.5) {
                   audio.currentTime = start;
               }
           }
       }
       
       if (playbackState === PlaybackState.PLAYING && audio.paused) {
          audio.play().catch(console.warn);
       } else if (playbackState === PlaybackState.PAUSED && !audio.paused) {
          audio.pause();
       }
    }
    
    if (playbackState === PlaybackState.BUFFERING && page?.status === 'ready') setPlaybackState(PlaybackState.PLAYING);
  }, [currentPlayingPage, pages, playbackState, totalPages, processingMode]);

  // Continuous Playback Check
  useEffect(() => {
      if (processingMode === 'text') return;

      const interval = setInterval(() => {
          const audio = audioRef.current;
          if (!audio || playbackState !== PlaybackState.PLAYING) return;
          
          const page = pages[currentPlayingPage - 1];
          if (!page || !page.segments || page.segments.length === 0) return;

          const end = page.segments[page.segments.length-1].startTime + page.segments[page.segments.length-1].duration;
          
          if (audio.currentTime >= end - 0.1) {
              if (currentPlayingPage < totalPages) {
                  const nextPage = pages[currentPlayingPage]; 
                  if (nextPage && nextPage.audioUrl === page.audioUrl && nextPage.status === 'ready') {
                      setCurrentPlayingPage(p => p + 1);
                  } else {
                      setCurrentPlayingPage(p => p + 1);
                  }
              } else {
                  setPlaybackState(PlaybackState.IDLE);
              }
          }
      }, 100);
      return () => clearInterval(interval);
  }, [playbackState, currentPlayingPage, pages, totalPages, processingMode]);

  const togglePlayPause = () => setPlaybackState(prev => (prev === PlaybackState.PLAYING || prev === PlaybackState.BUFFERING) ? PlaybackState.PAUSED : PlaybackState.PLAYING);

  const handleWordDoubleClick = (wordIndex: number) => {
    // If text mode, do nothing on double click
    if (processingMode === 'text') return;

    const audio = audioRef.current;
    if (!audio) return;
    const page = pages[currentPlayingPage - 1];
    if (page?.audioUrl && audio.src !== page.audioUrl) { audio.src = page.audioUrl; audio.load(); }
    if (!Number.isFinite(audio.duration) || audio.duration === 0) return;

    if (page?.segments?.length) {
      let tokenCounter = 0;
      let targetSeekTime = 0;

      for (const segment of page.segments) {
        const segmentTokens = segment.text.split(/(\s+)/);
        if (wordIndex < tokenCounter + segmentTokens.length) {
          if (segment.isSilence || segment.duration === 0) targetSeekTime = segment.startTime;
          else {
             const localIndex = wordIndex - tokenCounter;
             let weightBefore = 0;
             for(let i=0; i<localIndex; i++) weightBefore += getWeightedLength(segmentTokens[i]);
             const totalWeight = getWeightedLength(segment.text);
             targetSeekTime = segment.startTime + (totalWeight > 0 ? (weightBefore / totalWeight) * segment.duration : 0);
          }
          break;
        }
        tokenCounter += segmentTokens.length;
      }
      audio.currentTime = Math.max(0, targetSeekTime - SEEK_SAFETY_BUFFER_SECONDS);
    }
    if (playbackState !== PlaybackState.PLAYING) { setPlaybackState(PlaybackState.PLAYING); audio.play().catch(console.error); }
  };

  const handleDownloadFull = async () => {
    if (processingMode === 'text') {
        // TEXT ONLY DOWNLOAD (EPUB)
        const readyPages = pages.filter(p => p.status === 'ready').sort((a,b) => a.pageNumber - b.pageNumber);
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

    // AUDIO DOWNLOAD (Existing Logic)
    const readyPages = pages.filter(p => p.status === 'ready' && p.audioUrl).sort((a,b) => a.pageNumber - b.pageNumber);
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
              const data = buffer.slice(44); // Strip header
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
    // If text mode, just render text without click events to avoid confusion
    if (processingMode === 'text') {
        return <span className="text-slate-700">{text}</span>;
    }

    const tokens = text.split(/(\s+)/);
    return tokens.map((token, index) => !token.trim() ? <span key={index}>{token}</span> : (
      <span key={index} onDoubleClick={() => handleWordDoubleClick(index)} className="cursor-pointer hover:bg-indigo-50 hover:text-indigo-700 rounded px-0.5 transition-colors select-text text-slate-700">{token}</span>
    ));
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
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 pb-32">
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2"><div className="bg-indigo-600 text-white p-1.5 rounded-lg"><BookOpen className="w-4 h-4" /></div><span className="font-semibold text-slate-900">Academic Narrator</span></div>
          <div className="flex items-center gap-4">
             <button onClick={handleDownloadFull} className={`flex items-center gap-2 text-sm font-medium border px-3 py-1.5 rounded-lg transition-all ${isFullyComplete ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100' : 'text-slate-600 border-slate-200 hover:border-indigo-200 hover:text-indigo-600'}`}>
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
                       {/* Only show "Generating audio" overlay if we are in Audio mode */}
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
      
      {/* Audio Controller - In Text Mode, we simply show page navigation without player controls */}
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