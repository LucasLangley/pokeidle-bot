# PokeIdle: engenharia reversa da progressão (cliente v1.474.0, 23/11/2026)

## Fontes

- Código do cliente: `app.js` e 147 módulos ES, entre eles `shared/*.mjs`, que é lógica compartilhada com o servidor. O código vem sem minificação, em português.
- Pacote `welcome` do WebSocket, capturado na própria conta. Ele traz os valores que só o servidor conhece: 1.049 hunts, catálogo de bolas, captura, chance de shiny, boosts e economia.
- `/assets/items.json`, com preços NPC de poções e revives.

Legenda: **[C]** está no código do cliente, **[W]** veio do `welcome` do servidor, **[D]** é derivação minha e **[?]** não foi confirmado.

## 1. Como o jogo roda

- A caça é **simulada no servidor**. O cliente manda `hunt.select {slug}`, liga automações com `auto.set` e pode lançar bola com `ball.throw`. Não existe mensagem de ataque nem de movimento na hunt [C] (`app.js:31788`, `campo.mjs:745`).
- Há **uma sessão por conta**: a conexão nova derruba a antiga com o código 4001 [C] (`app.js:2109`). O que fica não confirmado é se o servidor também segura uma sessão sem cliente [?].
- A automação é **permitida** pelos Termos. Texto do jogo: "Automação liberada: os Termos de Uso permitem automações no jogo e no Mercado" (`i18n.mjs`, aviso v4). Há limite de rajadas por segundo no servidor e de 4 contas por pessoa/IP.
- **Morrer custa 10% do XP** do nível atual [W] (`economia.xpPerdidoPct = 10`; `app.js:66719`).

## 2. XP: treinador e pokemon usam a mesma curva [C]

```
xpTotal(L) = round(50/3 · (L³ − 6L² + 17L − 12))      app.js:66716
XP de L → L+1 = 50 · (L² − 3L + 4)
```

Exemplos: Nv1 → 100, Nv5 → 700, Nv10 → 3.700, Nv100 → 485.200, Nv1000 → 49,85 M.

Um pokemon só obedece se o nível dele for menor ou igual ao do treinador + 5. Só o inicial escapa dessa regra (`shared/pokemon-nivel-treinador.mjs:2-13`). Não há teto de nível no cliente [?].

## 3. Recompensa por abate [C]

```
xpDoNivel(n)  = n ≤ 150 ? floor(0,6·n²) + 8 : 0,6·150² · (n/150)^1,25        shared/sell-value.mjs:17
ouro base(n)  = min(15.776, 36 · n^0,6007)  + loot de 15%                      shared/sell-value.mjs:49-73
```

- Todas as 1.049 hunts têm 15 ou 16 pontos de spawn [W]. Pela estimativa do próprio jogo, isso dá ~960 a 983 abates/h (`hunt-analyser.mjs:81`). O ritmo de abates é praticamente constante, então **o XP/h depende só do nível da hunt**.
- Uma hunt fica liberada quando o nível do treinador ≥ `h.nivel` (`app.js:53009`).
- Degraus reais [W]:
  - Kanto: 1, 10, 20, 30, 40, 50, 60, 70, 80, 100, 200, 230 … 470.
  - Outland: 150.
  - Orre: 500 … 160.300, em 44 degraus.

## 4. A curva de crescimento

Simulação [D]: 970 abates/h, sempre na maior hunt liberada, sem morrer, sem boosts e depois com VIP (×1,5).

| Nível | Hunt usada | XP/h | Níveis/h | Tempo desde o Nv 1 | com VIP | Ouro/h |
|---|---|---|---|---|---|---|
| 10 | 1 | 0,01 M | 2,1 | 1,2 h | 0,8 h | 40 mil |
| 50 | 40 | 0,94 M | 8,0 | 5,7 h | 3,8 h | 368 mil |
| 100 | 80 | 3,7 M | 7,7 | 10,6 h | 7,1 h | 559 mil |
| 200 | 100 | 5,8 M | 3,0 | 30 h | 20 h | 638 mil |
| 500 | 470 | 55 M | 4,4 | 3,4 dias | 2,2 dias | 1,6 M |
| 1.000 | 850 | 114 M | 2,3 | 9,9 dias | 6,6 dias | 2,3 M |
| 2.000 | 1.750 | 282 M | 1,4 | 32 dias | 22 dias | 3,6 M |
| 5.000 | 3.500 | 672 M | 0,5 | 177 dias | 118 dias | 5,4 M |
| 10.000 | 8.600 | 2,1 B | 0,4 | 538 dias | 359 dias | 9,3 M |

