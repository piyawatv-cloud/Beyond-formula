#!/bin/sh
# ด่านตรวจว่านโยบายในฐานยังอยู่ครบ — อ่านอย่างเดียว ไม่เขียนอะไรลงฐานเลย
#
# ทำไมต้องมีเป็นด่านแยก:
# runtime/data-grants.sql ให้ `grant all` กับ anon และ runtime/data-policy.sql เป็น
# ตัวเพิกถอนกลับ · ทางกู้คืนหรือทาง re-init ไหนที่รันไฟล์แรกโดยไม่รันไฟล์ที่สอง
# จะคืนสิทธิ์ TRUNCATE ให้ anon และทิ้ง trigger เก็บสำเนาไป **โดยไม่มีอาการอะไรเลย**
# จนถึงวันที่มีคนกดลบ แล้วของหายถาวร — ไม่มีหน้าจอไหนเปลี่ยน ไม่มี error สักบรรทัด
#
# ใช้ทั้งใน monitor-formula.sh (ทุก 15 นาที) และ safe-deploy-formula.sh (ก่อนปล่อยของ)
# เขียนเป็นไฟล์เดียวเพื่อไม่ให้สองที่ตรวจคนละอย่างแล้วเถียงกันเอง
#
# ใช้: sh scripts/verify-data-policy.sh
# ออก: 0 = ครบ · 1 = ไม่ครบ · 2 = ติดต่อฐานไม่ได้
set -eu

PG_CONTAINER="${FORMULA_PG_CONTAINER:-formula-postgres}"
PGREST="${FORMULA_POSTGREST_URL:-http://127.0.0.1:3031}"
BAD=0
ok()   { echo "  ผ่าน: $*"; }
bad()  { echo "  ไม่ผ่าน: $*"; BAD=1; }
ask()  { docker exec -i "$PG_CONTAINER" psql -tAq -U postgres -d formula -c "$1" 2>/dev/null || echo error; }

docker exec "$PG_CONTAINER" pg_isready -U postgres -d formula >/dev/null 2>&1 \
  || { echo "policy status=unknown why=ติดต่อฐาน $PG_CONTAINER ไม่ได้"; exit 2; }

T="$(ask "select has_table_privilege('anon','fs_records','TRUNCATE')")"
[ "$T" = f ] && ok "anon ไม่มีสิทธิ์ TRUNCATE" \
  || bad "anon มีสิทธิ์ TRUNCATE (ได้ '$T') why=คำสั่งเดียวล้างได้ทั้งตาราง โดยไม่มี WHERE ให้พลาด"

# Activity Log: ลบต้องตัดสิทธิ์ทิ้ง ส่วนแก้ต้องกันด้วย trigger ไม่ใช่ตัดสิทธิ์
#
# ตัดสิทธิ์ UPDATE ทิ้งไม่ได้ เพราะแอปส่ง Prefer: resolution=merge-duplicates ทุกครั้ง
# ซึ่งกลายเป็น INSERT .. ON CONFLICT DO UPDATE และต้องการสิทธิ์ UPDATE ต่อให้ไม่มีแถวชนกัน
# ตัดไปแล้วแอปเขียนประวัติไม่ได้เลย แล้วรอบซิงก์พังทั้งรอบ (เกิดขึ้นจริง 24 ส.ค.)
D="$(ask "select has_table_privilege('anon','fs_activities','DELETE')")"
[ "$D" = f ] && ok "Activity Log ลบไม่ได้" \
  || bad "anon ลบ fs_activities ได้ (ได้ '$D') why=ประวัติว่าใครทำอะไร ถูกลบทิ้งได้"

NU="$(ask "select count(*) from pg_trigger where tgname = 'fs_activities_no_update' and not tgisinternal")"
[ "$NU" = 1 ] && ok "Activity Log แก้ไม่ได้ (กันด้วย trigger ไม่ใช่ตัดสิทธิ์)" \
  || bad "ไม่มี trigger fs_activities_no_update why=ประวัติถูกเขียนทับได้ · คนที่ดึงประวัติไปแล้วส่งกลับขึ้นมา จะประทับชื่อตัวเองทับชื่อคนที่ทำจริง"

