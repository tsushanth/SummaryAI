package com.kreativekoala.summaryai.data.local

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.KeyStore

/**
 * The ONE encrypted store for everything credential-like (API tokens mirror, Supabase session).
 *
 * Backed by [EncryptedSharedPreferences] (AES256-SIV keys, AES256-GCM values, master key in the Android
 * Keystore). The file [FILE_NAME] is excluded from Auto Backup and device transfer (res/xml/backup_rules.xml and
 * data_extraction_rules.xml): its Keystore key never leaves the device, so a restored copy could not be read anyway.
 *
 * If the store cannot be opened (Keystore key lost after a restore or an OS update, corrupted file), the file and
 * key are wiped and recreated once. If that also fails the app gets an in-memory store: the user is signed out
 * and nothing is ever written to disk in clear text. It never throws.
 */
object SecurePrefs {
    const val FILE_NAME = "encrypted_prefs"
    private const val TAG = "SecurePrefs"

    @Volatile private var instance: SharedPreferences? = null

    fun get(context: Context): SharedPreferences = instance ?: synchronized(this) {
        instance ?: open(context.applicationContext).also { instance = it }
    }

    private fun open(context: Context): SharedPreferences = create(
        factory = {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context,
                FILE_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        },
        wipe = {
            context.deleteSharedPreferences(FILE_NAME)
            val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            ks.deleteEntry(MasterKey.DEFAULT_MASTER_KEY_ALIAS)
        }
    )

    /** Testable core: open, else wipe and open once more, else in-memory. Logs only the exception class. */
    internal fun create(factory: () -> SharedPreferences, wipe: () -> Unit): SharedPreferences {
        try {
            return factory()
        } catch (e: Exception) {
            Log.w(TAG, "Encrypted store unavailable (${e.javaClass.simpleName}); resetting it")
        }
        try {
            wipe()
        } catch (e: Exception) {
            Log.w(TAG, "Encrypted store reset failed (${e.javaClass.simpleName})")
        }
        return try {
            factory()
        } catch (e: Exception) {
            Log.e(TAG, "Encrypted store still unavailable (${e.javaClass.simpleName}); using memory only")
            MemorySharedPreferences()
        }
    }
}

/** Process-lifetime SharedPreferences: the signed-out fallback when the encrypted store cannot be opened. */
internal class MemorySharedPreferences : SharedPreferences {
    private val data = HashMap<String, Any?>()

    @Synchronized override fun getAll(): MutableMap<String, *> = HashMap(data)
    @Synchronized override fun getString(key: String, defValue: String?): String? = data[key] as? String ?: defValue
    @Suppress("UNCHECKED_CAST")
    @Synchronized override fun getStringSet(key: String, defValues: MutableSet<String>?): MutableSet<String>? =
        data[key] as? MutableSet<String> ?: defValues
    @Synchronized override fun getInt(key: String, defValue: Int): Int = data[key] as? Int ?: defValue
    @Synchronized override fun getLong(key: String, defValue: Long): Long = data[key] as? Long ?: defValue
    @Synchronized override fun getFloat(key: String, defValue: Float): Float = data[key] as? Float ?: defValue
    @Synchronized override fun getBoolean(key: String, defValue: Boolean): Boolean = data[key] as? Boolean ?: defValue
    @Synchronized override fun contains(key: String): Boolean = data.containsKey(key)
    override fun registerOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener?) {}
    override fun unregisterOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener?) {}

    override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
        private val pending = HashMap<String, Any?>()
        private var clear = false
        override fun putString(key: String, value: String?) = apply { pending[key] = value }
        override fun putStringSet(key: String, values: MutableSet<String>?) = apply { pending[key] = values }
        override fun putInt(key: String, value: Int) = apply { pending[key] = value }
        override fun putLong(key: String, value: Long) = apply { pending[key] = value }
        override fun putFloat(key: String, value: Float) = apply { pending[key] = value }
        override fun putBoolean(key: String, value: Boolean) = apply { pending[key] = value }
        override fun remove(key: String) = apply { pending[key] = null }
        override fun clear() = apply { clear = true }
        override fun commit(): Boolean { apply(); return true }
        override fun apply() {
            synchronized(this@MemorySharedPreferences) {
                if (clear) data.clear()
                pending.forEach { (k, v) -> if (v == null) data.remove(k) else data[k] = v }
            }
        }
    }
}
