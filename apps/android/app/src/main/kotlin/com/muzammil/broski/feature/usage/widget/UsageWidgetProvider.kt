package com.muzammil.broski.feature.usage.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.view.View
import android.widget.RemoteViews
import com.muzammil.broski.R
import com.muzammil.broski.app.MainActivity
import com.muzammil.broski.core.usage.PlanReport
import com.muzammil.broski.core.usage.PlanIds
import com.muzammil.broski.core.usage.UsageStore
import com.muzammil.broski.feature.usage.formatCountdown
import kotlin.math.roundToInt

/**
 * Native Android Home Screen widget showing the first two plans' usage from [UsageStore].
 * Tapping opens Broski directly to the Plan Usage screen.
 */
class UsageWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        val report = UsageStore(context).load()
        val nowMs = System.currentTimeMillis()
        for (widgetId in appWidgetIds) {
            appWidgetManager.updateAppWidget(widgetId, buildViews(context, report?.plans.orEmpty(), nowMs))
        }
    }

    private fun buildViews(context: Context, plans: List<PlanReport>, nowMs: Long): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_usage)
        val openIntent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(EXTRA_OPEN_USAGE, true)
        val pending = PendingIntent.getActivity(
            context,
            REQUEST_OPEN_USAGE,
            openIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        views.setOnClickPendingIntent(R.id.widget_root, pending)

        val first = plans.getOrNull(0)
        val second = plans.getOrNull(1)
        if (first == null) {
            views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
            views.setViewVisibility(R.id.widget_plan_1, View.GONE)
            views.setViewVisibility(R.id.widget_plan_2, View.GONE)
            return views
        }

        views.setViewVisibility(R.id.widget_empty, View.GONE)
        bindPlan(
            context = context,
            views = views,
            containerId = R.id.widget_plan_1,
            nameId = R.id.widget_plan_1_name,
            metaId = R.id.widget_plan_1_meta,
            percentId = R.id.widget_plan_1_percent,
            progressId = R.id.widget_plan_1_progress,
            plan = first,
            nowMs = nowMs,
        )
        if (second != null) {
            bindPlan(
                context = context,
                views = views,
                containerId = R.id.widget_plan_2,
                nameId = R.id.widget_plan_2_name,
                metaId = R.id.widget_plan_2_meta,
                percentId = R.id.widget_plan_2_percent,
                progressId = R.id.widget_plan_2_progress,
                plan = second,
                nowMs = nowMs,
            )
        } else {
            views.setViewVisibility(R.id.widget_plan_2, View.GONE)
        }
        return views
    }

    private fun bindPlan(
        context: Context,
        views: RemoteViews,
        containerId: Int,
        nameId: Int,
        metaId: Int,
        percentId: Int,
        progressId: Int,
        plan: PlanReport,
        nowMs: Long,
    ) {
        val window = plan.headline(nowMs)
        val pct = window?.let { (it.used(nowMs) * 100.0).roundToInt() } ?: 0
        val meta = buildList {
            window?.span?.shortTitle?.let(::add)
            window?.resetsAtMs?.let { add("resets ${formatCountdown(it, nowMs)}") }
        }.joinToString(" · ")
        val dark = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        val accent = when (plan.plan) {
            PlanIds.CLAUDE -> if (dark) Color.parseColor("#FF9B73") else Color.parseColor("#C2522D")
            PlanIds.ANTIGRAVITY -> if (dark) Color.parseColor("#8AB4FF") else Color.parseColor("#2F5BEA")
            else -> if (dark) Color.parseColor("#C0C1FF") else Color.parseColor("#575992")
        }
        views.setViewVisibility(containerId, View.VISIBLE)
        views.setTextViewText(nameId, plan.name)
        views.setTextViewText(metaId, meta.ifEmpty { plan.tier ?: plan.machineName })
        views.setTextViewText(percentId, "$pct%")
        views.setTextColor(percentId, accent)
        views.setProgressBar(progressId, 100, pct.coerceIn(0, 100), false)
    }

    companion object {
        const val EXTRA_OPEN_USAGE = "com.muzammil.broski.OPEN_USAGE"
        private const val REQUEST_OPEN_USAGE = 7_101

        fun updateAll(context: Context) {
            val appContext = context.applicationContext
            val manager = AppWidgetManager.getInstance(appContext)
            val ids = manager.getAppWidgetIds(ComponentName(appContext, UsageWidgetProvider::class.java))
            if (ids.isEmpty()) return
            val intent = Intent(appContext, UsageWidgetProvider::class.java)
                .setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
            appContext.sendBroadcast(intent)
        }
    }
}
