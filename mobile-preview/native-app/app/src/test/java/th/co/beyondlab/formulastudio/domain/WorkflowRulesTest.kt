package th.co.beyondlab.formulastudio.domain

import org.junit.Assert.*
import org.junit.Test
import th.co.beyondlab.formulastudio.data.SimRepository

private val B = Brief(brand = "b", customer = "c")

class WorkflowRulesTest {
    @Test fun rolesMatchWebBaseline() {
        assertEquals(9, Role.values().size)
        assertEquals(listOf("admin", "pd", "ra", "rd", "sales", "oversea", "opc", "mkt", "purchasing"), Role.values().map { it.name.lowercase() })
        assertTrue(Role.PD.can(Cap.EDIT_FORMULA)); assertFalse(Role.RA.can(Cap.EDIT_FORMULA))
        assertTrue(Role.OPC.can(Cap.EXPORT)); assertFalse(Role.SALES.can(Cap.EXPORT))
        assertTrue(Role.MKT.can(Cap.CREATE_DATA)); assertTrue(Role.MKT.can(Cap.EDIT_FORMULA))
        assertTrue(Role.MKT.canApprove("pd")); assertTrue(Role.MKT.canApprove("sales")); assertFalse(Role.MKT.canApprove("ra")); assertFalse(Role.MKT.canApprove("rd"))
        assertTrue(Role.OVERSEA.canApprove("sales")); assertFalse(Role.OVERSEA.canApprove("pd"))
        assertTrue(Role.OVERSEA.ownOnly && Role.SALES.ownOnly); assertEquals(setOf(Role.SALES, Role.OVERSEA), Role.values().filter { it.ownOnly }.toSet())
        assertTrue(Role.OVERSEA.can(Cap.EXPORT) && Role.OVERSEA.can(Cap.CLOSE_JOB) && !Role.OVERSEA.can(Cap.EDIT_FORMULA))
        assertFalse(Role.PURCHASING.can(Cap.CREATE_DATA))
        assertTrue(Role.ADMIN.canApprove("rd")); assertFalse(Role.PD.canApprove("ra"))
    }

    @Test fun overseaSeesOnlyOwnJobs_andMobileApprovesSalesPartOnly() {
        val r = SimRepository()
        val a = r.createJob(Role.OVERSEA, "o1", B); r.createJob(Role.OVERSEA, "o2", B)
        assertEquals(listOf(a.id), r.visibleJobs(Role.OVERSEA, "o1").map { it.id })
        r.approve(Role.OVERSEA, "o1", a.id, "sales")
        assertThrows(PermissionDenied::class.java) { r.approve(Role.MKT, "m", a.id, "pd") }   // MKT approves PD on the web only
        assertThrows(PermissionDenied::class.java) { r.close(Role.MKT, "m", a.id) }
        r.close(Role.OVERSEA, "o1", a.id)
    }

    @Test fun salesSeesOnlyOwnJobs() {
        val r = SimRepository()
        r.createJob(Role.SALES, "s1", B); r.createJob(Role.SALES, "s2", B)
        assertEquals(1, r.visibleJobs(Role.SALES, "s1").size)
        assertEquals(2, r.visibleJobs(Role.ADMIN, "a").size)
        assertThrows(PermissionDenied::class.java) { r.send(Role.SALES, "s1", "A00002", "x", 0) }
    }

    @Test fun jobNumberNeverReusedAfterDelete() {
        val r = SimRepository()
        val a = r.createJob(Role.OPC, "o", B)
        r.deleteJob(Role.ADMIN, a.id)
        val b = r.createJob(Role.OPC, "o", B)
        assertEquals("A00001", a.id); assertEquals("A00002", b.id)
    }

    @Test fun messageIdMayBeReusedAfterDelete_butRoleChecked() {
        val r = SimRepository(); val j = r.createJob(Role.OPC, "o", B)
        val m = r.send(Role.OPC, "o", j.id, "hi", 0)
        assertThrows(PermissionDenied::class.java) { r.deleteMessage(Role.SALES, j.id, m.id) }
        assertThrows(PermissionDenied::class.java) { r.deleteMessage(Role.ADMIN, j.id, m.id) }  // web only
        assertTrue(r.get(j.id)!!.messages.isNotEmpty())
    }

    @Test fun deniedActionsAreBlockedInRepositoryNotJustUi() {
        val r = SimRepository(); val j = r.createJob(Role.OPC, "o", B)
        assertThrows(PermissionDenied::class.java) { r.approve(Role.RA, "x", j.id, "pd") }
        assertThrows(PermissionDenied::class.java) { r.createJob(Role.PURCHASING, "p", B) }
        assertThrows(PermissionDenied::class.java) { r.close(Role.RD, "x", j.id) }
    }

    private fun row(n: String, w: String = "", p: String = "", o: String = "") = IngredientInput(n, w, o, p)

