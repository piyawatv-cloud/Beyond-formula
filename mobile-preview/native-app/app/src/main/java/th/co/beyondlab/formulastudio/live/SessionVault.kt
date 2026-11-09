package th.co.beyondlab.formulastudio.live

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * "Remember me" without storing the password (the exception forbids that). Keeps only the username and the
 * server session cookie, the cookie encrypted with a non-exportable Android Keystore key, in the app's private
 * storage (allowBackup=false). When the server session expires the password is asked again.
 */
class SessionVault(ctx: Context) {
    private val prefs = ctx.getSharedPreferences("live_remember", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
            generateKey()
        }
    }

    var username: String
        get() = prefs.getString("user", "") ?: ""
        set(v) { prefs.edit().putString("user", v).apply() }

    fun saveCookies(plain: String) {
        try {
            val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
            val blob = Base64.encodeToString(c.iv + c.doFinal(plain.toByteArray()), Base64.NO_WRAP)
            prefs.edit().putString("sess", blob).apply()
        } catch (_: Exception) { clearCookies() }   // cannot encrypt -> do not remember
    }

    fun loadCookies(): String? = try {
        val raw = Base64.decode(prefs.getString("sess", null) ?: return null, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw.copyOfRange(0, 12))) }
        String(c.doFinal(raw.copyOfRange(12, raw.size)))
    } catch (_: Exception) { clearCookies(); null }

    fun clearCookies() { prefs.edit().remove("sess").apply() }
    fun forgetAll() { prefs.edit().clear().apply() }

    private companion object { const val ALIAS = "formula_live_session" }
}
