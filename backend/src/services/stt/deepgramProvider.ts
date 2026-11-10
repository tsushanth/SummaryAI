/**
 * Deepgram prerecorded transcription (nova-2). Moved verbatim from processingService.transcribeWithDeepgram:
 * same URL and parameters, same headers, same mapping, same error behaviour. Covered by golden tests.
 */
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config/index.js';
import { reportProviderFailure, reportProviderHttpFailure } from '../../lib/alerts.js';
import { deepgramLanguageParam } from '../../lib/transcriptionLanguage.js';
import { countWords, type NormalizedTranscript, type SttProvider, type TranscriptSegment } from './types.js';

export const DEEPGRAM_MODEL = 'nova-2';

async function transcribeWithDeepgram(audioData: Blob, filePath: string, languageHint?: string): Promise<NormalizedTranscript> {
  const arrayBuffer = await audioData.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Determine content type from file extension
  const ext = filePath.split('.').pop()?.toLowerCase() || 'm4a';
  const contentType = ext === 'wav' ? 'audio/wav' : ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4';

  // Auto-detect by default. A language the user chose for the meeting (and nova-2 supports) is pinned instead; `language` and
  // `detect_language` are mutually exclusive, so exactly one of them is sent.
  const pinned = deepgramLanguageParam(languageHint);
  const post = async (languageQuery: string): Promise<Response> => {
    try {
      return await fetch(`https://api.deepgram.com/v1/listen?model=${DEEPGRAM_MODEL}&smart_format=true&diarize=true&paragraphs=true&utterances=true&${languageQuery}`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${config.DEEPGRAM_API_KEY}`,
          'Content-Type': contentType,
        },
        body: buffer,
      });
    } catch (e) {
      reportProviderFailure('deepgram', e);
      throw e;
    }
  };
  let response = await post(pinned ? `language=${pinned}` : 'detect_language=true');
  if (pinned && response.status === 400) {
    // Deepgram rejected the pinned language (list drift): the recording must still be transcribed, so fall back to detection.
    console.warn('[Deepgram] pinned language rejected; retrying with detect_language');
    response = await post('detect_language=true');
  }

  if (!response.ok) {
    const errorText = await response.text();
    // A rejected key or exhausted credit fails EVERY recording: classified here into one provider-wide alert.
    reportProviderHttpFailure('deepgram', response.status);
    throw new Error(`Deepgram API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json() as any;

  // Extract detected language from Deepgram response
  const detectedLanguage = result.results?.channels?.[0]?.detected_language || pinned || 'en';

  // Extract utterances/paragraphs as segments
  const utterances = result.results?.utterances || [];
  const segments: TranscriptSegment[] = utterances.map((u: any) => ({
    id: uuidv4(),
    speaker_label: `Speaker ${u.speaker || 0}`,
    speaker_index: u.speaker || 0,
    text: u.transcript || '',
    start_time: u.start || 0,
    end_time: u.end || 0,
    confidence: u.confidence || 0.9,
  }));

  // Extract full transcript
  const fullText = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';

  // Count words
  const wordCount = countWords(fullText);

  // Count unique speakers
  const speakers = new Set(segments.map((s: TranscriptSegment) => s.speaker_index));
  const speakerCount = Math.max(1, speakers.size);

  const rawDuration = Number(result.metadata?.duration);
  const durationSeconds = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null;

  return { segments, fullText, wordCount, speakerCount, detectedLanguage, durationSeconds };
}

export const deepgramProvider: SttProvider = {
  name: 'deepgram',
  model: DEEPGRAM_MODEL,
  transcribe: (fileData, filePath, opts) => transcribeWithDeepgram(fileData, filePath, opts?.languageHints?.[0]),
};
