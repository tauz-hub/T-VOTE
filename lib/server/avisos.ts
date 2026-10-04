// Aviso instantâneo de mudança de estado das urnas (long-poll).
//
// A urna pergunta "mudou alguma coisa desde <estado>?" e o servidor segura a
// resposta até a mesa mexer na urna (ou 25 s). Assim a urna reage na hora,
// mesmo numa aba em segundo plano — onde o navegador congela timers, mas não
// respostas de rede.
type Memoria = { __taiVoteEspera?: Map<string, Set<() => void>> };
const memoria = globalThis as unknown as Memoria;
const espera = (memoria.__taiVoteEspera ??= new Map());

/** Acorda quem espera por esta urna. */
export function notificarUrna(urnaId: string) {
  const fila = espera.get(urnaId);
  if (!fila) return;
  espera.delete(urnaId);
  for (const acordar of fila) acordar();
}

/** Acorda todas as urnas (ex.: eleição nova, encerramento). */
export function notificarTodasUrnas() {
  for (const id of [...espera.keys()]) notificarUrna(id);
}

/** Espera até ser notificado, até o tempo limite ou até o cliente desistir. */
export function esperarAviso(urnaId: string, ms: number, sinal?: AbortSignal): Promise<void> {
  return new Promise((resolver) => {
    const fila = espera.get(urnaId) ?? new Set<() => void>();
    espera.set(urnaId, fila);
    const acordar = () => {
      clearTimeout(relogio);
      fila.delete(acordar);
      sinal?.removeEventListener("abort", acordar);
      resolver();
    };
    const relogio = setTimeout(acordar, ms);
    fila.add(acordar);
    sinal?.addEventListener("abort", acordar);
  });
}
