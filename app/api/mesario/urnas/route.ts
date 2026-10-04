import { credenciaisEmitidas } from "@/lib/server/autoridade";
import { rota } from "@/lib/server/http";
import { estadoInterno } from "@/lib/server/quadro";
import { cargaDaUrna } from "@/lib/server/secao";
import { listarUrnas } from "@/lib/server/urnas";
import type { UrnaMesa } from "@/lib/tipos-api";

// O painel do terminal do mesário: urnas pareadas, fase da seção e comparecimento.
export const GET = rota(() => {
  const eleicaoId = estadoInterno()?.eleicao_id;
  const urnas: UrnaMesa[] = listarUrnas().map((u) => ({ ...u, carga: cargaDaUrna(u.id, eleicaoId), comparecimento: credenciaisEmitidas(u.id) }));
  return { urnas };
});
