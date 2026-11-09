package th.co.beyondlab.formulastudio.live

import java.net.ServerSocket
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Synthetic data only. Proves the live client is read-only and maps web record shapes. */
class LiveClientTest {
    private val calls = mutableListOf<String>()
    private fun rec(id: String, extra: JSONObject = JSONObject()) = JSONObject().put("id", id).put("updated_at", "2026-11-01T00:00:00Z").put("data",
        JSONObject().put("brand", "B$id").put("customer", "C").put("salesOwner", "demo-sales")
            .put("rows", JSONArray().put(JSONObject().put("num", 1).put("name", "X").put("w", "500").put("o", "").put("p", "50").put("actual", 250).put("hero", true)))
            .also { d -> extra.keys().forEach { k -> d.put(k, extra.get(k)) } })

    private fun fake() = Transport { m, p, _, body ->
        calls += "$m ${p.substringBefore('?')}"
        when {
            m == "POST" && p == "/sb/session" -> { assertTrue(JSONObject(body!!).has("password")); LiveResponse(200, "{}", listOf("sid=abc; Path=/; HttpOnly")) }
            m == "GET" && p == "/sb/session" -> LiveResponse(200, """{"authenticated":true,"name":"demo","role":"sales","canEdit":true}""")
            p.startsWith("/sb/rest/v1/fs_records") -> LiveResponse(200, JSONArray().put(rec("A00002", JSONObject().put("closed", JSONObject().put("by", "x")))).put(rec("A00001")).put(rec("bad")).toString())
            p.startsWith("/sb/rest/v1/fs_approvals") -> LiveResponse(200, JSONArray().put(JSONObject().put("job_id", "A00001").put("part", "pd").put("data", JSONObject().put("by", "x"))).toString())
            p.startsWith("/sb/rest/v1/fs_messages") -> LiveResponse(200, JSONArray()
                .put(JSONObject().put("uid", "u1").put("job_id", "A00001").put("ts", 5).put("data", JSONObject().put("type", "msg").put("user", "u").put("text", "hi")))
                .put(JSONObject().put("uid", "u2").put("job_id", "A00001").put("ts", 6).put("data", JSONObject().put("type", "sys").put("text", "sys"))).toString())
            else -> LiveResponse(404, "{}")
        }
    }

    @Test fun readsJobsApprovalsMessages_andIssuesNoWrites() {
        val c = LiveClient(fake())
        assertEquals("sales", c.login("demo", "pw").role)
        val jobs = c.loadJobs()
        assertEquals(listOf("A00002", "A00001"), jobs.map { it.id })          // invalid id dropped
        assertTrue(jobs[0].closed); assertFalse(jobs[1].closed)               // closed is an object on the web
        assertEquals(true, jobs[1].approvals["pd"]); assertEquals(false, jobs[1].approvals["ra"])
        assertEquals(500.0, jobs[1].rows[0].w, 0.0); assertEquals("—", jobs[1].rows[0].o)   // string numbers, blank origin
        assertEquals(listOf("u: hi", "ระบบ: sys"), c.loadMessages("A00001").map { "${it.user}: ${it.text}" })
        val writes = calls.filter { it.startsWith("POST") || it.startsWith("PUT") || it.startsWith("PATCH") || it.startsWith("DELETE") }
        assertEquals(listOf("POST /sb/session"), writes)                       // login only
        c.logout(); assertEquals("DELETE /sb/session", calls.last())
    }

    @Test fun forbiddenApprovalsKeepJobListWorking_andIsFlaggedNotShownAsPending() {
        val base = fake()
        val c = LiveClient(Transport { m, p, h, b -> if (p.startsWith("/sb/rest/v1/fs_approvals")) LiveResponse(403, "{}") else base.send(m, p, h, b) })
        c.login("demo", "pw")
        val jobs = c.loadJobs()
        assertEquals(listOf("A00002", "A00001"), jobs.map { it.id }); assertTrue(c.approvalsHidden)
        assertTrue(jobs.all { j -> j.approvals.values.none { it } })
        val c401 = LiveClient(Transport { m, p, h, b -> if (p.startsWith("/sb/rest/v1/fs_approvals")) LiveResponse(401, "{}") else base.send(m, p, h, b) })
        c401.login("demo", "pw")
        assertEquals(401, assertThrows(LiveError::class.java) { c401.loadJobs() }.status)   // only 403 is tolerated
        val ok = LiveClient(base); ok.login("demo", "pw"); ok.loadJobs(); assertFalse(ok.approvalsHidden)
    }

