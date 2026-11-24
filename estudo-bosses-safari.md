# Estudo: bosses, Safari, Mística e Raid (PokeIdle)

Fonte do código: `SRC` = `C:/Users/lucas/AppData/Local/Temp/claude/bef36cd142dea233/f4506db9-23ce-4785-8db4-c422696613a9/scratchpad/src`. Só leitura; nada foi executado.
Dump: `mercado/welcome-catalogos.json` (uma linha só; campos `bossesCatalogo`, `mega`). Preços: `MERCADO.md` e `mercado/coleta-2026-11-23T17-35-45-665Z.json` (aba `itens`/`medias`).
Marca **[?]** = não confirmado.

## 0. Ponto de partida do bot
- A conta do bot está no **Nv 12** (`bot.log`, linha "welcome: 1049 hunts, Nv 12"). O menor boss pede treinador Nv 300 (seção 1). Hoje nenhum boss é acessível.
- O Boss Token (id 70000) só cai na Outland (1 em 10.000 por abate na Outland 1; `SRC/i18n.mjs:617`), e a Outland pede Nv 150+ (`MERCADO.md` seção 2).

## 1. Bosses

**Lista.** 9 regiões x 3 bosses = 27 (`SRC/shared/bosses-lendarios.mjs:5-66`; `bossesCatalogo` tem 27 itens no dump). No dump, `level` = `minNivelTreinador`.

| Região (degrau) | Bosses (key) | Nv do boss = Nv mínimo do treinador |
|---|---|---|
| Kanto (0) | articuno, moltres, zapdos | 300 |
| Johto (1) | suicune, entei, raikou | 650 |
| Hoenn (2) | groudon, kyogre, rayquaza | 3.100 |
| Sinnoh (3) | dialga, palkia, dex487 | 9.750 |
| Unova (4) | reshiram, zekrom, kyurem | 22.700 |
| Kalos (5) | xerneas, yveltal, zygarde | 44.050 |
| Alola (6) | solgaleo, lunala, necrozma | 75.900 |
| Galar (7) | zacian_crowned_sword, zamazenta_crowned_shield, eternatus | 120.350 |
| Paldea (8) | okidogi, munkidori, fezandipiti | 179.500 |

- Campos de cada item de `bossesCatalogo` (dump): `key, name, looktype, pokeId, category, regiao, trio, degrau, posicao, premio, level, minNivelTreinador, type1, type2, drops, dropsDetalhe, dropsDetalhePorPremio`.
- O catálogo é a vitrine. Os bosses jogáveis vêm em `estado.bossesJogaveis` (`SRC/app.js:5073`; `fichaDoBoss` em `:59455`). **Esse campo não está no dump** [?]: não deu para ver `entrada`, `equipeIdeal`, `teamLevel` em valores reais.
- Sem ficha, o boss aparece como "sem arena" (`SRC/i18n.mjs:2509`).

**Requisito de entrada.**
- Nível de treinador: `ficha.minNivelTreinador ?? b.minNivelTreinador ?? b.level` (`SRC/app.js:59918`). Botão travado com "Precisa nv X" (`SRC/i18n.mjs:2489`).
- Ter o item de entrada: `tem >= ficha.entrada.qtd && nvOk` (`SRC/app.js:59977-59978`).
- Não dá para entrar no Safari estando em arena (`SRC/i18n.mjs:4847`).

**Custo.**
- **1x Bronze Boss Token (id 70000)** por luta (`SRC/i18n.mjs:2749`). O cliente lê `ficha.entrada.qtd` e `ficha.entrada.itemId` (`SRC/app.js:59977-59984`); o "1" vem só do texto [?: qtd por boss não aparece em dado bruto].
- A entrada paga **não volta** se abandonar (`SRC/i18n.mjs:5765`). Espera de 10 s entre uma luta e outra (`SRC/i18n.mjs:2487`).
- O token não tem preço de NPC, só Mercado (`SRC/i18n.mjs:1125`).

**Duração.** Não achei limite de tempo da luta no cliente nem nos textos [?]. O 10 s entre lutas é o único tempo explícito.

