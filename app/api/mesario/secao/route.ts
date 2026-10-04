import { ErroHttp, corpoJson, rota } from "@/lib/server/http";
import { fazerCarga, transmitirSecao } from "@/lib/server/operacoes";
import { abrirSecao, encerrarSecao } from "@/lib/server/secao";
import { lerUrna } from "@/lib/server/urnas";

// O mesário conduz a seção como hoje: abre (zerésima), encerra (BU) e entrega a mídia.
export const POST = rota(async (req) => {
  const { urna_id, acao } = await corpoJson<{ urna_id: string; acao: string }>(req);
  const urna = lerUrna(String(urna_id));
  if (!urna) throw new ErroHttp(404, "Urna não encontrada");
  switch (acao) {
    case "carga":
      return { bloco: fazerCarga(urna).numero };
    case "abrir":
      return { zeresima: abrirSecao(urna) };
    case "encerrar":
      if (urna.estado !== "livre") throw new ErroHttp(409, "Há um eleitor liberado ou votando — aguarde ele terminar (ou cancele a liberação)");
      return { bu: encerrarSecao(urna).hash };
    case "transmitir":
      return { bloco: (await transmitirSecao(urna)).numero };
    default:
      throw new ErroHttp(400, "Ação desconhecida");
  }
});
