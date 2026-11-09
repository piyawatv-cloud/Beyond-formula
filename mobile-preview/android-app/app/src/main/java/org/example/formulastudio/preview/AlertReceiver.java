package org.example.formulastudio.preview;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

/** แสดงแจ้งเตือนในเครื่อง ใช้ได้ทั้งตอนแอปเปิดอยู่และตอนถูกปัดออก (ไม่รวมถูกบังคับหยุด) */
public class AlertReceiver extends BroadcastReceiver {
    static void ensureChannel(Context context) {
        ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel("formula", "แจ้งเตือน Formula Studio (ทดสอบ)", NotificationManager.IMPORTANCE_DEFAULT));
    }

    static void show(Context context, String title, String text) {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.createNotificationChannel(new NotificationChannel("formula", "แจ้งเตือน Formula Studio (ทดสอบ)", NotificationManager.IMPORTANCE_DEFAULT));
        PendingIntent open = PendingIntent.getActivity(context, 0, new Intent(context, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(context, "formula").setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title).setContentText(text).setContentIntent(open).setAutoCancel(true).build();
        manager.notify((int) (System.currentTimeMillis() & 0x7fffffff), n);
    }

    @Override public void onReceive(Context context, Intent intent) {
        show(context, intent.getStringExtra("title"), intent.getStringExtra("text"));
    }
}
