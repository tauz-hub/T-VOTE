// Gera public/validador.html: o validador do eleitor num ÚNICO arquivo, que roda
// offline (sem servidor, sem internet). Compilado a partir do mesmo código do
// auditor. Para não confiar no arquivo que baixou, gere de novo a partir do
// código-fonte e compare o SHA-256 (o build é determinístico).
//
//   npm run validador
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { hashDoSoftware } from "../lib/server/software";

async function main() {
  const r = await build({
    entryPoints: [path.join("scripts", "validador", "app.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    write: false,
    legalComments: "none",
    logLevel: "warning",
  });
  const js = r.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const software = hashDoSoftware().hash;
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Validador do eleitor</title>
<style>
:root { --fundo:#f8fafc; --texto:#0f172a; --suave:#64748b; --cartao:#ffffff; --borda:#e2e8f0; --ok:#047857; --falha:#b91c1c; --aviso:#92400e; }
@media (prefers-color-scheme: dark) { :root { --fundo:#0b1120; --texto:#e2e8f0; --suave:#94a3b8; --cartao:#111827; --borda:#1f2937; --ok:#34d399; --falha:#f87171; --aviso:#fbbf24; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--fundo); color:var(--texto); font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 1.5rem; margin: 0 0 4px; }
h2 { font-size: 1.05rem; margin: 0 0 8px; }
section { background:var(--cartao); border:1px solid var(--borda); border-radius:12px; padding:16px; margin-top:16px; }
input[type=text] { width:100%; padding:10px 12px; border:1px solid var(--borda); border-radius:8px; background:transparent; color:inherit; font:inherit; text-transform:uppercase; letter-spacing:.08em; }
.linha { display:flex; gap:8px; flex-wrap:wrap; } .linha > input { flex:1; min-width: 140px; }
button { padding:10px 16px; border:0; border-radius:8px; background:var(--texto); color:var(--fundo); font:inherit; font-weight:600; cursor:pointer; }
ul { padding-left: 0; list-style: none; } li { margin: 6px 0; }
table { width:100%; border-collapse: collapse; margin-top: 8px; } th, td { text-align:left; padding:4px 6px; border-bottom:1px solid var(--borda); } .num { text-align:right; font-variant-numeric: tabular-nums; }
.ok { color:var(--ok); } .falha { color:var(--falha); } .pend { color:var(--suave); } .aviso { color:var(--aviso); }
.mono { font-family: ui-monospace, Consolas, monospace; } .miudo { font-size:.8rem; color:var(--suave); word-break: break-all; }
.centro { text-align:center; } .grande { font-size:1.35rem; font-weight:700; }
.figs { display:flex; gap:12px; justify-content:center; margin: 8px 0; } .fig { text-align:center; font-weight:700; border:2px solid var(--borda); border-radius:10px; padding:6px 10px; } .emoji { font-size: 3rem; line-height: 1.1; }
</style>
</head>
<body>
<main>
<h1>Validador do eleitor</h1>
<p class="miudo">Roda inteiro neste arquivo, sem internet e sem servidor. Mesmo código do auditor (software ${software.slice(0, 16)}…). Para não confiar neste arquivo: gere de novo com <span class="mono">npm run validador</span> e compare o SHA-256.</p>

<section>
<h2>1. Carregue o pacote público</h2>
<p class="miudo">O arquivo pacote.json com toda a cadeia de blocos, baixado do site (Auditoria → Baixar pacote) ou recebido de qualquer pessoa — é público.</p>
<input id="arquivo" type="file" accept="application/json">
<p id="estado" class="miudo"></p>
</section>

<section>
<h2>2. Meu voto</h2>
<p class="miudo">O código de 12 caracteres do comprovante. Devem aparecer as 2 figuras que a urna mostrou e a conferência impressa no papel.</p>
<div class="linha"><input id="codigo" type="text" placeholder="001 0001 K7Q2M"><button id="b-voto">Conferir</button></div>
<div id="r-voto"></div>
</section>

<section>
<h2>3. Meu teste da urna</h2>
<p class="miudo">Da parte do TESTE no comprovante: o código e a chave (26 caracteres). Este computador refaz a cifração e mostra o que a urna cifrou de verdade.</p>
<textarea id="texto-teste" rows="6" placeholder="Cole aqui o texto do comprovante a partir de TESTE DA URNA (pode ter vários testes)" style="width:100%;padding:10px;border:1px solid var(--borda);border-radius:8px;background:transparent;color:inherit;font:inherit"></textarea>
<p class="miudo">…ou digite o código e a chave de um teste:</p>
<div class="linha"><input id="codigo-teste" type="text" placeholder="código do teste"></div>
<div class="linha" style="margin-top:8px"><input id="chave-teste" type="text" placeholder="chave do teste"><button id="b-teste">Conferir a urna</button></div>
<div id="r-teste"></div>
</section>

<section>
<h2>4. Boletim da minha seção</h2>
<p class="miudo">Compare com o BU colado na porta da seção: o código do BU e os números têm de ser iguais.</p>
<div class="linha"><input id="zona" type="text" placeholder="zona"><input id="secao" type="text" placeholder="seção"><button id="b-bu">Ver o BU</button></div>
<div id="r-bu"></div>
</section>

<section>
<h2>5. Auditoria completa</h2>
<p class="miudo">Refaz toda a matemática da eleição: cadeia, cargas, mídias assinadas pelas urnas, provas, somas, decifrações e resultado.</p>
<button id="b-auditoria">Auditar a eleição inteira</button>
<div id="r-auditoria"></div>
</section>
</main>
<script>${js}</script>
</body>
</html>
`;
  const destino = path.join("public", "validador.html");
  writeFileSync(destino, html);
  console.log(`validador gerado: ${destino} (${(html.length / 1024).toFixed(0)} KB)`);
  console.log(`SHA-256: ${createHash("sha256").update(html).digest("hex")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
