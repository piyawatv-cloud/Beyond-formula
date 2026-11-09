package th.co.beyondlab.formulastudio.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import th.co.beyondlab.formulastudio.domain.*

/** Editable ingredient rows with the web's live actual amount, FDA check and totals. */
@Composable
fun IngredientEditor(rows: List<IngredientInput>, web: WebData?, onChange: (List<IngredientInput>) -> Unit) {
    fun set(i: Int, r: IngredientInput) = onChange(rows.toMutableList().also { it[i] = r })
    // web onIngChange: an exact IDB name fills origin / purity / note only where they are empty
    fun setName(i: Int, r: IngredientInput, name: String) {
        val db = web?.idb?.get(name)
        set(i, if (db == null) r.copy(name = name) else r.copy(
            name = name,
            o = r.o.ifBlank { db.o }, p = r.p.ifBlank { Fmt.js(db.p) }, note = r.note.ifBlank { db.note }))
    }
    Text("สารสกัด / Ingredients", style = MaterialTheme.typography.titleSmall)
    rows.forEachIndexed { i, r ->
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("${i + 1}", Modifier.width(24.dp))
                    Field("ชื่อสาร", r.name, { setName(i, r, it) }, modifier = Modifier.weight(1f))
                    IconButton(onClick = { set(i, r.copy(hero = !r.hero)) }, modifier = Modifier.size(48.dp)) {
                        Icon(if (r.hero) Icons.Filled.Star else Icons.Outlined.StarBorder,
                            contentDescription = if (r.hero) "Hero ingredient (เปิด)" else "Hero ingredient (ปิด)")
                    }
                    IconButton(onClick = { onChange(rows.toMutableList().also { it.removeAt(i) }) }, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Filled.Delete, contentDescription = "ลบแถว ${i + 1}")
                    }
                }
                val q = r.name.trim()
                if (web != null && q.length >= 2 && web.idb[r.name] == null) {
                    val hits = web.idb.keys.filter { it.contains(q, ignoreCase = true) }.take(4)
                    if (hits.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        hits.forEach { h -> SuggestionChip(onClick = { setName(i, r, h) }, label = { Text(h, maxLines = 1) }) }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Field("น้ำหนัก (mg)", r.w, { set(i, r.copy(w = it)) }, number = true, modifier = Modifier.weight(1f))
                    Field("Purity %", r.p, { set(i, r.copy(p = it)) }, number = true, modifier = Modifier.weight(1f))
                }
                Field("Origin", r.o, { set(i, r.copy(o = it)) })
                Field("หมายเหตุ", r.note, { set(i, r.copy(note = it)) })
                Text("ปริมาณจริง: ${IngredientMath.preview(r.w, r.p.ifBlank { "100" })}", style = MaterialTheme.typography.bodySmall)
                if (web != null && r.name.isNotBlank()) {
                    val wv = r.w.trim().toDoubleOrNull()?.takeIf { it.isFinite() } ?: 0.0
                    val pv = r.p.ifBlank { "100" }.trim().toDoubleOrNull()?.takeIf { it.isFinite() } ?: 0.0
                    val f = web.checkFda(r.name.trim(), IngredientMath.actual(wv, pv))
                    Text(f.display, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
    OutlinedButton(onClick = { onChange(rows + IngredientInput()) }, modifier = Modifier.heightIn(min = 48.dp)) { Text("+ เพิ่มสาร") }
    val totals = runCatching { IngredientMath.build(rows) }.getOrNull()
    Text(
        if (totals == null) "ตรวจตัวเลขในแถวสารอีกครั้ง"
        else "รวมน้ำหนัก ${Fmt.f2(totals.sumOf { it.w })} mg · รวมปริมาณจริง ${Fmt.f2(totals.sumOf { it.actual })} mg",
        style = MaterialTheme.typography.labelLarge,
    )
}
