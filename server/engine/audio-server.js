/**
 * audio-server.js
 * Pure JavaScript ambient audio renderer.
 * Zero external dependencies — only Node.js built-ins.
 */

const SAMPLE_RATE = 22050;
const TWO_PI      = Math.PI * 2;

const SCALES = {
  pentatonic_minor: [0,3,5,7,10],
  pentatonic_major: [0,2,4,7,9],
  natural_minor:    [0,2,3,5,7,8,10],
  dorian:           [0,2,3,5,7,9,10],
  lydian:           [0,2,4,6,7,9,11],
  mixolydian:       [0,2,4,5,7,9,10],
  whole_tone:       [0,2,4,6,8,10],
};

const ROOT_MIDI = {
  C:36,'C#':37,D:38,'D#':39,E:40,
  F:41,'F#':42,G:43,'G#':44,A:45,'A#':46,B:47
};

function midiToHz(n) { return 440 * Math.pow(2, (n - 69) / 12); }

function buildScale(rootName, scaleName, octaves = 3) {
  const base = ROOT_MIDI[rootName] ?? 45;
  const ivs  = SCALES[scaleName]   ?? SCALES.pentatonic_minor;
  const out  = [];
  for (let o = 0; o < octaves; o++)
    for (const iv of ivs) out.push(midiToHz(base + o * 12 + iv));
  return out;
}

class CombFilter {
  constructor(delaySamples, feedback, damping) {
    this.buf = new Float32Array(delaySamples);
    this.feedback = feedback; this.damping = damping;
    this.store = 0; this.pos = 0;
  }
  process(input) {
    const output = this.buf[this.pos];
    this.store = output * (1 - this.damping) + this.store * this.damping;
    this.buf[this.pos] = input + this.store * this.feedback;
    this.pos = (this.pos + 1) % this.buf.length;
    return output;
  }
}

class AllPassFilter {
  constructor(delaySamples, feedback) {
    this.buf = new Float32Array(delaySamples);
    this.feedback = feedback; this.pos = 0;
  }
  process(input) {
    const bufOut = this.buf[this.pos];
    const output = -input + bufOut;
    this.buf[this.pos] = input + bufOut * this.feedback;
    this.pos = (this.pos + 1) % this.buf.length;
    return output;
  }
}

function createReverb(sr) {
  return {
    combs: [
      new CombFilter(Math.round(sr*0.0397),0.84,0.2),
      new CombFilter(Math.round(sr*0.0454),0.84,0.2),
      new CombFilter(Math.round(sr*0.0476),0.84,0.2),
      new CombFilter(Math.round(sr*0.0512),0.83,0.2),
    ],
    allpasses: [
      new AllPassFilter(Math.round(sr*0.0125),0.5),
      new AllPassFilter(Math.round(sr*0.0089),0.5),
    ],
  };
}

function processReverb(reverb, input) {
  let out = 0;
  for (const c of reverb.combs) out += c.process(input);
  out /= reverb.combs.length;
  for (const ap of reverb.allpasses) out = ap.process(out);
  return out;
}

function sineOsc(p) { return Math.sin(p); }
function triOsc(p)  { const n=((p/TWO_PI)%1+1)%1; return n<0.5?n*4-1:3-n*4; }

