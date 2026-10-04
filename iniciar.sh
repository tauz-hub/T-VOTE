#!/bin/sh
# T-VOTE: instala e inicia o sistema num computador Linux ou macOS novo.
# Uso: sh iniciar.sh        (opções: --reinstalar  --node-portatil  --porta 3000  --sem-navegador)
#
# 1. Usa o Node.js do computador (22 ou mais novo); se não houver, baixa a
#    versão oficial portátil de nodejs.org para .ferramentas/, confere o
#    SHA-256 e usa só neste terminal (nada é instalado no sistema).
# 2. Instala as dependências (npm ci) quando o package-lock muda.
# 3. Compila o sistema quando o código muda.
# 4. Inicia em http://127.0.0.1:<porta> e abre o navegador.
set -eu

NODE_MINIMO=22
NODE_LINHA=latest-v24.x
NODE_DIST=${NODE_DIST:-https://nodejs.org/dist}
PORTA=3000
REINSTALAR=0
NODE_PORTATIL=0
SEM_NAVEGADOR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --reinstalar) REINSTALAR=1 ;;
    --node-portatil) NODE_PORTATIL=1 ;;
    --sem-navegador) SEM_NAVEGADOR=1 ;;
    --porta) shift; PORTA=$1 ;;
    *) echo "Opção desconhecida: $1"; exit 1 ;;
  esac
  shift
done

RAIZ=$(cd "$(dirname "$0")" && pwd)
FERRAMENTAS="$RAIZ/.ferramentas"
cd "$RAIZ"

