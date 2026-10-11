'use strict';
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { MjpegDecoder } = require('./mjpeg');
const { VideoAI } = require('./ai');
const ai = new VideoAI();

const args = process.argv.slice(2);
function option(name, fallback) { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; }
const port = Number(option('--port', '9890'));
const usbIP = option('--usb-ip', '');
const lanIP = option('--lan-ip', '');
const initialPhone = option('--phone', '');
const apkName = 'androidipcamera-0.14.0-universal-release.apk';
const state = { target: '', error: '等待连接手机', latest: null, lastAt: 0, sequence: 0, recent: [] };
let generation = 0, upstream = null, retry = null, installerURL = null, lanURL = null;
const viewers = new Set();

function validateTarget(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw Error('请输入 http://手机IP:端口；账号请填在单独的输入框');
  }
  const host = url.hostname;
  const parts = host.split('.').map(Number);
  const privateIP = net.isIPv4(host) && (parts[0] === 10 || parts[0] === 127 ||
    (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31));
  if (!privateIP) throw Error('仅支持手机的局域网 IPv4 地址');
  url.pathname = '/video/mjpeg';
  return url;
}
function fresh() { return state.latest && Date.now() - state.lastAt < 5000; }
function status() {
  const now = Date.now();
  state.recent = state.recent.filter(t => t > now - 2000);
  return { app: 'usb-local', version: '0.2.0', connected: Boolean(fresh()), target: state.target, error: state.error,
    frames: state.sequence, fps: Math.round(state.recent.length / 2), ageMs: state.lastAt ? now - state.lastAt : null,
    installer: installerURL, lanURL };
}
function disconnect(message = '已断开') {
  ai.resetCamera();
  generation++;
  clearTimeout(retry);
  if (upstream) upstream.destroy();
  upstream = null;
  state.latest = null; state.lastAt = 0; state.recent = []; state.error = message;
}
function connect(value, username = '', password = '') {
  const target = validateTarget(value);
  disconnect('正在连接手机…');
  state.target = target.origin;
  const current = generation;
  function attempt() {
    if (current !== generation) return;
    let finished = false;
    let receivedFrame = false;
    const fail = err => {
      if (finished || current !== generation) return;
      finished = true;
      state.latest = null;
      state.error = ['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(err.code)
        ? '手机使用自签名 HTTPS；请在手机 Settings → TLS Version 选择 TLS Disabled (HTTP only)，再用 http 地址连接'
        : (err.message || '视频连接中断');
      request.destroy();
      retry = setTimeout(attempt, 2000);
    };
    const headers = { Accept: 'multipart/x-mixed-replace' };
    if (username) headers.Authorization = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
    const request = (target.protocol === 'https:' ? https : http).get(target, { headers }, response => {
      if (current !== generation) { response.destroy(); return; }
      if (response.statusCode !== 200) {
        fail(Error(response.statusCode === 401 ? '手机需要用户名和密码' : response.statusCode === 403
          ? '手机默认启用了认证；请在手机 Settings 关闭 Enable Authentication，或设置并填写用户名和密码'
          : `手机返回 HTTP ${response.statusCode}`));
        return;
      }
      const type = String(response.headers['content-type'] || '');
      const match = /boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(type);
      if (!/multipart\/x-mixed-replace/i.test(type) || !match) { fail(Error('该地址没有返回 MJPEG 视频')); return; }
      const decoder = new MjpegDecoder(match[1] || match[2], jpeg => {
        if (current !== generation) return;
        receivedFrame = true;
        state.latest = jpeg; state.lastAt = Date.now(); state.sequence++;
        ai.frame(jpeg, state.lastAt, state.sequence);
        state.recent.push(state.lastAt);
        while (state.recent[0] < state.lastAt - 2000) state.recent.shift();
        state.error = '';
        const header = Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
        const packet = Buffer.concat([header, jpeg, Buffer.from('\r\n')]);
        for (const viewer of viewers) if (!viewer.writableNeedDrain && !viewer.destroyed) viewer.write(packet);
      });
      response.on('data', chunk => { try { decoder.push(chunk); } catch (err) { fail(err); } });
      response.on('end', () => fail(Error(receivedFrame ? '手机停止推流，正在重连' : '手机视频接口已响应，但没有输出图像；请退出并重新打开手机摄像头 App')));
      response.on('error', fail);
      response.on('aborted', () => fail(Error('USB 视频连接中断，正在重连')));
    });
    upstream = request;
    // The phone may need eight seconds to fall back from CameraX to Camera1.
    request.setTimeout(25000, () => fail(Error('手机没有响应；检查 USB 网络共享，保持手机摄像头 App 打开')));
    request.on('error', fail);
  }
  attempt();
}
function send(response, code, type, body, extra = {}) {
  response.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  response.end(body);
}
function json(response, code, value) { send(response, code, 'application/json; charset=utf-8', JSON.stringify(value)); }

const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
if (lanIP) {
  validateTarget(`http://${lanIP}`);
  allowedHosts.add(`${lanIP}:${port}`);
}
async function handleRequest(request, response) {
  if (!allowedHosts.has(request.headers.host)) {
    send(response, 403, 'text/plain', 'Invalid host'); return;
  }
  const route = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
  const localControl = request.socket.localAddress === '127.0.0.1' && request.socket.remoteAddress === '127.0.0.1';
  if (request.method === 'POST') {
    if (!localControl) { json(response, 403, { error: '连接设置请在接收手机的电脑上操作' }); return; }
    const origin = request.headers.origin;
    if ((origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin)) ||
        !String(request.headers['content-type']).startsWith('application/json')) { json(response, 403, { error: '请求来源无效' }); return; }
    let body = '';
    try {
      for await (const chunk of request) { body += chunk; if (body.length > 8192) throw Error('请求过大'); }
      const data = JSON.parse(body || '{}');
      if (route === '/api/connect') connect(data.url, data.username || '', data.password || '');
      else if (route === '/api/disconnect') disconnect();
      else if (route === '/api/ai/start') { ai.start(data); json(response, 200, ai.status()); return; }
      else if (route === '/api/ai/stop') { ai.stop(); json(response, 200, ai.status()); return; }
      else if (route === '/api/ai/heartbeat') { ai.heartbeat(); json(response, 200, ai.status()); return; }
      else { json(response, 404, { error: '未知请求' }); return; }
      json(response, 200, status());
    } catch (err) { json(response, 400, { error: err.message }); }
    return;
  }
  if (request.method !== 'GET') { send(response, 405, 'text/plain', 'Method not allowed'); return; }
  if (route === '/api/status') { json(response, 200, { ...status(), readOnly: !localControl }); return; }
  if (route === '/api/ai/status') {
    if (!localControl) { json(response, 403, { error: 'AI 分析请在接收手机的电脑上使用' }); return; }
    json(response, 200, ai.status()); return;
  }
  if (route === '/frame.jpg' || route === '/capture.jpg') {
    if (!fresh()) { send(response, 503, 'text/plain; charset=utf-8', '暂无新鲜摄像头画面'); return; }
    send(response, 200, 'image/jpeg', state.latest, route === '/capture.jpg'
      ? { 'Content-Disposition': `attachment; filename="camera-${Date.now()}.jpg"` } : {});
    return;
  }
  if (route === '/stream') {
    response.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-store' });
    response.flushHeaders(); viewers.add(response);
    if (fresh()) response.write(Buffer.concat([Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${state.latest.length}\r\n\r\n`), state.latest, Buffer.from('\r\n')]));
    response.on('close', () => viewers.delete(response));
    return;
  }
  if (route === '/receiver.zip') {
    const packagePath = path.join(__dirname, '局域网接收端.zip');
    if (!fs.existsSync(packagePath)) { send(response, 404, 'text/plain', 'Package not ready'); return; }
    response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': fs.statSync(packagePath).size, 'Content-Disposition': 'attachment; filename="camera-lan-receiver.zip"', 'Cache-Control': 'no-store' });
    fs.createReadStream(packagePath).pipe(response); return;
  }
  const files = { '/': 'index.html', '/camera': 'camera.html', '/webcam': 'webcam.html', '/ai': 'ai.html' };
  if (route === '/ai.js') { send(response, 200, 'text/javascript; charset=utf-8', fs.readFileSync(path.join(__dirname, 'ai-ui.js'))); return; }
  if (route === '/webcam' && !localControl) { send(response, 403, 'text/plain; charset=utf-8', '虚拟摄像头检测请在接收电脑打开'); return; }
  if (files[route]) { send(response, 200, 'text/html; charset=utf-8', fs.readFileSync(path.join(__dirname, files[route]))); return; }
  send(response, 404, 'text/plain', 'Not found');
}
const server = http.createServer(handleRequest);
server.listen(port, '127.0.0.1', () => {
  console.log(`USB 摄像头接收端：http://127.0.0.1:${port}`);
  if (initialPhone) connect(initialPhone);
});
server.on('error', err => { console.error(err.message); process.exitCode = 1; });

if (lanIP) {
  const sharedServer = http.createServer(handleRequest);
  sharedServer.listen(port, lanIP, () => {
    lanURL = `http://${lanIP}:${port}/`;
    console.log(`另一台电脑访问：${lanURL}`);
  });
  sharedServer.on('error', err => console.error('局域网共享不可用：' + err.message));
}

// The phone installation endpoint serves only the APK; LAN viewers cannot change the connection.
if (usbIP) {
  const installer = http.createServer((request, response) => {
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    if (request.url === '/' ) {
      send(response, 200, 'text/html; charset=utf-8', `<!doctype html><meta name="viewport" content="width=device-width"><h1>手机摄像头</h1><p><a href="/${apkName}">下载 Android IP Camera 0.14.0</a></p><p>安装后允许相机权限。在右上角 Settings → TLS Version 选择 TLS Disabled (HTTP only)，返回首页保持 App 打开，服务自动启动。</p><p>如果开启了 Enable Authentication，请在电脑接收页面填写手机中设置的用户名和密码，或在手机中关闭该选项。</p><p>保持 USB 网络共享开启。电脑会自动尝试接收画面。</p>`);
    } else if (request.url === '/' + apkName && fs.existsSync(path.join(__dirname, apkName))) {
      response.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive',
        'Content-Length': fs.statSync(path.join(__dirname, apkName)).size, 'Content-Disposition': `attachment; filename="${apkName}"` });
      fs.createReadStream(path.join(__dirname, apkName)).pipe(response);
    } else response.writeHead(404).end();
  });
  installer.listen(9891, usbIP, () => {
    installerURL = `http://${usbIP}:9891/`;
    console.log(`手机安装入口：${installerURL}`);
  });
  installer.on('error', err => console.error('手机安装入口不可用：' + err.message));
}
