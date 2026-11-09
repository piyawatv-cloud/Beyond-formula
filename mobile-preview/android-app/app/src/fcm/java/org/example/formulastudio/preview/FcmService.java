package org.example.formulastudio.preview;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class FcmService extends FirebaseMessagingService {
    @Override public void onNewToken(String token) {
        if (LiveHttp.hasSession(this)) new Thread(() -> PushHook.register(getApplicationContext(), token)).start();
    }

    /** แอปเปิดอยู่: ระบบไม่แสดงเอง จึงแสดงข้อความทั่วไปที่เซิร์ฟเวอร์ส่งมา (ไม่มีรายละเอียดงาน) */
    @Override public void onMessageReceived(RemoteMessage message) {
        RemoteMessage.Notification n = message.getNotification();
        if (n != null) AlertReceiver.show(this, n.getTitle() == null ? "Formula Studio" : n.getTitle(), n.getBody() == null ? "มีการอัปเดตใน Formula Studio" : n.getBody());
    }
}
