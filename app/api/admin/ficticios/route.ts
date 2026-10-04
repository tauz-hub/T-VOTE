import { corpoJson, rota } from "@/lib/server/http";
import { gerarEleitoresFicticios } from "@/lib/server/registro";

export const POST = rota(async (req) => {
  const { quantidade } = await corpoJson<{ quantidade: number }>(req);
  return { criados: gerarEleitoresFicticios(Number(quantidade) || 20) };
});
