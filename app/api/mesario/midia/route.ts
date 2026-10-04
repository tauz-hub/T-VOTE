import { ErroHttp } from "@/lib/server/http";
import { midiaDaSecao } from "@/lib/server/secao";

// A mídia de resultado em arquivo — o "pen drive" que sai da seção.
export async function GET(req: Request) {
  try {
    const urnaId = new URL(req.url).searchParams.get("urna_id") ?? "";
    const midia = midiaDaSecao(urnaId);
    return new Response(JSON.stringify(midia), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="midia-secao-${midia.bu.conteudo.secao}.json"`,
      },
    });
  } catch (e) {
    if (e instanceof ErroHttp) return Response.json({ erro: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ erro: "Erro interno no servidor" }, { status: 500 });
  }
}
