# PokeIdle: Mercado, dinheiro e o que vender

Coleta feita pelo bot em 23/11/2026, só leitura: médias de 7 dias, 330 vendas reais do histórico global (22/11 18:45 → 23/11 14:19), vitrine e loja. Arquivos brutos em `mercado/`.

## 1. Quanto vale cada coisa em dinheiro

Câmbio que o servidor manda (`welcome.economia`):
- **1 Orb ("Gema") = US$ 0,01** na compra e **US$ 0,009 no saque**.
- Saque mínimo de **1.000 Orbs (US$ 9)**, pela rede Solana (SPL).

Taxa do Mercado em Orbs:
- **Pokemon:** 13% até 500 Orbs, 10% até 5.000 e 7,5% acima disso.
- **Item:** 15%.
- **Em ouro:** 15%.

**Ouro → Orb.** Pelos itens que vendem nas duas moedas, **1 Orb ≈ 4,4 a 5,5 milhões de ouro**:

| Item | Ouro | Orbs | Ouro por Orb |
|---|---|---|---|
| Bronze Boss Token | 22,2 M | 4 | 5,5 M |
| Fragmento de Chave | 897 M | 203 | 4,4 M |
| Fragmento de Shiny Stone | 421 M | 88 | 4,8 M |

Ou seja, **1 bilhão de ouro ≈ 200 Orbs ≈ US$ 1,80**. O ouro da hunt quase não vale nada em dinheiro. Ele serve para comprar bola, poção e revive.

**O dinheiro circula de verdade.** Houve 30 saques em 1,4 h, somando 59.558 Orbs (≈ US$ 536), de 1.000 a 7.340 Orbs cada.

## 2. O que vende em Orbs (médias de 7 dias)

| Item | Preço médio | ≈ US$ | Vendidos em 7 d | De onde vem |
|---|---|---|---|---|
| Rare House (70042) | 11.461 | 103 | 37 | 10 Fragmentos de Chave → casa sorteada (rara 5%) |
| Rare Bicycle (70082) | 6.865 | 62 | 36 | 10 Fragmentos de Bicicleta (rara 5%) |
| Uncommon House | 2.694 | 24 | 104 | idem (incomum 20%) |
| Uncommon Bicycle | 1.807 | 16 | 118 | idem |
| Fragmento de Ovo Shiny | 1.306 | 12 | 86 | hunts de Unova em diante (Nv 5.000+), ~1 em 150.000 |
| Common Bicycle | 1.062 | 9,6 | 425 | 10 fragmentos (comum 74,5%) |
| Common House | 1.017 | 9,2 | 596 | idem |
| Safari Ticket | 400 | 3,6 | 256 | bosses |
| Fragmento Mega Shiny | 380 | 3,4 | 1.959 | bosses |
| AoE TM Disk Piece | 367 | 3,3 | 2.872 | — |
| **Fragmento de Chave** | 203 | 1,8 | 8.359 | **Outland**, 1 em 250.000 × tier |
| **Fragmento de Bicicleta** | 150 | 1,4 | 8.104 | **Outland**, idem |
| TM Disk Piece | 139 | 1,3 | 3.121 | — |
| Fragmento Mega | 101 | 0,9 | 2.979 | bosses |
| **Fragmento de Shiny Stone** | 88 | 0,8 | 8.782 | **Outland**, idem |
| Osso do Sacrifício | 36 | 0,3 | 4.457 | **Outland**, idem |
| Pedras de evolução | 13 a 93 | 0,1 a 0,8 | centenas a 10 mil | qualquer hunt, 0,2% a 0,5% por abate [?] |
| **Bronze Boss Token** | 4 | 0,036 | 364.171 | **Outland**, 1 em 10.000 × tier |

Observações:
- O Mythic House chegou a 58.500 Orbs (≈ US$ 526), com só 2 vendas.
- Pedras: a média em Orbs vem de poucas vendas, e há anúncio a 2 Orbs na vitrine. O preço que realmente gira é incerto [?]. Em ouro elas valem de 20 mil a 140 mil.

## 3. Shiny: o produto principal

**Preço dos shiny vendidos em Orbs** (120 vendas no histórico):

| Recorte | Valor |
|---|---|
| p10 | 380 |
| p25 | 682 |
| **mediana** | **3.200 (≈ US$ 29)** |
| p75 | 5.800 |
| p90 | 12.500 |
| Nível ≤ 100, mediana | 2.000 (≈ US$ 18); mínimo 51 |
| Mega Tyranitar | 25.000 a 38.000 |
| Emolga Nv 1.725 | 40.000 |

Espécie conta muito. Larvitar Nv 20 shiny saiu de 1.200 a 25.000; Sunkern e Snover ficaram em 200 a 600.

**Como sai um shiny: resolvido pelo texto do próprio jogo.**
- *"A bola só vai no pokemon DERROTADO, e é **uma tentativa por corpo**"* (`i18n.mjs:8109`). Insistir no mesmo corpo não adianta: o servidor ignora as bolas extras.
- *"O brilho aparece **na hora da bola, capturando ou não**"* (`i18n.mjs:8223`). O sorteio de shiny (1 em 24.000, ou 1 em 12.000 com Lure) acontece uma vez por corpo em que se lança a bola. Se a bola falha, o shiny escapa.
- **Shiny capturado ≈ corpos com bola × 1/24.000 × chance da bola.** O teto de corpos é o número de abates (~960/h), e a **qualidade da bola** decide quantos shiny ficam. As contas abaixo valem.

O Shiny Secret Lure dobra a chance (1 em 12.000).
- O servidor aceita **uma bola por corpo**. Medi 21 confirmações por minuto com o bot mandando 105, o que bate com o número de abates.
- Portanto o teto é o número de corpos, **~960 a 1.260 por hora**, e o que manda é a chance de captura de cada bola.

