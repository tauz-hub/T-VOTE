# TAI-VOTE — urna eletrônica que o eleitor confere em casa

protótipo(Next.js + SQLite) de uma urna eletrônica **verificável de ponta a ponta**, desenhada para
funcionar como a urna brasileira de hoje — seção sem rede, mesário liberando a urna, zerésima de manhã, boletim de
urna (BU) colado na porta da escola à tarde — com uma diferença:

> **Qualquer eleitor consegue conferir, em casa, sem confiar na urna nem no TSE, que o seu voto foi registrado e contado
> como ele votou — e ninguém, nem ele mesmo, consegue provar a terceiros em quem ele votou.**

> **Não utilizar em eleições reais.** Sistemas eleitorais exigem certificação, testes independentes, segurança física,
> acessibilidade e procedimentos que estão fora do escopo deste código.

## Por que isto é diferente da urna de hoje

| | Urna atual | TAI-VOTE |
|---|---|---|
| Seção funciona sem internet | ✓ | ✓ (urna e mesário só falam entre si) |
| Zerésima e BU impressos na seção | ✓ | ✓ — e assinados pela chave da própria urna |
| O eleitor sabe que **o voto dele** entrou na contagem | ✗ (confia na urna) | ✓ código + 2 figuras + conferência, conferidos no BU publicado |
| O eleitor consegue **testar a urna** e provar se ela mentiu | ✗ | ✓ teste com a chave impressa, refeito no computador dele |
| Qualquer pessoa refaz a apuração inteira | ✗ (confia na totalização) | ✓ auditor independente, código aberto, sem internet |
| Trocar votos na totalização é detectável | depende de comparar BUs | ✓ assinatura da urna + BU em papel + códigos dos eleitores |
| Ordem dos votos não pode ser reconstruída (TPS 2012) | corrigido após 2012 | ✓ sem horário, sem sequência, cédulas na ordem do hash |
| Quem conta o voto não sabe de quem é | ✓ | ✓ credencial anônima (assinatura cega) + cifra homomórfica |

## Como funciona o dia da eleição

```
 ANTES           TSE cria a eleição · 3 trustees geram a chave da eleição (cada um com um pedaço)
                 CARGA: cada urna gera a PRÓPRIA chave dentro dela; só a pública vai para o quadro
 ───────────────────────────────────── a seção desliga da rede ─────────────────────────────────────
 7h              mesário abre a seção → urna imprime a ZERÉSIMA (nenhum voto; chave da urna) → fiscais fotografam
 o dia todo      mesário confere o documento e libera a urna → eleitor vota (detalhe abaixo)
 17h             mesário encerra → urna imprime o BU (votos por candidato + CÓDIGO DO BU) → colado na porta da escola
 ───────────────────────────────────── a mídia vai ao TSE ──────────────────────────────────────────
 depois          TSE confere a mídia contra a carga e publica na cadeia · 3 trustees decifram cada seção com provas
                 qualquer pessoa baixa o pacote público e confere tudo, em casa, sem internet
```

### O que o eleitor vê na urna

A tela da urna **não é de toque**: tudo é feito pelo teclado dela — números, BRANCO, CORRIGE, CONFIRMA e uma tecla
nova, **TESTAR**. Sempre que a tela mostra o candidato escolhido, mostra também a **foto** dele.

1. **Digita o número e aperta CONFIRMA** — como hoje (foto conferida contra o hash publicado, bipe da urna).
2. A urna **cifra o voto** (ElGamal, uma chave nova para cada cédula), **sela** com a chave dela e mostra, *antes* de
   o eleitor decidir qualquer coisa: o candidato com a foto, **2 figuras** para guardar (🍄 COGUMELO · 🦴 OSSO — imagem
   em cima da palavra, para quem não lê), o **código** (`010 0123 J7K6T`) e a **conferência** (`BNGJ 69AH`).
3. O eleitor aperta:
   * **CONFIRMA** — vota. A urna guarda a cédula e **destrói a chave dela**.
   * **TESTAR** (opcional) — a urna abre aquela cédula, mostra (com foto) o candidato que estava dentro e a anula. Depois,
     **CONFIRMA** vota no mesmo candidato com uma cédula nova, sem redigitar; **CORRIGE** volta para escolher outro.
   * **CORRIGE** — volta para escolher outro.
