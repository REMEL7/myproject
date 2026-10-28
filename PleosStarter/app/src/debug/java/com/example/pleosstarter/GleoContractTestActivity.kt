package com.example.pleosstarter

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject

/** Debug-only contract checks using fabricated data, never the user's preferences or server. */
class GleoContractTestActivity:Activity(){
    override fun onCreate(state:Bundle?){
        super.onCreate(state)
        val invoke=intent.getStringExtra("invokeAction")
        if(invoke in GleoResponses.actions){
            // Run from the app UID. Shell callers remain blocked at the production Gleo entry.
            startActivity(Intent(invoke).setPackage(packageName));finish();return
        }
        var checks=0
        fun verify(value:Boolean){check(value){"Gleo contract check ${checks+1} failed"};checks++}
        val schema=JSONObject(assets.open("schema.json").bufferedReader().use{it.readText()})
        val functions=schema.getJSONArray("actionCalls")
        verify(functions.length()==3)
        val names=(0 until functions.length()).map{functions.getJSONObject(it).getJSONObject("function").getString("name")}.toSet()
        verify(names==GleoResponses.actions)
        verify(schema.getString("version")==packageManager.getPackageInfo(packageName,0).versionName)
        for(name in names)verify(Intent(name).setPackage(packageName).resolveActivity(packageManager)?.className==GleoActionActivity::class.java.name)
        val room=JSONObject("""{"ownerToken":"PRIVATE_OWNER","joinToken":"PRIVATE_JOIN","places":[{"id":"a","name":"A","votes":2,"latitude":37.5,"supporters":["PRIVATE_NAME"]},{"id":"b","name":"B","votes":2},{"id":"demo","name":"TEST","votes":99,"demo":true}]}""")
        val publicResult=GleoResponses.build(GleoResponses.VOTES,room)
        verify(JSONArray(publicResult.getString("data")).length()==2)
        room.put("ballot",JSONObject("""{"status":"open","counts":{"a":9},"winnerIds":["a"]}"""))
        val sealed=GleoResponses.build(GleoResponses.VOTES,room)
        verify(sealed.getString("status")=="asking"&&!sealed.has("data"))
        room.put("ballot",JSONObject("""{"status":"closed","counts":{"a":2,"b":2},"winnerIds":["a","b"]}"""))
        verify(JSONArray(GleoResponses.build(GleoResponses.VOTES,room).getString("data")).length()==2)
        verify(GleoResponses.build(GleoResponses.SHOW,room).getString("status")=="asking")
        room.put("course",JSONObject("""{"title":"Saved course","nextIndex":1,"timingSource":"kakao-road","stops":[{"name":"A","latitude":37.5,"note":"PRIVATE_NOTE"},{"name":"B","longitude":127.2}]}"""))
        val course=GleoResponses.build(GleoResponses.SHOW,room)
        val courseData=JSONArray(course.getString("data")).getJSONObject(0)
        verify(courseData.getInt("completedStops")==1&&courseData.getJSONArray("remainingStops").length()==1)
        verify(!courseData.getBoolean("navigationStarted"))
        val resume=GleoResponses.build(GleoResponses.RESUME,room)
        verify(resume.getString("status")=="asking")
        val combined=publicResult.toString()+course.toString()+resume.toString()+sealed.toString()
        verify(listOf("PRIVATE_OWNER","PRIVATE_JOIN","PRIVATE_NAME","PRIVATE_NOTE","latitude","longitude","winnerIds","counts").none{combined.contains(it)})
        room.getJSONObject("course").put("nextIndex",2)
        verify(GleoResponses.build(GleoResponses.RESUME,room).getString("status")=="success")
        verify(GleoResponses.build("UNKNOWN",room).getString("status")=="fail")
        Log.i("MoagilGleoTest","PASS $checks contract checks")
        setContentView(TextView(this).apply{text="글레오 계약 검사 ${checks}개 통과\n실제 음성 인식 검사는 별도입니다.";textSize=28f;setPadding(40,40,40,40)})
    }
}
