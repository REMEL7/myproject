package com.example.pleosstarter

import org.json.JSONObject

/** Stable home entry; completed activities stay in their own tabs. */
object TripFlow {
    data class Step(val title:String,val hint:String,val button:String,val action:String)
    fun mode(room:JSONObject)=room.optString("decisionMode").ifEmpty{
        if(room.optJSONObject("course")!=null)"trip" else if(room.optJSONObject("ballot")!=null)"single" else ""
    }
    fun next(room:JSONObject,connected:Boolean):Step {
        val title="어디로 갈까요?"
        if(!connected)return Step(title,"연결을 확인하고 다시 시작해 주세요.","연결 설정","settings")
        val ballot=room.optJSONObject("ballot")
        if(ballot?.optString("status")=="open")return Step(title,"진행 중인 투표를 확인해 보세요.","투표 보기","ballot")
        val course=room.optJSONObject("course")
        if(course!=null&&course.optInt("nextIndex")<(course.optJSONArray("stops")?.length() ?: 0))
            return Step(title,"저장한 코스에서 이어서 출발해요.","코스 이어가기","course")
        val places=room.optJSONArray("places")
        val count=(0 until (places?.length() ?: 0)).count{!places!!.getJSONObject(it).optBoolean("demo")}
        return if(count==0)Step(title,"가고 싶은 곳을 함께 골라보세요.","휴대폰 연결하기","invite")
            else Step(title,"가고 싶은 곳을 함께 골라보세요.","장소 둘러보기","places")
    }
}
