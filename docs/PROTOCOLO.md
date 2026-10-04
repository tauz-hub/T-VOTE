# Especificação do protocolo T-VOTE (v4 — seção offline)

Este documento descreve o protocolo implementado no protótipoNext.js com precisão suficiente para reimplementá-lo em
Python. **Critério de compatibilidade:** um auditor Python deve aprovar um pacote gerado pelo protótipo, e o auditor do
protótipo(`npm run auditar -- pacote.json`) deve aprovar um pacote gerado em Python.

## 1. Modelo

A seção eleitoral funciona **sem rede**, como hoje: a urna e o terminal do mesário só falam entre si. O TSE (quadro
nacional) encontra a seção só duas vezes:

| Quando | O que | Onde |
|---|---|---|
| Antes da eleição | **carga**: a urna gera a própria chave Ed25519 dentro dela; a mesa gera a chave RSA das credenciais; só as públicas vão ao quadro | bloco `CARGA` |
| Depois do encerramento | **mídia**: zerésima + BU assinados pela urna, com todas as cédulas da seção | bloco `SECAO` |

| Propriedade | Mecanismo |
|---|---|
| Autenticidade | Caderno + liberação pelo mesário + credencial assinada às cegas pela mesa da seção |
| Unicidade | Liberação de uso único; nullificador único na seção (e no quadro) |
| Sigilo | Assinatura cega; ElGamal com chave dividida em 3; chave da cédula depositada destruída; só somas de seção são decifradas; nenhuma ordem ou horário por cédula |
| Integridade | Cédula assinada pela credencial; zerésima e BU assinados pela urna (chave da carga); blocos assinados pelo quadro |
| Cifrado como pretendido | Teste do eleitor (desafio de Benaloh) com **chave da cédula impressa** e declaração assinada pela urna, conferido FORA da urna |
| Registrado como depositado | Código + figuras + conferência (81 bits) mostrados/impressos antes da decisão, gravados no BU |
| Contado como registrado | Soma homomórfica por seção + provas de decifração; BU impresso = decifração |
| Verificabilidade universal | Auditor independente (navegador, CLI, validador offline) a partir do pacote público |

Atacantes considerados: quem escreve nos bancos; o TSE com a chave do quadro; o TSE com as chaves extraídas de uma urna e
de uma mesa (backdoor de fábrica); urna com software adulterado na carga; até 2 trustees coniventes; observador da fila.
Resultados dos testes de invasão: [RELATORIO-INVASAO.md](RELATORIO-INVASAO.md).

## 2. Primitivas e codificação

| Item | Escolha | Codificação |
|---|---|---|
| Grupo | ristretto255 (RFC 9496), ordem prima `L`, gerador `g` padrão | ponto: 32 bytes canônicos em hex minúsculo; identidade = 64 zeros |
| Escalares | inteiros mod `L` | hex minúsculo com zeros à esquerda (64 caracteres) |
| Assinaturas (cédula, urna, quadro) | Ed25519 (RFC 8032) | hex |
| Assinatura cega | RSA-2048, `e = 65537`, FDH | inteiros em hex sem zeros à esquerda |
| Hashes | SHA-256 (identificadores) e SHA-512 (desafios, derivação de escalares) | hex minúsculo |
| Aleatoriedade | CSPRNG do sistema (`crypto.getRandomValues`; em Python, `secrets`) | — |

**JSON canônico:** chaves ordenadas, sem espaços, UTF-8 sem escapar não-ASCII, só inteiros como números
(`json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`).

**Escalar de hash:** `H(dominio, partes) = int.from_bytes(SHA-512(jsonCanonico({"dominio", "partes"})), "big") mod L`.

### 2.1 Domínios e mensagens

