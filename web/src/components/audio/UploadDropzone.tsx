'use client';

import { useCallback, useState } from 'react';
import { Upload, File, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface UploadDropzoneProps {
  onFileSelect: (file: File) => void;
  accept?: string;
  maxSize?: number; // in bytes
  disabled?: boolean;
}

export function UploadDropzone({
  onFileSelect,
  accept = 'audio/*',
  maxSize = 500 * 1024 * 1024, // 500MB default
  disabled = false,
}: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validateFile = useCallback(
    (file: File): boolean => {
      setError(null);

      if (!file.type.startsWith('audio/')) {
        setError('Please select an audio file');
        return false;
      }

      if (file.size > maxSize) {
        setError(`File size must be less than ${Math.round(maxSize / 1024 / 1024)}MB`);
        return false;
      }

      return true;
    },
    [maxSize]
  );

  const handleFile = useCallback(
    (file: File) => {
      if (validateFile(file)) {
        setSelectedFile(file);
        onFileSelect(file);
      }
    },
    [validateFile, onFileSelect]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      if (disabled) return;

      const file = e.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
    },
    [disabled, handleFile]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled) {
        setIsDragging(true);
      }
    },
    [disabled]
  );

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const clearFile = useCallback(() => {
    setSelectedFile(null);
    setError(null);
  }, []);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  if (selectedFile) {
    return (
      <div className="border-2 border-border rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent rounded-lg">
              <File className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{selectedFile.name}</p>
              <p className="text-xs text-muted-foreground">{formatFileSize(selectedFile.size)}</p>
            </div>
          </div>
          <button
            onClick={clearFile}
            className="p-1 hover:bg-accent rounded"
            disabled={disabled}
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={cn(
        'border-2 border-dashed rounded-lg p-8 text-center transition-colors',
        isDragging ? 'border-primary bg-accent' : 'border-input',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-muted-foreground'
      )}
    >
      <input
        type="file"
        accept={accept}
        onChange={handleInputChange}
        className="hidden"
        id="file-upload"
        disabled={disabled}
      />
      <label htmlFor="file-upload" className={disabled ? 'cursor-not-allowed' : 'cursor-pointer'}>
        <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground mb-1">
          <span className="font-medium text-primary">Click to upload</span> or drag and drop
        </p>
        <p className="text-xs text-muted-foreground">
          Audio files up to {Math.round(maxSize / 1024 / 1024)}MB
        </p>
      </label>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
