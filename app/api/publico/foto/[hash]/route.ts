import type { NextRequest } from "next/server";
import { lerFoto } from "@/lib/server/fotos";

// Foto de candidato, endereçada pelo hash publicado na gênese.
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/publico/foto/[hash]">) {
  const { hash } = await ctx.params;
  const foto = lerFoto(hash);
  if (!foto) return new Response("Foto não encontrada", { status: 404 });
  return new Response(new Uint8Array(foto.bytes), { headers: { "content-type": foto.mime } });
}
