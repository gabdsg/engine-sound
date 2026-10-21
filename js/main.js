import { $ } from './ui/dom.js';
import { PRESETS, buildCfg } from './audio/presets.js';
import { initAudio, sendDSP, setVolume, unlockSilentSwitch, pauseSilent, onAudioInfo } from './audio/output.js';
import { Car } from './sim/car.js';
import { Drivetrain } from './sim/drivetrain.js';
import { demoAt } from './sim/demo.js';
import { LiveSensors } from './sensors/live-sensors.js';
import { buildTach, setNeedle } from './ui/tach.js';
import { initSensorPanel, updateSensorUI, drawChart } from './ui/sensor-panel.js';

// index.html loads this file as main.js?v=N; N is the build shown under the gauge.
const BUILD = new URL(import.meta.url).searchParams.get('v') || 'dev';

// ---------- App state ----------
const tune = { vol: 0.8, char: 0.5, crackle: 0.35, aggr: 0.5 };
const state = { mode: 'pedals', running: false, neutral: false, demoT: null, units: 'kmh' };
const input = { gas: 0, brake: 0, kGas: 0, kBrake: 0, rev: false, kRev: 0 };
const keys = { gas: false, brake: false };
const car = new Car(), drive = new Drivetrain(), sensors = new LiveSensors();
let preset = PRESETS[0];
const hist = [];

// ---------- Presets UI ----------
function renderPresets() {
  const wrap = $('presets'); wrap.textContent = '';
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.className = 'preset'; b.type = 'button';
    b.setAttribute('aria-pressed', p === preset ? 'true' : 'false');
    b.innerHTML = `<strong></strong><span></span>`;
    b.querySelector('strong').textContent = p.name;
    b.querySelector('span').textContent = p.desc;
    b.addEventListener('click', () => selectPreset(p));
    wrap.appendChild(b);
  }
}
function selectPreset(p) {
  preset = p;
  sendDSP({ cfg: buildCfg(p) });
  if (drive.running && p.type === 'ice' && drive.rpm > p.redline) drive.rpm = p.idle;
  buildTach(p); renderPresets();
}

// ---------- Engine control ----------
let wake = null;
async function requestWake() { try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch (e) {} }
function releaseWake() { try { if (wake) wake.release(); } catch (e) {} wake = null; }
// Both steps must run inside the tap that starts the engine.
async function startAudio() { unlockSilentSwitch(); await initAudio({ volume: tune.vol, cfg: buildCfg(preset) }); }
function startEngine() {
  state.running = true; drive.start();
  $('startBtn').textContent = 'Stop engine'; $('startBtn').setAttribute('aria-pressed', 'true');
  document.body.classList.add('running');
  requestWake();
}
function stopEngine() {
  state.running = false; drive.stop(); stopDemo(); pauseSilent();
  $('startBtn').textContent = 'Start engine'; $('startBtn').setAttribute('aria-pressed', 'false');
  document.body.classList.remove('running');
  releaseWake();
}
$('startBtn').addEventListener('click', async () => {
  if (state.running) { stopEngine(); return; }
  try { await startAudio(); } catch (e) { $('status').textContent = 'Audio couldn’t start in this browser.'; return; }
  startEngine();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { if (state.running) requestWake(); }
  // hidden pages get no animation frames (and no GPS), so settle at idle instead of droning at the last revs
  else if (state.running) sendDSP({ tRpm: preset.type === 'ice' ? preset.idle : 0, tLoad: 0.15, overrun: 0, cut: 0, motorHz: 0 });
});
onAudioInfo((text) => { $('audioInfo').textContent = [text, `Build ${BUILD}`].join('. '); });

// ---------- Demo ----------
function stopDemo() { state.demoT = null; $('demoBtn').textContent = 'Play demo run'; }
$('demoBtn').addEventListener('click', async () => {
  if (state.demoT !== null) { stopDemo(); return; }
  if (!state.running) { try { await startAudio(); } catch (e) { return; } startEngine(); }
  car.v = 0;
  state.demoT = drive.startT >= 0 ? -(2.3 - drive.startT) : 0;
  $('demoBtn').textContent = 'Stop demo';
});

