// A simple longitudinal vehicle (traction limit, drag, regen, brakes) for pedal mode.
export class Car {
  constructor() { this.v = 0; this.a = 0; }
  update(dt, thr, brk) {
    const v = this.v;
    const drive = thr * Math.min(5.4, 165 / Math.max(v, 2));
    const resist = v > 0.05 ? 0.12 + 0.00042 * v * v : 0;
    const regen = thr < 0.04 ? 1.3 * Math.min(1, v / 4) : 0;
    const a = drive - resist - regen - brk * 8.5;
    this.v = Math.min(75, Math.max(0, v + a * dt));
    this.a = a;
  }
}
