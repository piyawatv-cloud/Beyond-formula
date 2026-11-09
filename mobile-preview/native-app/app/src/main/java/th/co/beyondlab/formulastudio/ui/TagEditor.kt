package th.co.beyondlab.formulastudio.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Web "tag" input (type + add, tap a tag to remove). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TagEditor(label: String, tags: List<String>, onChange: (List<String>) -> Unit) {
    var text by remember { mutableStateOf("") }
    fun add() { val t = text.trim(); if (t.isNotEmpty()) onChange(tags + t); text = "" }
    Text(label, style = MaterialTheme.typography.titleSmall)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        tags.forEachIndexed { i, t ->
            InputChip(selected = false, onClick = { onChange(tags.toMutableList().also { it.removeAt(i) }) },
                label = { Text("$t ×") })
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Field("พิมพ์แล้วกดเพิ่ม", text, { text = it }, modifier = Modifier.weight(1f))
        OutlinedButton(onClick = ::add, modifier = Modifier.heightIn(min = 48.dp)) { Text("เพิ่ม") }
    }
}
