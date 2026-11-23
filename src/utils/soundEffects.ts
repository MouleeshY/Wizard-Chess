export interface AudioSettings {
  muted: boolean;
  masterVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
}

interface AudioGraph {
  ctx: AudioContext;
  masterGain: GainNode;
  sfxGain: GainNode;
  ambienceGain: GainNode;
  droneGain: GainNode;
  droneFilter: BiquadFilterNode;
  droneOscSub: OscillatorNode;
  droneOscDetune: OscillatorNode;
  droneOscTension: OscillatorNode;
  noiseBuffer: AudioBuffer;
  windStarted: boolean;
}

let audioGraph: AudioGraph | null = null;
let lastCheckKey = '';

// Session-remembered audio settings (in-memory)
const audioState: AudioSettings = {
  muted: false,
  masterVolume: 0.8,
  sfxVolume: 0.85,
  ambienceVolume: 0.6,
};

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}

function createWhiteNoiseBuffer(
  ctx: AudioContext,
  durationSec: number
): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function createWindNoiseBuffer(
  ctx: AudioContext,
  durationSec: number
): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  // Smooth brownian/pink-tinted air noise with seamless crossfade edges
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.035 * white) / 1.035;
    data[i] = last * 3.4;
  }

  const fadeSamples = Math.min(Math.floor(ctx.sampleRate * 0.25), Math.floor(length / 4));
  for (let i = 0; i < fadeSamples; i++) {
    const t = i / fadeSamples;
    const endIdx = length - fadeSamples + i;
    data[endIdx] = data[endIdx] * (1 - t) + data[i] * t;
  }
  return buffer;
}

function createFireCrackleBuffer(
  ctx: AudioContext,
  durationSec: number
): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  // Soft hearth hiss bed
  for (let i = 0; i < length; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.04;
  }

  // Sparse natural micro-pops and crackles baked into the loop buffer
  const popCount = Math.floor(durationSec * 14);
  for (let p = 0; p < popCount; p++) {
    const startIdx = Math.floor(Math.random() * (length - 400));
    const popLen = 60 + Math.floor(Math.random() * 220);
    const amp = 0.16 + Math.random() * 0.42;
    for (let j = 0; j < popLen && startIdx + j < length; j++) {
      const env = Math.exp(-j / (popLen * 0.24));
      data[startIdx + j] += (Math.random() * 2 - 1) * env * amp;
    }
  }
  return buffer;
}

function applyGainState(graph: AudioGraph): void {
  const now = graph.ctx.currentTime;
  const masterTarget = audioState.muted ? 0 : audioState.masterVolume;
  graph.masterGain.gain.setTargetAtTime(masterTarget, now, 0.025);
  graph.sfxGain.gain.setTargetAtTime(audioState.sfxVolume, now, 0.025);
  graph.ambienceGain.gain.setTargetAtTime(audioState.ambienceVolume, now, 0.03);
}

