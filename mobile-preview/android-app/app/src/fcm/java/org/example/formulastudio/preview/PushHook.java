package org.example.formulastudio.preview;

import android.content.Context;
import com.google.firebase.messaging.FirebaseMessaging;

/** รุ่นที่มี FCM: ลงทะเบียน token กับเซิร์ฟเวอร์หลังล็อกอิน แล้วหยุด polling (กันแจ้งเตือนซ้ำ) */
final class PushHook {
    static boolean available() { return true; }

    static void start(Context c) {
        final Context app = c.getApplicationContext();
        PollService.cancel(app);
        FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token -> new Thread(() -> register(app, token)).start())
            .addOnFailureListener(e -> PollService.schedule(app)); // ขอ token ไม่ได้ → ถอยไปใช้ polling
    }

    static void register(Context c, String token) {
        if (token == null || token.isEmpty()) return;
        String r = LiveHttp.request(c, "POST", "/__formula/push-register", "{\"content-type\":\"application/json\"}", "{\"token\":\"" + token + "\"}");
        if (r.contains("\"status\":200")) LiveHttp.prefs(c).edit().putString("fcm_token", token).apply();
        else PollService.schedule(c); // เซิร์ฟเวอร์ยังไม่เปิดบริการแจ้งเตือน → ถอยไปใช้ polling
    }

    static void stop(Context c) {
        String token = LiveHttp.prefs(c).getString("fcm_token", "");
        if (!token.isEmpty()) {
            LiveHttp.request(c, "POST", "/__formula/push-unregister", "{\"content-type\":\"application/json\"}", "{\"token\":\"" + token + "\"}");
            LiveHttp.prefs(c).edit().remove("fcm_token").apply();
        }
        PollService.cancel(c);
    }
}
