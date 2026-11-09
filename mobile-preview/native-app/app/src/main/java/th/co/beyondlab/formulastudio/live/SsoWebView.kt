package th.co.beyondlab.formulastudio.live

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import java.net.URI

/** Name of the Cloudflare Access session cookie set on the app host after SSO. */
const val CF_COOKIE = "CF_Authorization"

/** The Cloudflare Access cookie WebView holds for [base], or null when SSO has not completed. */
fun accessCookie(base: String): String? =
    CookieManager.getInstance().getCookie(base)?.split(";")?.map { it.trim() }
        ?.firstOrNull { it.startsWith("$CF_COOKIE=") }?.substringAfter("=")?.takeIf { it.isNotBlank() }

fun clearWebCookies() { CookieManager.getInstance().removeAllCookies(null); CookieManager.getInstance().flush() }

/**
 * Lets the person sign in through the company's Cloudflare Access (SSO) page, exactly as in a browser.
 * The app never sees the SSO password. When the browser lands back on the app host with the Access cookie,
 * [onDone] gets that cookie value (kept in memory / the encrypted vault only).
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun SsoWebView(base: String, onDone: (String) -> Unit, onCancel: () -> Unit) {
    val host = URI(base).host
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth()) {
            TextButton(onClick = onCancel) { Text("ยกเลิก") }
            Text("เข้าสู่ระบบ SSO (Cloudflare Access)", Modifier.padding(top = 12.dp))
        }
        AndroidView(modifier = Modifier.fillMaxSize(), factory = { ctx ->
            WebView(ctx).apply {
                settings.javaScriptEnabled = true          // required by SSO identity-provider pages
                settings.domStorageEnabled = true
                @Suppress("DEPRECATION") settings.saveFormData = false
                settings.allowFileAccess = false; settings.allowContentAccess = false
                CookieManager.getInstance().setAcceptCookie(true)
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest) = r.url.scheme != "https"   // https only
                    private fun check(url: String?) {
                        if (url != null && runCatching { URI(url).host }.getOrNull() == host) accessCookie(base)?.let(onDone)
                    }
                    override fun onPageFinished(v: WebView, url: String?) = check(url)
                    override fun onPageStarted(v: WebView, url: String?, f: Bitmap?) {}
                }
                loadUrl("$base/sb/session")
            }
        })
    }
}