function ensureAudioGraph(): AudioGraph | null {
  if (typeof window === 'undefined') return null;

  if (!audioGraph) {
    const AudioContextCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextCtor) return null;

    const ctx = new AudioContextCtor();
    const masterGain = ctx.createGain();
    const sfxGain = ctx.createGain();
    const ambienceGain = ctx.createGain();

    masterGain.gain.setValueAtTime(
      audioState.muted ? 0 : audioState.masterVolume,
      ctx.currentTime
    );
    sfxGain.gain.setValueAtTime(audioState.sfxVolume, ctx.currentTime);
    ambienceGain.gain.setValueAtTime(audioState.ambienceVolume, ctx.currentTime);

    sfxGain.connect(masterGain);
    ambienceGain.connect(masterGain);
    masterGain.connect(ctx.destination);

    // Persistent Check Drone (fades in/out without node allocation)
    const droneGain = ctx.createGain();
    droneGain.gain.setValueAtTime(0, ctx.currentTime);

    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.setValueAtTime(180, ctx.currentTime);
    droneFilter.Q.setValueAtTime(2.2, ctx.currentTime);

    const droneOscSub = ctx.createOscillator();
    droneOscSub.type = 'sawtooth';
    droneOscSub.frequency.setValueAtTime(55, ctx.currentTime); // A1

    const droneOscDetune = ctx.createOscillator();
    droneOscDetune.type = 'triangle';
    droneOscDetune.frequency.setValueAtTime(55.7, ctx.currentTime);

    const droneOscTension = ctx.createOscillator();
    droneOscTension.type = 'triangle';
    droneOscTension.frequency.setValueAtTime(77.78, ctx.currentTime); // Eb2 tritone tension

    const subMix = ctx.createGain();
    subMix.gain.setValueAtTime(0.45, ctx.currentTime);
    const detuneMix = ctx.createGain();
    detuneMix.gain.setValueAtTime(0.45, ctx.currentTime);
    const tensionMix = ctx.createGain();
    tensionMix.gain.setValueAtTime(0.28, ctx.currentTime);

    droneOscSub.connect(subMix);
    droneOscDetune.connect(detuneMix);
    droneOscTension.connect(tensionMix);
    subMix.connect(droneFilter);
    detuneMix.connect(droneFilter);
    tensionMix.connect(droneFilter);
    droneFilter.connect(droneGain);
    droneGain.connect(sfxGain);

    droneOscSub.start();
    droneOscDetune.start();
    droneOscTension.start();

    const noiseBuffer = createWhiteNoiseBuffer(ctx, 2.5);

    audioGraph = {
      ctx,
      masterGain,
      sfxGain,
      ambienceGain,
      droneGain,
      droneFilter,
      droneOscSub,
      droneOscDetune,
      droneOscTension,
      noiseBuffer,
      windStarted: false,
    };
  }

  return audioGraph;
}

function startAmbienceBed(graph: AudioGraph): void {
  if (graph.windStarted || graph.ctx.state !== 'running') return;
  graph.windStarted = true;

  const { ctx, ambienceGain } = graph;
  const now = ctx.currentTime;

  // 1. Looping chamber wind with slow LFO cutoff & swell modulation
  const windBuffer = createWindNoiseBuffer(ctx, 5.0);
  const windSource = ctx.createBufferSource();
  windSource.buffer = windBuffer;
  windSource.loop = true;

  const windFilter = ctx.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.frequency.setValueAtTime(210, now);
  windFilter.Q.setValueAtTime(0.95, now);

  const windGain = ctx.createGain();
  windGain.gain.setValueAtTime(0.001, now);
  windGain.gain.linearRampToValueAtTime(0.2, now + 1.8);

  const windLfo = ctx.createOscillator();
  windLfo.type = 'sine';
  windLfo.frequency.setValueAtTime(0.085, now);

  const windLfoFreqDepth = ctx.createGain();
  windLfoFreqDepth.gain.setValueAtTime(95, now);

  const windLfoAmpDepth = ctx.createGain();
  windLfoAmpDepth.gain.setValueAtTime(0.055, now);

  windLfo.connect(windLfoFreqDepth);
  windLfoFreqDepth.connect(windFilter.frequency);
  windLfo.connect(windLfoAmpDepth);
  windLfoAmpDepth.connect(windGain.gain);

  windSource.connect(windFilter);
  windFilter.connect(windGain);
  windGain.connect(ambienceGain);

  windSource.start(now);
  windLfo.start(now);

  // 2. Soft continuous fire crackle loop (pre-baked random micro-pops)
  const crackleBuffer = createFireCrackleBuffer(ctx, 5.0);
  const crackleSource = ctx.createBufferSource();
  crackleSource.buffer = crackleBuffer;
  crackleSource.loop = true;

  const crackleHp = ctx.createBiquadFilter();
  crackleHp.type = 'highpass';
  crackleHp.frequency.setValueAtTime(950, now);

  const crackleLp = ctx.createBiquadFilter();
  crackleLp.type = 'lowpass';
  crackleLp.frequency.setValueAtTime(4800, now);

  const crackleGain = ctx.createGain();
  crackleGain.gain.setValueAtTime(0.001, now);
  crackleGain.gain.linearRampToValueAtTime(0.16, now + 1.4);

  crackleSource.connect(crackleHp);
  crackleHp.connect(crackleLp);
  crackleLp.connect(crackleGain);
  crackleGain.connect(ambienceGain);

  crackleSource.start(now);
}

