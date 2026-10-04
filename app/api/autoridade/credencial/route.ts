import { emitirCredencial } from "@/lib/server/autoridade";
import { corpoJson, rota } from "@/lib/server/http";
import { exigirSecaoAberta } from "@/lib/server/secao";
import { autenticarUrna } from "@/lib/server/urnas";

// Terminal da mesa: recebe uma mensagem CEGA da urna e devolve a assinatura cega,
// com a chave desta seção. A autorização é a liberação do mesário para esta urna
// (ou, em contingência, um código digitado pelo eleitor nesta urna).
export const POST = rota(async (req) => {
  const urna = autenticarUrna(req.headers.get("x-urna-token"));
  exigirSecaoAberta(urna.id);
  const { codigo, mensagem_cega } = await corpoJson(req, 10_000);
  return { assinatura_cega: emitirCredencial({ urnaId: urna.id, codigo }, mensagem_cega) };
});
