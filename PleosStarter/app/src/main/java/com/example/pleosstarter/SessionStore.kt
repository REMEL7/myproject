package com.example.pleosstarter

import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Credentials are encrypted at rest with an Android Keystore non-exportable key. */
object SessionStore {
    private const val alias="moagil.session.v1"
    @Synchronized private fun key():SecretKey{
        val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
        (store.getKey(alias,null) as? SecretKey)?.let{return it}
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply{
            init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun put(editor:SharedPreferences.Editor,name:String,value:String):SharedPreferences.Editor{
        val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply{init(Cipher.ENCRYPT_MODE,key())}
        val encoded="v1:"+Base64.encodeToString(cipher.iv,Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)),Base64.NO_WRAP)
        return editor.putString(name,encoded)
    }
    fun read(prefs:SharedPreferences,name:String):String{
        val value=prefs.getString(name,"") ?: ""
        if(value.isEmpty())return ""
        if(!value.startsWith("v1:")){put(prefs.edit(),name,value).apply();return value} // One-time upgrade of existing local sessions.
        return runCatching{
            val parts=value.split(':');val cipher=Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,Base64.decode(parts[1],Base64.NO_WRAP)))
            String(cipher.doFinal(Base64.decode(parts[2],Base64.NO_WRAP)),Charsets.UTF_8)
        }.getOrDefault("")
    }
}
