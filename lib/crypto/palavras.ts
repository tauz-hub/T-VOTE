// Figuras de verificação: o que o eleitor guarda da urna, também para quem não lê.
//
// Assim que a urna lacra a cédula, ela a sela com a própria chave (assina o
// rastreador e a seção). As 2 figuras, o código de 12 caracteres e a conferência
// de 8 saem dessa assinatura, que é determinística: para uma cédula só existe um
// selo, e qualquer um o confere com a chave da urna publicada na carga.
//
// Ficam gravadas no BU junto com o rastreador e o selo. O eleitor digita o código
// do comprovante e vê as figuras registradas; o auditor confere que elas são
// exatamente as derivadas do selo.
//
// Com o software oficial, elas não dependem do voto (o selo assina o hash de
// cifras aleatórias): não há caminho de volta das figuras para o candidato, nem
// servem de recibo de voto. Limite honesto: uma urna ADULTERADA, que vê o voto,
// poderia escolher a aleatoriedade para que as figuras "codifiquem" o candidato
// (canal subliminar) — ver docs/TESTES-DE-INVASAO.md.
import { sha256Hex } from "./codificacao";

export type Figura = { figura: string; palavra: string };

/**
 * 256 palavras com figura (emoji do próprio sistema — nada é baixado).
 * A ordem faz parte do protocolo. Regras: toda palavra é desenhável, nenhum par
 * difere por uma única letra, nada político, religioso ou arma, e só emojis
 * disponíveis no Windows 10/11 e em celulares comuns.
 */
