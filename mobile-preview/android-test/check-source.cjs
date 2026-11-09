'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');const root=__dirname;
const manifest=fs.readFileSync(path.join(root,'app/src/main/AndroidManifest.xml'),'utf8');
assert.ok(!/android\.permission\.INTERNET/.test(manifest),'ตัวทดสอบต้องไม่เชื่อมอินเทอร์เน็ต');
assert.match(manifest,/android\.permission\.POST_NOTIFICATIONS/);assert.match(manifest,/android:exported="false"/);
const receiver=fs.readFileSync(path.join(root,'app/src/main/java/org/example/formulastudiotest/TestReceiver.java'),'utf8');
assert.match(receiver,/NotificationManager/);assert.match(receiver,/ข้อมูลจำลอง/);
console.log('PASS: offline Android notification fixture boundaries');