// ---------- Pedals ----------
function bindPedal(el, key) {
  let active = false;
  const setFrom = (e) => {
    const r = el.getBoundingClientRect();
    input[key] = Math.min(1, Math.max(0.05, (r.bottom - e.clientY) / r.height * 1.15));
  };
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); active = true; setFrom(e); e.preventDefault(); });
  el.addEventListener('pointermove', (e) => { if (active) setFrom(e); });
  const end = () => { active = false; input[key] = 0; };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
  el.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { input[key] = 1; e.preventDefault(); } });
  el.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') input[key] = 0; });
}
bindPedal($('gasPedal'), 'gas');
bindPedal($('brakePedal'), 'brake');
function setNeutral(on) { state.neutral = on; $('neutralBtn').setAttribute('aria-pressed', on ? 'true' : 'false'); }
$('neutralBtn').addEventListener('click', () => setNeutral(!state.neutral));
const isTyping = (e) => e.target && (e.target.tagName === 'INPUT' && e.target.type !== 'radio' && e.target.type !== 'range');
window.addEventListener('keydown', (e) => {
  if (isTyping(e)) return;
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { keys.gas = true; e.preventDefault(); }
  else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { keys.brake = true; e.preventDefault(); }
  else if ((e.key === 'n' || e.key === 'N') && !e.repeat) setNeutral(!state.neutral);
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') keys.gas = false;
  else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') keys.brake = false;
});
window.addEventListener('blur', () => { keys.gas = keys.brake = false; input.gas = input.brake = 0; setRevHeld(false); });

// ---------- Rev button: hold to rev as if in neutral, offered only while stopped ----------
const revBtn = $('revBtn');
let revOn = false;
function setRevHeld(held) { input.rev = held; revBtn.setAttribute('aria-pressed', held ? 'true' : 'false'); }
revBtn.addEventListener('pointerdown', (e) => { if (!revOn) return; revBtn.setPointerCapture(e.pointerId); setRevHeld(true); e.preventDefault(); });
for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) revBtn.addEventListener(t, () => setRevHeld(false));
revBtn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && revOn) { setRevHeld(true); e.preventDefault(); } });
revBtn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') setRevHeld(false); });
revBtn.addEventListener('contextmenu', (e) => e.preventDefault()); // long-press menu on touch screens
function updateRev(v) {
  // hysteresis, so GPS noise at a standstill doesn't make the button flicker
  const stopped = revOn ? v < 1 : v < 0.3;
  const on = state.running && drive.startT < 0 && state.demoT === null && preset.type === 'ice' && stopped;
  if (on === revOn) return;
  revOn = on; revBtn.classList.toggle('is-off', !on); revBtn.disabled = !on;
  if (!on) setRevHeld(false);
}

// ---------- Gauge-only view ----------
const FOCUS_KEY = 'engine-synth:gauge-only';
function setFocus(on) {
  document.body.classList.toggle('focus', on);
  $('focusBtn').textContent = on ? 'Show controls' : 'Gauge only';
  $('focusBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
  try { localStorage.setItem(FOCUS_KEY, on ? '1' : '0'); } catch (e) {}
}
$('focusBtn').addEventListener('click', () => setFocus(!document.body.classList.contains('focus')));

// ---------- Mode ----------
document.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener('change', () => {
  state.mode = r.value;
  $('pedalPanel').hidden = state.mode !== 'pedals';
  $('sensorPanel').hidden = state.mode !== 'sensors';
  stopDemo();
  car.v = state.mode === 'pedals' ? 0 : car.v;
}));

