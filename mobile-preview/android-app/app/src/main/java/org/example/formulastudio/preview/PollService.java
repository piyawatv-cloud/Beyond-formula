package org.example.formulastudio.preview;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.net.URLEncoder;
import java.time.Instant;

/** ถามข้อความใหม่เป็นระยะแม้ปิดแอป (ประมาณทุก 15 นาที ตามที่ Android อนุญาต) · แสดงเฉพาะข้อความทั่วไป ไม่มีรายละเอียดลูกค้า/สูตร */
public class PollService extends JobService {
    static final int JOB_ID = 4201;

    static void schedule(Context c) {
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        js.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(c, PollService.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(15 * 60 * 1000L).setPersisted(true).build());
    }
    static void cancel(Context c) { ((JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE)).cancel(JOB_ID); }

    @Override public boolean onStartJob(JobParameters params) {
        final Context c = getApplicationContext();
        new Thread(() -> {
            try {
                if (!LiveHttp.hasSession(c)) { cancel(c); return; }
                String since = LiveHttp.prefs(c).getString("since", Instant.now().minusSeconds(900).toString());
                String now = Instant.now().toString();
                String path = "/sb/rest/v1/fs_messages?select=uid,job_id,ts,data,updated_at&updated_at=gte." + URLEncoder.encode(since, "UTF-8").replace("%3A", ":") + "&order=updated_at.desc";
                JSONObject r = new JSONObject(LiveHttp.request(c, "GET", path, "{\"Range-Unit\":\"items\",\"Range\":\"0-49\"}", null));
                int status = r.optInt("status", 0);
                if (status == 401) { AlertReceiver.show(c, "Formula Studio", "เซสชันหมดอายุ เปิดแอปเพื่อเข้าสู่ระบบอีกครั้ง"); cancel(c); return; }
                if (status != 200) return;
                String me = LiveHttp.prefs(c).getString("name", "");
                JSONArray rows = new JSONArray(r.getString("body"));
                int fresh = 0;
                for (int i = 0; i < rows.length(); i++) {
                    JSONObject d = rows.getJSONObject(i).optJSONObject("data");
                    String who = d == null ? "" : d.optString("user", "");
                    String type = d == null ? "" : d.optString("type", "");
                    if (!"sys".equals(type) && !who.equals(me)) fresh++;
                }
                LiveHttp.prefs(c).edit().putString("since", now).apply();
                if (fresh > 0) AlertReceiver.show(c, "Formula Studio", "มีข้อความใหม่ใน Formula Studio");
            } catch (Exception ignored) {
            } finally { jobFinished(params, false); }
        }).start();
        return true;
    }
    @Override public boolean onStopJob(JobParameters params) { return true; }
}