const LISTA: readonly (readonly [string, string])[] = [
  ["🐶", "cachorro"], ["🐱", "gato"], ["🐰", "coelho"], ["🦊", "raposa"], ["🐻", "urso"], ["🐼", "panda"],
  ["🐨", "coala"], ["🐯", "tigre"], ["🦁", "leão"], ["🐷", "porco"], ["🐸", "sapo"], ["🐵", "macaco"],
  ["🐔", "galinha"], ["🐧", "pinguim"], ["🐦", "passarinho"], ["🐤", "pintinho"], ["🦅", "águia"], ["🦉", "coruja"],
  ["🦇", "morcego"], ["🐺", "lobo"], ["🐗", "javali"], ["🐴", "cavalo"], ["🦄", "unicórnio"], ["🐝", "abelha"],
  ["🐛", "lagarta"], ["🦋", "borboleta"], ["🐌", "caracol"], ["🐞", "joaninha"], ["🐜", "formiga"], ["🕷️", "aranha"],
  ["🦂", "escorpião"], ["🐢", "tartaruga"], ["🐍", "cobra"], ["🦖", "dinossauro"], ["🐙", "polvo"], ["🦐", "camarão"],
  ["🦞", "lagosta"], ["🦀", "caranguejo"], ["🐠", "peixe"], ["🐬", "golfinho"], ["🐳", "baleia"], ["🦈", "tubarão"],
  ["🐊", "jacaré"], ["🐆", "onça"], ["🦓", "zebra"], ["🦍", "gorila"], ["🐘", "elefante"], ["🦛", "hipopótamo"],
  ["🦏", "rinoceronte"], ["🐪", "camelo"], ["🦒", "girafa"], ["🦘", "canguru"], ["🐃", "búfalo"], ["🐂", "boi"],
  ["🐑", "ovelha"], ["🦌", "cervo"], ["🦃", "peru"], ["🦚", "pavão"], ["🦜", "papagaio"], ["🦢", "cisne"],
  ["🦩", "flamingo"], ["🕊️", "pomba"], ["🦦", "lontra"], ["🦥", "preguiça"], ["🐿️", "esquilo"], ["🦔", "ouriço"],
  ["🐉", "dragão"], ["🦙", "lhama"], ["🍎", "maçã"], ["🍊", "laranja"], ["🍋", "limão"], ["🍌", "banana"],
  ["🍉", "melancia"], ["🍇", "uva"], ["🍓", "morango"], ["🍈", "melão"], ["🍒", "cereja"], ["🍑", "pêssego"],
  ["🥭", "manga"], ["🍍", "abacaxi"], ["🥥", "coco"], ["🥝", "kiwi"], ["🍅", "tomate"], ["🍆", "berinjela"],
  ["🥑", "abacate"], ["🥦", "brócolis"], ["🥬", "alface"], ["🥒", "pepino"], ["🌶️", "pimenta"], ["🌽", "milho"],
  ["🥕", "cenoura"], ["🧄", "alho"], ["🧅", "cebola"], ["🥔", "batata"], ["🍞", "pão"], ["🧀", "queijo"],
  ["🥚", "ovo"], ["🥞", "panqueca"], ["🍗", "frango"], ["🍖", "carne"], ["🍔", "hambúrguer"], ["🍕", "pizza"],
  ["🥪", "sanduíche"], ["🍝", "macarrão"], ["🍣", "sushi"], ["🍚", "arroz"], ["🥟", "pastel"], ["🍦", "sorvete"],
  ["🍩", "rosquinha"], ["🍪", "biscoito"], ["🍫", "chocolate"], ["🍭", "pirulito"], ["🍯", "mel"], ["🥛", "leite"],
  ["☕", "café"], ["🍵", "chá"], ["🧃", "suco"], ["🍿", "pipoca"], ["🥜", "amendoim"], ["🌰", "castanha"],
  ["☀️", "sol"], ["🌙", "lua"], ["⭐", "estrela"], ["☁️", "nuvem"], ["🌧️", "chuva"], ["⛈️", "tempestade"],
  ["❄️", "neve"], ["🔥", "fogo"], ["💧", "gota"], ["🌋", "vulcão"], ["🏔️", "montanha"], ["🏝️", "ilha"],
  ["🏜️", "deserto"], ["🌵", "cacto"], ["🌲", "pinheiro"], ["🌳", "árvore"], ["🌴", "coqueiro"], ["🍁", "folha"],
  ["🍄", "cogumelo"], ["🌻", "girassol"], ["🌹", "rosa"], ["🌷", "tulipa"], ["🌸", "flor"], ["🌾", "trigo"],
  ["🌍", "mundo"], ["🪐", "planeta"], ["☄️", "cometa"], ["🌪️", "tornado"], ["🌱", "broto"], ["🦴", "osso"],
  ["🐚", "concha"], ["⚽", "bola"], ["🎈", "balão"], ["🎁", "presente"], ["🎀", "laço"], ["🪁", "pipa"],
  ["🧸", "ursinho"], ["🎲", "dado"], ["♟️", "xadrez"], ["🎸", "violão"], ["🎺", "trompete"], ["🥁", "tambor"],
  ["🎹", "piano"], ["🎻", "violino"], ["🎷", "saxofone"], ["🔔", "sino"], ["🎤", "microfone"], ["📷", "câmera"],
  ["📺", "televisão"], ["📻", "rádio"], ["💡", "lâmpada"], ["🔦", "lanterna"], ["🕯️", "vela"], ["📚", "livro"],
  ["✏️", "lápis"], ["🖍️", "giz"], ["🖌️", "pincel"], ["✂️", "tesoura"], ["📎", "clipe"], ["📏", "régua"],
  ["🔑", "chave"], ["🔒", "cadeado"], ["🔨", "martelo"], ["🪓", "machado"], ["🧲", "ímã"], ["🔭", "telescópio"],
  ["🔬", "microscópio"], ["🧹", "vassoura"], ["🧺", "cesto"], ["🧼", "sabonete"], ["🛁", "banheira"], ["🚪", "porta"],
  ["🪑", "cadeira"], ["🛋️", "sofá"], ["⏰", "despertador"], ["🧭", "bússola"], ["🎒", "mochila"], ["👓", "óculos"],
  ["👑", "coroa"], ["🎩", "cartola"], ["🧢", "boné"], ["👒", "chapéu"], ["👟", "tênis"], ["🧣", "cachecol"],
  ["👕", "camiseta"], ["👖", "calça"], ["👗", "vestido"], ["💍", "anel"], ["💎", "diamante"], ["🌂", "sombrinha"],
  ["⚓", "âncora"], ["🏆", "troféu"], ["🥇", "medalha"], ["✉️", "envelope"], ["📦", "caixa"], ["🎨", "paleta"],
  ["🖼️", "quadro"], ["🧵", "linha"], ["🧶", "novelo"], ["🍴", "garfo"], ["🥄", "colher"], ["🍽️", "prato"],
  ["🥣", "tigela"], ["🧊", "gelo"], ["🚗", "carro"], ["🚕", "táxi"], ["🚌", "ônibus"], ["🚑", "ambulância"],
  ["🚜", "trator"], ["🚲", "bicicleta"], ["🛴", "patinete"], ["🏍️", "moto"], ["🚂", "trem"], ["🚁", "helicóptero"],
  ["✈️", "avião"], ["🚀", "foguete"], ["⛵", "veleiro"], ["🚤", "lancha"], ["🛶", "canoa"], ["🚢", "navio"],
  ["⛺", "barraca"], ["🏠", "casa"], ["🏰", "castelo"], ["🏭", "fábrica"], ["🏥", "hospital"], ["🏫", "escola"],
  ["🗼", "torre"], ["🗽", "estátua"], ["🌉", "ponte"], ["🎠", "carrossel"], ["⛲", "chafariz"], ["🏟️", "estádio"],
  ["🚦", "semáforo"], ["🛒", "carrinho"], ["🚚", "caminhão"], ["🧱", "tijolo"],
];

