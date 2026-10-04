// Validador offline do eleitor: vira UM arquivo HTML (npm run validador), que
// abre no navegador sem internet e sem servidor. Usa exatamente o mesmo código
// do auditor (lib/auditoria.ts). Entrada: o pacote público baixado (pacote.json).
import { type Pacote, auditarPacote, boletimDaSecao, conferirTesteDoPapel, verificarMinhaCedula } from "../../lib/auditoria";
import { lerTestesDoComprovante } from "../../lib/comprovante";
import { formatarCodigo, formatarConferencia, idSecao, lerChaveTeste, lerCodigo } from "../../lib/crypto/palavras";
import type { Opcao } from "../../lib/crypto/quadro";

let pacote: Pacote | null = null;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const nome = (o?: Opcao) => (o ? esc(`${o.numero ? `${o.numero} — ` : ""}${o.nome}`) : "?");
const icone = (s: string) => (s === "ok" ? '<span class="ok">✔</span>' : s === "falha" ? '<span class="falha">✘</span>' : '<span class="pend">…</span>');

function exigirPacote(): Pacote {
  if (!pacote) throw new Error("Carregue primeiro o pacote público (pacote.json).");
  return pacote;
}

function mostrar(id: string, html: string) {
  $(id).innerHTML = html;
}

async function carregar(arquivo: File) {
  try {
    const p = JSON.parse(await arquivo.text()) as Pacote;
    if (p?.formato !== "tai-vote/pacote/v1" || !Array.isArray(p.blocos)) throw new Error("não é um pacote do TAI-VOTE");
    pacote = p;
    const g = p.blocos[0] as { conteudo?: { nome?: string } } | undefined;
    mostrar("estado", `✔ Pacote carregado: <b>${esc(g?.conteudo?.nome ?? "?")}</b> · ${p.blocos.length} blocos · exportado em ${esc(new Date(p.exportado_em).toLocaleString("pt-BR"))}`);
  } catch (e) {
    mostrar("estado", `<span class="falha">✘ ${esc((e as Error).message)}</span>`);
  }
}

function meuVoto() {
  try {
    const p = exigirPacote();
    const codigo = lerCodigo($<HTMLInputElement>("codigo").value);
    if (!codigo) throw new Error("Digite os 12 caracteres do código (ex.: 001 0001 K7Q2M).");
    const r = verificarMinhaCedula(p, codigo);
    if (!r.encontrada) {
      const m = {
        aguardando_midia: "a mídia desta seção ainda não chegou ao TSE neste pacote",
        transmitida: "a mídia da seção chegou e o código NÃO está nela — guarde o comprovante",
        sem_carga: "nenhuma urna com essa zona e seção",
      }[r.situacaoSecao ?? "sem_carga"];
      return mostrar("r-voto", `<p class="falha">✘ Código ${formatarCodigo(codigo)} não encontrado: ${m}.</p>`);
    }
    const figuras = (r.figuras ?? []).map((f) => `<div class="fig"><div class="emoji">${f.figura}</div>${esc(f.palavra.toUpperCase())}</div>`).join("");
    const itens = r.itens.map((i) => `<li>${icone(i.status)} <b>${esc(i.titulo)}</b> — ${esc(i.detalhe)}</li>`).join("");
    const teste = r.tipo === "desafiada" ? `<p class="aviso">Este código é de uma <b>cédula de teste</b>. Use a seção “Meu teste” com a chave do papel.</p>` : "";
    mostrar(
      "r-voto",
      `<div class="figs">${figuras}</div>
       ${r.conferencia ? `<p class="centro">conferência <b class="mono">${formatarConferencia(r.conferencia)}</b> — tem de ser a do seu papel</p>` : ""}
       ${teste}<ul>${itens}</ul>
       <p class="miudo">BU da seção ${esc(r.secao ?? "")}: <span class="mono">${esc(r.codigoBU ?? "")}</span> · hash da cédula <span class="mono">${esc(r.rastreador ?? "")}</span></p>`,
    );
  } catch (e) {
    mostrar("r-voto", `<p class="falha">${esc((e as Error).message)}</p>`);
  }
}

