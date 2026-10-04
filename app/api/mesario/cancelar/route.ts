import { corpoJson, rota } from "@/lib/server/http";
import { cancelarLiberacao } from "@/lib/server/urnas";

export const POST = rota(async (req) => {
  const { urna_id } = await corpoJson<{ urna_id: string }>(req);
  cancelarLiberacao(String(urna_id));
});
