// Engine presets (generic names; tune freely)
function evenFire(n, banks) { const out = []; for (let i = 0; i < n; i++) out.push([i * 720 / n, banks === 2 ? i % 2 : 0]); return out; }
export const PRESETS = [
  { id: 'v8', name: 'Cross-plane V8', desc: 'Lumpy big-block burble, 6-speed', type: 'ice', idle: 650, redline: 6600,
    gears: [2.66, 1.78, 1.30, 1.0, 0.74, 0.50], final: 3.42, banks: 2,
    fire: [[0, 0], [90, 1], [180, 1], [270, 0], [360, 1], [450, 0], [540, 0], [630, 1]],
    pipeHz: [112, 121], pipeFb: 0.66, muff: 900, intake: 0.35, rasp: 0.25, lump: 0.9, turbo: 0, level: 0.75 },
  { id: 'flat6', name: 'Flat-six 9K', desc: 'High-revving boxer six, 7-speed', type: 'ice', idle: 950, redline: 9000,
    gears: [3.75, 2.38, 1.72, 1.34, 1.11, 0.96, 0.84], final: 3.97, banks: 2, fire: evenFire(6, 2),
    pipeHz: [300, 320], pipeFb: 0.55, muff: 2600, intake: 0.5, rasp: 0.5, lump: 0.2, turbo: 0, level: 0.9 },
  { id: 'v12', name: 'V12 howl', desc: 'Smooth 60° twelve to 8,800 rpm', type: 'ice', idle: 900, redline: 8800,
    gears: [3.1, 2.2, 1.65, 1.3, 1.05, 0.88, 0.75], final: 3.6, banks: 2, fire: evenFire(12, 2),
    pipeHz: [370, 388], pipeFb: 0.5, muff: 3200, intake: 0.6, rasp: 0.6, lump: 0.1, turbo: 0, level: 0.9 },
  { id: 'i4t', name: 'Turbo four', desc: 'Whistle on boost, blow-off on lift', type: 'ice', idle: 850, redline: 7000,
    gears: [3.36, 2.09, 1.47, 1.10, 0.87, 0.73], final: 4.1, banks: 1, fire: evenFire(4, 1),
    pipeHz: [200], pipeFb: 0.6, muff: 1600, intake: 0.5, rasp: 0.35, lump: 0.15, turbo: 1, level: 0.8 },
  { id: 'twin', name: 'Big twin', desc: 'Uneven 45° V-twin thump, 5-speed', type: 'ice', idle: 900, redline: 5600,
    gears: [2.9, 1.95, 1.45, 1.15, 0.95], final: 3.0, banks: 1, fire: [[0, 0], [405, 0]],
    pipeHz: [92], pipeFb: 0.7, muff: 700, intake: 0.25, rasp: 0.3, lump: 0.6, turbo: 0, level: 0.95 },
  { id: 'ev', name: 'Electric', desc: 'Motor whine that follows speed', type: 'ev', level: 0.6 }
];
// Turns a preset into the config the DSP expects: sorted firing angles and the shortest gap per bank.
export function buildCfg(p) {
  if (p.type === 'ev') return { type: 'ev', level: p.level };
  const fire = p.fire.map(([a, b]) => ({ a, b })).sort((x, y) => x.a - y.a);
  const gap = [720, 720];
  for (let b = 0; b < 2; b++) {
    const as = fire.filter(f => (p.banks === 1 ? 0 : f.b) === b).map(f => f.a);
    for (let i = 0; i < as.length; i++) {
      const d = i + 1 < as.length ? as[i + 1] - as[i] : 720 - as[i] + as[0];
      if (d > 0) gap[b] = Math.min(gap[b], d);
    }
  }
  return { type: 'ice', idle: p.idle, redline: p.redline, banks: p.banks, fire, gap, pipeHz: p.pipeHz, pipeFb: p.pipeFb,
    muff: p.muff, intake: p.intake, rasp: p.rasp, lump: p.lump, turbo: p.turbo, level: p.level };
}
