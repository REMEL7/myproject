package com.example.pleosstarter

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.widget.*
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.concurrent.Executors

/** Connects only to the isolated experience server; no vehicle account is imported. */
class TabletConnectActivity:Activity(){
    private val io=Executors.newSingleThreadExecutor()
    override fun onCreate(state:Bundle?){
        super.onCreate(state)
        val prefs=getSharedPreferences("family-trip",MODE_PRIVATE)
        val pad=(24*resources.displayMetrics.density).toInt()
        val layout=LinearLayout(this).apply{orientation=1;setPadding(pad,pad,pad,pad);setBackgroundColor(Color.rgb(246,243,242));gravity=android.view.Gravity.CENTER}
        layout.addView(TextView(this).apply{text="GMG 태블릿 체험";textSize=28f;setTextColor(Color.rgb(0,44,95))})
        layout.addView(TextView(this).apply{text="차량 앱과 분리된 체험용 모임을 사용해요.\n장소 추가·수정·삭제와 코스를 직접 사용해 보세요.\n길 안내는 태블릿의 지도 앱이나 브라우저로 연결해요.";textSize=18f;setPadding(0,pad,0,pad)})
        val server=EditText(this).apply{hint="체험 서버 주소";setSingleLine();inputType=android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI;setText(prefs.getString("serverUrl",BuildConfig.DEFAULT_SERVER_URL))}
        layout.addView(server,LinearLayout.LayoutParams(-1,-2))
        val status=TextView(this).apply{textSize=16f}
        val start=Button(this).apply{text="체험 시작";isAllCaps=false;minHeight=(56*resources.displayMetrics.density).toInt()}
        layout.addView(start,LinearLayout.LayoutParams(-1,-2));layout.addView(status)
        setContentView(layout)
        start.setOnClickListener{
            val origin=server.text.toString().trim().trimEnd('/')
            if(!runCatching{URI(origin).let{it.scheme in setOf("http","https")&&!it.host.isNullOrBlank()&&it.userInfo==null&&it.query==null&&it.fragment==null&&it.path.isNullOrEmpty()}}.getOrDefault(false)){
                status.text="http:// 또는 https://로 시작하는 서버 주소를 입력해 주세요.";return@setOnClickListener
            }
            start.isEnabled=false;status.text="체험 모임에 연결하고 있어요…"
            io.execute{
                val result=runCatching{
                    val connection=URL("$origin/api/tablet/session").openConnection() as HttpURLConnection
                    connection.connectTimeout=8000;connection.readTimeout=8000
                    try{if(connection.responseCode!=200)error("connection failed");JSONObject(connection.inputStream.bufferedReader().use{it.readText()})}finally{connection.disconnect()}
                }
                runOnUiThread{
                    if(isFinishing||isDestroyed)return@runOnUiThread
                    start.isEnabled=true
                    result.onSuccess{session->
                        val editor=prefs.edit().putString("serverUrl",origin).putString("roomId",session.getString("id"))
                        SessionStore.put(editor,"ownerToken",session.getString("ownerToken"))
                        SessionStore.put(editor,"joinToken",session.getString("joinToken"));editor.apply()
                        startActivity(Intent(this,FamilyTripActivity::class.java));finish()
                    }.onFailure{status.text="서버에 연결하지 못했어요. PC 서버가 켜져 있는지와 주소를 확인해 주세요."}
                }
            }
        }
    }
    override fun onDestroy(){io.shutdownNow();super.onDestroy()}
}
