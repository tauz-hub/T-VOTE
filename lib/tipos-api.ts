import type { Contagem, Opcao } from "./crypto/quadro";
import type { ChaveRSAPublica } from "./crypto/rsa-cega";
import type { DocumentoUrna, ZeresimaSecao } from "./crypto/secao";
import type { ParametrosFirmware } from "./laboratorio/firmware-adulterado";

export type FaseEleicao = "configuracao" | "aberta" | "encerrada" | "apurada";
export type FaseSecao = "carregada" | "aberta" | "encerrada" | "transmitida";

/** Estado do quadro nacional (TSE). A urna NÃO usa isto durante a votação. */
export type EstadoPublico = {
  existe: boolean;
  eleicao_id?: string;
  nome?: string;
  fase?: FaseEleicao;
  opcoes?: Opcao[];
  hash_eleicao?: string | null;
  chave_publica?: string | null;
  chave_quadro?: string;
  software?: string;
  /** o código em execução neste servidor é o mesmo publicado na gênese? */
  software_confere?: boolean;
  software_alterados?: string[];
  versao_protocolo?: number;
  trustees: { trustee: number; nome: string; chave_publica: string }[];
  decifracoes: number[];
  estatisticas: {
    eleitores: number;
    aptos: number;
    habilitados: number;
    credenciados: number;
    credenciais_emitidas: number;
    secoes_carregadas: number;
    secoes_transmitidas: number;
    cedulas_publicadas: number;
    desafiadas_publicadas: number;
    blocos: number;
  };
  /** seções conhecidas pelo quadro: com carga e, depois, com mídia */
  secoes: { secao: string; urna: string; transmitida: boolean; bloco?: number; cedulas?: number; desafiadas?: number }[];
  cabeca?: { numero: number; hash: string; tipo: string };
  resultado?: { opcao: Opcao; votos: number }[];
};

/** O que o BU traz, sem as cédulas (para imprimir). */
export type ResumoBU = {
  hash: string;
  assinatura: string;
  comparecimento: number;
  cedulas: number;
  desafiadas: number;
  contagem: Contagem;
  encerrada_em: string;
};

/** Carga da urna: tudo o que ela precisa para votar sem falar com o TSE. */
export type CargaUrna = {
  eleicao_id: string;
  nome: string;
  hash_eleicao: string;
  chave_publica: string;
  opcoes: Opcao[];
  software: string;
  urna: string;
  autoridade_secao: ChaveRSAPublica;
  secao: string;
  fase: FaseSecao;
  chave_urna: string;
  bloco: number | null;
  zeresima?: DocumentoUrna<ZeresimaSecao>;
  bu?: ResumoBU;
};

/** Resposta de /api/urna/estado: a urna só conversa com a própria memória e com a mesa. */
export type EstadoUrnaApi = {
  id: string;
  nome: string;
  estado: "livre" | "liberada" | "votando";
  zona: string;
  secao: string;
  marca: string;
  firmware: "oficial" | "adulterado";
  parametros?: ParametrosFirmware;
  /** o que o TRE oferece para a carga (antes da eleição) */
  eleicao: { existe: boolean; eleicao_id?: string; nome?: string; fase?: FaseEleicao };
  carga: CargaUrna | null;
  software_confere?: boolean;
  software_alterados?: string[];
};

/** Urna vista pelo terminal do mesário. */
export type UrnaMesa = {
  id: string;
  nome: string;
  estado: "livre" | "liberada" | "votando";
  zona: string;
  secao: string;
  online: boolean;
  eleitor: string | null;
  carga: CargaUrna | null;
  comparecimento: number;
};
