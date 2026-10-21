// Audio output: the DSP in an AudioWorklet (ScriptProcessor fallback), a master gain and a limiter.
import { EngineDSP } from './dsp.js';

const WORKLET_WRAPPER = `
class EngineProc extends AudioWorkletProcessor {
  constructor() { super(); this.dsp = new EngineDSP(sampleRate); this.port.onmessage = (e) => this.dsp.set(e.data); }
  process(inputs, outputs) { const o = outputs[0]; if (o.length > 1) this.dsp.render(o[0], o[1], o[0].length); return true; }
}
registerProcessor('engine-dsp', EngineProc);`;

// iOS mutes Web Audio when the ringer switch is off. A looping silent <audio> element
// moves the page's audio session to "playback", which ignores the switch.
let silentEls = [], audioInfoBase = '', silentState = '', infoListener = () => {};
function updateAudioInfo() { infoListener([audioInfoBase, silentState].filter(Boolean).join('. ')); }
// Called with a one-line description of the audio path whenever it changes.
export function onAudioInfo(fn) { infoListener = fn; }
function silentWavBytes() {
  const sr = 8000, n = 2000, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  return new Uint8Array(buf);
}
export function unlockSilentSwitch() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  if (!silentEls.length) {
    const bytes = silentWavBytes();
    let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const srcs = [URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })), 'data:audio/wav;base64,' + btoa(bin)];
    silentEls = srcs.map(src => {
      const a = document.createElement('audio');
      a.setAttribute('playsinline', ''); a.setAttribute('x-webkit-airplay', 'deny');
      a.loop = true; a.preload = 'auto'; a.src = src; return a;
    });
  }
  let ok = 0, done = 0;
  const fin = (good) => { done++; if (good) ok++; if (done === silentEls.length) { silentState = ok ? 'Silent switch bypass on' : 'Silent switch bypass failed, so turn the ringer on'; updateAudioInfo(); } };
  silentEls.forEach(a => { try { const p = a.play(); if (p && p.then) p.then(() => fin(true), () => fin(false)); else fin(true); } catch (e) { fin(false); } });
}
export function pauseSilent() { silentEls.forEach(a => { try { a.pause(); } catch (e) {} }); }

let ctx = null, node = null, localDSP = null, master = null, audioPath = '';
export function sendDSP(m) { if (localDSP) localDSP.set(m); else if (node && node.port) node.port.postMessage(m); }
export function setVolume(vol) { if (master) master.gain.setTargetAtTime(vol * vol, ctx.currentTime, 0.03); }
// Must be called from a tap. Later calls only resume the context.
export async function initAudio({ volume, cfg }) {
  if (ctx) { if (ctx.state !== 'running') await ctx.resume(); return; }
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC({ latencyHint: 'interactive' });
  const resuming = ctx.resume();
  master = ctx.createGain();
  master.gain.value = volume * volume;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10; comp.knee.value = 6; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
  master.connect(comp); comp.connect(ctx.destination);
  let ok = false;
  if (ctx.audioWorklet && window.Blob && window.AudioWorkletNode) {
    try {
      const url = URL.createObjectURL(new Blob([EngineDSP.toString() + '\n' + WORKLET_WRAPPER], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      node = new AudioWorkletNode(ctx, 'engine-dsp', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      node.connect(master); ok = true; audioPath = 'AudioWorklet';
    } catch (e) { console.warn('AudioWorklet unavailable, falling back to ScriptProcessor', e); }
  }
  if (!ok) {
    localDSP = new EngineDSP(ctx.sampleRate);
    node = ctx.createScriptProcessor(1024, 1, 2);
    node.onaudioprocess = (ev) => { const ob = ev.outputBuffer; localDSP.render(ob.getChannelData(0), ob.getChannelData(1), ob.length); };
    node.connect(master); audioPath = 'ScriptProcessor fallback';
  }
  sendDSP({ cfg });
  try { await resuming; } catch (e) {}
  const lat = ((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000;
  audioInfoBase = `Audio: ${audioPath}, ${Math.round(ctx.sampleRate / 100) / 10} kHz` + (lat > 0 ? `, about ${Math.round(lat)} ms output latency` : '');
  updateAudioInfo();
}
