package org.example.formulastudiotest;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

public class TestReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.createNotificationChannel(new NotificationChannel("fixture", "แจ้งเตือนทดสอบ", NotificationManager.IMPORTANCE_DEFAULT));
        Notification n = new Notification.Builder(context, "fixture").setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Formula Studio — ทดสอบ").setContentText("ข้อมูลจำลอง: แอปถูกปัดออกจากแอปล่าสุด").setAutoCancel(true).build();
        manager.notify(1001, n);
    }
}