IU="$(ask "select has_table_privilege('anon','fs_activities','INSERT') and has_table_privilege('anon','fs_activities','UPDATE')")"
[ "$IU" = t ] && ok "แอปยังเขียนประวัติได้ (INSERT + UPDATE ครบ)" \
  || bad "anon เขียนประวัติไม่ได้ (ได้ '$IU') why=รอบซิงก์จะล้มที่บรรทัดนั้น แล้วทุกอย่างหลังจากนั้นไม่ทำงานทั้งรอบ"

A="$(ask "select has_table_privilege('anon','fs_archive','SELECT') or has_table_privilege('anon','fs_archive','DELETE')")"
[ "$A" = f ] && ok "anon แตะ fs_archive ไม่ได้" \
  || bad "anon แตะ fs_archive ได้ (ได้ '$A') why=ลบของแล้วยังตามไปลบสำเนาทิ้งได้อีก"

TRG="$(ask "select count(*) from pg_trigger where tgname like '%_keep_deleted' and not tgisinternal")"
[ "$TRG" = 5 ] && ok "trigger เก็บสำเนาครบ 5 ตาราง" \
  || bad "trigger เก็บสำเนาพบ $TRG ตาราง ต้องการ 5 why=ลบแล้วไม่มีสำเนาเก็บไว้ กู้ไม่ได้"

# This additive migration must be approved/applied before the latest gate.
# Check the exact table, function and all-row BEFORE UPDATE shape read-only.
PL="$(ask "select count(*) from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='public.fs_users'::regclass and t.tgname='fs_users_preserve_profile_linkage' and not t.tgisinternal and t.tgenabled='O' and t.tgtype=19 and t.tgattr=''::int2vector and t.tgqual is null and t.tgnargs=0 and p.oid=to_regprocedure('public.fs_preserve_profile_linkage()') and not p.prosecdef and p.prorettype='pg_catalog.trigger'::regtype and p.prolang=(select oid from pg_language where lanname='plpgsql') and p.proconfig=array['search_path=pg_catalog, pg_temp']::text[]")"
[ "$PL" = 1 ] && ok "ข้อมูลเชื่อมโยงโปรไฟล์ถูกเก็บจากแถวปัจจุบันเมื่อบันทึก" \
  || bad "ด่านรักษาข้อมูลเชื่อมโยงโปรไฟล์หายไปหรือรูปแบบไม่ถูกต้อง why=การบันทึกข้อมูลเก่าอาจลบข้อมูลเชื่อมโยงที่เพิ่งเพิ่ม"

JF="$(ask "select count(*) from pg_trigger where tgname='fs_records_recreation_fence' and not tgisinternal and tgenabled='O'")"
[ "$JF" = 1 ] && ok "ใบงานที่ถูกลบถูกกันไม่ให้ส่งซ้ำกลับมา" \
  || bad "ไม่มีด่านกันการคืนใบงานที่ถูกลบ"
JS="$(ask "select count(*) from pg_proc where oid=to_regprocedure('public.fs_save_record(text,jsonb,jsonb)') and not prosecdef")"
[ "$JS" = 1 ] && ok "การบันทึกใบงานไม่ยกระดับสิทธิ์ฐานข้อมูล" \
  || bad "ฟังก์ชันบันทึกใบงานหายไปหรือยกระดับสิทธิ์"
# Owner-delete cleanup depends on this narrow SECURITY DEFINER lookup after a
# restart or reservation expiry.  It must exist before the proxy is switched;
# granting SELECT on fs_archive would be a broader and unsafe alternative.
OD="$(ask "select count(*) from pg_proc where oid=to_regprocedure('public.fs_owner_deleted_jobs(text[],text)') and prosecdef")"
[ "$OD" = 1 ] && ok "ประตูตรวจเจ้าของใบงานที่ถูกลบอยู่และเป็น SECURITY DEFINER" \
  || bad "ประตูตรวจเจ้าของใบงานที่ถูกลบหายไปหรือยกระดับไม่ถูกต้อง"
