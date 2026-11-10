'use client';

import { useState, useRef, useCallback } from 'react';
import { RecordingClock, sanitizeDurationSeconds } from '@/lib/recordingDuration';

interface AudioRecorderState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  /** Final active recording time in whole seconds (pauses excluded), set when recording stops; undefined if implausible. */
  recordedSeconds: number | undefined;
  audioBlob: Blob | null;
  error: string | null;
}

export function useAudioRecorder() {
  const [state, setState] = useState<AudioRecorderState>({
    isRecording: false,
    isPaused: false,
    duration: 0,
    recordedSeconds: undefined,
    audioBlob: null,
    error: null,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const clockRef = useRef<RecordingClock>(new RecordingClock());

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4',
      });

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: mediaRecorder.mimeType,
        });
        clockRef.current.stop();
        setState((prev) => ({ ...prev, audioBlob: blob, recordedSeconds: sanitizeDurationSeconds(clockRef.current.seconds()) }));

        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start(1000);
      clockRef.current.start();

      timerRef.current = setInterval(() => {
        setState((prev) => ({
          ...prev,
          duration: clockRef.current.seconds(),
        }));
      }, 1000);

      setState({
        isRecording: true,
        isPaused: false,
        duration: 0,
        recordedSeconds: undefined,
        audioBlob: null,
        error: null,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: 'Failed to access microphone. Please grant permission.',
      }));
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && state.isRecording) {
      clockRef.current.stop();
      mediaRecorderRef.current.stop();
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      setState((prev) => ({ ...prev, isRecording: false, isPaused: false }));
    }
  }, [state.isRecording]);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && state.isRecording && !state.isPaused) {
      clockRef.current.pause();
      mediaRecorderRef.current.pause();
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      setState((prev) => ({ ...prev, isPaused: true }));
    }
  }, [state.isRecording, state.isPaused]);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && state.isRecording && state.isPaused) {
      mediaRecorderRef.current.resume();
      clockRef.current.resume();
      timerRef.current = setInterval(() => {
        setState((prev) => ({
          ...prev,
          duration: clockRef.current.seconds(),
        }));
      }, 1000);
      setState((prev) => ({ ...prev, isPaused: false }));
    }
  }, [state.isRecording, state.isPaused]);

  const reset = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    clockRef.current.reset();
    setState({
      isRecording: false,
      isPaused: false,
      duration: 0,
      recordedSeconds: undefined,
      audioBlob: null,
      error: null,
    });
  }, []);

  return {
    ...state,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    reset,
  };
}
