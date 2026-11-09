package th.co.beyondlab.formulastudio.domain

import org.json.JSONObject
import java.math.BigDecimal
import java.math.RoundingMode
import java.util.Locale

/** JS-compatible number formatting so strings match the web byte for byte. */
object Fmt {
    /** Same as JS Number.prototype.toFixed(2): rounds the exact binary value half-up. */
    fun f2(d: Double): String = BigDecimal(d).setScale(2, RoundingMode.HALF_UP).toPlainString()
    /** Same as JS `${n}` for the finite numbers used in the FDA table (1000 -> "1000", 0.8 -> "0.8"). */
    fun js(d: Double): String =
        if (d == Math.floor(d) && Math.abs(d) < 1e15) d.toLong().toString()
        else BigDecimal(d.toString()).stripTrailingZeros().toPlainString()
    fun lower(s: String) = s.lowercase(Locale.ROOT)
}

data class FdaEntry(
    val keywords: List<String>, val name: String, val maxActualMg: Double,
    val unit: String, val status: String, val ref: String, val overNote: String,
)
data class IdbEntry(val p: Double, val o: String, val note: String)
data class ConceptKbEntry(val benefits: List<String>, val sp: List<String>, val target: String)

/** result of the web's checkFDA(): status ok|over|not_approved|unknown. */
data class FdaResult(val status: String, val icon: String, val cls: String, val tip: String) {
    /** The web's tip already starts with the icon except for "unknown"; avoids showing it twice. */
    val display: String get() = if (tip.startsWith(icon)) tip else "$icon $tip"
}

/**
 * Reference data copied FROM THE WEB APP by tools/export-web-data.mjs (index.html is the source of
 * truth; never edit web_data.json by hand). `node tools/export-web-data.mjs --check` detects drift.
 */
class WebData(val fda: List<FdaEntry>, val idb: Map<String, IdbEntry>, val kb: Map<String, ConceptKbEntry>) {

    /** Mirrors checkFDA(ingredientName, actualMg) in index.html. */
    fun checkFda(ingredientName: String, actualMg: Double): FdaResult {
        val name = Fmt.lower(ingredientName)
        val m = fda.firstOrNull { e -> e.keywords.any { name.contains(Fmt.lower(it)) } }
            ?: return FdaResult("unknown", "⚪", "fda-unknown",
                "\"$ingredientName\" ไม่พบในฐานข้อมูล อย. ไทย — ตรวจสอบเพิ่มเติมกับ อย. ก่อนขึ้นทะเบียน")
        if (m.status == "not_approved") return FdaResult("not_approved", "🔴", "fda-danger",
            "🔴 ไม่อนุมัติ: ${m.name}\n${m.ref}\n⚠️ ${m.overNote}")
        if (actualMg > m.maxActualMg) return FdaResult("over", "🟡", "fda-warn",
            "🟡 เกินขีดจำกัด: ${m.name}\nใช้จริง: ${Fmt.f2(actualMg)} mg | ขีดจำกัด: ${Fmt.js(m.maxActualMg)} ${m.unit}\n${m.ref}\n⚠️ ${m.overNote}")
        return FdaResult("ok", "🟢", "fda-ok",
            "🟢 อนุมัติ: ${m.name}\nใช้จริง: ${Fmt.f2(actualMg)} mg | ขีดจำกัด: ${Fmt.js(m.maxActualMg)} ${m.unit}\n${m.ref}")
    }

    data class Derived(val allBenefits: List<String>, val allSP: List<String>, val finalTarget: String)

    /** Mirrors the concept-KB block of generateDash(): KB benefits/sp + custom claims, with web defaults. */
    fun derive(allConcepts: List<String>, claims: List<String>, target: String): Derived {
        val ben = ArrayList<String>(); val sp = ArrayList<String>(); var suggested = ""
        allConcepts.forEach { c -> kb[c]?.let { ben += it.benefits; sp += it.sp; if (suggested.isEmpty()) suggested = it.target } }
        claims.forEach { if (it !in ben) ben += it }
        if (ben.isEmpty()) ben += listOf("เสริมสุขภาพโดยรวม", "ต้านอนุมูลอิสระ", "บำรุงร่างกาย")
        if (sp.isEmpty()) sp += listOf("สูตร Premium Grade", "คัดสรรวัตถุดิบคุณภาพ", "ผ่านมาตรฐาน GMP")
        return Derived(ben, sp, target.ifEmpty { suggested }.ifEmpty { "ผู้ใหญ่ทุกเพศ อายุ 18 ปีขึ้นไป" })
    }

    companion object {
        fun parse(json: String): WebData {
            val o = JSONObject(json)
            fun strs(a: org.json.JSONArray) = (0 until a.length()).map { a.getString(it) }
            val fda = o.getJSONArray("fda").let { a -> (0 until a.length()).map {
                val e = a.getJSONObject(it)
                FdaEntry(strs(e.getJSONArray("keywords")), e.getString("name"), e.getDouble("maxActualMg"),
                    e.optString("unit"), e.getString("status"), e.optString("ref"), e.optString("overNote"))
            } }
            val idb = o.getJSONObject("idb").let { x -> x.keys().asSequence().associateWith {
                val e = x.getJSONObject(it); IdbEntry(e.getDouble("p"), e.optString("o"), e.optString("note"))
            } }
            val kb = o.getJSONObject("kb").let { x -> x.keys().asSequence().associateWith {
                val e = x.getJSONObject(it); ConceptKbEntry(strs(e.getJSONArray("benefits")), strs(e.getJSONArray("sp")), e.optString("target"))
            } }
            return WebData(fda, idb, kb)
        }
    }
}
