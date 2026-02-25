import React, { useEffect, useState } from 'react';
import { Play, Pause, SkipForward, SkipBack, Loader2, Volume2, Gauge, FileText } from 'lucide-react';
import { PlaybackState } from '../types';

interface AudioControllerProps {
  playbackState: PlaybackState;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  currentPage: number;
  totalPages: number;
  speed: number;
  onSpeedChange: (speed: number) => void;
  mode: 'audio' | 'text';
}

export const AudioController: React.FC<AudioControllerProps> = ({
  playbackState,
  onPlayPause,
  onNext,
  onPrevious,
  currentPage,
  totalPages,
  speed,
  onSpeedChange,
  mode
}) => {
  const [visuals, setVisuals] = useState<number[]>(new Array(12).fill(10));

  // Visualizer effect
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (playbackState === PlaybackState.PLAYING && mode === 'audio') {
      interval = setInterval(() => {
        setVisuals(prev => prev.map(() => 10 + Math.random() * 40));
      }, 100);
    } else {
      setVisuals(new Array(12).fill(10));
    }
    return () => clearInterval(interval);
  }, [playbackState, mode]);

  const speedOptions = [0.75, 1.0, 1.25, 1.5, 2.0];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 shadow-2xl z-50">
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        
        {/* Page Info */}
        <div className="hidden md:flex items-center gap-3 w-48">
          <div className={`${mode === 'audio' ? 'bg-indigo-100' : 'bg-slate-100'} p-2 rounded-lg`}>
             {mode === 'audio' ? <Volume2 className="w-5 h-5 text-indigo-700" /> : <FileText className="w-5 h-5 text-slate-700" />}
          </div>
          <div>
            <p className="text-sm font-medium text-slate-900">{mode === 'audio' ? 'Narration Active' : 'Text Review'}</p>
            <p className="text-xs text-slate-500">Page {currentPage} of {totalPages}</p>
          </div>
        </div>

        {/* Main Controls */}
        <div className="flex items-center gap-6 flex-1 justify-center order-1 md:order-2">
          <button 
            onClick={onPrevious}
            disabled={currentPage <= 1}
            className="p-2 text-slate-500 hover:text-indigo-600 disabled:opacity-30 transition-colors"
          >
            <SkipBack className="w-6 h-6" />
          </button>

          {mode === 'audio' ? (
            <button
              onClick={onPlayPause}
              className="w-14 h-14 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95"
            >
              {playbackState === PlaybackState.BUFFERING ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : playbackState === PlaybackState.PLAYING ? (
                <Pause className="w-6 h-6 fill-current" />
              ) : (
                <Play className="w-6 h-6 fill-current ml-1" />
              )}
            </button>
          ) : (
            <div className="w-14 h-14 flex items-center justify-center bg-slate-100 rounded-full text-slate-400 select-none cursor-default">
                <FileText className="w-6 h-6" />
            </div>
          )}

          <button 
            onClick={onNext}
            disabled={currentPage >= totalPages}
            className="p-2 text-slate-500 hover:text-indigo-600 disabled:opacity-30 transition-colors"
          >
            <SkipForward className="w-6 h-6" />
          </button>
        </div>

        {/* Speed & Visuals */}
        <div className="flex items-center gap-6 w-full md:w-auto justify-between md:justify-end order-3">
          
          {mode === 'audio' && (
            <>
              {/* Speed Control */}
              <div className="flex items-center gap-2">
                <Gauge className="w-4 h-4 text-slate-400" />
                <select 
                  value={speed}
                  onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
                  className="text-xs font-medium text-slate-600 bg-slate-100 border-none rounded-md py-1 px-2 cursor-pointer hover:bg-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {speedOptions.map(s => (
                    <option key={s} value={s}>{s}x Speed</option>
                  ))}
                </select>
              </div>

              {/* Visualizer (Fake) */}
              <div className="hidden md:flex items-center gap-1 w-24 justify-end h-8">
                {visuals.map((h, i) => (
                  <div 
                    key={i} 
                    className="w-1 bg-indigo-400 rounded-full transition-all duration-100 ease-in-out"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
            </>
          )}

          {mode === 'text' && (
             <div className="text-xs text-slate-400 w-32 text-right">
                 Synthesis Disabled
             </div>
          )}
        </div>
      </div>
    </div>
  );
};