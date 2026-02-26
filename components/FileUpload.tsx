import React, { useRef, useState, useEffect } from 'react';
import { Upload, FileText, AlertCircle, Headphones, Play, Loader2, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { VOICE_PROFILES, generateVoicePreview } from '../services/geminiService';
import { getPreview, savePreview } from '../services/storageService';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
  language: 'en' | 'de';
  onLanguageChange: (lang: 'en' | 'de') => void;
  mode: 'audio' | 'text';
  onModeChange: (mode: 'audio' | 'text') => void;
  selectedVoice: string;
  onVoiceChange: (voice: string) => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  onFileSelect,
  disabled,
  language,
  onLanguageChange,
  mode,
  onModeChange,
  selectedVoice,
  onVoiceChange
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
    };
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (disabled) return;

    const files = e.dataTransfer.files;
    validateAndSelect(files[0]);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndSelect(e.target.files[0]);
    }
  };

  const validateAndSelect = (file: File) => {
    setError(null);
    if (file.type !== 'application/pdf') {
      setError('Please upload a valid PDF file.');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError('File size too large. Please upload a file smaller than 50MB.');
      return;
    }
    onFileSelect(file);
  };

  const handlePreviewVoice = async (voiceName: string) => {
    // If clicking same voice that is playing: Toggle Pause
    if (previewingVoice === voiceName) {
      previewAudioRef.current?.pause();
      setPreviewingVoice(null);
      return;
    }

    // Stop existing preview
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
    }

    setPreviewingVoice(voiceName);

    try {
      const cacheKey = `${voiceName}_${language}_preview`;
      let audioUrl: string;

      // 1. Check persistent cache
      const cachedBlob = await getPreview(cacheKey);
      if (cachedBlob) {
        audioUrl = URL.createObjectURL(cachedBlob);
      } else {
        // 2. Fetch from API
        const blobUrl = await generateVoicePreview(voiceName, language);
        audioUrl = blobUrl;

        // 3. Save to persistent cache
        const response = await fetch(blobUrl);
        const blob = await response.blob();
        await savePreview(cacheKey, blob);
      }

      if (previewAudioRef.current) {
        previewAudioRef.current.src = audioUrl;
      } else {
        previewAudioRef.current = new Audio(audioUrl);
      }

      previewAudioRef.current.play();
      previewAudioRef.current.onended = () => setPreviewingVoice(null);
    } catch (e) {
      console.error('Preview error:', e);
      setPreviewingVoice(null);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-8">

      {/* Settings Area */}
      <div className="flex flex-col gap-8">
        <div className="flex flex-col md:flex-row justify-center gap-4 md:gap-8">

          {/* Language Toggle */}
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Language</span>
            <div className="bg-white p-1 rounded-lg border border-slate-200 inline-flex items-center shadow-sm">
              <button
                onClick={() => onLanguageChange('en')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${language === 'en' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:text-indigo-600'}`}
              >
                <span className="text-lg">🇬🇧</span> English
              </button>
              <div className="w-px h-6 bg-slate-200 mx-1"></div>
              <button
                onClick={() => onLanguageChange('de')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${language === 'de' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:text-indigo-600'}`}
              >
                <span className="text-lg">🇩🇪</span> Deutsch
              </button>
            </div>
          </div>

          {/* Mode Toggle */}
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Output Mode</span>
            <div className="bg-white p-1 rounded-lg border border-slate-200 inline-flex items-center shadow-sm">
              <button
                onClick={() => onModeChange('audio')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${mode === 'audio' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:text-indigo-600'}`}
              >
                <Headphones className="w-4 h-4" /> Narration
              </button>
              <div className="w-px h-6 bg-slate-200 mx-1"></div>
              <button
                onClick={() => onModeChange('text')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${mode === 'text' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:text-indigo-600'}`}
              >
                <FileText className="w-4 h-4" /> Text Only
              </button>
            </div>
          </div>
        </div>

        {/* Voice Selection (Only in Audio Mode) */}
        {mode === 'audio' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-col items-center gap-3"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-3 h-3 text-indigo-500" />
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Select Narrative Voice</span>
            </div>

            {/* Scrollable Gallery */}
            <div className="w-full max-w-xl bg-slate-50 p-2 rounded-2xl border border-slate-100">
              <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide px-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                {VOICE_PROFILES.map((voice) => (
                  <motion.div
                    key={voice.name}
                    whileHover={{ y: -2, scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className={`flex-none w-48 relative flex flex-col p-4 rounded-xl border-2 transition-all cursor-pointer ${selectedVoice === voice.name ? 'border-indigo-500 bg-white ring-4 ring-indigo-50 shadow-md' : 'border-transparent bg-white/60 hover:border-slate-200 shadow-sm hover:shadow-md'}`}
                    onClick={() => onVoiceChange(voice.name)}
                  >
                    <div className="flex-1 mb-3">
                      <p className={`font-bold text-sm ${selectedVoice === voice.name ? 'text-indigo-700' : 'text-slate-700'}`}>{voice.label.split(' (')[0]}</p>
                      <p className="text-[10px] text-slate-400 uppercase font-bold tracking-tighter mt-0.5">{voice.label.match(/\(([^)]+)\)/)?.[1]}</p>
                      <p className="text-[11px] text-slate-500 mt-2 leading-tight line-clamp-2">{voice.description}</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handlePreviewVoice(voice.name); }}
                      className={`flex items-center justify-center gap-2 w-full py-1.5 rounded-lg text-xs font-semibold transition-all ${previewingVoice === voice.name ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                      {previewingVoice === voice.name ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                      {previewingVoice === voice.name ? 'Playing' : 'Preview'}
                    </button>
                    {selectedVoice === voice.name && (
                      <motion.div
                        layoutId="activeVoiceGlow"
                        className="absolute inset-0 border-2 border-indigo-500 rounded-xl"
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      />
                    )}
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </div>

      <motion.div
        whileHover={{ scale: disabled ? 1 : 1.01 }}
        whileTap={{ scale: disabled ? 1 : 0.99 }}
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer shadow-sm
          ${isDragging
            ? 'border-indigo-500 bg-indigo-50 scale-[1.02] shadow-indigo-100 shadow-lg'
            : 'border-slate-300 hover:border-slate-400 bg-white hover:shadow-md'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input
          type="file"
          ref={inputRef}
          onChange={handleFileInput}
          accept="application/pdf"
          className="hidden"
          disabled={disabled}
        />

        <div className="flex flex-col items-center gap-4">
          <motion.div
            animate={isDragging ? { scale: [1, 1.2, 1], rotate: [0, -10, 10, 0] } : {}}
            transition={{ repeat: isDragging ? Infinity : 0, duration: 1 }}
            className={`p-4 rounded-full transition-colors ${isDragging ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}
          >
            <Upload className="w-8 h-8" />
          </motion.div>
          <div>
            <h3 className="text-xl font-semibold text-slate-800 mb-1">
              {language === 'de' ? 'Laden Sie Ihre akademische Arbeit hoch' : 'Upload your academic paper'}
            </h3>
            <p className="text-slate-500">
              {language === 'de' ? 'PDF hierher ziehen oder klicken.' : 'Drag and drop your PDF here, or click to browse.'}
            </p>
            <p className="text-xs text-slate-400 mt-2">
              {mode === 'audio'
                ? (language === 'de' ? `Sprecher: ${VOICE_PROFILES.find(v => v.name === selectedVoice)?.label} • Bis zu 100 Seiten` : `Voice: ${VOICE_PROFILES.find(v => v.name === selectedVoice)?.label} • Up to 100 pages`)
                : (language === 'de' ? 'Erzeugt nur Text-Transkript • Schneller' : 'Generates Text Transcript Only • Faster')
              }
            </p>
          </div>
        </div>
      </motion.div>

      {error && (
        <div className="mt-4 flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg text-sm border border-red-100">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};