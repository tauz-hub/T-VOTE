import { despejarBancos } from "@/lib/server/admin";
import { rota } from "@/lib/server/http";

export const GET = rota(() => despejarBancos());
