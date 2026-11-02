package com.kreativekoala.summaryai.service.activation

import com.kreativekoala.summaryai.testutil.FakeSharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

private class RecordingSink : ActivationSink {
    data class Event(val name: String, val params: Map<String, Any>)
    val events = mutableListOf<Event>()
    val props = mutableMapOf<String, String>()
    override fun log(name: String, params: Map<String, Any>) { events += Event(name, params) }
    override fun setUserProperty(name: String, value: String) { props[name] = value }
    fun names() = events.map { it.name }
    fun last() = events.last()
}

private class FakeFetcher(private val raw: String?) : ReferrerFetcher {
    var calls = 0
    var pending: ((String?) -> Unit)? = null
    var deferred = false
    override fun fetch(onResult: (String?) -> Unit) {
        calls++
        if (deferred) pending = onResult else onResult(raw)
    }
}

class ActivationTrackerTest {
    private lateinit var prefs: FakeSharedPreferences
    private lateinit var sink: RecordingSink
    private var now = 1_000_000_000_000L
    private fun tracker() = ActivationTracker(prefs, sink) { now }

    @Before fun setUp() {
        prefs = FakeSharedPreferences()
        sink = RecordingSink()
    }

    // ---- first open + install referrer -------------------------------------------------------

    @Test fun firstOpenFiresOnceWithUtmFromTheReferrer() {
        val t = tracker()
        val fetcher = FakeFetcher("utm_source=outreach&utm_medium=email&utm_campaign=nov_pilot")
        t.onAppStart("fresh", fetcher)
        t.onAppStart("fresh", fetcher)
        assertEquals(listOf(ActivationEvents.FIRST_OPEN), sink.names())
        assertEquals(1, fetcher.calls)
        val p = sink.last().params
        assertEquals("outreach", p["utm_source"])
        assertEquals("email", p["utm_medium"])
        assertEquals("nov_pilot", p["utm_campaign"])
        assertEquals("fresh", p["install_kind"])
        assertEquals("outreach", sink.props["install_source"])
    }

    @Test fun missingReferrerStillFiresFirstOpenWithNone() {
        tracker().onAppStart("fresh", FakeFetcher(null))
        assertEquals(listOf(ActivationEvents.FIRST_OPEN), sink.names())
        assertEquals("none", sink.last().params["utm_source"])
    }

    @Test fun referrerIsStoredOnceAndSurvivesRestart() {
        tracker().onAppStart("fresh", FakeFetcher("utm_source=a&utm_medium=b"))
        sink.events.clear()
        val second = tracker()
        val fetcher = FakeFetcher("utm_source=other")
        second.onAppStart("fresh", fetcher)
        assertTrue(sink.events.isEmpty())
        assertEquals(0, fetcher.calls)
        assertEquals("a", second.storedReferrer().source)
        assertEquals("b", second.storedReferrer().medium)
    }

    @Test fun aSlowReferrerCallbackDoesNotFireTwice() {
        val t = tracker()
        val fetcher = FakeFetcher("utm_source=a").also { it.deferred = true }
        t.onAppStart("fresh", fetcher)
        t.onAppStart("fresh", fetcher) // second launch path while the first is still connecting
        assertEquals(1, fetcher.calls)
        fetcher.pending!!.invoke("utm_source=a")
        fetcher.pending!!.invoke("utm_source=a") // a client may call back twice
        assertEquals(1, sink.names().count { it == ActivationEvents.FIRST_OPEN })
    }

    @Test fun parserKeepsOnlyTheThreeUtmKeysAndSanitisesThem() {
        val r = InstallReferrerParser.parse("utm_source=Google%20Ads&utm_medium=cpc&gclid=abc&email=a%40b.com&utm_campaign=x<script>")
        assertEquals("Google Ads", r.source)
        assertEquals("cpc", r.medium)
        assertEquals("x_script_", r.campaign)
    }

    @Test fun parserHandlesDoubleEncodedAndEmptyInput() {
        val enc = InstallReferrerParser.parse("utm_source%3Dfoo%26utm_medium%3Dbar")
        assertEquals("foo", enc.source)
        assertEquals("bar", enc.medium)
        assertNull(InstallReferrerParser.parse("").source)
        assertNull(InstallReferrerParser.parse(null).source)
        assertNull(InstallReferrerParser.parse("garbage").source)
    }

    @Test fun parserCapsValueLength() {
        val r = InstallReferrerParser.parse("utm_campaign=" + "z".repeat(500))
        assertEquals(100, r.campaign!!.length)
    }

    @Test fun installKindDistinguishesFreshInstallsFromUpdates() {
        assertEquals("fresh", installKind(firstInstallTime = 1_000, lastUpdateTime = 1_000))
        assertEquals("fresh", installKind(firstInstallTime = 1_000, lastUpdateTime = 1_000 + 60_000))
        assertEquals("update", installKind(firstInstallTime = 1_000, lastUpdateTime = 1_000 + 3_600_000))
    }

    // ---- funnel events ---------------------------------------------------------------------

    @Test fun signupDoneFiresOncePerInstallWithMethodOnly() {
        val t = tracker()
        t.signupDone("google")
        t.signupDone("email")
        assertEquals(listOf(ActivationEvents.SIGNUP_DONE), sink.names())
        assertEquals(mapOf<String, Any>("method" to "google"), sink.last().params)
    }

