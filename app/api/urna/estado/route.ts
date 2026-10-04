import { rota } from "@/lib/server/http";
import { blocosDoTipo, estadoInterno } from "@/lib/server/quadro";
import { cargaDaUrna, marcaDaUrna } from "@/lib/server/secao";
import { compararSoftware, hashDoSoftwareAtual } from "@/lib/server/software";
import { type ParametrosFirmware, aguardarEstado, autenticarUrna } from "@/lib/server/urnas";
import type { EstadoUrnaApi } from "@/lib/tipos-api";

// A urna pergunta à própria memória e à mesa: "estou liberada? em que fase está a seção?".
// A resposta nunca inclui quem é o eleitor. Com ?aguardar=<marca>, só responde quando
// algo mudar (long-poll). O único dado do TSE aqui é a eleição disponível para a carga.
export const GET = rota(async (req): Promise<EstadoUrnaApi> => {
  let u = autenticarUrna(req.headers.get("x-urna-token"));
  const conhecido = new URL(req.url).searchParams.get("aguardar");
  if (conhecido) u = await aguardarEstado(u, conhecido, req.signal, marcaDaUrna);
  const e = estadoInterno();
  const g = blocosDoTipo("GENESE")[0]?.conteudo;
  const carga = cargaDaUrna(u.id, e?.eleicao_id);
  const software = carga && g ? compararSoftware(g.software, hashDoSoftwareAtual()) : undefined;
  return {
    id: u.id,
    nome: u.nome,
    estado: u.estado,
    zona: u.zona,
    secao: u.secao,
    marca: marcaDaUrna(u),
    firmware: u.firmware,
    ...(u.firmware_parametros ? { parametros: JSON.parse(u.firmware_parametros) as ParametrosFirmware } : {}),
    eleicao: e && g ? { existe: true, eleicao_id: e.eleicao_id, nome: g.nome, fase: e.fase } : { existe: false },
    carga,
    ...(software ? { software_confere: software.confere, software_alterados: software.alterados } : {}),
  };
});
