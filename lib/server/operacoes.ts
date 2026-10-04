// Os ÚNICOS dois momentos em que a seção e o TSE se encontram:
//
//   antes   carga: a urna gera as chaves dela e o TSE publica as públicas no quadro
//   depois  mídia: zerésima + BU assinados pela urna chegam ao TSE e são conferidos
//
// Entre um e outro (o dia inteiro de votação) a urna e a mesa trabalham sozinhas.
import type { Bloco } from "../crypto/quadro";
import { dadosParaCarga, receberMidia, registrarCarga, verificarCargaPossivel } from "./eleicao";
import { gerarCarga, marcarTransmitida, midiaDaSecao, secaoDaUrna } from "./secao";
import type { LinhaUrna } from "./urnas";

/** Cerimônia de carga (no TRE, antes da eleição). */
export function fazerCarga(urna: LinhaUrna) {
  const nacional = dadosParaCarga();
  verificarCargaPossivel(secaoDaUrna(urna));
  const carga = gerarCarga(urna, nacional);
  return registrarCarga(carga);
}

/** Leva a mídia da urna ao TSE (transmissão ou pen drive). */
export async function transmitirSecao(urna: LinhaUrna): Promise<Bloco<"SECAO">> {
  const bloco = await receberMidia(midiaDaSecao(urna.id));
  marcarTransmitida(urna.id, bloco.numero);
  return bloco;
}
