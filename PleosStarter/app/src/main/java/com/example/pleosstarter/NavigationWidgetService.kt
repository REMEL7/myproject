package com.example.pleosstarter

import android.app.*
import android.car.Car
import android.car.drivingstate.CarUxRestrictionsManager
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.WindowManager

/** Standard public Android overlay, gated by the user's grant and automotive UX restrictions. */
class NavigationWidgetService : Service() {
    private var car: Car? = null
    private var restrictions: CarUxRestrictionsManager? = null
    private var widget: NavigationWidgetView? = null
    private val handler = Handler(Looper.getMainLooper())
    private val connectionTimeout = Runnable { stopWithReason("차량 주행 제한을 확인하지 못해 위젯을 표시하지 않았습니다") }
    private val permissionCheck = object : Runnable {
        override fun run() {
            if (!Settings.canDrawOverlays(this@NavigationWidgetService)) {
                stopWithReason("다른 앱 위 표시 권한이 해제됐습니다")
            } else handler.postDelayed(this, 1500)
        }
    }

    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("widget", "위젯 표시", NotificationManager.IMPORTANCE_LOW))
        val stop = PendingIntent.getService(this, 2, Intent(this, NavigationWidgetService::class.java).setAction("STOP"), PendingIntent.FLAG_IMMUTABLE)
        val open = PendingIntent.getActivity(this, 1, Intent(this, OverlayLabActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        startForeground(100, Notification.Builder(this, "widget")
            .setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Pleos 위젯 실험")
            .setContentText("정차 중 표시 · 누르면 앱 열기").setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "끄기", stop).build()).setOngoing(true).build())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP") { stopWithReason("사용자가 위젯을 껐습니다"); return START_NOT_STICKY }
        if (!Settings.canDrawOverlays(this)) { stopWithReason("다른 앱 위 표시 권한이 없습니다"); return START_NOT_STICKY }
        if (car != null) return START_NOT_STICKY
        handler.postDelayed(connectionTimeout, 5000)
        try {
            car = Car.createCar(this, handler, Car.CAR_WAIT_TIMEOUT_DO_NOT_WAIT) { connectedCar, ready ->
                if (!ready) { stopWithReason("차량 서비스 연결이 끊어졌습니다"); return@createCar }
                handler.removeCallbacks(connectionTimeout)
                try {
                    restrictions = connectedCar.getCarManager(Car.CAR_UX_RESTRICTION_SERVICE) as CarUxRestrictionsManager
                    restrictions!!.registerListener { state ->
                        if (state.isRequiresDistractionOptimization) stopWithReason("주행 제한으로 위젯을 종료했습니다")
                    }
                    if (restrictions!!.currentCarUxRestrictions.isRequiresDistractionOptimization) {
                        stopWithReason("주행 제한 중에는 위젯을 켤 수 없습니다")
                    } else showWidget()
                } catch (e: LinkageError) {
                    stopWithReason("이 플랫폼에서 표준 차량 주행 제한 API를 사용할 수 없습니다")
                } catch (e: Exception) { stopWithReason("차량 제한 확인 실패: ${e.message}") }
            }
        } catch (e: LinkageError) {
            stopWithReason("이 플랫폼에서 표준 차량 주행 제한 API를 사용할 수 없습니다")
        } catch (e: Exception) { stopWithReason("차량 서비스 연결 실패: ${e.message}") }
        return START_NOT_STICKY
    }

    private fun showWidget() {
        if (widget != null) return
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val view = NavigationWidgetView(this, "정차 중 · 위젯 실험") { stopWithReason("사용자가 위젯을 껐습니다") }
        val params = WindowManager.LayoutParams(dp(360), dp(190), WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.END; x = dp(24); y = dp(96)
        }
        try {
            getSystemService(WindowManager::class.java).addView(view, params)
            widget = view
            saveStatus("위젯 표시 요청 완료 · 내비 위 노출은 화면에서 확인하세요")
            handler.post(permissionCheck)
        } catch (e: Exception) { stopWithReason("플랫폼이 위젯 표시를 거부했습니다: ${e.message}") }
    }

    private fun saveStatus(value: String) { getSharedPreferences("widget", MODE_PRIVATE).edit().putString("status", value).apply() }
    private fun stopWithReason(reason: String) { saveStatus(reason); stopSelf() }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        widget?.let { runCatching { getSystemService(WindowManager::class.java).removeView(it) } }
        widget = null
        runCatching { restrictions?.unregisterListener() }
        car?.disconnect(); car = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}