async function renderAudio(config, duration, onProgress) {
  const sr = SAMPLE_RATE;
  const totalSamples = Math.ceil(duration * sr);
  const L = new Float32Array(totalSamples);
  const R = new Float32Array(totalSamples);
  const reportInterval = sr * 5;

  const cfg = {
    rootNote:       config.rootNote       ?? 'A',
    scaleName:      config.scaleName      ?? 'pentatonic_minor',
    droneGain:      config.droneGain      ?? 0.22,
    padGain:        config.padGain        ?? 0.18,
    textureGain:    config.textureGain    ?? 0.12,
    melodyGain:     config.melodyGain     ?? 0.07,
    pulseGain:      config.pulseGain      ?? 0.09,
    padBrightness:  config.padBrightness  ?? 0.4,
    noiseIntensity: config.noiseIntensity ?? 0.28,
    melodyRate:     config.melodyRate     ?? 0.35,
    pulseDensity:   config.pulseDensity   ?? 0.5,
  };

  const scale = buildScale(cfg.rootNote, cfg.scaleName);

  // Layer 1: Drone
  {
    const rootHz = scale[0], cycle = 73*sr, gain = cfg.droneGain/3;
    const detunes = [-3,0,4], phases = [0,0,0];
    for (let i = 0; i < totalSamples; i++) {
      const cp = i % cycle, fl = Math.min(4*sr, cycle*0.25);
      let env = 1;
      if (cp < fl) env = cp/fl;
      if (cp > cycle-fl) env = (cycle-cp)/fl;
      let s = 0;
      for (let d = 0; d < 3; d++) {
        const hz = rootHz * Math.pow(2, detunes[d]/1200);
        s += (d < 2 ? sineOsc(phases[d]) : triOsc(phases[d]));
        phases[d] += TWO_PI * hz / sr;
      }
      s *= gain * env; L[i] += s; R[i] += s;
    }
  }

  // Layer 2: Pads
  {
    const cf = 3.5*sr, roots = [0,2,4,1,3];
    let pi = 0, ss = 0;
    while (ss < totalSamples) {
      const cd = Math.floor((41+(Math.random()*20-10))*sr);
      const se = Math.min(ss+cd, totalSamples);
      const ri = roots[pi%roots.length];
      const chord = [0,1,2].map(i=>scale[(ri+i*2)%scale.length]);
      const cut = 0.4+cfg.padBrightness*0.5;
      const gain = (cfg.padGain/chord.length)*0.85;
      const voices = [];
      for (const hz of chord)
        for (const det of [-5,5])
          voices.push({hz:hz*Math.pow(2,det/1200),phase:Math.random()*TWO_PI});
      for (let i = ss; i < se; i++) {
        const pos = i-ss;
        let env = 1;
        if (pos < cf) env = pos/cf;
        if (pos > cd-cf) env = (cd-pos)/cf;
        if (env < 0) env = 0;
        let s = 0;
        for (const v of voices) { s += sineOsc(v.phase)*cut; v.phase += TWO_PI*v.hz/sr; }
        s *= gain*env; L[i] += s; R[i] += s;
      }
      pi++; ss += Math.max(4*sr, cd-cf);
    }
  }

  // Layer 3: Texture
  {
    const cycle = 109*sr; let ss = 0, fs = 0;
    while (ss < totalSamples) {
      const se = Math.min(ss+cycle, totalSamples), sl = se-ss;
      const cut = 0.02+Math.random()*0.04;
      const gain = cfg.noiseIntensity*cfg.textureGain;
      const fl = Math.min(3*sr, sl*0.2);
      for (let i = ss; i < se; i++) {
        const pos = i-ss;
        let env = 1;
        if (pos < fl) env = pos/fl;
        if (pos > sl-fl) env = (sl-pos)/fl;
        fs = fs + cut*((Math.random()*2-1)-fs);
        const s = fs*gain*env; L[i] += s; R[i] += s;
      }
      ss += cycle;
    }
  }

  // Layer 4: Melody
  {
    const ws = Math.floor(4.3*sr);
    const mf = scale.slice(Math.floor(scale.length/2));
    for (let w = ws; w < totalSamples-sr; w += ws) {
      if (Math.random() < cfg.melodyRate) {
        const hz = mf[Math.floor(Math.random()*mf.length)];
        const ds = 1.5+Math.random()*3.5;
        const dur = Math.floor(ds*sr), end = Math.min(w+dur,totalSamples-sr);
        const atk = Math.floor((0.3+Math.random()*0.4)*sr);
        const dec = Math.floor(ds*0.6*sr);
        let ph = 0;
        for (let i = w; i < end; i++) {
          const pos = i-w;
          let env = 0;
          if (pos < atk) env = pos/atk;
          else if (pos < dec) env = 1-(pos-atk)/(dec-atk);
          const s = sineOsc(ph)*cfg.melodyGain*Math.max(0,env);
          ph += TWO_PI*hz/sr; L[i] += s; R[i] += s;
        }
      }
    }
  }

  // Layer 5: Pulse
  {
    const bi = Math.floor((8+(1-cfg.pulseDensity)*8)*sr);
    const bf = scale.slice(0,4); let pos = sr;
    while (pos < totalSamples-sr) {
      const hz = bf[Math.floor(Math.random()*bf.length)]*0.5;
      const dur = Math.floor((0.8+Math.random()*0.4)*sr);
      const end = Math.min(pos+dur,totalSamples);
      const atk = Math.floor(0.02*sr); let ph = 0;
      for (let i = pos; i < end; i++) {
        const p = i-pos;
        const env = p<atk ? p/atk : Math.exp(-(p-atk)/(dur*0.3));
        const s = sineOsc(ph)*cfg.pulseGain*env;
        ph += TWO_PI*hz/sr; L[i] += s; R[i] += s;
      }
      pos += bi+Math.floor((Math.random()-0.5)*2*sr);
    }
  }

  // Reverb + master + fade
  {
    const rl = createReverb(sr), rr = createReverb(sr);
    const fs = Math.max(0, totalSamples-Math.floor(4*sr));
    for (let i = 0; i < totalSamples; i++) {
      const vl = processReverb(rl,L[i]), vr = processReverb(rr,R[i]);
      L[i] = Math.tanh((L[i]*0.65+vl*0.35)*1.2)*0.85;
      R[i] = Math.tanh((R[i]*0.65+vr*0.35)*1.2)*0.85;
      if (i >= fs) { const t=(i-fs)/(totalSamples-fs); L[i]*=1-t; R[i]*=1-t; }
      if (i%reportInterval===0 && onProgress) {
        onProgress(i/totalSamples);
        await new Promise(r=>setImmediate(r));
      }
    }
  }

  return {
    sampleRate: sr, numberOfChannels: 2, length: totalSamples,
    getChannelData: (ch) => ch===0 ? L : R,
  };
}

module.exports = { renderAudio };
