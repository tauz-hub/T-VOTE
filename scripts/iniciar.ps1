# T-VOTE: instala e inicia o sistema num computador Windows novo.
#
# 1. Usa o Node.js do computador (22 ou mais novo); se não houver, baixa a
#    versão oficial portátil de nodejs.org para .ferramentas\, confere o
#    SHA-256 e usa só nesta janela (nada é instalado no Windows).
# 2. Instala as dependências (npm ci) quando o package-lock muda.
# 3. Compila o sistema quando o código muda.
# 4. Inicia em http://127.0.0.1:<porta> e abre o navegador.
#
# Opções: -Reinstalar  -NodePortatil  -Porta 3000  -SemNavegador
param(
  [switch]$Reinstalar,
  [switch]$NodePortatil,
  [int]$Porta = 3000,
  [switch]$SemNavegador,
  [string]$NodeDist = "https://nodejs.org/dist"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # a barra de progresso deixa o download muito lento
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$NODE_MINIMO = 22
$NODE_LINHA = "latest-v24.x"
$raiz = Split-Path -Parent $PSScriptRoot
$ferramentas = Join-Path $raiz ".ferramentas"
Set-Location $raiz

function Passo([string]$texto) { Write-Host ""; Write-Host "==> $texto" -ForegroundColor Cyan }
function Falha([string]$texto) {
  Write-Host ""
  Write-Host "ERRO: $texto" -ForegroundColor Red
  Write-Host "Se não resolver, abra um problema em https://github.com/tauz-hub/T-VOTE/issues com esta mensagem."
  exit 1
}
function VersaoPrincipal([string]$exe) {
  try { $v = & $exe -v 2>$null; if ($v -match '^v(\d+)\.') { return [int]$Matches[1] } } catch {}
  return 0
}

Write-Host "T-VOTE - instalação e início" -ForegroundColor White
Write-Host "Pasta: $raiz"

# ------------------------------------------------------------------ 1. Node.js
Passo "1/4  Node.js"
$sistema = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodePortatil -and $sistema -and (VersaoPrincipal $sistema.Source) -ge $NODE_MINIMO) {
  Write-Host "Usando o Node.js $(& node -v) deste computador."
} else {
  if ($NodePortatil) { Write-Host "Usando uma cópia portátil do Node.js (opção -NodePortatil)." }
  elseif ($sistema) { Write-Host "O Node.js deste computador é antigo ($(& node -v)); vou usar uma cópia portátil." }
  else { Write-Host "Este computador não tem Node.js; vou baixar uma cópia portátil." }
  $arq = switch ($env:PROCESSOR_ARCHITECTURE) { "AMD64" { "x64" } "ARM64" { "arm64" } default { $null } }
  if (-not $arq) { Falha "Windows de 32 bits não é suportado pelo Node.js atual." }

  $portatil = Get-ChildItem $ferramentas -Directory -Filter "node-v*-win-$arq" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
  if ($portatil -and (VersaoPrincipal (Join-Path $portatil.FullName "node.exe")) -ge $NODE_MINIMO) {
    Write-Host "Usando o Node.js portátil já baixado ($($portatil.Name))."
  } else {
    try {
      $somas = (Invoke-WebRequest "$NodeDist/$NODE_LINHA/SHASUMS256.txt" -UseBasicParsing).Content
    } catch { Falha "Não consegui acessar nodejs.org. Confira a internet ou instale o Node.js 22+ de https://nodejs.org e rode de novo." }
    if ($somas -is [byte[]]) { $somas = [Text.Encoding]::ASCII.GetString($somas) }
    if ($somas -notmatch "(?m)^([0-9a-f]{64})\s+(node-v[\d.]+-win-$arq\.zip)\s*$") { Falha "Não encontrei o pacote do Node.js para Windows $arq." }
    $esperado = $Matches[1]; $nome = $Matches[2]

    New-Item -ItemType Directory -Force $ferramentas | Out-Null
    $zip = Join-Path $ferramentas $nome
    Write-Host "Baixando $nome de nodejs.org (cerca de 35 MB, só na primeira vez)..."
    try { Invoke-WebRequest "$NodeDist/$NODE_LINHA/$nome" -OutFile $zip -UseBasicParsing }
    catch { Falha "O download do Node.js falhou: $($_.Exception.Message)" }

    $real = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($real -ne $esperado) { Remove-Item $zip -Force; Falha "O arquivo baixado não confere com o SHA-256 publicado por nodejs.org. Nada foi instalado." }
    Write-Host "SHA-256 conferido."

    Write-Host "Extraindo..."
    if (Get-Command tar.exe -ErrorAction SilentlyContinue) {
      & tar.exe -xf $zip -C $ferramentas
      if ($LASTEXITCODE -ne 0) { Falha "Não consegui extrair $nome." }
    } else {
      Expand-Archive $zip -DestinationPath $ferramentas -Force
    }
    Remove-Item $zip -Force
    $portatil = Get-Item (Join-Path $ferramentas ($nome -replace '\.zip$', ''))
  }
  # só para esta janela: nada muda no Windows
  $env:Path = "$($portatil.FullName);$env:Path"
  Write-Host "Node.js $(& node -v) pronto."
}