4. **Um papel só** sai no fim (economiza bobina): o comprovante do voto — código, conferência, o nome das 2 figuras,
   hash e assinatura da urna, **sem nome, sem horário, sem candidato** — e, se o eleitor testou, a parte do **teste**: o
   candidato que a urna declarou, o código e a **chave daquela cédula de teste**, assinados pela urna.

**Na seção, duas janelas:** a urna (`/cabine`) e o **terminal do mesário** (`/terminal`), cada uma como o aparelho dela.
Em `/mesario`, "Abrir terminal do mesário" e "Abrir urna" abrem as duas.

### O que o eleitor confere em casa

| Com o quê | O que vê | Prova o quê |
|---|---|---|
| Comprovante (código) | as **mesmas 2 figuras** e a **mesma conferência** do papel, e "contabilizada" | o voto que a urna lacrou está no BU, é válido e entrou na soma decifrada |
| Teste impresso no comprovante (código + chave) | o computador **refaz a cifração** e diz qual candidato estava na cédula de teste | a urna cifrou o que mostrou — ou mentiu, e o papel assinado é a prova |
| Foto do BU da porta | o BU publicado com o mesmo código e os mesmos números, e "BU = apuração" | o TSE não trocou a seção na totalização |

Três formas, todas com o **mesmo código-fonte** do auditor:

* no site: **Verificar voto** (`/verificar`) para o voto e **Conferir teste** (`/teste`) para os testes da urna — a conta
  é feita no navegador, a partir da cadeia pública. Em "Conferir teste" basta **colar o texto do comprovante**: ele lê
  cada TESTE DA URNA (código, chave, candidato declarado, declaração assinada) e dá o veredito — *urna honesta*,
  *fraude* (com prova assinada pela urna) ou *inconclusivo* (ex.: a seção ainda não transmitiu);
* **validador offline**: um único arquivo HTML (`/validador.html`, gerado por `npm run validador`) — abre sem internet;
* **linha de comando**: `npm run verificar -- pacote.json 0100123J7K6T "5PVV ZHZ0 7DNJ ZWN1 SKWE QYC3 MM"`.

## "E se a urna mostrar uma coisa na tela e gravar outra?"

Nenhuma máquina prova a própria honestidade: se a urna estiver adulterada, tudo o que ela diz sobre si — inclusive
"verificação ok" — pode ser mentira. O laboratório tem uma urna assim (`/laboratorio/urna`): ela desvia votos, diz
"✓ A urna está correta" no teste e o BU dela **passa em toda a auditoria matemática** (ela conta no BU o que cifrou).
O protocolo não confia na tela. Ele faz três coisas:

1. **Compromisso antes da decisão.** O código, as figuras e a conferência (81 bits) aparecem antes de o eleitor escolher
   entre depositar e testar. A urna não sabe quem vai testar; se trocar votos, arrisca ser pega em cada cédula.
2. **Chave da cédula de teste impressa.** No teste, a urna é obrigada a entregar a chave daquela cédula. Em casa, o
   computador do eleitor recifra cada candidato com ela e acha o único que dá exatamente a cédula selada.
3. **Conferência fora da urna.** O validador é outro programa, aberto, rodando em outro aparelho. Se a urna mentiu, a
   conta mostra o candidato real, e a declaração assinada por ela no papel é **prova** para qualquer juiz — sem revelar
   voto nenhum (a cédula de teste não é contada).

Com 10% dos eleitores testando, uma urna que troca 50 votos é pega em 99,5% das vezes; com 100 votos trocados, em
99,997% ([relatório](docs/RELATORIO-INVASAO.md)).

## "Alguém descobre meu voto pelo meu código, minhas figuras ou meu papel?"

