import { pacotePublico } from "@/lib/server/eleicao";

// Pacote público da eleição: a cadeia de blocos completa. É o que "sai" da
// rede eleitoral (mídia controlada) para auditores independentes.
export function GET(req: Request) {
  const pacote = pacotePublico();
  const baixar = new URL(req.url).searchParams.has("baixar");
  return new Response(JSON.stringify(pacote, null, baixar ? 2 : 0), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(baixar ? { "content-disposition": 'attachment; filename="pacote-eleicao.json"' } : {}),
    },
  });
}
