'use client';

import { useState, useCallback } from 'react';
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
import { createRecording, uploadAudio, completeUpload } from '@/lib/api/recordings';
import { ApiError } from '@/lib/api/client';
import { PaywallModal } from '@/components/subscription/PaywallModal';
import { cn } from '@/lib/utils/cn';

type InputMode = 'record' | 'upload';

export default function NewRecordingPage() {
  const router = useRouter();
  const [mode, setMode] = useState<InputMode>('record');
  const [title, setTitle] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);

  const recorder = useAudioRecorder();

  const handleFileSelect = useCallback((file: File) => {
    setSelectedFile(file);
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

    if (!title.trim()) {
      setSubmitError('Please enter a title for this recording');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setUploadProgress(0);

    try {
      // Determine file details
      const fileName = selectedFile?.name || `recording-${Date.now()}.webm`;
      const contentType = audioBlob.type || 'audio/webm';
      const fileSize = audioBlob.size;

      // Step 1: Create recording in backend (gets signed upload URL)
      const { recording, upload_info } = await createRecording({
        title: title.trim(),
        file_name: fileName,
        content_type: contentType,
        file_size: fileSize,
      });

      // Step 2: Upload audio file using signed URL
      const file = audioBlob instanceof File
        ? audioBlob
        : new File([audioBlob], fileName, { type: contentType });

      await uploadAudio(upload_info, file, setUploadProgress);

      // Step 3: Complete upload and trigger processing
      await completeUpload(recording.id);

      // Navigate to recording detail page
      router.push(`/recordings/${recording.id}`);
    } catch (error) {
      console.error('Error creating recording:', error);
      if (error instanceof ApiError && error.status === 403) {
        setShowPaywall(true);
      } else {
        setSubmitError(error instanceof Error ? error.message : 'Failed to create recording');
      }
      setIsSubmitting(false);
    }
  };

  const canSubmit =
    title.trim() &&
    ((mode === 'record' && recorder.audioBlob) ||
      (mode === 'upload' && selectedFile)) &&
    !isSubmitting;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {showPaywall && <PaywallModal onClose={() => setShowPaywall(false)} />}
      <div className="mb-6">
        <Link
          href="/recordings"
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Recordings
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Recording</h1>

      <div className="space-y-6">
        {/* Title Input */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recording Title</CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              placeholder="Enter a title for your recording"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSubmitting}
            />
          </CardContent>
        </Card>

        {/* Mode Toggle */}
        <div className="flex gap-2">
          <button
            onClick={() => setMode('record')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg border-2 transition-colors',
              mode === 'record'
                ? 'border-blue-600 bg-blue-50 text-blue-700'
                : 'border-gray-200 hover:border-gray-300'
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
                ? 'border-blue-600 bg-blue-50 text-blue-700'
                : 'border-gray-200 hover:border-gray-300'
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
                  onStart={recorder.startRecording}
                  onStop={recorder.stopRecording}
                  onPause={recorder.pauseRecording}
                  onResume={recorder.resumeRecording}
                />
                {recorder.audioBlob && !recorder.isRecording && (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm text-green-700">
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
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">{submitError}</p>
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
      </div>
    </div>
  );
}
