import { credenciaisEmitidas } from "@/lib/server/autoridade";
import { secoesSemMidia } from "@/lib/server/eleicao";
import { rota } from "@/lib/server/http";
import { estadoInterno } from "@/lib/server/quadro";
import { resumoDasUrnas } from "@/lib/server/secao";
import { lerUrna } from "@/lib/server/urnas";

// Visão do laboratório: o que cada urna tem na memória e se a mídia já chegou.
export const GET = rota(() => {
  const e = estadoInterno();
  const urnas = resumoDasUrnas(e?.eleicao_id).map((s) => {
    const u = lerUrna(s.urna_id);
    return { ...s, nome: u?.nome ?? "(urna removida)", estado: u?.estado ?? "livre", firmware: u?.firmware ?? "oficial", comparecimento: credenciaisEmitidas(s.urna_id) };
  });
  return { urnas, sem_midia: e?.fase === "aberta" ? secoesSemMidia() : [] };
});