**Como se vence.**
- O boss luta sempre no nível dele, com qualquer equipe (`SRC/i18n.mjs:2470`, `:2474`).
- A **equipe de hunt luta sozinha**, no mapa da arena. O cliente não manda ataque: as únicas mensagens de boss são `boss.entrar`, `boss.auto` e `boss.sair` (`SRC/app.js:60010`, `:60044`, `:7663`). A vida do boss vem de `estado.campo.mobs` (`SRC/app.js:7513-7530`). Ou seja, **o servidor simula**; o cliente só reage a `bossEntrou`, `bossMorto`, `bossPerdeu`, `bossSaiu` (`SRC/app.js:31896-31943`).
- Penalidade por equipe fraca: dano recebido x 3^déficit, com déficit = max(0, equipeIdeal - soma de min(1, nivel_pokemon / teamLevel)) (`SRC/app.js:59490-59495`). `equipeIdeal` e `teamLevel` vêm do servidor [?]. O texto de ajuda: "leve {ideal} pokemon com pelo menos o nível do boss" (`SRC/i18n.mjs:2470`), com `ideal = estado.maxEquipe ?? 5` (`SRC/app.js:59568`).
- Derrota: "{nome} venceu, sua equipe caiu na arena" (`SRC/i18n.mjs:5741`); o token já foi gasto.

**Mensagens WS.**
- `{ t: 'boss.entrar', key }`, `key` = chave do catálogo (`SRC/app.js:60010`).
- `{ t: 'boss.auto', ativo: true|false, key }` (`SRC/app.js:60044`).
- `{ t: 'boss.sair' }` (`SRC/app.js:7663`).
- Estado em `estado.eu.boss`: `{ arena:{key,slot,nome}, auto, autoKey, vitorias:{key:n} }` (`SRC/app.js:6160`, `:7504`, `:60028-60029`, `:59458`).
- Eventos recebidos: `bossEntrou {nome, nivel, penalidade:{mult}, auto}` (`SRC/app.js:31896-31903`); `bossMorto {nome, key, xpTreinador, xpPokemon, drops:[{...,qtd}], pontos, valor, lootBoost, auto}` (`SRC/app.js:31904-31939`, `:77164-77168`); `bossPerdeu {nome}`; `bossSaiu`; `bossAuto {ativo}` (`SRC/app.js:32019-32026`).

**O que `boss.auto` faz.** "Ao fim de cada luta, cura no Centro e volta, dá para {n} entradas", com `n` = tokens (`SRC/i18n.mjs:2517`). **Repete sozinho e gasta 1 token por luta, até acabar o token.** Só um boss repete por vez (`autoKey`; `SRC/i18n.mjs:2518`, `SRC/app.js:60027-60045`). Com auto ligado, o cliente agrupa os drops em lote (`SRC/app.js:31924-31927`). O que faz após uma derrota: não confirmado [?].

**Rotação de prêmio (troca às 18:00 BRT).**
- `PREMIOS_DA_TRINCA = ['tm','mega','tickets']` (`SRC/shared/bosses-lendarios.mjs:70`); ciclo de 3 dias (`:85`); dia zero `2026-11-17` (`:92`); prêmio = `PREMIOS[(posicao - dia) mod 3]` (`:104-108`).
- O dia vira em `fimDoDiaSazonal` (`:116`); `chaveDoDiaSazonal` usa deslocamento de (FUSO_BRASILIA - 6 h) (`SRC/shared/dia-sazonal.mjs`). O texto confirma "troca às 18:00" (`SRC/i18n.mjs:2493`, `:2500`). Contas com fuso: `FUSO_BRASILIA_MS` não foi aberto [?]; a conclusão "18:00" é a do texto.
- Os 3 bosses da região ficam abertos; **cada vitória sorteia os dois itens do prêmio do dia, com a chance da região** (`SRC/i18n.mjs:2501`).
- Em 23/11/2026 antes das 18:00 BRT: dia = (23/11 - 17/11) mod 3 = 0, então posição 0 (articuno, suicune...) = tm, posição 1 = mega, posição 2 = tickets [?: assume que o "dia sazonal" ainda é 23/11].

