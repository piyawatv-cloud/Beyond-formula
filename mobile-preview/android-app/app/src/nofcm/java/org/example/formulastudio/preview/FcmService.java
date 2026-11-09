package org.example.formulastudio.preview;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

/** ตัวแทนว่างของรุ่นที่ไม่มี FCM (ประกาศใน manifest แต่ไม่ถูกเรียก) */
public class FcmService extends Service {
    @Override public IBinder onBind(Intent intent) { return null; }
}
