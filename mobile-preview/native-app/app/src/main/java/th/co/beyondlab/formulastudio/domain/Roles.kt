package th.co.beyondlab.formulastudio.domain

/**
 * Mirrors the DEPLOYED web/runtime roles (owner decision 2026-11-01: web is the baseline): mobile-preview `roles` +
 * runtime formula-proxy.mjs (KNOWN_ROLES, FORMULA_DATA_ROLES, FORMULA_APPROVAL_PARTS, FORMULA_OWN_ONLY_ROLES).
 * Note: the repo-root index.html is older and has no Oversea.
 */
enum class Role(val label: String, val desc: String) {
    ADMIN("Admin", "ทำได้ทุกอย่าง"),
    PD("PD", "แก้สูตรในหน้าแชต + อนุมัติ PD"),
    RA("RA", "ใช้งานหน้าแชต + อนุมัติ RA"),
    RD("RD", "ใช้งานหน้าแชต + อนุมัติ RD"),
    SALES("Sales", "สร้างงานใหม่ + แชต + อนุมัติ Sales · เห็นเฉพาะงานของตนเอง"),
    OVERSEA("Oversea", "สร้างงานใหม่ + แชต + อนุมัติ Sales + Export Excel + ปิดงาน · เห็นเฉพาะงานของตนเอง"),
    OPC("OPC", "สร้างงานใหม่ + แชต + Export Excel + ปิดงาน"),
    MKT("MKT", "สร้างงานใหม่ + แก้สูตร + แชต + อนุมัติ PD และ Sales + Export Excel + ปิดงาน (การตลาด)"),
    PURCHASING("Purchasing", "ใช้งานกล่องข้อความในหน้า Chat Message");

    fun can(cap: Cap): Boolean = cap in CAPS.getValue(this)

    /** approve: Admin '*', others only their own part (web `canApprove`). */
    fun canApprove(part: String): Boolean =
        this == ADMIN || APPROVE[this]?.contains(part) == true

    val ownOnly: Boolean get() = this == SALES || this == OVERSEA

    /**
     * Owner decision 2026-11-01: on mobile only Sales/Oversea approve (Sales part) and close jobs.
     * PD/RA/RD approvals, OPC close and Admin chat deletion are done on the web only;
     * mobile just shows approval state and notifies when one arrives.
     */
    fun canApproveOnMobile(part: String): Boolean = (this == SALES || this == OVERSEA) && part == "sales" && canApprove(part)
    fun canCloseOnMobile(): Boolean = (this == SALES || this == OVERSEA) && can(Cap.CLOSE_JOB)
    fun canDeleteChatOnMobile(): Boolean = false

    companion object {
        private val CAPS: Map<Role, Set<Cap>> = mapOf(
            ADMIN to Cap.values().toSet(),
            PD to setOf(Cap.EDIT_FORMULA, Cap.CHAT),
            RA to setOf(Cap.CHAT),
            RD to setOf(Cap.CHAT),
            SALES to setOf(Cap.CREATE_DATA, Cap.CHAT, Cap.CLOSE_JOB),
            OVERSEA to setOf(Cap.CREATE_DATA, Cap.CHAT, Cap.EXPORT, Cap.CLOSE_JOB),
            OPC to setOf(Cap.CREATE_DATA, Cap.CHAT, Cap.EXPORT, Cap.CLOSE_JOB),
            MKT to setOf(Cap.CREATE_DATA, Cap.EDIT_FORMULA, Cap.CHAT, Cap.EXPORT, Cap.CLOSE_JOB),
            PURCHASING to setOf(Cap.CHAT),
        )
        private val APPROVE: Map<Role, Set<String>> = mapOf(
            PD to setOf("pd"), RA to setOf("ra"), RD to setOf("rd"), SALES to setOf("sales"),
            OVERSEA to setOf("sales"), MKT to setOf("pd", "sales"),
        )
    }
}

enum class Cap { CREATE_DATA, EDIT_FORMULA, CHAT, EXPORT, MANAGE_USERS, DELETE_CHAT, CLOSE_JOB }
