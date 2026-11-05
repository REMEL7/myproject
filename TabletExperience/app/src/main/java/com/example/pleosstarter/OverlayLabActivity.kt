package com.example.pleosstarter

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.*
import ai.pleos.playground.navi.helper.NaviHelper
import ai.pleos.playground.navi.data.NavigationScreenRequest

/** A capability check, not a claim that Pleos exposes a system-widget registration API. */
class OverlayLabActivity : Activity() {
    private lateinit var capability: TextView
    private lateinit var startButton: Button
    private lateinit var permissionButton: Button
    private var navi: NaviHelper? = null
    private var naviReady = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 28, 40, 28)
            setBackgroundColor(Color.rgb(15, 23, 42))
        }
        val scroll = ScrollView(this).apply { isFillViewport = true; addView(column) }
        setContentView(scroll)
        column.addView(label("PLEOS / WIDGET LAB", 16, Color.rgb(94, 234, 212)))
        column.addView(label("내비게이션 위젯 실험실", 30, Color.WHITE))
        column.addView(label("정차 중 표시 가능 여부를 확인하는 개발용 앱", 18))
        capability = label("표시 권한 확인 중…", 18).apply { setPadding(0, 18, 0, 14) }
        column.addView(capability)
        val preview = NavigationWidgetView(this, "앱 내부 미리보기 · 내비 위 표시 아님") {
            capability.text = "이 카드는 앱 내부 미리보기입니다. 실제 위젯은 '위젯 끄기'로 종료합니다."
        }
        column.addView(preview, LinearLayout.LayoutParams(480, 190))
        permissionButton = button("1. 다른 앱 위에 표시 허용", column) {
            val request = permissionIntent()
            if (request.resolveActivity(packageManager) != null) startActivity(request)
            else refreshCapability()
        }
        startButton = button("2. 위젯 켜기", column) {
            if (Settings.canDrawOverlays(this)) {
                getSharedPreferences("widget", MODE_PRIVATE).edit().putString("status", "차량 주행 제한 확인 중").apply()
                runCatching { startForegroundService(Intent(this, NavigationWidgetService::class.java)) }
                    .onSuccess { capability.postDelayed({ refreshCapability() }, 1500) }
                    .onFailure { capability.text = "위젯 시작 실패: ${it.message}" }
            } else refreshCapability()
        }
        button("3. 기본 내비게이션 열기", column) {
            if (naviReady) {
                runCatching { navi?.requestNavigationScreen(NavigationScreenRequest.Foreground) }
                    .onFailure { capability.text = "내비 화면 요청 실패: ${it.message}" }
            } else capability.text = "기본 내비 서비스 연결을 확인할 수 없습니다. 차량의 내비 버튼으로 열어주세요."
        }
        button("위젯 끄기", column) {
            stopService(Intent(this, NavigationWidgetService::class.java))
            getSharedPreferences("widget", MODE_PRIVATE).edit().putString("status", "사용자가 위젯을 껐습니다").apply()
            refreshCapability()
        }
        button("기존 차량 SDK 예제", column) { startActivity(Intent(this, MainActivity::class.java)) }
        column.addView(label("공식 시스템 위젯 등록 기능과 별개인 Android 오버레이 실험입니다.\n권한 화면이 없는 환경에서는 내비 위 표시를 시작할 수 없습니다.", 16))
        navi = NaviHelper(applicationContext).also { helper ->
            helper.initialize(onConnected = { naviReady = true }, onFailed = { naviReady = false })
        }
    }

    override fun onResume() { super.onResume(); if (::capability.isInitialized) refreshCapability() }

    private fun permissionIntent() = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))

    private fun refreshCapability() {
        val allowed = Settings.canDrawOverlays(this)
        val hasPermissionScreen = permissionIntent().resolveActivity(packageManager) != null
        permissionButton.isEnabled = !allowed && hasPermissionScreen
        startButton.isEnabled = allowed
        capability.text = when {
            allowed -> "다른 앱 위 표시: 허용됨\n" + getSharedPreferences("widget", MODE_PRIVATE).getString("status", "위젯 켜기를 눌러주세요")
            hasPermissionScreen -> "다른 앱 위 표시: 사용자 허용 필요\n허용 후 이 앱으로 돌아오세요."
            else -> "이 환경은 오버레이 권한 설정 화면을 제공하지 않습니다.\n내비 위 표시 불가 · 아래 카드는 앱 내부 미리보기입니다."
        }
    }

    private fun label(value: String, size: Int, color: Int = Color.rgb(203, 213, 225)) = TextView(this).apply {
        text = value; textSize = size.toFloat(); setTextColor(color); setPadding(0, 5, 0, 5)
    }
    private fun button(value: String, parent: LinearLayout, action: () -> Unit) = Button(this).apply {
        text = value; textSize = 18f; isAllCaps = false; setOnClickListener { action() }
        parent.addView(this, LinearLayout.LayoutParams(640, 64).apply { topMargin = 8 })
    }
    @Deprecated("Legacy back callback")
    override fun onBackPressed() { moveTaskToBack(true) }
    override fun onDestroy() { navi?.release(); super.onDestroy() }
}
