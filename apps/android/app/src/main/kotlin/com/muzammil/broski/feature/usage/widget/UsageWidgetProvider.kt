package com.muzammil.broski.feature.usage.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Bundle
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.RelativeSizeSpan
import android.view.View
import android.widget.RemoteViews
import androidx.core.graphics.createBitmap
import com.muzammil.broski.R
import com.muzammil.broski.app.MainActivity
import com.muzammil.broski.core.usage.LimitWindow
import com.muzammil.broski.core.usage.PlanIds
import com.muzammil.broski.core.usage.PlanReport
import com.muzammil.broski.core.usage.UsageStore
import com.muzammil.broski.feature.usage.left
import com.muzammil.broski.feature.usage.leftPercent
import com.muzammil.broski.feature.usage.resetWords

/**
 * The Home Screen widget, as the Usage tab draws a limit: two columns, each the plan's mark and
 * name, what the limit covers, what is left, the bar with its even-pace mark, and when it resets.
 * Two plans show their fullest limit each; one plan alone shows its first two. A tap opens Usage.
 */
class UsageWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        val plans = UsageStore(context).load()?.plans.orEmpty()
        val nowMs = System.currentTimeMillis()
        for (id in appWidgetIds) {
            appWidgetManager.updateAppWidget(id, views(context, plans, nowMs, appWidgetManager.getAppWidgetOptions(id)))
        }
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, appWidgetId: Int, newOptions: Bundle) {
        val plans = UsageStore(context).load()?.plans.orEmpty()
        manager.updateAppWidget(appWidgetId, views(context, plans, System.currentTimeMillis(), newOptions))
    }

    private fun views(context: Context, plans: List<PlanReport>, nowMs: Long, options: Bundle): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_usage)
        views.setOnClickPendingIntent(R.id.widget_root, openUsage(context))
        val limits = shown(plans, nowMs)
        if (limits.isEmpty()) {
            views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
            views.setViewVisibility(R.id.widget_columns, View.GONE)
            return views
        }
        views.setViewVisibility(R.id.widget_empty, View.GONE)
        views.setViewVisibility(R.id.widget_columns, View.VISIBLE)
        val look = Look(context, columnWidthPx(context, options))
        COLUMNS.forEachIndexed { index, column ->
            val limit = limits.getOrNull(index)
            if (limit == null) {
                views.setViewVisibility(column.root, if (index == 0) View.VISIBLE else View.INVISIBLE)
            } else {
                views.setViewVisibility(column.root, View.VISIBLE)
                bind(context, views, column, limit, nowMs, look)
            }
        }
        return views
    }

    private fun bind(context: Context, views: RemoteViews, column: Column, limit: Limit, nowMs: Long, look: Look) {
        val (plan, window) = limit
        when (plan.plan) {
            PlanIds.CLAUDE -> {
                views.setImageViewResource(column.glyph, R.drawable.ic_agent_claude)
                views.setInt(column.glyph, "setColorFilter", CLAUDE_MARK)
                views.setViewVisibility(column.glyph, View.VISIBLE)
            }
            PlanIds.ANTIGRAVITY -> {
                views.setImageViewResource(column.glyph, R.drawable.ic_agent_antigravity)
                views.setInt(column.glyph, "setColorFilter", Color.TRANSPARENT)
                views.setViewVisibility(column.glyph, View.VISIBLE)
            }
            else -> views.setViewVisibility(column.glyph, View.GONE)
        }
        views.setTextViewText(column.name, plan.name)
        views.setTextViewText(column.label, window.label)
        views.setTextViewText(column.left, leftText(context, window.leftPercent(nowMs), look.secondary))
        views.setImageViewBitmap(column.bar, look.bar(plan.plan, window, nowMs))
        views.setTextViewText(column.reset, window.resetWords(context.resources, nowMs))
        views.setContentDescription(
            column.root,
            listOf(plan.name, window.label, context.getString(R.string.usage_left_spoken, window.leftPercent(nowMs)), window.resetWords(context.resources, nowMs)).joinToString(", "),
        )
    }

    /** "83% left", the word smaller and quieter than the figure. */
    private fun leftText(context: Context, percent: String, secondary: Int): CharSequence {
        val text = SpannableString("$percent ${context.getString(R.string.usage_left)}")
        val start = percent.length + 1
        text.setSpan(RelativeSizeSpan(0.5f), start, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        text.setSpan(ForegroundColorSpan(secondary), start, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        return text
    }

    private fun openUsage(context: Context): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(EXTRA_OPEN_USAGE, true)
        return PendingIntent.getActivity(context, REQUEST_OPEN_USAGE, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    /** A column's width in pixels: half the widget's width, less its padding and the gap between the columns. */
    private fun columnWidthPx(context: Context, options: Bundle): Int {
        val widthDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH).takeIf { it > 0 } ?: DEFAULT_WIDTH_DP
        val density = context.resources.displayMetrics.density
        return (((widthDp - PADDING_DP * 2 - GAP_DP) / 2f) * density).toInt().coerceAtLeast(1)
    }

    /** The colours and size the bar is drawn in, for the light or dark Home Screen. */
    private class Look(context: Context, private val widthPx: Int) {
        private val dark = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        private val primary = context.getColor(R.color.widget_text_primary)
        val secondary = context.getColor(R.color.widget_text_secondary)
        private val heightPx = (BAR_HEIGHT_DP * context.resources.displayMetrics.density).toInt()

        fun bar(plan: String, window: LimitWindow, nowMs: Long): Bitmap {
            val bitmap = createBitmap(widthPx, heightPx)
            val canvas = Canvas(bitmap)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            val barHeight = heightPx * 0.52f
            val top = (heightPx - barHeight) / 2f
            val radius = barHeight / 2f
            paint.color = withAlpha(primary, 0.1f)
            canvas.drawRoundRect(RectF(0f, top, widthPx.toFloat(), top + barHeight), radius, radius, paint)
            val left = window.left(nowMs).toFloat()
            if (left > 0f) {
                paint.color = withAlpha(tint(plan), 0.6f)
                canvas.drawRoundRect(RectF(0f, top, (widthPx * left).coerceAtLeast(barHeight), top + barHeight), radius, radius, paint)
            }
            return bitmap
        }

        private fun tint(plan: String): Int = when (plan) {
            PlanIds.CLAUDE -> if (dark) 0xFFD97757.toInt() else 0xFFC15F3C.toInt()
            PlanIds.ANTIGRAVITY -> if (dark) 0xFF5B9DFF.toInt() else 0xFF1A73E8.toInt()
            else -> if (dark) 0xFF94A3B8.toInt() else 0xFF5B6577.toInt()
        }

        private fun withAlpha(color: Int, alpha: Float): Int = Color.argb((Color.alpha(color) * alpha).toInt(), Color.red(color), Color.green(color), Color.blue(color))
    }

    private data class Limit(val plan: PlanReport, val window: LimitWindow)

    private class Column(val root: Int, val glyph: Int, val name: Int, val label: Int, val left: Int, val bar: Int, val reset: Int)

    companion object {
        const val EXTRA_OPEN_USAGE = "com.muzammil.broski.OPEN_USAGE"
        private const val REQUEST_OPEN_USAGE = 7_101
        private const val DEFAULT_WIDTH_DP = 320
        private const val PADDING_DP = 16
        private const val GAP_DP = 20
        private const val BAR_HEIGHT_DP = 14f
        private val CLAUDE_MARK = 0xFFD97757.toInt()

        private val COLUMNS = listOf(
            Column(R.id.widget_column_1, R.id.widget_glyph_1, R.id.widget_name_1, R.id.widget_label_1, R.id.widget_left_1, R.id.widget_bar_1, R.id.widget_reset_1),
            Column(R.id.widget_column_2, R.id.widget_glyph_2, R.id.widget_name_2, R.id.widget_label_2, R.id.widget_left_2, R.id.widget_bar_2, R.id.widget_reset_2),
        )

        /** Two plans: each one's fullest limit. One plan: its first two limits. */
        private fun shown(plans: List<PlanReport>, nowMs: Long): List<Limit> {
            val read = plans.filter { it.windows.isNotEmpty() }
            return if (read.size >= 2) {
                read.take(2).mapNotNull { plan -> plan.headline(nowMs)?.let { Limit(plan, it) } }
            } else {
                read.firstOrNull()?.let { plan -> plan.orderedWindows.take(2).map { Limit(plan, it) } }.orEmpty()
            }
        }

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
