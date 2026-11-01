"use client";

import { useEffect, useRef, useState } from "react";
import { downsample, encodeWav16, MAX_SECONDS, TARGET_RATE } from "@/lib/voice/wav";
import { Badge, Button } from "./ui";

type Phase = "idle" | "recording" | "sending" | "done" | "error";

interface TranscribeResponse { ok: boolean; source: "meta" | "test" | "none"; model?: string; transcript?: string; latencyMs?: number; reason?: string; error?: string }

/**
 * Push-to-talk dictation: microphone → 16 kHz mono WAV in the browser → server → Meta Muse Voice
 * Transcribe → editable text. Nothing is processed until the user reviews the transcript and
 * adds the enquiry. Speech-to-text only; the app never acts on voice by itself.
 */
export function VoiceDictation({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [secs, setSecs] = useState(0);
  const [lang, setLang] = useState<"auto" | "english">("auto");
  const [info, setInfo] = useState<string>("");
  const [source, setSource] = useState<"meta" | "test" | "none">("none");
  const rec = useRef<{ stream: MediaStream; ctx: AudioContext; node: ScriptProcessorNode; chunks: Float32Array[]; rate: number; timer: number; started: number } | null>(null);

  useEffect(() => () => cleanup(), []);

  function cleanup() {
    const r = rec.current;
    if (!r) return;
    window.clearInterval(r.timer);
    r.node.disconnect();
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx.close().catch(() => {});
    rec.current = null;
  }

  async function start() {
    setInfo("");
    setSource("none");
    if (!navigator.mediaDevices?.getUserMedia) { setPhase("error"); setInfo("This browser cannot record audio. Type the message instead."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      const mute = ctx.createGain(); mute.gain.value = 0;
      src.connect(node); node.connect(mute); mute.connect(ctx.destination);
      const started = Date.now();
      const timer = window.setInterval(() => {
        const s = Math.floor((Date.now() - started) / 1000);
        setSecs(s);
        if (s >= MAX_SECONDS) void stop();
      }, 250);
      rec.current = { stream, ctx, node, chunks, rate: ctx.sampleRate, timer, started };
      setSecs(0);
      setPhase("recording");
    } catch (e) {
      setPhase("error");
      setInfo((e as Error).name === "NotAllowedError" ? "Microphone blocked: permission was denied or this page may not use the microphone. Allow it in the browser's site settings, or type the message." : `Could not start the microphone (${(e as Error).message}).`);
    }
  }

  async function stop() {
    const r = rec.current;
    if (!r) return;
    const { chunks, rate } = r;
    cleanup();
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(total);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    if (total / rate < 0.5) { setPhase("error"); setInfo("That was too short. Hold the button a little longer while speaking."); return; }
    const wav = encodeWav16(downsample(all, rate, TARGET_RATE), TARGET_RATE);
    setPhase("sending");
    try {
      const res = await fetch(`/api/ai/transcribe?lang=${lang}`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: new Blob([new Uint8Array(wav)], { type: "audio/wav" }) });
      const body = (await res.json()) as TranscribeResponse;
      if (!res.ok || !body.ok || !body.transcript) { setPhase("error"); setInfo(body.reason ?? body.error ?? "Transcription failed. Type the message instead."); return; }
      onTranscript(body.transcript);
      setPhase("done");
      setSource(body.source);
      setInfo(
        body.source === "meta"
          ? `✓ Live Meta AI · Muse Voice Transcribe · ${body.model ?? ""}${body.latencyMs ? ` · ${(body.latencyMs / 1000).toFixed(1)} s` : ""} — check and edit the text before adding.`
          : "LOCAL TEST — MOCK RESPONSE · not Meta AI. This text did not come from Meta's speech recognition.",
      );
    } catch (e) {
      setPhase("error");
      setInfo(`Transcription request failed (${(e as Error).message}). Type the message instead.`);
    }
  }

  return (
    <div className="space-y-1.5" data-testid="voice">
      <div className="flex flex-wrap items-center gap-2">
        {phase === "recording" ? (
          <Button variant="danger" onClick={() => void stop()} aria-label="Stop recording">● Recording {secs}s — tap to stop</Button>
        ) : (
          <Button variant="secondary" onClick={() => void start()} disabled={phase === "sending"} aria-label="Speak the enquiry">
            {phase === "sending" ? "Transcribing…" : "🎤 Speak the enquiry"}
          </Button>
        )}
        <select aria-label="Language hint" className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs" value={lang} onChange={(e) => setLang(e.target.value as "auto" | "english")} disabled={phase === "recording" || phase === "sending"}>
          <option value="auto">Language: auto-detect</option>
          <option value="english">Language: English</option>
        </select>
        <Badge>Meta Muse Voice Transcribe</Badge>
      </div>
      {info && (
        <p className={phase === "error" || (phase === "done" && source !== "meta") ? "text-xs font-medium text-red-700" : "text-xs text-emerald-800"} data-testid="voice-info" data-source={phase === "done" ? source : "none"}>
          {info}
        </p>
      )}
    </div>
  );
}