| Uso | Valor |
|---|---|
| Prova Schnorr / Chaum-Pedersen / 0-ou-1 | `H("T-VOTE/prova/schnorr/v1", …)`, `H("T-VOTE/prova/chaum-pedersen/v1", …)`, `H("T-VOTE/prova/zero-ou-um/v1", …)` com o enunciado completo |
| ctx do trustee | `"{eleicao_id}\|trustee\|{n}"` |
| ctx da opção i / da soma | `"{hash_eleicao}\|{chave_credencial}\|opcao\|{i}"` / `"…\|soma"` |
| ctx da decifração | `"{hash_eleicao}\|decriptacao\|{secao}\|{trustee}\|{opcao}"` |
| **Aleatoriedade da cédula** | `r_i = H("T-VOTE/aleatoriedade/v1", [semente, hash_eleicao, str(i)])`, `semente` = 16 bytes do CSPRNG (hex) |
| Mensagem da credencial | `"T-VOTE/credencial/v1\|{eleicao_id}\|{chave_credencial}"` (assinada às cegas pela mesa) |
| Rastreador | `SHA256hex(jsonCanonico({"dominio":"T-VOTE/rastreador/v1","eleicao":hash_eleicao,"cifras":[{a,b}…]}))` |
| Nullificador | `SHA256hex("T-VOTE/nullificador/v1\|{chave_credencial}")` |
| Mensagem da cédula | `"T-VOTE/cedula/v1\|" + jsonCanonico({eleicao, credencial, escolhas, prova_soma})` |
| Pedido de selo | `"T-VOTE/pedido-selo/v1\|{hash_eleicao}\|{rastreador}"` (assinado pela credencial) |
| **Selo** | `Ed25519(sk_urna, SHA256hex("T-VOTE/selo/v1\|" + jsonCanonico({eleicao, rastreador, secao})))` |
| **Recibo** | `SHA256hex("T-VOTE/recibo/v2\|" + jsonCanonico({tipo, eleicao, secao, rastreador}))`, assinado pela urna |
| **Declaração do teste** | `SHA256hex("T-VOTE/declaracao-teste/v2\|" + jsonCanonico({eleicao, secao, rastreador, opcao, semente}))`, assinada pela urna |
| **Documento da urna** (zerésima, BU) | `hash = SHA256hex("T-VOTE/documento-urna/v1\|" + jsonCanonico(conteudo))`, `assinatura = Ed25519(sk_urna, hash)` |
| Hash do bloco | `SHA256hex("T-VOTE/bloco/v1\|" + jsonCanonico({numero, tipo, conteudo, hash_anterior, publicado_em}))`, assinado pelo quadro |
| Hash da eleição | `SHA256hex(jsonCanonico({"dominio":"T-VOTE/eleicao/v1","genese":hash_bloco_1,"trustees":[{trustee,chave_publica}],"chave_conjunta":h}))` |

### 2.2 O que o eleitor vê: figuras, código e conferência

Tudo sai de `v = SHA256hex("T-VOTE/verificacao/v1|{selo}")` (o selo é determinístico):

| Item | Bits | Derivação | Exemplo |
|---|---|---|---|
| 2 figuras | 16 | `FIGURAS[byte 0]`, `FIGURAS[byte 1]` (256 pares emoji/palavra, ordem fixa em `palavras.ts`) | 🌶️ PIMENTA · 🦄 UNICÓRNIO |
| Código | 25 | zona (3) + seção (4) + 5 caracteres base32 Crockford dos 25 bits altos de `v[4..12)` | `001 0001 NERSD` |
| Conferência | 40 | 8 caracteres base32 de `v[12..22)` | `XJXF 48P4` |

Base32 de Crockford: `0123456789ABCDEFGHJKMNPQRSTVWXYZ`; ao ler, `O→0`, `I/L→1`, espaços e traços ignorados.
O código é único na seção (a urna recifra se repetir); a seção no prefixo o torna único na eleição.

**Por que a conferência:** código + figuras = 41 bits. Uma urna adulterada poderia preparar duas cédulas (a dela e a do
eleitor) com o mesmo código e figuras e abrir uma ou outra conforme a decisão do eleitor (tabela de ~2^30 + ~2^11
tentativas na hora). Com a conferência impressa antes da decisão, são 81 bits.

**Chave do teste** (comprovante): a `semente` (16 bytes) em base32 Crockford, 26 caracteres (128 bits + 2 bits zero).

## 3. Componentes e dados

