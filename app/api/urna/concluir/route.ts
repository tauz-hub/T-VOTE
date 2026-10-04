import { rota } from "@/lib/server/http";
import { autenticarUrna, concluirVotacaoNaUrna } from "@/lib/server/urnas";

export const POST = rota((req) => concluirVotacaoNaUrna(autenticarUrna(req.headers.get("x-urna-token")).id));
