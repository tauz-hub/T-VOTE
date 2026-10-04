import { corpoJson, rota } from "@/lib/server/http";
import { selarNaUrna } from "@/lib/server/secao";
import { autenticarUrna } from "@/lib/server/urnas";

// A urna lacrou a cédula e a sela com a PRÓPRIA chave (offline). Do selo saem
// as figuras e o código de verificação.
export const POST = rota(async (req) => {
  const urna = autenticarUrna(req.headers.get("x-urna-token"));
  return selarNaUrna(await corpoJson(req, 10_000), urna);
});
