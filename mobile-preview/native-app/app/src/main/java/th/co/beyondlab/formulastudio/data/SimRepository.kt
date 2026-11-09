package th.co.beyondlab.formulastudio.data

import th.co.beyondlab.formulastudio.domain.*

/**
 * In-memory SIMULATED store. No network, no real data. Every action re-checks the
 * role (web rule 8: hiding a button is not enough).
 */
class SimRepository(
    private val store: JobStore = InMemoryJobStore(), seed: List<Job> = emptyList(),
    /** Web reference data (FDA table, concept KB). Null = no FDA check / no derived claims. */
    private val web: WebData? = null,
) {
    private val jobs = LinkedHashMap<String, Job>()
    /** Monotonic counter persisted in the store: deleting a job never lowers it, so job numbers are never reused. */
    private var counter = 0
    private var msgSeq = 0L

    init {
        // Seed only an empty store, so restarts never duplicate or overwrite saved jobs.
        if (store.loadAll().isEmpty() && store.counter == 0) seed.forEach { store.save(it) }
        store.loadAll().forEach { jobs[it.id] = it }
        counter = maxOf(store.counter, jobs.keys.maxOfOrNull { it.drop(1).toIntOrNull() ?: 0 } ?: 0)
        store.counter = counter
        msgSeq = jobs.values.flatMap { it.messages }.maxOfOrNull { it.id.drop(1).toLongOrNull() ?: 0 } ?: 0
    }

    private fun put(j: Job) { jobs[j.id] = j; store.save(j) }

    fun visibleJobs(role: Role, user: String): List<Job> =
        jobs.values.filter { !role.ownOnly || it.brief.salesOwner == user }.sortedByDescending { it.id }

    fun get(id: String): Job? = jobs[id]

    fun createJob(role: Role, user: String, brief: Brief, rows: List<IngredientInput> = emptyList(), claims: List<String> = emptyList()): Job {
        need(role.can(Cap.CREATE_DATA), "สร้างงาน", role)
        validate(brief)
        val built = IngredientMath.build(rows, web)   // validate before touching the counter
        counter += 1; store.counter = counter
        val b = if (role.ownOnly) brief.copy(salesOwner = user) else brief
        val job = Job("A%05d".format(counter), derive(clean(b), claims), built)
        put(job)
        return job
    }

    /** Edit the brief and its rows (needs createData). Id, approvals, chat and owner are kept. */
    fun updateBrief(role: Role, user: String, id: String, brief: Brief, rows: List<IngredientInput>, claims: List<String> = emptyList()) {
        need(role.can(Cap.CREATE_DATA), "แก้ชุดข้อมูลงาน", role)
        val j = editable(role, user, id)
        validate(brief)
        val built = IngredientMath.build(rows, web)
        put(j.copy(brief = derive(clean(brief.copy(salesOwner = j.brief.salesOwner)), claims), rows = built))
    }

    /** Formula-only edit (PD/Admin: editFormula). Brief stays untouched. */
    fun editFormula(role: Role, user: String, id: String, rows: List<IngredientInput>) {
        need(role.can(Cap.EDIT_FORMULA), "แก้สูตร", role)
        val j = editable(role, user, id)
        put(j.copy(rows = IngredientMath.build(rows, web)))
    }

    /** Deleting a job frees nothing: the counter stays. */
    fun deleteJob(role: Role, id: String) {
        need(role.can(Cap.DELETE_CHAT), "ลบงาน", role)
        jobs.remove(id); store.delete(id)
    }

    fun approve(role: Role, user: String, id: String, part: String) {
        need(role.canApproveOnMobile(part), "อนุมัติ (ทำผ่านเว็บเท่านั้น)  ${part.uppercase()}", role)
        val j = editable(role, user, id)
        put(j.copy(approvals = j.approvals + (part to true)))
    }

    /** Called when the (future) sync receives a web approval. SIMULATED source for now; not a user action. */
    var onApprovalReceived: ((jobId: String, part: String) -> Unit)? = null

    fun applyRemoteApproval(id: String, part: String) {
        require(part in setOf("sales", "pd", "ra", "rd")) { "ส่วนอนุมัติไม่ถูกต้อง" }
        val j = jobs[id] ?: return
        if (j.approvals[part] == true) return
        put(j.copy(approvals = j.approvals + (part to true)))
        onApprovalReceived?.invoke(id, part)
    }

    fun send(role: Role, user: String, id: String, text: String, now: Long): ChatMessage {
        need(role.can(Cap.CHAT), "ส่งข้อความ", role)
        val j = visibleOrThrow(role, user, id)
        require(text.isNotBlank()) { "ข้อความว่าง" }
        val m = ChatMessage("m${++msgSeq}", user, text.trim(), now)
        put(j.copy(messages = j.messages + m))
        return m
    }

    /** Message ids may be reused after deletion (owner decision), so this just removes. */
    fun deleteMessage(role: Role, id: String, messageId: String) {
        need(role.canDeleteChatOnMobile(), "ลบข้อความ (ทำผ่านเว็บเท่านั้น)", role)
        val j = jobs[id] ?: return
        put(j.copy(messages = j.messages.filterNot { it.id == messageId }))
    }

    fun close(role: Role, user: String, id: String) {
        need(role.canCloseOnMobile(), "ปิดงาน (ทำผ่านเว็บเท่านั้น)", role)
        val j = visibleOrThrow(role, user, id)
        put(j.copy(closed = true))
    }

    /** Web rule (generateDash): brand OR customer is enough. */
    private fun validate(b: Brief) =
        require(b.brand.isNotBlank() || b.customer.isNotBlank()) { "กรุณากรอกชื่อลูกค้าหรือแบรนด์" }

    /** Fills allBenefits/allSP/finalTarget/cons/benefits like the web does on every save. */
    private fun derive(b: Brief, claims: List<String>): Brief {
        val w = web ?: return b
        val d = w.derive(b.allConcepts, claims.map { it.trim() }.filter { it.isNotEmpty() }, b.finalTarget.trim())
        val cons = b.cons.map { it.trim() }.filter { it.isNotEmpty() }.ifEmpty {
            if (b.conceptStr.contains("ลดน้ำหนัก")) listOf("ไม่มีน้ำตาล") else listOf("ไม่มีข้อจำกัดพิเศษ")
        }
        return b.copy(allBenefits = d.allBenefits, allSP = d.allSP, finalTarget = d.finalTarget, cons = cons, benefits = d.allBenefits.take(6))
    }

    private fun clean(b: Brief) = b.copy(brand = b.brand.trim(), customer = b.customer.trim())

    private fun editable(role: Role, user: String, id: String): Job {
        val j = visibleOrThrow(role, user, id)
        check(!j.closed) { "งานปิดแล้ว" }
        return j
    }

    private fun visibleOrThrow(role: Role, user: String, id: String): Job {
        val j = jobs[id] ?: throw NoSuchElementException("ไม่พบงาน $id")
        if (role.ownOnly && j.brief.salesOwner != user) throw PermissionDenied("เห็นเฉพาะงานของตนเอง")
        return j
    }

    private fun need(ok: Boolean, what: String, role: Role) {
        if (!ok) throw PermissionDenied("สิทธิ์ไม่พอ — $what (Role: ${role.label})")
    }
}