**Prêmios e chances por vitória** (`dropsDetalhePorPremio` no dump; n = degrau + 1):

| Prêmio do dia | Item (id) | Chance por vitória | Kanto | Johto | Paldea |
|---|---|---|---|---|---|
| tm | TM Disk Piece (59194) | 0,5% x n | 0,5% | 1% | 4,5% |
| tm | AoE TM Disk Piece (40530) | 0,5% x n | 0,5% | 1% | 4,5% |
| mega | Mega Stone Fragment (70014) | 0,65% x n | **0,65%** | 1,3% | 5,85% |
| mega | Mega Shiny Stone Fragment (70015) | 0,5% x n | 0,5% | 1% | 4,5% |
| tickets | Safari Ticket (70095) | 0,25% x n | 0,25% | 0,5% | 2,25% |
| tickets | Mystic Ticket (70090) | 0,0005% x n | 0,0005% | 0,001% | 0,0045% |

- Fórmulas no código: TM `0,005 x (par+1)` (`bosses-lendarios.mjs:156-158`); Safari = metade (`SRC/shared/safari.mjs:128`); Mystic `(n+1) x 0,000005` (`SRC/shared/mistico.mjs:41`, `:47`); Mega `chanceBase 0.0065` e `chanceBaseShiny 0.005` (dump, campo `mega`). Tudo bate com os números do catálogo.
- Se os dois itens saem em sorteio independente: não confirmado [?] (`SRC/i18n.mjs:2501` só diz "sorteia os mesmos dois itens").
- Quantidade por drop: o cliente mostra `x.qtd` (`SRC/app.js:31907`), valor não consta no dump [?]. Nas contas assumi 1.
- Mega Stone: 10 fragmentos fazem 1 pedra (`mega.custo: 10`, dump).
- Loot Boost **não vale** nos drops de boss (`SRC/app.js:31913`, `SRC/i18n.mjs:5733`; `pesquisa-web.md:138`). Boss não vira shiny (`SRC/i18n.mjs:5368`).
- XP e ouro: o evento traz `xpTreinador`, `xpPokemon`, `pontos` (Boss points) e `valor` (Valor NPC) (`SRC/app.js:77164-77168`). **Os valores não estão no cliente nem no dump [?].**

## 2. Safari
- **Ticket:** Safari Ticket, id 70095 (`SRC/shared/safari.mjs:79`).
- **Entrada:** `{ t: 'safari.entrar', tickets: N }`, N de 1 a 24 (`SRC/app.js:41018`; `SAFARI_MAX_TICKETS = 24`, `safari.mjs:98`). Cada ticket = 1 h (`safari.mjs:88`); a cada 6 tickets de uma vez, +30 min grátis (`:101`, `:118`). Duração = N x 1 h + floor(N/6) x 30 min; 24 tickets = 26 h.
- **Requisitos:** não estar em arena (`SRC/i18n.mjs:4847`), ter ao menos 1 pokebola (`:4849`), ter o ticket (`:4848`). Se o servidor recusar, o ticket não é gasto (`:4850`). Nível de treinador exigido: não achei [?].
- **O tempo não pausa**, e cair a conexão ou reiniciar o servidor não encerra (`SRC/i18n.mjs:4839`, `:4841`).
- **Saída:** não há `safari.sair`. A saída é `centro.desistir` (`SRC/app.js:66750`, com o aviso do Safari). Sair ou desmaiar encerra o Safari, e o ticket não volta (`SRC/i18n.mjs:4840`, `:4852`). Se o Depot encher, as horas inteiras que sobram voltam como tickets (`:4859`).
- **O que se ganha:**
  - **+15% de Shiny Secret Lure e +15% de Capture Boost**, multiplicando os outros boosts (`safari.mjs:297`; `SRC/i18n.mjs:4876`). Teto de shiny com Lure da loja e bônus de Twitch/Kick: 2 x 1,15 x 1,15 x 1,15 = 3,04 vezes (`safari.mjs:308`).
  - Espécies: uma por aparição, sorteada entre as das hunts normais, **sem Outland, Mega, lendário nem mítico** (`SRC/i18n.mjs:4833`). Tamanho do pool vem de `m.safariPool` (`SRC/app.js:5056`) [?: valor não está no dump].
  - Selvagens **Nv 1**, caem em um golpe (`safari.mjs:134`; `SRC/i18n.mjs:4834`). O capturado nasce no dobro do "nível ao capturar" da espécie, teto Nv 200 (`safari.mjs:137`, `:140`; `SRC/i18n.mjs:4835`).
  - **Sem XP, itens nem Coins** dentro (`SRC/i18n.mjs:4842`). Os XP Boosts de Trainer e Pokemon ficam pausados (`:4843`).
