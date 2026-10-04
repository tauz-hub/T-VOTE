import { corpoJson, rota } from "@/lib/server/http";
import { exigirSecaoAberta } from "@/lib/server/secao";
import { liberarUrna } from "@/lib/server/urnas";

export const POST = rota(async (req) => {
  const { urna_id, eleitor_id } = await corpoJson<{ urna_id: string; eleitor_id: number }>(req);
  exigirSecaoAberta(String(urna_id));
  liberarUrna(String(urna_id), Number(eleitor_id));
});
