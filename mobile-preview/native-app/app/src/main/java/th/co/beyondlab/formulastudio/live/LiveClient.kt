package th.co.beyondlab.formulastudio.live

import org.json.JSONArray
import org.json.JSONObject
import th.co.beyondlab.formulastudio.data.JobJson
import th.co.beyondlab.formulastudio.domain.*
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * READ-ONLY client for the existing Formula runtime data gate (exception formula-mobile-live-readonly-2026-10-29).
 * The allow-list below is the only door: login/logout/session, and GET of fs_records / fs_approvals / fs_messages.
 * There is deliberately NO code path for create / approve / close / chat / save: [allowed] rejects every other call,
 * and the server filters rows by the signed-in role. The password is used once and never stored;
 * the session cookie lives in memory only.
 */
class LiveError(message: String, val status: Int = 0) : Exception(message)

data class LiveSession(val name: String, val role: String, val canEdit: Boolean)
data class LiveResponse(val status: Int, val body: String, val setCookies: List<String> = emptyList())

fun interface Transport { fun send(method: String, path: String, headers: Map<String, String>, body: String?): LiveResponse }

class LiveClient(private val transport: Transport) {
    /** Records of the last [loadJobs] that could not be read (shown to the user, never hidden silently). */
    var skipped = 0; private set
    /** True when the server refused this role the approvals table (403): approval state is unknown, not "pending". */
    var approvalsHidden = false; private set
    private val jar = LinkedHashMap<String, String>()

