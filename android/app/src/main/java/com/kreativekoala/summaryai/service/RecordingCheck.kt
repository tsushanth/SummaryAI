package com.kreativekoala.summaryai.service

/** Why a stopped recording is held back from upload until the user chooses what to do with it. */
enum class RecordingProblem { TOO_SHORT, SILENT }

/**
 * Looked at when the user taps Stop. A recording that would only come back as "no speech" is not uploaded; the
 * recorder is paused (nothing is finalised or deleted) and the user chooses to keep going or to record again.
 */
object RecordingCheck {
    const val MIN_SECONDS = 10

    /** 1% of full scale. A muted or covered microphone and an empty room stay under it; speech is far above it. */
    const val SILENT_PEAK = 328

    /** The first MediaRecorder level read always returns 0, so one read says nothing. */
    const val MIN_LEVEL_SAMPLES = 2

    /** [peak] is the loudest level of the whole recording (0..32767), null when it could not be measured. */
    fun problem(durationSeconds: Int, peak: Int?): RecordingProblem? = when {
        durationSeconds < MIN_SECONDS -> RecordingProblem.TOO_SHORT
        peak != null && peak < SILENT_PEAK -> RecordingProblem.SILENT
        else -> null
    }

    /**
     * A long recording that measured as silent can still be sent if the user asks: the level reading can be wrong
     * (distant speakers, an unusual microphone) and a real meeting must never be stuck on the phone.
     */
    fun canUploadAnyway(problem: RecordingProblem, durationSeconds: Int): Boolean =
        problem == RecordingProblem.SILENT && durationSeconds >= MIN_SECONDS
}
