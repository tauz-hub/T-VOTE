import { rota } from "@/lib/server/http";
import { fazerCarga } from "@/lib/server/operacoes";
import { autenticarUrna } from "@/lib/server/urnas";

// Cerimônia de carga: a urna gera a própria chave e o TSE publica a pública (antes da eleição).
export const POST = rota((req) => {
  const b = fazerCarga(autenticarUrna(req.headers.get("x-urna-token")));
  return { bloco: b.numero };
});
