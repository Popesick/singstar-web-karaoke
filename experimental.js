// ---------------------------------------------------------------------
// "Experimentell": KI-Gesangstrennung (Demucs/htdemucs, als ONNX-Modell
// komplett im Browser), Tonhöhen-Anzeige/Scoring im SingStar-Stil, und
// bestmögliche automatische Songtext-Erkennung.
//
// Bewusst als eigenständiges Modul/eigener Mini-Player gehalten, getrennt
// von der YouTube/Lokale-Datei-Wiedergabe in app.js: die Gesangstrennung
// läuft komplett lokal im Browser (kein Server, kein Upload), ist aber
// rechenintensiv (CPU-Inferenz eines echten neuronalen Netzes) und
// experimentell in Qualität/Geschwindigkeit — das soll sauber vom
// stabilen Hauptpfad isoliert bleiben.
//
// Das verwendete ONNX-Modell ist ein von der Community bereitgestellter
// Export von Metas quelloffenem Demucs/htdemucs (MIT-Lizenz, siehe
// https://github.com/facebookresearch/demucs). Die hier verwendete
// Vorverarbeitung (STFT: n_fft=4096, hop=1024, Hann-Fenster, normalized,
// center-pad reflect) wurde 1:1 aus dem Original-Python-Quellcode
// (demucs/htdemucs.py, demucs/spec.py) übernommen, da es dafür keine
// fertige JS-Bibliothek gibt.
(function () {
  'use strict';

  const MODEL_URL = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';
  const SAMPLE_RATE = 44100;
  const SEGMENT_LENGTH = 343980; // model's fixed input length = 7.8s @ 44100Hz
  const OVERLAP = 0.25;
  const STRIDE = Math.round(SEGMENT_LENGTH * (1 - OVERLAP)); // 257985
  const SOURCE_NAMES = ['drums', 'bass', 'other', 'vocals'];

  // -----------------------------------------------------------------
  // IndexedDB: tracks (metadata) + blobs (original/vocals/instrumental
  // audio, stored as WAV) + a one-time cache of the ~180MB ONNX model
  // so it's only downloaded once per browser, not once per song.
  // -----------------------------------------------------------------
  const DB_NAME = 'singstar-experimental';
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('model')) db.createObjectStore('model', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function idbRequest(storeName, mode, fn) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  function putTrack(track) { return idbRequest('tracks', 'readwrite', (s) => s.put(track)); }
  function getTrack(id) { return idbRequest('tracks', 'readonly', (s) => s.get(id)); }
  function deleteTrackRow(id) { return idbRequest('tracks', 'readwrite', (s) => s.delete(id)); }
  function getAllTracks() { return idbRequest('tracks', 'readonly', (s) => s.getAll()); }
  function putBlob(key, blob) { return idbRequest('blobs', 'readwrite', (s) => s.put({ key, blob })); }
  function getBlob(key) { return idbRequest('blobs', 'readonly', (s) => s.get(key)).then((r) => r && r.blob); }
  function deleteBlob(key) { return idbRequest('blobs', 'readwrite', (s) => s.delete(key)); }

  // -----------------------------------------------------------------
  // FFT / STFT — exact port of demucs' HTDemucs._spec() preprocessing.
  // See demucs/spec.py (spectro()) and demucs/htdemucs.py (_spec()).
  // -----------------------------------------------------------------
  function fft(re, im, invert) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = ((2 * Math.PI) / len) * (invert ? -1 : 1);
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let curWr = 1, curWi = 0;
        for (let j = 0; j < len / 2; j++) {
          const ur = re[i + j], ui = im[i + j];
          const vr = re[i + j + len / 2] * curWr - im[i + j + len / 2] * curWi;
          const vi = re[i + j + len / 2] * curWi + im[i + j + len / 2] * curWr;
          re[i + j] = ur + vr; im[i + j] = ui + vi;
          re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
          const nWr = curWr * wr - curWi * wi;
          curWi = curWr * wi + curWi * wr;
          curWr = nWr;
        }
      }
    }
    if (invert) {
      for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    }
  }

  function reflectPad(samples, padLeft, padRight) {
    const n = samples.length;
    const out = new Float64Array(n + padLeft + padRight);
    for (let i = 0; i < padLeft; i++) out[i] = samples[padLeft - i];
    for (let i = 0; i < n; i++) out[padLeft + i] = samples[i];
    for (let i = 0; i < padRight; i++) out[padLeft + n + i] = samples[n - 2 - i];
    return out;
  }

  let hannCache = null;
  function hannWindow(n) {
    if (hannCache && hannCache.length === n) return hannCache;
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    hannCache = w;
    return w;
  }

  function torchStft(signal, nfft, hop) {
    const win = hannWindow(nfft);
    const centerPad = nfft >> 1;
    const padded = reflectPad(signal, centerPad, centerPad);
    const nFrames = Math.floor((padded.length - nfft) / hop) + 1;
    const freqs = nfft / 2 + 1;
    const re = new Array(freqs), im = new Array(freqs);
    for (let f = 0; f < freqs; f++) { re[f] = new Float64Array(nFrames); im[f] = new Float64Array(nFrames); }
    const frameRe = new Float64Array(nfft), frameIm = new Float64Array(nfft);
    const norm = 1 / Math.sqrt(nfft);
    for (let t = 0; t < nFrames; t++) {
      const start = t * hop;
      for (let i = 0; i < nfft; i++) { frameRe[i] = padded[start + i] * win[i]; frameIm[i] = 0; }
      fft(frameRe, frameIm, false);
      for (let f = 0; f < freqs; f++) { re[f][t] = frameRe[f] * norm; im[f][t] = frameIm[f] * norm; }
    }
    return { re, im, nFrames, freqs };
  }

  // One channel's samples -> cropped complex spectrogram, [2048 bins][le frames]
  function demucsSpec(channelSamples, nfft) {
    nfft = nfft || 4096;
    const hl = nfft / 4;
    const le = Math.ceil(channelSamples.length / hl);
    const pad = (hl >> 1) * 3;
    const padRight = pad + le * hl - channelSamples.length;
    const padded = reflectPad(channelSamples, pad, padRight);
    const { re, im, nFrames, freqs } = torchStft(padded, nfft, hl);
    if (nFrames !== le + 4) throw new Error('STFT frame mismatch');
    const outBins = freqs - 1;
    const reOut = new Array(outBins), imOut = new Array(outBins);
    for (let f = 0; f < outBins; f++) { reOut[f] = re[f].slice(2, 2 + le); imOut[f] = im[f].slice(2, 2 + le); }
    return { re: reOut, im: imOut, bins: outBins, frames: le };
  }

  // -----------------------------------------------------------------
  // Model loading (cached in IndexedDB after first download) + chunked
  // separation of a full track with triangular-weighted overlap-add,
  // exactly matching demucs.apply.apply_model()'s default (overlap=0.25,
  // transition_power=1 i.e. a plain triangular crossfade).
  // -----------------------------------------------------------------
  let ortSessionPromise = null;

  async function loadOrtRuntime() {
    if (window.ort) return window.ort;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('onnxruntime-web konnte nicht geladen werden'));
      document.body.appendChild(s);
    });
    return window.ort;
  }

  async function getModelBytes(onProgress) {
    const cached = await idbRequest('model', 'readonly', (s) => s.get('demucs-htdemucs'));
    if (cached && cached.blob) return cached.blob.arrayBuffer();

    const resp = await fetch(MODEL_URL);
    if (!resp.ok) throw new Error(`Modell-Download fehlgeschlagen: HTTP ${resp.status}`);
    const total = Number(resp.headers.get('content-length')) || 0;
    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (onProgress && total) onProgress(received / total);
    }
    const blob = new Blob(chunks);
    await idbRequest('model', 'readwrite', (s) => s.put({ key: 'demucs-htdemucs', blob }));
    return blob.arrayBuffer();
  }

  // Browsers deliberately do not expose which exact chip is running (M1 vs.
  // M2 vs. ... vs. M5 — that's fingerprinting surface), so there is no such
  // thing as per-generation code here. What IS detectable and meaningful:
  // whether WebGPU is backed by an Apple GPU at all (same acceleration path
  // on every Apple-Silicon Mac, whichever generation) — used only to show an
  // honest status, not to branch logic.
  let accelInfoPromise = null;
  async function detectAccelerationInfo() {
    if (accelInfoPromise) return accelInfoPromise;
    accelInfoPromise = (async () => {
      if (!navigator.gpu) return { backend: 'none', label: 'Kein WebGPU verfügbar – läuft auf der CPU (WASM), deutlich langsamer.' };
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return { backend: 'none', label: 'WebGPU-Adapter nicht verfügbar – läuft auf der CPU (WASM), deutlich langsamer.' };
        const info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : null);
        const vendor = ((info && (info.vendor || info.architecture)) || '').toLowerCase();
        const isApple = vendor.includes('apple') || /mac/i.test(navigator.platform || '') && vendor === '';
        return {
          backend: 'webgpu',
          isApple,
          label: isApple
            ? 'Apple-GPU über WebGPU erkannt – Gesangstrennung läuft GPU-beschleunigt (gilt gleichermaßen für alle M-Chip-Generationen).'
            : `WebGPU aktiv${vendor ? ` (GPU: ${vendor})` : ''} – Gesangstrennung läuft GPU-beschleunigt.`,
        };
      } catch (err) {
        return { backend: 'none', label: 'WebGPU-Prüfung fehlgeschlagen – läuft auf der CPU (WASM), deutlich langsamer.' };
      }
    })();
    return accelInfoPromise;
  }

  async function getOrtSession(onModelProgress) {
    if (ortSessionPromise) return ortSessionPromise;
    ortSessionPromise = (async () => {
      const ort = await loadOrtRuntime();
      const bytes = await getModelBytes(onModelProgress);
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/';
      // Plain single-threaded WASM is dramatically slower than a GPU backend
      // for a transformer model like this (tens of seconds per 7.8s segment,
      // so tens of minutes for a full song) — prefer WebGPU where the browser
      // supports it, falling back to WASM everywhere else. GitHub Pages can't
      // set the COOP/COEP headers multi-threaded WASM would need, so WebGPU
      // is the only realistic speedup available here. 'webnn' is included as
      // a best-effort extra attempt (could reach e.g. the Apple Neural Engine
      // on supporting systems) — still experimental and unsupported in most
      // current browsers, so it's expected to just be silently dropped.
      if (navigator.gpu) {
        try {
          return await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu', 'wasm'] });
        } catch (err) {
          console.warn('WebGPU-Ausführung fehlgeschlagen, falle auf WASM zurück:', err);
        }
      }
      if (navigator.ml) {
        try {
          return await ort.InferenceSession.create(bytes, { executionProviders: ['webnn', 'wasm'] });
        } catch (err) {
          console.warn('WebNN-Ausführung fehlgeschlagen, falle auf WASM zurück:', err);
        }
      }
      return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    })();
    return ortSessionPromise;
  }

  function triangularWeight(len) {
    const w = new Float64Array(len);
    const half = len >> 1;
    for (let i = 0; i < half; i++) w[i] = i + 1;
    for (let i = half; i < len; i++) w[i] = len - i;
    let max = 0;
    for (let i = 0; i < len; i++) if (w[i] > max) max = w[i];
    for (let i = 0; i < len; i++) w[i] /= max;
    return w;
  }

  // Resample an AudioBuffer to 44.1kHz stereo via OfflineAudioContext
  // (built into the browser — far more reliable than a hand-rolled
  // resampler) and return [Float32Array left, Float32Array right].
  async function decodeToStereo441(arrayBuffer) {
    const probeCtx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await probeCtx.decodeAudioData(arrayBuffer.slice(0));
    probeCtx.close();
    const offline = new OfflineAudioContext(2, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    const left = rendered.getChannelData(0);
    const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : rendered.getChannelData(0);
    return [Float32Array.from(left), Float32Array.from(right)];
  }

  function buildXTensor(ort, segL, segR) {
    const specL = demucsSpec(segL);
    const specR = demucsSpec(segR);
    const bins = specL.bins, frames = specL.frames;
    const data = new Float32Array(4 * bins * frames);
    let ci = 0;
    for (const spec of [specL, specR]) {
      for (const part of [spec.re, spec.im]) {
        for (let f = 0; f < bins; f++) {
          const row = part[f];
          const base = ci * bins * frames + f * frames;
          for (let t = 0; t < frames; t++) data[base + t] = row[t];
        }
        ci++;
      }
    }
    return new ort.Tensor('float32', data, [1, 4, bins, frames]);
  }

  function buildInputTensor(ort, segL, segR) {
    const data = new Float32Array(2 * SEGMENT_LENGTH);
    data.set(segL, 0);
    data.set(segR, SEGMENT_LENGTH);
    return new ort.Tensor('float32', data, [1, 2, SEGMENT_LENGTH]);
  }

  // Separates a full stereo track into { vocals: [L,R], instrumental: [L,R] }
  // (instrumental = drums+bass+other summed), via sliding 7.8s segments with
  // triangular-weighted overlap-add. onProgress(fraction) is called per segment.
  async function separateFull(leftFull, rightFull, onProgress, onModelProgress) {
    const ort = await loadOrtRuntime();
    const session = await getOrtSession(onModelProgress);
    const length = leftFull.length;
    const weight = triangularWeight(SEGMENT_LENGTH);

    const vocalsL = new Float64Array(length), vocalsR = new Float64Array(length);
    const instL = new Float64Array(length), instR = new Float64Array(length);
    const sumWeight = new Float64Array(length);

    const offsets = [];
    for (let o = 0; o < length; o += STRIDE) offsets.push(o);

    for (let idx = 0; idx < offsets.length; idx++) {
      const offset = offsets[idx];
      const segL = new Float32Array(SEGMENT_LENGTH);
      const segR = new Float32Array(SEGMENT_LENGTH);
      const avail = Math.min(SEGMENT_LENGTH, length - offset);
      segL.set(leftFull.subarray(offset, offset + avail));
      segR.set(rightFull.subarray(offset, offset + avail));

      const inputTensor = buildInputTensor(ort, segL, segR);
      const xTensor = buildXTensor(ort, segL, segR);
      const results = await session.run({ input: inputTensor, x: xTensor });
      const out = results.add_67; // [1,4,2,SEGMENT_LENGTH]: sources x channels x samples
      const S = out.dims[1], C = out.dims[2], N = out.dims[3];
      const chunkLen = Math.min(avail, N);

      for (let i = 0; i < chunkLen; i++) {
        const w = weight[i];
        const base = offset + i;
        // sources order: 0=drums 1=bass 2=other 3=vocals
        const drumsL = out.data[(0 * C + 0) * N + i];
        const bassL = out.data[(1 * C + 0) * N + i];
        const otherL = out.data[(2 * C + 0) * N + i];
        const vocL = out.data[(3 * C + 0) * N + i];
        const drumsR = out.data[(0 * C + 1) * N + i];
        const bassR = out.data[(1 * C + 1) * N + i];
        const otherR = out.data[(2 * C + 1) * N + i];
        const vocR = out.data[(3 * C + 1) * N + i];
        instL[base] += (drumsL + bassL + otherL) * w;
        instR[base] += (drumsR + bassR + otherR) * w;
        vocalsL[base] += vocL * w;
        vocalsR[base] += vocR * w;
        sumWeight[base] += w;
      }
      if (onProgress) onProgress((idx + 1) / offsets.length);
      // Yield to the event loop between segments so the UI/progress bar stays responsive.
      await new Promise((r) => setTimeout(r, 0));
    }

    for (let i = 0; i < length; i++) {
      const w = sumWeight[i] || 1;
      vocalsL[i] /= w; vocalsR[i] /= w;
      instL[i] /= w; instR[i] /= w;
    }
    return {
      vocals: [Float32Array.from(vocalsL), Float32Array.from(vocalsR)],
      instrumental: [Float32Array.from(instL), Float32Array.from(instR)],
    };
  }

  // -----------------------------------------------------------------
  // Minimal WAV encoder (16-bit PCM) — avoids needing an MP3 encoder
  // library just to persist separated stems locally.
  // -----------------------------------------------------------------
  function encodeWav(left, right, sampleRate) {
    const numFrames = left.length;
    const blockAlign = 4; // 2 channels * 16-bit
    const dataSize = numFrames * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    function writeStr(offset, str) { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); }
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 2, true); // channels
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);
    let off = 44;
    for (let i = 0; i < numFrames; i++) {
      const l = Math.max(-1, Math.min(1, left[i]));
      const r = Math.max(-1, Math.min(1, right[i]));
      view.setInt16(off, l < 0 ? l * 0x8000 : l * 0x7fff, true); off += 2;
      view.setInt16(off, r < 0 ? r * 0x8000 : r * 0x7fff, true); off += 2;
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  // -----------------------------------------------------------------
  // Pitch detection: autocorrelation with parabolic interpolation.
  // Good enough for a karaoke-style scoring display, not studio-grade.
  // -----------------------------------------------------------------
  function detectPitch(buf, sampleRate, minHz, maxHz) {
    minHz = minHz || 70; maxHz = maxHz || 1000;
    const n = buf.length;
    let rms = 0;
    for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / n);
    if (rms < 0.01) return null; // too quiet / silence

    const maxLag = Math.floor(sampleRate / minHz);
    const minLag = Math.floor(sampleRate / maxHz);
    let bestLag = -1, bestCorr = 0;
    for (let lag = minLag; lag <= maxLag && lag < n; lag++) {
      let corr = 0;
      for (let i = 0; i < n - lag; i++) corr += buf[i] * buf[i + lag];
      corr /= (n - lag);
      if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
    }
    if (bestLag <= 0 || bestCorr < 0.01) return null;

    // parabolic interpolation around bestLag using neighboring correlations
    function corrAt(lag) {
      if (lag < 1 || lag >= n) return 0;
      let c = 0;
      for (let i = 0; i < n - lag; i++) c += buf[i] * buf[i + lag];
      return c / (n - lag);
    }
    const c0 = corrAt(bestLag - 1), c1 = bestCorr, c2 = corrAt(bestLag + 1);
    const denom = (c0 - 2 * c1 + c2);
    const shift = denom !== 0 ? (0.5 * (c0 - c2)) / denom : 0;
    const refinedLag = bestLag + Math.max(-1, Math.min(1, shift));
    return sampleRate / refinedLag;
  }

  function freqToMidi(freq) { return 69 + 12 * Math.log2(freq / 440); }

  // -----------------------------------------------------------------
  // UI wiring
  // -----------------------------------------------------------------
  const els = {};
  function q(id) { return document.getElementById(id); }

  function init() {
    els.btnExperimental = q('btnExperimental');
    els.experimentalModal = q('experimentalModal');
    els.btnExperimentalClose = q('btnExperimentalClose');
    els.expUploadInput = q('expUploadInput');
    els.expTrackList = q('expTrackList');
    els.expVocalVolume = q('expVocalVolume');
    els.expVocalVolumeVal = q('expVocalVolumeVal');
    els.expPitchCanvas = q('expPitchCanvas');
    els.expPlayerArea = q('expPlayerArea');
    els.expNowPlayingName = q('expNowPlayingName');
    els.expLyricsBox = q('expLyricsBox');
    els.expScoreVal = q('expScoreVal');
    els.expAccelStatus = q('expAccelStatus');

    if (!els.btnExperimental) return; // HTML not present (shouldn't happen)

    els.btnExperimental.addEventListener('click', () => {
      els.experimentalModal.classList.remove('hidden');
      renderTrackList();
      detectAccelerationInfo().then((info) => {
        if (els.expAccelStatus) {
          els.expAccelStatus.textContent = info.label;
          els.expAccelStatus.style.color = info.backend === 'none' ? 'var(--danger)' : 'var(--ok)';
        }
      });
    });
    els.btnExperimentalClose.addEventListener('click', () => {
      els.experimentalModal.classList.add('hidden');
      stopPlayback();
    });
    els.experimentalModal.addEventListener('click', (e) => {
      if (e.target === els.experimentalModal) { els.experimentalModal.classList.add('hidden'); stopPlayback(); }
    });

    const savedVolRaw = localStorage.getItem('exp-vocal-volume');
    const savedVol = savedVolRaw === null ? NaN : Number(savedVolRaw);
    els.expVocalVolume.value = Number.isFinite(savedVol) && savedVol >= 0 ? savedVol : 100;
    els.expVocalVolumeVal.textContent = els.expVocalVolume.value;
    els.expVocalVolume.addEventListener('input', () => {
      els.expVocalVolumeVal.textContent = els.expVocalVolume.value;
      localStorage.setItem('exp-vocal-volume', els.expVocalVolume.value);
      if (vocalGainNode) vocalGainNode.gain.value = Number(els.expVocalVolume.value) / 100;
    });

    els.expUploadInput.addEventListener('change', async () => {
      const file = els.expUploadInput.files[0];
      els.expUploadInput.value = '';
      if (!file) return;
      await uploadTrack(file);
    });

    resetOrphanedSeparations().then(renderTrackList);
  }

  // A track stuck on "separating" means a previous tab/session died mid-run
  // (closed, reloaded, crashed) — nothing can still be in flight for it after
  // a fresh page load, so reset it back to "uploaded" instead of leaving the
  // user with a dead progress bar and no way to retry.
  async function resetOrphanedSeparations() {
    const tracks = await getAllTracks();
    await Promise.all(tracks
      .filter((t) => t.status === 'separating')
      .map((t) => { t.status = 'uploaded'; t.progress = 0; return putTrack(t); }));
  }

  function fmtDuration(sec) {
    if (!sec) return '';
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  async function uploadTrack(file) {
    const id = `t${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    const track = {
      id,
      name: file.name.replace(/\.[^.]+$/, ''),
      addedAt: Date.now(),
      status: 'uploaded',
      durationSec: null,
      lyrics: '',
    };
    await putBlob(`${id}-original`, file);
    await putTrack(track);
    renderTrackList();
  }

  async function renderTrackList() {
    const tracks = (await getAllTracks()).sort((a, b) => b.addedAt - a.addedAt);
    els.expTrackList.innerHTML = '';
    if (!tracks.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Noch keine Tracks hochgeladen.';
      els.expTrackList.appendChild(p);
      return;
    }
    for (const track of tracks) {
      els.expTrackList.appendChild(renderTrackRow(track));
    }
  }

  function renderTrackRow(track) {
    const row = document.createElement('div');
    row.className = 'exp-track-row';

    const nameEl = document.createElement('div');
    nameEl.className = 'exp-track-name';
    nameEl.textContent = track.name + (track.durationSec ? ` (${fmtDuration(track.durationSec)})` : '');
    row.appendChild(nameEl);

    const statusEl = document.createElement('div');
    statusEl.className = 'exp-track-status hint';
    const statusText = {
      uploaded: 'Hochgeladen – noch nicht getrennt',
      separating: 'Gesang wird getrennt…',
      separated: 'Gesang getrennt ✓',
      error: 'Fehler bei der Trennung',
    }[track.status] || track.status;
    statusEl.textContent = statusText;
    row.appendChild(statusEl);

    if (track.status === 'separating') {
      const bar = document.createElement('div');
      bar.className = 'exp-progress';
      const fill = document.createElement('div');
      fill.className = 'exp-progress-fill';
      fill.style.width = `${Math.round((track.progress || 0) * 100)}%`;
      bar.appendChild(fill);
      row.appendChild(bar);
    }

    const actions = document.createElement('div');
    actions.className = 'exp-track-actions';

    if (track.status === 'uploaded' || track.status === 'error') {
      const btn = document.createElement('button');
      btn.className = 'btn small primary';
      btn.textContent = 'Gesang trennen';
      btn.addEventListener('click', () => startSeparation(track.id));
      actions.appendChild(btn);
    }

    if (track.status === 'separated') {
      const playBtn = document.createElement('button');
      playBtn.className = 'btn small primary';
      playBtn.textContent = 'Abspielen / Mitsingen';
      playBtn.addEventListener('click', () => playTrack(track));
      actions.appendChild(playBtn);

      const lyricsBtn = document.createElement('button');
      lyricsBtn.className = 'btn small ghost';
      lyricsBtn.textContent = track.lyrics ? 'Text neu erkennen' : 'Text erkennen (Beta)';
      lyricsBtn.title = 'Spielt den Gesang über die Lautsprecher ab und hört per Mikrofon mit (Web Speech API hat keinen Datei-Zugriff).';
      lyricsBtn.addEventListener('click', () => recognizeLyrics(track));
      actions.appendChild(lyricsBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'btn small ghost';
    delBtn.textContent = 'Löschen';
    delBtn.addEventListener('click', () => deleteTrackFull(track.id));
    actions.appendChild(delBtn);

    row.appendChild(actions);

    if (track.lyrics) {
      const lyricsPreview = document.createElement('p');
      lyricsPreview.className = 'hint exp-lyrics-preview';
      lyricsPreview.textContent = track.lyrics;
      row.appendChild(lyricsPreview);
    }

    return row;
  }

  async function deleteTrackFull(id) {
    await deleteTrackRow(id);
    await Promise.all([
      deleteBlob(`${id}-original`).catch(() => {}),
      deleteBlob(`${id}-vocals`).catch(() => {}),
      deleteBlob(`${id}-instrumental`).catch(() => {}),
    ]);
    renderTrackList();
  }

  async function startSeparation(id) {
    const track = await getTrack(id);
    track.status = 'separating';
    track.progress = 0;
    await putTrack(track);
    renderTrackList();

    try {
      const originalBlob = await getBlob(`${id}-original`);
      const arrayBuffer = await originalBlob.arrayBuffer();
      const [left, right] = await decodeToStereo441(arrayBuffer);
      track.durationSec = left.length / SAMPLE_RATE;

      const onModelProgress = (frac) => {
        track.status = 'separating';
        track.progress = frac * 0.3; // model download counts as first 30%
        putTrack(track).then(renderTrackList);
      };
      const onSegmentProgress = (frac) => {
        track.progress = 0.3 + frac * 0.7;
        putTrack(track).then(renderTrackList);
      };

      const { vocals, instrumental } = await separateFull(left, right, onSegmentProgress, onModelProgress);

      const vocalsBlob = encodeWav(vocals[0], vocals[1], SAMPLE_RATE);
      const instBlob = encodeWav(instrumental[0], instrumental[1], SAMPLE_RATE);
      await putBlob(`${id}-vocals`, vocalsBlob);
      await putBlob(`${id}-instrumental`, instBlob);

      track.status = 'separated';
      track.pitchCurve = computePitchCurve(vocals[0], SAMPLE_RATE);
      await putTrack(track);
      showExpToast('Gesang getrennt: "' + track.name + '"');
    } catch (err) {
      console.error(err);
      track.status = 'error';
      await putTrack(track);
      showExpToast('Trennung fehlgeschlagen: ' + err.message, true);
    }
    renderTrackList();
  }

  function computePitchCurve(samples, sampleRate) {
    const hop = Math.round(sampleRate * 0.05); // 50ms steps
    const win = 2048;
    const curve = [];
    for (let i = 0; i + win < samples.length; i += hop) {
      const freq = detectPitch(samples.subarray(i, i + win), sampleRate);
      curve.push({ t: i / sampleRate, midi: freq ? freqToMidi(freq) : null });
    }
    return curve;
  }

  function showExpToast(msg, isError) {
    const toast = document.getElementById('toast');
    if (!toast) { console.log(msg); return; }
    toast.textContent = msg;
    toast.className = 'toast show' + (isError ? ' error' : '');
    setTimeout(() => { toast.className = 'toast'; }, 4000);
  }

  // -----------------------------------------------------------------
  // Playback + live pitch scoring
  // -----------------------------------------------------------------
  let playCtx = null;
  let vocalGainNode = null;
  let instGainNode = null;
  let vocalSourceNode = null;
  let instSourceNode = null;
  let micStream = null;
  let micAnalyser = null;
  let micDataBuf = null;
  let scoreLoopHandle = null;
  let playStartTime = 0;
  let currentTrack = null;
  let scoreHits = 0, scoreTotal = 0;

  async function playTrack(track) {
    stopPlayback();
    currentTrack = track;
    els.expPlayerArea.classList.remove('hidden');
    els.expNowPlayingName.textContent = track.name;
    els.expLyricsBox.textContent = track.lyrics || '(kein erkannter Text)';

    const [vocalsBlob, instBlob] = await Promise.all([
      getBlob(`${track.id}-vocals`),
      getBlob(`${track.id}-instrumental`),
    ]);

    playCtx = new (window.AudioContext || window.webkitAudioContext)();
    const [vocalsBuf, instBuf] = await Promise.all([
      playCtx.decodeAudioData(await vocalsBlob.arrayBuffer()),
      playCtx.decodeAudioData(await instBlob.arrayBuffer()),
    ]);

    vocalGainNode = playCtx.createGain();
    vocalGainNode.gain.value = Number(els.expVocalVolume.value) / 100;
    instGainNode = playCtx.createGain();
    instGainNode.gain.value = 1;

    vocalSourceNode = playCtx.createBufferSource();
    vocalSourceNode.buffer = vocalsBuf;
    vocalSourceNode.connect(vocalGainNode).connect(playCtx.destination);

    instSourceNode = playCtx.createBufferSource();
    instSourceNode.buffer = instBuf;
    instSourceNode.connect(instGainNode).connect(playCtx.destination);

    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const micSource = playCtx.createMediaStreamSource(micStream);
      micAnalyser = playCtx.createAnalyser();
      micAnalyser.fftSize = 2048;
      micSource.connect(micAnalyser);
      micDataBuf = new Float32Array(micAnalyser.fftSize);
    } catch (err) {
      showExpToast('Kein Mikrofonzugriff – Tonhöhen-Scoring läuft ohne Live-Vergleich.', true);
    }

    scoreHits = 0; scoreTotal = 0;
    playStartTime = playCtx.currentTime;
    vocalSourceNode.start();
    instSourceNode.start();
    vocalSourceNode.onended = () => { if (currentTrack === track) stopPlayback(); };

    startScoreLoop(track);
  }

  function stopPlayback() {
    if (scoreLoopHandle) { cancelAnimationFrame(scoreLoopHandle); scoreLoopHandle = null; }
    [vocalSourceNode, instSourceNode].forEach((n) => { if (n) try { n.stop(); } catch (e) { /* noop */ } });
    vocalSourceNode = null; instSourceNode = null;
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
    if (playCtx) { playCtx.close().catch(() => {}); playCtx = null; }
    currentTrack = null;
    if (els.expPlayerArea) els.expPlayerArea.classList.add('hidden');
  }

  function startScoreLoop(track) {
    const canvas = els.expPitchCanvas;
    const ctx2d = canvas.getContext('2d');
    const pxPerSec = 80;
    const curve = track.pitchCurve || [];
    const minMidi = 48, maxMidi = 84; // display range ~C3-C6

    function midiToY(midi, h) {
      const clamped = Math.max(minMidi, Math.min(maxMidi, midi));
      return h - ((clamped - minMidi) / (maxMidi - minMidi)) * h;
    }

    function loop() {
      if (!playCtx) return;
      const now = playCtx.currentTime - playStartTime;
      const w = canvas.width, h = canvas.height;
      ctx2d.clearRect(0, 0, w, h);

      // reference pitch curve, scrolling so "now" sits at a fixed x position
      const nowX = w * 0.3;
      ctx2d.fillStyle = '#5ac8fa';
      for (const pt of curve) {
        if (pt.midi == null) continue;
        const x = nowX + (pt.t - now) * pxPerSec;
        if (x < -20 || x > w + 20) continue;
        const y = midiToY(pt.midi, h);
        ctx2d.fillRect(x, y - 4, Math.max(2, pxPerSec * 0.05), 8);
      }

      // playhead
      ctx2d.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx2d.beginPath(); ctx2d.moveTo(nowX, 0); ctx2d.lineTo(nowX, h); ctx2d.stroke();

      // live mic pitch
      if (micAnalyser) {
        micAnalyser.getFloatTimeDomainData(micDataBuf);
        const freq = detectPitch(micDataBuf, playCtx.sampleRate);
        if (freq) {
          const liveMidi = freqToMidi(freq);
          const y = midiToY(liveMidi, h);
          ctx2d.fillStyle = '#ff2fa0';
          ctx2d.beginPath(); ctx2d.arc(nowX, y, 7, 0, Math.PI * 2); ctx2d.fill();

          const ref = curve.find((p) => Math.abs(p.t - now) < 0.05 && p.midi != null);
          if (ref) {
            scoreTotal++;
            if (Math.abs(ref.midi - liveMidi) < 1.0) scoreHits++;
          }
        }
      }

      if (els.expScoreVal) {
        els.expScoreVal.textContent = scoreTotal > 0 ? `${Math.round((scoreHits / scoreTotal) * 100)}%` : '–';
      }

      scoreLoopHandle = requestAnimationFrame(loop);
    }
    scoreLoopHandle = requestAnimationFrame(loop);
  }

  // -----------------------------------------------------------------
  // Best-effort lyrics recognition via the free Web Speech API.
  // Important constraint: SpeechRecognition only listens to the live
  // microphone, it cannot read an audio file/blob directly — so this
  // plays the vocal stem out loud while listening via the mic, which
  // only works in a quiet room with the mic active and picks up
  // whatever acoustic path exists between speakers and mic.
  // -----------------------------------------------------------------
  async function recognizeLyrics(track) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showExpToast('Spracherkennung wird von diesem Browser nicht unterstützt (funktioniert z.B. in Chrome).', true);
      return;
    }
    showExpToast('Texterkennung läuft – Lautsprecher hörbar lassen, Raum möglichst leise halten…');

    const recognition = new SpeechRecognition();
    recognition.lang = 'de-DE';
    recognition.continuous = true;
    recognition.interimResults = false;

    let transcript = '';
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) transcript += event.results[i][0].transcript + ' ';
      }
    };
    recognition.onerror = (event) => console.warn('SpeechRecognition error', event.error);

    const vocalsBlob = await getBlob(`${track.id}-vocals`);
    const audioEl = new Audio(URL.createObjectURL(vocalsBlob));
    audioEl.volume = 1;

    recognition.start();
    audioEl.play();
    await new Promise((resolve) => { audioEl.onended = resolve; });
    recognition.stop();

    track.lyrics = transcript.trim() || '(keine Erkennung – Raum zu leise/laut, oder Browser unterstützt Deutsch nicht gut)';
    await putTrack(track);
    renderTrackList();
    if (els.expLyricsBox && currentTrack && currentTrack.id === track.id) els.expLyricsBox.textContent = track.lyrics;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
