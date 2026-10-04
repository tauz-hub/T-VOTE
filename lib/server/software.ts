// Hash do software que toca o voto, publicado na gênese (como a zerésima publica
// o estado inicial). Duas conferências usam isto:
//
//  • a urna mostra se o código em execução é o mesmo publicado na gênese;
//  • o auditor de linha de comando recalcula o hash dos SEUS arquivos e compara.
//
// Limite honesto: um software adulterado pode mentir sobre o próprio hash. Esta
// conferência pega troca de arquivos depois da zerésima; contra um atacante que
// adultera também a conferência, a defesa é testar o COMPORTAMENTO da urna
// (desafio) e auditar a matemática por fora — ver /seguranca.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { jsonCanonico, sha256Hex } from "../crypto/codificacao";

// O software da seção: urna (tela + memória), terminal da mesa e os papéis impressos.
// lib/laboratorio (o "programa trocado" do laboratório) fica de fora de propósito.
const PASTAS = ["lib/crypto", "lib/client"];
const ARQUIVOS = [
  "lib/auditoria.ts",
  "lib/tipos-api.ts",
  "lib/server/secao.ts",
  "lib/server/autoridade.ts",
  "components/Urna.tsx",
  "components/FotoCandidato.tsx",
  "components/Palavras.tsx",
  "components/Comprovante.tsx",
  "components/Impressos.tsx",
  "components/VerificacaoNaUrna.tsx",
  "app/urna/page.tsx",
  "app/cabine/page.tsx",
  "app/mesario/page.tsx",
  "app/terminal/page.tsx",
  "components/TerminalMesario.tsx",
];

export type HashSoftware = { hash: string; arquivos: Record<string, string> };

export function hashDoSoftware(raiz = process.cwd()): HashSoftware {
  const relativos = [
    ...PASTAS.flatMap((p) =>
      readdirSync(path.join(raiz, p))
        .filter((f) => f.endsWith(".ts"))
        .map((f) => `${p}/${f}`),
    ),
    ...ARQUIVOS,
  ].sort();
  const arquivos: Record<string, string> = {};
  for (const rel of relativos) {
    try {
      // normaliza quebras de linha para o hash não depender do sistema operacional
      arquivos[rel] = sha256Hex(readFileSync(path.join(raiz, rel), "utf8").replace(/\r\n/g, "\n"));
    } catch {
      arquivos[rel] = "ausente";
    }
  }
  return { hash: sha256Hex(jsonCanonico(arquivos)), arquivos };
}

/** Compara o software em execução com o publicado; lista o que mudou. */
export function compararSoftware(publicado: HashSoftware | undefined, atual: HashSoftware) {
  if (!publicado) return { confere: false, alterados: ["(gênese sem hash de software)"] };
  const nomes = new Set([...Object.keys(publicado.arquivos), ...Object.keys(atual.arquivos)]);
  const alterados = [...nomes].filter((n) => publicado.arquivos[n] !== atual.arquivos[n]).sort();
  return { confere: publicado.hash === atual.hash, alterados };
}

// recalcular a cada consulta leria ~25 arquivos várias vezes por segundo
let cache: { em: number; valor: HashSoftware } | null = null;
export function hashDoSoftwareAtual(): HashSoftware {
  if (!cache || Date.now() - cache.em > 3000) cache = { em: Date.now(), valor: hashDoSoftware() };
  return cache.valor;
}