passo() { printf '\n==> %s\n' "$1"; }
falha() {
  printf '\nERRO: %s\n' "$1" >&2
  echo "Se não resolver, abra um problema em https://github.com/tauz-hub/T-VOTE/issues com esta mensagem." >&2
  exit 1
}
versao_principal() { "$1" -v 2>/dev/null | sed -n 's/^v\([0-9]*\)\..*/\1/p'; }
baixar() { # baixar URL [destino]
  if command -v curl >/dev/null 2>&1; then
    if [ $# -gt 1 ]; then curl -fsSL "$1" -o "$2"; else curl -fsSL "$1"; fi
  elif command -v wget >/dev/null 2>&1; then
    if [ $# -gt 1 ]; then wget -q "$1" -O "$2"; else wget -qO- "$1"; fi
  else
    falha "Preciso do curl ou do wget para baixar o Node.js."
  fi
}
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}
hash_lock() { sha256 "$RAIZ/package-lock.json"; }

echo "T-VOTE - instalação e início"
echo "Pasta: $RAIZ"

# ------------------------------------------------------------------ 1. Node.js
passo "1/4  Node.js"
v=0
if [ "$NODE_PORTATIL" = 0 ] && command -v node >/dev/null 2>&1; then v=$(versao_principal node); fi
if [ "${v:-0}" -ge "$NODE_MINIMO" ] 2>/dev/null; then
  echo "Usando o Node.js $(node -v) deste computador."
else
  if [ "$NODE_PORTATIL" = 1 ]; then echo "Usando uma cópia portátil do Node.js (opção --node-portatil)."
  elif command -v node >/dev/null 2>&1; then echo "O Node.js deste computador é antigo ($(node -v)); vou usar uma cópia portátil."
  else echo "Este computador não tem Node.js; vou baixar uma cópia portátil."; fi
  case "$(uname -s)" in
    Linux) so=linux ;;
    Darwin) so=darwin ;;
    *) falha "Sistema não suportado por este script. No Windows, use INICIAR.bat." ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arq=x64 ;;
    arm64|aarch64) arq=arm64 ;;
    *) falha "Processador $(uname -m) não suportado pelo Node.js oficial." ;;
  esac
  portatil=$(ls -d "$FERRAMENTAS"/node-v*-"$so-$arq" 2>/dev/null | sort | tail -n 1 || true)
  if [ -z "$portatil" ] || [ "$(versao_principal "$portatil/bin/node")" -lt "$NODE_MINIMO" ] 2>/dev/null; then
    somas=$(baixar "$NODE_DIST/$NODE_LINHA/SHASUMS256.txt") ||
      falha "Não consegui acessar nodejs.org. Confira a internet ou instale o Node.js 22+ de https://nodejs.org e rode de novo."
    linha=$(printf '%s\n' "$somas" | grep -E "  node-v[0-9.]+-$so-$arq\.tar\.gz$" | head -n 1)
    [ -n "$linha" ] || falha "Não encontrei o pacote do Node.js para $so-$arq."
    esperado=${linha%% *}
    nome=${linha##* }
    mkdir -p "$FERRAMENTAS"
    echo "Baixando $nome de nodejs.org (cerca de 50 MB, só na primeira vez)..."
    baixar "$NODE_DIST/$NODE_LINHA/$nome" "$FERRAMENTAS/$nome" || falha "O download do Node.js falhou."
    if [ "$(sha256 "$FERRAMENTAS/$nome")" != "$esperado" ]; then
      rm -f "$FERRAMENTAS/$nome"
      falha "O arquivo baixado não confere com o SHA-256 publicado por nodejs.org. Nada foi instalado."
    fi
    echo "SHA-256 conferido. Extraindo..."
    tar -xzf "$FERRAMENTAS/$nome" -C "$FERRAMENTAS"
    rm -f "$FERRAMENTAS/$nome"
    portatil="$FERRAMENTAS/${nome%.tar.gz}"
  else
    echo "Usando o Node.js portátil já baixado ($(basename "$portatil"))."
  fi
  # só para este terminal: nada muda no sistema
  PATH="$portatil/bin:$PATH"
  export PATH
  echo "Node.js $(node -v) pronto."
fi

# ------------------------------------------------------------------ 2. dependências
passo "2/4  Dependências"
MARCA_DEPS="$RAIZ/node_modules/.t-vote-instalado"
HASH=$(hash_lock)
if [ "$REINSTALAR" = 1 ] || [ ! -f "$MARCA_DEPS" ] || [ "$(cat "$MARCA_DEPS")" != "$HASH" ]; then
  echo "Instalando (alguns minutos na primeira vez)..."
  npm ci --no-audit --no-fund || falha "A instalação das dependências falhou (veja as mensagens acima)."
  echo "$HASH" > "$MARCA_DEPS"
else
  echo "Já instaladas."
fi

# ------------------------------------------------------------------ 3. compilação
passo "3/4  Preparando o sistema"
MARCA_BUILD="$RAIZ/.next/.t-vote-compilado"
# assinatura do código: lockfile + lista de arquivos com data de modificação
ASSINATURA="$HASH|$(ls -lR app components lib public next.config.ts proxy.ts package.json 2>/dev/null | cksum | cut -d' ' -f1)"
if [ "$REINSTALAR" = 1 ] || [ ! -f "$RAIZ/.next/BUILD_ID" ] || [ ! -f "$MARCA_BUILD" ] || [ "$(cat "$MARCA_BUILD")" != "$ASSINATURA" ]; then
  echo "Compilando (um ou dois minutos na primeira vez)..."
  npm run build || falha "A compilação falhou (veja as mensagens acima)."
  echo "$ASSINATURA" > "$MARCA_BUILD"
else
  echo "Já compilado."
fi

# ------------------------------------------------------------------ 4. iniciar
passo "4/4  Iniciando"
porta_livre() { node -e "const s=require('net').createServer();s.once('error',()=>process.exit(1));s.listen($1,'127.0.0.1',()=>s.close(()=>process.exit(0)))"; }
while ! porta_livre "$PORTA"; do PORTA=$((PORTA + 1)); done
URL="http://127.0.0.1:$PORTA"

if [ "$SEM_NAVEGADOR" = 0 ]; then
  (
    i=0
    while [ $i -lt 120 ]; do
      if node -e "require('http').get('$URL',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))" 2>/dev/null; then
        if command -v open >/dev/null 2>&1 && [ "$(uname -s)" = Darwin ]; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1; fi
        exit 0
      fi
      i=$((i + 1)); sleep 1
    done
  ) &
fi

echo ""
echo "T-VOTE rodando em $URL"
echo "Os dados ficam em $RAIZ/data. Para parar, aperte Ctrl+C."
echo ""
exec "$RAIZ/node_modules/.bin/next" start -H 127.0.0.1 -p "$PORTA"
