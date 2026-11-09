package org.example.formulastudio.preview;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** คำขอไปยังประตูข้อมูลเดิมของ Formula runtime เท่านั้น · ถือ session cookie ในพื้นที่ส่วนตัวของแอป · ไม่เก็บรหัสผ่าน */
final class LiveHttp {
    static final String BASE = "https://formula.beyond-workflow.com";
    private static final Pattern READ_PATH = Pattern.compile("^/sb/rest/v1/(fs_records|fs_chats|fs_messages|fs_approvals)\\?[A-Za-z0-9_.,=&%()\"*:+\\-]{0,1500}$");

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("live", Context.MODE_PRIVATE); }

    /** อนุญาตเฉพาะ: อ่าน 4 ตาราง, /sb/session, และเส้นทางเขียนของเว็บ 5 เส้นทาง (คำสั่งอนุมัติ, บันทึกใบงานแบบ CAS, ขอเลขงาน, สร้างห้องแชต, ข้อความแชต) */
    static boolean allowed(String method, String path) {
        if ("/sb/session".equals(path)) return method.equals("GET") || method.equals("POST") || method.equals("DELETE");
        if (method.equals("POST")) return path.equals("/__formula/push-register") || path.equals("/__formula/push-unregister") || path.equals("/__formula/approval-change") || path.equals("/sb/rest/v1/rpc/fs_save_record") || path.equals("/sb/rest/v1/rpc/fs_next_rec_seq") || path.equals("/sb/rest/v1/fs_messages") || path.equals("/sb/rest/v1/fs_chats");
        return method.equals("GET") && READ_PATH.matcher(path).matches();
    }

    static void clearSession(Context c) { prefs(c).edit().remove("cookies").remove("name").remove("since").apply(); }
    static boolean hasSession(Context c) { return !prefs(c).getString("cookies", "{}").equals("{}"); }

    private static String cookieHeader(Context c) throws Exception {
        JSONObject jar = new JSONObject(prefs(c).getString("cookies", "{}"));
        StringBuilder sb = new StringBuilder();
        for (Iterator<String> it = jar.keys(); it.hasNext(); ) { String k = it.next(); if (sb.length() > 0) sb.append("; "); sb.append(k).append('=').append(jar.getString(k)); }
        return sb.toString();
    }

    private static void storeCookies(Context c, Map<String, List<String>> headers) throws Exception {
        List<String> set = headers.get("Set-Cookie");
        if (set == null) return;
        JSONObject jar = new JSONObject(prefs(c).getString("cookies", "{}"));
        for (String line : set) {
            String[] parts = line.split(";");
            int eq = parts[0].indexOf('=');
            if (eq < 1) continue;
            String name = parts[0].substring(0, eq).trim(), value = parts[0].substring(eq + 1).trim();
            boolean expired = value.isEmpty();
            for (String p : parts) if (p.trim().equalsIgnoreCase("max-age=0")) expired = true;
            if (expired) jar.remove(name); else jar.put(name, value);
        }
        prefs(c).edit().putString("cookies", jar.toString()).apply();
    }

    /** คืน JSON {status, body} หรือ {error} */
    static String request(Context c, String method, String path, String headersJson, String body) {
        try {
            if (!allowed(method, path)) return new JSONObject().put("error", "คำขอนี้ไม่ได้รับอนุญาตในแอปนี้").toString();
            HttpURLConnection h = (HttpURLConnection) new URL(BASE + path).openConnection();
            h.setInstanceFollowRedirects(false);
            h.setConnectTimeout(15000);
            h.setReadTimeout(30000);
            h.setRequestMethod(method);
            JSONObject hd = new JSONObject(headersJson == null || headersJson.isEmpty() ? "{}" : headersJson);
            for (Iterator<String> it = hd.keys(); it.hasNext(); ) {
                String k = it.next();
                if (k.equalsIgnoreCase("content-type") || k.equalsIgnoreCase("range") || k.equalsIgnoreCase("range-unit") || k.equalsIgnoreCase("prefer")) h.setRequestProperty(k, hd.getString(k));
            }
            String cookie = cookieHeader(c);
            if (!cookie.isEmpty()) h.setRequestProperty("Cookie", cookie);
            h.setRequestProperty("Accept", "application/json");
            if (body != null && !body.isEmpty() && method.equals("POST")) {
                h.setDoOutput(true);
                try (OutputStream o = h.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
            }
            int status = h.getResponseCode();
            storeCookies(c, h.getHeaderFields());
            InputStream in = status >= 400 ? h.getErrorStream() : h.getInputStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            if (in != null) { byte[] b = new byte[8192]; int n; while ((n = in.read(b)) > 0 && buf.size() < 8_000_000) buf.write(b, 0, n); }
            String text = buf.toString("UTF-8");
            if (status == 401 && !path.equals("/sb/session")) clearSession(c);
            if (path.equals("/sb/session") && method.equals("GET") && status == 200) {
                try { prefs(c).edit().putString("name", new JSONObject(text).optString("name", "")).apply(); } catch (Exception ignore) { }
            }
            if (path.equals("/sb/session") && method.equals("DELETE")) clearSession(c);
            return new JSONObject().put("status", status).put("body", text).toString();
        } catch (Exception e) {
            try { return new JSONObject().put("error", "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้").toString(); } catch (Exception x) { return "{\"error\":\"x\"}"; }
        }
    }
}