export function unlockAudio(): void {
  try {
    const graph = ensureAudioGraph();
    if (!graph) return;
    if (graph.ctx.state === 'suspended') {
      void graph.ctx.resume().then(() => {
        if (audioGraph) {
          startAmbienceBed(audioGraph);
        }
      });
    } else if (graph.ctx.state === 'running') {
      startAmbienceBed(graph);
    }
  } catch {
    // Ignore audio context restrictions
  }
}

export function getAudioSettings(): AudioSettings {
  return { ...audioState };
}

export function setMuted(muted: boolean): void {
  audioState.muted = muted;
  if (audioGraph) applyGainState(audioGraph);
}

export function setMasterVolume(volume: number): void {
  audioState.masterVolume = clamp01(volume);
  if (audioGraph) applyGainState(audioGraph);
}

export function setSfxVolume(volume: number): void {
  audioState.sfxVolume = clamp01(volume);
  if (audioGraph) applyGainState(audioGraph);
}

export function setAmbienceVolume(volume: number): void {
  audioState.ambienceVolume = clamp01(volume);
  if (audioGraph) applyGainState(audioGraph);
}

/**
 * Updates the check warning drone.
 * intensityLevel: 0 = off, 1 = single check, 2 = repeated check or tight escape, 3 = checkmate
 */
export function setCheckDroneState(
  isCheck: boolean,
  intensityLevel = 1
): void {
  try {
    const key = isCheck ? `1:${intensityLevel}` : '0';
    if (key === lastCheckKey && !audioGraph) return;
    lastCheckKey = key;

    const graph = ensureAudioGraph();
    if (!graph || graph.ctx.state !== 'running') return;

    const now = graph.ctx.currentTime;
    if (!isCheck || intensityLevel <= 0) {
      graph.droneGain.gain.setTargetAtTime(0, now, 0.35);
      graph.droneFilter.frequency.setTargetAtTime(160, now, 0.35);
      return;
    }

    const level = Math.min(3, Math.max(1, intensityLevel));
    const targetGain = level === 1 ? 0.085 : level === 2 ? 0.145 : 0.2;
    const targetCutoff = level === 1 ? 185 : level === 2 ? 310 : 440;
    const tensionFreq = level === 1 ? 77.78 : level === 2 ? 82.41 : 87.31;

    graph.droneGain.gain.setTargetAtTime(targetGain, now, 0.32);
    graph.droneFilter.frequency.setTargetAtTime(targetCutoff, now, 0.32);
    graph.droneOscTension.frequency.setTargetAtTime(tensionFreq, now, 0.32);
  } catch {
    // Ignore audio errors
  }
}

export function playStoneScrape(durationSec = 0.8): void {
  try {
    const graph = ensureAudioGraph();
    if (!graph || graph.ctx.state !== 'running') return;

    const { ctx, sfxGain, noiseBuffer } = graph;
    const now = ctx.currentTime;
    const dur = Math.max(0.2, Math.min(durationSec, 2.0));

    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(280, now);
    lowpass.frequency.linearRampToValueAtTime(420, now + dur * 0.48);
    lowpass.frequency.linearRampToValueAtTime(210, now + dur);
    lowpass.Q.setValueAtTime(2.0, now);

    const rumble = ctx.createBiquadFilter();
    rumble.type = 'peaking';
    rumble.frequency.setValueAtTime(145, now);
    rumble.gain.setValueAtTime(6, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.24, now + 0.08);
    gain.gain.setValueAtTime(0.22, Math.max(now + 0.09, now + dur - 0.14));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    source.connect(lowpass);
    lowpass.connect(rumble);
    rumble.connect(gain);
    gain.connect(sfxGain);

    source.start(now, Math.random() * 0.8);
    source.stop(now + dur + 0.02);
  } catch {
    // Ignore audio errors
  }
}

