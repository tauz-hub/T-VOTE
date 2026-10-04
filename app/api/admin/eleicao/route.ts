import { descartarBackup } from "@/lib/server/ataques";
import { abrirEleicao, criarEleicao, encerrarEleicao, secoesSemMidia } from "@/lib/server/eleicao";
import { ErroHttp, corpoJson, rota } from "@/lib/server/http";

export const POST = rota(async (req) => {
  // até 20 candidatos com foto (≤ 300 KB cada, em base64)
  const corpo = await corpoJson(req, 10_000_000);
  switch (corpo.acao) {
    case "criar":
      descartarBackup();
      return criarEleicao(corpo);
    case "abrir":
      return abrirEleicao();
    case "encerrar": {
      const faltam = secoesSemMidia();
      if (faltam.length && corpo.forcar !== true)
        throw new ErroHttp(409, "Há seções com carga que ainda não transmitiram a mídia", faltam.map((s) => `seção ${s}`));
      return encerrarEleicao();
    }
    default:
      throw new ErroHttp(400, "Ação desconhecida");
  }
});
