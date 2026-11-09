package th.co.beyondlab.formulastudio

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/** Local notification only (no network, no push). Silently skips when the user has not granted permission. */
class Notifier(private val ctx: Context) {
    private val channelId = "approvals"

    init {
        if (Build.VERSION.SDK_INT >= 26)
            ctx.getSystemService(NotificationManager::class.java)
                .createNotificationChannel(NotificationChannel(channelId, "การอนุมัติ", NotificationManager.IMPORTANCE_DEFAULT))
    }

    fun approval(jobId: String, part: String, allDone: Boolean) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val text = if (allDone) "$jobId: PD · RA · RD อนุมัติครบแล้ว" else "$jobId: ${part.uppercase()} อนุมัติแล้ว"
        val n = NotificationCompat.Builder(ctx, channelId).setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Formula Studio").setContentText(text).setAutoCancel(true).build()
        ctx.getSystemService(NotificationManager::class.java).notify(jobId.hashCode() * 31 + part.hashCode(), n)
    }
}
