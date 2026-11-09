#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = __dirname;
const sourcePath = path.join(root, 'index.html');
const testPath = path.join(root, 'test.html');
const browser = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let html = fs.readFileSync(sourcePath, 'utf8');
const originalUrl = (html.match(/let SB_URL = '([^']*)';/) || [,''])[1];
const originalKey = (html.match(/let SB_KEY = '([^']*)';/) || [,''])[1];
html = html
  .replace(/let SB_URL = '[^']*';/, "let SB_URL = 'https://test-project.supabase.co';")
  .replace(/let SB_KEY = '[^']*';/, "let SB_KEY = 'sb_publishable_test_only';");

const mockPrelude = `<script>
window.__FS_TEST__ = true;
window.__fetchCalls = [];
window.__fetchQueue = [];
window.__mockResponse = function(status, body){
  const text = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  return {ok:status >= 200 && status < 300,status:status,text:async()=>text,json:async()=>text?JSON.parse(text):null};
};
window.fetch = async function(url, options){
  const call = {url:String(url),options:options||{}};
  window.__fetchCalls.push(call);
  const next = window.__fetchQueue.shift();
  if(typeof next === 'function') return next(call);
  if(next) return next;
  return window.__mockResponse(200, []);
};
</script>`;

html = html.replace(/<script>\s*\/\/ ===================================================================/, mockPrelude + '\n<script>\n// ===================================================================');
html = html.replace('</body>', '<script src="tests/formula-studio.test.js"></script>\n</body>');

if(!html.includes('window.__FS_TEST__ = true') || !html.includes('tests/formula-studio.test.js')){
  throw new Error('Could not inject the deterministic browser harness');
}
if((originalUrl && html.includes(originalUrl)) || (originalKey && html.includes(originalKey))){
  throw new Error('The generated harness still contains production configuration');
}

fs.writeFileSync(testPath, html);

const result = spawnSync(browser, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-background-networking',
  '--virtual-time-budget=7000',
  '--dump-dom',
  'file://' + testPath
], {encoding:'utf8', maxBuffer:32 * 1024 * 1024});

if(result.error) throw result.error;
const output = result.stdout || '';
const match = output.match(/<pre id="fs-test-results">([\s\S]*?)<\/pre>/);
const report = match ? match[1]
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : '';

if(report) process.stdout.write(report + '\n');
if(result.status !== 0 || !/<html[^>]*data-test-status="passed"/.test(output)){
  if(!report) process.stderr.write((result.stderr || 'Browser test did not produce a report') + '\n');
  process.exit(1);
}
