'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useBeforeUnloadGuard } from '@/hooks/useBeforeUnloadGuard';
import {
  createIndexedDbStore,
  discardPending,
  newPendingId,
  savePending,
  shouldBlockUnload,
  uploadWithPersistence,
} from '@/lib/pendingUpload';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Mic, Upload, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AudioRecorder } from '@/components/audio/AudioRecorder';
import { UploadDropzone } from '@/components/audio/UploadDropzone';
import { ProgressBar } from '@/components/audio/ProgressBar';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { createRecording, uploadAudio, completeUpload, deleteRecording } from '@/lib/api/recordings';
import { cn } from '@/lib/utils/cn';
import { OUTPUT_LANGUAGES, outputLanguageParam } from '@/lib/outputLanguages';
import { readAudioDuration, sanitizeDurationSeconds } from '@/lib/recordingDuration';

import {
  defaultRecordingTitle,
  resolveRecordingTitle,
  submitBlockedReason,
  RECORDING_MINIMUM_HINT,
} from '@/lib/newRecordingForm';

import { track } from '@/lib/activationClient';
import { isFirstRecording, markFirstRecordingDone } from '@/lib/activation';

// Activation funnel (no-ops unless NEXT_PUBLIC_ACTIVATION_EVENTS=1). "First" = the recordings list showed an empty account.
const firstRecording = () => { try { return isFirstRecording(window.localStorage); } catch { return false; } };
function trackRecordingDone(mode: 'record' | 'upload', durationS?: number) {
  const first = firstRecording();
  if (first) {
    track('first_recording_done', { mode, ...(durationS !== undefined ? { duration_s: durationS } : {}) });
    try { markFirstRecordingDone(window.localStorage); } catch { /* storage unusable */ }
  }
}

type InputMode = 'record' | 'upload';

