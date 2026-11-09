package th.co.beyondlab.formulastudio.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import th.co.beyondlab.formulastudio.domain.*

/** Create / edit form, same fields as the web "Customer Data" form. [fixedOwner] locks Sales owner. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BriefForm(
    initial: Brief, initialRows: List<IngredientInput>, salesOwners: List<String>, fixedOwner: String?, web: WebData?,
    submitLabel: String, onSubmit: (Brief, List<IngredientInput>, List<String>) -> Unit,
) {
    // web editRecordInSales: concepts that match a chip re-select it, the rest go to the custom box joined by ' + ';
    // claims are re-loaded from the derived `benefits`; cons from `cons`.
    val chipValues = FormOptions.concepts.map { it.second }
    var b by remember { mutableStateOf(initial.copy(allConcepts = initial.allConcepts.filter { it in chipValues })) }
    var custom by remember { mutableStateOf(initial.allConcepts.filter { it !in chipValues }.joinToString(" + ")) }
    var claims by remember { mutableStateOf(initial.benefits) }
    var cons by remember { mutableStateOf(initial.cons) }
    var rows by remember { mutableStateOf(initialRows) }
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Field("ชื่อลูกค้า / Company", b.customer, { b = b.copy(customer = it) })
        Field("ชื่อแบรนด์ / Brand", b.brand, { b = b.copy(brand = it) })
        if (fixedOwner != null) Text("Sales ผู้รับผิดชอบ: $fixedOwner")
        else Dropdown("Sales ผู้รับผิดชอบ", b.salesOwner, simple(salesOwners), { b = b.copy(salesOwner = it) })
        Field("เบอร์ติดต่อ", b.phone, { b = b.copy(phone = it) })

        Text("คอนเซปสินค้า", style = MaterialTheme.typography.titleSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            FormOptions.concepts.forEach { (label, stored) ->
                FilterChip(
                    selected = stored in b.allConcepts,
                    onClick = { b = b.copy(allConcepts = if (stored in b.allConcepts) b.allConcepts - stored else b.allConcepts + stored) },
                    label = { Text(label) },
                )
            }
        }
        Field("คอนเซปเพิ่มเติม (กรอกเองได้)", custom, { custom = it })

        Dropdown("รูปแบบสินค้า", b.form, simple(FormOptions.forms), { b = b.copy(form = it) })
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Field("ขนาดบรรจุ", b.size, { b = b.copy(size = it) }, modifier = Modifier.weight(1f))
            Field("หน่วย", b.sizeUnit, { b = b.copy(sizeUnit = it) }, modifier = Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Field("น้ำหนักต่อหน่วย", b.uw, { b = b.copy(uw = it) }, modifier = Modifier.weight(1f))
            Dropdown("หน่วย", b.uwUnit, simple(FormOptions.weightUnits), { b = b.copy(uwUnit = it) }, Modifier.weight(1f))
        }
        Dropdown("หมวดผลิตภัณฑ์", b.cat, simple(FormOptions.cats.keys.toList()), { b = b.copy(cat = it, subcat = "") })
        if (b.cat.isNotBlank()) {
            Dropdown("หมวดย่อย", b.subcat, simple(FormOptions.cats[b.cat].orEmpty()), { b = b.copy(subcat = it) })
        }
        Field("กลุ่มเป้าหมาย (เว้นว่าง = ใช้ค่าแนะนำจากคอนเซป)", b.finalTarget, { b = b.copy(finalTarget = it) })
        Dropdown("เพศ", b.gender, simple(FormOptions.genders), { b = b.copy(gender = it) })
        Field("ราคาเป้าหมาย/หน่วย (บาท)", b.price, { b = b.copy(price = it) }, number = true)
        Dropdown("ความสำคัญ", b.priority, FormOptions.priorities, { b = b.copy(priority = it.ifBlank { "medium" }) })
        Dropdown("ลักษณะการจดแจ้ง อย.", b.fdaType, simple(FormOptions.fdaTypes), { b = b.copy(fdaType = it) })
        Field("สี", b.color, { b = b.copy(color = it) })
        Field("กลิ่น", b.scent, { b = b.copy(scent = it) })
        Field("รส", b.flavor, { b = b.copy(flavor = it) })
        Dropdown("การบรรจุ (บรรจุภัณฑ์)", b.packType, simple(FormOptions.packTypes), { b = b.copy(packType = it) })
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Field("กว้าง (ซม.)", b.widthCm, { b = b.copy(widthCm = it) }, number = true, modifier = Modifier.weight(1f))
            Field("ยาว (ซม.)", b.lengthCm, { b = b.copy(lengthCm = it) }, number = true, modifier = Modifier.weight(1f))
        }
        IngredientEditor(rows, web) { rows = it }
        TagEditor("สรรพคุณที่ลูกค้า Request (ไม่บังคับ)", claims) { claims = it }
        TagEditor("ข้อจำกัด / Constraints (ไม่บังคับ)", cons) { cons = it }
        OutlinedTextField(b.notes, { b = b.copy(notes = it) }, label = { Text("หมายเหตุ / Notes") }, modifier = Modifier.fillMaxWidth(), minLines = 3)
        Button(onClick = {
            val concepts = b.allConcepts + listOfNotNull(custom.trim().ifEmpty { null })   // web: custom is ONE extra concept
            onSubmit(b.copy(allConcepts = concepts, cons = cons), rows, claims)
        }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text(submitLabel) }
        Spacer(Modifier.height(24.dp))
    }
}
