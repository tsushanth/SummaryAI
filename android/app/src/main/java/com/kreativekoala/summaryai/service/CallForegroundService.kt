package com.kreativekoala.summaryai.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.kreativekoala.summaryai.MainActivity
import com.kreativekoala.summaryai.R
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * Keeps the microphone working during a phone call while the app is in the background, with an ongoing notification that
 * can end the call. Uses the microphone service type the recorder already declares; no extra permission.
 */
@AndroidEntryPoint
class CallForegroundService : Service() {

    @Inject lateinit var voip: VoipService

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_END) {
            voip.disconnect()
            stopSelf()
            return START_NOT_STICKY
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, getString(R.string.phone_notification_channel), NotificationManager.IMPORTANCE_LOW)
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val end = PendingIntent.getService(
            this, 1, Intent(this, CallForegroundService::class.java).setAction(ACTION_END),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_tile_record)
            .setContentTitle(getString(R.string.phone_notification_title))
            .setContentIntent(open)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .addAction(0, getString(R.string.ui_end_call), end)
            .build()
        try {
            ServiceCompat.startForeground(
                this, NOTIFICATION_ID, notification,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
            )
        } catch (e: Exception) {
            // The call itself goes on; only background microphone access is at risk.
            Log.w(TAG, "could not enter the foreground: ${e.javaClass.simpleName}")
            stopSelf()
        }
        // The call may have ended before the service started.
        if (!voip.hasActiveCall()) stopSelf()
        return START_NOT_STICKY
    }

    companion object {
        private const val TAG = "CallForegroundService"
        private const val CHANNEL_ID = "phone_call_channel"
        private const val NOTIFICATION_ID = 4201
        private const val ACTION_END = "com.kreativekoala.summaryai.action.END_CALL"

        /**
         * Called while the app is on screen, so a plain start is allowed; unlike startForegroundService it cannot crash
         * the app when the call ends before the service has started.
         */
        fun start(context: Context) {
            runCatching { context.startService(Intent(context, CallForegroundService::class.java)) }
                .onFailure { Log.w(TAG, "could not start: ${it.javaClass.simpleName}") }
        }

        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, CallForegroundService::class.java)) }
        }
    }
}