**Com a urna oficial, não.** O código e as figuras saem da assinatura da urna sobre o hash de uma cifra aleatória — não
do voto (o teste estatístico do relatório confirma). O que o código localiza é uma cifra ElGamal: abri-la exige a chave
da cédula, que foi destruída, ou os 3 trustees juntos — que só decifram **somas de seção**, com provas. Você pode dizer
publicamente "minhas figuras foram 👟 🗽" e até mostrar o comprovante: ninguém lê o voto nele. Nem você consegue provar
em quem votou — é isso que impede a compra de votos.

**Limites honestos:** a urna vê o voto (como a de hoje). Uma urna **adulterada** poderia escolher a aleatoriedade para
que as figuras "codifiquem" o candidato — o relatório demonstra esse canal subliminar. A integridade (contar certo)
não depende de confiar na urna; o sigilo contra uma urna adulterada, sim. O BU de cada seção é público, como hoje.
Se os 3 trustees se juntarem e alguém ligar o código a uma pessoa, aquela cifra pode ser aberta — por isso o código não
vai no papel com o nome.

## Quem pega cada fraude

`npm run teste:invasao` roda uma eleição inteira pelos módulos reais do sistema, com uma urna adulterada e ataques do
TSE com poderes crescentes, e gera o [relatório](docs/RELATORIO-INVASAO.md). Resumo:

| Fraude | Quem pega |
|---|---|
| Alterar votos no banco, com ou sem refazer hashes | auditor (assinaturas) |
| TSE (chave do quadro) some com uma cédula ou altera o resultado | auditor (assinatura da urna / provas de decifração) |
| TSE + chaves extraídas da urna e da mesa **reescreve uma seção inteira** | **eleitores** (códigos somem) e **BU em papel** — o auditor não vê |
| TSE some com uma seção inteira | **BU em papel** e eleitores; o auditor avisa "seção sem mídia" |
| Urna/BU com números falsos, ordem de chegada (TPS 2012), cédula extra, figuras trocadas | auditor |
| **Urna com software trocado** que desvia votos e mente no teste | **eleitor que testou**, em casa, com a chave do papel |

A lição: matemática, papel e eleitor se completam. Nenhum dos três sozinho pega tudo.

### Urnas com fraude prontas para simular

Em **Admin → Laboratório de ataques**, "Criar as 7 urnas de exemplo" instala, carrega e abre uma urna por tipo de
software adulterado (zona 900; candidato favorecido e vítima sorteados). "Simular tudo e transmitir" faz um eleitor
testar e votar em cada uma; "Conferir em casa" leva o comprovante dele direto para a tela de conferência.

| Urna de exemplo | Em casa |
|---|---|
| Desvia todos os votos e mente no teste | Conferir teste: a chave reproduz o candidato favorecido |
| Desvia metade dos votos | Conferir teste: cada teste tem 50% de chance — teste mais de uma vez |
| Desvia só os votos de um candidato | Conferir teste: pega quem testar o candidato-vítima |
| Transforma votos em NULO | Conferir teste: a cédula de teste aparece como NULO |
| Desvia e imprime uma chave falsa | Conferir teste: a chave não abre a cédula selada (e a urna a assinou) |
| Desvia e some com a cédula de teste | Conferir teste: o teste não está no BU transmitido |
| Mostra o seu código mas grava outra cédula (honesta no teste) | Verificar voto: o código do voto não está no BU |

Cada urna também abre numa janela própria ("Abrir a urna") para votar à mão pelo teclado.

## Como rodar

```bash
npm install
npm run dev              # http://127.0.0.1:3000 (só na interface local)
npm run teste            # protocolo em memória: auditor, teste refeito em casa e 14 ataques
npm run teste:urna       # pareamento mesa ↔ urna
npm run teste:invasao    # eleição completa pelos módulos reais + relatório docs/RELATORIO-INVASAO.md
npm run validador        # gera public/validador.html (validador offline num arquivo)
npm run auditar -- pacote.json                       # auditor de linha de comando
npm run verificar -- pacote.json <código> ["chave"]  # validador do eleitor
npm run verificar -- pacote.json --bu 010-0123       # BU publicado de uma seção
```

Requer Node 20+. Dados em `data/` (`TAI_VOTE_DADOS=<pasta>` usa outra pasta). Fotos padrão dos candidatos: divulgação
do TSE (CC BY, `public/candidatos/CREDITOS.md`); em execução nada é buscado na internet.

