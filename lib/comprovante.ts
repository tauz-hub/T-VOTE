// Leitura do comprovante impresso: o eleitor cola (ou digita) o texto do papel
// e daqui saem os dados de cada TESTE DA URNA — código, chave, candidato que a
// urna declarou e a declaração assinada. Isomórfico: site, validador offline e CLI.
import { chaveTesteParaTexto, formatarCodigo, formatarConferencia, lerChaveTeste, lerCodigo } from "./crypto/palavras";
import type { Opcao } from "./crypto/quadro";

export type TesteDoPapel = {
  /** código de 12 caracteres, normalizado (ou o texto digitado, se inválido) */
  codigo: string;
  /** chave da cédula de teste em hex (16 bytes), ou "" se não deu para ler */
  chave: string;
  /** o que está impresso depois de "continha:" — número do candidato, "branco" ou "nulo" */
  declarado: string;
  /** assinatura da urna sobre a declaração (128 caracteres hex), se constar */
  assinatura: string;
};

/** O texto da parte dos testes, como sai impresso (o que o eleitor copiaria do papel). */
export function textoDosTestes(
  testes: { codigo: string; conferencia: string; declaracao: { opcao: number; semente: string; assinatura: string } }[],
  opcoes: Opcao[],
): string {
  return testes
    .map((t, i) => {
      const o = opcoes[t.declaracao.opcao];
      return [
        `TESTE DA URNA ${i + 1} — ANULADO, NÃO É VOTO`,
        "A urna declara que a cédula testada continha:",
        `${o?.numero ? `${o.numero} — ` : ""}${o?.nome ?? "?"}`,
        `CÓDIGO DO TESTE: ${formatarCodigo(t.codigo)}`,
        `CONFERÊNCIA: ${formatarConferencia(t.conferencia)}`,
        "CHAVE DO TESTE:",
        chaveTesteParaTexto(t.declaracao.semente),
        `Declaração assinada pela urna: ${t.declaracao.assinatura}`,
      ].join("\n");
    })
    .join("\n\n");
}

/** Normaliza o que está escrito como candidato declarado: "80 — Samara Martins" → "80". */
export function lerDeclarado(texto: string): string {
  const t = texto.trim();
  const numero = t.match(/^(\d{2})\b/);
  if (numero) return numero[1];
  if (/^branco/i.test(t)) return "branco";
  if (/^nulo/i.test(t)) return "nulo";
  return "";
}

/** Assinatura escrita em várias linhas → 128 caracteres hex (ou ""). */
export function lerAssinatura(texto: string): string {
  const h = texto.toLowerCase().replace(/[^0-9a-f]/g, "");
  return h.length === 128 ? h : "";
}

/**
 * Extrai os testes do texto do comprovante. Cada bloco começa em "TESTE DA URNA";
 * o resto do papel (código do voto, hash) é ignorado.
 */
export function lerTestesDoComprovante(texto: string): TesteDoPapel[] {
  const blocos = texto.split(/TESTE DA URNA/i).slice(1);
  return blocos.map((b) => {
    const codigo = b.match(/C[ÓO]DIGO DO TESTE:\s*([0-9A-Za-z .\-·]{12,24})/i)?.[1] ?? "";
    const chave = b.match(/CHAVE DO TESTE:\s*([\s\S]*?)(?:Declara|$)/i)?.[1] ?? "";
    const declarado = b.match(/continha:\s*([^\n]+)/i)?.[1] ?? "";
    // a assinatura ocupa várias linhas: junta só as linhas que são inteiramente hexadecimais
    let assinatura = "";
    const depois = b.split(/assinada pela urna:/i)[1];
    if (depois !== undefined) {
      for (const linha of depois.split(/\r?\n/)) {
        const l = linha.trim();
        if (!l) continue;
        if (!/^[0-9a-fA-F]+$/.test(l) || assinatura.length >= 128) break;
        assinatura += l;
      }
    }
    return {
      codigo: lerCodigo(codigo) ?? codigo.trim(),
      chave: lerChaveTeste(chave) ?? "",
      declarado: lerDeclarado(declarado),
      assinatura: lerAssinatura(assinatura),
    };
  });
}
