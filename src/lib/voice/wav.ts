/**
 * WAV helpers shared by the browser recorder and the server route. Muse Voice Transcribe's
 * file endpoint takes mono 16-bit PCM WAV at 16 kHz or 24 kHz (Meta model cookbook,
 * 06_muse_voice/01_voice_api_fundamentals). The browser records at the device rate, so we
 * downsample to 16 kHz and encode the WAV ourselves — no codec guesswork.
 */
export const TARGET_RATE = 16_000;
export const ACCEPTED_RATES = [16_000, 24_000];
export const MAX_SECONDS = 60;

/** Averaging downsampler (box filter): good enough for speech, never upsamples. */
export function downsample(input: Float32Array, fromRate: number, toRate = TARGET_RATE): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0)) throw new Error("invalid sample rate");
  if (fromRate <= toRate) return input.slice();
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

/** Encodes mono float samples (-1..1) as a 16-bit PCM WAV file. */
export function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + dataBytes, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

export interface WavInfo { channels: number; sampleRate: number; bitsPerSample: number; dataBytes: number; durationMs: number }

/** Parses and checks a WAV header. Returns an error string for anything the endpoint would not accept. */
export function inspectWav(bytes: Uint8Array): WavInfo | { error: string } {
  if (bytes.length < 44) return { error: "not a WAV file (too short)" };
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return { error: "not a WAV file" };
  let off = 12, fmt: Omit<WavInfo, "dataBytes" | "durationMs"> | null = null, dataBytes = -1;
  while (off + 8 <= bytes.length) {
    const id = tag(off), size = v.getUint32(off + 4, true);
    if (id === "fmt ") {
      if (v.getUint16(off + 8, true) !== 1) return { error: "WAV must be PCM" };
      fmt = { channels: v.getUint16(off + 10, true), sampleRate: v.getUint32(off + 12, true), bitsPerSample: v.getUint16(off + 22, true) };
    } else if (id === "data") { dataBytes = Math.min(size, bytes.length - off - 8); break; }
    off += 8 + size + (size % 2);
  }
  if (!fmt || dataBytes < 0) return { error: "WAV is missing fmt or data" };
  if (fmt.channels !== 1) return { error: "audio must be mono" };
  if (fmt.bitsPerSample !== 16) return { error: "audio must be 16-bit" };
  if (!ACCEPTED_RATES.includes(fmt.sampleRate)) return { error: "audio must be 16 kHz or 24 kHz" };
  return { ...fmt, dataBytes, durationMs: Math.round((dataBytes / 2 / fmt.sampleRate) * 1000) };
}
