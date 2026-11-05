package com.example.pleosstarter

interface InteractionSafety {
    val allowed:Boolean
    fun start()
    fun stop()
}

/** Tablet build only: no vehicle state is inferred or exposed. */
class TabletSafety:InteractionSafety {
    override val allowed=true
    override fun start()=Unit
    override fun stop()=Unit
}
