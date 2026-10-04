// LABORATÓRIO — urnas de exemplo com software adulterado, prontas para simular.
// Cada uma ganha uma seção própria na zona 900 (para não se misturar às reais),
// recebe a carga e já abre a seção (zerésima). O candidato favorecido e a
// "vítima" são sorteados: o laboratório não favorece ninguém.
import { inteiroAleatorio } from "../crypto/codificacao";
import { type ModoFraude, type ParametrosFirmware, descreverFraude } from "../laboratorio/firmware-adulterado";
import { db } from "./db";
import { dadosParaCarga } from "./eleicao";
import { ErroHttp } from "./http";
import { fazerCarga } from "./operacoes";
import { abrirSecao } from "./secao";
import { instalarUrna, lerUrna } from "./urnas";

export type ModeloFraude = {
  id: string;
  titulo: string;
  modo: ModoFraude;
  percentual: number;
  /** o alvo é sorteado entre os candidatos, salvo "nulo" */
  alvo: "sorteado" | "nulo";
  vitima?: boolean;
  /** onde o eleitor pega a fraude, em casa */
  quem_pega: "teste" | "voto";
  como_pegar: string;
};

export const MODELOS: ModeloFraude[] = [
  {
    id: "desvia_tudo",
    titulo: "Desvia todos os votos e mente no teste",
    modo: "desvia",
    percentual: 100,
    alvo: "sorteado",
    quem_pega: "teste",
    como_pegar: "Teste qualquer número: em casa, a chave do teste mostra o candidato favorecido, não o que a urna declarou.",
  },
  {
    id: "desvia_metade",
    titulo: "Desvia metade dos votos",
    modo: "desvia",
    percentual: 50,
    alvo: "sorteado",
    quem_pega: "teste",
    como_pegar: "Cada teste tem 50% de chance de cair numa cédula desviada. Teste duas ou três vezes.",
  },
  {
    id: "desvia_de_um",
    titulo: "Desvia só os votos de um candidato",
    modo: "desvia",
    percentual: 100,
    alvo: "sorteado",
    vitima: true,
    quem_pega: "teste",
    como_pegar: "Só pega quem testar o candidato-vítima. Teste digitando o número dele.",
  },
  {
    id: "anula",
    titulo: "Transforma votos em NULO",
    modo: "desvia",
    percentual: 100,
    alvo: "nulo",
    quem_pega: "teste",
    como_pegar: "Teste qualquer candidato: em casa, a cédula de teste aparece como NULO.",
  },
  {
    id: "chave_falsa",
    titulo: "Desvia e imprime uma chave falsa no teste",
    modo: "chave_falsa",
    percentual: 100,
    alvo: "sorteado",
    quem_pega: "teste",
    como_pegar: "Em casa, a chave do papel não abre a cédula que a urna selou — e a urna assinou essa chave.",
  },
  {
    id: "omite_teste",
    titulo: "Desvia e some com a cédula de teste",
    modo: "omite_teste",
    percentual: 100,
    alvo: "sorteado",
    quem_pega: "teste",
    como_pegar: "Em casa, o código do teste não está no BU da seção transmitida — a urna sumiu com ele.",
  },
  {
    id: "troca_cedula",
    titulo: "Mostra o seu código, mas grava outra cédula",
    modo: "troca_cedula",
    percentual: 100,
    alvo: "sorteado",
    quem_pega: "voto",
    como_pegar: "No teste ela é honesta! Quem pega é o código do VOTO: em Verificar voto, ele não está no BU.",
  },
];

export type UrnaDeExemplo = {
  modelo: string;
  titulo: string;
  descricao: string;
  quem_pega: ModeloFraude["quem_pega"];
  como_pegar: string;
  id: string;
  nome: string;
  token: string;
  zona: string;
  secao: string;
  parametros: ParametrosFirmware;
};

/** Instala, carrega e abre as urnas de exemplo (todas, ou só os modelos pedidos). */
export function criarUrnasDeExemplo(ids?: string[]): UrnaDeExemplo[] {
  const nacional = dadosParaCarga(); // exige a eleição aberta
  const candidatos = nacional.opcoes.filter((o) => o.tipo === "candidato").map((o) => o.numero!);
  if (candidatos.length < 2) throw new ErroHttp(409, "A eleição precisa de pelo menos 2 candidatos");
  const modelos = ids?.length ? MODELOS.filter((m) => ids.includes(m.id)) : MODELOS;
  // seções livres na zona 900: continua de onde parou
  const usadas = (db("registro").prepare("SELECT secao FROM urnas WHERE zona = '900'").all() as { secao: string }[]).map((u) => Number(u.secao));
  let proxima = Math.max(0, ...usadas) + 1;
  return modelos.map((m) => {
    const sorteia = (exceto?: string) => {
      const lista = candidatos.filter((c) => c !== exceto);
      return lista[inteiroAleatorio(lista.length)];
    };
    const alvo = m.alvo === "nulo" ? "nulo" : sorteia();
    const vitima = m.vitima ? sorteia(alvo) : undefined;
    const parametros: ParametrosFirmware = { modo: m.modo, alvo, percentual: m.percentual, ...(vitima ? { vitima } : {}) };
    const secao = String(proxima++);
    const r = instalarUrna({ zona: "900", secao, nome: `Lab — ${m.titulo}`.slice(0, 40), firmware: "adulterado", ...parametros });
    const urna = lerUrna(r.id)!;
    fazerCarga(urna);
    abrirSecao(urna);
    return {
      modelo: m.id,
      titulo: m.titulo,
      descricao: descreverFraude(parametros, nacional.opcoes),
      quem_pega: m.quem_pega,
      como_pegar: m.como_pegar,
      id: r.id,
      nome: r.nome,
      token: r.token,
      zona: r.zona,
      secao: r.secao,
      parametros,
    };
  });
}
