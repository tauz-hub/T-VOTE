import { estadoPublico } from "@/lib/server/eleicao";
import { rota } from "@/lib/server/http";

export const GET = rota(() => estadoPublico());
