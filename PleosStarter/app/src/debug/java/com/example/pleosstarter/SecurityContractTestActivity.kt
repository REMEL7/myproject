package com.example.pleosstarter

import android.app.Activity
import android.os.Bundle
import android.util.Log
import android.widget.TextView
import org.json.JSONObject
import org.json.JSONArray

/** Isolated debug checks, never reads or changes the real session preferences. */
class SecurityContractTestActivity:Activity(){
    override fun onCreate(state:Bundle?){
        super.onCreate(state)
        val fixture=getSharedPreferences("security-contract-fixture",MODE_PRIVATE)
        try{
            fixture.edit().clear().commit()
            SessionStore.put(fixture.edit(),"test","fabricated-test-secret").commit()
            check(fixture.getString("test","")!!.startsWith("v1:"))
            check(!fixture.getString("test","")!!.contains("fabricated-test-secret"))
            check(SessionStore.read(fixture,"test")=="fabricated-test-secret")
            fixture.edit().putString("test","v1:invalid:invalid").commit()
            check(SessionStore.read(fixture,"test").isEmpty())
            fixture.edit().putString("legacy","fabricated-upgrade-secret").commit()
            check(SessionStore.read(fixture,"legacy")=="fabricated-upgrade-secret")
            check(fixture.getString("legacy","")!!.startsWith("v1:"))
            val empty=JSONObject().put("places",JSONArray())
            check(TripFlow.next(empty,true).action=="invite")
            empty.put("places",JSONArray().put(JSONObject().put("demo",true)))
            check(TripFlow.next(empty,true).action=="invite")
            val gathered=JSONObject().put("places",JSONArray().put(JSONObject().put("demo",false)).put(JSONObject().put("demo",false)))
            check(TripFlow.next(gathered,true).action=="places")
            gathered.put("decisionMode","single")
            check(TripFlow.next(gathered,true).action=="places")
            gathered.put("decisionMode","trip")
            check(TripFlow.next(gathered,true).action=="places")
            check(TripFlow.next(gathered,false).action=="settings")
            gathered.put("ballot",JSONObject().put("status","open"))
            check(TripFlow.next(gathered,true).action=="places")
            gathered.getJSONObject("ballot").put("status","closed")
            check(TripFlow.next(gathered,true).action=="places")
            check(TripFlow.next(gathered,true).title=="어디로 갈까요?")
            check(TripFlow.next(JSONObject().put("places",JSONArray()).put("ballot",JSONObject().put("status","closed")),true).action=="invite")
            gathered.put("course",JSONObject().put("nextIndex",0).put("stops",JSONArray().put(JSONObject())))
            check(TripFlow.next(gathered,true).action=="course")
            Log.i("MoagilFlowTest","PASS empty room / demo exclusion / stable home / closed ballot fallback / active vote / saved course / offline")
            Log.i("MoagilSecurityTest","PASS encrypted storage / round trip / tamper rejection / legacy migration")
            setContentView(TextView(this).apply{text="Security contract checks PASS";textSize=28f})
        }catch(e:Exception){Log.e("MoagilSecurityTest","FAIL ${e.javaClass.simpleName}");throw e}
        finally{fixture.edit().clear().commit()}
    }
}
