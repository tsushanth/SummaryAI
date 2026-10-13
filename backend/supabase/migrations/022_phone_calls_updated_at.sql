-- phone_calls has an update trigger that sets NEW.updated_at, but the table never had that column.
-- Every UPDATE therefore failed ('record "new" has no field "updated_at"'), silently, because the Twilio
-- webhooks do not check the error. Result: call rows stayed 'initiated' forever, never got their
-- twilio_call_sid, recording_sid or recording_id, even though the recording itself was saved.
-- Additive and safe to re-run. Existing rows get updated_at = created_at.
ALTER TABLE phone_calls ADD COLUMN IF NOT EXISTS updated_at timestamptz;
UPDATE phone_calls SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE phone_calls ALTER COLUMN updated_at SET DEFAULT now();
