package com.kreativekoala.summaryai.service.activation

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.android.installreferrer.api.InstallReferrerClient
import com.android.installreferrer.api.InstallReferrerStateListener
import com.kreativekoala.summaryai.service.FirebaseAnalyticsHelper

private const val TAG = "Activation"

/** Production sink: the Firebase Analytics instance the app already initialises. */
object FirebaseActivationSink : ActivationSink {
    override fun log(name: String, params: Map<String, Any>) = FirebaseAnalyticsHelper.logCustom(name, params)
    override fun setUserProperty(name: String, value: String) = FirebaseAnalyticsHelper.setUserProperty(name, value)
}

/**
 * Reads the Google Play install referrer (utm_* from a `&referrer=` Play link). Calls back exactly once, with null on
 * any failure or after [TIMEOUT_MS], so first-open is never blocked on Play services.
 */
class PlayReferrerFetcher(private val context: Context) : ReferrerFetcher {
    override fun fetch(onResult: (String?) -> Unit) {
        val handler = Handler(Looper.getMainLooper())
        var done = false
        fun finish(raw: String?) {
            handler.post {
                if (done) return@post
                done = true
                onResult(raw)
            }
        }
        handler.postDelayed({ finish(null) }, TIMEOUT_MS)
        try {
            val client = InstallReferrerClient.newBuilder(context.applicationContext).build()
            client.startConnection(object : InstallReferrerStateListener {
                override fun onInstallReferrerSetupFinished(responseCode: Int) {
                    val raw = try {
                        if (responseCode == InstallReferrerClient.InstallReferrerResponse.OK) {
                            client.installReferrer.installReferrer
                        } else null
                    } catch (e: Exception) {
                        Log.w(TAG, "install referrer read failed: ${e.javaClass.simpleName}")
                        null
                    }
                    try { client.endConnection() } catch (_: Exception) { }
                    finish(raw)
                }

                override fun onInstallReferrerServiceDisconnected() = finish(null)
            })
        } catch (e: Exception) {
            Log.w(TAG, "install referrer unavailable: ${e.javaClass.simpleName}")
            finish(null)
        }
    }

    private companion object { const val TIMEOUT_MS = 8_000L }
}

object ActivationBootstrap {
    /** Wire the tracker once from Application.onCreate and run the first-open / referrer capture. */
    fun init(context: Context) {
        val app = context.applicationContext
        val prefs = app.getSharedPreferences(ActivationTracker.PREFS_NAME, Context.MODE_PRIVATE)
        val tracker = ActivationTracker(prefs, FirebaseActivationSink)
        Activation.install(tracker)
        val kind = try {
            val info = app.packageManager.getPackageInfo(app.packageName, 0)
            installKind(info.firstInstallTime, info.lastUpdateTime)
        } catch (_: Exception) { "fresh" }
        tracker.onAppStart(kind, PlayReferrerFetcher(app))
    }
}
