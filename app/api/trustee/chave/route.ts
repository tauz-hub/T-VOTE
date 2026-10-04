import { registrarChaveTrustee } from "@/lib/server/eleicao";
import { corpoJson, rota } from "@/lib/server/http";

// Recebe apenas a chave PÚBLICA e a prova Schnorr. A privada fica com o trustee.
export const POST = rota(async (req) => registrarChaveTrustee(await corpoJson(req, 10_000)));