    @Test fun onboardingShownOnceThenSkippedWhenUserLeavesWithoutRecording() {
        val t = tracker()
        t.firstRunPromptShown()
        t.firstRunPromptShown()
        t.leftFirstRunPrompt("sample")
        t.leftFirstRunPrompt("list")
        assertEquals(listOf(ActivationEvents.ONBOARDING_SHOWN, ActivationEvents.ONBOARDING_SKIPPED), sink.names())
        assertEquals("sample", sink.last().params["to"])
    }

    @Test fun leavingTheFirstRunPromptAfterTappingRecordIsNotASkip() {
        val t = tracker()
        t.firstRunPromptShown()
        t.recordTapped()
        t.leftFirstRunPrompt("list")
        assertFalse(sink.names().contains(ActivationEvents.ONBOARDING_SKIPPED))
    }

    @Test fun leavingWithoutEverSeeingThePromptIsNotASkip() {
        tracker().leftFirstRunPrompt("list")
        assertTrue(sink.events.isEmpty())
    }

    @Test fun recordTappedFlagsTheFirstTapOnly() {
        val t = tracker()
        t.recordTapped()
        t.recordTapped()
        assertEquals(true, sink.events[0].params["is_first"])
        assertEquals(false, sink.events[1].params["is_first"])
    }

    @Test fun micPermissionResultsAreLogged() {
        val t = tracker()
        t.micPermission(true)
        t.micPermission(false)
        assertEquals(listOf(ActivationEvents.MIC_GRANTED, ActivationEvents.MIC_DENIED), sink.names())
    }

    @Test fun firstRecordingStartedAndSecondRecording() {
        val t = tracker()
        t.firstOpenFor(this)
        now += 2 * 86_400_000L + 5_000
        t.recordingStarted()
        t.recordingStarted()
        t.recordingStarted()
        val names = sink.names().filter { it != ActivationEvents.FIRST_OPEN }
        assertEquals(listOf(ActivationEvents.FIRST_RECORDING_STARTED, ActivationEvents.SECOND_RECORDING), names)
        assertEquals(2, sink.events.last { it.name == ActivationEvents.SECOND_RECORDING }.params["days_since_first_open"])
    }

    @Test fun firstRecordingFinishedCarriesADurationBucketNotTheExactLength() {
        val t = tracker()
        t.recordingFinished(13)
        t.recordingFinished(500)
        assertEquals(listOf(ActivationEvents.FIRST_RECORDING_FINISHED), sink.names())
        assertEquals("10_30s", sink.last().params["duration_bucket"])
        assertFalse(sink.last().params.containsKey("duration_seconds"))
    }

    @Test fun durationBuckets() {
        assertEquals("lt2s", durationBucket(0))
        assertEquals("lt2s", durationBucket(1))
        assertEquals("2_10s", durationBucket(2))
        assertEquals("2_10s", durationBucket(9))
        assertEquals("10_30s", durationBucket(10))
        assertEquals("30_120s", durationBucket(30))
        assertEquals("30_120s", durationBucket(119))
        assertEquals("gt120s", durationBucket(120))
    }

    @Test fun firstSummaryViewedOncePerKind() {
        val t = tracker()
        t.summaryViewed(sample = true)
        t.summaryViewed(sample = true)
        t.summaryViewed(sample = false)
        t.summaryViewed(sample = false)
        assertEquals(2, sink.events.size)
        assertEquals("sample", sink.events[0].params["kind"])
        assertEquals("real", sink.events[1].params["kind"])
    }

    @Test fun sampleDeletedIsLoggedOnce() {
        val t = tracker()
        t.sampleDeleted()
        t.sampleDeleted()
        assertEquals(listOf(ActivationEvents.SAMPLE_DELETED), sink.names())
    }

    // ---- privacy / Firebase constraints ------------------------------------------------------

    @Test fun everyEventNameIsAValidNonReservedFirebaseName() {
        val reserved = setOf("first_open", "first_visit", "session_start", "app_update", "app_remove", "user_engagement")
        ActivationEvents.ALL.forEach { name ->
            assertTrue("$name too long", name.length <= 40)
            assertTrue("$name invalid chars", Regex("^[a-zA-Z][a-zA-Z0-9_]*$").matches(name))
            assertFalse("$name reserved", name in reserved)
        }
        assertEquals(ActivationEvents.ALL.size, ActivationEvents.ALL.toSet().size)
    }

    @Test fun noEventCarriesContentLikeParams() {
        val t = tracker()
        t.onAppStart("fresh", FakeFetcher("utm_source=x&email=me%40example.com"))
        t.signupDone("email"); t.firstRunPromptShown(); t.recordTapped(); t.micPermission(true)
        t.recordingStarted(); t.recordingStarted(); t.recordingFinished(40); t.summaryViewed(false); t.summaryViewed(true)
        t.leftFirstRunPrompt("list"); t.sampleDeleted()
        val banned = setOf("email", "title", "text", "transcript", "name", "user_id")
        sink.events.forEach { e ->
            e.params.forEach { (k, v) ->
                assertFalse("${e.name}.$k is not allowed", k in banned)
                assertTrue("${e.name}.$k must be a short scalar", v is Boolean || v is Int || v is Long || (v is String && v.length <= 100))
                assertFalse("${e.name}.$k looks like an email", v is String && v.contains("@"))
            }
        }
    }
}

/** Test helper: pretend the first open happened at the fake clock's current time. */
private fun ActivationTracker.firstOpenFor(@Suppress("UNUSED_PARAMETER") test: Any) =
    onAppStart("fresh", FakeFetcher(null))
