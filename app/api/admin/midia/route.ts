import type { MidiaSecao } from "@/lib/crypto/secao";
import { receberMidia } from "@/lib/server/eleicao";
import { corpoJson, rota } from "@/lib/server/http";
import { marcarTransmitidaPorMidia } from "@/lib/server/secao";

// TSE recebe uma mídia de seção por arquivo (pen drive). Confere tudo antes de publicar.
export const POST = rota(async (req) => {
  const { midia } = await corpoJson<{ midia: MidiaSecao }>(req, 50_000_000);
  const b = await receberMidia(midia);
  marcarTransmitidaPorMidia(midia, b.numero);
  return { bloco: b.numero, secao: b.conteudo.secao };
});
