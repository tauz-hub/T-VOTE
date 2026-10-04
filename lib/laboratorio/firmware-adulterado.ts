// LABORATÓRIO — simula softwares de urna ADULTERADOS na carga (ataque interno:
// alguém de dentro troca o programa da urna antes da eleição). Este arquivo NÃO
// faz parte do software publicado na gênese — é o "programa trocado".
//
// Toda urna adulterada mostra ao eleitor o candidato que ele digitou e diz que
// o software confere. O que muda é a fraude:
//
//   desvia        cifra o candidato-alvo no lugar do escolhido (todos, uma
//                 porcentagem, ou só os votos de uma "vítima"); no teste, abre a
//                 cédula de verdade mas DECLARA o candidato do eleitor
//   chave_falsa   desvia e, no teste, imprime uma chave falsa (para a conta em
//                 casa "não fechar" e o eleitor desistir)
//   omite_teste   desvia e não guarda a cédula de teste no BU
//   troca_cedula  é honesta no teste, mas na hora de gravar troca a cédula do
//                 eleitor por outra — o código do comprovante não existe no BU
//
// O BU sai coerente com o que foi cifrado: a auditoria matemática PASSA. Quem
// pega é o eleitor em casa: "Conferir teste" (as quatro primeiras) ou
// "Verificar voto" (troca_cedula).
import { bytesAleatorios, bytesToHex, inteiroAleatorio } from "../crypto/codificacao";
import type { Opcao } from "../crypto/quadro";

export type Firmware = "oficial" | "adulterado";
export type ModoFraude = "desvia" | "chave_falsa" | "omite_teste" | "troca_cedula";
/** alvo e vítima: número do candidato, "branco" ou "nulo". */
export type ParametrosFirmware = { modo?: ModoFraude; alvo: string; percentual: number; vitima?: string };

export const MODOS: ModoFraude[] = ["desvia", "chave_falsa", "omite_teste", "troca_cedula"];

export function indiceDaOpcao(valor: string | undefined, opcoes: Opcao[]): number {
  if (!valor) return -1;
  if (valor === "branco" || valor === "nulo") return opcoes.findIndex((o) => o.tipo === valor);
  return opcoes.findIndex((o) => o.numero === valor);
}

const nomeAlvo = (valor: string | undefined, opcoes?: Opcao[]) => {
  if (valor === "branco") return "BRANCO";
  if (valor === "nulo") return "NULO";
  const o = opcoes?.find((x) => x.numero === valor);
  return o ? `${o.numero} (${o.nome})` : `nº ${valor}`;
};

/** A opção que a urna realmente cifra. A oficial cifra a escolha do eleitor. */
export function opcaoParaCifrar(firmware: Firmware, p: ParametrosFirmware | undefined, opcaoEleitor: number, opcoes: Opcao[]): number {
  if (firmware !== "adulterado" || !p || p.modo === "troca_cedula") return opcaoEleitor;
  const alvo = indiceDaOpcao(p.alvo, opcoes);
  if (alvo < 0 || alvo === opcaoEleitor) return opcaoEleitor;
  if (p.vitima && indiceDaOpcao(p.vitima, opcoes) !== opcaoEleitor) return opcaoEleitor;
  return inteiroAleatorio(100) < (p.percentual ?? 100) ? alvo : opcaoEleitor;
}

/** O que a urna DIZ que havia na cédula testada. A oficial diz a verdade. */
export function opcaoDeclaradaNoTeste(firmware: Firmware, opcaoEleitor: number, opcaoAberta: number): number {
  return firmware === "adulterado" ? opcaoEleitor : opcaoAberta;
}

/** A chave impressa no papel do teste. A oficial imprime a verdadeira. */
export function sementeImpressaNoTeste(firmware: Firmware, p: ParametrosFirmware | undefined, sementeReal: string): string {
  return firmware === "adulterado" && p?.modo === "chave_falsa" ? bytesToHex(bytesAleatorios(16)) : sementeReal;
}

/** A urna "esquece" de guardar a cédula de teste no BU? */
export function omiteTeste(firmware: Firmware | undefined, p: ParametrosFirmware | undefined): boolean {
  return firmware === "adulterado" && p?.modo === "omite_teste";
}

/** Na hora de gravar, troca a cédula do eleitor por uma do alvo? Devolve o índice do alvo, ou null. */
export function trocaCedulaNoDeposito(firmware: Firmware, p: ParametrosFirmware | undefined, opcoes: Opcao[]): number | null {
  if (firmware !== "adulterado" || p?.modo !== "troca_cedula") return null;
  const alvo = indiceDaOpcao(p.alvo, opcoes);
  return alvo >= 0 ? alvo : null;
}

/** Descrição curta da fraude, para o laboratório. */
export function descreverFraude(p: ParametrosFirmware, opcoes?: Opcao[]): string {
  const alvo = nomeAlvo(p.alvo, opcoes);
  const quanto = p.vitima ? `os votos de ${nomeAlvo(p.vitima, opcoes)}` : p.percentual >= 100 ? "todos os votos" : `${p.percentual}% dos votos`;
  switch (p.modo ?? "desvia") {
    case "desvia":
      return `Desvia ${quanto} para ${alvo} e mente no teste.`;
    case "chave_falsa":
      return `Desvia ${quanto} para ${alvo}, mente no teste e imprime uma chave falsa.`;
    case "omite_teste":
      return `Desvia ${quanto} para ${alvo}, mente no teste e some com a cédula de teste.`;
    case "troca_cedula":
      return `Mostra o código da sua cédula, mas grava outra cédula para ${alvo}. No teste é honesta.`;
  }
}