    @Test fun rowMathMatchesWeb() {
        val r = IngredientMath.build(listOf(row("A", "100", "50"), row("", "5", "5"), row("B", "", ""), row("C", "200", "0", "TH")))
        assertEquals(3, r.size); assertEquals(listOf(1, 2, 3), r.map { it.num })     // unnamed row dropped, renumbered
        assertEquals(50.0, r[0].actual, 1e-9)
        assertEquals(0.0, r[1].w, 0.0); assertEquals(100.0, r[1].p, 0.0); assertEquals("—", r[1].o)  // blank p = 100, blank origin = —
        assertEquals(100.0, r[2].p, 0.0); assertEquals(200.0, r[2].actual, 1e-9)       // p=0 -> 100 like parseFloat||100
        assertEquals("50.00 mg", IngredientMath.preview("100", "50")); assertEquals("—", IngredientMath.preview("0", "50"))
    }

    @Test fun badNumbersAreRejectedNotSilentlyZeroed() {
        listOf("abc", "-1", "NaN", "Infinity").forEach { bad ->
            assertThrows(IllegalArgumentException::class.java) { IngredientMath.build(listOf(row("A", bad, "50"))) }
        }
        val r = SimRepository(); val before = r.visibleJobs(Role.ADMIN, "a").size
        assertThrows(IllegalArgumentException::class.java) { r.createJob(Role.OPC, "o", B, listOf(row("A", "x"))) }
        assertEquals(before, r.visibleJobs(Role.ADMIN, "a").size)
        assertEquals("A00001", r.createJob(Role.OPC, "o", B).id)      // failed create did not burn a job number
    }

    @Test fun createNeedsBrandOrCustomer_likeWeb_andSalesOwnerIsSelf() {
        val r = SimRepository()
        assertThrows(IllegalArgumentException::class.java) { r.createJob(Role.OPC, "o", Brief()) }
        assertEquals("A00001", r.createJob(Role.OPC, "o", Brief(brand = "only-brand")).id)
        assertEquals("s1", r.createJob(Role.SALES, "s1", B.copy(salesOwner = "someone-else")).brief.salesOwner)
    }

    @Test fun editBriefKeepsApprovalsChatAndOwner_andClosedBlocksEdits() {
        val r = SimRepository(); val j = r.createJob(Role.SALES, "s1", B)
        r.approve(Role.SALES, "s1", j.id, "sales"); r.send(Role.SALES, "s1", j.id, "hi", 0)
        r.updateBrief(Role.SALES, "s1", j.id, B.copy(brand = "new", salesOwner = "hacker"), listOf(row("A", "10", "10")))
        val g = r.get(j.id)!!
        assertEquals("new", g.brief.brand); assertEquals("s1", g.brief.salesOwner)
        assertEquals(true, g.approvals["sales"]); assertEquals(1, g.messages.size); assertEquals(10.0, g.totW, 0.0)
        assertThrows(PermissionDenied::class.java) { r.updateBrief(Role.RA, "x", j.id, B, emptyList()) }
        assertThrows(PermissionDenied::class.java) { r.updateBrief(Role.SALES, "s2", j.id, B, emptyList()) }
        r.close(Role.SALES, "s1", j.id)
        assertThrows(IllegalStateException::class.java) { r.updateBrief(Role.SALES, "s1", j.id, B, emptyList()) }
    }

    @Test fun onlyPdMktAndAdminEditFormula_briefUntouched() {
        val r = SimRepository(); val j = r.createJob(Role.OPC, "o", B.copy(notes = "keep"))
        r.editFormula(Role.PD, "p", j.id, listOf(row("A", "100", "50")))
        assertEquals(50.0, r.get(j.id)!!.totA, 1e-9); assertEquals("keep", r.get(j.id)!!.brief.notes)
        r.editFormula(Role.MKT, "m", j.id, listOf(row("B", "100", "10")))   // MKT may edit formula on the deployed web
        assertEquals(10.0, r.get(j.id)!!.totA, 1e-9)
        listOf(Role.RA, Role.RD, Role.PURCHASING, Role.OPC, Role.SALES, Role.OVERSEA).forEach {
            assertThrows(PermissionDenied::class.java) { r.editFormula(it, "x", j.id, emptyList()) }
        }
    }

    @Test fun conceptStrMatchesWeb() {
        assertEquals("Health Supplement", Brief().conceptStr)
        assertEquals("a + b", Brief(allConcepts = listOf("a", "b")).conceptStr)
    }

    @Test fun mobileApprovesOnlySales_othersAreWebOnly_andRemoteApprovalNotifies() {
        val r = SimRepository(); val j = r.createJob(Role.SALES, "s1", B)
        for (role in listOf(Role.PD, Role.RA, Role.RD, Role.ADMIN, Role.OPC))
            for (part in listOf("pd", "ra", "rd")) assertThrows(PermissionDenied::class.java) { r.approve(role, "x", j.id, part) }
        assertThrows(PermissionDenied::class.java) { r.close(Role.OPC, "o", j.id) }   // OPC close = web only
        val got = mutableListOf<String>(); r.onApprovalReceived = { id, p -> got += "$id:$p" }
        r.applyRemoteApproval(j.id, "pd"); r.applyRemoteApproval(j.id, "pd")        // duplicate: no second notice
        r.applyRemoteApproval(j.id, "ra"); r.applyRemoteApproval(j.id, "rd")
        assertEquals(listOf("${j.id}:pd", "${j.id}:ra", "${j.id}:rd"), got)
        assertTrue(listOf("pd", "ra", "rd").all { r.get(j.id)!!.approvals[it] == true })
        assertThrows(IllegalArgumentException::class.java) { r.applyRemoteApproval(j.id, "xx") }
    }
}
