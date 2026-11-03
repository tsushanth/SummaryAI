package com.kreativekoala.summaryai.data.api

import com.kreativekoala.summaryai.data.auth.SessionEvents
import com.kreativekoala.summaryai.data.local.SubscriptionStatus
import com.kreativekoala.summaryai.data.local.TokenStorage
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.gotrue.Auth
import io.github.jan.supabase.gotrue.MemoryCodeVerifierCache
import io.github.jan.supabase.gotrue.MemorySessionManager
import io.github.jan.supabase.gotrue.SessionManager
import io.github.jan.supabase.gotrue.auth
import io.github.jan.supabase.gotrue.providers.builtin.Email
import kotlinx.coroutines.DelicateCoroutinesApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.Executors

/**
 * Drives the real AuthInterceptor and the real supabase-kt client against a fake GoTrue that rotates refresh
 * tokens STRICTLY: every refresh returns a new pair and invalidates the old refresh token; presenting an old one
 * returns 400 refresh_token_already_used (the production server tolerates a reuse only inside a ~10 s window,
 * which the 1 h old stored token in the 1.7.5 device failure was far outside of).
 */
@OptIn(DelicateCoroutinesApi::class)
class AuthInterceptorRotationTest {

    private class FakeTokenStorage : TokenStorage {
        override var accessToken: String? = null
        override var refreshToken: String? = null
        override var tokenExpiry: Long = 0L
        override var userId: String? = null
        override val isLoggedIn get() = accessToken != null
        override val isTokenExpired get() = System.currentTimeMillis() > tokenExpiry
        override fun saveTokens(accessToken: String, refreshToken: String?, expiresAt: Long, userId: String?) {
            this.accessToken = accessToken; this.refreshToken = refreshToken; this.tokenExpiry = expiresAt; this.userId = userId
        }
        override fun clearTokens() { accessToken = null; refreshToken = null; tokenExpiry = 0L; userId = null }
    }

    /** Fake GoTrue + fake backend on one MockWebServer. */
    private class Sim : Dispatcher() {
        private val counter = AtomicInteger(0)
        private val lock = Any()
        @Volatile var validAccess = ""
        private val validRefresh = HashSet<String>()
        val refreshCalls = AtomicInteger(0)
        val apiCalls = AtomicInteger(0)
        @Volatile var expiresIn = 3600
        @Volatile var revokeAll = false
        @Volatile var dropRefresh = false

        private fun issue(): MockResponse = synchronized(lock) {
            val n = counter.incrementAndGet()
            validAccess = "access-$n"
            validRefresh += "refresh-$n"
            val exp = System.currentTimeMillis() / 1000 + expiresIn
            val body = """{"access_token":"access-$n","token_type":"bearer","expires_in":$expiresIn,"expires_at":$exp,""" +
                """"refresh_token":"refresh-$n","user":{"id":"user-1","aud":"authenticated","role":"authenticated",""" +
                """"email":"t@example.com","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z",""" +
                """"app_metadata":{},"user_metadata":{}}}"""
            MockResponse().setResponseCode(200).setHeader("Content-Type", "application/json").setBody(body)
        }

        /** The current access token stops working (expired), like after an hour. */
        fun expireAccess() { synchronized(lock) { validAccess = "expired-${counter.get()}" } }

        override fun dispatch(request: RecordedRequest): MockResponse {
            val path = request.path ?: ""
            if (path.startsWith("/auth/v1/token")) {
                if (path.contains("grant_type=password")) return issue()
                if (path.contains("grant_type=refresh_token")) {
                    refreshCalls.incrementAndGet()
                    if (dropRefresh) return MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START)
                    val token = Regex(""""refresh_token"\\s*:\\s*"([^"]+)"""").find(request.body.readUtf8())?.groupValues?.get(1) ?: ""
                    synchronized(lock) {
                        if (revokeAll || token !in validRefresh) {
                            return MockResponse().setResponseCode(400).setHeader("Content-Type", "application/json")
                                .setBody("""{"code":400,"error_code":"refresh_token_already_used","msg":"Invalid Refresh Token: Already Used"}""")
                        }
                        validRefresh.remove(token)
                    }
                    return issue()
                }
            }
            if (path.startsWith("/api/")) {
                apiCalls.incrementAndGet()
                return if (request.getHeader("Authorization") == "Bearer $validAccess") MockResponse().setResponseCode(200).setBody("{}")
                else MockResponse().setResponseCode(401).setBody("""{"error":{"code":"UNAUTHORIZED"}}""")
            }
            return MockResponse().setResponseCode(404)
        }
    }

    private lateinit var server: MockWebServer
    private lateinit var sim: Sim
    private val sessionStore: SessionManager = MemorySessionManager() // survives a simulated process restart
    private val tokens = FakeTokenStorage()                           // survives too (encrypted prefs on a device)
    private val events = SessionEvents()
    private val lostCount = AtomicInteger(0)

    @Before fun setUp() {
        Dispatchers.setMain(Dispatchers.Unconfined)
        sim = Sim(); server = MockWebServer().also { it.dispatcher = sim; it.start() }
        GlobalScope.launch(Dispatchers.Unconfined) { events.sessionLost.collect { lostCount.incrementAndGet() } }
    }

    @After fun tearDown() { server.shutdown(); Dispatchers.resetMain() }

    private fun newClient(): SupabaseClient = createSupabaseClient(
        supabaseUrl = server.url("/").toString().trimEnd('/'),
        supabaseKey = "sb_publishable_test_key"
    ) {
        install(Auth) {
            sessionManager = sessionStore
            codeVerifierCache = MemoryCodeVerifierCache()
            enableLifecycleCallbacks = false // needs Android's main Looper
        }
    }