Para o melhor caso (pokemon de 1º estágio, fator 2,867):

| Bola | Chance | Capturas/dia | Dias por shiny | Com Lure | Custo das bolas por dia |
|---|---|---|---|---|---|
| Poke Ball (5 de ouro) | 0,37% | 111 | 217 | 108 | 151 mil de ouro |
| Ultra Ball (130 de ouro) | 1,46% | 443 | 54 | 27 | 3,9 M de ouro |
| Beast Ball (só diamante) | 2,93% | 886 | 27 | 13,5 | ~470 💎 ≈ R$ 180 |
| Beast + Capture Boost | 5,86% | 1.772 | 13,5 | 6,8 | ~590 💎 ≈ R$ 225 |

**Resultado:**
- **Comprar Beast Ball ou boosts com dinheiro para caçar shiny dá prejuízo**. Gasta ~R$ 200 por dia para um shiny a cada ~7 dias, que vende por ~R$ 100 a 160.
- **O caminho que compensa é a Ultra Ball paga com o ouro da hunt.** A partir do Nv ~100 a hunt rende 550 mil de ouro por hora ou mais, e a Ultra sai de graça em dinheiro real. Isso dá um shiny a cada ~54 dias, ~27 com Lure.
- **Bônus de Twitch e Kick** (+15% cada, grátis) ajudam: resgate o Capture Boost e o Secret Lure.
- **Shiny de hunt alta vale mais.** O nível do capturado acompanha o selvagem, limitado pelo teto de captura. Subir de nível aumenta o valor de cada shiny.

## 4. Lista de venda agora

**Hoje não há nada para vender.**

| O que tem | Situação |
|---|---|
| Charmander | É o inicial, e o jogo não deixa anunciar. |
| 100 Poke Balls, 100 poções, 20 revives | Itens de loja, não anunciáveis. |
| 1 Caterpie Nv 1 capturado | A Auto Venda já mandou para o NPC por ouro. |

Regras de quem pode ser anunciado:
- **Pokemon:** precisa de Nv ≥ 50 e nota ≥ 3,5. Shiny, P5 e lendário passam sem essas exigências.
- **Shiny:** só pode ser anunciado em Orbs.

**O que vai entrar na lista, por ordem de valor:**

| # | Item | Preço de referência | Observação |
|---|---|---|---|
| 1 | **Qualquer shiny** | ver tabela da seção 3 | Anunciar perto da mediana da espécie no histórico (o bot coleta a cada 6 h). |
| 2 | **Fragmentos de Chave, Bicicleta e Shiny Stone** (Outland, Nv 150+) | 203 / 150 / 88 Orbs | Juntar 10 e fabricar a casa ou a bicicleta só se o sorteio compensar; senão vender o fragmento. |
| 3 | **Bronze Boss Token** | ~4 Orbs | Muito líquido: 364 mil unidades em 7 dias. Vender em lote. |
| 4 | **P5 e pokemon de nota alta** (Nv 50+, nota 3,5+) | caso a caso | Precisa de consulta de preço. |
| 5 | **Pedras de evolução** | 20 mil a 140 mil de ouro | Em Orbs, só se houver comprador. |

**Como vender sem eu publicar nada:** eu preparo cada anúncio (item, quantidade, preço sugerido e de onde veio o preço), e você publica no Mercado do jogo. Saque também é com você: mínimo de 1.000 Orbs, carteira Solana.

## 5. Expectativa honesta

Com esta conta e sem colocar dinheiro, o ganho em dinheiro real nas primeiras semanas é de **centavos por dia**. O que gera valor:

1. **Subir de nível rápido.**
   - O VIP dá +50% de XP por R$ 4,40/mês.
   - O Boost dos Atrasados (1.000 💎) dá XP ×10 até o Nv ~1.219.
   - Nível maior paga a Ultra Ball com o ouro da hunt e dá shiny de nível mais alto, que vale mais.
2. **Outland em tier alto.** Os drops raros (fragmentos e Boss Token) se multiplicam por até ×20, mas o tier máximo exige Nv 65.000.
3. **Sorte.** Um shiny de espécie cara (Larvitar, Dratini, Mega) paga semanas de farm.

Quem saca US$ 10 a 60 por vez no histórico são contas veteranas. A curva do [RELATORIO.md](RELATORIO.md) mostra o tempo até esses níveis.

## Regras de saque e de venda (pesquisa-web.md, Termos de 22/11/2026)

- **Moeda.** O nome para o jogador é **Gema**; "Orb" é o nome interno.
- **Saque.** São 1.000 Gemas = 9 USDT. A aprovação é **manual e sem prazo garantido**.
- **Bloqueio por rede ou navegador.** Desde 19/11, o saque espera se outra conta usada na mesma rede ou no mesmo navegador nos últimos 30 dias não estiver vinculada ao seu grupo (até 4 contas).
- **Limite de contas.** Mais de 4 contas por pessoa ou rede bane todas e trava os saques. VPN, VPS e proxy são proibidos.
- **Pedras compradas no Mercado ficam presas à conta** (desde 20/11). As **dropadas** continuam vendáveis. As fontes divergem sobre o Boss Token ter ficado preso.

## Não confirmado

- **Preço real das pedras em Orbs:** a média vem de poucas vendas e há anúncio a 2 Orbs.
- **Taxa de queda das pedras:** o código usa 0,2 / 0,35 / 0,5, sem unidade clara. No bot, zero pedras em ~300 abates, o que é compatível com 0,2%.
- **Se o servidor gasta a bola que ele ignora** quando chegam várias rápidas demais.
- **Se o Auto-Catch do VIP lança mais rápido** que 1 bola a cada 3 s.
