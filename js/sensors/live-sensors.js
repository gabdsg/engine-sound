import { GpsSpeed } from './gps-speed.js';

// Phones fuse the accelerometer with GPS. Everything else (the Tesla browser, desktops) has no motion
// sensor, so speed comes from GPS alone: the car's own reported speed when it is usable, otherwise the
// distance between fixes. Acceleration and road grade are derived from the fixes in both cases.
export const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export class LiveSensors {
  constructor() {
    this.imu = IS_MOBILE; this.gps = new GpsSpeed(); this.vOut = 0; this.useImu = false; this.aUsed = 0; this.vUsed = 0;
    this.active = false; this.grav = null; this.fwd = null;
    this.v = 0; this.aLp = 0; this.aLong = 0; this.bias = 0; this.thr = 0;
    this.gpsV = null; this.gpsT = 0; this.gpsAcc = null; this.gpsCount = 0; this.lastFixAt = 0;
    this.learnSum = [0, 0, 0]; this.learnT = 0;
    this.motionCount = 0; this.lastT = 0; this.gotMotion = false; this.osLinear = false;
    this.magMean = 9.8; this.magVar = 0; this.stillT = 0; this.still = false;
    this.flipVotes = 0; this.autoFlipped = false; this.aAcc = 0; this.aAccT = 0;
    this.hist = []; this.histT = 0;
    this.err = ''; this.gpsErr = ''; this.watchId = null; this.pollTimer = null; this.session = 0;
    this.startedAt = 0; this.permission = 'Not asked';
    this.embedded = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
    this.onMotion = this.onMotion.bind(this); this.onPos = this.onPos.bind(this); this.onPosErr = this.onPosErr.bind(this);
  }
  async start() {
    this.err = ''; this.gpsErr = ''; this.gpsDenied = false; this.gps.reset(); this.vOut = 0; this.gpsV = null; this.gpsT = 0; this.gpsCount = 0;
    const sid = ++this.session;
    if (this.imu) {
      if (typeof DeviceMotionEvent === 'undefined') { this.permission = 'No motion API'; this.err = 'This browser doesn’t expose motion sensors, so speed and throttle come from GPS alone.'; }
      else if (typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
          this.permission = 'Asking';
          const r = await DeviceMotionEvent.requestPermission();
          this.permission = r === 'granted' ? 'Granted' : 'Denied';
          if (r !== 'granted') this.err = 'Motion access was denied, so speed and throttle come from GPS alone. To use the accelerometer, close the tab, open the page again and tap Allow when asked.';
        } catch (e) { this.permission = 'Error'; this.err = `The motion permission request failed: ${e && e.message ? e.message : e}`; }
      } else this.permission = 'Not required';
      window.addEventListener('devicemotion', this.onMotion);
    }
    if (!('geolocation' in navigator)) this.err = this.imu ? 'This browser doesn’t offer location, so speed comes from the accelerometer alone and will drift.' : 'This browser doesn’t offer location, so there is nothing to drive the engine.';
    else if (this.imu) this.watchId = navigator.geolocation.watchPosition(this.onPos, this.onPosErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    else this.poll(sid);
    this.active = true; this.startedAt = performance.now();
  }
  // Without motion sensors this is most likely the Tesla browser, where watchPosition has been reported
  // to crash the tab. One getCurrentPosition at a time is the safer pattern; the car answers about 1 Hz.
  poll(sid) {
    if (sid !== this.session) return;
    const t0 = performance.now();
    const next = () => { if (sid === this.session) this.pollTimer = setTimeout(() => this.poll(sid), Math.max(0, 250 - (performance.now() - t0))); };
    navigator.geolocation.getCurrentPosition(
      (p) => { if (sid === this.session) { this.onPos(p); next(); } },
      (e) => { if (sid === this.session) { this.onPosErr(e); if (e.code !== 1) next(); } },
      { enableHighAccuracy: false, maximumAge: 0, timeout: 2000 });
  }
  stop() {
    window.removeEventListener('devicemotion', this.onMotion);
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    clearTimeout(this.pollTimer); this.session++;
    this.watchId = null; this.active = false; this.err = ''; this.gpsErr = '';
  }
  relearn() { this.fwd = null; this.learnSum = [0, 0, 0]; this.learnT = 0; this.autoFlipped = false; this.flipVotes = 0; }
  flip() { if (this.fwd) this.fwd = this.fwd.map(x => -x); }
  onMotion(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null) return;
    this.gotMotion = true; this.motionCount++;
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, Math.max(0.001, this.lastT ? now - this.lastT : 0.016));
    this.lastT = now;
    const G = [g.x, g.y, g.z];
    const mag = Math.hypot(G[0], G[1], G[2]);
    const km = 1 - Math.exp(-dt / 0.4);
    this.magMean += (mag - this.magMean) * km;
    this.magVar += ((mag - this.magMean) * (mag - this.magMean) - this.magVar) * km;
    this.stillT = Math.sqrt(this.magVar) < 0.12 ? this.stillT + dt : 0;
    this.still = this.stillT > 0.8;
    // gravity: track fast while still, almost frozen while moving so sustained acceleration isn't absorbed
    if (!this.grav) this.grav = G.slice();
    const kg = 1 - Math.exp(-dt / (this.still ? 0.3 : 20));
    for (let i = 0; i < 3; i++) this.grav[i] += (G[i] - this.grav[i]) * kg;
    const gl = Math.hypot(this.grav[0], this.grav[1], this.grav[2]) || 1;
    const gn = [this.grav[0] / gl, this.grav[1] / gl, this.grav[2] / gl];
    const la = e.acceleration;
    let lin;
    if (la && la.x != null) { lin = [la.x, la.y, la.z]; this.osLinear = true; }
    else { lin = [G[0] - this.grav[0], G[1] - this.grav[1], G[2] - this.grav[2]]; this.osLinear = false; }
    const d = lin[0] * gn[0] + lin[1] * gn[1] + lin[2] * gn[2];
    const h = [lin[0] - d * gn[0], lin[1] - d * gn[1], lin[2] - d * gn[2]];
    const hm = Math.hypot(h[0], h[1], h[2]);
    if (!this.fwd) {
      if (hm > 1.1) {
        for (let i = 0; i < 3; i++) this.learnSum[i] += h[i] * dt;
        this.learnT += dt;
        if (this.learnT > 0.7) {
          const s = this.learnSum, sd = s[0] * gn[0] + s[1] * gn[1] + s[2] * gn[2];
          const f = [s[0] - sd * gn[0], s[1] - sd * gn[1], s[2] - sd * gn[2]];
          const fl = Math.hypot(f[0], f[1], f[2]);
          if (fl > 0) {
            this.fwd = f.map(x => x / fl);
            // back-fill the speed gained while the axis was being learned
            this.v = Math.max(0, this.v + (s[0] * this.fwd[0] + s[1] * this.fwd[1] + s[2] * this.fwd[2]));
          }
        }
      } else if (this.learnT > 0) {
        this.learnT = Math.max(0, this.learnT - dt * 3);
        if (this.learnT === 0) this.learnSum = [0, 0, 0];
      }
    }
    const al = this.fwd ? h[0] * this.fwd[0] + h[1] * this.fwd[1] + h[2] * this.fwd[2] : 0;
    this.aLp += (al - this.aLp) * (1 - Math.exp(-dt / 0.08));
    const stopped = this.still && (this.gpsV != null ? this.gpsV < 0.7 : this.v < 2);
    if (stopped) {
      this.bias += (this.aLp - this.bias) * (1 - Math.exp(-dt / 1.0));
      this.v *= Math.exp(-dt / 0.15);
      if (this.v < 0.05) this.v = 0;
    }
    this.aLong = this.aLp - this.bias;
    if (this.fwd) this.v = Math.max(0, this.v + this.aLong * dt);
    this.aAcc += this.aLong * dt; this.aAccT += dt;
    if (now - this.histT > 0.05) { this.hist.push([now, this.v]); this.histT = now; if (this.hist.length > 120) this.hist.shift(); }
  }
  vAt(t) {
    let best = null, bd = Infinity;
    for (const [ht, hv] of this.hist) { const dd = Math.abs(ht - t); if (dd < bd) { bd = dd; best = hv; } }
    return bd < 0.3 ? best : this.v;
  }
  onPos(p) {
    const m = this.gps.add(p);
    this.gpsAcc = p.coords.accuracy; this.gpsErr = '';
    if (!m) return;
    this.gpsCount++; this.lastFixAt = performance.now();
    const now = m.t, s = m.v;
    if (this.gpsV != null && this.gpsT && this.fwd && this.aAccT > 0.2) {
      const dt = now - this.gpsT;
      if (dt > 0.3 && dt < 3) {
        const dv = (s - this.gpsV) / dt, am = this.aAcc / this.aAccT;
        if (Math.abs(dv) > 0.7 && Math.abs(am) > 0.4) {
          if (Math.sign(dv) !== Math.sign(am)) this.flipVotes++; else this.flipVotes = Math.max(0, this.flipVotes - 1);
          if (this.flipVotes >= 3) { this.flip(); this.flipVotes = 0; this.autoFlipped = true; }
        }
      }
    }
    this.aAcc = 0; this.aAccT = 0;
    this.gpsV = s; this.gpsT = now;
    if (this.fwd && this.gotMotion) this.v = Math.max(0, this.v + (s - this.vAt(now - m.lag)) * 0.5);
    else this.v = s;
  }
  onPosErr(e) {
    this.gpsErr = e.code === 1 ? (this.embedded ? 'Location is blocked because this page is running inside an embedded frame. Open it from its own address.' : 'Location access was denied. Allow location for this site so GPS can measure the speed.') : 'GPS isn’t reporting yet. Make sure location services are on and you have sky view.';
    this.gpsDenied = e.code === 1;
  }
  read(dt, ag) {
    if (!this.active) { this.thr += (0 - this.thr) * Math.min(1, dt / 0.08); return { v: 0, thr: this.thr }; }
    this.vOut += (this.gps.speedAt(performance.now() / 1000) - this.vOut) * Math.min(1, dt / 0.25);
    // the accelerometer path needs motion data and a learned forward axis; until then GPS drives alone
    this.useImu = this.imu && this.gotMotion && !!this.fwd;
    const v = this.useImu ? this.v : this.vOut, a = this.useImu ? this.aLong : this.gps.a;
    const aMax = Math.min(5.4, 165 / Math.max(v, 2));
    const resist = v > 0.3 ? 0.12 + 0.00042 * v * v : 0;
    const need = a + resist + (v > 1 ? 9.81 * this.gps.grade : 0); // what the engine has to supply, m/s²
    let t = need / (aMax * (1 - 0.6 * ag));
    if (a < -0.25 || need < 0) t = 0;        // braking, or rolling downhill: overrun
    else if (v > 2) t = Math.max(t, 0.08);   // holding speed is light load, not a lift-off
    t = Math.min(1, Math.max(0, t));
    // GPS acceleration changes in steps once a second, so it gets a slower glide than the accelerometer
    this.thr += (t - this.thr) * Math.min(1, dt / (this.useImu ? 0.08 : 0.35));
    this.aUsed = a; this.vUsed = v;
    return { v, thr: this.thr };
  }
}