### Roteiro de teste

1. **Cadastro** — gere eleitores fictícios.
2. **Admin** — crie a eleição (12 candidatos a Presidente com fotos) · **Trustees** — "Gerar as chaves que faltam" ·
   **Admin** — "Abrir eleição".
3. **Mesário** → "Abrir terminal do mesário" e "Abrir urna": duas janelas, lado a lado. Na urna, pelo teclado: zona,
   CONFIRMA, seção, CONFIRMA (instala) e CONFIRMA de novo (carga).
4. **Terminal** — "Abrir a seção — imprimir zerésima"; busque um eleitor e libere. Na urna: número, CONFIRMA; TESTAR se
   quiser; CONFIRMA para votar. Sai um comprovante só.
5. **Terminal** — "Encerrar a seção — imprimir BU" e "Transmitir a mídia ao TSE" (ou "Baixar a mídia" e, no Admin,
   "Receber mídia (arquivo)").
6. **Admin** — "Encerrar recebimento" · **Trustees** — "Decifrar com os trustees restantes".
7. **Verificar voto** — o código do comprovante; o código e a chave do teste impresso no comprovante; o BU da seção.
8. **Auditoria** — auditoria completa, BUs de todas as seções, download do pacote.
9. **Conferir teste** — cole a parte TESTE DA URNA do comprovante: o seu computador diz se a urna foi honesta.
10. **Laboratório** — Admin → Laboratório de ataques: as **7 urnas com fraude** prontas, a urna adulterada manual e os
    ataques ao quadro; depois, "Desfazer".

## Telas

| Rota | Papel | O que faz |
|---|---|---|
| `/mesario`, `/terminal` | Mesa (seção) | Terminal do mesário: carga, abertura (zerésima), liberação, encerramento (BU), transmissão da mídia. `/terminal` é só a tela do aparelho, para outra janela |
| `/urna`, `/cabine` | Urna (seção) | Só pelo teclado: instalação, carga, voto com foto, TESTAR, um comprovante com voto + testes |
| `/laboratorio/urna` | Laboratório | Urna com software adulterado: desvia votos e mente no teste |
| `/verificar` | Eleitor | Meu voto · BU da seção · declaração assinada |
| `/teste` | Eleitor | Conferir os testes da urna em casa: cola o comprovante, veredito por teste e para a urna |
| `/auditoria` | Qualquer pessoa | 22 verificações sobre o pacote público, BUs, cadeia de blocos |
| `/apuracao` | Trustees | Chaves e decifração por seção |
| `/admin` | TSE | Eleição, seções, mídias por arquivo, bancos, simulação, laboratório de ataques |
| `/cadastro` | Caderno | Eleitores |
| `/seguranca` | — | Falhas históricas (TPS 2012, TPS 2017…) e riscos abertos |

## Arquitetura

```
            SEÇÃO (sem rede)                                         TSE
 ┌──────────────────────────────────────────────┐          ┌──────────────────────────┐
 │ MESÁRIO ──libera──► URNA                     │  carga   │ quadro nacional          │
 │ registro.db (A)     tela: cifra, prova, testa│ ◄─────── │ (cadeia de blocos        │
 │ caderno, pareamento urnas.db (D): chave da   │  antes   │  assinada, boletim.db C) │
 │                     urna, cédulas sem ordem, │          │                          │
 │ autoridade.db (B)   contagem, zerésima, BU   │  mídia   │ confere a mídia contra   │
 │ chave da mesa:      ─────────────────────────│ ───────► │ a carga e publica        │
 │ credencial às cegas impressora: zerésima, BU │  depois  │                          │
 └──────────────────────────────────────────────┘          └────────────┬─────────────┘
                                                                        │ pacote público
                                          TRUSTEES (decifram somas) ◄───┼───► ELEITOR / AUDITOR (em casa, offline)
```

