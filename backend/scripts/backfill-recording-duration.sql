-- ONE-OFF DATA BACKFILL, NOT A MIGRATION. Not applied by anything; the project owner (session -af) runs it.
--
-- Why: recordings created from the web app before the duration fix have duration_seconds NULL, so the detail page had no length
-- (it printed 0:00). New recordings are filled by the backend after transcription (services/recordingDuration.ts). The provider's
-- measured length is not stored on its own; the closest value that is stored is the end of the last transcript segment, which is
-- within a few seconds of the audio length (it can be shorter by trailing silence). Rows with no transcript are left NULL (the page
-- now hides the length for those).
--
-- Safe to re-run: only rows whose duration_seconds is NULL or 0 are touched; a client value is never overwritten.
-- Preview first (read-only):
--   SELECT count(*) FROM recordings r WHERE (r.duration_seconds IS NULL OR r.duration_seconds = 0)
--     AND EXISTS (SELECT 1 FROM transcripts t WHERE t.recording_id = r.id);

WITH measured AS (
  SELECT t.recording_id,
         ceil(max((s.value ->> 'end_time')::numeric))::int AS secs
  FROM transcripts t
  CROSS JOIN LATERAL jsonb_array_elements(t.segments) AS s(value)
  WHERE jsonb_typeof(t.segments) = 'array'
    AND (s.value ->> 'end_time') ~ '^[0-9]+(\.[0-9]+)?$'
  GROUP BY t.recording_id
)
UPDATE recordings r
SET duration_seconds = m.secs
FROM measured m
WHERE m.recording_id = r.id
  AND (r.duration_seconds IS NULL OR r.duration_seconds = 0)
  AND m.secs BETWEEN 1 AND 86400;
