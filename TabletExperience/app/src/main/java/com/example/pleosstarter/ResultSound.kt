package com.example.pleosstarter

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper

/** Optional short media sound. Denied/lost focus stays silent; never auto-resumes. */
class ResultSound(context:Context){
    private val audio=context.getSystemService(AudioManager::class.java)
    private var tone:ToneGenerator?=null
    private var ownsFocus=false
    private val focus=AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
        .setWillPauseWhenDucked(true)
        .setOnAudioFocusChangeListener({change->if(change!=AudioManager.AUDIOFOCUS_GAIN)close()},Handler(Looper.getMainLooper())).build()
    fun acquire():Boolean{
        ownsFocus=runCatching{audio.requestAudioFocus(focus)==AudioManager.AUDIOFOCUS_REQUEST_GRANTED}.getOrDefault(false)
        if(ownsFocus)tone=runCatching{ToneGenerator(AudioManager.STREAM_MUSIC,25)}.getOrNull()
        if(tone==null)close()
        return ownsFocus
    }
    fun play(kind:Int,duration:Int){if(ownsFocus)tone?.startTone(kind,duration)}
    fun close(){ownsFocus=false;tone?.release();tone=null;runCatching{audio.abandonAudioFocusRequest(focus)}}
}