| Banco | Sabe | Não sabe |
|---|---|---|
| `registro.db` (A) caderno | quem é eleitor, quem compareceu | nada do voto, nem ordem de comparecimento |
| `autoridade.db` (B) mesa | chave RSA da seção e quantas credenciais assinou | qual credencial é de quem |
| `urnas.db` (D) memória da urna | chave da urna, cédulas cifradas, contagem | identidade, horário, ordem de chegada, chave das cédulas depositadas |
| `boletim.db` (C) quadro do TSE | cargas e mídias das seções | identidade; nada da votação até a mídia chegar |

Especificação completa (formatos, domínios de hash, verificações, API): [docs/PROTOCOLO.md](docs/PROTOCOLO.md).

## Lições de falhas reais incorporadas

| Caso | Falha | Resposta |
|---|---|---|
| TPS 2012 (Brasil) | ordem dos votos reconstruída pelo horário usado como semente | sem semente nem horário: BU na ordem do hash; CSPRNG obrigatório (`Math.random` proibido por lint); memória `WITHOUT ROWID` |
| TPS 2017 (Brasil) | mesma chave embutida em todas as urnas; bibliotecas sem verificação | chave gerada dentro de cada urna na carga (o auditor recusa chave repetida); hash do software e das fotos na gênese |
| Hursti (EUA, 2005) | contagem pré-carregada | zerésima assinada; resultado oficial = decifração com provas; BU impresso comparado com ela |
| Washington D.C. (2010) | invasão do servidor pela rede | seção sem rede; mídia conferida antes de publicar; JSON estrito |
| Helios (2012) · Moscou (2019) · Swiss Post (2019) | Fiat-Shamir fraco · chaves de 256 bits · alçapão no embaralhamento | Fiat-Shamir forte · ristretto255 · apuração homomórfica sem mixnet |

## Limitações (dizer o que não está resolvido faz parte da segurança)

* **Sigilo contra urna adulterada** (canal subliminar) — ver acima. Futuro: aleatoriedade de um segundo aparelho independente.
* **Insider com as chaves da urna e da mesa** fabrica uma seção matematicamente perfeita: dependemos do eleitor e do BU em papel.
* **Clash:** uma urna adulterada pode mostrar a dois eleitores a mesma cédula; só se pega comparando comprovantes.
* O teste pega urna adulterada **com probabilidade** — depende de quantos eleitores testam.
* 3-de-3 trustees (produção: t-de-n com DKG); RSA-FDH (produção: RFC 9474); chaves em software (produção: HSM/TPM);
  telas de mesário e admin sem login; coerção presencial fora do alcance da criptografia; código não auditado.

## Estrutura do código

```
lib/crypto/        núcleo isomórfico (navegador, servidor, CLI e validador usam o MESMO código)
  cedula.ts          cédula um-de-n, chave da cédula, rastreador, nullificador, teste (Benaloh)
  secao.ts           zerésima, BU, mídia, declaração do teste
  quadro.ts          blocos, carga, mídia, selo e recibo da urna
  palavras.ts        figuras, código de 12, conferência de 8, chave do teste
  elgamal · provas · rsa-cega · credencial · trustee · grupo · codificacao
lib/auditoria.ts   auditor (22 verificações), verificarMinhaCedula, reproduzirTeste, boletimDaSecao
lib/server/        secao.ts (memória da urna), autoridade.ts (mesa), eleicao.ts (TSE), operacoes.ts (carga/mídia), ataques.ts
lib/laboratorio/   o "software trocado" da urna adulterada (fora do hash publicado)
lib/client/        passos do protocolo no navegador
scripts/           teste-protocolo · teste-urna · teste-invasao · auditar · verificar-voto · gerar-validador
```

Criptografia de bibliotecas maduras ([@noble/curves](https://github.com/paulmillr/noble-curves),
[@noble/hashes](https://github.com/paulmillr/noble-hashes)); nenhuma primitiva inventada.

## Rumo à versão em Python

[docs/PROTOCOLO.md](docs/PROTOCOLO.md) define formatos, domínios de hash e verificações. Uma implementação Python
correta deve **aprovar um pacote gerado por este protótipo** e reprovar as adulterações de `npm run teste` — esse é o teste
de interoperabilidade. Sugestões: PyNaCl (ristretto255), `cryptography` (Ed25519, RSA), `hashlib`, `secrets`, `sqlite3`.
