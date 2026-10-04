import { corpoJson, rota } from "@/lib/server/http";
import { cadastrarEleitor, listarEleitores } from "@/lib/server/registro";

export const GET = rota((req) => ({ eleitores: listarEleitores(new URL(req.url).searchParams.get("busca") ?? "") }));

export const POST = rota(async (req) => ({ eleitor: cadastrarEleitor(await corpoJson(req)) }));
