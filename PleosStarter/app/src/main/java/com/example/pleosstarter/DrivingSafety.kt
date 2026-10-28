package com.example.pleosstarter

import android.car.Car
import android.car.drivingstate.CarUxRestrictionsManager
import android.content.Context
import android.os.Handler
import android.os.Looper

/** Parked-only app: unknown/disconnected restrictions never enable interactions. */
class DrivingSafety(private val context:Context,private val changed:(Boolean)->Unit){
    private var generation=0
    private var car:Car?=null
    private var manager:CarUxRestrictionsManager?=null
    private val handler=Handler(Looper.getMainLooper())
    var allowed=false;private set
    private fun update(value:Boolean){if(allowed!=value){allowed=value;changed(value)}}
    fun start(){
        if(car!=null)return
        update(false)
        val currentGeneration=++generation
        try{
            car=Car.createCar(context,handler,Car.CAR_WAIT_TIMEOUT_DO_NOT_WAIT){connected,ready->
                if(currentGeneration!=generation)return@createCar
                if(!ready){update(false);return@createCar}
                try{
                    manager=connected.getCarManager(Car.CAR_UX_RESTRICTION_SERVICE) as CarUxRestrictionsManager
                    manager!!.registerListener{if(currentGeneration!=generation)return@registerListener;update(!it.isRequiresDistractionOptimization && it.activeRestrictions==0)}
                    val state=manager!!.currentCarUxRestrictions
                    update(!state.isRequiresDistractionOptimization && state.activeRestrictions==0)
                }catch(_:Exception){update(false)}catch(_:LinkageError){update(false)}
            }
        }catch(_:Exception){update(false)}catch(_:LinkageError){update(false)}
    }
    fun stop(){generation++;runCatching{manager?.unregisterListener()};manager=null;runCatching{car?.disconnect()};car=null;update(false)}
}
