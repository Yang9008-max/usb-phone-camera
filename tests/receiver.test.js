'use strict';
const http = require('node:http');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const root = path.join(__dirname, '../app');
const jpeg = fs.readFileSync(path.join(__dirname, '../fixtures/test-frame.jpg'));
const packet = Buffer.concat([Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`), jpeg]);
async function main() {
  const clients = new Set();
  const phone = http.createServer((req, res) => {
    assert.equal(req.url, '/video/mjpeg');
    clients.add(res); res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame' });
    const timer = setInterval(() => res.write(packet), 40);
    res.on('close', () => { clearInterval(timer); clients.delete(res); });
  });
  phone.listen(0, '127.0.0.1'); await once(phone, 'listening');
  const target = 'http://127.0.0.1:' + phone.address().port;
  const base = 'http://127.0.0.1:9897';
  let child;
  try { child = spawn(process.execPath, [path.join(root, 'server.js'), '--port', '9897', '--phone', target], { cwd: root, windowsHide: true }); }
  catch (error) { phone.close(); throw error; }
  let errors = ''; child.stderr.on('data', data => errors += data);
  const deadline = Date.now() + 8000;
  try {
    let status;
    while (Date.now() < deadline) {
      try { status = await (await fetch(base + '/api/status')).json(); if (status.connected && status.frames >= 3) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.ok(status?.connected, errors || 'Portable USB receiver did not receive frames');
    assert.equal(status.app, 'usb-local'); assert.equal(status.target, target);
    assert.deepEqual(Buffer.from(await (await fetch(base + '/frame.jpg')).arrayBuffer()), jpeg);
    const page = await (await fetch(base + '/')).text(); assert.match(page, /手机直接连接本机/); assert.doesNotMatch(page, /来源电脑/);
    assert.equal(status.lanURL, null);
    assert.match(await (await fetch(base + '/camera')).text(), /手机摄像头画面/);
    assert.match(await (await fetch(base + '/capture.jpg')).headers.get('content-disposition'), /attachment/);
    console.log('PASS: USB 独立服务直接接收模拟手机视频、原尺寸 JPEG、USB 本地界面及纯画面；不依赖原电脑');
  } finally {
    const stopped = once(child, 'exit'); child.kill(); await stopped;
    for (const response of clients) response.destroy(); phone.closeAllConnections(); await new Promise(resolve => phone.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