Leitura:

- **Até o Nv 150 a curva é quase linear no tempo.** O custo do nível cresce com L², e o XP por abate também, então dá ~8 níveis/h.
- **Depois do 150 ela vira potência negativa.** O XP por abate passa a crescer com n^1,25 enquanto o custo segue em L², e a taxa cai mais ou menos com L^−0,75.
- **Os buracos entre degraus custam caro.** De 100 a 200 em Kanto não há hunt intermediária (só a Outland 150), e o ritmo cai para ~3 níveis/h.
- **O ouro cresce mais devagar que o XP.** Ele segue n^0,6 e para em 15.776 por abate no nível 25.000. Lá em cima o gargalo é XP; o ouro serve para poção, revive e bola.
- A tabela é um **teto otimista**: supõe que o time aguenta a hunt do mesmo nível do treinador. O dano PvE é calculado no servidor [?], com multiplicadores do selvagem de HP ×5 e dano ×1,8 [W]. Por isso o bot recua quando morre.

## 5. Captura e shiny [C + W]

```
chance = clamp(0,3%, 10%, 0,0075 · catchRate / fator · (1,4 − hpFrac))       app.js:65474
fator por degrau {20: 2,867, 40: 3,575, 100: 4,468}                           [W] captura.porDegrau
```

| Bola | catchRate | Preço | Chance máx. (fator 2,867) | Ouro por captura (média) |
|---|---|---|---|---|
| Poke Ball | 1 | 5 | 0,37% | ~1.370 |
| Great Ball | 2 | 20 | 0,73% | ~2.700 |
| Super Ball | 3 | 50 | 1,10% | ~4.550 |
| Ultra Ball | 4 | 130 | 1,46% | ~8.900 |
| Beast Ball | 8 | só diamante | 2,93% | — |

- A Poke Ball é a mais barata por captura. Capturar só para vender dá prejuízo: um pokemon vende por `base · (1 + nv/50) · Q · (shiny ? 10 : 1)`, com a base máxima em 64.907.
- Chance de shiny: **1 em 24.000** [W] (`chanceShiny = 0,0000417`). O Shiny Lure dobra.
- Boosts da loja [W]: XP ×1,5, PokeXP ×1,5, Loot ×1,4, Captura ×2, Shiny ×2. Com VIP, XP ×1,5.

## 6. Card do pokemon [C]

- **P**: potência de 1 a 5. Multiplica os stats por ×1, 1,05, 1,10, 1,25 e 2.
- **IV**: soma de 6 IVs de 1 a 32 (máximo 192).
- **Q**: qualidade de 0,8 a 1,8.
- **N**: nota de 0 a 10, em escala logarítmica entre o pior e o melhor da espécie.
- **Poder**: `round(nível · 10 · score)`. Não é dano.

Fonte: `shared/nota-pokemon.mjs`.

## 7. Economia de manutenção [W + items.json]

| Item | Preço NPC | Efeito |
|---|---|---|
| Small / Great / Ultra / Hyper / Ultimate Potion | 50 / 150 / 400 / 800 / 1.500 | cura 60 / 150 / 400 / 1.000 / 3.000 HP |
| Revive / Max Revive | 600 / 2.500 | revive com 50% / 100% |

Conta nova começa com 500 de ouro, 100 Poke Balls, 100 Small Potions e 20 Revives.

## 8. Fontes de recurso recorrentes

- Passe diário: 1 resgate por dia; se faltar um dia, volta ao Dia 1 (`shared/passe-batalha.mjs:57-84`).
- Voto no IdleHub: 1 por dia.
- Twitch/Kick: pontos de canal assistindo.
- Raid semanal: batalha às 20:01 de Brasília.
- Chocadeira: 6, 12 ou 24 h, e conta offline.
- Bosses: precisam de Boss Token.

O bot cobre só o passe. Os outros exigem conta externa ou decisão sua.

## 9. Não confirmado

- Fórmula de dano PvE e tabela de tipos (vem em `welcome.tabelaTipos`, não analisada).
- Teto de nível.
- O que a Outland (degrau 150, `outlandTier`) muda; o bot não entra nela por padrão.
- Se o servidor exige VIP no `auto.set` das bolas automáticas.
- Se o servidor rejeita `ball.throw` em corpo de outro jogador.
