package org.example.formulastudio.preview;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** ตั้งการถามข้อความใหม่อีกครั้งหลังเปิดเครื่อง ถ้ายังล็อกอินค้างอยู่ */
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) { if (LiveHttp.hasSession(c) && !PushHook.available()) PollService.schedule(c); }
}
