import { receberDecifracaoParcial } from "@/lib/server/eleicao";
import { corpoJson, rota } from "@/lib/server/http";

export const POST = rota(async (req) => receberDecifracaoParcial(await corpoJson(req, 100_000)));
