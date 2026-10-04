import { NextResponse, type NextRequest } from "next/server";

// "A rede de blocos deve ocorrer dentro da segurança": o sistema roda numa rede
// eleitoral isolada. O servidor escuta só em 127.0.0.1 (ver package.json) e,
// além disso, recusa qualquer Host que não seja local — isso bloqueia ataques
// de DNS rebinding, em que um site da Internet tenta falar com o servidor
// local através do navegador.
//
// Para uma rede local isolada com várias máquinas (mesário, urna, auditoria),
// liste os hosts permitidos em T_VOTE_HOSTS (ex.: "192.168.0.10,urna.local").
const PERMITIDOS = new Set(
  ["localhost", "127.0.0.1", "[::1]", ...(process.env.T_VOTE_HOSTS ?? "").split(",")]
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  if (!PERMITIDOS.has(host)) {
    return new NextResponse("Rede eleitoral isolada: acesso permitido apenas a partir de hosts autorizados.", {
      status: 403,
    });
  }
  return NextResponse.next();
}