    @Test fun allowListRefusesEveryWritePath() {
        for (p in listOf("/sb/rest/v1/rpc/fs_save_record", "/__formula/approval-change", "/sb/rest/v1/fs_messages?x=1", "/sb/rest/v1/fs_chats?x=1", "/sb/rest/v1/fs_records"))
            for (m in listOf("POST", "PUT", "PATCH", "DELETE")) assertFalse("$m $p", LiveClient.allowed(m, p))
        assertFalse(LiveClient.allowed("GET", "/sb/rest/v1/fs_users?select=*"))
        assertTrue(LiveClient.allowed("GET", "/sb/rest/v1/fs_records?select=id,data,updated_at&order=id.desc"))
        val c = LiveClient(fake())
        assertThrows(IllegalStateException::class.java) { LiveClient::class.java.getDeclaredMethod("call", String::class.java, String::class.java, Map::class.java, String::class.java).also { it.isAccessible = true }
            .let { try { it.invoke(c, "POST", "/sb/rest/v1/rpc/fs_save_record", emptyMap<String, String>(), "{}") } catch (e: java.lang.reflect.InvocationTargetException) { throw e.cause!! } } }
        assertTrue(calls.isEmpty())                                           // nothing reached the transport
    }

    @Test fun unauthenticatedAndForbidden() {
        val c = LiveClient { _, p, _, _ -> if (p == "/sb/session") LiveResponse(401, "{}") else LiveResponse(403, "{}") }
        assertNull(c.session())
        assertEquals(403, assertThrows(LiveError::class.java) { c.loadJobs() }.status)
        assertEquals(401, assertThrows(LiveError::class.java) { c.login("a", "b") }.status)
    }