- **Shiny:** o bônus de Lure mostra que há sorteio de shiny lá (`SRC/i18n.mjs:4876`). A chance real (por arremesso ou por captura) segue em dúvida [?] (mesma de `MERCADO.md` seção 3).
- **Captura:** "como numa hunt", com as suas pokebolas (`SRC/i18n.mjs:4834`). O arremesso é o mesmo `ball.throw {ballId, slot}` (`SRC/app.js:31747`) e as opções de auto-bola (`autoBall*`, `SRC/app.js:31507-31508`). O bot já usa `ball.throw` (`bot.mjs:325`) e `pacoteAuto` (`bot.mjs:362`). Que o Safari aceite exatamente o mesmo pacote não foi visto em teste, só inferido do texto [?].
- Capture Boost do Prey não vale no Safari (`SRC/i18n.mjs:483`).

## 3. Mística (Mystic Ticket) e Raid semanal

**Mística.**
- Ticket id 70090 (`mistico.mjs:38`). Preço: **sem média no Mercado**, só 1 anúncio a **25.000 Gemas** (coleta, aba itens, id 70090: anuncios 1, unidades 1, minOrb 25000).
- Mensagens: `{ t: 'mistico.entrar' }` (`SRC/app.js:40614`); `{ t: 'mistico.bola', ballId }` (`:40635`); `{ t: 'mistico.sair' }` (`:7645`).
- Fluxo: sala com **um Lendário ou Mítico no nível do seu treinador**, atributos x4 (`SRC/i18n.mjs:3353`; `nivelDaLutaMistica`, `mistico.mjs:66`). Vencendo, o servidor manda `misticoCaiu` e o jogador tem **UMA bola**, em 25 s (`mistico.mjs:126`); sem escolha, **arremessa sozinho a melhor bola** (`SRC/i18n.mjs:4800`).
- Chance por bola: `CAPTURA_MISTICA_POR_BOLA` de 0,1% a 0,5% (Beast Ball), dobra com Capture Boost (`mistico.mjs:100`; `SRC/i18n.mjs:3354`).
- Perdeu: ticket perdido (`SRC/i18n.mjs:4825`); sair: ele não volta (`:3355-3356`).
- Automação: a mensagem é simples, mas o ticket é raro (0,0005% por vitória em Kanto = 1 em 200.000 lutas) e o único anúncio é 25.000. Ponto de equilíbrio: com 0,5% por bola (1% com Capture Boost), o lendário capturado precisa valer **25.000 / 0,01 = 2.500.000 Gemas** (5.000.000 sem boost) para empatar com a compra do ticket. O valor de um lendário capturado não consta nos dados [?]. Para um bot de farm: **não vale**.

