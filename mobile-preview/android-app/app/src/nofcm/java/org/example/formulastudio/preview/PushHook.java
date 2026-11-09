package org.example.formulastudio.preview;

import android.content.Context;

/** รุ่นที่ไม่มี FCM: ใช้ polling เบื้องหลัง */
final class PushHook {
    static boolean available() { return false; }
    static void start(Context c) { PollService.schedule(c); }
    static void stop(Context c) { PollService.cancel(c); }
}
