package com.example.pleosstarter

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.DialogInterface
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

private fun Context.u(value:Int)=(value*resources.displayMetrics.density*2).toInt()
private val accent get()=MoagilBrand.navy
private val primary get()=MoagilBrand.ink

/** App-owned sheet presentation. Retains AlertDialog's listener/getButton contract for existing flows. */
class CupertinoSheetBuilder(private val activity:Activity,private val canAct:()->Boolean={true},private val created:(AlertDialog)->Unit={}){
    private var title=""
    private var message=""
    private var view:View?=null
    private var options:Array<String>?=null
    private var selected=-1
    private var single=false
    private var optionClick:DialogInterface.OnClickListener?=null
    private val actions=linkedMapOf<Int,Pair<String,DialogInterface.OnClickListener?>>()
    fun setTitle(value:String)=apply{title=value}
    fun setMessage(value:String)=apply{message=value}
    fun setView(value:View)=apply{view=value}
    fun setPositiveButton(value:String,listener:DialogInterface.OnClickListener?)=apply{actions[DialogInterface.BUTTON_POSITIVE]=value to listener}
    fun setNegativeButton(value:String,listener:DialogInterface.OnClickListener?)=apply{actions[DialogInterface.BUTTON_NEGATIVE]=value to listener}
    fun setNeutralButton(value:String,listener:DialogInterface.OnClickListener?)=apply{actions[DialogInterface.BUTTON_NEUTRAL]=value to listener}
    fun setItems(values:Array<String>,listener:DialogInterface.OnClickListener)=apply{options=values;optionClick=listener}
    fun setSingleChoiceItems(values:Array<String>,checked:Int,listener:DialogInterface.OnClickListener)=apply{options=values;selected=checked;single=true;optionClick=listener}
    fun create():AlertDialog=CupertinoSheet(activity,title,message,view,options,selected,single,optionClick,actions.toMap(),canAct).also{created(it)}
    fun show():AlertDialog=create().also{it.show()}
}

private class CupertinoSheet(
    private val activity:Activity,private val heading:String,private val message:String,private val body:View?,
    private val options:Array<String>?,private val selected:Int,private val single:Boolean,
    private val optionClick:DialogInterface.OnClickListener?,
    private val actions:Map<Int,Pair<String,DialogInterface.OnClickListener?>>,private val canAct:()->Boolean
):AlertDialog(activity){
    private val controls=mutableMapOf<Int,Button>()
    private fun text(value:String,size:Float,color:Int=primary)=TextView(context).apply{
        text=value;textSize=size;setTextColor(color);includeFontPadding=false
        typeface=Typeface.create("sans-serif",Typeface.NORMAL);setLineSpacing(0f,1.16f)
    }
    private fun actionButton(which:Int):Button{
        val action=actions.getValue(which)
        return Button(context).apply{
            text=action.first;textSize=26f;isAllCaps=false;includeFontPadding=false
            typeface=Typeface.create("sans-serif-medium",Typeface.NORMAL)
            setTextColor(if(action.first in setOf("삭제","종료"))MoagilBrand.danger else accent)
            background=ColorDrawable(Color.TRANSPARENT);stateListAnimator=null;elevation=0f;translationZ=0f
            minWidth=0;minimumWidth=0;minHeight=context.u(48);minimumHeight=context.u(48)
            setPadding(context.u(10),context.u(8),context.u(10),context.u(8))
            setOnClickListener{if(which!=DialogInterface.BUTTON_NEGATIVE && !canAct())return@setOnClickListener;action.second?.onClick(this@CupertinoSheet,which);dismiss()}
        }.also{controls[which]=it}
    }
    override fun onCreate(state:Bundle?){
        super.onCreate(state)
        val root=LinearLayout(context).apply{
            orientation=LinearLayout.VERTICAL
            background=GradientDrawable().apply{
                setColor(MoagilBrand.surface);val radius=context.u(22).toFloat();cornerRadii=floatArrayOf(radius,radius,radius,radius,0f,0f,0f,0f)
            }
            clipToOutline=true;isFocusableInTouchMode=true
        }
        root.addView(View(context).apply{background=GradientDrawable().apply{setColor(Color.rgb(205,207,215));cornerRadius=context.u(2).toFloat()}},
            LinearLayout.LayoutParams(context.u(34),context.u(4)).apply{gravity=Gravity.CENTER_HORIZONTAL;topMargin=context.u(8);bottomMargin=context.u(5)})
        val bar=LinearLayout(context).apply{gravity=Gravity.CENTER_VERTICAL;setPadding(context.u(7),0,context.u(7),0)}
        actions[DialogInterface.BUTTON_NEGATIVE]?.let{bar.addView(actionButton(DialogInterface.BUTTON_NEGATIVE),LinearLayout.LayoutParams(-2,-2))}
        bar.addView(text(heading,32f).apply{
            gravity=Gravity.CENTER;typeface=Typeface.create("sans-serif-medium",Typeface.NORMAL);maxLines=1;ellipsize=android.text.TextUtils.TruncateAt.END
        },LinearLayout.LayoutParams(0,context.u(52),1f))
        actions[DialogInterface.BUTTON_POSITIVE]?.let{bar.addView(actionButton(DialogInterface.BUTTON_POSITIVE),LinearLayout.LayoutParams(-2,-2))}
        root.addView(bar)
        root.addView(View(context).apply{setBackgroundColor(MoagilBrand.line)},LinearLayout.LayoutParams(-1,1))
        val content=LinearLayout(context).apply{orientation=LinearLayout.VERTICAL}
        if(message.isNotBlank())content.addView(text(message,30f).apply{setPadding(context.u(22),context.u(18),context.u(22),context.u(20))})
        body?.let{(it.parent as? ViewGroup)?.removeView(it);content.addView(it)}
        options?.forEachIndexed{index,value->
            if(index>0)content.addView(View(context).apply{setBackgroundColor(MoagilBrand.line)},LinearLayout.LayoutParams(-1,1).apply{leftMargin=context.u(22)})
            content.addView(Button(context).apply{
                text=value+if(index==selected)"   ✓" else "";textSize=30f;isAllCaps=false;includeFontPadding=false
                gravity=Gravity.START or Gravity.CENTER_VERTICAL;setTextColor(if(index==selected)accent else primary)
                background=ColorDrawable(Color.TRANSPARENT);stateListAnimator=null;elevation=0f;translationZ=0f
                setPadding(context.u(22),context.u(13),context.u(22),context.u(13));minHeight=context.u(58)
                setOnClickListener{if(!canAct())return@setOnClickListener;optionClick?.onClick(this@CupertinoSheet,index);if(!single)dismiss()}
            },LinearLayout.LayoutParams(-1,-2))
        }
        val maxHeight=(activity.resources.configuration.screenHeightDp*activity.resources.displayMetrics.density*.68).toInt()
        val scroll=object:ScrollView(context){
            override fun onMeasure(widthSpec:Int,heightSpec:Int){super.onMeasure(widthSpec,MeasureSpec.makeMeasureSpec(maxHeight,MeasureSpec.AT_MOST))}
        }.apply{addView(content);isFillViewport=false;isVerticalScrollBarEnabled=false;clipToPadding=false}
        root.addView(scroll,LinearLayout.LayoutParams(-1,-2))
        actions[DialogInterface.BUTTON_NEUTRAL]?.let{root.addView(actionButton(DialogInterface.BUTTON_NEUTRAL),LinearLayout.LayoutParams(-1,-2))}
        root.setPadding(0,0,0,context.u(12))
        setContentView(root);root.requestFocus()
        window?.apply{
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT));decorView.setPadding(0,0,0,0)
            addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);setDimAmount(.18f);setWindowAnimations(0)
            setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        }
        if(android.animation.ValueAnimator.areAnimatorsEnabled()){
            root.translationY=context.u(18).toFloat();root.animate().translationY(0f).setDuration(200).start()
        }
    }
    override fun onStart(){super.onStart();window?.setGravity(Gravity.BOTTOM);window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.WRAP_CONTENT)}
    override fun getButton(whichButton:Int):Button=controls[whichButton] ?: super.getButton(whichButton)
}