export function playStoneThud(volume = 0.7): void {
  try {
    const graph = ensureAudioGraph();
    if (!graph || graph.ctx.state !== 'running') return;

    const { ctx, sfxGain, noiseBuffer } = graph;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(102, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.24);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.36 * volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(now);
    osc.stop(now + 0.3);

    // Subtle stone-on-stone contact tap
    const tap = ctx.createBufferSource();
    tap.buffer = noiseBuffer;
    const tapLp = ctx.createBiquadFilter();
    tapLp.type = 'lowpass';
    tapLp.frequency.setValueAtTime(480, now);
    const tapGain = ctx.createGain();
    tapGain.gain.setValueAtTime(0.14 * volume, now);
    tapGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);

    tap.connect(tapLp);
    tapLp.connect(tapGain);
    tapGain.connect(sfxGain);
    tap.start(now, Math.random());
    tap.stop(now + 0.085);
  } catch {
    // Ignore audio errors
  }
}

export function playCaptureImpact(): void {
  try {
    const graph = ensureAudioGraph();
    if (!graph || graph.ctx.state !== 'running') return;

    const { ctx, sfxGain, noiseBuffer } = graph;
    const now = ctx.currentTime;

    // Heavy slam thud
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(132, now);
    subOsc.frequency.exponentialRampToValueAtTime(30, now + 0.3);

    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.linearRampToValueAtTime(0.42, now + 0.006);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

    subOsc.connect(subGain);
    subGain.connect(sfxGain);
    subOsc.start(now);
    subOsc.stop(now + 0.36);

    // Low punch burst
    const punch = ctx.createBufferSource();
    punch.buffer = noiseBuffer;
    const punchLp = ctx.createBiquadFilter();
    punchLp.type = 'lowpass';
    punchLp.frequency.setValueAtTime(620, now);
    const punchGain = ctx.createGain();
    punchGain.gain.setValueAtTime(0.28, now);
    punchGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

    punch.connect(punchLp);
    punchLp.connect(punchGain);
    punchGain.connect(sfxGain);
    punch.start(now, Math.random());
    punch.stop(now + 0.16);
  } catch {
    // Ignore audio errors
  }
}

export function playRockShatter(): void {
  try {
    const graph = ensureAudioGraph();
    if (!graph || graph.ctx.state !== 'running') return;

    const { ctx, sfxGain } = graph;
    const now = ctx.currentTime;

    // Sharp rock-cracking noise burst
    const dur = 0.44;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const t = i / bufferSize;
      const crack = t < 0.085 ? 1.0 : Math.exp(-(t - 0.085) * 5.4);
      const clatter = i % 180 < 36 ? 1.2 : 0.6;
      data[i] = (Math.random() * 2 - 1) * crack * clatter;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1600, now);
    filter.frequency.exponentialRampToValueAtTime(420, now + dur);
    filter.Q.setValueAtTime(1.15, now);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.32, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(sfxGain);
    noise.start(now);
  } catch {
    // Ignore audio errors
  }
}

export function playDebrisClatterSequence(): void {
  try {
    const graph = ensureAudioGraph();
    if (!graph || graph.ctx.state !== 'running') return;

    const { ctx, sfxGain, noiseBuffer } = graph;
    const now = ctx.currentTime;
    const offsets = [0.22, 0.34, 0.45, 0.59, 0.74, 0.91];

    offsets.forEach((delaySec, idx) => {
      const startAt = now + delaySec + Math.random() * 0.04;
      const tapDur = 0.055;
      const vol = (0.11 - idx * 0.012) * (0.75 + Math.random() * 0.45);

      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(950 + Math.random() * 1400, startAt);
      bp.Q.setValueAtTime(2.6, startAt);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, startAt);
      g.gain.linearRampToValueAtTime(Math.max(0.02, vol), startAt + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, startAt + tapDur);

      src.connect(bp);
      bp.connect(g);
      g.connect(sfxGain);
      src.start(startAt, Math.random());
      src.stop(startAt + tapDur + 0.01);
    });
  } catch {
    // Ignore audio errors
  }
}

