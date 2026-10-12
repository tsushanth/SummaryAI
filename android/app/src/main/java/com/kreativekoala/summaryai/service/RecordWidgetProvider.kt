package com.kreativekoala.summaryai.service

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.kreativekoala.summaryai.MainActivity
import com.kreativekoala.summaryai.R

/**
 * Home-screen widget with a single Record button that opens the recording screen.
 */
class RecordWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        val intent = Intent(context, MainActivity::class.java).apply {
            action = MainActivity.ACTION_START_RECORDING
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pending = PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        for (id in appWidgetIds) {
            val views = RemoteViews(context.packageName, R.layout.widget_record)
            views.setOnClickPendingIntent(R.id.widget_root, pending)
            appWidgetManager.updateAppWidget(id, views)
        }
    }
}