    @Test fun realHttpTransportOverLoopback_sendsCookieAndRange() {
        val seen = java.util.Collections.synchronizedList(mutableListOf<String>())
        val srv = ServerSocket(0, 5, java.net.InetAddress.getByName("127.0.0.1"))
        val t = Thread {
            repeat(3) {
                try { srv.accept().use { sock ->
                    val r = sock.getInputStream().bufferedReader()
                    val first = r.readLine(); val hdr = generateSequence { r.readLine() }.takeWhile { it.isNotEmpty() }.toList()
                    val len = hdr.firstOrNull { it.startsWith("Content-Length", true) }?.substringAfter(":")?.trim()?.toInt() ?: 0
                    repeat(len) { r.read() }
                    seen += first + " cookie=" + hdr.firstOrNull { it.startsWith("Cookie") } + " range=" + hdr.firstOrNull { it.startsWith("Range:") }
                    val post = first.startsWith("POST")
                    val body = if (first.contains("/sb/session")) """{"authenticated":true,"name":"n","role":"opc","canEdit":false}""" else "[]"
                    sock.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n" + (if (post) "Set-Cookie: sid=zzz; Path=/\r\n" else "") +
                        "Content-Length: ${body.length}\r\nConnection: close\r\n\r\n$body").toByteArray())
                } } catch (_: Exception) {}
            }
        }
        t.start()
        try {
            val c = LiveClient(HttpTransport("http://127.0.0.1:${srv.localPort}"))
            c.login("a", "b"); assertEquals(0, c.loadJobs().size)
            t.join(5000)
            assertTrue(seen.toString(), seen.any { it.startsWith("GET /sb/rest/v1/fs_records") && it.contains("sid=zzz") && it.contains("0-999") })
        } finally { srv.close() }
        assertThrows(IllegalArgumentException::class.java) { HttpTransport("http://example.com") }
    }

    @Test fun rememberedSessionResumesWithCookieOnly_noPasswordKept() {
        val a = LiveClient(fake()); a.login("demo", "SECRET-PW")
        val saved = a.exportCookies()
        assertEquals("sid=abc", saved); assertFalse(saved.contains("SECRET-PW"))
        val sent = mutableListOf<String>()
        val b = LiveClient { m, p, h, _ -> sent += "$m $p ${h["Cookie"]}"; LiveResponse(200, """{"authenticated":true,"name":"demo","role":"sales","canEdit":true}""") }
        b.importCookies(saved)
        assertEquals("demo", b.session()!!.name)
        assertEquals(listOf("GET /sb/session sid=abc"), sent)
    }

    @Test fun mapsBriefFieldsAndToleratesWebShapes_andCountsUnreadableRecords() {
        val good = rec("A00007", JSONObject().put("price", 12.5).put("form", "แคปซูล").put("size", 30).put("sizeUnit", "แคปซูล")
            .put("finalTarget", "T").put("benefits", JSONArray().put("b1")).put("allSP", JSONArray().put("s1")).put("cons", JSONArray().put("c1")))
        val j = LiveClient.toJob(good, emptyMap())
        assertEquals("12.5", j.brief.price); assertEquals("30 แคปซูล", "${j.brief.size} ${j.brief.sizeUnit}")
        assertEquals(listOf("b1"), j.brief.benefits); assertEquals(listOf("s1"), j.brief.allSP); assertEquals(listOf("c1"), j.brief.cons)
        val lines = th.co.beyondlab.formulastudio.ui.briefLines(j.brief).toMap()
        assertEquals("แคปซูล", lines["รูปแบบ"]); assertEquals("T", lines["กลุ่มเป้าหมาย"]); assertEquals("12.5", lines["ราคา/หน่วย"])
        // one record with an unreadable list must not hide the rest, and must be counted
        val bad = rec("A00008", JSONObject().put("benefits", JSONArray().put(JSONObject.NULL)))
        val c = LiveClient { _, p, _, _ -> when {
            p.startsWith("/sb/rest/v1/fs_records") -> LiveResponse(200, JSONArray().put(bad).put(good).toString())
            else -> LiveResponse(200, "[]") } }
        assertEquals(listOf("A00007"), c.loadJobs().map { it.id }); assertEquals(1, c.skipped)
    }

    @Test fun oldRecordKeepsItsConceptStr() {
        assertEquals("ผิวขาว", LiveClient.toJob(rec("A00009", JSONObject().put("conceptStr", "ผิวขาว")), emptyMap()).brief.conceptStr)
        assertEquals("Health Supplement", LiveClient.toJob(rec("A00010"), emptyMap()).brief.conceptStr)
    }

    @Test fun viewAsRolePreview_filtersOwnOnlyRoles_andMatchesRuntimeRoleList() {
        fun job(id: String, owner: String) = LiveClient.toJob(rec(id, JSONObject().put("salesOwner", owner)), emptyMap())
        val jobs = listOf(job("A00001", "ก"), job("A00002", "ข"), job("A00003", "ก"))
        assertEquals(listOf("ก", "ข"), ViewRole.owners(jobs))
        assertEquals(3, ViewRole.visible(ViewRole.OPC, null, jobs).size)                 // not own-only: everything
        assertEquals(listOf("A00001", "A00003"), ViewRole.visible(ViewRole.SALES, "ก", jobs).map { it.id })
        assertEquals(listOf("A00002"), ViewRole.visible(ViewRole.OVERSEA, "ข", jobs).map { it.id })
        assertEquals(0, ViewRole.visible(ViewRole.SALES, null, jobs).size)               // no owner chosen: nothing
        assertEquals(listOf("admin", "pd", "ra", "rd", "sales", "oversea", "opc", "mkt", "purchasing"), ViewRole.values().map { it.key })
        assertEquals(setOf("sales", "oversea"), ViewRole.values().filter { it.ownOnly }.map { it.key }.toSet())
    }

    @Test fun searchMatchesIdBrandCustomerOwner() {
        val j = LiveClient.toJob(rec("A00042", JSONObject().put("brand", "GlowBrand").put("customer", "ACME").put("salesOwner", "คุณเอ")), emptyMap())
        for (q in listOf("", "a00042", "glow", "acme", "เอ")) assertTrue(q, ViewRole.matches(j, q))
        assertFalse(ViewRole.matches(j, "zzz"))
    }
}
