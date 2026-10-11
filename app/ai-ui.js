'use strict';
const $ = id => document.getElementById(id);
let connected = false, active = false, sessionSeen = 0, lastSpoken = 0, voiceList = [], polling = false;
async function post(route, data = {}) {
  const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || '请求失败');
  return value;
}
function voices() {
  if (!('speechSynthesis' in window)) {
    $('voiceEnabled').checked = false; $('voiceEnabled').disabled = true; $('testVoice').disabled = true;
    $('voiceStatus').textContent = '当前浏览器不支持朗读；文字分析仍可正常使用。'; return;
  }
  const selected = $('voice').value;
  voiceList = speechSynthesis.getVoices();
  const chinese = voiceList.filter(voice => /^zh/i.test(voice.lang));
  const available = chinese.length ? chinese : voiceList;
  $('voice').replaceChildren(...available.map(voice => {
    const option = document.createElement('option'); option.value = voice.voiceURI;
    option.textContent = voice.name + ' · ' + voice.lang; return option;
  }));
  if (available.some(voice => voice.voiceURI === selected)) $('voice').value = selected;
  if (!available.length) $('voiceStatus').textContent = '尚未检测到朗读声音；可在 Windows 语言设置中安装中文语音。';
  else $('voiceStatus').textContent = '使用电脑 / 浏览器的朗读声音；语音服务是否联网取决于所选声音。';
}
function speak(text, force = false) {
  if (!('speechSynthesis' in window) || (!force && !$('voiceEnabled').checked)) return;
  // Replace obsolete speech instead of building a growing narration queue.
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'zh-CN'; utterance.rate = 1.05;
  utterance.voice = voiceList.find(voice => voice.voiceURI === $('voice').value) || null;
  utterance.onerror = event => { if (!['canceled', 'interrupted'].includes(event.error)) $('voiceStatus').textContent = '朗读失败，请选择其他声音或检查电脑语音设置。'; };
  speechSynthesis.speak(utterance);
}
voices(); if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', voices);
$('testVoice').onclick = () => speak('你好，我会观察手机摄像头，并读出分析结果。', true);
$('voiceEnabled').onchange = () => { if (!$('voiceEnabled').checked) window.speechSynthesis?.cancel(); };
function render(state) {
  active = state.running;
  if (state.completed < sessionSeen) lastSpoken = 0;
  sessionSeen = state.completed;
  $('start').disabled = active; $('stop').disabled = !active;
  for (const field of ['baseURL', 'model', 'protocol', 'apiKey', 'task', 'interval', 'sampleFPS']) $(field).disabled = active;
  $('aiState').textContent = ({ idle: '尚未开始 / 已停止', waiting: '等待新鲜画面序列…', analyzing: 'AI 正在分析最新片段…', watching: '持续观察中，等待下一轮…', error: '分析已停止' })[state.phase] || state.phase;
  $('error').textContent = state.error || '';
  $('draft').textContent = state.draft ? '正在生成：' + state.draft : '';
  $('history').replaceChildren(...[...state.history].reverse().map(item => {
    const entry = document.createElement('div'); entry.className = 'entry';
    const meta = document.createElement('small');
    meta.textContent = `${new Date(item.endAt).toLocaleTimeString()} 的画面 · ${item.frames} 帧 · 生成耗时 ${(item.elapsedMs / 1000).toFixed(1)} 秒`;
    const text = document.createElement('div'); text.textContent = item.text; entry.append(meta, text); return entry;
  }));
  const latest = state.history.at(-1);
  if (active && latest && latest.id > lastSpoken) { lastSpoken = latest.id; speak(latest.text); }
}
$('settings').onsubmit = async event => {
  event.preventDefault(); $('start').disabled = true; $('error').textContent = '';
  try {
    const settings = Object.fromEntries(['baseURL', 'model', 'protocol', 'apiKey', 'task', 'interval', 'sampleFPS'].map(id => [id, $(id).value]));
    const state = await post('/api/ai/start', settings); $('apiKey').value = ''; lastSpoken = 0; sessionSeen = 0; render(state);
  } catch (error) { $('error').textContent = error.message; $('start').disabled = false; }
};
$('stop').onclick = async () => {
  window.speechSynthesis?.cancel();
  try { render(await post('/api/ai/stop')); } catch (error) { $('error').textContent = error.message; }
};
async function poll() {
  if (polling) return; polling = true;
  try {
    const [cameraResponse, aiResponse] = await Promise.all([fetch('/api/status', { cache: 'no-store' }), fetch('/api/ai/status', { cache: 'no-store' })]);
    if (!cameraResponse.ok || !aiResponse.ok) throw Error('请在接收手机的电脑上打开本页');
    const [camera, ai] = await Promise.all([cameraResponse.json(), aiResponse.json()]);
    if (camera.connected && !connected) $('video').src = '/stream?t=' + Date.now();
    connected = camera.connected; $('offline').style.display = connected ? 'none' : 'grid';
    $('offline').textContent = camera.error || '请先在手机连接页面确认有画面。';
    $('cameraState').textContent = connected ? 'USB 直连 · ' + camera.fps + ' 帧/秒' : '等待手机连接';
    render(ai);
  } catch (error) { $('error').textContent = error.message; }
  finally { polling = false; setTimeout(poll, 700); }
}
poll();
setInterval(() => { if (active) post('/api/ai/heartbeat').catch(() => {}); }, 4000);
window.addEventListener('pagehide', () => {
  window.speechSynthesis?.cancel();
  if (active) fetch('/api/ai/stop', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
});
