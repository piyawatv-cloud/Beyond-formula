package th.co.beyondlab.formulastudio.domain

import org.junit.Assert.*
import org.junit.Test
import th.co.beyondlab.formulastudio.data.*

class PersistenceTest {
    private val b = Brief(brand = "b", customer = "c", salesOwner = "s1", allConcepts = listOf("x", "y"), widthCm = "8")

    @Test fun jsonRoundTripKeepsEveryField_andUsesLockedNames() {
        val j = Job("A00007", b.copy(uw = "500", price = "15"),
            IngredientMath.build(listOf(IngredientInput("A", "100", "TH", "50", "n", true))),
            mapOf("pd" to true), listOf(ChatMessage("m1", "u", "hi", 5L)), true)
        val s = JobJson.toJson(j)
        assertEquals(j, JobJson.fromJson(s))
        listOf("\"salesOwner\"", "\"uw\"", "\"allConcepts\"", "\"conceptStr\"", "\"rows\"", "\"actual\"", "\"closed\"").forEach { assertTrue(it, s.contains(it)) }
    }

    @Test fun oldRecordsWithMissingFieldsStillLoad() {
        val j = JobJson.fromJson("""{"id":"A00001","brand":"b","customer":"c","rows":[{"name":"A","w":10}]}""")
        assertEquals("medium", j.brief.priority); assertEquals("mg", j.brief.uwUnit)
        assertEquals(100.0, j.rows[0].p, 0.0); assertTrue(j.approvals.isEmpty()); assertFalse(j.closed)
    }

    @Test fun dataSurvivesRestartAndJobNumbersAreNeverReused() {
        val store = InMemoryJobStore()
        val r1 = SimRepository(store)
        val a = r1.createJob(Role.OPC, "o", b); val c = r1.createJob(Role.OPC, "o", b)
        r1.send(Role.OPC, "o", c.id, "hello", 1); r1.deleteJob(Role.ADMIN, c.id)

        val r2 = SimRepository(store)                                  // "restart"
        assertEquals(listOf(a.id), r2.visibleJobs(Role.ADMIN, "x").map { it.id })
        assertEquals("A00003", r2.createJob(Role.OPC, "o", b).id)      // A00002 was deleted, never reused
    }

    @Test fun deletingEverythingThenRestartDoesNotReseedOrResetCounter() {
        val store = InMemoryJobStore()
        val seed = listOf(Job("A00001", b))
        val r1 = SimRepository(store, seed); r1.deleteJob(Role.ADMIN, "A00001")
        val r2 = SimRepository(store, seed)
        assertTrue(r2.visibleJobs(Role.ADMIN, "x").isEmpty())
        assertEquals("A00002", r2.createJob(Role.OPC, "o", b).id)
    }

    @Test fun messageSequenceContinuesAfterRestart() {
        val store = InMemoryJobStore(); val r1 = SimRepository(store)
        val j = r1.createJob(Role.OPC, "o", b); r1.send(Role.OPC, "o", j.id, "1", 0)
        val m = SimRepository(store).send(Role.OPC, "o", j.id, "2", 0)
        assertEquals("m2", m.id)
    }
}
