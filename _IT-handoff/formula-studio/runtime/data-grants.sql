-- สิทธิ์ระดับตาราง — ต้องรัน "หลัง" สร้างตารางแล้วเสมอ
--
-- Supabase ให้สิทธิ์ชุดนี้กับ anon/authenticated มาให้เองตั้งแต่ต้น ฐานเปล่าไม่ให้
-- ถ้าลืมชุดนี้ อาการที่ได้คือ PostgREST ตอบ 401/permission denied ทั้งที่ RLS ผ่านแล้ว
-- ซึ่งอ่านจาก error ไม่ออกเลยว่าปัญหาอยู่ที่ grant ไม่ใช่ policy
\set ON_ERROR_STOP on

grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;

-- ตารางที่สร้างทีหลังต้องได้สิทธิ์เดียวกันเองโดยไม่ต้องมีใครจำ
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
