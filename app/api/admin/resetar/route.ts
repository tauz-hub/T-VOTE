import { resetarTudo } from "@/lib/server/admin";
import { rota } from "@/lib/server/http";

export const POST = rota(() => resetarTudo());
