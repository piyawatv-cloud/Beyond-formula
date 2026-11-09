package org.example.formulastudio.preview;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.app.AlertDialog;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/** ห่อ mobile-preview/index.html (ข้อมูลจำลอง) ไว้ในแอป ไม่ต่ออินเทอร์เน็ต */
public class MainActivity extends Activity {
    private WebView web;
    private final ExecutorService net = Executors.newFixedThreadPool(3);

    /** สะพานเดียวที่หน้าเว็บเรียกได้ */
    public class Bridge {
        @JavascriptInterface public void schedule(long delayMs, String title, String text) {
            long wait = Math.max(1000, Math.min(delayMs, 3600000));
            Intent i = new Intent(MainActivity.this, AlertReceiver.class).putExtra("title", String.valueOf(title)).putExtra("text", String.valueOf(text));
            PendingIntent p = PendingIntent.getBroadcast(MainActivity.this, (int) (System.nanoTime() & 0x7fffffff), i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            ((AlarmManager) getSystemService(Context.ALARM_SERVICE)).set(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + wait, p);
        }
    }

    /** บันทึกไฟล์ส่งออกลงโฟลเดอร์ดาวน์โหลดของเครื่อง (WebView ดาวน์โหลด blob เองไม่ได้) */
    public class FileBridge {
        @JavascriptInterface public void saveFile(String name, String base64, String mime) {
            try {
                String safe = name.replaceAll("[^A-Za-z0-9._-]", "_");
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    v.put(MediaStore.Downloads.MIME_TYPE, mime);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    try (OutputStream o = getContentResolver().openOutputStream(uri)) { o.write(data); }
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    try (FileOutputStream o = new FileOutputStream(new File(dir, safe))) { o.write(data); }
                }
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "บันทึกไฟล์แล้วในโฟลเดอร์ดาวน์โหลด: " + safe, Toast.LENGTH_LONG).show());
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "บันทึกไฟล์ไม่สำเร็จ", Toast.LENGTH_LONG).show());
            }
        }
    }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        AlertReceiver.ensureChannel(this);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setAllowContentAccess(false);
        Bridge bridge = new Bridge();
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface public void schedule(long d, String t, String x) { bridge.schedule(d, t, x); }
            @JavascriptInterface public void saveFile(String n, String b, String m) { new FileBridge().saveFile(n, b, m); }
            /** คำขอไปประตูข้อมูล Formula (จำกัดเส้นทางใน LiveHttp) ผลกลับทาง window.__nativeHttpDone */
            @JavascriptInterface public void httpAsync(int id, String method, String path, String headers, String body) {
                net.execute(() -> {
                    String result = LiveHttp.request(MainActivity.this, method, path, headers, body);
                    runOnUiThread(() -> web.evaluateJavascript("window.__nativeHttpDone(" + id + "," + JSONObject.quote(result) + ")", null));
                });
            }
            @JavascriptInterface public void startPolling() { net.execute(() -> PushHook.start(MainActivity.this)); }
            @JavascriptInterface public void stopPolling() { net.execute(() -> { PushHook.stop(MainActivity.this); LiveHttp.clearSession(MainActivity.this); }); }
        }, "FormulaNative");
        // confirm()/alert() ของหน้าเว็บต้องมีกล่องโต้ตอบ ไม่เช่นนั้น WebView ตอบ "ไม่" เงียบ ๆ (ปุ่มอนุมัติ/ปิดงาน/Reject จะไม่ทำงาน)
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsConfirm(WebView v, String url, String msg, JsResult r) {
                new AlertDialog.Builder(MainActivity.this).setMessage(msg).setCancelable(false)
                    .setPositiveButton("ตกลง", (d, w) -> r.confirm()).setNegativeButton("ยกเลิก", (d, w) -> r.cancel()).show();
                return true;
            }
            @Override public boolean onJsAlert(WebView v, String url, String msg, JsResult r) {
                new AlertDialog.Builder(MainActivity.this).setMessage(msg).setCancelable(false)
                    .setPositiveButton("ตกลง", (d, w) -> r.confirm()).show();
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return !r.getUrl().toString().startsWith("file:///android_asset/");
            }
        });
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
    }

    @Override public void onBackPressed() { moveTaskToBack(true); }
}