    /** What the app does at sign-in: the client signs in, the app mirrors the tokens into the token store. */
    private fun signIn(supabase: SupabaseClient) = runBlocking {
        kotlinx.coroutines.withTimeout(10_000) { supabase.auth.awaitInitialization() }
        kotlinx.coroutines.withTimeout(10_000) { supabase.auth.signInWith(Email) { email = "t@example.com"; password = "pw" } }
        val s = supabase.auth.currentSessionOrNull()!!
        tokens.saveTokens(s.accessToken, s.refreshToken, s.expiresAt.toEpochMilliseconds(), s.user?.id)
    }

    private fun http(supabase: SupabaseClient): OkHttpClient =
        OkHttpClient.Builder().addInterceptor(AuthInterceptor(tokens, SubscriptionStatus(), supabase, events)).build()

    private fun ping(client: OkHttpClient): Int =
        client.newCall(Request.Builder().url(server.url("/api/ping")).build()).execute().use { it.code }

    @Test fun refreshCycleTwiceInARowSucceeds() {
        val supabase = newClient(); signIn(supabase); val client = http(supabase)
        assertEquals(200, ping(client))
        sim.expireAccess()
        assertEquals("401 -> refresh -> retry (cycle 1)", 200, ping(client))
        sim.expireAccess()
        assertEquals("401 -> refresh -> retry (cycle 2)", 200, ping(client))
        assertEquals(2, sim.refreshCalls.get())
        assertEquals(0, lostCount.get())
        // the token store mirrors the rotated pair so nothing stale is left behind
        assertEquals(supabase.auth.currentSessionOrNull()!!.refreshToken, tokens.refreshToken)
        assertEquals(supabase.auth.currentSessionOrNull()!!.accessToken, tokens.accessToken)
    }

    @Test fun nearExpiryTokenIsRefreshedBeforeTheRequestAndRepeatedly() {
        sim.expiresIn = 30 // inside the 60 s proactive window
        val supabase = newClient(); signIn(supabase); val client = http(supabase)
        repeat(3) { assertEquals(200, ping(client)) }
        assertEquals(0, lostCount.get())
        assertTrue("proactive refreshes happened", sim.refreshCalls.get() >= 3)
    }

    @Test fun concurrentRequestsAfterExpiryRefreshExactlyOnce() {
        val supabase = newClient(); signIn(supabase); val client = http(supabase)
        assertEquals(200, ping(client))
        sim.expireAccess()
        val n = 8
        val pool = Executors.newFixedThreadPool(n); val start = CountDownLatch(1)
        val codes = (1..n).map { pool.submit<Int> { start.await(); ping(client) } }
        start.countDown()
        codes.forEach { assertEquals(200, it.get()) }
        pool.shutdown()
        assertEquals("single flight: one refresh, no burned token", 1, sim.refreshCalls.get())
        assertEquals(0, lostCount.get())
    }

    @Test fun processRestartKeepsTheSessionAndKeepsRefreshing() {
        run { val supabase = newClient(); signIn(supabase); val c = http(supabase); sim.expireAccess(); assertEquals(200, ping(c)) }
        // process death: a brand new client and interceptor, same persisted session and token store
        val supabase2 = newClient(); val client2 = http(supabase2)
        assertEquals(200, ping(client2))
        sim.expireAccess()
        assertEquals(200, ping(client2))
        sim.expireAccess()
        assertEquals(200, ping(client2))
        assertEquals(0, lostCount.get())
    }

    @Test fun staleStoredRefreshTokenIsNeverReplayed() {
        val supabase = newClient(); signIn(supabase); val client = http(supabase)
        val staleRefresh = tokens.refreshToken
        sim.expireAccess(); assertEquals(200, ping(client)) // rotates; the stored copy was "stale" until mirrored
        tokens.refreshToken = staleRefresh                    // worst case: the stored copy is the old, used token
        tokens.accessToken = "garbage"; tokens.tokenExpiry = 0L
        sim.expireAccess()
        assertEquals("client's own session is used, not the stored copy", 200, ping(client))
        assertEquals(0, lostCount.get())
    }

    @Test fun deadSessionSignsOutCleanlyInsteadOfLooping() {
        val supabase = newClient(); signIn(supabase); val client = http(supabase)
        sim.expireAccess(); sim.revokeAll = true
        assertEquals("caller sees the 401", 401, ping(client))
        assertEquals(1, lostCount.get())
        assertNull(tokens.accessToken); assertNull(tokens.refreshToken)
        assertNull(supabase.auth.currentSessionOrNull())
        val refreshesAfterLogout = sim.refreshCalls.get()
        assertEquals(401, ping(client)) // no session: unauthenticated request, no refresh loop
        assertEquals(refreshesAfterLogout, sim.refreshCalls.get())
        assertEquals(1, lostCount.get())
    }

    @Test fun networkFailureWhileRefreshingDoesNotSignTheUserOut() {
        val supabase = newClient(); signIn(supabase); val client = http(supabase)
        sim.expireAccess(); sim.dropRefresh = true
        assertEquals(401, ping(client))
        assertEquals(0, lostCount.get())
        assertNotNull(supabase.auth.currentSessionOrNull())
        assertNotNull(tokens.refreshToken)
        sim.dropRefresh = false
        assertEquals("recovers once the network is back", 200, ping(client))
    }
}
