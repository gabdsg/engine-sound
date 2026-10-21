// Demo run keyframes: [time s, throttle, brake, neutral]
const DEMO = [
  [0, 0, 0, 1], [1.0, 0, 0, 1], [1.15, 0.75, 0, 1], [1.45, 0, 0, 1], [2.1, 1, 0, 1], [2.45, 0, 0, 1], [3.6, 0, 0, 1],
  [3.7, 0, 0, 0], [4.0, 1, 0, 0], [10.5, 1, 0, 0], [10.6, 0, 0, 0], [12.8, 0, 0, 0], [13.2, 0.32, 0, 0], [16.5, 0.32, 0, 0],
  [16.7, 1, 0, 0], [20.5, 1, 0, 0], [20.6, 0, 0, 0], [21.5, 0, 0, 0], [21.8, 0, 0.75, 0], [28.5, 0, 0.75, 0], [28.8, 0, 0, 0], [30.5, 0, 0, 0]
];
export function demoAt(t) {
  if (t >= DEMO[DEMO.length - 1][0]) return null;
  let i = 0;
  while (i < DEMO.length - 2 && DEMO[i + 1][0] <= t) i++;
  const a = DEMO[i], b = DEMO[i + 1];
  const f = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
  return { thr: a[1] + (b[1] - a[1]) * f, brk: a[2] + (b[2] - a[2]) * f, neutral: !!a[3] };
}