// ---------- Tuning ----------
function bindSlider(id, key, onChange) {
  const el = $(id), out = $(id + 'Out');
  const upd = () => { tune[key] = el.value / 100; out.textContent = el.value + '%'; if (onChange) onChange(); };
  el.addEventListener('input', upd); upd();
}
bindSlider('vol', 'vol', () => setVolume(tune.vol));
bindSlider('char', 'char'); bindSlider('crackle', 'crackle'); bindSlider('aggr', 'aggr');
document.querySelectorAll('input[name="units"]').forEach(r => r.addEventListener('change', () => { state.units = r.value; $('speedUnit').textContent = r.value === 'mph' ? 'mph' : 'km/h'; }));
const toUnits = (ms) => state.units === 'mph' ? ms * 2.23694 : ms * 3.6;
const unitLabel = () => state.units === 'mph' ? 'mph' : 'km/h';

// ---------- Main loop ----------
let last = performance.now(), slowT = 0;
function tick(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
  input.kGas += ((keys.gas ? 1 : 0) - input.kGas) * Math.min(1, dt * 8);
  input.kBrake += ((keys.brake ? 1 : 0) - input.kBrake) * Math.min(1, dt * 8);
  input.kRev += ((input.rev && revOn ? 1 : 0) - input.kRev) * Math.min(1, dt * 8);
  const revving = input.kRev > 0.01;
  let thr = Math.max(input.gas, input.kGas), brk = Math.max(input.brake, input.kBrake), neutral = state.neutral, v;
  if (state.mode === 'sensors') {
    const s = sensors.read(dt, tune.aggr); v = s.v; thr = s.thr; brk = 0; neutral = false;
    if (revving) { thr = Math.max(thr, input.kRev); neutral = true; }
  } else {
    if (state.demoT !== null) {
      state.demoT += dt;
      if (state.demoT < 0) { thr = 0; brk = 0; neutral = true; }
      else { const k = demoAt(state.demoT); if (k) { thr = k.thr; brk = k.brk; neutral = k.neutral; } else stopDemo(); }
    }
    if (revving) { thr = Math.max(thr, input.kRev); neutral = true; }
    car.update(dt, neutral ? 0 : thr, brk);
    v = car.v;
  }
  const d = drive.update(dt, v, thr, preset, { aggression: tune.aggr, neutral });
  sendDSP({ tRpm: d.rpm, tLoad: d.load, overrun: d.overrun ? 1 : 0, cut: d.cut ? 1 : 0, motorHz: d.motorHz, on: state.running ? 1 : 0, character: tune.char, crackle: tune.crackle });
  updateRev(v);

  setNeedle(d.tach);
  $('speedText').textContent = Math.round(toUnits(v));
  $('gearText').textContent = state.running ? d.gear : '–';
  $('gasPedal').firstElementChild.style.transform = `scaleY(${state.mode === 'pedals' ? thr : 0})`;
  $('brakePedal').firstElementChild.style.transform = `scaleY(${state.mode === 'pedals' ? brk : 0})`;

  slowT += dt;
  if (slowT > 0.1) {
    slowT = 0;
    $('gasPedal').setAttribute('aria-valuenow', Math.round(thr * 100));
    $('brakePedal').setAttribute('aria-valuenow', Math.round(brk * 100));
    $('status').textContent = !state.running ? 'Engine off' : drive.startT >= 0 ? 'Starting' : state.demoT !== null ? 'Demo run playing' : `${Math.round(d.rpm)} rpm`;
    if (state.mode === 'sensors') {
      updateSensorUI(sensors, now, toUnits, unitLabel());
      hist.push({ g: sensors.gpsV, f: sensors.vUsed, t: sensors.thr });
      if (hist.length > 300) hist.shift();
      drawChart(hist, toUnits);
    }
  }
  requestAnimationFrame(tick);
}

renderPresets(); buildTach(preset);
initSensorPanel(sensors);
$('audioInfo').textContent = `Build ${BUILD}`;
let savedFocus = false;
try { savedFocus = localStorage.getItem(FOCUS_KEY) === '1'; } catch (e) {}
setFocus(savedFocus);
requestAnimationFrame(tick);
