package com.example.pleosstarter

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.TextClock

/** Shared real widget UI used by the preview and the overlay; it never paints a fake map. */
class NavigationWidgetView @JvmOverloads constructor(context: Context, caption: String = "정차 중 · 위젯 실험", close: () -> Unit = {}) : LinearLayout(context) {
    init {
        orientation = VERTICAL
        setPadding(20, 12, 20, 12)
        background = GradientDrawable().apply {
            setColor(Color.rgb(24, 38, 57)); cornerRadius = 22f
            setStroke(2, Color.rgb(94, 234, 212))
        }
        val titleRow = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL }
        titleRow.addView(TextView(context).apply {
            text = "DRIVE CARD"; textSize = 16f; setTextColor(Color.rgb(94, 234, 212))
            setTypeface(null, Typeface.BOLD)
        }, LayoutParams(0, 48, 1f))
        titleRow.addView(Button(context).apply {
            text = "닫기"; textSize = 14f; minWidth = 0; minimumWidth = 0
            setOnClickListener { close() }
        }, LayoutParams(80, 48))
        addView(titleRow)
        addView(TextClock(context).apply {
            format12Hour = "HH:mm"; format24Hour = "HH:mm"
            textSize = 38f; setTextColor(Color.WHITE)
        })
        addView(TextView(context).apply {
            text = caption; textSize = 14f; setTextColor(Color.rgb(203, 213, 225))
        })
    }
}