    private fun call(method: String, path: String, headers: Map<String, String> = emptyMap(), body: String? = null): LiveResponse {
        check(allowed(method, path)) { "คำขอนี้ไม่อนุญาตในโหมดอ่านอย่างเดียว: $method" }
        val h = headers.toMutableMap()
        if (jar.isNotEmpty()) h["Cookie"] = jar.entries.joinToString("; ") { "${it.key}=${it.value}" }
        val res = try { transport.send(method, path, h, body) } catch (e: Exception) { throw LiveError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่") }
        res.setCookies.forEach { line ->
            val kv = line.substringBefore(";"); val k = kv.substringBefore("=").trim(); val v = kv.substringAfter("=", "").trim()
            if (k.isNotEmpty()) if (v.isEmpty() || line.contains("max-age=0", true)) jar.remove(k) else jar[k] = v
        }
        return res
    }

    private fun fail(res: LiveResponse): Nothing = when (res.status) {
        401 -> throw LiveError("เซสชันหมดอายุหรือยังไม่ได้เข้าสู่ระบบ", 401)
        403 -> throw LiveError("ไม่มีสิทธิ์อ่านข้อมูลนี้", 403)
        301, 302, 303, 307 -> throw LiveError("ต้องผ่าน SSO (Cloudflare Access) ก่อน หรือ SSO หมดอายุ — กด \"เข้าสู่ระบบ SSO\"", res.status)
        else -> throw LiveError("อ่านข้อมูลไม่สำเร็จ (${res.status})", res.status)
    }

    fun login(login: String, password: String): LiveSession {
        val body = JSONObject().put("login", login.trim()).put("password", password).toString()
        val res = call("POST", "/sb/session", mapOf("content-type" to "application/json"), body)
        if (res.status == 401 || res.status == 403) throw LiveError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือบัญชียังไม่มีสิทธิ์", res.status)
        if (res.status != 200) fail(res)
        return session() ?: throw LiveError("เข้าสู่ระบบไม่สำเร็จ", 401)
    }

    fun session(): LiveSession? {
        val res = call("GET", "/sb/session")
        if (res.status == 401) return null
        if (res.status != 200) fail(res)
        val o = JSONObject(res.body)
        return if (o.optBoolean("authenticated")) LiveSession(o.optString("name"), o.optString("role"), o.optBoolean("canEdit")) else null
    }

    /** Session cookie jar as "k=v; k=v" for the encrypted "remember me" vault. Never includes the password. */
    fun exportCookies(): String = jar.entries.joinToString("; ") { "${it.key}=${it.value}" }
    fun importCookies(s: String) { jar.clear(); s.split(";").map { it.trim() }.filter { it.contains("=") }.forEach { jar[it.substringBefore("=")] = it.substringAfter("=") } }

    fun setCookie(name: String, value: String) { jar[name] = value }
    fun cookie(name: String): String? = jar[name]

    fun logout() { try { call("DELETE", "/sb/session") } finally { jar.clear() } }

    private fun rows(path: String, from: Int): JSONArray {
        val res = call("GET", REST + path, mapOf("Range-Unit" to "items", "Range" to "$from-${from + 999}"))
        if (res.status != 200 && res.status != 206) fail(res)
        val a = JSONArray(res.body)
        if (a.length() > 1000) throw LiveError("ข้อมูลที่ได้ไม่ครบหรือรูปแบบไม่ถูกต้อง", 502)
        return a
    }
    private fun all(path: String): List<JSONObject> {
        val out = ArrayList<JSONObject>(); var from = 0
        while (true) { val p = rows(path, from); for (i in 0 until p.length()) out += p.getJSONObject(i); if (p.length() < 1000) break; from += 1000 }
        return out
    }
    private fun inList(ids: List<String>) = "in." + URLEncoder.encode(ids.joinToString(",", "(", ")") { "\"$it\"" }, "UTF-8").replace("+", "%20")

    /** Latest [limit] jobs the server lets this role see, with approvals. */
    fun loadJobs(limit: Int = 100): List<Job> {
        val recs = rows("fs_records?select=id,data,updated_at&order=id.desc", 0)
        val valid = (0 until minOf(recs.length(), limit)).map { recs.getJSONObject(it) }
            .filter { JOB_ID.matches(it.optString("id")) && it.optJSONObject("data") != null }
        val approvals = HashMap<String, MutableMap<String, Boolean>>()
        approvalsHidden = false
        try {
            valid.map { it.getString("id") }.chunked(50).forEach { ids ->
                all("fs_approvals?select=job_id,part,data,updated_at&job_id=${inList(ids)}&order=job_id.asc,part.asc").forEach { a ->
                    if (a.optString("part") in PARTS && a.optJSONObject("data") != null) approvals.getOrPut(a.getString("job_id")) { HashMap() }[a.getString("part")] = true
                }
            }
        } catch (e: LiveError) {
            if (e.status != 403) throw e      // 401/SSO still surface; only "role may not read approvals" is tolerated
            approvalsHidden = true; approvals.clear()
        }
        skipped = 0
        return valid.mapNotNull { r -> runCatching { toJob(r, approvals[r.getString("id")].orEmpty()) }.getOrElse { skipped++; null } }
    }

    fun loadMessages(jobId: String): List<ChatMessage> {
        require(JOB_ID.matches(jobId)) { "รหัสงานไม่ถูกต้อง" }
        return all("fs_messages?select=uid,job_id,ts,data&job_id=${inList(listOf(jobId))}&order=ts.asc,uid.asc").map { r ->
            val d = r.optJSONObject("data") ?: JSONObject()
            val user = if (d.optString("type") == "sys") "ระบบ" else d.optString("user")
            ChatMessage(r.optString("uid"), user, d.optString("text"), r.optLong("ts", d.optLong("ts")))
        }
    }

    companion object {
        const val REST = "/sb/rest/v1/"
        val PARTS = setOf("pd", "ra", "rd", "sales")
        val JOB_ID = Regex("^[A-Z]+[0-9]{5}$")
        private val READ_PATH = Regex("^/sb/rest/v1/(fs_records|fs_approvals|fs_messages)\\?[A-Za-z0-9_.,=&%()\"*:+\\-]{0,1500}$")

        /** The whole allow-list. Anything else (every write) is refused before it reaches the network. */
        fun allowed(method: String, path: String): Boolean =
            if (path == "/sb/session") method in setOf("GET", "POST", "DELETE") else method == "GET" && READ_PATH.matches(path)

        /** fs_records.data -> Job. Keeps web shapes: closed is an object, rows may hold strings. */
        fun toJob(rec: JSONObject, approvals: Map<String, Boolean>): Job {
            val d = JSONObject(rec.getJSONObject("data").toString())
            d.put("id", rec.getString("id"))
            d.put("closed", d.optJSONObject("closed") != null)
            d.remove("messages")
            // old records may carry only the conceptStr text; keep it instead of falling back to the default label
            val cs = d.optString("conceptStr")
            if (d.optJSONArray("allConcepts")?.length().let { it == null || it == 0 } && cs.isNotBlank() && cs != "Health Supplement") d.put("allConcepts", JSONArray().put(cs))
            d.put("approvals", JSONObject().also { o -> PARTS.forEach { o.put(it, approvals[it] == true) } })
            if (d.optJSONArray("rows") == null) d.put("rows", JSONArray())
            for (k in listOf("allConcepts", "allBenefits", "allSP", "cons", "benefits")) if (d.optJSONArray(k) == null) d.put(k, JSONArray())
            val rowsArr = d.getJSONArray("rows")
            for (i in 0 until rowsArr.length()) rowsArr.optJSONObject(i)?.let { r -> r.remove("fda"); if (r.optString("o").isBlank()) r.put("o", "—") }
            return JobJson.fromJson(d.toString())
        }
    }
}

/** Real HTTP transport (HttpURLConnection). HTTPS only; no redirects followed. */
class HttpTransport(private val base: String) : Transport {
    init { require(base.startsWith("https://") || base.startsWith("http://127.0.0.1")) { "ต้องใช้ HTTPS" } }
    override fun send(method: String, path: String, headers: Map<String, String>, body: String?): LiveResponse {
        val c = URL(base + path).openConnection() as HttpURLConnection
        c.instanceFollowRedirects = false; c.connectTimeout = 15000; c.readTimeout = 30000; c.requestMethod = method
        c.setRequestProperty("Accept", "application/json")
        headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
        if (body != null && method == "POST") { c.doOutput = true; c.outputStream.use { it.write(body.toByteArray()) } }
        val status = c.responseCode
        val stream = if (status >= 400) c.errorStream else c.inputStream
        val text = stream?.use { it.readBytes().take(8_000_000).toByteArray().toString(Charsets.UTF_8) } ?: ""
        return LiveResponse(status, text, c.headerFields["Set-Cookie"].orEmpty())
    }
}