export default function NewRecordingPage() {
  const router = useRouter();
  const [mode, setMode] = useState<InputMode>('record');
  const [title, setTitle] = useState('');
  // Filled after mount (local time; avoids a server/client text mismatch). Used when the title box is left blank.
  const [fallbackTitle, setFallbackTitle] = useState('');
  useEffect(() => setFallbackTitle(defaultRecordingTitle()), []);
  const effectiveTitle = resolveRecordingTitle(title, fallbackTitle);
  const [outputLanguage, setOutputLanguage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const recorder = useAudioRecorder();

  // Don't let a tab close/reload lose a recording in progress or an upload in flight.
  useBeforeUnloadGuard(
    shouldBlockUnload({ isRecording: recorder.isRecording, isPaused: recorder.isPaused, isSubmitting })
  );

  // Keep the finished recording in IndexedDB until the upload succeeds (see lib/pendingUpload.ts).
  const pendingIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (recorder.audioBlob && !recorder.isRecording) {
      const blob = recorder.audioBlob;
      const id = pendingIdRef.current ?? (pendingIdRef.current = newPendingId());
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      savePending(createIndexedDbStore(), {
        id,
        title: '',
        blob,
        fileName: `recording-${Date.now()}.${ext}`,
        contentType: blob.type || 'audio/webm',
        fileSize: blob.size,
        durationSeconds: recorder.recordedSeconds,
        createdAt: Date.now(),
      }).catch(() => {}); // best effort: private mode / quota
    } else if (!recorder.audioBlob && pendingIdRef.current) {
      // A new recording was started or the old one was reset: drop the saved copy of the discarded one.
      discardPending(createIndexedDbStore(), pendingIdRef.current).catch(() => {});
      pendingIdRef.current = null;
    }
  }, [recorder.audioBlob, recorder.isRecording, recorder.recordedSeconds]);

  const handleFileSelect = useCallback((file: File) => {
    setSelectedFile(file);
    track('upload_chosen');
    if (firstRecording()) track('first_recording_started', { mode: 'upload' });
    // Auto-fill title from filename if empty
    if (!title) {
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
      setTitle(nameWithoutExt);
    }
  }, [title]);

  const handleSubmit = async () => {
    const audioBlob = mode === 'record' ? recorder.audioBlob : selectedFile;

    if (!audioBlob) {
      setSubmitError('Please record or upload an audio file');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setUploadProgress(0);

    try {
      if (mode === 'record') {
        // Browser recording: the blob stays in IndexedDB until completeUpload succeeds.
        const id = pendingIdRef.current ?? newPendingId();
        pendingIdRef.current = id;
        const ext = audioBlob.type.includes('mp4') ? 'mp4' : 'webm';
        const fileName = `recording-${Date.now()}.${ext}`;
        const contentType = audioBlob.type || 'audio/webm';
        // Recorder clock first (exact, pauses excluded); the blob's own metadata only if the clock gave nothing usable.
        const durationSeconds = recorder.recordedSeconds ?? (await readAudioDuration(audioBlob));
        const { recordingId } = await uploadWithPersistence(
          createIndexedDbStore(),
          { id, title: effectiveTitle, blob: audioBlob, fileName, contentType, fileSize: audioBlob.size, durationSeconds, createdAt: Date.now(), outputLanguage: outputLanguageParam(outputLanguage) },
          {
            create: async (req) => {
              const { recording, upload_info } = await createRecording(req);
              return { recordingId: recording.id, uploadInfo: upload_info };
            },
            upload: (info, blob, onProgress) =>
              uploadAudio(info, new File([blob], fileName, { type: contentType }), onProgress),
            complete: completeUpload,
            discardStale: deleteRecording,
            onProgress: setUploadProgress,
          }
        );
        pendingIdRef.current = null;
        trackRecordingDone('record', recorder.duration);
        router.push(`/recordings/${recordingId}`);
        return;
      }

      // Determine file details
      const fileName = selectedFile?.name || `recording-${Date.now()}.webm`;
      const contentType = audioBlob.type || 'audio/webm';
      const fileSize = audioBlob.size;
      // Uploaded file: read the length from its audio metadata (best effort, undefined if unreadable).
      const durationSeconds = sanitizeDurationSeconds(await readAudioDuration(audioBlob));

      // Step 1: Create recording in backend (gets signed upload URL)
      const { recording, upload_info } = await createRecording({
        title: effectiveTitle,
        file_name: fileName,
        content_type: contentType,
        file_size: fileSize,
        ...(durationSeconds ? { duration_seconds: durationSeconds } : {}),
        output_language: outputLanguageParam(outputLanguage),
      });

      // Step 2: Upload audio file using signed URL
      const file = audioBlob instanceof File
        ? audioBlob
        : new File([audioBlob], fileName, { type: contentType });

      await uploadAudio(upload_info, file, setUploadProgress);

      // Step 3: Complete upload and trigger processing
      await completeUpload(recording.id);

      // Navigate to recording detail page
      trackRecordingDone('upload');
      router.push(`/recordings/${recording.id}`);
    } catch (error) {
      console.error('Error creating recording:', error);
      setSubmitError(error instanceof Error ? error.message : 'Failed to create recording');
      setIsSubmitting(false);
    }
  };

  const hasAudio = mode === 'record' ? !!recorder.audioBlob && !recorder.isRecording : !!selectedFile;
  const canSubmit = hasAudio && !isSubmitting;
  const blockedReason = submitBlockedReason({ mode, hasAudio, isRecording: recorder.isRecording, isSubmitting });

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link
          href="/recordings"
          onClick={(e) => {
            if (
              shouldBlockUnload({ isRecording: recorder.isRecording, isPaused: recorder.isPaused, isSubmitting }) &&
              !window.confirm('Leave this page? Your recording in progress will be lost.')
            ) {
              e.preventDefault();
            }
          }}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Recordings
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-foreground mb-6">New Recording</h1>

      <div className="space-y-6">
        {/* Title Input */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recording Title</CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              placeholder={fallbackTitle || 'Enter a title for your recording'}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSubmitting}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Optional. Leave it blank to use &quot;{effectiveTitle}&quot;.
            </p>
          </CardContent>
        </Card>

        {/* Summary language */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Summary language</CardTitle>
          </CardHeader>
          <CardContent>
            <select
              value={outputLanguage}
              onChange={(e) => setOutputLanguage(e.target.value)}
              disabled={isSubmitting}
              aria-label="Summary language"
              className="flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="">Same language as the recording</option>
              {OUTPUT_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-muted-foreground">
              The transcript stays in the spoken language; only the summary is written in this language.
            </p>
          </CardContent>
        </Card>

        {/* Mode Toggle */}
        <div className="flex gap-2">
          <button
            onClick={() => setMode('record')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg border-2 transition-colors',
              mode === 'record'
                ? 'border-primary bg-accent text-accent-foreground'
                : 'border-border hover:border-input'
            )}
            disabled={isSubmitting}
          >
            <Mic className="h-5 w-5" />
            Record Audio
          </button>
          <button
            onClick={() => setMode('upload')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg border-2 transition-colors',
              mode === 'upload'
                ? 'border-primary bg-accent text-accent-foreground'
                : 'border-border hover:border-input'
            )}
            disabled={isSubmitting}
          >
            <Upload className="h-5 w-5" />
            Upload File
          </button>
        </div>

        {/* Recording/Upload Area */}
        <Card>
          <CardContent className="pt-6">
            {mode === 'record' ? (
              <div className="space-y-4">
                <AudioRecorder
                  isRecording={recorder.isRecording}
                  isPaused={recorder.isPaused}
                  duration={recorder.duration}
                  error={recorder.error}
                  onStart={() => {
                    track('record_clicked');
                    if (firstRecording()) track('first_recording_started', { mode: 'record' });
                    return recorder.startRecording();
                  }}
                  onStop={recorder.stopRecording}
                  onPause={recorder.pauseRecording}
                  onResume={recorder.resumeRecording}
                />
                <p className="text-xs text-muted-foreground">{RECORDING_MINIMUM_HINT}</p>
                {recorder.audioBlob && !recorder.isRecording && (
                  <div className="p-4 bg-success/10 border border-success/30 rounded-lg">
                    <p className="text-sm text-success">
                      Recording captured! Ready to upload.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <UploadDropzone
                onFileSelect={handleFileSelect}
                disabled={isSubmitting}
              />
            )}
          </CardContent>
        </Card>

        {/* Upload Progress */}
        {isSubmitting && uploadProgress > 0 && (
          <Card>
            <CardContent className="pt-6">
              <ProgressBar
                progress={uploadProgress}
                label="Uploading..."
              />
            </CardContent>
          </Card>
        )}

        {/* Error Display */}
        {submitError && (
          <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
            <p className="text-sm text-destructive">{submitError}</p>
          </div>
        )}

        {/* Submit Button */}
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full"
          size="lg"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {uploadProgress > 0 ? 'Uploading...' : 'Creating...'}
            </>
          ) : (
            'Create Recording'
          )}
        </Button>
        {blockedReason && (
          <p role="status" className="-mt-3 text-center text-sm text-muted-foreground">
            {blockedReason}
          </p>
        )}
      </div>
    </div>
  );
}
