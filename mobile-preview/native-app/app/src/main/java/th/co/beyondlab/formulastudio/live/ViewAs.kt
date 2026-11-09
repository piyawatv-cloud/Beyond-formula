package th.co.beyondlab.formulastudio.live

import th.co.beyondlab.formulastudio.domain.Job

/**
 * Role PREVIEW for testing, offered only to a signed-in admin. It re-filters and labels what the admin already
 * received; it is NOT an authorization boundary: the server keeps answering with admin rights and the app still
 * has no write path. Rules mirror the deployed runtime (formula-proxy.mjs KNOWN_ROLES / FORMULA_APPROVAL_PARTS /
 * FORMULA_OWN_ONLY_ROLES) and mobile-preview `roles`.
 */
enum class ViewRole(val key: String, val label: String, val ownOnly: Boolean, val abilities: List<String>) {
    ADMIN("admin", "Admin", false, listOf("สร้างงาน", "แก้สูตร", "แชต", "อนุมัติทุกฝ่าย", "ปิดงาน", "Export", "จัดการผู้ใช้")),
    PD("pd", "PD", false, listOf("แก้สูตร", "แชต", "อนุมัติ PD")),
    RA("ra", "RA", false, listOf("แชต", "อนุมัติ RA")),
    RD("rd", "RD", false, listOf("แชต", "อนุมัติ RD")),
    SALES("sales", "Sales", true, listOf("สร้างงาน", "แชต", "อนุมัติ Sales", "ปิดงาน")),
    OVERSEA("oversea", "Oversea", true, listOf("สร้างงาน", "แชต", "อนุมัติ Sales", "ปิดงาน", "Export")),
    OPC("opc", "OPC", false, listOf("สร้างงาน", "แชต", "ปิดงาน", "Export")),
    MKT("mkt", "MKT", false, listOf("สร้างงาน", "แก้สูตร", "แชต", "อนุมัติ PD", "ปิดงาน", "Export")),
    PURCHASING("purchasing", "Purchasing", false, listOf("แชต"));

    companion object {
        /** Case-insensitive search over job number, brand, customer and sales owner. Blank query matches everything. */
        fun matches(j: Job, q: String): Boolean = q.isBlank() || listOf(j.id, j.brief.brand, j.brief.customer, j.brief.salesOwner).any { it.contains(q.trim(), ignoreCase = true) }

        /** Distinct owner names in the loaded jobs, to pick whom a Sales/Oversea preview acts as. */
        fun owners(jobs: List<Job>): List<String> = jobs.map { it.brief.salesOwner.trim() }.filter { it.isNotEmpty() }.distinct().sorted()

        /** Jobs this role would see. Own-only roles see only jobs whose salesOwner is [owner] (no owner chosen = none). */
        fun visible(role: ViewRole, owner: String?, jobs: List<Job>): List<Job> =
            if (!role.ownOnly) jobs else jobs.filter { owner != null && it.brief.salesOwner.trim() == owner }
    }
}
