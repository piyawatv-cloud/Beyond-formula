package th.co.beyondlab.formulastudio.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import th.co.beyondlab.formulastudio.data.*
import th.co.beyondlab.formulastudio.domain.*

private val DEMO_USERS = Role.values().associateWith { "demo-${it.label.lowercase()}" }
private val SALES_OWNERS = listOf("demo-sales")

private sealed interface Screen {
    data object List : Screen
    data object Create : Screen
    data class Detail(val id: String) : Screen
    data class EditBrief(val id: String) : Screen
    data class EditFormula(val id: String) : Screen
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppRoot(store: JobStore = InMemoryJobStore(), web: WebData? = null, onApproval: (jobId: String, part: String, allDone: Boolean) -> Unit = { _, _, _ -> }) {
    val repo = remember {
        SimRepository(store, web = web, seed = listOf(
            Job("A00001", Brief(brand = "แบรนด์ตัวอย่าง", customer = "ลูกค้าสมมติ 1", salesOwner = "demo-sales", form = "แคปซูล"),
                IngredientMath.build(listOf(IngredientInput("สารตัวอย่าง", "500", "TH", "50", "", true)), web)),
            Job("A00002", Brief(brand = "แบรนด์ตัวอย่าง 2", customer = "ลูกค้าสมมติ 2", salesOwner = "demo-mkt")),
        ))
    }
    var notice by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(repo) {
        repo.onApprovalReceived = { id, part ->
            val all = repo.get(id)?.approvals?.let { a -> listOf("pd", "ra", "rd").all { a[it] == true } } == true
            notice = if (all) "$id: PD · RA · RD อนุมัติครบแล้ว" else "$id: ${part.uppercase()} อนุมัติแล้ว (จากเว็บ)"
            onApproval(id, part, all)
        }
    }
    var role by remember { mutableStateOf(Role.SALES) }
    var screen by remember { mutableStateOf<Screen>(Screen.List) }
    var tick by remember { mutableIntStateOf(0) }     // bump to re-read the in-memory repo
    var error by remember { mutableStateOf<String?>(null) }
    val user = DEMO_USERS.getValue(role)

    /** Runs [block]; shows its error. Returns true when it succeeded (so forms stay open on failure). */
    fun act(block: () -> Unit): Boolean {
        val ok = try { block(); error = null; true } catch (e: Exception) { error = e.message; false }
        tick++
        return ok
    }

    MaterialTheme {
        Scaffold(topBar = {
            TopAppBar(title = { Text(when (val s = screen) {
                Screen.List -> "งาน"; Screen.Create -> "สร้างงานใหม่"
                is Screen.Detail -> s.id; is Screen.EditBrief -> "แก้ไข ${s.id}"; is Screen.EditFormula -> "แก้สูตร ${s.id}"
            }) }, navigationIcon = {
                if (screen != Screen.List) TextButton(onClick = {
                    screen = when (val s = screen) {
                        is Screen.EditBrief -> Screen.Detail(s.id); is Screen.EditFormula -> Screen.Detail(s.id); else -> Screen.List
                    }; error = null
                }) { Text("ย้อนกลับ") }
            })
        }) { pad ->
            Column(Modifier.padding(pad).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("โหมดจำลอง — บทบาทเป็นเพียงตัวเลือกทดสอบ ไม่ใช่การเข้าสู่ระบบ", style = MaterialTheme.typography.labelSmall)
                RolePicker(role) { role = it; screen = Screen.List; error = null }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                notice?.let { n -> Card(Modifier.fillMaxWidth()) { Row(Modifier.padding(8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("🔔 $n", Modifier.weight(1f)); TextButton(onClick = { notice = null }) { Text("ปิด") } } } }
                key(tick, screen) {
                    when (val s = screen) {
                        Screen.List -> JobList(repo, role, user, { screen = Screen.Detail(it) }, { screen = Screen.Create })
                        Screen.Create -> if (!role.can(Cap.CREATE_DATA)) Text("สิทธิ์ไม่พอ — สร้างงาน (Role: ${role.label})") else
                            BriefForm(Brief(salesOwner = if (role.ownOnly) user else SALES_OWNERS.first()), listOf(IngredientInput()),
                                SALES_OWNERS, if (role.ownOnly) user else null, web, "บันทึกงานใหม่") { b, r, c ->
                                var created: Job? = null
                                if (act { created = repo.createJob(role, user, b, r, c) }) screen = Screen.Detail(created!!.id)
                            }
                        is Screen.Detail -> JobDetail(repo, role, user, s.id, ::act,
                            { screen = Screen.EditBrief(s.id) }, { screen = Screen.EditFormula(s.id) })
                        is Screen.EditBrief -> repo.get(s.id)?.let { j ->
                            if (!role.can(Cap.CREATE_DATA)) Text("สิทธิ์ไม่พอ — แก้ชุดข้อมูลงาน (Role: ${role.label})") else
                                BriefForm(j.brief, IngredientMath.toInputs(j.rows), SALES_OWNERS, j.brief.salesOwner, web, "บันทึกการแก้ไข") { b, r, c ->
                                    if (act { repo.updateBrief(role, user, s.id, b, r, c) }) screen = Screen.Detail(s.id)
                                }
                        } ?: Text("ไม่พบงาน")
                        is Screen.EditFormula -> repo.get(s.id)?.let { j ->
                            if (!role.can(Cap.EDIT_FORMULA)) Text("สิทธิ์ไม่พอ — แก้สูตร (Role: ${role.label})") else
                                FormulaEditScreen(IngredientMath.toInputs(j.rows), web) { r ->
                                    if (act { repo.editFormula(role, user, s.id, r) }) screen = Screen.Detail(s.id)
                                }
                        } ?: Text("ไม่พบงาน")
                    }
                }
            }
        }
    }
}

@Composable
private fun FormulaEditScreen(initial: List<IngredientInput>, web: WebData?, onSave: (List<IngredientInput>) -> Unit) {
    var rows by remember { mutableStateOf(initial.ifEmpty { listOf(IngredientInput()) }) }
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        IngredientEditor(rows, web) { rows = it }
        Button(onClick = { onSave(rows) }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text("บันทึกสูตร") }
        Spacer(Modifier.height(24.dp))
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RolePicker(current: Role, onPick: (Role) -> Unit) = FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
    Role.values().forEach { r -> FilterChip(selected = r == current, onClick = { onPick(r) }, label = { Text(r.label) }) }
}

@Composable
private fun JobList(repo: SimRepository, role: Role, user: String, onOpen: (String) -> Unit, onCreate: () -> Unit) {
    if (role.can(Cap.CREATE_DATA)) Button(onClick = onCreate, modifier = Modifier.heightIn(min = 48.dp)) { Text("+ สร้างงาน") }
    val jobs = repo.visibleJobs(role, user)
    if (jobs.isEmpty()) Text("ยังไม่มีงานที่คุณเห็น")
    LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items(jobs, key = { it.id }) { j ->
            Card(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { onOpen(j.id) }) {
                Column(Modifier.padding(12.dp)) {
                    Text("${j.id} · ${j.brief.brand}")
                    Text("${j.brief.customer} · ${if (j.closed) "ปิดแล้ว" else "เปิดอยู่"}", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
@OptIn(ExperimentalLayoutApi::class)
private fun JobDetail(repo: SimRepository, role: Role, user: String, id: String, act: (() -> Unit) -> Boolean, onEditBrief: () -> Unit, onEditFormula: () -> Unit) {
    val j = repo.get(id) ?: run { Text("ไม่พบงาน"); return }
    val b = j.brief
    var text by remember { mutableStateOf("") }
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("${b.brand} · ${b.customer}", style = MaterialTheme.typography.titleMedium)
        Text("Sales: ${b.salesOwner.ifBlank { "—" }} · คอนเซป: ${b.conceptStr}")
        briefLines(b).forEach { (k, v) -> Text("$k: $v", style = MaterialTheme.typography.bodyMedium) }

        Text("สูตร", style = MaterialTheme.typography.titleSmall)
        if (j.rows.isEmpty()) Text("ยังไม่มีสาร")
        j.rows.forEach { r ->
            Text("${r.num}. ${if (r.hero) "⭐ " else ""}${r.name} — ${Fmt.f2(r.w)} mg × ${Fmt.f2(r.p)}% = ${Fmt.f2(r.actual)} mg · ${r.o}" +
                (if (r.note.isNotBlank()) " · ${r.note}" else ""))
            r.fda?.let { f -> Text(if (f.status == "ok") f.icon else f.display, style = MaterialTheme.typography.bodySmall) }
        }
        if (j.rows.isNotEmpty()) Text("รวมน้ำหนัก ${Fmt.f2(j.totW)} mg · รวมปริมาณจริง ${Fmt.f2(j.totA)} mg", style = MaterialTheme.typography.labelLarge)
        val st = j.rows.mapNotNull { it.fda?.status }
        if (st.isNotEmpty()) Text("อย.: 🔴 ${st.count { it == "not_approved" }} · 🟡 ${st.count { it == "over" }} · ⚪ ${st.count { it == "unknown" }} · 🟢 ${st.count { it == "ok" }}", style = MaterialTheme.typography.labelLarge)
        else if (j.rows.isNotEmpty()) Text("ไม่มีข้อมูลอ้างอิง อย. ในบิลด์นี้", style = MaterialTheme.typography.labelSmall)
        if (b.benefits.isNotEmpty()) { Text("สรรพคุณ", style = MaterialTheme.typography.titleSmall); b.benefits.forEach { Text("• $it") } }
        if (b.allSP.isNotEmpty()) { Text("จุดขาย", style = MaterialTheme.typography.titleSmall); b.allSP.forEach { Text("• $it") } }
        if (b.cons.isNotEmpty()) Text("ข้อจำกัด: ${b.cons.joinToString(", ")}")

        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (role.can(Cap.CREATE_DATA) && !j.closed) OutlinedButton(onClick = onEditBrief) { Text("แก้ข้อมูลงาน") }
            if (role.can(Cap.EDIT_FORMULA) && !j.closed) OutlinedButton(onClick = onEditFormula) { Text("แก้สูตร") }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("sales", "pd", "ra", "rd").forEach { part ->
                val done = j.approvals[part] == true
                if (role.canApproveOnMobile(part) && !done && !j.closed) {
                    Button(onClick = { act { repo.approve(role, user, id, part) } }) { Text("อนุมัติ ${part.uppercase()}") }
                } else {
                    AssistChip(onClick = {}, label = { Text("${part.uppercase()}: ${if (done) "อนุมัติแล้ว" else "รอ"}") })
                }
            }
        }
        if (listOf("pd", "ra", "rd").all { j.approvals[it] == true }) Text("PD · RA · RD อนุมัติครบแล้ว", style = MaterialTheme.typography.titleSmall)
        else Text("PD/RA/RD อนุมัติผ่านเว็บเท่านั้น — แอปแสดงสถานะและแจ้งเตือน", style = MaterialTheme.typography.labelSmall)
        if (BuildInfo.simulateWeb && !j.closed) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("pd", "ra", "rd").filter { j.approvals[it] != true }.forEach { part ->
                OutlinedButton(onClick = { act { repo.applyRemoteApproval(id, part) } }) { Text("จำลอง: เว็บอนุมัติ ${part.uppercase()}") }
            }
        }
        if (j.closed) Text("ปิดงานแล้ว", style = MaterialTheme.typography.titleSmall)
        if (role.canCloseOnMobile() && !j.closed) OutlinedButton(onClick = { act { repo.close(role, user, id) } }) { Text("ปิดงาน") }
        HorizontalDivider()
        j.messages.forEach { m -> Text("${m.user}: ${m.text}") }
        if (role.can(Cap.CHAT)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(text, { text = it }, label = { Text("ข้อความ") }, modifier = Modifier.weight(1f))
                Button(onClick = { val t = text; if (act { repo.send(role, user, id, t, System.currentTimeMillis()) }) text = "" }) { Text("ส่ง") }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}
