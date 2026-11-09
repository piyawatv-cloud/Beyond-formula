package th.co.beyondlab.formulastudio.live

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.Alignment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import th.co.beyondlab.formulastudio.domain.*
import th.co.beyondlab.formulastudio.ui.BuildInfo
import th.co.beyondlab.formulastudio.ui.briefLines


/**
 * Live mode, READ ONLY. Shows what the server lets the signed-in role see: jobs, formula rows, approval
 * state and chat. There are no create / edit / approve / close / send controls anywhere in this file.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun LiveRoot() {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var base by remember { mutableStateOf(th.co.beyondlab.formulastudio.BuildConfig.LIVE_BASE) }
    var client by remember { mutableStateOf<LiveClient?>(null) }
    var session by remember { mutableStateOf<LiveSession?>(null) }
    var jobs by remember { mutableStateOf<List<Job>>(emptyList()) }
    var open by remember { mutableStateOf<Job?>(null) }
    var msgs by remember { mutableStateOf<List<ChatMessage>>(emptyList()) }
    var skipped by remember { mutableIntStateOf(0) }
    var viewAs by remember { mutableStateOf(ViewRole.ADMIN) }
    var viewOwner by remember { mutableStateOf<String?>(null) }
    var ownerMenu by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var limit by remember { mutableIntStateOf(100) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val vault = remember { SessionVault(ctx) }
    var login by remember { mutableStateOf(vault.username) }
    var password by remember { mutableStateOf("") }
    var cf by remember { mutableStateOf<String?>(null) }       // Cloudflare Access cookie (SSO done)
    var ssoOpen by remember { mutableStateOf(false) }
    var keep by remember { mutableStateOf(vault.loadCookies() != null) }

    fun <T> io(block: () -> T, ok: (T) -> Unit) { busy = true; error = null
        scope.launch {
            try { ok(withContext(Dispatchers.IO) { block() }) }
            catch (e: LiveError) { error = e.message; if (e.status == 401 || e.status in 301..307) { session = null; client = null; vault.clearCookies(); if (e.status != 401) cf = null } }
            catch (e: Exception) { error = "เกิดข้อผิดพลาด" }
            finally { busy = false }
        } }

    LaunchedEffect(Unit) {   // resume a remembered session (cookie only); falls back to the login form when expired
        if (base.isBlank()) return@LaunchedEffect
        val saved = vault.loadCookies() ?: return@LaunchedEffect
        val cl = LiveClient(HttpTransport(base)); cl.importCookies(saved); cf = cl.cookie(CF_COOKIE)
        io({ val ses = cl.session(); if (ses == null) null else ses to cl.loadJobs() }) { r ->
            if (r == null) vault.clearCookies() else { client = cl; session = r.first; jobs = r.second; skipped = cl.skipped }
        }
    }

    if (ssoOpen) { SsoWebView(base, onDone = { cf = it; ssoOpen = false; error = null }, onCancel = { ssoOpen = false }); return }

    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("ระบบจริง — อ่านอย่างเดียว (ไม่สร้าง ไม่อนุมัติ ไม่ปิดงาน ไม่ส่งแชต)", style = MaterialTheme.typography.labelLarge)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        val s = session; val c = client
        if (s == null || c == null) {
            if (base.isBlank()) {
                Text("ยังไม่ได้ตั้งค่าเซิร์ฟเวอร์ระบบจริง (ตั้ง formula.liveBase ใน local.properties แล้วบิลด์ใหม่)", color = MaterialTheme.colorScheme.error)
                if (BuildInfo.simulateWeb) OutlinedTextField(base, { base = it }, label = { Text("เซิร์ฟเวอร์ (debug)") }, modifier = Modifier.fillMaxWidth())
            } else if (cf == null) {
                Text("ขั้นที่ 1: ผ่านด่าน SSO ของบริษัท (Cloudflare Access) แอปไม่เห็นรหัสผ่าน SSO", style = MaterialTheme.typography.labelSmall)
                Button(onClick = { ssoOpen = true }) { Text("เข้าสู่ระบบ SSO") }
            } else {
            Text("ผ่าน SSO แล้ว ✓ ขั้นที่ 2: เข้าสู่ระบบ Formula", style = MaterialTheme.typography.labelSmall)
            if (BuildInfo.simulateWeb) OutlinedTextField(base, { base = it }, label = { Text("เซิร์ฟเวอร์ (debug)") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(login, { login = it }, label = { Text("ชื่อผู้ใช้") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(password, { password = it }, label = { Text("รหัสผ่าน") }, singleLine = true, visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(keep, { keep = it })
                Text("จดจำการเข้าสู่ระบบในเครื่องนี้")
            }
            Text("รหัสผ่านไม่ถูกบันทึก จดจำเฉพาะชื่อผู้ใช้และเซสชัน (เข้ารหัสในเครื่อง) หมดอายุแล้วต้องใส่รหัสใหม่", style = MaterialTheme.typography.labelSmall)
            Button(enabled = !busy && login.isNotBlank() && password.isNotEmpty(), onClick = {
                val cl = LiveClient(HttpTransport(base)); cf?.let { cl.setCookie(CF_COOKIE, it) }; val l = login; val p = password; password = ""
                io({ val ses = cl.login(l, p); ses to cl.loadJobs() }) { (ses, list) -> client = cl; session = ses; jobs = list; skipped = cl.skipped
                    if (keep) { vault.username = l; vault.saveCookies(cl.exportCookies()) } else vault.forgetAll() }
            }) { Text("เข้าสู่ระบบ") }
            }
        } else {
            Text("${s.name} · ${s.role}", style = MaterialTheme.typography.titleSmall)
            if (s.role.equals("admin", true)) {
                Text("ดูในฐานะบทบาท (ทดสอบ — Admin กลับได้ทุกเมื่อ)", style = MaterialTheme.typography.labelSmall)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    ViewRole.values().forEach { r -> FilterChip(selected = viewAs == r, onClick = { viewAs = r; open = null; if (!r.ownOnly) viewOwner = null }, label = { Text(r.label) }) }
                }
                if (viewAs != ViewRole.ADMIN) {
                    Text("มุมมองจำลอง ${viewAs.label}: ฝั่งแอปเท่านั้น เซิร์ฟเวอร์ยังตอบด้วยสิทธิ์ admin ไม่ใช่การทดสอบการกรองจริง · บนเว็บบทบาทนี้ทำได้: ${viewAs.abilities.joinToString(", ")} · บนมือถือยังอ่านอย่างเดียว",
                        color = MaterialTheme.colorScheme.tertiary, style = MaterialTheme.typography.labelSmall)
                    if (viewAs.ownOnly) Box {
                        OutlinedButton(onClick = { ownerMenu = true }) { Text(viewOwner?.let { "เจ้าของงาน: $it" } ?: "เลือกเจ้าของงานที่จะดูในฐานะ ${viewAs.label}") }
                        DropdownMenu(ownerMenu, { ownerMenu = false }) {
                            ViewRole.owners(jobs).take(60).forEach { o -> DropdownMenuItem(text = { Text(o) }, onClick = { viewOwner = o; ownerMenu = false; open = null }) }
                        }
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(enabled = !busy, onClick = { io({ c.loadJobs(limit) }) { jobs = it; skipped = c.skipped; open = open?.let { o -> it.find { j -> j.id == o.id } } } }) { Text("รีเฟรช") }
                OutlinedButton(onClick = { val cl = c; session = null; client = null; jobs = emptyList(); open = null; vault.clearCookies(); clearWebCookies(); cf = null; viewAs = ViewRole.ADMIN; viewOwner = null; query = ""; limit = 100; if (!keep) vault.forgetAll(); if (!keep) login = ""
                    scope.launch(Dispatchers.IO) { try { cl.logout() } catch (_: Exception) {} } }) { Text("ออกจากระบบ") }
            }
            val j = open
            if (j == null) {
                val shown = ViewRole.visible(viewAs, viewOwner, jobs).filter { ViewRole.matches(it, query) }
                Text("งาน ${shown.size} รายการ" + if (shown.size != jobs.size) " (จากที่โหลด ${jobs.size})" else "", style = MaterialTheme.typography.titleSmall)
                if (skipped > 0) Text("ข้าม $skipped รายการที่อ่านรูปแบบข้อมูลไม่ได้", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelSmall)
                OutlinedTextField(query, { query = it }, label = { Text("ค้นหา (เลขที่งาน แบรนด์ ลูกค้า Sales)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                shown.forEach { x -> Text("${x.id} · ${x.brief.brand.ifBlank { x.brief.customer }}${if (x.closed) " · ปิดแล้ว" else ""}",
                    Modifier.fillMaxWidth().clickable { open = x; msgs = emptyList(); io({ c.loadMessages(x.id) }) { msgs = it } }.padding(vertical = 10.dp)) }
                if (jobs.size >= limit && limit < 500) OutlinedButton(enabled = !busy, onClick = { limit += 100; io({ c.loadJobs(limit) }) { jobs = it; skipped = c.skipped } }) { Text("โหลดเพิ่ม (ตอนนี้ $limit ล่าสุด)") }
                else if (jobs.size >= limit) Text("แสดงสูงสุด 500 งานล่าสุด การค้นหาทำได้เฉพาะงานที่โหลดมา", style = MaterialTheme.typography.labelSmall)
            } else {
                TextButton(onClick = { open = null }) { Text("ย้อนกลับ") }
                Text(listOf(j.id, j.brief.brand, j.brief.customer).filter { it.isNotBlank() }.joinToString(" · "), style = MaterialTheme.typography.titleMedium)
                Text("Sales: ${j.brief.salesOwner.ifBlank { "—" }} · คอนเซป: ${j.brief.conceptStr}")
                briefLines(j.brief).forEach { (k, v) -> Text("$k: $v", style = MaterialTheme.typography.bodyMedium) }
                Text("สูตร", style = MaterialTheme.typography.titleSmall)
                if (j.rows.isEmpty()) Text("ยังไม่มีสาร")
                j.rows.forEach { r -> Text("${r.num}. ${if (r.hero) "⭐ " else ""}${r.name} — ${Fmt.f2(r.w)} mg × ${Fmt.f2(r.p)}% = ${Fmt.f2(r.actual)} mg") }
                if (j.totW > 0) Text("รวมน้ำหนัก ${Fmt.f2(j.totW)} mg · รวมปริมาณจริง ${Fmt.f2(j.totA)} mg", style = MaterialTheme.typography.labelLarge)
                val b = j.brief
                if (b.benefits.isNotEmpty()) { Text("สรรพคุณ", style = MaterialTheme.typography.titleSmall); b.benefits.forEach { Text("• $it") } }
                if (b.allSP.isNotEmpty()) { Text("จุดขาย", style = MaterialTheme.typography.titleSmall); b.allSP.forEach { Text("• $it") } }
                if (b.cons.isNotEmpty()) Text("ข้อจำกัด: ${b.cons.joinToString(", ")}")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (client?.approvalsHidden == true) Text("ไม่มีสิทธิ์ดูสถานะอนุมัติ (บทบาทนี้)", style = MaterialTheme.typography.labelLarge)
                    else listOf("sales", "pd", "ra", "rd").forEach { p -> AssistChip(onClick = {}, label = { Text("${p.uppercase()}: ${if (j.approvals[p] == true) "อนุมัติแล้ว" else "รอ"}") }) }
                }
                if (j.closed) Text("ปิดงานแล้ว", style = MaterialTheme.typography.titleSmall)
                HorizontalDivider()
                if (msgs.isEmpty()) Text("ยังไม่มีข้อความ", style = MaterialTheme.typography.labelSmall)
                msgs.forEach { m -> Text("${m.user}: ${m.text}") }
            }
        }
    }
}
