import { corpoJson, rota } from "@/lib/server/http";
import { MODELOS, criarUrnasDeExemplo } from "@/lib/server/laboratorio";

// Laboratório: catálogo de fraudes e criação das urnas de exemplo (instaladas, com carga e seção aberta).
export const GET = rota(() => ({ modelos: MODELOS }));

export const POST = rota(async (req) => {
  const { modelos } = await corpoJson<{ modelos?: string[] }>(req);
  return { urnas: criarUrnasDeExemplo(Array.isArray(modelos) ? modelos.map(String) : undefined) };
});
