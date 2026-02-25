export interface ProcessingState {
  totalPageCount: number;
  processedPageCount: number;
  isProcessing: boolean;
  currentPageProcessing: number;
}

export interface AudioSegment {
  text: string;
  startTime: number;
  duration: number;
  isSilence: boolean;
}

export interface NarratedPage {
  pageNumber: number;
  originalText: string; // The extracted/cleaned text
  audioUrl?: string; // Blob URL for the audio element
  segments?: AudioSegment[]; // Timing data for precise seeking
  status: 'pending' | 'analyzing' | 'extracted' | 'synthesizing' | 'ready' | 'error';
  imageUrl?: string; // Base64 of the page for reference
}

export enum PlaybackState {
  IDLE = 'IDLE',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  BUFFERING = 'BUFFERING'
}