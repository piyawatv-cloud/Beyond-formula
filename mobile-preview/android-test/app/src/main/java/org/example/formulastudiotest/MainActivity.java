package org.example.formulastudiotest;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MainActivity extends Activity {
    private TextView status;
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL); root.setPadding(32, 48, 32, 32);
        TextView title = new TextView(this); title.setText("ทดสอบแจ้งเตือน Formula Studio"); title.setTextSize(22); root.addView(title);
        TextView intro = new TextView(this); intro.setText("ข้อมูลจำลอง · ไม่มีอินเทอร์เน็ตและไม่เชื่อมฐานข้อมูล\nอนุญาตแจ้งเตือน แล้วกดตั้งเวลา จากนั้นปัดแอปออกจากแอปล่าสุด\nไม่ใช่การทดสอบ Push จริง และการบังคับหยุดอาจยกเลิกการแจ้งเตือน"); intro.setTextSize(16); root.addView(intro);
        Button permission = new Button(this); permission.setText("อนุญาตแจ้งเตือน"); permission.setOnClickListener(v -> requestNotificationPermission()); root.addView(permission);
        Button schedule = new Button(this); schedule.setText("ตั้งแจ้งเตือนทดสอบใน 20 วินาที"); schedule.setOnClickListener(v -> scheduleNotification()); root.addView(schedule);
        status = new TextView(this); status.setTextSize(16); status.setGravity(Gravity.START); root.addView(status); setContentView(root);
    }
    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 42);
        else status.setText("อนุญาตแจ้งเตือนแล้ว");
    }
    private void scheduleNotification() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) { status.setText("กรุณาอนุญาตแจ้งเตือนก่อน"); return; }
        Intent intent = new Intent(this, TestReceiver.class);
        PendingIntent pending = PendingIntent.getBroadcast(this, 1, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        AlarmManager alarm = (AlarmManager) getSystemService(ALARM_SERVICE);
        alarm.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + 20000, pending);
        status.setText("ตั้งเวลาแล้ว · ปัดแอปออกจากแอปล่าสุดเพื่อทดสอบ (ระบบอาจแสดงช้ากว่า 20 วินาที)");
    }
}
