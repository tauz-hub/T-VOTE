import type { CedulaDesafiada } from "@/lib/crypto/cedula";
import { corpoJson, rota } from "@/lib/server/http";
import { testarNaUrna } from "@/lib/server/secao";
import { autenticarUrna } from "@/lib/server/urnas";

// Cédula de teste: a urna guarda a abertura para o BU e assina o que declarou ao eleitor.
export const POST = rota(async (req) => {
  const urna = autenticarUrna(req.headers.get("x-urna-token"));
  const { desafiada, opcao_declarada, semente_impressa } = await corpoJson<{ desafiada: CedulaDesafiada; opcao_declarada: number; semente_impressa?: string }>(
    req,
    200_000,
  );
  return testarNaUrna(desafiada, opcao_declarada, urna, semente_impressa);
});
