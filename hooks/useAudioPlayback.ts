import { useState, useEffect, useRef } from 'react';
import { NarratedPage, PlaybackState } from '../types';

interface UseAudioPlaybackProps {
    pages: NarratedPage[];
    currentPlayingPage: number;
    setCurrentPlayingPage: React.Dispatch<React.SetStateAction<number>>;
    playbackSpeed: number;
    processingMode: 'audio' | 'text';
    totalPages: number;
    title?: string;
}

const SEEK_SAFETY_BUFFER_SECONDS = 0.05;

export function useAudioPlayback({
    pages,
    currentPlayingPage,
    setCurrentPlayingPage,
    playbackSpeed,
    processingMode,
    totalPages,
    title = "Academic Paper"
}: UseAudioPlaybackProps) {
    const [playbackState, setPlaybackState] = useState<PlaybackState>(PlaybackState.IDLE);
    const [currentTime, setCurrentTime] = useState(0);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    // Refs to give the stable audio event handlers access to latest values without stale closures
    const totalPagesRef = useRef(totalPages);
    const playbackStateRef = useRef(playbackState);
    useEffect(() => { totalPagesRef.current = totalPages; }, [totalPages]);
    useEffect(() => { playbackStateRef.current = playbackState; }, [playbackState]);

    // Initialize Audio
    useEffect(() => {
        if (!audioRef.current) {
            const audio = new Audio();
            audio.preload = "auto";
            audio.preservesPitch = true;
            audioRef.current = audio;
        }

        const audio = audioRef.current;
        const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
        const handleEnded = () => {
            // Reliable fallback when the 100ms interval is throttled (backgrounded tab).
            // Uses refs so this stable handler always sees the latest totalPages value.
            if (totalPagesRef.current > 0) {
                setCurrentPlayingPage(prev => {
                    if (prev < totalPagesRef.current) return prev + 1;
                    setPlaybackState(PlaybackState.IDLE);
                    return prev;
                });
            }
        };

        audio.addEventListener('timeupdate', handleTimeUpdate);
        audio.addEventListener('ended', handleEnded);

        return () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.removeEventListener('ended', handleEnded);
        };
    }, []);

    // Media Session API (Lock Screen Controls)
    useEffect(() => {
        if ('mediaSession' in navigator && audioRef.current) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: title,
                artist: 'Academic Paper Narrator',
                album: `Page ${currentPlayingPage} of ${totalPages}`,
                artwork: [
                    { src: 'https://cdn-icons-png.flaticon.com/512/3308/3308395.png', sizes: '512x512', type: 'image/png' }
                ]
            });

            navigator.mediaSession.setActionHandler('play', () => setPlaybackState(PlaybackState.PLAYING));
            navigator.mediaSession.setActionHandler('pause', () => setPlaybackState(PlaybackState.PAUSED));
            navigator.mediaSession.setActionHandler('previoustrack', () => {
                if (currentPlayingPage > 1) setCurrentPlayingPage(p => p - 1);
            });
            navigator.mediaSession.setActionHandler('nexttrack', () => {
                if (currentPlayingPage < totalPages) setCurrentPlayingPage(p => p + 1);
            });
        }
    }, [currentPlayingPage, totalPages, title]);

    useEffect(() => {
        if (audioRef.current) audioRef.current.playbackRate = playbackSpeed;
    }, [playbackSpeed]);

    // Handle source changes and play/pause
    useEffect(() => {
        if (processingMode === 'text') return;

        const audio = audioRef.current;
        if (!audio) return;

        if (totalPages === 0 || pages.length === 0) {
            audio.pause();
            audio.src = '';
            setPlaybackState(PlaybackState.IDLE);
            return;
        }

        const page = pages[currentPlayingPage - 1];

        if (!page || ['analyzing', 'extracted', 'synthesizing', 'pending'].includes(page.status)) {
            if (playbackState === PlaybackState.PLAYING) setPlaybackState(PlaybackState.BUFFERING);
            return;
        }

        if (page.status === 'ready' && !page.audioUrl) {
            if (playbackState === PlaybackState.PLAYING) {
                if (currentPlayingPage < totalPages) setCurrentPlayingPage(p => p + 1);
                else setPlaybackState(PlaybackState.IDLE);
            }
            return;
        }

        if (page.status === 'ready' && page.audioUrl) {
            const isNewSrc = audio.src !== page.audioUrl;
            if (isNewSrc) {
                audio.src = page.audioUrl;
                audio.load();
                audio.currentTime = 0;
                if (playbackState === PlaybackState.PLAYING) {
                    audio.play().catch(e => console.log("Auto-play prevented", e));
                }
            }

            if (playbackState === PlaybackState.PLAYING && audio.paused) {
                audio.play().catch(console.warn);
            } else if (playbackState === PlaybackState.PAUSED && !audio.paused) {
                audio.pause();
            }
        }

        if (playbackState === PlaybackState.BUFFERING && page?.status === 'ready') setPlaybackState(PlaybackState.PLAYING);
    }, [currentPlayingPage, pages, playbackState, totalPages, processingMode, setCurrentPlayingPage]);

    // Continuous playback check
    useEffect(() => {
        if (processingMode === 'text') return;

        const interval = setInterval(() => {
            const audio = audioRef.current;
            if (!audio || playbackState !== PlaybackState.PLAYING) return;

            const page = pages[currentPlayingPage - 1];
            if (!page || !page.segments || page.segments.length === 0) return;

            const end = page.segments[page.segments.length - 1].startTime + page.segments[page.segments.length - 1].duration;

            if (audio.currentTime >= end - 0.1) {
                if (currentPlayingPage < totalPages) setCurrentPlayingPage(p => p + 1);
                else setPlaybackState(PlaybackState.IDLE);
            }
        }, 100);
        return () => clearInterval(interval);
    }, [playbackState, currentPlayingPage, pages, totalPages, processingMode, setCurrentPlayingPage]);

    const togglePlayPause = () => setPlaybackState(prev =>
        (prev === PlaybackState.PLAYING || prev === PlaybackState.BUFFERING) ? PlaybackState.PAUSED : PlaybackState.PLAYING
    );

    const handleWordDoubleClick = (wordIndex: number) => {
        if (processingMode === 'text') return;
        const audio = audioRef.current;
        if (!audio) return;
        const page = pages[currentPlayingPage - 1];
        if (!page || !page.segments) return;

        let targetSeekTime = 0;
        if (page.segments.length > 1) {
            targetSeekTime = page.segments[wordIndex]?.startTime || 0;
        } else {
            targetSeekTime = page.segments[0]?.startTime || 0;
        }

        audio.currentTime = Math.max(0, targetSeekTime - SEEK_SAFETY_BUFFER_SECONDS);
        if (playbackState !== PlaybackState.PLAYING) {
            setPlaybackState(PlaybackState.PLAYING);
            audio.play().catch(console.error);
        }
    };

    return {
        playbackState,
        setPlaybackState,
        togglePlayPause,
        handleWordDoubleClick,
        audioRef,
        currentTime
    };
}
