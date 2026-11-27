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

      // Reached after Stop, and when the recorder stops by itself (microphone unplugged or taken away). The recording is
      // finished here in both cases, so that the audio is always handed on to be saved.
      mediaRecorder.onstop = () => {
        sampling.stop();
        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());
        if (mediaRecorderRef.current !== mediaRecorder) return; // a newer recording has taken over

        const blob = new Blob(chunksRef.current, {
          type: mediaRecorder.mimeType,
        });
        clockRef.current.stop();
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
        setState((prev) => ({
          ...prev,
          isRecording: false,
          isPaused: false,
          duration: clockRef.current.seconds(),
          audioBlob: blob,
          recordedSeconds: sanitizeDurationSeconds(clockRef.current.seconds()),
        }));
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

  // MediaRecorder.state, not only ours, decides what may be called: it turns 'inactive' by itself when the microphone
  // goes away, and pause() or resume() on an inactive recorder throws.
  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || !state.isRecording) return;
    clockRef.current.stop();
    if (recorder.state !== 'inactive') recorder.stop(); // an inactive one has stopped already: onstop finishes it
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    setState((prev) => ({ ...prev, isRecording: false, isPaused: false }));
  }, [state.isRecording]);

  const pauseRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder?.state !== 'recording') return;
    clockRef.current.pause();
    recorder.pause();
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    setState((prev) => ({ ...prev, isPaused: true }));
  }, []);

  const resumeRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder?.state !== 'paused') return;
    recorder.resume();
    clockRef.current.resume();
    timerRef.current = setInterval(() => {
      setState((prev) => ({
        ...prev,
        duration: clockRef.current.seconds(),
      }));
    }, 1000);
    setState((prev) => ({ ...prev, isPaused: false }));
  }, []);

  /**
   * Starts a new recording in place of the current one; the caller has asked the user first. A finished recording is only
   * replaced once the new one has started. One still in progress is thrown away at once.
   */
  const restartRecording = useCallback(async (): Promise<boolean> => {
    const old = mediaRecorderRef.current;
    if (old && old.state !== 'inactive') {
      if (timerRef.current) clearInterval(timerRef.current);
      old.ondataavailable = null;
      old.onstop = () => old.stream.getTracks().forEach((track) => track.stop());
      old.stop();
      samplingRef.current?.stop();
      setState((prev) => ({ ...prev, isRecording: false, isPaused: false, duration: 0, recordedSeconds: undefined, audioBlob: null }));
    }
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
