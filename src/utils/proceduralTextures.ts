import * as THREE from 'three';

export interface StoneTextureSet {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

function hash2D(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number, seed: number, period: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const x0 = ((xi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y0 = ((yi % period) + period) % period;
  const y1 = (y0 + 1) % period;

  const a = hash2D(x0, y0, seed);
  const b = hash2D(x1, y0, seed);
  const c = hash2D(x0, y1, seed);
  const d = hash2D(x1, y1, seed);

  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function tileableFbm(
  u: number,
  v: number,
  baseFreq: number,
  octaves: number,
  seed: number
): number {
  let value = 0;
  let amplitude = 0.5;
  let freq = baseFreq;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    value +=
      amplitude * smoothNoise(u * freq, v * freq, seed + i * 19, freq);
    norm += amplitude;
    amplitude *= 0.5;
    freq *= 2;
  }

  return value / norm;
}

function createCanvasTexture(
  canvas: HTMLCanvasElement,
  isColor: boolean
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function buildStoneTextureSet(options: {
  size: number;
  seed: number;
  mode: 'marble' | 'obsidian' | 'chamber' | 'oak';
}): StoneTextureSet {
  const { size, seed, mode } = options;

  const colorCanvas = document.createElement('canvas');
  const bumpCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  colorCanvas.width = bumpCanvas.width = roughCanvas.width = size;
  colorCanvas.height = bumpCanvas.height = roughCanvas.height = size;

  const colorCtx = colorCanvas.getContext('2d')!;
  const bumpCtx = bumpCanvas.getContext('2d')!;
  const roughCtx = roughCanvas.getContext('2d')!;

  const colorImg = colorCtx.createImageData(size, size);
  const bumpImg = bumpCtx.createImageData(size, size);
  const roughImg = roughCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = (y * size + x) * 4;

      const fbmLow = tileableFbm(u, v, 4, 4, seed);
      const fbmHigh = tileableFbm(u, v, 16, 3, seed + 101);
      const grain = hash2D(x, y, seed + 303);

      let r = 128;
      let g = 128;
      let b = 128;
      let bump = 128;
      let rough = 128;

      if (mode === 'marble') {
        const warp = Math.sin((u * 2 + v * 1.5 + fbmLow * 2.4) * Math.PI * 2);
        const vein = Math.pow(1 - Math.abs(warp), 5.0);
        const base = 224 + fbmLow * 24 - vein * 42 + (grain - 0.5) * 8;

        r = Math.min(255, Math.max(0, base + 4));
        g = Math.min(255, Math.max(0, base - 2));
        b = Math.min(255, Math.max(0, base - 14));

        bump = 135 + fbmHigh * 55 - vein * 48 + (grain - 0.5) * 18;
        rough = 54 + vein * 92 + fbmHigh * 38;
      } else if (mode === 'obsidian') {
        const swirl = Math.sin((u * 3 - v * 2 + fbmLow * 2.8) * Math.PI * 2);
        const band = Math.pow(0.5 + 0.5 * swirl, 3.0);
        const fleck = grain > 0.985 ? 24 : 0;
        const base = 24 + fbmLow * 22 + band * 14 + fbmHigh * 8 + fleck;

        r = Math.min(255, Math.max(0, base - 2));
        g = Math.min(255, Math.max(0, base));
        b = Math.min(255, Math.max(0, base + 6));

        bump = 120 + fbmHigh * 70 + (grain - 0.5) * 32;
        rough = 44 + fbmHigh * 72 + (1 - band) * 32;
      } else if (mode === 'oak') {
        const plankX = (u * 5) % 1;
        const plankIdx = Math.floor(u * 5);
        const seam = plankX < 0.04 || plankX > 0.96 ? 1 : 0;
        const ring = Math.sin((u * 14 + fbmLow * 3.5 + plankIdx * 0.7) * Math.PI * 2);
        const wood = 56 + fbmLow * 24 + ring * 10 + (grain - 0.5) * 10 - seam * 28;

        r = Math.min(255, Math.max(0, wood + 16));
        g = Math.min(255, Math.max(0, wood + 2));
        b = Math.min(255, Math.max(0, wood - 12));

        bump = 128 + ring * 35 + fbmHigh * 35 - seam * 90;
        rough = 178 + fbmHigh * 45 + seam * 25;
      } else {
        const courseY = (v * 4) % 1;
        const rowIndex = Math.floor(v * 4);
        const courseX = (u * 2 + (rowIndex % 2) * 0.5) % 1;
        const mortar =
          courseY < 0.045 ||
          courseY > 0.955 ||
          courseX < 0.025 ||
          courseX > 0.975
            ? 1
            : 0;

        const blockTint =
          hash2D(
            Math.floor(u * 2 + (rowIndex % 2) * 0.5),
            rowIndex,
            seed
          ) * 16;
        const base =
          44 +
          fbmLow * 26 +
          fbmHigh * 14 +
          blockTint -
          mortar * 22 +
          (grain - 0.5) * 10;

        r = Math.min(255, Math.max(0, base - 2));
        g = Math.min(255, Math.max(0, base));
        b = Math.min(255, Math.max(0, base + 7));

        bump =
          115 +
          fbmLow * 65 +
          fbmHigh * 55 -
          mortar * 85 +
          (grain - 0.5) * 28;
        rough = 175 + fbmHigh * 55 + mortar * 30;
      }

      colorImg.data[idx] = r;
      colorImg.data[idx + 1] = g;
      colorImg.data[idx + 2] = b;
      colorImg.data[idx + 3] = 255;

      const bVal = Math.min(255, Math.max(0, bump));
      bumpImg.data[idx] = bVal;
      bumpImg.data[idx + 1] = bVal;
      bumpImg.data[idx + 2] = bVal;
      bumpImg.data[idx + 3] = 255;

      const rVal = Math.min(255, Math.max(0, rough));
      roughImg.data[idx] = rVal;
      roughImg.data[idx + 1] = rVal;
      roughImg.data[idx + 2] = rVal;
      roughImg.data[idx + 3] = 255;
    }
  }

  colorCtx.putImageData(colorImg, 0, 0);
  bumpCtx.putImageData(bumpImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);

  return {
    map: createCanvasTexture(colorCanvas, true),
    bumpMap: createCanvasTexture(bumpCanvas, false),
    roughnessMap: createCanvasTexture(roughCanvas, false),
  };
}

let marbleCache: StoneTextureSet | null = null;
let obsidianCache: StoneTextureSet | null = null;
let chamberCache: StoneTextureSet | null = null;
let oakCache: StoneTextureSet | null = null;

export function getMarbleTextures(): StoneTextureSet {
  if (!marbleCache) {
    marbleCache = buildStoneTextureSet({ size: 256, seed: 11, mode: 'marble' });
  }
  return marbleCache;
}

export function getObsidianTextures(): StoneTextureSet {
  if (!obsidianCache) {
    obsidianCache = buildStoneTextureSet({
      size: 256,
      seed: 47,
      mode: 'obsidian',
    });
  }
  return obsidianCache;
}

export function getChamberStoneTextures(): StoneTextureSet {
  if (!chamberCache) {
    chamberCache = buildStoneTextureSet({
      size: 256,
      seed: 89,
      mode: 'chamber',
    });
  }
  return chamberCache;
}

export function getOakWoodTextures(): StoneTextureSet {
  if (!oakCache) {
    oakCache = buildStoneTextureSet({
      size: 256,
      seed: 131,
      mode: 'oak',
    });
  }
  return oakCache;
}

export function cloneTexturesWithRepeat(
  source: StoneTextureSet,
  repeatX: number,
  repeatY: number
): StoneTextureSet {
  const cloneTex = (tex: THREE.CanvasTexture) => {
    const cloned = tex.clone();
    cloned.repeat.set(repeatX, repeatY);
    cloned.needsUpdate = true;
    return cloned;
  };

  return {
    map: cloneTex(source.map),
    bumpMap: cloneTex(source.bumpMap),
    roughnessMap: cloneTex(source.roughnessMap),
  };
}
