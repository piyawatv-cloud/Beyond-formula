package th.co.beyondlab.formulastudio.data

import org.json.JSONArray
import org.json.JSONObject
import th.co.beyondlab.formulastudio.domain.*

/**
 * Flat record JSON using the locked web record field names (brand, salesOwner, uw, rows[], ...),
 * the same shape the web keeps in fs_records / `data jsonb`. Readers tolerate missing fields.
 */
object JobJson {
    fun toJson(j: Job): String = JSONObject().apply {
        put("id", j.id)
        val b = j.brief
        put("brand", b.brand); put("customer", b.customer); put("salesOwner", b.salesOwner); put("phone", b.phone)
        put("form", b.form); put("size", b.size); put("sizeUnit", b.sizeUnit); put("uw", b.uw); put("uwUnit", b.uwUnit)
        put("gender", b.gender); put("price", b.price); put("notes", b.notes); put("cat", b.cat); put("subcat", b.subcat)
        put("priority", b.priority); put("fdaType", b.fdaType); put("color", b.color); put("scent", b.scent)
        put("flavor", b.flavor); put("packType", b.packType); put("widthCm", b.widthCm); put("lengthCm", b.lengthCm)
        put("conceptStr", b.conceptStr); put("allConcepts", JSONArray(b.allConcepts)); put("finalTarget", b.finalTarget)
        put("allBenefits", JSONArray(b.allBenefits)); put("allSP", JSONArray(b.allSP)); put("cons", JSONArray(b.cons)); put("benefits", JSONArray(b.benefits))
        put("totW", j.totW); put("totA", j.totA)
        put("rows", JSONArray().also { a -> j.rows.forEach { r ->
            a.put(JSONObject().put("num", r.num).put("name", r.name).put("w", r.w).put("o", r.o)
                .put("p", r.p).put("actual", r.actual).put("note", r.note).put("hero", r.hero)
                .also { x -> r.fda?.let { f -> x.put("fda", JSONObject().put("status", f.status).put("icon", f.icon).put("cls", f.cls).put("tip", f.tip)) } })
        } })
        put("approvals", JSONObject().also { o -> j.approvals.forEach { (k, v) -> o.put(k, v) } })
        put("messages", JSONArray().also { a -> j.messages.forEach { m ->
            a.put(JSONObject().put("id", m.id).put("user", m.user).put("text", m.text).put("ts", m.ts))
        } })
        if (j.closed) put("closed", true)
    }.toString()

    fun fromJson(s: String): Job {
        val o = JSONObject(s)
        fun str(k: String, d: String = "") = if (o.has(k) && !o.isNull(k)) o.optString(k, d) else d
        fun list(k: String) = o.optJSONArray(k)?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()
        val concepts = list("allConcepts")
        val brief = Brief(
            str("brand"), str("customer"), str("salesOwner"), str("phone"), str("form"), str("size"), str("sizeUnit"),
            str("uw"), str("uwUnit", "mg"), str("gender"), str("price"), str("notes"), str("cat"), str("subcat"),
            str("priority", "medium"), str("fdaType"), str("color"), str("scent"), str("flavor"), str("packType"),
            str("widthCm"), str("lengthCm"), concepts, str("finalTarget"),
            list("allBenefits"), list("allSP"), list("cons"), list("benefits"),
        )
        val rows = o.optJSONArray("rows")?.let { a -> (0 until a.length()).map {
            val r = a.getJSONObject(it)
            Ingredient(r.optInt("num", it + 1), r.optString("name"), r.optDouble("w", 0.0), r.optString("o", "—"),
                r.optDouble("p", 100.0), r.optDouble("actual", 0.0), r.optString("note"), r.optBoolean("hero"),
                r.optJSONObject("fda")?.let { f -> FdaResult(f.optString("status"), f.optString("icon"), f.optString("cls"), f.optString("tip")) })
        } } ?: emptyList()
        val ap = o.optJSONObject("approvals")?.let { x -> x.keys().asSequence().associateWith { k -> x.optBoolean(k) } } ?: emptyMap()
        val msgs = o.optJSONArray("messages")?.let { a -> (0 until a.length()).map {
            val m = a.getJSONObject(it); ChatMessage(m.optString("id"), m.optString("user"), m.optString("text"), m.optLong("ts"))
        } } ?: emptyList()
        return Job(o.getString("id"), brief, rows, ap, msgs, o.optBoolean("closed"))
    }
}
