'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { RecordingClock, sanitizeDurationSeconds } from '@/lib/recordingDuration';
import { LevelMeter, openAudioContext, startLevelSampling, type LevelSampling } from '@/lib/recordingCheck';

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
  const meterRef = useRef<LevelMeter>(new LevelMeter());
  const samplingRef = useRef<LevelSampling | null>(null);

  /** Resolves true when recording started, false when the microphone could not be opened. */
  const startRecording = useCallback(async (): Promise<boolean> => {
    samplingRef.current?.stop();
    const levelContext = openAudioContext(); // before the await, while this is still the click
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

      meterRef.current = new LevelMeter();
      const sampling = startLevelSampling(levelContext, stream, meterRef.current, () => mediaRecorder.state === 'recording');
      samplingRef.current = sampling;

      mediaRecorder.onstop = () => {
        sampling.stop();
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
      return true;
    } catch (error) {
      levelContext?.close().catch(() => {});
      setState((prev) => ({
        ...prev,
        error: 'Failed to access microphone. Please grant permission.',
      }));
      return false;
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

  /** Throws away the recording in progress and starts a new one. */
  const restartRecording = useCallback(async (): Promise<boolean> => {
    const old = mediaRecorderRef.current;
    if (timerRef.current) clearInterval(timerRef.current);
    if (old && old.state !== 'inactive') {
      old.ondataavailable = null;
      old.onstop = () => old.stream.getTracks().forEach((track) => track.stop());
      old.stop();
    }
    // The old recording is gone even if the microphone cannot be opened again.
    setState((prev) => ({ ...prev, isRecording: false, isPaused: false, duration: 0, recordedSeconds: undefined, audioBlob: null }));
    return startRecording();
  }, [startRecording]);

  /** Active recording time so far, in whole seconds, pauses excluded. */
  const activeSeconds = useCallback(() => clockRef.current.seconds(), []);

  /** Loudest level of this recording (0..1), or null when it could not be judged. */
  const measuredPeak = useCallback(() => {
    samplingRef.current?.sampleNow();
    return meterRef.current.peak(clockRef.current.seconds());
  }, []);

  // Leaving the page mid-recording must not leave the meter running.
  useEffect(() => () => samplingRef.current?.stop(), []);

  const reset = useCallback(() => {
    samplingRef.current?.stop();
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
    restartRecording,
    activeSeconds,
    measuredPeak,
    reset,
  };
}