| Componente | Onde | Conteúdo |
|---|---|---|
| Caderno + pareamento (seção) | `registro.db` | `eleitores`, `urnas(id, nome, token_hash, estado, zona, secao, firmware)`, `habilitacoes` sem rowid |
| Terminal da mesa (seção) | `autoridade.db` | `chaves(urna_id PK, eleicao_id, secao, n, e, d, p, q, dp, dq, qinv, credenciais_emitidas)` |
| Memória da urna (seção) | `urnas.db` | `carga(urna_id, eleicao_id, secao, fase, chave_privada, chave_publica, dados, zeresima, bu, bloco)`; `cedulas(urna_id, rastreador, tipo, conteudo)` **WITHOUT ROWID**; `selos`; `nullificadores`; `contagem(urna_id, opcao, votos)` |
| Quadro nacional (TSE) | `boletim.db` + `data/chaves/quadro.json` | `estado`, `blocos`, `eventos` |
| Chaves dos trustees | navegador / arquivo de cada trustee | nunca no servidor |

Pragmas: `journal_mode=DELETE`, `secure_delete=ON`. Nenhuma tabela tem horário ou sequência por cédula.

## 4. Fases e blocos

```
GENESE → CHAVE_TRUSTEE ×3 → ABERTURA → (CARGA | SECAO)* → ENCERRAMENTO → DECRIPTACAO_PARCIAL ×3 → RESULTADO
```

| Bloco | Conteúdo |
|---|---|
| `GENESE` | `versao_protocolo: 4, eleicao_id, nome, opcoes[{numero, nome, partido?, foto?, tipo}], grupo, trustees_necessarios: 3, chave_quadro, software{hash, arquivos}` |
| `CHAVE_TRUSTEE` | `trustee, nome, chave_publica, prova{t, z}` |
| `ABERTURA` | `chave_publica_conjunta, hash_eleicao, zeresima{secoes_recebidas: 0}` |
| `CARGA` | `secao ("ZZZ-SSSS"), urna, chave_urna, autoridade_secao{n, e}, software` |
| `SECAO` | `secao, zeresima: DocumentoUrna<ZERESIMA>, bu: DocumentoUrna<BU>` |
| `ENCERRAMENTO` | `secoes[{secao, bu (hash), cedulas, desafiadas}], secoes_sem_midia[], total_cedulas, total_desafiadas` |
| `DECRIPTACAO_PARCIAL` | `trustee, secoes[{secao, parciais[{d, prova{t1, t2, z}}]}]` |
| `RESULTADO` | `secoes[{secao, contagem[{opcao, votos}]}], contagem[{opcao, votos}], total` |

Documentos da urna (`DocumentoUrna<T> = {conteudo, hash, assinatura}`):

| Documento | Campos exatos |
|---|---|
| `ZERESIMA` | `tipo, eleicao, secao, urna, chave_urna, autoridade_secao, software, cedulas (0), aberta_em` |
| `BU` | `tipo, eleicao, secao, zeresima (hash), comparecimento, cedulas[], desafiadas[], contagem[{opcao, votos}], agregado[{a, b}], encerrada_em` |

`cedulas` e `desafiadas` em ordem estrita de rastreador. Cédula publicada:
`{eleicao, credencial{chave, assinatura_autoridade}, escolhas[{a, b, prova}], prova_soma, assinatura, rastreador, nullificador, secao, selo, codigo, figuras}`.
Cédula de teste: `{eleicao, cifras[{a, b}], revelacao{opcao, semente}, rastreador, secao, selo, codigo, figuras}`.

A carga vigente de uma seção é a última `CARGA` dela antes da `SECAO`; uma `CARGA` depois da `SECAO` é inválida.
Uma chave de urna não pode aparecer em duas seções.

## 5. A seção

### 5.1 Carga, abertura, liberação
1. **Carga** (com a eleição aberta): a urna gera `(sk_urna, pk_urna)` e a mesa `(n, e, d)`; o quadro publica `CARGA`.
2. **Abertura**: a urna assina a `ZERESIMA` (cédulas na memória = 0) e a imprime (chave da urna, chave da mesa, software, código).
3. **Liberação**: o mesário confere o documento e libera a urna (long-poll `/api/urna/estado?aguardar={marca}`); a urna
   nunca recebe o nome do eleitor. Contingência: código de uso único de 8 caracteres.

### 5.2 Credencial anônima (urna ↔ mesa)
A urna gera `(sk, pk)` Ed25519, envia `m' = FDH(mensagemCredencial(pk)) · r^e mod n`; a mesa consome a liberação, devolve
`s' = m'^d` e soma 1 no contador (que vai impresso no BU como **comparecimento**); a urna descega e confere.

