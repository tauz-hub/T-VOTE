"use client";

// Sons da urna, sintetizados na hora (Web Audio) — nenhum arquivo de áudio.
// Imitam o estilo da urna: bipe curto a cada tecla e a sequência rápida de
// bipes terminando num tom longo no FIM. Além de familiar, o som orienta quem
// não enxerga bem a tela.

let contexto: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    contexto ??= new AudioContext();
    // navegadores só liberam áudio depois de um gesto do usuário (a primeira tecla)
    if (contexto.state === "suspended") void contexto.resume();
    return contexto;
  } catch {
    return null;
  }
}

/** Um bipe: frequência (Hz), início relativo (s) e duração (s). */
function bipe(ctx: AudioContext, freq: number, inicio: number, duracao: number, volume = 0.18) {
  const osc = ctx.createOscillator();
  const ganho = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  const t0 = ctx.currentTime + inicio;
  // envelope curto para não estalar
  ganho.gain.setValueAtTime(0, t0);
  ganho.gain.linearRampToValueAtTime(volume, t0 + 0.005);
  ganho.gain.setValueAtTime(volume, t0 + duracao - 0.01);
  ganho.gain.linearRampToValueAtTime(0, t0 + duracao);
  osc.connect(ganho).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duracao + 0.02);
}

/** Tecla numérica, BRANCO e CORRIGE. */
export function somTecla() {
  const ctx = audio();
  if (ctx) bipe(ctx, 1000, 0, 0.07);
}

/** CONFIRMA e botões de decisão (depositar, testar). */
export function somConfirma() {
  const ctx = audio();
  if (!ctx) return;
  bipe(ctx, 1000, 0, 0.06);
  bipe(ctx, 1000, 0.09, 0.06);
}

/** FIM: sequência rápida de bipes terminando num tom mais longo. */
export function somFim() {
  const ctx = audio();
  if (!ctx) return;
  const notas = [880, 1175, 880, 1175, 880];
  notas.forEach((f, i) => bipe(ctx, f, i * 0.09, 0.07));
  bipe(ctx, 1175, notas.length * 0.09 + 0.02, 0.5);
}

/** Aviso de problema (ex.: a urna errou no teste). */
export function somAlerta() {
  const ctx = audio();
  if (!ctx) return;
  bipe(ctx, 300, 0, 0.25, 0.22);
  bipe(ctx, 300, 0.32, 0.25, 0.22);
}