export function playCrownClang(volume = 1): void {
  try {
    const graph = ensureAudioGraph();
    if (!graph) return;
    if (graph.ctx.state === 'suspended') {
      void graph.ctx.resume();
    }

    const { ctx, sfxGain } = graph;
    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.28 * volume, now);
    masterGain.connect(sfxGain);

    const partials = [
      { freq: 418, gain: 0.48, decay: 1.35 },
      { freq: 692, gain: 0.36, decay: 1.05 },
      { freq: 1138, gain: 0.28, decay: 0.85 },
      { freq: 1745, gain: 0.2, decay: 0.55 },
      { freq: 2590, gain: 0.14, decay: 0.35 },
    ];

    for (const p of partials) {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(
        p.freq * (1 + (Math.random() - 0.5) * 0.015),
        now
      );
      osc.frequency.exponentialRampToValueAtTime(p.freq * 0.985, now + p.decay);

      oscGain.gain.setValueAtTime(0.0001, now);
      oscGain.gain.linearRampToValueAtTime(p.gain, now + 0.004);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);

      osc.connect(oscGain);
      oscGain.connect(masterGain);
      osc.start(now);
      osc.stop(now + p.decay + 0.02);
    }

    const bufferSize = Math.floor(ctx.sampleRate * 0.045);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.22));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2100, now);
    filter.Q.setValueAtTime(2.5, now);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.55, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(masterGain);
    noise.start(now);
  } catch {
    // Ignore audio errors
  }
}

export function playBrazierWhoosh(pitchMultiplier = 1): void {
  try {
    const graph = ensureAudioGraph();
    if (!graph || graph.ctx.state !== 'running') return;

    const { ctx, sfxGain } = graph;
    const now = ctx.currentTime;
    const dur = 0.34;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const env = Math.sin((i / bufferSize) * Math.PI);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(260 * pitchMultiplier, now);
    filter.frequency.exponentialRampToValueAtTime(
      760 * pitchMultiplier,
      now + 0.14
    );
    filter.frequency.exponentialRampToValueAtTime(
      220 * pitchMultiplier,
      now + dur
    );
    filter.Q.setValueAtTime(1.4, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.07);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(sfxGain);
    noise.start(now);
  } catch {
    // Ignore audio errors
  }
}

export function playDoorUnlock(): void {
  try {
    const graph = ensureAudioGraph();
    if (!graph || graph.ctx.state !== 'running') return;

    const { ctx, sfxGain } = graph;
    const now = ctx.currentTime;

    // Iron bolt slide + deep oak rumble
    const boltOsc = ctx.createOscillator();
    const boltGain = ctx.createGain();
    boltOsc.type = 'sawtooth';
    boltOsc.frequency.setValueAtTime(160, now);
    boltOsc.frequency.exponentialRampToValueAtTime(95, now + 0.22);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(520, now);

    boltGain.gain.setValueAtTime(0.001, now);
    boltGain.gain.linearRampToValueAtTime(0.16, now + 0.02);
    boltGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    boltOsc.connect(lp);
    lp.connect(boltGain);
    boltGain.connect(sfxGain);
    boltOsc.start(now);
    boltOsc.stop(now + 0.3);

    // Low door swing groan
    const groanOsc = ctx.createOscillator();
    const groanGain = ctx.createGain();
    groanOsc.type = 'triangle';
    groanOsc.frequency.setValueAtTime(64, now + 0.18);
    groanOsc.frequency.linearRampToValueAtTime(54, now + 1.25);

    groanGain.gain.setValueAtTime(0.001, now + 0.18);
    groanGain.gain.linearRampToValueAtTime(0.12, now + 0.45);
    groanGain.gain.exponentialRampToValueAtTime(0.001, now + 1.35);

    groanOsc.connect(groanGain);
    groanGain.connect(sfxGain);
    groanOsc.start(now + 0.18);
    groanOsc.stop(now + 1.4);
  } catch {
    // Ignore audio errors
  }
}
