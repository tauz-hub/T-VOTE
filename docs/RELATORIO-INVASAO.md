# Relatório dos testes de invasão — T-VOTE v4

Gerado por `npm run teste:invasao` em 04/10/2026, 02:39:02. Eleição completa pelos módulos reais do sistema, com dados numa pasta temporária.

## Quem pega cada fraude

| Fraude | Atacante | Quem percebeu neste teste | Quem deve perceber |
|---|---|---|---|
| Reescrever uma seção com as chaves extraídas do hardware | TSE + chaves extraídas da urna/mesa | 14 eleitor(es) com o comprovante · BU em papel (001-0001) | A matemática toda confere — o auditor PASSA. Quem pega é o eleitor (o código do comprovante some) e o BU em papel (código do BU e números diferentes). Faça antes da apuração. |
| Sumir com uma seção inteira | TSE (chave do quadro) | 14 eleitor(es) com o comprovante · 5 eleitor(es) que testaram · BU em papel (001-0001) | BU em papel na porta da escola e os eleitores da seção (códigos não aparecem). O auditor só pode avisar que a seção ficou sem mídia. |
| Enfiar cédula extra com credencial legítima | TSE + chaves extraídas da urna/mesa | auditor (comparecimento) · BU em papel (001-0001) | Auditor: mais cédulas que comparecimento (o contador da mesa vai impresso no BU). |
| Guardar a ordem de chegada com horário (TPS 2012) | TSE + chaves extraídas da urna/mesa | auditor (sigilo) · BU em papel (001-0001) | Auditor: cédulas fora da ordem canônica e com campos extras. |
| Trocar as figuras e o código gravados de duas cédulas | TSE + chaves extraídas da urna/mesa | auditor (verificacao) · 2 eleitor(es) com o comprovante · BU em papel (001-0001) | Auditor: figuras e código não saem do selo; e o eleitor vê figuras diferentes das que memorizou. |
| Urna com software trocado na carga: desvia 100% dos votos para o nº 55 e mente no teste | quem fabrica/carrega a urna | 4 de 4 eleitor(es) que testaram (auditor e BU: nada — o desvio é coerente) | o eleitor que testa, em casa, com a chave do papel |
| Trocar um voto direto no banco | banco de dados | auditor (cadeia, midias, assinaturas_cedulas, provas, rastreadores, agregado, decriptacao) · 36 eleitor(es) com o comprovante | Auditor: a cadeia de hashes e a assinatura da cédula quebram. |
| Trocar um voto e recalcular os hashes | banco de dados | auditor (assinaturas_blocos, midias, assinaturas_cedulas, provas, rastreadores, agregado, decriptacao) · 36 eleitor(es) com o comprovante | Auditor: a assinatura do quadro não confere. |
| Sumir com uma cédula na totalização | TSE (chave do quadro) | auditor (midias, comparecimento, encerramento, decriptacao) · 14 eleitor(es) com o comprovante | Auditor: o BU deixa de ter a assinatura da urna (o TSE não tem a chave dela). |
| Imprimir um BU com números falsos | TSE + chaves extraídas da urna/mesa | auditor (bu_papel) · BU em papel (001-0001) | Auditor, depois da apuração: o BU impresso não bate com a decifração do agregado da seção. |
| Alterar o resultado publicado | TSE (chave do quadro) | auditor (resultado) | Auditor: o resultado recalculado a partir das decifrações é outro. |

**Leitura:** a auditoria matemática pega tudo o que mexe no quadro sem as chaves da urna e da mesa. Quando o insider tem também essas chaves (backdoor de fábrica), ele consegue fabricar uma seção matematicamente perfeita — e quem pega é o **eleitor** (o código do comprovante some) e o **BU em papel** colado na porta da escola (código do BU e números diferentes). Quando a fraude está **dentro da urna** (software trocado), o BU sai coerente com as cifras e só o **eleitor que testa** pega — em casa, refazendo a cifração com a chave impressa no comprovante (parte do teste).

## A urna adulterada e o teste do eleitor

A seção 001-0003 tinha software trocado na carga: desviava 100% dos votos para o nº 55, mostrava ao eleitor o número que ele digitou e, no teste, declarava (e assinava) esse número. O BU dela saiu com 12 voto(s) para o nº 55 e passou em todas as verificações matemáticas. Os 4 eleitores que testaram a urna refizeram a cifração em casa com a chave do papel: em 4 de 4 a conta mostrou o nº 55, e a declaração assinada pela urna dizia outro — prova de fraude que qualquer juiz confere, sem revelar voto nenhum.

Chance de pegar uma urna que troca *k* votos, se cada eleitor testa com probabilidade *p* — a urna não sabe quem vai testar, porque se compromete com o código antes da decisão. (Basta UM eleitor testar uma cédula trocada.)

| k votos trocados | 5% testam | 10% testam | 20% testam |
|---|---|---|---|
| 1 | 5.0% | 10.0% | 20.0% |
| 10 | 40.1% | 65.1% | 89.3% |
| 50 | 92.3% | 99.5% | 99.9986% |
| 100 | 99.4% | 99.9973% | > 99.9999% |
| 300 | > 99.9999% | > 99.9999% | > 99.9999% |

## Sigilo

- **Memória da urna:** cédulas guardadas na ordem do rastreador, não na de chegada (correlação de Spearman -0.03); nenhuma chave de cédula depositada guardada; nenhum log com horário por voto.
- **Código, figuras e papel com a urna oficial:** não dependem do voto — a 1ª figura saiu "ímpar" em 52% das cédulas do nº 13 e 53% das do nº 14. O que o código localiza é uma cifra ElGamal; abri-la exige a chave da cédula (destruída) ou os 3 trustees juntos (que só decifram somas de seção).
- **Limite honesto — urna adulterada:** a urna vê o voto (como a de hoje). Uma urna adulterada pode escolher a aleatoriedade até a figura "codificar" o candidato: neste teste ela vazou 20 de 20 votos com ~19 cifrações por voto. A verificabilidade (integridade) não depende de confiar na urna; o **sigilo** contra uma urna adulterada depende de controles fora da matemática (software conferido na carga, testes) — ou de uma segunda fonte de aleatoriedade independente da urna, que fica como trabalho futuro.

## Força do compromisso antes do teste

Com só as 2 figuras (16 bits), uma urna adulterada achou, em 393 cifrações, duas cédulas — uma para o nº 13, outra para o nº 14 — com as mesmas figuras. Se o eleitor conferisse só as figuras, ela poderia abrir uma no teste e depositar a outra. Por isso a urna mostra e imprime, antes da decisão, o código (25 bits) e a **conferência** (40 bits): com 81 bits, preparar o par exigiria ~2^40 cifrações na hora, inviável. Em casa, o validador mostra a conferência gravada para o eleitor comparar com o papel.

