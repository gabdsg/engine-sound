import { $ } from './dom.js';
import { IS_MOBILE } from '../sensors/live-sensors.js';

const SENS = IS_MOBILE ? { on: 'Enable sensors', off: 'Turn sensors off' } : { on: 'Enable GPS', off: 'Turn GPS off' };
// Platform wording, phone-only controls, and the enable / re-learn / flip buttons.
export function initSensorPanel(sensors) {
  $('sensorsModeName').textContent = IS_MOBILE ? 'Phone sensors' : 'Car GPS';
  $('sensBtn').textContent = SENS.on;
  $('sensorPanel').classList.toggle('no-imu', !IS_MOBILE);
  if (!IS_MOBILE) $('sensHint').textContent = 'Open this page in the car while parked, start the engine and tap Enable GPS. The car reports its speed about once a second, and acceleration and hills are worked out from it, so the engine follows about a second behind. Keep the page on screen while driving: location pauses when the browser is minimised.';
  if (sensors.embedded && /^https:/.test(location.href)) { const a = $('standaloneLink'); a.href = location.href; a.hidden = false; }
  $('sensBtn').addEventListener('click', async () => {
    const b = $('sensBtn');
    if (sensors.active) { sensors.stop(); b.textContent = SENS.on; return; }
    b.disabled = true; b.textContent = 'Waiting for permission…';
    try { await sensors.start(); } catch (e) { sensors.err = `Sensors couldn’t start: ${e && e.message ? e.message : e}`; }
    b.disabled = false;
    b.textContent = sensors.active ? SENS.off : SENS.on;
  });
  $('relearnBtn').addEventListener('click', () => sensors.relearn());
  $('flipBtn').addEventListener('click', () => sensors.flip());
}

let rateMark = performance.now(), lastMotionCount = 0, lastGpsCount = 0, motionHz = 0, gpsHz = 0;
export function updateSensorUI(sensors, now, toUnits, unit) {
  if (now - rateMark > 1000) {
    const s = (now - rateMark) / 1000;
    motionHz = (sensors.motionCount - lastMotionCount) / s; gpsHz = (sensors.gpsCount - lastGpsCount) / s;
    lastMotionCount = sensors.motionCount; lastGpsCount = sensors.gpsCount; rateMark = now;
  }
  const S = sensors, G = S.gps;
  $('rMotion').textContent = !S.active ? 'Off' : S.gotMotion ? `${Math.round(motionHz)} Hz, ${S.osLinear ? 'OS fused' : 'gravity filtered'}` : 'Waiting';
  $('rGps').textContent = !S.active ? 'Off' : S.gpsCount ? `${gpsHz.toFixed(1)} Hz, ±${Math.round(S.gpsAcc || 0)} m` : 'Waiting for a fix';
  $('rSrc').textContent = !S.active ? '–' : S.useImu ? 'Accelerometer + GPS'
    : G.source === 'reported' ? (IS_MOBILE ? 'GPS speed' : 'Car’s speed')
    : G.source === 'positions' ? (G.speedUnusable ? 'Positions (reported speed stuck at 0)' : 'Positions (no speed reported)') : 'Waiting';
  $('rAxis').textContent = S.fwd ? (S.autoFlipped ? 'Locked, corrected by GPS' : 'Locked') : S.learnT > 0 ? 'Learning' : 'Not set';
  $('rAccel').textContent = S.active ? `${(S.aUsed / 9.81).toFixed(2)} g` : '–';
  $('rGrade').textContent = !S.active ? '–' : !G.hasAlt ? 'No altitude yet' : !G.gradeReady ? 'Measuring' : `${G.grade >= 0 ? '+' : ''}${(G.grade * 100).toFixed(1)}%`;
  $('rVg').textContent = S.gpsV != null ? `${toUnits(S.gpsV).toFixed(1)} ${unit}` : '–';
  $('rVf').textContent = S.active ? `${toUnits(S.vUsed).toFixed(1)} ${unit}` : '–';
  $('rThr').textContent = S.active ? `${Math.round(S.thr * 100)}%` : '–';
  $('rStill').textContent = !S.active ? '–' : (S.imu && S.gotMotion ? S.still : S.vUsed < 0.5) ? 'Yes' : 'No';
  $('rPerm').textContent = S.active ? S.permission : '–';
  $('rCtx').textContent = S.embedded ? 'Embedded frame' : 'Top-level page';
  let msg = '';
  if (!S.active) {
    msg = S.permission === 'Asking'
      ? 'Waiting for you to allow motion access. Tap Allow in the prompt.'
      : S.err || (IS_MOBILE ? 'Sensors are off. Tap Enable sensors, then allow motion and location access when asked.' : 'GPS is off. Tap Enable GPS, then allow location access when asked.');
  } else if (S.gpsDenied) msg = S.gpsErr;
  else if (G.lost(now / 1000)) msg = `No GPS update for ${Math.round(now / 1000 - G.tArr)} s, so the engine is easing back to idle. Keep this page on screen: location pauses while the browser is minimised.`;
  else if (S.imu && !S.gotMotion && now - S.startedAt > 2500) {
    msg = S.embedded
      ? 'No motion data. This page is running inside an embedded frame, and current iOS drops motion events in frames even after you tap Allow. Open the page from its own HTTPS address to use the sensors.'
      : (S.err || 'No motion data is arriving, so speed and throttle come from GPS alone. To use the accelerometer, reload the page, enable sensors again and tap Allow when asked.');
  } else if (S.err) msg = S.err;
  else if (S.gpsErr && !(S.lastFixAt && now - S.lastFixAt < 3000)) msg = S.gpsErr;
  else if (G.speedUnusable) msg = 'This car reports its speed as 0 while moving, so speed is worked out from GPS positions instead. Expect the engine to trail the car by two seconds or so.';
  $('sensAlert').hidden = !msg; $('sensAlert').textContent = msg || '';
}
export function drawChart(hist, toUnits) {
  const c = $('chart'), dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (!w) return;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  const cs = getComputedStyle(document.documentElement);
  const col = (n) => cs.getPropertyValue(n).trim();
  let vmax = 10;
  for (const p of hist) vmax = Math.max(vmax, toUnits(p.g || 0), toUnits(p.f));
  vmax *= 1.15;
  const pad = 8, H = h - pad * 2;
  x.strokeStyle = col('--line'); x.lineWidth = 1; x.fillStyle = col('--muted'); x.font = '11px Saira, system-ui, sans-serif';
  const step = vmax > 120 ? 50 : vmax > 50 ? 20 : 10;
  for (let v = 0; v <= vmax; v += step) { const y = pad + H - v / vmax * H; x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke(); x.fillText(String(v), 4, y - 3); }
  const N = 300, line = (sel, color, scale) => {
    x.strokeStyle = color; x.lineWidth = 2; x.beginPath(); let started = false;
    hist.forEach((p, i) => { const val = sel(p); if (val == null) { started = false; return; } const X = (i + N - hist.length) / (N - 1) * w, Y = pad + H - scale(val) * H; if (!started) { x.moveTo(X, Y); started = true; } else x.lineTo(X, Y); });
    x.stroke();
  };
  line(p => p.t, col('--amber'), v => v);
  line(p => p.g, col('--gps'), v => toUnits(v) / vmax);
  line(p => p.f, col('--needle'), v => toUnits(v) / vmax);
}
