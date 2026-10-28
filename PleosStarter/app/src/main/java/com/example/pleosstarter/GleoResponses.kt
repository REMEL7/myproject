package com.example.pleosstarter

import org.json.JSONArray
import org.json.JSONObject

/** Only explicit, minimal fields cross the Gleo boundary. Never return a room snapshot. */
object GleoResponses {
    const val SHOW="SHOW_MOAGIL_COURSE"
    const val VOTES="GET_MOAGIL_VOTE_RESULT"
    const val RESUME="RESUME_MOAGIL_COURSE"
    val actions=setOf(SHOW,VOTES,RESUME)
    fun response(action:String,status:String,message:String,data:JSONArray?=null)=JSONObject().apply{
        put("functionName",action);put("status",status);put("message",message);put("mode","voice")
        if(data!=null)put("data",data.toString())
    }
    fun build(action:String,room:JSONObject):JSONObject {
        if(action !in actions)return response(action,"fail","This action is not supported.")
        val ballot=room.optJSONObject("ballot")
        if(action==VOTES){
            if(ballot!=null){
                if(ballot.optString("status")!="closed")return response(action,"asking","The secret ballot is still open. Results remain private until the host closes it.")
                val winners=ballot.optJSONArray("winnerIds") ?: JSONArray()
                val places=room.optJSONArray("places") ?: JSONArray()
                val counts=ballot.optJSONObject("counts") ?: JSONObject()
                val data=JSONArray()
                for(i in 0 until winners.length()){
                    val id=winners.optString(i)
                    val place=(0 until places.length()).mapNotNull{places.optJSONObject(it)}.find{it.optString("id")==id}
                    val name=place?.optString("name") ?: ballot.optJSONObject("candidateNames")?.optString(id) ?: continue
                    data.put(JSONObject().put("placeName",name.take(120)).put("votes",counts.optInt(id)))
                }
                return response(action,"success","The secret ballot has closed. These are the winning places; tied winners are included.",data)
            }
            val places=room.optJSONArray("places") ?: JSONArray()
            val ranked=(0 until places.length()).mapNotNull{places.optJSONObject(it)}.filter{!it.optBoolean("demo")}
                .sortedByDescending{it.optInt("votes")}
            val high=ranked.firstOrNull()?.optInt("votes") ?: 0
            val data=JSONArray()
            if(high>0)ranked.filter{it.optInt("votes")==high}.take(5).forEach{data.put(JSONObject().put("placeName",it.optString("name").take(120)).put("votes",high))}
            return response(action,"success",if(high>0)"These places currently lead the public vote; voting is not finalized." else "There are no public votes for real places yet.",data)
        }
        val course=room.optJSONObject("course") ?: return response(action,"asking","There is no saved course. Create and save a course in Moagil first.")
        val stops=course.optJSONArray("stops") ?: return response(action,"fail","The saved course could not be read.")
        val index=course.optInt("nextIndex").coerceIn(0,stops.length())
        val remaining=JSONArray()
        for(i in index until minOf(index+5,stops.length()))remaining.put(JSONObject().put("placeName",stops.getJSONObject(i).optString("name").take(120)))
        val summary=JSONObject().put("title",course.optString("title").take(100)).put("completedStops",index)
            .put("totalStops",stops.length()).put("remainingStops",remaining).put("timingSource",course.optString("timingSource"))
            .put("navigationStarted",false)
        if(index==stops.length())return response(action,"success","All stops in the saved course have been completed or skipped.",JSONArray().put(summary))
        return response(action,if(action==RESUME)"asking" else "success",if(action==RESUME)
            "The remaining course is displayed. The user must confirm sending it to navigation in Moagil. Navigation has not been started."
            else "This is the saved course and its remaining stops. Saved travel times may be outdated.",JSONArray().put(summary))
    }
}
