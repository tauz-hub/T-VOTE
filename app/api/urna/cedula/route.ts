import type { Cedula } from "@/lib/crypto/cedula";
import { corpoJson, rota } from "@/lib/server/http";
import { depositarNaUrna } from "@/lib/server/secao";
import { autenticarUrna } from "@/lib/server/urnas";

// Depósito na memória da urna (offline): a cédula cifrada e +1 no contador da opção.
export const POST = rota(async (req) => {
  const urna = autenticarUrna(req.headers.get("x-urna-token"));
  const { cedula, opcao } = await corpoJson<{ cedula: Cedula; opcao: number }>(req, 200_000);
  return { recibo: depositarNaUrna(cedula, opcao, urna) };
});
