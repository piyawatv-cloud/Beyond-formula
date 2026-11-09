// Actual Chromium keyboard navigation, synthetic preview only.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {actualBrowser,browserValue,waitForDocument}=await import(process.env.FORMULA_TEST_BROWSER_HELPER_URL||new URL('../../_IT-handoff/formula-studio/tests/helpers/chat-journal-browser.mjs',import.meta.url).href);
test('keyboard stays in open drawer and returns to its trigger',async t=>{
 const html=await readFile(new URL('../index.html',import.meta.url));const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});
 const origin='http://127.0.0.1:'+server.address().port+'/';const browser=await actualBrowser(t,origin);assert.ok(browser);await waitForDocument(browser,origin);
 await browser.send('Runtime.evaluate',{userGesture:true,expression:"document.querySelector('#menu-open').click()"});
 assert.equal(await browserValue(browser,'document.activeElement.id'),'menu-close');
 assert.equal(await browserValue(browser,"document.querySelector('#drawer').getAttribute('aria-modal')"),'true');
 assert.equal(await browserValue(browser,"[...document.querySelectorAll('.top,main,.nav')].every(el=>el.inert)"),true);
 const key=async(key,modifiers=0)=>{await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:key==='Tab'?9:27,modifiers});await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:key==='Tab'?9:27,modifiers})};
 await key('Tab',8);assert.equal(await browserValue(browser,"document.activeElement.dataset.menu"),'reset','Shift-Tab wraps to last drawer action');
 await key('Tab');assert.equal(await browserValue(browser,'document.activeElement.id'),'menu-close','Tab wraps to close control');
 await key('Escape');assert.equal(await browserValue(browser,'document.activeElement.id'),'menu-open');
 assert.equal(await browserValue(browser,"document.querySelector('#menu-open').getAttribute('aria-expanded')"),'false');
 assert.equal(await browserValue(browser,"[...document.querySelectorAll('.top,main,.nav')].every(el=>!el.inert)"),true);
 await browser.send('Emulation.setDeviceMetricsOverride',{width:320,height:640,deviceScaleFactor:1,mobile:true});
 await browser.send('Runtime.evaluate',{userGesture:true,expression:"document.querySelector('#menu-open').click()"});
 assert.equal(await browserValue(browser,"document.querySelector('#drawer').scrollWidth<=document.querySelector('#drawer').clientWidth"),true,'drawer fits narrow viewport');
 await key('Escape');assert.equal(await browserValue(browser,'document.activeElement.id'),'menu-open');
});
