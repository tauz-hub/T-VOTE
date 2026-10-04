import { corpoJson, rota } from "@/lib/server/http";
import { alterarAptidao } from "@/lib/server/registro";

export const POST = rota(async (req) => {
  const { id, apto } = await corpoJson<{ id: number; apto: boolean }>(req);
  alterarAptidao(Number(id), !!apto);
});
