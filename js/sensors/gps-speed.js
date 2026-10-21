// Speed, acceleration and road grade from position fixes: the reported speed when it is usable,
// otherwise distance between fixes. Works the same for the Tesla browser and phones.
const GPS_LAG = 0.45; // seconds GPS speed trails reality; corrections compare against fused speed this long ago
const CAR_GPS_LAG = 0.8; // seconds the Tesla browser's speed trails the car (fixes arrive about 1 Hz, about 1 s late)
const POS_GPS_LAG = 2.5; // speed from positions averages over a few seconds, so it trails further
function haversine(a, b) {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export class GpsSpeed {
  constructor() { this.reset(); }
  reset() {
    this.v = null; this.a = 0; this.tArr = 0; this.lag = CAR_GPS_LAG;
    this.prev = null; this.ref = null; this.track = [];
    this.source = ''; this.speedSeen = false; this.zeroVotes = 0; this.speedUnusable = false;
    this.dist = 0; this.hLp = null; this.alt = []; this.grade = 0; this.hasAlt = false; this.gradeReady = false;
  }
  // One fix in, { v, t, lag } out (t in performance.now() seconds), or null when it carries nothing new.
  add(p) {
    const c = p.coords, arr = performance.now() / 1000, stamp = Number(p.timestamp) || 0;
    if (!isFinite(c.latitude) || !isFinite(c.longitude)) return null;
    let spd = c.speed;
    if (spd == null || !isFinite(spd) || spd < 0) spd = null;
    const prev = this.prev, pos = { lat: c.latitude, lon: c.longitude };
    const moved = !prev || pos.lat !== prev.lat || pos.lon !== prev.lon;
    // The Tesla browser replays cached fixes; one with the same stamp, place and speed is no news.
    // It can also replay cached coordinates while the speed stays live, so those are kept.
    if (prev && stamp === prev.stamp && !moved && spd === prev.spd) return null;
    // Time between fixes from their own stamps while those advance, from arrival when they freeze.
    const dt = prev ? Math.min(10, Math.max(0.05, stamp > prev.stamp ? (stamp - prev.stamp) / 1000 : arr - prev.arr)) : 0;
    const clock = prev ? prev.clock + dt : 0;
    this.prev = { ...pos, stamp, arr, spd, clock };

    // speed from positions: straight-line distance over the last ~5 s, so parked jitter averages out
    if (moved) { this.track.push({ ...pos, clock }); while (this.track.length > 2 && clock - this.track[0].clock > 12) this.track.shift(); }
    let vPos = null;
    if (this.track.length > 1) {
      const end = this.track[this.track.length - 1];
      const ref = this.track.find(q => q !== end && clock - q.clock <= 5) || this.track[this.track.length - 2];
      const span = clock - ref.clock, d = haversine(ref, end);
      if (span >= 1) vPos = d < 3 ? 0 : d / span;
    }
    // Older Teslas report a speed of 0, or none, while moving. If positions disagree three fixes
    // running and the speed has never been non-zero, stop trusting it for this session.
    if (spd != null && spd > 0.5) this.speedSeen = true;
    if (!this.speedSeen && !this.speedUnusable && vPos != null && vPos > 3 && spd === 0) { if (++this.zeroVotes >= 3) this.speedUnusable = true; }
    else if (vPos != null && vPos < 1) this.zeroVotes = 0;
    const useReported = spd != null && !this.speedUnusable;
    const vm = useReported ? spd : vPos;
    this.source = useReported ? 'reported' : vPos != null ? 'positions' : '';
    if (vm == null) return null;

    // acceleration from speed changes at least 0.5 s apart
    if (vm < 0.3 || !this.ref || clock - this.ref.clock > 4) { this.a = 0; this.ref = { v: vm, clock }; }
    else if (clock - this.ref.clock >= 0.5) {
      const span = clock - this.ref.clock, aRaw = Math.max(-10, Math.min(8, (vm - this.ref.v) / span));
      this.a += (aRaw - this.a) * (1 - Math.exp(-span / (useReported ? 0.4 : 2)));
      this.ref = { v: vm, clock };
    }

    // road grade: filtered altitude change over the last 100–150 m travelled
    this.dist += (this.v == null ? vm : (this.v + vm) / 2) * dt;
    const h = c.altitude;
    if (moved && h != null && isFinite(h) && !(c.altitudeAccuracy > 20)) {
      this.hasAlt = true;
      this.hLp = this.hLp == null ? h : this.hLp + (h - this.hLp) * (1 - Math.exp(-dt / 3));
      this.alt.push([this.dist, this.hLp]);
      while (this.alt.length > 2 && this.dist - this.alt[1][0] > 150) this.alt.shift();
      const run = this.dist - this.alt[0][0];
      if (vm > 2 && run >= 100) {
        const g = Math.max(-0.15, Math.min(0.15, (this.hLp - this.alt[0][1]) / run));
        this.grade += (g - this.grade) * (1 - Math.exp(-dt / 4));
        this.gradeReady = true;
      }
    }

    this.v = vm; this.tArr = arr; this.lag = useReported ? CAR_GPS_LAG : POS_GPS_LAG;
    return { v: vm, t: arr, lag: useReported ? GPS_LAG : POS_GPS_LAG };
  }
  // Speed now: the last fix carried forward by its acceleration, levelling off so a lift doesn't overshoot.
  speedAt(now) {
    if (this.v == null) return 0;
    const gap = now - this.tArr;
    let v = this.v + this.a * 0.6 * (1 - Math.exp(-(gap + this.lag) / 0.6));
    if (gap > 20) v *= Math.max(0, 1 - (gap - 20) / 10); // GPS lost: ease back to idle
    return Math.max(0, v);
  }
  // parked phones and cars may stop sending fresh fixes, so silence only counts as lost while moving
  lost(now) { return this.v != null && this.v > 0.5 && now - this.tArr > 20; }
}
