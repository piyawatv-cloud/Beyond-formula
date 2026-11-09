package th.co.beyondlab.formulastudio.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions

@Composable
fun Field(label: String, value: String, onChange: (String) -> Unit, number: Boolean = false, modifier: Modifier = Modifier.fillMaxWidth()) =
    OutlinedTextField(
        value, onChange, label = { Text(label) }, modifier = modifier, singleLine = true,
        keyboardOptions = if (number) KeyboardOptions(keyboardType = KeyboardType.Decimal) else KeyboardOptions.Default,
    )

/** Read-only dropdown. [options] are (stored value, label); a blank first entry clears the choice. */
@Composable
fun Dropdown(label: String, value: String, options: List<Pair<String, String>>, onPick: (String) -> Unit, modifier: Modifier = Modifier.fillMaxWidth()) {
    var open by remember { mutableStateOf(false) }
    val shown = options.firstOrNull { it.first == value }?.second ?: value
    Box(modifier) {
        OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
            Text(if (shown.isBlank()) label else "$label: $shown", maxLines = 2)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text("— ไม่เลือก —") }, onClick = { onPick(""); open = false })
            options.forEach { (v, l) -> DropdownMenuItem(text = { Text(l) }, onClick = { onPick(v); open = false }) }
        }
    }
}

fun simple(list: List<String>) = list.map { it to it }
