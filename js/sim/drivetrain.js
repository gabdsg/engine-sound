// Virtual gearbox: speed + throttle -> rpm, load, shifts
const CIRC = 2 * Math.PI * 0.34; // driven wheel circumference, m

export class Drivetrain {
  constructor() { this.reset(); }
  reset() { this.gear = 1; this.rpm = 0; this.shiftT = 0; this.blipT = 0; this.cut = false; this.cutT = 0; this.startT = -1; this.running = false; }
  start() { this.running = true; this.startT = 0; this.gear = 1; }
  stop() { this.running = false; this.startT = -1; }
  gearRpm(v, g, p) { return v / CIRC * 60 * p.gears[g - 1] * p.final; }
  update(dt, v, thr, p, o) {
    const out = { rpm: 0, load: 0, overrun: false, cut: false, gear: '–', motorHz: 0, tach: 0 };
    if (!this.running) {
      this.rpm = Math.max(0, this.rpm - 3000 * dt);
      out.rpm = out.tach = this.rpm;
      return out;
    }
    if (p.type === 'ev') {
      this.startT = -1;
      out.motorHz = v * 3.6 * 7;
      out.load = thr; out.tach = v * 3.6 * 70; out.gear = 'D';
      out.overrun = thr < 0.05;
      this.rpm = out.rpm = out.tach;
      return out;
    }
    if (this.gear > p.gears.length) this.gear = p.gears.length;
    if (this.startT >= 0) {
      this.startT += dt;
      const t = this.startT;
      let r, l;
      if (t < 0.7) { r = 180 + 60 * Math.sin(t * 40); l = 0.15; }
      else if (t < 1.1) { r = p.idle * 1.8; l = 0.6; }
      else if (t < 2.2) { r = p.idle * (1.8 - 0.8 * (t - 1.1) / 1.1); l = 0.25; }
      else { this.startT = -1; r = p.idle; l = 0.2; }
      this.rpm += (r - this.rpm) * Math.min(1, dt * (t < 0.7 ? 20 : 6));
      out.rpm = out.tach = this.rpm; out.load = l; out.gear = 'N';
      return out;
    }
    const ag = o.aggression, n = p.gears.length, neutral = o.neutral;
    const up = p.redline * (0.42 + 0.55 * Math.min(1, thr * (0.55 + 0.9 * ag)));
    const down = p.idle * 1.45 + thr * p.redline * 0.22;
    if (!neutral && v > 0.5) {
      if (this.shiftT <= 0) {
        const r = this.gearRpm(v, this.gear, p);
        if (r > up && this.gear < n) this.shiftT = 0.07 + 0.2 * (1 - ag);
        else if (this.gear > 1 && r < down) { this.gear--; this.blipT = 0.14; }
        else if (thr > 0.92 && this.gear > 1 && r < p.redline * 0.55 && this.gearRpm(v, this.gear - 1, p) < up * 0.9) { this.gear--; this.blipT = 0.12; }
      } else {
        this.shiftT -= dt;
        if (this.shiftT <= 0) { this.shiftT = 0; this.gear = Math.min(n, this.gear + 1); }
      }
    } else if (!neutral) { this.gear = 1; this.shiftT = 0; }

    let target, load = thr;
    const shifting = this.shiftT > 0;
    if (neutral) target = p.idle + Math.pow(thr, 1.4) * (p.redline + 150 - p.idle);
    else if (shifting) { target = Math.max(p.idle, this.gearRpm(v, Math.min(n, this.gear + 1), p)); load = 0.03; }
    else {
      const slip = this.gear === 1 ? p.idle + thr * p.redline * 0.32 * Math.max(0, 1 - v / 8) : p.idle;
      target = Math.max(this.gearRpm(v, this.gear, p), slip, p.idle);
    }
    if (this.blipT > 0) { this.blipT -= dt; load = Math.max(load, 0.65); }
    const free = neutral || (this.gear === 1 && v < 4);
    if (free) {
      const rate = target > this.rpm ? 2500 + 10000 * thr : 4500;
      this.rpm += Math.max(-rate * dt, Math.min(rate * dt, target - this.rpm));
    } else this.rpm += (target - this.rpm) * Math.min(1, dt * (shifting ? 18 : 12));

    if (this.rpm >= p.redline - 40 && thr > 0.3) {
      this.cutT -= dt;
      if (this.cutT <= 0) { this.cut = !this.cut; this.cutT = this.cut ? 0.045 : 0.06; }
    } else { this.cut = false; this.cutT = 0; }
    if (this.cut) { load = 0.02; this.rpm -= 1800 * dt; }
    this.rpm = Math.min(this.rpm, p.redline + 60);

    out.rpm = out.tach = this.rpm;
    out.load = load;
    out.overrun = thr < 0.06 && this.rpm > p.idle * 1.7 && !shifting;
    out.cut = this.cut || (shifting && thr > 0.85 && ag > 0.45);
    out.gear = neutral ? 'N' : String(this.gear);
    return out;
  }
}
