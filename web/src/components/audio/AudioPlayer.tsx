'use client';

import { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { formatDuration } from '@/lib/utils/audio';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';

/** Ask the player to jump to `time` seconds. Use a fresh `nonce` for every request. */
export interface SeekRequest {
  time: number;
  nonce: number;
}

interface AudioPlayerProps {
  src: string;
  onTimeUpdate?: (time: number) => void;
  seekRequest?: SeekRequest | null;
}

const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function AudioPlayer({ src, onTimeUpdate, seekRequest }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      onTimeUpdate?.(audio.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const handleEnded = () => {
      setIsPlaying(false);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [onTimeUpdate]);

  // Jump when a transcript line or Q&A citation asks for it
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !seekRequest) return;
    audio.currentTime = Math.max(0, seekRequest.time);
    setCurrentTime(audio.currentTime);
    audio
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => {
        // Autoplay can be blocked; the position still moved
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekRequest?.nonce]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
    setIsPlaying(!isPlaying);
  };

  const seek = (time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(time, duration));
  };

  const skip = (seconds: number) => {
    seek(currentTime + seconds);
  };

  const handleSpeedChange = () => {
    const audio = audioRef.current;
    if (!audio) return;

    const currentIndex = speeds.indexOf(speed);
    const nextIndex = (currentIndex + 1) % speeds.length;
    const newSpeed = speeds[nextIndex];

    audio.playbackRate = newSpeed;
    setSpeed(newSpeed);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    seek(parseFloat(e.target.value));
  };

  return (
    <div className="bg-card border border-border/60 rounded-xl p-4">
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Progress bar */}
      <div className="mb-4">
        <input
          type="range"
          aria-label="Seek"
          aria-valuetext={`${formatDuration(currentTime)} of ${formatDuration(duration)}`}
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={handleSeek}
          className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>{formatDuration(currentTime)}</span>
          <span>{formatDuration(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-4">
        <Button variant="ghost" size="icon" aria-label="Back 15 seconds" onClick={() => skip(-15)}>
          <SkipBack className="w-5 h-5" aria-hidden="true" />
        </Button>

        <Button
          size="icon"
          className="w-12 h-12 rounded-full"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={togglePlay}
        >
          {isPlaying ? (
            <Pause className="w-6 h-6" aria-hidden="true" />
          ) : (
            <Play className="w-6 h-6 ml-1" aria-hidden="true" />
          )}
        </Button>

        <Button variant="ghost" size="icon" aria-label="Forward 15 seconds" onClick={() => skip(15)}>
          <SkipForward className="w-5 h-5" aria-hidden="true" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          aria-label={`Playback speed ${speed}x`}
          onClick={handleSpeedChange}
          className="min-w-[4rem]"
        >
          {speed}x
        </Button>

        <Button
          variant="ghost"
          size="icon"
          aria-label={isMuted ? 'Unmute' : 'Mute'}
          onClick={toggleMute}
        >
          {isMuted ? (
            <VolumeX className="w-5 h-5" aria-hidden="true" />
          ) : (
            <Volume2 className="w-5 h-5" aria-hidden="true" />
          )}
        </Button>
      </div>
    </div>
  );
}

// Expose seek method via ref
export function useAudioPlayer() {
  const [currentTime] = useState(0);

  const seek = (time: number) => {
    // Seeking is requested through AudioPlayer's `seekRequest` prop
    void time;
  };

  return { currentTime, seek };
}
