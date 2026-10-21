import { $ } from './dom.js';

const SVGNS = 'http://www.w3.org/2000/svg';
function polar(r, f) { const a = (135 + 270 * f) * Math.PI / 180; return [150 + r * Math.cos(a), 150 + r * Math.sin(a)]; }
function svgEl(tag, attrs, parent) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; }
let tachMax = 8000;
// Draws the scale for a preset: 1,000 rpm steps to just past the redline, or motor rpm for the EV.
export function buildTach(p) {
  const g = $('tachScale'); g.textContent = '';
  const ev = p.type === 'ev';
  tachMax = ev ? 18000 : Math.ceil((p.redline + 500) / 1000) * 1000;
  const major = ev ? 2000 : 1000, minor = ev ? 1000 : 500;
  if (!ev) {
    const f0 = p.redline / tachMax, [x0, y0] = polar(124, f0), [x1, y1] = polar(124, 1);
    svgEl('path', { d: `M${x0.toFixed(2)} ${y0.toFixed(2)} A124 124 0 ${(1 - f0) * 270 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`, class: 'redline' }, g);
  }
  for (let r = 0; r <= tachMax; r += minor) {
    const f = r / tachMax, isMaj = r % major === 0;
    const [x0, y0] = polar(isMaj ? 111 : 118, f), [x1, y1] = polar(130, f);
    svgEl('line', { x1: x0.toFixed(2), y1: y0.toFixed(2), x2: x1.toFixed(2), y2: y1.toFixed(2), class: isMaj ? 'tick major' : 'tick' }, g);
    if (isMaj) {
      const [lx, ly] = polar(95, f);
      const t = svgEl('text', { x: lx.toFixed(2), y: ly.toFixed(2), class: 'tick-label', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
      t.textContent = r / 1000;
    }
  }
  $('tachUnit').textContent = ev ? '×1000 motor rpm' : '×1000 rpm';
}
export function setNeedle(rpm) {
  const f = Math.min(1.02, Math.max(0, rpm / tachMax));
  $('needle').setAttribute('transform', `translate(150 150) rotate(${(135 + 270 * f).toFixed(2)})`);
}
