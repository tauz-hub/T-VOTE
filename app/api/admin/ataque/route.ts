import { ATAQUES, type TipoAtaque, aplicarAtaque, existeBackup, restaurarBackup } from "@/lib/server/ataques";
import { corpoJson, rota } from "@/lib/server/http";

export const GET = rota(() => ({ ataques: ATAQUES, adulterado: existeBackup() }));

export const POST = rota(async (req) => {
  const { tipo } = await corpoJson<{ tipo: string }>(req);
  if (tipo === "restaurar") {
    restaurarBackup();
    return { resumo: "Boletim restaurado ao estado anterior aos ataques" };
  }
  return { resumo: aplicarAtaque(tipo as TipoAtaque) };
});
