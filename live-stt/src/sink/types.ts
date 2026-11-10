/** One FINAL transcript segment, in the shape of a `live_transcripts` row (plus idempotency fields). Partials are never produced. */
export interface LiveWord {
  text: string;
  start_timestamp: { relative: number };
  end_timestamp: { relative: number };
}

export interface LiveSegment {
  /** Idempotency key: `${sessionId}:${seq}`. */
  key: string;
  seq: number;
  /** Recall bot id (from the audio payload). */
  botId: string | null;
  /** The pre-minted id the ingest URL was authenticated with. */
  ref: string;
  sessionId: string;
  segment_text: string;
  speaker_id: string;
  speaker_name: string;
  is_host: boolean;
  /** Seconds from recording start (same clock as Recall's transcript.data timestamps.relative). */
  start_timestamp: number;
  end_timestamp: number;
  words: LiveWord[];
  is_partial: false;
  language?: string | undefined;
}

export class SinkError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly status?: number) {
    super(message);
    this.name = 'SinkError';
  }
}

export interface SegmentSink {
  readonly name: string;
  /** Resolve when durably accepted. Throw SinkError(retryable) otherwise. All segments in a batch share one botId/sessionId. */
  write(batch: LiveSegment[]): Promise<void>;
}
