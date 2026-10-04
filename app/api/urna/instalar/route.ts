import { corpoJson, rota } from "@/lib/server/http";
import { instalarUrna } from "@/lib/server/urnas";

// Pareamento feito uma vez pela equipe da seção (com zona e seção). O token volta só para a urna.
export const POST = rota(async (req) => instalarUrna(await corpoJson(req, 2_000)));