export const FIGURAS: readonly Figura[] = LISTA.map(([figura, palavra]) => ({ figura, palavra }));

export const NUM_FIGURAS = 2;

if (FIGURAS.length !== 256) throw new Error("lista de figuras inválida");

/** Remove acentos e maiúsculas: "Leão" → "leao". */
export function normalizarPalavra(p: string): string {
  return p
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const INDICE = new Map(FIGURAS.map((f, i) => [normalizarPalavra(f.palavra), i]));

/** Tudo o que o eleitor confere sai deste hash do selo: bytes 0–1 → figuras, bytes 2–5 → parte aleatória do código. */
function hashVerificacao(selo: string): string {
  return sha256Hex(`T-VOTE/verificacao/v1|${selo}`);
}

/** As 2 figuras derivadas do selo do quadro. */
export function palavrasDoSelo(selo: string): Figura[] {
  const h = hashVerificacao(selo);
  return Array.from({ length: NUM_FIGURAS }, (_, i) => FIGURAS[parseInt(h.slice(i * 2, i * 2 + 2), 16)]);
}

// ── Código de verificação (12 caracteres) ────────────────────────────────────
//
//   001 0001 K7Q2M
//   zona seção  aleatório (5 caracteres base32, 25 bits, tirados do selo)
//
// A zona e a seção vêm da urna que selou a cédula e entram na assinatura do
// quadro; a parte aleatória sai do selo, então a urna não escolhe o código. O
// quadro recusa selar um código repetido, o que o torna único na eleição.

/** Base32 de Crockford: sem I, L, O, U (não se confundem com 1, 0, V). */
export const ALFABETO_CODIGO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const TAMANHO_ALEATORIO = 5;

/** "001-0001" a partir de zona e seção. */
export function idSecao(zona: string | number, secao: string | number): string {
  const z = String(zona).replace(/\D/g, "").padStart(3, "0").slice(-3);
  const s = String(secao).replace(/\D/g, "").padStart(4, "0").slice(-4);
  return `${z}-${s}`;
}

export function codigoVerificacao(secaoId: string, selo: string): string {
  const bits = BigInt("0x" + hashVerificacao(selo).slice(4, 12)); // 32 bits; usamos os 25 de cima
  let aleatorio = "";
  for (let i = 0; i < TAMANHO_ALEATORIO; i++) {
    const v = Number((bits >> BigInt(32 - 5 * (i + 1))) & 31n);
    aleatorio += ALFABETO_CODIGO[v];
  }
  return secaoId.replace("-", "") + aleatorio;
}

// ── Conferência (8 caracteres, 40 bits) ──────────────────────────────────────
//
// Código (25 bits) + figuras (16 bits) = 41 bits é pouco contra uma urna
// adulterada que prepara de antemão DUAS cédulas com o mesmo código e as mesmas
// figuras (uma para o candidato dela, outra para o do eleitor): se o eleitor
// testa, ela abre a dele; se deposita, guarda a dela. Com 41 bits isso custa
// uma tabela de ~2^30 cédulas e milhares de tentativas na hora — viável.
//
// A conferência sai impressa junto com o código, ANTES de o eleitor decidir.
// Ninguém precisa decorá-la: em casa, o validador mostra a conferência gravada e
// o eleitor compara com o papel. Código + figuras + conferência = 81 bits: a
// mesma colisão passa a exigir ~2^40 cédulas na hora, inviável.
export const TAMANHO_CONFERENCIA = 8;

export function conferenciaDoSelo(selo: string): string {
  const bits = BigInt("0x" + hashVerificacao(selo).slice(12, 22)); // 40 bits
  let c = "";
  for (let i = 0; i < TAMANHO_CONFERENCIA; i++) c += ALFABETO_CODIGO[Number((bits >> BigInt(40 - 5 * (i + 1))) & 31n)];
  return c;
}

/** "K7Q2M8XA" → "K7Q2 M8XA" */
export function formatarConferencia(c: string): string {
  return `${c.slice(0, 4)} ${c.slice(4)}`;
}

// ── Chave do teste (impressa no comprovante (parte do teste)) ──────────────────────────────
//
// 128 bits em base32 de Crockford: 26 caracteres, em grupos de 4 e 2.

/** hex de 16 bytes → "K7Q2 M8XA …" (26 caracteres). */
export function chaveTesteParaTexto(sementeHex: string): string {
  let bits = BigInt("0x" + sementeHex) << 2n; // 128 + 2 = 130 bits = 26 × 5
  let s = "";
  for (let i = 0; i < 26; i++) {
    s = ALFABETO_CODIGO[Number(bits & 31n)] + s;
    bits >>= 5n;
  }
  return (s.match(/.{1,4}/g) ?? []).join(" ");
}

/** O que o eleitor digitou → hex de 16 bytes (ou null). Aceita O→0 e I/L→1. */
export function lerChaveTeste(texto: string): string | null {
  const c = texto
    .toUpperCase()
    .replace(/[\s.\-·]+/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(c)) return null;
  let bits = 0n;
  for (const ch of c) bits = (bits << 5n) | BigInt(ALFABETO_CODIGO.indexOf(ch));
  if ((bits & 3n) !== 0n) return null; // os 2 bits de enchimento são zero
  return (bits >> 2n).toString(16).padStart(32, "0");
}

/** "0010001K7Q2M" → "001 0001 K7Q2M" (como sai impresso). */
export function formatarCodigo(codigo: string): string {
  return `${codigo.slice(0, 3)} ${codigo.slice(3, 7)} ${codigo.slice(7)}`;
}

/** Lê o que o eleitor digitou: ignora espaços e traços, maiúsculas, e corrige O→0, I/L→1. */
export function lerCodigo(texto: string): string | null {
  const c = texto
    .toUpperCase()
    .replace(/[\s.\-·]+/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return /^[0-9]{7}[0-9A-HJKMNP-TV-Z]{5}$/.test(c) ? c : null;
}

/** Zona e seção legíveis a partir do código. */
export function secaoDoCodigo(codigo: string): { zona: string; secao: string } {
  return { zona: codigo.slice(0, 3), secao: codigo.slice(3, 7) };
}

/** "Girafa, bola" → ["girafa", "bola"] (normalizadas); null se não forem 2 palavras da lista. */
export function lerPalavras(texto: string): string[] | null {
  const ps = normalizarPalavra(texto)
    .split(/[^a-z]+/)
    .filter(Boolean);
  if (ps.length !== NUM_FIGURAS || ps.some((p) => !INDICE.has(p))) return null;
  return ps;
}

export function mesmasPalavras(a: Figura[], b: string[]): boolean {
  return a.length === b.length && a.every((f, i) => normalizarPalavra(f.palavra) === b[i]);
}

/** Como as figuras são gravadas no bloco: as palavras da lista, na ordem. */
export function nomesDasFiguras(selo: string): string[] {
  return palavrasDoSelo(selo).map((f) => f.palavra);
}

/** Figura (emoji) de uma palavra gravada no bloco. */
export function figuraDaPalavra(palavra: string): Figura | undefined {
  const i = INDICE.get(normalizarPalavra(palavra));
  return i === undefined ? undefined : FIGURAS[i];
}