**Raid semanal (Gigantamax).**
- Entrada: **1x Bronze Boss Token** (`RAID_TOKEN_ID = 70000`, `RAID_TOKEN_QTD = 1`, `SRC/shared/raid.mjs:72-73`; `SRC/i18n.mjs:2577`, `:2666`). A inscrição não se desfaz (`SRC/i18n.mjs:2574`).
- Janela (Brasília): inscrição de terça 12:00 (`RAID_HORA_VIRADA`, `raid.mjs:60`, `:325`) até segunda 16:00 (`:54`, `:326`); equipe trava segunda 20:00 (`:57`; `SRC/i18n.mjs:2670`); batalha ao vivo 20:01 (`SRC/i18n.mjs:2583`).
- Luta: todo inscrito luta ao mesmo tempo contra um só; usa a "Equipe da Raid" (até 5, `raid.mjs:76`) ou, sem escolha, a de hunt (`SRC/i18n.mjs:2579`). É um "retrato": ninguém perde vida, XP ou item (`:2581`). O dano dele dobra a cada 35 s (`:2580`).
- Prêmio: **para todo inscrito**, 0 a **+20% de XP e +5% de farm por 12 h**, conforme a vida que o servidor tirar do Gigantamax (`raid.mjs:83-88`; `SRC/i18n.mjs:2582`).
- Nível mínimo de treinador: **não achei** nas recusas (`SRC/i18n.mjs:2665-2672`: fechada, sem token, equipe inválida, não tem o pokemon, já inscrito, travada, não inscrito, sem edição) [?].
- Mensagens: `{ t: 'raid.info' }` (`SRC/app.js:60086`); `{ t: 'raid.inscrever' }` (`:60451`); `{ t: 'raid.equipe', pokemonIds: [...] }` (`:60564`); `{ t: 'raid.fichas' }` (`:63038`).
- Automação: **fácil**. Um `raid.inscrever` por semana, com 1 token (~4 Gemas), equipe de hunt por padrão. Como converter o bônus de XP/farm em Gemas: não achei [?].

## 4. Economia: valor esperado por Boss Token

**Preços usados** (`MERCADO.md` seção 2; a coleta traz 4, 101, 380, 400, 140 e 368): Boss Token 4; Safari Ticket 400; Fragmento Mega 101; Fragmento Mega Shiny 380; TM Disk Piece 139; AoE TM Disk Piece 367; Mystic Ticket 25.000 (1 anúncio, sem média).

**Conta por luta** (1 token = 1 luta; vitória certa; 1 unidade por drop; n = degrau + 1):
- Dia **TM**: 0,005n x 139 + 0,005n x 367 = **2,53n** Gemas.
- Dia **Mega**: 0,0065n x 101 + 0,005n x 380 = 0,6565n + 1,90n = **2,5565n**.
- Dia **Tickets**: Safari 0,0025n x 400 = 1,00n; Mystic 0,000005n x 25.000 = 0,125n (preço de 1 anúncio, pouco confiável). Total **1,00n a 1,125n**.
- Média dos 3 dias (sem Mystic): (2,53 + 2,5565 + 1,00) / 3 = **2,029n**.

| Região (n) | TM | Mega | Tickets | Média 3 dias | vs. vender o token (4) |
|---|---|---|---|---|---|
| Kanto (1) | 2,53 | 2,56 | 1,00 a 1,13 | 2,03 | **vender** (usar perde ~1,97) |
| Johto (2) | 5,06 | 5,11 | 2,00 a 2,25 | 4,06 | empate na média; TM/Mega +1,1, tickets perdem |
| Hoenn (3) | 7,59 | 7,67 | 3,00 a 3,38 | 6,09 | usar |
| Sinnoh (4) | 10,12 | 10,23 | 4,00 a 4,50 | 8,12 | usar |
| Unova (5) | 12,65 | 12,78 | 5,00 a 5,63 | 10,15 | usar |
| Kalos (6) | 15,18 | 15,34 | 6,00 a 6,75 | 12,18 | usar |
| Alola (7) | 17,71 | 17,90 | 7,00 a 7,88 | 14,21 | usar |
| Galar (8) | 20,24 | 20,45 | 8,00 a 9,00 | 16,24 | usar |
| Paldea (9) | 22,77 | 23,01 | 9,00 a 10,13 | 18,27 | usar |

