/**
 * Speech-to-text provider contract for the batch / final transcript path.
 * NormalizedTranscript is exactly the shape processingService has always stored (transcripts.segments, full_text,
 * word_count, speaker_count, language) plus the provider-measured duration used by shortRecordingGuard.
 */
export interface TranscriptSegment {
  id: string;
  speaker_label: string;
  /** 0-based. transcripts.speaker_names is keyed by this index, so every provider must use the same numbering. */
  speaker_index: number;
  text: string;
  /** Seconds. */
  start_time: number;
  end_time: number;
  confidence: number;
}

export interface NormalizedTranscript {
  segments: TranscriptSegment[];
  fullText: string;
  wordCount: number;
  /** At least 1. */
  speakerCount: number;
  /** Lowercase primary language code ("en", "es"); "en" when the provider does not say. */
  detectedLanguage: string;
  /** Audio length as measured by the provider; null/absent for PDFs and when the provider omits it. */
  durationSeconds?: number | null;
}

export interface SttOptions {
  /** Vocabulary hints (names, product terms). Only providers that support them use them. */
  terms?: string[];
  /** Restrict / bias language detection. Default: auto-detect. */
  languageHints?: string[];
  /** Hard wall-clock limit for the whole call. */
  timeoutMs?: number;
  /** Recording length in seconds when the caller knows it (client-reported, may be wrong). Only used by providers with a length limit, to skip inputs they cannot take. */
  durationHintSeconds?: number;
  /**
   * Long inputs that must be split into parts: speaker numbering cannot be matched across parts. By default a provider that
   * splits refuses to merge a multi-speaker result (the caller then uses another provider). When true it returns a result whose
   * speaker indexes are unique per part (never merged across parts); only for metrics-only runs whose transcript no user sees.
   */
  allowChunkLocalSpeakers?: boolean;
}

export interface SttProvider {
  /** Stored in transcripts.transcription_provider. */
  readonly name: string;
  /** Stored in transcripts.transcription_model. */
  readonly model: string;
  transcribe(fileData: Blob, filePath: string, opts?: SttOptions): Promise<NormalizedTranscript>;
  /**
   * Optional. Returns a reason when this provider cannot take this input at all (nothing is sent anywhere), otherwise null.
   * Never throws: an inspection failure is "no objection".
   */
  precheck?(fileData: Blob, filePath: string, opts?: SttOptions): Promise<string | null>;
}

/** Whitespace word count, identical to the original Deepgram path (the short-recording guard adds its own CJK rule). */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}
