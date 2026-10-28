package com.example.pleosstarter

import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.TextView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.Executors

/** Gleo activity actions are read-only; navigation always stays behind the vehicle UI confirmation. */
class GleoActionActivity:Activity(){
    companion object {
        const val GLEO_PACKAGE="ai.umos.ambientai" // System Gleo app verified on Pleos Connect v2.1.0.
        const val RESPONSE_ACTION="ai.pleos.playground.intent.action.APP_ACTION_RESPONSE"
        const val TAB_EXTRA="com.example.pleosstarter.GLEO_TAB"
    }
    private val main=Handler(Looper.getMainLooper())
    private val worker=Executors.newSingleThreadExecutor()
    private var replied=false
    private var action=""
    private val deadline=Runnable {complete(GleoResponses.response(action,"fail","The group server did not respond in time. Please try again."),false)}
    override fun onCreate(state:Bundle?){
        super.onCreate(state)
        action=intent.action ?: ""
        if(action !in GleoResponses.actions){finish();return}
        setContentView(TextView(this).apply{text="글레오 요청을 확인하고 있어요…";textSize=28f;setPadding(40,40,40,40)})
        main.postDelayed(deadline,5500)
        worker.execute{
            val result=runCatching{GleoResponses.build(action,readFreshRoom())}.getOrElse{
                GleoResponses.response(action,"fail","The current group could not be loaded. Check the Moagil server connection.")
            }
            main.post{complete(result,true)}
        }
    }
    private fun readFreshRoom():JSONObject {
        val prefs=getSharedPreferences("family-trip",MODE_PRIVATE)
        val id=prefs.getString("roomId","") ?: ""
        val token=SessionStore.read(prefs,"ownerToken")
        require(id.matches(Regex("[a-f0-9]{12}"))&&token.isNotEmpty())
        // URL and credentials come only from the app's own settings, never Intent extras.
        val base=URI(prefs.getString("serverUrl",BuildConfig.DEFAULT_SERVER_URL)!!)
        require(base.scheme in listOf("http","https") && base.host!=null && base.userInfo==null && base.query==null && base.fragment==null && base.path.isNullOrEmpty())
        require(BuildConfig.DEBUG || base.scheme=="https")
        val connection=base.resolve("/api/rooms/$id").toURL().openConnection() as HttpURLConnection
        try{
            connection.connectTimeout=1200;connection.readTimeout=3000;connection.instanceFollowRedirects=false
            connection.setRequestProperty("Authorization","Bearer $token")
            require(connection.responseCode==200)
            return JSONObject(connection.inputStream.bufferedReader().use{it.readText()})
        }finally{connection.disconnect()}
    }
    private fun complete(response:JSONObject,openScreen:Boolean){
        if(replied||isDestroyed)return
        replied=true;main.removeCallbacks(deadline)
        val delivered=runCatching{
            val info=packageManager.getApplicationInfo(GLEO_PACKAGE,0)
            require(info.flags and ApplicationInfo.FLAG_SYSTEM!=0)
            sendBroadcast(Intent(RESPONSE_ACTION).setPackage(GLEO_PACKAGE).putExtra("packageName",packageName).putExtra("response",response.toString()))
        }.isSuccess
        // Do not log payloads, tokens, room names or user locations.
        Log.i("MoagilGleo","action=$action status=${response.optString("status")} callbackDispatched=$delivered")
        if(openScreen){
            startActivity(Intent(this,FamilyTripActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(TAB_EXTRA,if(action==GleoResponses.VOTES)"ballot" else "course"))
        }
        finish()
    }
    override fun onDestroy(){main.removeCallbacksAndMessages(null);worker.shutdownNow();super.onDestroy()}
}
