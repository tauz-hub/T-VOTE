// Fotos dos candidatos, guardadas localmente e endereçadas pelo próprio hash.
//
// A gênese publica o SHA-256 de cada foto; a urna confere o hash antes de
// exibir. Trocar a foto no servidor (para enganar o eleitor na tela, como o
// TPS 2017 mostrou ser possível com as mensagens da urna) faz a urna recusar
// a imagem. Nenhuma imagem é buscada fora da rede eleitoral.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sha256Hex } from "../crypto/codificacao";
import { DIRETORIO_DADOS } from "./db";
import { ErroHttp } from "./http";

const DIRETORIO = path.join(DIRETORIO_DADOS, "fotos");
const LIMITE_BYTES = 300_000;

const TIPOS = {
  jpg: { mime: "image/jpeg", assinatura: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  png: { mime: "image/png", assinatura: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  webp: { mime: "image/webp", assinatura: (b: Buffer) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
} as const;

type Extensao = keyof typeof TIPOS;

/** Recebe um data URL, confere tipo pelos bytes (não pelo que o cliente diz) e grava como <hash>.<ext>. */
export function salvarFoto(dataUrl: string): string {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new ErroHttp(400, "Foto deve ser JPEG, PNG ou WEBP");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > LIMITE_BYTES) throw new ErroHttp(413, "Foto maior que 300 KB");
  const ext = (Object.keys(TIPOS) as Extensao[]).find((e) => TIPOS[e].assinatura(bytes));
  if (!ext) throw new ErroHttp(400, "Conteúdo da foto não é uma imagem válida");
  const hash = sha256Hex(new Uint8Array(bytes));
  mkdirSync(DIRETORIO, { recursive: true });
  const arquivo = path.join(DIRETORIO, `${hash}.${ext}`);
  if (!existsSync(arquivo)) writeFileSync(arquivo, bytes);
  return hash;
}

export function caminhoFoto(hash: string): { arquivo: string; mime: string } | null {
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  for (const ext of Object.keys(TIPOS) as Extensao[]) {
    const arquivo = path.join(DIRETORIO, `${hash}.${ext}`);
    if (existsSync(arquivo)) return { arquivo, mime: TIPOS[ext].mime };
  }
  return null;
}

export function lerFoto(hash: string): { bytes: Buffer; mime: string } | null {
  const c = caminhoFoto(hash);
  // a pasta de dados é definida em tempo de execução (TAI_VOTE_DADOS): não rastrear no build
  return c ? { bytes: readFileSync(/*turbopackIgnore: true*/ c.arquivo), mime: c.mime } : null;
}

/** Aceita "padrao:NN" (foto oficial em public/candidatos), um hash de foto já guardada ou um data URL novo; devolve o hash. */
export function resolverFoto(valor: unknown): string | undefined {
  if (valor === undefined || valor === null || valor === "") return undefined;
  const v = String(valor);
  const padrao = /^padrao:(\d{2})$/.exec(v);
  if (padrao) {
    const arquivo = path.join(process.cwd(), "public", "candidatos", `${padrao[1]}.jpg`);
    if (!existsSync(arquivo)) throw new ErroHttp(400, `Não há foto padrão para o número ${padrao[1]}`);
    return salvarFoto(`data:image/jpeg;base64,${readFileSync(arquivo).toString("base64")}`);
  }
  if (/^[0-9a-f]{64}$/.test(v)) {
    const foto = lerFoto(v);
    if (!foto) throw new ErroHttp(400, "Foto referenciada não existe neste servidor");
    // não sela na gênese um arquivo que foi alterado depois de guardado
    if (sha256Hex(new Uint8Array(foto.bytes)) !== v) throw new ErroHttp(409, "Arquivo de foto adulterado no servidor — envie a foto novamente");
    return v;
  }
  return salvarFoto(v);
}