# ------------------------------------------------------------------ 2. dependências
Passo "2/4  Dependências"
$marcaDeps = Join-Path $raiz "node_modules\.t-vote-instalado"
$hashLock = (Get-FileHash (Join-Path $raiz "package-lock.json") -Algorithm SHA256).Hash
$instaladas = (Test-Path $marcaDeps) -and ((Get-Content $marcaDeps -Raw).Trim() -eq $hashLock)
if ($Reinstalar -or -not $instaladas) {
  Write-Host "Instalando (alguns minutos na primeira vez)..."
  & npm.cmd ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Falha "A instalação das dependências falhou (veja as mensagens acima)." }
  Set-Content $marcaDeps $hashLock
} else {
  Write-Host "Já instaladas."
}

# ------------------------------------------------------------------ 3. compilação
Passo "3/4  Preparando o sistema"
# pastas e arquivos separados: no PowerShell 5.1, "Get-ChildItem arquivo -Recurse" procura esse nome em todas as subpastas
$pastas = @("app", "components", "lib", "public") | ForEach-Object { Join-Path $raiz $_ } | Where-Object { Test-Path $_ }
$arquivos = @("next.config.ts", "proxy.ts", "package.json") | ForEach-Object { Join-Path $raiz $_ } | Where-Object { Test-Path $_ }
$todos = @(Get-ChildItem $pastas -Recurse -File) + @(Get-Item $arquivos)
$maisNovo = ($todos | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc
$assinatura = "$hashLock|$($maisNovo.Ticks)"
$marcaBuild = Join-Path $raiz ".next\.t-vote-compilado"
$compilado = (Test-Path (Join-Path $raiz ".next\BUILD_ID")) -and (Test-Path $marcaBuild) -and ((Get-Content $marcaBuild -Raw).Trim() -eq $assinatura)
if ($Reinstalar -or -not $compilado) {
  Write-Host "Compilando (um ou dois minutos na primeira vez)..."
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { Falha "A compilação falhou (veja as mensagens acima)." }
  Set-Content $marcaBuild $assinatura
} else {
  Write-Host "Já compilado."
}

# ------------------------------------------------------------------ 4. iniciar
Passo "4/4  Iniciando"
function PortaLivre([int]$p) {
  try { $l = [System.Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $p); $l.Start(); $l.Stop(); return $true }
  catch { return $false }
}
while (-not (PortaLivre $Porta)) { $Porta++ }
$url = "http://127.0.0.1:$Porta"

if (-not $SemNavegador) {
  # abre o navegador assim que o servidor responder
  Start-Job -ArgumentList $url -ScriptBlock {
    param($u)
    for ($i = 0; $i -lt 120; $i++) {
      try { Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process $u; return } catch { Start-Sleep -Seconds 1 }
    }
  } | Out-Null
}

Write-Host ""
Write-Host "T-VOTE rodando em $url" -ForegroundColor Green
Write-Host "Os dados ficam em $(Join-Path $raiz 'data'). Para parar, feche esta janela ou aperte Ctrl+C."
Write-Host ""
& (Join-Path $raiz "node_modules\.bin\next.cmd") start -H 127.0.0.1 -p $Porta
