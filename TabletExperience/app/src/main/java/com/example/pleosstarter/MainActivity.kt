package com.example.pleosstarter

import android.app.Activity
import android.os.Bundle
import android.graphics.Color
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import ai.pleos.playground.vehicle.Vehicle
import ai.pleos.playground.vehicle.api.model.area.DoorArea
import ai.pleos.playground.vehicle.constant.area.DoorValue

/** First Vehicle SDK call from the official Pleos quick-start, with Activity lifecycle handling. */
class MainActivity : Activity() {
    private var vehicle: Vehicle? = null
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(64, 48, 64, 48)
            setBackgroundColor(Color.rgb(15, 23, 42))
        }
        content.addView(TextView(this).apply {
            text = "Pleos Starter"
            textSize = 36f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        })
        status = TextView(this).apply {
            text = "Pleos Connect 에뮬레이터에서 차량 상태를 조회하세요."
            textSize = 22f
            setTextColor(Color.rgb(203, 213, 225))
            setPadding(0, 32, 0, 32)
            gravity = Gravity.CENTER
        }
        content.addView(status)
        content.addView(Button(this).apply {
            text = "앞좌석 왼쪽 문 상태 조회"
            textSize = 22f
            setOnClickListener { readDoor() }
        }, LinearLayout.LayoutParams(600, 100))
        setContentView(content)
        try {
            vehicle = Vehicle(this).also { it.initialize() }
        } catch (e: Exception) {
            showStatus("차량 서비스 초기화 실패: ${e.message}")
        }
    }

    private fun readDoor() {
        val connectedVehicle=vehicle ?: return showStatus("차량 서비스에 연결되지 않았습니다.")
        showStatus("차량 상태 조회 중…")
        try{
            val door=connectedVehicle.getDoor()
            door.checkDoorPositionCapabilities(onComplete={areas->
                val area=DoorArea(DoorValue.ROW_1_LEFT)
                if(!areas.containsKey(area))showStatus("이 차량은 앞좌석 왼쪽 문 상태 조회를 지원하지 않습니다.")
                else door.getCurrentDoorPosition(area=area,onComplete={position:Int?->
                    showStatus(position?.let{"앞좌석 왼쪽 문 위치 값: $it"} ?: "차량에서 문 상태 값을 제공하지 않았습니다.")
                },onFailed={showStatus("문 상태를 조회하지 못했습니다.")})
            },onFailed={showStatus("문 상태 API 지원 여부를 확인하지 못했습니다.")})
        }catch(_:Exception){showStatus("차량 API에 연결하지 못했습니다.")}
    }
    private fun showStatus(message: String) {
        runOnUiThread { if (!isDestroyed && !isFinishing) status.text = message }
    }

    override fun onDestroy() {
        vehicle?.release()
        vehicle = null
        super.onDestroy()
    }
}
