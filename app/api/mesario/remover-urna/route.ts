import { corpoJson, rota } from "@/lib/server/http";
import { removerUrna } from "@/lib/server/urnas";

export const POST = rota(async (req) => {
  const { urna_id } = await corpoJson<{ urna_id: string }>(req);
  removerUrna(String(urna_id));
});