- Ponto de empate: n = 4 / 2,029 = **1,97**, ou seja, Johto. A taxa de 15% do Mercado vale igual para o token e para os fragmentos, então a comparação não muda.
- **Kanto: vender o token vale mais.** Usar rende ~2,0 contra 4 (-49%).
- **Johto em diante** usar passa a pagar, mas nos dias de ticket ainda é pior que vender até Hoenn (3,0 a 3,4 < 4).
- Não somei o valor de uma Mega Stone (10 fragmentos); o preço dela não está nos dados [?]. Contei vender fragmento solto.
- Limites das contas:
  - Vitória certa, mas a penalidade x3^déficit pode derrotar uma equipe fraca [?].
  - Qtd 1 por drop [?].
  - Liquidez: em 7 dias o Mercado vendeu 2.968 Fragmentos Mega e 1.959 Shiny; o token teve 361.858 unidades, e um lote grande do bot empurra o preço para baixo.
  - Não contei XP, Boss points nem valor NPC do boss [?].

**Safari Ticket: usar ou vender (400)?** Duas leituras de shiny (`MERCADO.md` seção 3); 1.260 arremessos/h (~1 bola a cada 3 s):
- Leitura A (1 em 24.000 por arremesso; no Safari, com +15% de Lure: 1 em 20.870): 1.260 / 20.870 = **0,060 shiny/h**. Shiny de Nv <= 100: mediana 2.000 Gemas (`MERCADO.md` seção 3); menos 10% de taxa = 1.800. Valor/h = 0,060 x 1.800 = **~109 Gemas por ticket**. Com Shiny Secret Lure da loja (x2): ~217. Empate com 400: shiny de **6.620 Gemas** (0,060 x V = 400; o p75 é 5.800, o p90 é 12.500). O capturado nasce com nível até 200, então o valor pode ser maior que a mediana de Nv <= 100 [?].
- Leitura B (por captura): bem menos (tabela de captura em `MERCADO.md` seção 3); não paga o ticket.
- A hora grátis (+30 min a cada 6 tickets) sobe o valor por ticket em 8,3%; não muda a conclusão.
- Conclusão: **vender o Safari Ticket paga mais que usar**, salvo se a leitura A for a verdadeira e os shinies valerem mais de ~6.600. Só dados de alguns dias de bot confirmam.

## 5. Requisitos que o cliente mostra para vencer
- Nível de treinador mínimo (selo "Treinador nv X+", `SRC/app.js:59918`, `SRC/i18n.mjs:2488`): 300, 650, 3.100, 9.750, 22.700, 44.050, 75.900, 120.350, 179.500.
- Time: "{ideal} pokemon com pelo menos o nível do boss" (`SRC/i18n.mjs:2470`), `ideal = estado.maxEquipe ?? 5` (`SRC/app.js:59568`). A tela mostra "Sua equipe: {membros}/{ideal} no nível {nivel} · dano recebido x{mult}" (`SRC/i18n.mjs:2512`, `SRC/app.js:59976`).
- Fórmula: `mult = 3^max(0, equipeIdeal - soma(min(1, nivelPokemon / teamLevel)))` (`SRC/app.js:59490-59495`). Um pokemon equivalente a menos triplica o dano; dois, x9.
- `equipeIdeal` e `teamLevel` vêm do servidor [?: só o nome do campo e a fórmula estão confirmados].
- Um pokemon só obedece se o nível dele for <= nível do treinador + 5 (`RELATORIO.md:27`). Para ter o time no nível 300, o treinador precisa estar a partir do Nv 295.
- Raid: só "equipe de até 5, sem repetir" (`SRC/i18n.mjs:2667`); nível mínimo [?].

## 6. Resumo para decisão do bot
1. Nenhum boss é acessível hoje (Nv 12; Kanto pede 300).
2. Kanto: vender o token (~4) vale mais que usar (~2,0 esperado). Passa a valer usar a partir de Johto/Hoenn (Nv 650+/3.100+), principalmente nos dias de TM e Mega.
3. Raid semanal: barato (1 token) e fácil de automatizar (`raid.inscrever` de terça a segunda), com bônus de XP/farm por 12 h; nível mínimo não confirmado.
4. Safari: vender o ticket (400) tende a pagar mais que usar; depende da chance real de shiny.
5. Mística: não vale para o bot.
6. `boss.auto` repete até acabar o token; se for usar, limite antes (e reserve 1 token por semana para o Raid).