function meuTeste() {
  try {
    const p = exigirPacote();
    // o texto colado do comprovante (um ou mais testes) ou os dois campos digitados
    const colado = ($<HTMLTextAreaElement>("texto-teste").value ?? "").trim();
    const testes = colado
      ? lerTestesDoComprovante(colado)
      : [{ codigo: $<HTMLInputElement>("codigo-teste").value, chave: lerChaveTeste($<HTMLInputElement>("chave-teste").value) ?? "", declarado: "", assinatura: "" }];
    if (testes.length === 0) throw new Error("Não achei nenhum “TESTE DA URNA” no texto colado.");
    const html = testes
      .map((t, i) => {
        const r = conferirTesteDoPapel(p, t);
        const cor = r.veredito === "legitima" ? "ok" : r.veredito === "fraude" ? "falha" : "aviso";
        const rotulo = r.veredito === "legitima" ? "✔ urna honesta" : r.veredito === "fraude" ? "✘ FRAUDE" : "… inconclusivo";
        const disse = "declarada" in r && r.declarada ? `<br>A urna disse: <b>${nome(r.declarada)}</b>` : "";
        const real = "real" in r && r.real ? `<br>Refeito no seu computador: <b>${nome(r.real)}</b>` : "";
        const assin =
          "assinatura" in r
            ? `<br><span class="miudo">assinatura da urna: ${r.assinatura === "ok" ? "válida" : r.assinatura === "invalida" ? "NÃO confere" : "não informada"}</span>`
            : "";
        return `<p><b>Teste ${i + 1}</b> ${r.codigo ? formatarCodigo(r.codigo) : ""} — <span class="${cor}">${rotulo}</span>${disse}${real}<br>${esc(r.motivo)}${assin}</p>`;
      })
      .join("");
    mostrar("r-teste", html);
  } catch (e) {
    mostrar("r-teste", `<p class="falha">${esc((e as Error).message)}</p>`);
  }
}

function meuBU() {
  try {
    const p = exigirPacote();
    const secao = idSecao($<HTMLInputElement>("zona").value, $<HTMLInputElement>("secao").value);
    const b = boletimDaSecao(p, secao);
    if (!b.encontrada) return mostrar("r-bu", `<p class="falha">✘ Seção ${secao}: ${b.situacao === "aguardando_midia" ? "a mídia não chegou ao TSE" : "sem carga nesta eleição"}.</p>`);
    const linhas = b.contagem
      .map((x, i) => `<tr><td>${nome(b.opcoes[x.opcao])}</td><td class="num">${x.votos}</td><td class="num ${b.apurada && b.apurada[i]?.votos !== x.votos ? "falha" : ""}">${b.apurada ? b.apurada[i]?.votos : "—"}</td></tr>`)
      .join("");
    mostrar(
      "r-bu",
      `<p class="centro">CÓDIGO DO BU<br><b class="mono grande">${esc(b.codigo)}</b><br><span class="miudo">compare com o papel colado na porta da seção</span></p>
       <table><tr><th>Opção</th><th>BU impresso</th><th>Apuração</th></tr>${linhas}</table>
       <ul>
        <li>${icone(b.assinaturaOk ? "ok" : "falha")} assinado pela urna da carga</li>
        <li>${icone(b.somaOk ? "ok" : "falha")} soma das cédulas = agregado</li>
        <li>${icone(b.confere === null ? "pendente" : b.confere ? "ok" : "falha")} BU impresso = apuração criptográfica</li>
       </ul>`,
    );
  } catch (e) {
    mostrar("r-bu", `<p class="falha">${esc((e as Error).message)}</p>`);
  }
}

async function auditoria() {
  try {
    const p = exigirPacote();
    mostrar("r-auditoria", "auditando…");
    const rel = await auditarPacote(p, (f, t, etapa) => mostrar("r-auditoria", `${esc(etapa)}: ${f}/${t}`));
    const itens = rel.verificacoes
      .map((v) => `<li>${icone(v.status)} <b>${esc(v.titulo)}</b>${v.status === "falha" ? `<br><span class="falha miudo">${v.detalhes.map(esc).join("<br>")}</span>` : ""}</li>`)
      .join("");
    const avisos = rel.avisos.map((a) => `<p class="aviso">⚠ ${esc(a)}</p>`).join("");
    const resultado = rel.resultado ? `<table><tr><th>Opção</th><th>Votos</th></tr>${rel.resultado.map((r) => `<tr><td>${nome(r.opcao)}</td><td class="num">${r.votos}</td></tr>`).join("")}</table>` : "";
    mostrar("r-auditoria", `<p class="${rel.aprovado ? "ok" : "falha"} grande">${rel.aprovado ? "✔ Nenhuma inconsistência" : "✘ Problemas encontrados"}</p>${avisos}<ul>${itens}</ul>${resultado}`);
  } catch (e) {
    mostrar("r-auditoria", `<p class="falha">${esc((e as Error).message)}</p>`);
  }
}

$<HTMLInputElement>("arquivo").addEventListener("change", (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void carregar(f);
});
$("b-voto").addEventListener("click", meuVoto);
$("b-teste").addEventListener("click", meuTeste);
$("b-bu").addEventListener("click", meuBU);
$("b-auditoria").addEventListener("click", () => void auditoria());
