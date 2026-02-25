import React, { useRef, useState } from 'react';
import { Upload, FileText, AlertCircle, Headphones } from 'lucide-react';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
  language: 'en' | 'de';
  onLanguageChange: (lang: 'en' | 'de') => void;
  mode: 'audio' | 'text';
  onModeChange: (mode: 'audio' | 'text') => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({ 
  onFileSelect, 
  disabled, 
  language, 
  onLanguageChange,
  mode,
  onModeChange
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    // Optional: Check size limit (e.g., 50MB)
    if (file.size > 50 * 1024 * 1024) {
       setError('File size too large. Please upload a file smaller than 50MB.');
       return;
    }
    onFileSelect(file);
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-8">
      
      {/* Settings Area */}
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

      <div
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer
          ${isDragging 
            ? 'border-indigo-500 bg-indigo-50 scale-[1.02]' 
            : 'border-slate-300 hover:border-slate-400 bg-white'
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
          <div className={`p-4 rounded-full ${isDragging ? 'bg-indigo-100' : 'bg-slate-100'}`}>
            <Upload className={`w-8 h-8 ${isDragging ? 'text-indigo-600' : 'text-slate-500'}`} />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-slate-800 mb-1">
              {language === 'de' ? 'Laden Sie Ihre akademische Arbeit hoch' : 'Upload your academic paper'}
            </h3>
            <p className="text-slate-500">
              {language === 'de' ? 'PDF hierher ziehen oder klicken.' : 'Drag and drop your PDF here, or click to browse.'}
            </p>
            <p className="text-xs text-slate-400 mt-2">
              {mode === 'audio' 
                ? (language === 'de' ? 'Erzeugt Audio & Text • Bis zu 100 Seiten' : 'Generates Audio & Text • Up to 100 pages')
                : (language === 'de' ? 'Erzeugt nur Text-Transkript • Schneller' : 'Generates Text Transcript Only • Faster')
              }
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};