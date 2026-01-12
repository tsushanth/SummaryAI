-- Phone Calls and Verification Tables
-- Migration: 007_phone_calls.sql

-- ============================================================================
-- Verified Phones Table
-- Stores phone numbers that users have verified via SMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS verified_phones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    phone_number VARCHAR(20) NOT NULL,
    verification_code VARCHAR(6),
    verification_expires_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Each user can only have one verification per phone number
    UNIQUE(user_id, phone_number)
);

-- Index for looking up verified phones by user
CREATE INDEX IF NOT EXISTS idx_verified_phones_user_id ON verified_phones(user_id);

-- Index for looking up by phone number (for rate limiting)
CREATE INDEX IF NOT EXISTS idx_verified_phones_phone_number ON verified_phones(phone_number);

-- ============================================================================
-- Phone Calls Table
-- Stores phone call records and their associated recordings
-- ============================================================================

CREATE TYPE phone_call_status AS ENUM (
    'initiated',
    'ringing',
    'in_progress',
    'recording',
    'completed',
    'failed',
    'busy',
    'no_answer',
    'cancelled'
);

CREATE TABLE IF NOT EXISTS phone_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Call participants
    from_number VARCHAR(20) NOT NULL,
    to_number VARCHAR(20) NOT NULL,
    to_name VARCHAR(100),

    -- Twilio integration
    twilio_call_sid VARCHAR(50),
    conference_sid VARCHAR(50),
    conference_name VARCHAR(100),
    recording_sid VARCHAR(50),

    -- Call status and recording state
    status phone_call_status DEFAULT 'initiated',
    is_recording BOOLEAN DEFAULT FALSE,

    -- Recording results
    recording_url TEXT,
    recording_duration INTEGER, -- in seconds
    recording_id UUID REFERENCES recordings(id) ON DELETE SET NULL,

    -- Timestamps
    started_at TIMESTAMPTZ,
    answered_at TIMESTAMPTZ,
    recording_started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for looking up calls by user
CREATE INDEX IF NOT EXISTS idx_phone_calls_user_id ON phone_calls(user_id);

-- Index for looking up by Twilio call SID (for webhooks)
CREATE INDEX IF NOT EXISTS idx_phone_calls_twilio_sid ON phone_calls(twilio_call_sid);

-- Index for looking up by conference name (for recording webhooks)
CREATE INDEX IF NOT EXISTS idx_phone_calls_conference ON phone_calls(conference_name);

-- Index for looking up active calls
CREATE INDEX IF NOT EXISTS idx_phone_calls_status ON phone_calls(status) WHERE status IN ('initiated', 'ringing', 'in_progress', 'recording');

-- ============================================================================
-- Row Level Security
-- ============================================================================

ALTER TABLE verified_phones ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_calls ENABLE ROW LEVEL SECURITY;

-- Users can only see/modify their own verified phones
CREATE POLICY verified_phones_user_policy ON verified_phones
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Users can only see/modify their own phone calls
CREATE POLICY phone_calls_user_policy ON phone_calls
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- Updated At Trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_verified_phones_updated_at
    BEFORE UPDATE ON verified_phones
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_phone_calls_updated_at
    BEFORE UPDATE ON phone_calls
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
