package th.co.beyondlab.formulastudio

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.ui.unit.dp
import th.co.beyondlab.formulastudio.ui.AppRoot

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = th.co.beyondlab.formulastudio.data.RoomJobStore(this)
        val web = th.co.beyondlab.formulastudio.domain.WebData.parse(assets.open("web_data.json").bufferedReader().use { it.readText() })
        th.co.beyondlab.formulastudio.ui.BuildInfo.simulateWeb = (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (android.os.Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
        val notifier = Notifier(this)
        setContent {
            var live by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
            androidx.compose.foundation.layout.Column {
                androidx.compose.foundation.layout.Row(androidx.compose.ui.Modifier.statusBarsPadding().padding(horizontal = 16.dp), horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp)) {
                    androidx.compose.material3.FilterChip(!live, { live = false }, { androidx.compose.material3.Text("จำลอง") })
                    androidx.compose.material3.FilterChip(live, { live = true }, { androidx.compose.material3.Text("ระบบจริง (อ่านอย่างเดียว)") })
                }
                if (live) th.co.beyondlab.formulastudio.live.LiveRoot()
                else AppRoot(store, web) { id, part, all -> notifier.approval(id, part, all) }
            }
        }
    }
}