class CupertinoTabIcon(context:Context,private val kind:String):View(context){
    var active=false
        set(value){field=value;invalidate()}
    private val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply{style=Paint.Style.STROKE;strokeWidth=1.8f;strokeCap=Paint.Cap.ROUND;strokeJoin=Paint.Join.ROUND}
    override fun onDraw(c:Canvas){
        super.onDraw(c);val size=minOf(width,height).toFloat();c.save();c.translate((width-size)/2,(height-size)/2);c.scale(size/32,size/32)
        paint.color=if(active)accent else MoagilBrand.secondary
        when(kind){
            "home"->{c.drawPath(Path().apply{moveTo(5f,15f);lineTo(16f,5f);lineTo(27f,15f);moveTo(8f,13f);lineTo(8f,27f);lineTo(13f,27f);lineTo(13f,20f);lineTo(19f,20f);lineTo(19f,27f);lineTo(24f,27f);lineTo(24f,13f)},paint)}
            "places"->{c.drawPath(Path().apply{moveTo(16f,28f);cubicTo(12f,23f,6f,17f,6f,12f);cubicTo(6f,0f,26f,0f,26f,12f);cubicTo(26f,17f,20f,23f,16f,28f)},paint);c.drawCircle(16f,12f,3.4f,paint)}
            "course"->{c.drawCircle(7f,7f,3f,paint);c.drawCircle(25f,25f,3f,paint);c.drawPath(Path().apply{moveTo(10f,7f);lineTo(21f,7f);cubicTo(29f,7f,29f,16f,21f,16f);lineTo(11f,16f);cubicTo(3f,16f,3f,25f,11f,25f);lineTo(22f,25f)},paint)}
            "settings"->{
                c.drawCircle(16f,16f,8.5f,paint);c.drawCircle(16f,16f,3.5f,paint)
                repeat(8){c.save();c.rotate(it*45f,16f,16f);c.drawLine(16f,3f,16f,7f,paint);c.restore()}
            }
            else->{c.drawRoundRect(5f,5f,27f,27f,6f,6f,paint);c.drawPath(Path().apply{moveTo(10f,16f);lineTo(14f,20f);lineTo(22f,12f)},paint)}
        };c.restore()
    }
}

class CupertinoToggle(context:Context):CheckBox(context){
    private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
    init{buttonDrawable=null;setPadding(0,context.u(8),context.u(58),context.u(8));minimumHeight=context.u(48);includeFontPadding=false;stateListAnimator=null}
    override fun onDraw(c:Canvas){
        super.onDraw(c);val w=context.u(44).toFloat();val h=context.u(27).toFloat();val x=width-w;val y=(height-h)/2
        paint.color=if(isChecked)accent else MoagilBrand.line;c.drawRoundRect(x,y,x+w,y+h,h/2,h/2,paint)
        paint.color=Color.WHITE;val r=h/2-context.u(2);c.drawCircle(if(isChecked)x+w-h/2 else x+h/2,y+h/2,r,paint)
    }
}
