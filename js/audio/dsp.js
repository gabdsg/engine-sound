// The engine sound generator. The AudioWorklet loads it from EngineDSP.toString() (and the
// ScriptProcessor fallback runs it on the main thread), so it must stay self-contained:
// no imports and no references to anything else in this module.
export class EngineDSP {
  constructor(sr) {
    this.sr = sr;
    this.cfg = null;
    this.tRpm = 0; this.rpm = 0;
    this.tLoad = 0; this.load = 0;
    this.on = 0; this.gain = 0;
    this.character = 0.5; this.crackle = 0.35;
    this.overrun = 0; this.cut = 0;
    this.motorHz = 0; this.mHz = 0;
    this.theta = 0; this.base = 0; this.nextA = 0; this.fi = 0;
    this.pa = [0, 0]; this.pt = [1, 1]; this.pw = [1, 1]; this.pn = [0, 0];
    this.pipe = [new Float32Array(4096), new Float32Array(4096)];
    this.wi = 0; this.plp = [0, 0];
    this.mL = [0, 0]; this.mB = [0, 0];
    this.iL = 0; this.iB = 0;
    this.dcx = [0, 0]; this.dcy = [0, 0];
    this.pops = [];
    this.seed = 0x2f6b4a1d;
    this.jit = 0;
    this.boost = 0; this.bov = 0; this.bovLp = 0; this.wph = 0;
    this.eph = [0, 0, 0, 0, 0, 0]; this.cph = 0;
  }
  rnd() {
    let x = this.seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x;
    return (x >>> 0) / 4294967296;
  }
  set(m) {
    if (m.cfg) {
      this.cfg = m.cfg; this.fi = 0; this.theta = 0; this.base = 0;
      this.nextA = m.cfg.type === 'ice' ? m.cfg.fire[0].a : 0;
      this.pops.length = 0;
    }
    if (m.tLoad !== undefined) {
      const c = this.cfg;
      if (c && c.turbo && this.boost > 0.35 && m.tLoad < 0.12 && this.tLoad > 0.45) this.bov = Math.min(1, this.boost * 1.2);
      this.tLoad = m.tLoad;
    }
    if (m.tRpm !== undefined) this.tRpm = m.tRpm;
    if (m.on !== undefined) this.on = m.on;
    if (m.character !== undefined) this.character = m.character;
    if (m.crackle !== undefined) this.crackle = m.crackle;
    if (m.overrun !== undefined) this.overrun = m.overrun;
    if (m.cut !== undefined) this.cut = m.cut;
    if (m.motorHz !== undefined) this.motorHz = m.motorHz;
  }
  ignite(c, idx, rpm, lr, ch) {
    const f = c.fire[idx], b = f.b;
    const lump = c.lump * (0.35 + ch) * Math.max(0, 1 - rpm / 3500);
    let a = (0.38 + 0.62 * this.load) * (0.62 + 0.38 * Math.min(1, lr));
    if (this.overrun) a *= 0.32;
    a *= 1 + (this.rnd() - 0.5) * (0.1 + lump * 1.4);
    if (this.cut && this.rnd() < 0.75) a *= 0.04;
    if (rpm < 350) a *= 0.2 + 0.4 * this.rnd();
    const gapSec = c.gap[b] / Math.max(60, rpm * 6);
    this.pw[b] = Math.max(6, Math.min(this.sr * 0.0018, 0.5 * gapSec * this.sr));
    this.pt[b] = 0; this.pa[b] = a;
    this.pn[b] = a * (0.2 + 0.5 * ch);
    const popZone = (this.overrun && rpm > c.idle * 1.6) || this.cut;
    if (popZone && this.crackle > 0 && this.rnd() < this.crackle * (this.cut ? 0.35 : 0.16)) this.addPop(b);
  }
  addPop(b) {
    if (this.pops.length >= 8) return;
    const big = this.rnd() < 0.22;
    this.pops.push({ t: -Math.floor(this.rnd() * this.sr * 0.04), len: this.sr * (big ? 0.012 : 0.003), a: (big ? 2.2 : 0.8) * (0.4 + this.rnd()), b: b });
  }
  render(L, R, n) {
    const c = this.cfg, sr = this.sr;
    if (!c) { for (let i = 0; i < n; i++) { L[i] = 0; R[i] = 0; } return; }
    const kL = 1 - Math.exp(-1 / (sr * 0.015));
    const kG = 1 - Math.exp(-1 / (sr * (this.on ? 0.05 : 0.4)));
    if (c.type === 'ev') { this.renderEV(L, R, n, kL, kG); return; }
    const kR = 1 - Math.exp(-1 / (sr * 0.025));
    const ch = this.character, red = c.redline, mask = 4095;
    const muffBase = c.muff * (0.45 + 1.3 * ch);
    const fbk = c.pipeFb * (0.85 + 0.25 * ch);
    const damp = 0.25 + 0.45 * ch;
    const len0 = Math.min(4000, Math.max(8, Math.round(sr / c.pipeHz[0])));
    const len1 = Math.min(4000, Math.max(8, Math.round(sr / c.pipeHz[c.pipeHz.length - 1])));
    const drive = 1.2 + 2.2 * ch, norm = 1 / Math.tanh(drive);
    const tailK = Math.exp(-1 / (sr * 0.0022));
    const kJ = 1 - Math.exp(-1 / (sr * 0.12));
    const kB = 1 - Math.exp(-1 / (sr * (this.tLoad > this.boost ? 0.7 : 0.25)));
    const bovK = Math.exp(-1 / (sr * 0.32));
    const rasp = c.rasp * (0.15 + 0.6 * ch);
    const lvl = c.level, twoBank = c.banks === 2;
    const P0 = this.pipe[0], P1 = this.pipe[1];
    for (let i = 0; i < n; i++) {
      this.rpm += (this.tRpm - this.rpm) * kR;
      this.load += (this.tLoad - this.load) * kL;
      this.gain += (this.on - this.gain) * kG;
      this.jit += ((this.rnd() * 2 - 1) - this.jit) * kJ;
      const lowRpm = Math.max(0, 1 - this.rpm / 3000);
      const rpm = Math.max(0, this.rpm * (1 + this.jit * 0.05 * c.lump * lowRpm));
      const lr = Math.min(1.1, rpm / red);

      // crankshaft: fire each cylinder as the crank passes its angle in the 720° cycle
      this.theta += rpm * 6 / sr;
      let guard = 0;
      while (this.theta >= this.nextA && guard++ < 4) {
        this.ignite(c, this.fi, rpm, lr, ch);
        this.fi++;
        if (this.fi >= c.fire.length) { this.fi = 0; this.base += 720; }
        this.nextA = this.base + c.fire[this.fi].a;
      }
      if (this.theta >= 720) { this.theta -= 720; this.base -= 720; this.nextA -= 720; }

      // exhaust pulse excitation per bank
      let e0 = 0, e1 = 0;
      for (let b = 0; b < 2; b++) {
        let e = 0;
        if (this.pt[b] < this.pw[b]) {
          const x = this.pt[b] / this.pw[b];
          e = this.pa[b] * Math.sin(Math.PI * x) * (1 - 0.35 * x);
          this.pt[b]++;
        }
        e += this.pn[b] * (this.rnd() * 2 - 1);
        this.pn[b] *= tailK;
        if (b === 0) e0 = e; else e1 = e;
      }
      for (let k = this.pops.length - 1; k >= 0; k--) {
        const p = this.pops[k];
        p.t++;
        if (p.t < 0) continue;
        const s = p.a * Math.exp(-p.t / p.len) * (this.rnd() * 2 - 1);
        if (p.b === 0) e0 += s; else e1 += s;
        if (p.t > p.len * 6) this.pops.splice(k, 1);
      }
      if (!twoBank) { e0 += e1; e1 = 0; }

      // pipe resonance: damped waveguide per bank
      const w = this.wi;
      this.plp[0] += (P0[(w - len0) & mask] - this.plp[0]) * damp;
      const y0 = e0 - fbk * this.plp[0];
      P0[w] = y0;
      let y1 = 0;
      if (twoBank) {
        this.plp[1] += (P1[(w - len1) & mask] - this.plp[1]) * damp;
        y1 = e1 - fbk * this.plp[1];
        P1[w] = y1;
      }
      this.wi = (w + 1) & mask;

      // muffler: state-variable lowpass that opens with load and revs
      const fc = Math.min(sr / 8, muffBase * (0.65 + 0.7 * this.load) * (0.75 + 0.5 * lr));
      const fm = 2 * Math.PI * fc / sr;
      this.mL[0] += fm * this.mB[0];
      this.mB[0] += fm * (y0 - this.mL[0] - 1.1 * this.mB[0]);
      let o0 = this.mL[0] + y0 * rasp * lr * lr;
      let o1 = 0;
      if (twoBank) {
        this.mL[1] += fm * this.mB[1];
        this.mB[1] += fm * (y1 - this.mL[1] - 1.1 * this.mB[1]);
        o1 = this.mL[1] + y1 * rasp * lr * lr;
      }

      // intake roar: bandpassed noise that rises with revs
      const fi2 = 2 * Math.PI * (160 + rpm * 0.1) / sr;
      this.iL += fi2 * this.iB;
      this.iB += fi2 * ((this.rnd() * 2 - 1) - this.iL - 0.6 * this.iB);
      const intake = this.iB * c.intake * this.load * lr * 0.35;

      // turbo whistle and blow-off
      let tb = 0;
      if (c.turbo) {
        const bt = this.load * Math.min(1, Math.max(0, (rpm - 1800) / 2800));
        this.boost += (bt - this.boost) * kB;
        this.wph += (1500 + 5200 * this.boost) / sr; if (this.wph > 1) this.wph -= 1;
        tb = Math.sin(2 * Math.PI * this.wph) * 0.035 * this.boost * this.boost * c.turbo;
        if (this.bov > 0.001) {
          const nz = this.rnd() * 2 - 1;
          this.bovLp += (nz - this.bovLp) * 0.25;
          tb += (nz - this.bovLp) * this.bov * 0.22;
          this.bov *= bovK;
        }
      }

      let sL, sR;
      if (twoBank) { sL = o0 * 0.72 + o1 * 0.28; sR = o1 * 0.72 + o0 * 0.28; }
      else { sL = o0; sR = o0; }
      sL = Math.tanh((sL + intake + tb) * drive * lvl) * norm;
      sR = Math.tanh((sR + intake * 0.9 + tb) * drive * lvl) * norm;
      const dL = sL - this.dcx[0] + 0.995 * this.dcy[0]; this.dcx[0] = sL; this.dcy[0] = dL;
      const dR = sR - this.dcx[1] + 0.995 * this.dcy[1]; this.dcx[1] = sR; this.dcy[1] = dR;
      L[i] = dL * this.gain * 0.5;
      R[i] = dR * this.gain * 0.5;
    }
  }
  renderEV(L, R, n, kL, kG) {
    const sr = this.sr, ch = this.character, lvl = this.cfg.level;
    const kM = 1 - Math.exp(-1 / (sr * 0.05));
    const mult = [0.5, 1, 2, 3, 4.5], amp = [0.55, 0.4, 0.16, 0.07, 0.035];
    const dr = 1 + 3 * ch, norm = 1 / Math.tanh(dr);
    for (let i = 0; i < n; i++) {
      this.mHz += (this.motorHz - this.mHz) * kM;
      this.load += (this.tLoad - this.load) * kL;
      this.gain += (this.on - this.gain) * kG;
      const f = this.mHz;
      let s = 0;
      for (let k = 0; k < 5; k++) {
        this.eph[k] += f * mult[k] / sr; if (this.eph[k] > 1) this.eph[k] -= 1;
        s += amp[k] * Math.sin(2 * Math.PI * this.eph[k]);
      }
      s *= Math.min(1, f / 150) * (0.12 + 0.88 * this.load);
      const carF = f < 120 ? 1100 + Math.floor(f / 30) * 220 : 2600;
      this.cph += carF / sr; if (this.cph > 1) this.cph -= 1;
      const car = f > 2 ? Math.sin(2 * Math.PI * this.cph) * 0.05 * (0.3 + 0.7 * this.load) * Math.max(0.15, 1 - f / 600) : 0;
      this.eph[5] += 58 / sr; if (this.eph[5] > 1) this.eph[5] -= 1;
      const hum = Math.sin(2 * Math.PI * this.eph[5]) * 0.05;
      const y = Math.tanh((s + car + hum) * dr * lvl) * norm;
      L[i] = y * this.gain * 0.5;
      R[i] = y * this.gain * 0.5;
    }
  }
}
