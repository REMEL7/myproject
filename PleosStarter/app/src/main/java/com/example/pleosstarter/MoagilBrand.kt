package com.example.pleosstarter

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.View

/** Hyundai CI references; mist/line colors are app-specific supporting tones. */
object MoagilBrand {
    var night=false;private set
    fun configure(context:Context){night=context.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK==android.content.res.Configuration.UI_MODE_NIGHT_YES}
    val danger get()=if(night)Color.rgb(255,180,171) else Color.rgb(179,38,30)
    val warning get()=if(night)Color.rgb(241,195,138) else Color.rgb(140,79,29)
    val logoNavy=Color.rgb(0,44,95)
    val navy get()=if(night)Color.rgb(153,210,239) else logoNavy
    val activeBlue=Color.rgb(0,170,210)
    val background get()=if(night)Color.rgb(14,22,31) else Color.rgb(246,243,242)
    val surface get()=if(night)Color.rgb(25,37,50) else Color.WHITE
    val onAccent get()=if(night)Color.rgb(10,27,43) else Color.WHITE
    val mist get()=if(night)Color.rgb(31,53,65) else Color.rgb(232,243,245)
    val ink get()=if(night)Color.rgb(237,243,248) else Color.rgb(25,43,62)
    val secondary get()=if(night)Color.rgb(174,191,205) else Color.rgb(96,109,120)
    val line get()=if(night)Color.rgb(58,76,91) else Color.rgb(223,229,231)
}

/** A G-shaped route and forward arrow, drawn without bitmap scaling. */
class MoagilMark(context:Context):View(context){
    private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
    init{contentDescription="GMG 로고";importantForAccessibility=IMPORTANT_FOR_ACCESSIBILITY_NO}
    override fun onDraw(canvas:Canvas){
        super.onDraw(canvas)
        val size=minOf(width,height).toFloat()
        canvas.save();canvas.translate((width-size)/2,(height-size)/2);canvas.scale(size/48f,size/48f)
        paint.style=Paint.Style.FILL;paint.color=MoagilBrand.logoNavy
        canvas.drawRoundRect(0f,0f,48f,48f,14f,14f,paint)
        paint.style=Paint.Style.STROKE;paint.strokeWidth=3.8f;paint.strokeCap=Paint.Cap.ROUND;paint.strokeJoin=Paint.Join.ROUND
        paint.color=Color.WHITE
        canvas.drawPath(Path().apply{moveTo(26f,14f);cubicTo(19f,12f,12f,17f,12f,24f);cubicTo(12f,31f,17f,36f,24f,36f);cubicTo(31f,36f,35f,31f,35f,25f);lineTo(25f,25f)},paint)
        paint.color=MoagilBrand.activeBlue
        paint.style=Paint.Style.FILL
        canvas.drawPath(Path().apply{moveTo(29f,11f);lineTo(38f,10f);lineTo(37f,19f);lineTo(34f,16f);lineTo(29f,21f);lineTo(27f,19f);lineTo(32f,14f);close()},paint)
        canvas.restore()
    }
}
