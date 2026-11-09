package th.co.beyondlab.formulastudio.domain

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import th.co.beyondlab.formulastudio.data.*
import java.io.File

/** Compares Kotlin with outputs recorded from the WEB's own checkFDA / generateDash logic (tools/export-web-data.mjs). */
class WebParityTest {
    private val web = WebData.parse(File("src/main/assets/web_data.json").readText())
    private val golden = JSONObject(javaClass.getResource("/web_golden.json")!!.readText())
    private fun strs(a: JSONArray) = (0 until a.length()).map { a.getString(it) }

    @Test fun checkFdaMatchesWebForEveryRecordedCase() {
        val cases = golden.getJSONArray("fda")
        assertTrue(cases.length() > 2000)
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i); val o = c.getJSONObject("out")
            val got = web.checkFda(c.getString("name"), c.getDouble("mg"))
            val tag = "case $i ${c.getString("name")} @ ${c.getDouble("mg")}"
            assertEquals(tag, o.getString("status"), got.status)
            assertEquals(tag, o.getString("icon"), got.icon)
            assertEquals(tag, o.getString("cls"), got.cls)
            assertEquals(tag, o.getString("tip"), got.tip)
        }
    }

    @Test fun conceptDerivationMatchesWeb() {
        val cases = golden.getJSONArray("derive")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i); val o = c.getJSONObject("out")
            val d = web.derive(strs(c.getJSONArray("concepts")), strs(c.getJSONArray("claims")), c.getString("target"))
            assertEquals("case $i", strs(o.getJSONArray("allBenefits")), d.allBenefits)
            assertEquals("case $i", strs(o.getJSONArray("allSP")), d.allSP)
            assertEquals("case $i", o.getString("finalTarget"), d.finalTarget)
        }
    }

    @Test fun savedJobCarriesFdaAndDerivedFields() {
        val r = SimRepository(web = web)
        val concept = web.kb.keys.first()
        val j = r.createJob(Role.OPC, "o", Brief(brand = "b", allConcepts = listOf(concept), cons = emptyList()),
            listOf(IngredientInput("Vitamin C", "5000", "", "100"), IngredientInput("melatonin", "1", "", "100"), IngredientInput("zzz", "1", "", "100")),
            claims = listOf("my claim"))
        assertEquals(listOf("over", "not_approved", "unknown"), j.rows.map { it.fda!!.status })
        assertEquals(web.kb.getValue(concept).target, j.brief.finalTarget)          // suggested target used when none typed
        assertTrue("my claim" in j.brief.allBenefits); assertEquals(j.brief.allBenefits.take(6), j.brief.benefits)
        assertEquals(listOf("ไม่มีข้อจำกัดพิเศษ"), j.brief.cons)                        // web default when no constraints
        assertEquals(j, JobJson.fromJson(JobJson.toJson(j)))                         // fda + derived survive storage
    }

    @Test fun idbHasWebAutofillEntries() {
        val e = web.idb.getValue("Zinc Gluconate"); assertEquals(14.3, e.p, 0.0); assertEquals("Elemental Zn 14.3%", e.note)
    }

    @Test fun jsNumberFormats() {
        assertEquals("1000", Fmt.js(1000.0)); assertEquals("0.8", Fmt.js(0.8)); assertEquals("0.0001", Fmt.js(0.0001))
        assertEquals("1.00", Fmt.f2(1.005))   // JS (1.005).toFixed(2) === "1.00"
        assertEquals("0.13", Fmt.f2(0.125)); assertEquals("2.50", Fmt.f2(2.5))
    }
}
