import { corpoJson, rota } from "@/lib/server/http";
import { habilitarEleitor } from "@/lib/server/registro";

// Contingência: código de uso único que o eleitor digita numa urna com a seção aberta.
export const POST = rota(async (req) => {
  const { eleitor_id } = await corpoJson<{ eleitor_id: number }>(req);
  return habilitarEleitor(Number(eleitor_id));
});
