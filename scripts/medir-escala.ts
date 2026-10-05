// Mede o custo de uma seção típica para estimar a escala nacional (white paper, seção 7.4).
// Uso: npx tsx scripts/medir-escala.ts [eleitores=300]
import { auditarPacote } from "../lib/auditoria";
import { montarEleicao } from "./eleicao-memoria";

const ELEITORES = Number(process.argv[2] ?? 300);

async function main() {

const t0 = performance.now();
const e = montarEleicao({ secoes: [{ zona: 1, secao: 1, eleitores: ELEITORES }], taxaTeste: 0 });
const tMontar = performance.now() - t0;

const secao = e.blocos.find((b) => b.tipo === "SECAO");
if (!secao) throw new Error("bloco SECAO não encontrado");
const bytesSecao = Buffer.byteLength(JSON.stringify(secao), "utf8");

const t1 = performance.now();
const rel = await auditarPacote({ blocos: e.blocos } as Parameters<typeof auditarPacote>[0]);
const tAuditar = performance.now() - t1;

const falhas = rel.verificacoes.filter((v) => v.status === "falha").map((v) => v.id);
console.log(JSON.stringify({
  eleitores: ELEITORES,
  opcoes: e.opcoes.length,
  bytes_bloco_secao: bytesSecao,
  bytes_por_cedula: Math.round(bytesSecao / ELEITORES),
  ms_montar_total: Math.round(tMontar),
  ms_auditar_total: Math.round(tAuditar),
  ms_auditar_por_cedula: +(tAuditar / ELEITORES).toFixed(2),
  falhas,
}, null, 1));
}

void main();