### 5.3 Cédula, selo e decisão
1. A urna sorteia `semente`, calcula `r_i` (§2.1) e as cifras `a_i = g^{r_i}`, `b_i = g^{m_i} h^{r_i}`, com provas 0-ou-1 (CDS) e de soma (Chaum-Pedersen).
2. Pede o selo à memória da urna (assinado pela credencial); a urna confere credencial e pedido, recusa credencial já
   usada, limita 12 selos por credencial e devolve `{secao, selo, codigo, figuras}`.
3. Mostra (e imprime) **figuras, código e conferência** — o compromisso — e só então o eleitor decide:
   * **Depositar:** a cédula é assinada pela credencial; a urna guarda na memória (sem ordem), soma 1 no contador da opção,
     devolve recibo assinado e **destrói a semente** e `sk`.
   * **Testar:** a urna revela `{opcao, semente}`, guarda a cédula de teste para o BU e **imprime o comprovante**: o
     candidato que ela declara, código, conferência e **chave do teste**, com a declaração assinada. O eleitor confirma
     o voto (nova cédula, nova semente) sem redigitar.

### 5.4 Encerramento e mídia
A urna monta o `BU` (contagem do contador, comparecimento da mesa, cédulas, testes, agregado `Π a_ij, Π b_ij`), assina e
imprime: na porta da seção vai o **código do BU** = 16 primeiros hex do hash, em grupos de 4. A mídia
`{formato: "t-vote/midia-secao/v1", zeresima, bu}` vai ao TSE (transmissão ou arquivo), que confere tudo (§7) contra a
carga e só então publica `SECAO`. Mídia inválida é recusada com os motivos.

### 5.5 Apuração
Cada trustee audita o pacote, **recalcula o agregado de cada seção** e publica `D_sj = A_sj^{x_i}` com prova
Chaum-Pedersen (contexto com a seção). Com os 3: `g^{m_sj} = B_sj / Π D`, `m_sj` por busca de 0 a nº de cédulas.

## 6. Verificação do eleitor (em casa, sem confiar na urna)

| O que o eleitor tem | O que confere | Função |
|---|---|---|
| Comprovante (código + conferência) + figuras na memória | a cédula está no BU da seção, com as mesmas figuras e conferência, válida, na soma e na apuração | `verificarMinhaCedula` |
| Teste impresso no comprovante (código + chave + candidato declarado) | recifra cada opção com a chave e acha a que dá exatamente as cifras seladas sob aquele código; compara com o declarado | `reproduzirTeste` |
| Declaração do teste (JSON) | assinatura da urna × abertura publicada → prova transferível de fraude | `conferirDeclaracaoTeste` |
| Foto do BU da porta | código do BU e números = BU publicado; BU = decifração | `boletimDaSecao` |

O voto depositado nunca é aberto: a semente dele não existe mais, e os trustees só decifram somas de seção.

## 7. Verificações do auditor

| id | Verificação |
|---|---|
| `cadeia` | número sequencial, `hash_anterior`, hash recalculado |
| `assinaturas_blocos` | Ed25519 do quadro em todo bloco |
| `genese` | manifesto bem formado, `versao_protocolo = 4` |
| `fases` | ordem dos tipos, unicidade, 3 chaves antes da abertura, 3 decifrações antes do resultado |
| `trustees` | trustees 1..3 distintos, provas Schnorr |
| `zeresima` | `h = Π h_i`, `hash_eleicao` recalculado, nenhuma seção na abertura |
| `cargas` | formato; nenhuma chave de urna repetida entre seções; software = gênese; nenhuma carga depois da mídia |
| `midias` | carga anterior à mídia; zerésima zerada e com as chaves da carga; zerésima e BU assinados pela urna; BU aponta para a zerésima; uma mídia por seção |
| `sigilo` | cédulas e testes em ordem estrita de rastreador; campos exatos (sem horário) |
| `credenciais` · `assinaturas_cedulas` · `provas` | credencial da mesa da seção; assinatura da cédula; 0-ou-1 e soma = 1 |
| `rastreadores` · `duplicidade` | rastreador/nullificador recalculados; nullificadores únicos na eleição |
| `verificacao` | selo da urna sobre (cédula, seção); código = seção + parte do selo; figuras do selo; códigos únicos |
| `desafiadas` | recifração com a semente revelada = cifras publicadas |
| `comparecimento` | cédulas ≤ comparecimento; contagem do BU soma o nº de cédulas |
| `agregado` | agregado do BU = soma das cédulas da seção |
| `encerramento` | lista de seções recebidas e sem mídia confere; seção sem mídia gera **aviso** |
| `decriptacao` | provas Chaum-Pedersen de cada trustee em cada seção |
| `bu_papel` | contagem impressa no BU = decifração do agregado da seção |
| `resultado` | resultado publicado (por seção e total) = recalculado |