OE="$(ask "select has_function_privilege('anon','public.fs_owner_deleted_jobs(text[],text)','execute') and has_function_privilege('authenticated','public.fs_owner_deleted_jobs(text[],text)','execute')")"
[ "$OE" = t ] && ok "runtime เรียกประตูตรวจเจ้าของใบงานได้โดยไม่เปิดอ่าน fs_archive" \
  || bad "สิทธิ์เรียกประตูตรวจเจ้าของใบงานไม่ครบ"
JX="$(curl -sS --max-time 20 -X POST "$PGREST/rpc/fs_job_integrity_snapshot" -H 'content-type: application/json' -d '{}' 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{try{const j=JSON.parse(s);console.log(j.version===1&&j.complete===true&&Array.isArray(j.items)?"ok":"unknown")}catch{console.log("unknown")}})' || echo unknown)"
[ "$JX" = ok ] && ok "ตรวจความครบถ้วนของใบงานรายเลขได้จากฐานจริง" \
  || bad "ตรวจความครบถ้วนรายเลขไม่ได้หรือผลไม่ครบ"

FN="$(ask "select count(*) from pg_proc where proname in ('fs_next_rec_seq','fs_keep_deleted','fs_guard_meta','fs_freeze_user_identity','fs_set_user_role')")"
[ "$FN" = 5 ] && ok "ฟังก์ชันของนโยบายครบ 5 ตัว" \
  || bad "ฟังก์ชันของนโยบายพบ $FN ตัว ต้องการ 5 why=ชิ้นส่วนของนโยบายหายไป"

MG="$(ask "select count(*) from pg_trigger where tgname = 'fs_meta_guard' and not tgisinternal")"
[ "$MG" = 1 ] && ok "ตัวนับเลขงานถูกกันไว้ไม่ให้เขียนตรง" \
  || bad "ไม่มี trigger fs_meta_guard why=เบราว์เซอร์เขียนทับตัวนับเลขงานได้ แล้วใบถัดไปจะได้เลขซ้ำใบเก่า"

# PostgREST เห็นประตูเปลี่ยนบทบาทหรือยัง
#
# ส่งบทบาทที่ผิดรูปแบบไปโดยตั้งใจ ฟังก์ชัน raise ตั้งแต่บรรทัดแรกก่อนถึงคำสั่ง update
# จึงไม่เขียนอะไรลงฐานเลย · ที่ต้องแยกให้ออกคือ 400 (เห็นฟังก์ชันแล้วปฏิเสธตามกฎ = ดี)
# กับ 404 PGRST202 (แคชสคีมาค้าง = ประตูใช้ไม่ได้ทั้งที่ฟังก์ชันอยู่ในฐานครบ)
RPC="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$PGREST/rpc/fs_set_user_role" \
  -H 'content-type: application/json' -d '{"p_name":"__ตรวจสอบ__","p_role":"__ผิดรูปแบบ__"}' 2>/dev/null || echo 000)"
[ "$RPC" = 400 ] && ok "PostgREST เห็นประตูเปลี่ยนบทบาท และปฏิเสธค่าที่ผิดตามกฎ" \
  || bad "ประตูเปลี่ยนบทบาทตอบ $RPC ต้องการ 400 why=ได้ 404 แปลว่าแคชสคีมาของ PostgREST ค้าง admin จะเปลี่ยนบทบาทแล้วค่าเด้งกลับเงียบ ๆ (แก้ด้วย notify pgrst, 'reload schema')"

echo "policy status=$( [ "$BAD" = 0 ] && echo ok || echo fail )"
exit "$BAD"