## 8. API (computador local)

| Método | Rota | Uso |
|---|---|---|
| GET | `/api/eleicao` | estado do quadro nacional |
| GET | `/api/publico/pacote[?baixar]` | pacote público `{formato, exportado_em, blocos}` |
| GET | `/api/publico/foto/{sha256}` | foto de candidato |
| POST | `/api/urna/instalar` | `{nome, zona, secao, [firmware, alvo, percentual]}` → `{id, nome, token}` |
| GET | `/api/urna/estado[?aguardar=marca]` | `x-urna-token` → estado da urna e da carga (long-poll) |
| POST | `/api/urna/carga` | `x-urna-token` — cerimônia de carga |
| POST | `/api/urna/selar` | `x-urna-token`, `{eleicao, rastreador, credencial, assinatura}` → `{secao, selo, codigo, figuras}` |
| POST | `/api/urna/cedula` | `x-urna-token`, `{cedula, opcao}` → `{recibo}` |
| POST | `/api/urna/desafio` | `x-urna-token`, `{desafiada, opcao_declarada}` → `{recibo, declaracao}` |
| POST | `/api/urna/concluir` | `x-urna-token` |
| POST | `/api/autoridade/credencial` | `x-urna-token`, `{mensagem_cega, [codigo]}` → `{assinatura_cega}` |
| GET | `/api/mesario/urnas` | urnas, fase da seção, comparecimento |
| POST | `/api/mesario/liberar` · `cancelar` · `habilitar` · `remover-urna` | rotina da mesa |
| POST | `/api/mesario/secao` | `{urna_id, acao: carga \| abrir \| encerrar \| transmitir}` |
| GET | `/api/mesario/midia?urna_id=` | mídia da seção em arquivo |
| POST | `/api/admin/midia` | `{midia}` — TSE recebe mídia por arquivo |
| GET | `/api/admin/secoes` | visão das urnas (laboratório) |
| POST | `/api/admin/eleicao` | `{acao: criar \| abrir \| encerrar, [forcar]}` |
| POST | `/api/trustee/chave` · `/api/trustee/decifracao` | trustees |
| GET/POST | `/api/admin/ataque` | laboratório de ataques |

## 9. Notas para a implementação em Python

* **ristretto255:** PyNaCl/libsodium (`crypto_core_ristretto255_*`, `crypto_scalarmult_ristretto255`). O `scalarmult` do
  libsodium falha quando o resultado é a identidade (`g^0`, agregado de opção sem votos): trate explicitamente.
* **Escalares:** hex big-endian no protocolo; libsodium usa little-endian.
* **Ed25519:** `cryptography`. **RSA:** `pow()` sobre inteiros. **CSPRNG:** só `secrets`.
* **Teste de ouro:** o auditor Python aprova o `pacote.json` do protótipoe reprova as adulterações de `npm run teste`.

## 10. Limitações conhecidas

* **Sigilo contra urna adulterada:** a urna vê o voto; adulterada, pode vazar o voto pela escolha da aleatoriedade (as
  figuras "codificam" o candidato). A integridade não depende da urna; o sigilo contra ela, sim. Futuro: aleatoriedade de
  um segundo aparelho (re-cifração) antes do selo.
* **Insider com as chaves da urna e da mesa** fabrica uma seção matematicamente perfeita; quem pega é o eleitor e o BU em papel.
* **Clash:** a mesma cédula mostrada a dois eleitores só é pega comparando comprovantes.
* O teste pega urna adulterada com probabilidade (depende de quantos testam).
* 3-de-3 trustees (produção: DKG t-de-n); RSA-FDH (produção: RFC 9474); chaves em software (produção: HSM/TPM); operadores
  sem autenticação; código não auditado por terceiros.
