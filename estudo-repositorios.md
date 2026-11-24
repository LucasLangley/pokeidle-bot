# Estudo: repositórios públicos sobre o pokeidle.io

Data: 23/11/2026. Só leitura, via `gh api` (README, árvore e arquivos de texto). Nada foi clonado, baixado de Releases, executado ou logado. Houve 1 GET em JSON público (`radar-pokeidle.github.io/dados/gerado.json`, 180 bytes).
Notação: `owner/repo:arquivo:linha`. `SRC` = cópia local do cliente do jogo usada nos estudos anteriores (`scratchpad/src`), usada aqui só para tirar dúvida. **[?]** = não confirmado.

## Tabela-resumo

| # | Repositório | O que é | Como fala com o jogo | Vale para o bot | Risco |
|---|---|---|---|---|---|
| 1 | duperez/pokeidle-community-sdk | SDK em TypeScript (v0.0.x) | Gancho no WebSocket da página (extensão, mundo MAIN) | **Alto**: lista de 51 pacotes, 133 eventos de batalha e 216 comandos extraída do cliente 1.374.0 | Baixo |
| 2 | DredsGG/pokeidle-piloto | Extensão Chrome/Firefox: hunt, time, rotina, radar, revenda | Gancho no WebSocket da página, lista fechada de 27 comandos | **Alto**: ritmo do servidor, Dia Sazonal, rotina diária, cofre de gasto | Baixo a médio (lança bola sem VIP; revenda automática) |
| 3 | radar-pokeidle/radar-pokeidle.github.io | Site estático gerado de um banco Supabase | Não fala com o jogo; a coleta fica fora deste repo [?] | **Médio**: JSONs públicos de mercado, histórico e câmbio | Médio (extensão com compra automática; coletor não é público) |
| 4 | PedroLSCabral/pokeidletracker | Coletor de mercado + painel (Python) | Extensão do Idle Deck que empresta o socket, ou conta própria com token | **Alto**: export CSV 1/h, API pública `/tracker/api/*`, taxas, "VPS não é permitido" | Baixo |
| 5 | prado1506/pokeidle-idle-manager | App fechado (só README) + painel online pago | Desconhecido (binário de 50 MB) | Baixo (só ideias) | **Alto**: sem código, conta no serviço deles, contas rodando no servidor deles |
| 6 | cristianpaxur/PokeIdle-Autopilot | Bot Node + Playwright em Docker, até 4 contas | Navegador Chromium controlado (Playwright), lê o WS da página | **Alto**: docs de regras (ginásio, boss, raid, Safari, casas, XP Share) | Médio a alto (saque de Gemas para carteira, túnel Cloudflare público) |
| 7a | DiuleJR/pokeidle-manager-online | Bot Python headless + painel web, até 4 contas | WebSocket direto (como o seu) | **Alto**: regra de 1 bola por corpo, cooldown 1,2 s, janela do corpo 30 s | Médio (proxy por conta; painel para VPS) |
| 7b | DiuleJR/pokeidle-manager | App desktop Tauri/Rust | Brave controlado + WS | Baixo | Baixo (existe edição comercial com licença) |
| 8 | FaputaSosu/pokeidle-rate | Extensão: IV, nota, dano | Só lê o DOM | Baixo | Baixo |
| 9 | Lincoln-MO/hunt-control-for-pokeidle | Extensão: ranking de hunt, reposição, Top Catch | Gancho no WS; embute uma cópia do bundle do jogo | Baixo a médio | Médio (cópia de 808 KB do código do jogo; fork que trocou o Pix do autor original) |
| 10 | danielbonfante/pokeidle-smartmarket | Extensão: preço justo de Pokémon (Chrome Web Store) | Gancho no WS, só leitura | **Médio**: limite de ~60 mensagens/min e formato de `market.historicoGlobal` | Baixo |

## Os achados que mais mexem no bot

1. **Uma bola por corpo.** O próprio jogo diz "é uma tentativa por corpo, ou seja, a chance por arremesso é a chance por encontro" (`SRC/i18n.mjs:8109`). DiuleJR escreve o mesmo ("Cada `slot` permite só UMA tentativa", `DiuleJR/pokeidle-manager-online:balls.py:7-8`), e o Piloto apaga o corpo da fila logo depois de lançar (`DredsGG/pokeidle-piloto:extension/src/piloto/captura.js:110`). O Autopilot também: "O corpo [...] aceita uma tentativa" (`cristianpaxur/PokeIdle-Autopilot:docs/pokeidle.md:11`).
   - Contra-indício: um teste do DiuleJR simula duas bolas no mesmo slot, a primeira falha e a segunda captura (`tests/test_shiny.py:17-22`). Pode ser só um slot reaproveitado por outro selvagem. [?]
   - **O que muda:** o `RAJADA_MS=700` e o "insiste a cada 1,5 s" no shiny (`bot.mjs:46`, `:369-372`) não aumentam a chance de capturar. Provavelmente só geram recusas. Os 105 envios contra 21 confirmações por minuto (`MERCADO.md` seção 3) se explicam assim: o teto vem dos corpos que caem (≈ abates/h, ~960 a 983 segundo `RELATORIO.md`), e não de "1 bola a cada 3 s".
2. **Mecânica do shiny: o sorteio é por corpo em que se lança a bola.** O shiny aparece "na hora da bola, capturando ou não" (`SRC/i18n.mjs:8223`), e o evento `bola` traz `shiny` mesmo quando `sucesso:false` (`DiuleJR/...:tests/test_shiny.py:10`). O shiny que escapa some ("{nome} escapou e sumiu", `SRC/i18n.mjs:5571`; "O shiny que escapa [...] não conta", `SRC/i18n.mjs:8580`). Portanto:
   - shiny **visto** = corpos com bola × 1/24.000;
   - shiny **capturado** = corpos com bola × 1/24.000 × chance de captura **daquela única bola**.
   - Na prática, a leitura "por captura" (a tabela pessimista do `MERCADO.md`) é a que vale para o shiny que fica. Quando o bot lança bola em todo corpo, ele maximiza os shiny vistos. A bola boa (Ultra) é a que segura o shiny quando ele aparece. Não há segunda chance: o bot não sabe que o corpo é shiny antes do arremesso [? confira se `b.sh` em `bot.mjs:180` chega antes da 1ª bola].
3. **O servidor limita ~60 mensagens por minuto por conexão.** Acima disso responde `{"t":"erro","msg":"Devagar aí — muitas mensagens."}`. Esse é o texto exato, capturado em 11/11/2026 (`danielbonfante/pokeidle-smartmarket:CLAUDE.md:17`; `DredsGG/...:extension/src/hook.js:592-597`, `:955-957`). O cooldown confirmado entre bolas é de 1.200 ms (`DiuleJR/...:balls.py:9-10`, `config.py:44` usa 1,3 s), e o "Lançar até capturar" do VIP lança a cada 1,3 s (`DredsGG/...:hook.js:852-855`, `captura.js:21`). **O que muda:** o bot deve ter um balde de envio global (≤ ~45/min, como o Smart Market) e tratar o `erro` "Devagar" como freio, porque a rajada de bolas pode estar comendo esse limite. O `bot.log` não tem nenhuma linha "devagar". Ou o bot não registra esse `erro`, ou ele não ocorreu [?].
4. **Rotina diária grátis que o bot não usa.** São comandos de custo zero:
   - `xpshare.escolher {casaId, slot, pokemonId}`: põe reservas no XP Share da casa (`DredsGG/...:hook.js:627`, `rotina.js:10`).
   - `campeonato.inscrever {id}` e `showdown.inscrever {id}`: inscrição grátis, mensal World Nv 300+, Amateur Nv 100+ e Showdown semanal (`hook.js:724-726`; README do Piloto, "Tournaments").
   - `chocadeira.colocar {slot, ovo}`: choca Mystery Eggs P2-P4 que você já tem (`rotina.js:14`; `cristianpaxur/...:docs/estrategia.md:29`).
   - `oferenda.tudo`: alternativa à venda no NPC para limpar o Depot (`rotina.js:15`, `:736-738`).
   - Raid semanal (`raid.inscrever`) e ginásios (`ginasio.*`) a partir do Nv 150 (`cristianpaxur/...:docs/pokeidle.md:67`, `:85`).
5. **Riscos que valem para você também.**
   - "A equipe do jogo confirmou que VPS [...] não é permitido" (`PedroLSCabral/pokeidletracker:README.md:34`, `docs/PLANO.md:245-246`, 09/11/2026).
   - Limite de 4 contas por pessoa e de 4 conectadas por rede (`DiuleJR/...:README.md:18-21`).
   - O Piloto avisa que "o jogo trata o lançamento automático como benefício do VIP" (`DredsGG/...:captura.js:11-12`). Isso pesa sobre o `CAPTURAR=rajada` sem VIP.

## 1. duperez/pokeidle-community-sdk

**O que faz.** É uma biblioteca para extensões. Ela pendura no WebSocket da página (`PageTransport`, mundo MAIN, `document_start`), mantém o estado e oferece ações com trava: `buyBall`, `buyItem` e `sellPokemon`. Também gera enums de itens e bolas a partir dos catálogos do jogo.

**(a) Fatos**
- Registro completo do protocolo do cliente 1.374.0 (`packages/sdk/src/protocol/registry.generated.ts:9`, `:12`, `:15`):
  - 51 tipos de pacote do servidor, entre eles `passe`, `raid`, `raidFichas`, `topCatch`, `shiny.captura`, `drop.raro`, `lendario.captura`, `sessao.renovada` e `estatisticas` (ouro, gemas, diamantes, tempo);
  - 133 eventos de batalha;
  - 216 comandos do cliente.
- Eventos de batalha úteis que o bot pode escutar (`registry.generated.ts:73-206`):
  - `garantiaLure {bolas, horas}`;
  - `votoCreditado {qtd}`;
  - `kickBonus {ate, canal, tipo}`;
  - `raidBonus {pct, xp}`;
  - `diaSazonal {tipo}`;
  - `xpPerdido {qtd}`;
  - `fugiu {level, nome}`;
  - `bossMorto {drops, xp, lootBoost}`;
  - `rankingMensalPremio`, `topCatchPremio`, `pvpPremio`, `miniGamesPremio`.
- Comandos de rotina que o bot não usa (`registry.generated.ts:15`):
  - recompensas: `afiliado.recolher`, `convite.resgatar`, `sacrificio.resgatar`;
  - XP Share: `xpshare.escolher`, `xpshareheld.equipar`;
  - torneios: `campeonato.inscrever`, `showdown.inscrever`;
  - raid: `raid.inscrever`, `raid.equipe`;
  - boss: `boss.entrar`, `boss.auto`, `boss.sair`;
  - outros: `chocadeira.colocar`, `oferenda.girar`, `oferenda.tudo`, `topcatch.pedir`, `cliente.economia {ativo}`, `csv.pedir`.
- Campos de `welcome` e `estado` (`packages/sdk/src/protocol/wire.ts`):
  - `automation.autoBallSemParar`, `autoLockShiny`, `autoLockNotaMin`, `bossAuto`, `bossAutoKey` (`:88-107`);
  - `chanceShiny` (`:173`), `economia.xpPerdidoPct` (`:194`), `mercado.cooldownCompraMs` (`:208`);
  - `captura {base, piso, teto, raridadeDiv, porDegrau}` (`:221-228`);
  - `bossesJogaveis[].entrada {itemId, qtd}` (`:244-250`);
  - `bonusXp.partes[]` com vencimento, `twitch.pct` e `kick.pct` (`:146-149`).
  - O bot já grava a maior parte disso em `mercado/welcome-catalogos.json` (`bot.mjs:526`).
- Bolas (`packages/sdk/data/balls.json`): catchRate Poke 1, Great 2, Super 3, Ultra 4, Beast 8; preço 5/20/50/130 em ouro.
- `orbs.sacar` saca Gemas como cripto para um endereço. O SDK proíbe esse comando (`packages/sdk/src/protocol/commands.ts:16-17`).
- O limite de 3 s entre ações e 10 por minuto é **escolha do SDK** (`rate-limiter.ts`, `actions-options.ts`), não regra do servidor.

**(b) Ideias**
- Uma lista de comandos irreversíveis que exigem confirmação explícita (`commands.ts:23-53`). O bot poderia ter a mesma trava para `pokemon.evoluir` e `market.comprarLote`.
- Depois de um `unconfirmed` ou `rejected`, esperar 30 s antes de outra compra. Os erros do jogo não trazem id de pedido (README, seção "Actions").
- Rodar `protocol:check` toda semana para saber quando o jogo mudou.

**(c) Dados.** Nenhum endpoint. O catálogo vem dos dados públicos do jogo (`npm run catalog`; URL exata não lida [?]).

**(d) Riscos.** Nenhum encontrado: sem rede própria e com `orbs.sacar` bloqueado.

## 2. DredsGG/pokeidle-piloto

**O que faz.** Extensão MV3 (v1.54.3) com troca de hunt por XP/h ou ouro/h, reposição, rodízio de time, montagem de time pelo meta do PvP, rotina diária, radar e revenda no Mercado em ouro, tudo atrás de um "cofre" de orçamento. Rede externa só para o GitHub (releases e changelog). Não há telemetria (busca por URLs em `extension/`).

**(a) Fatos**
- **Ritmo:**
  - o servidor reclama com "Devagar aí — muitas mensagens" com o radar a ~1 leitura/s mais o jogo (`extension/src/hook.js:592-597`);
  - o teto da extensão é 2 leituras/s e 1 escrita/s com rajada de 3 (README, "The vault");
  - bolas nunca a menos de 1,3 s, contados na saída (`hook.js:852-855`);
  - corpo novo só recebe bola depois de 350 ms, e não recebe se faltar menos de 700 ms para sumir (`captura.js:90`).
- **Corpos no campo:** `mobs[].x=1` com `xr` = ms restantes, `sh` = shiny e `s` = slot (`captura.js:40-50`). O tempo do corpo no chão é 30 s (`SRC/app.js:31663`, `TEMPO_CHAO_MS`).
- **Modo Economia** (`cliente.economia`): o servidor para de mandar o campo, então a bola automática para (README, "Automatic Poké Ball").
- **Dia Sazonal:** sorteado às 18:00 de Brasília. Nas hunts do Mapa, o Pokémon do tipo do dia causa 2× de dano e leva ¼, o seu e os selvagens (`hunt/engine.js:243-258`; README, "Hunt switching"). A Outland conta como Mapa [?: o servidor não é público].
- **Fórmula de dano usada:** `((2·nv/5+2)·power·atk/def)/50+2`, com STAB 1,5 e aleatório médio de 0,925 (`hunt/engine.js:16-30`, `:133-136`). IV do selvagem sorteado de 1 a 32, golpe do jogador a cada 900 ms ou mais, do selvagem a cada 1,4 s ou mais (`engine.js:19-27`).
- **Ritmo de hunt medido:** campo limpo até a próxima onda leva 2,8 s; 15 spawns por padrão (`engine.js:33-41`).
- **Desmaio** custa 10% de um nível do treinador (`engine.js:471`; README).
- **Outland:** tiers com o mesmo XP e drops de ×1 a ×8 (`piloto/rotina.js:11`).
- **Boost dos Atrasados:** multiplicador de XP enquanto o nível está abaixo de um alvo, lido do estado (`engine.js:113-114`, campo `atrasados {mult, alvo}`).

**(b) Ideias que valem copiar**
- **Cofre:** reserva = máx(5 M, 2 h de ouro/h); teto diário = 50% do ouro/h × 24 h; preço desconhecido = não compra; três recusas seguidas desligam o módulo por 30 min (README, "The vault").
- **Poção pelo menor ouro por HP útil:** não curar além do HP cheio, e estoque mínimo de 1 h e alvo de 6 h medidos no consumo real (README, "Restock").
- **Rotina a cada 20 s, um comando por tique, cada um com custo e reversibilidade explícitos** (`rotina.js:1-15`). Ela cobre `passe.resgatar`, `xpshare.escolher`, `outland.tier`, `team.active` (rodízio), `pokemon.evoluir`, `chocadeira.colocar`, `oferenda.tudo` ou `shop.sellAllPokemons`.
- **Modo Farm:** a melhor espécie para XP é a que mata mais rápido, com segurança, na hunt mais alta usável. Simula toda espécie obtenível como exemplar típico em nível de treinador +5 (README, "Farm mode"). Bate com o seu critério "time por poder".
- **Inscrição automática em torneios grátis** (World, Amateur e Showdown).
- **Freio adaptativo:** cada "Devagar" corta o ritmo pela metade, e 3 min sem reclamação sobem 25% (`hook.js:597-617`).

**(c) Dados.** Nenhum endpoint externo. Lê `/app` para saber a versão do jogo (`ponte.js:42`).

**(d) Riscos**
- Lança bola sem VIP, e o autor admite que os Termos tratam isso como benefício do VIP (`captura.js:11-12`).
- Faz revenda automática no Mercado. O seu bot não revende.
- Não coleta credenciais. Tem link de doação (Pix e GitHub Sponsors).

## 3. radar-pokeidle/radar-pokeidle.github.io

**O que faz.** Site Next.js estático. Um GitHub Action lê um banco **Supabase** e grava `site/dados/*.json` (`.github/workflows/pages.yml`; `gerador/gerador.mjs:1298-1368`). Hoje roda a cada 3 h, e um `pg_cron` deve passar a disparar a cada 10 min (`pages.yml`, comentário de 23/11). As tabelas são `radar_anuncios` e as funções RPC `radar_vendas_pagina`, `radar_cambio_serie`, `radar_itens_resumo` e `radar_vendedores_mercado` (`gerador.mjs:380-1166`).
- **De onde vêm os dados:** de um coletor que **não está neste repositório** [?]. A chave do Supabase fica em variável do repo. A página `/extensao` oferece uma extensão que "recebe as avaliações prontas" e pode comprar sozinha (`site/extensao/index.txt`).

**(a) Fatos.** Mercado: anúncio novo tem retenção de 2 min e depois um sorteio entre compradores (`site/extensao/index.txt`; também `PedroLSCabral/...:docs/PLANO.md:56`).

**(c) Fontes de dados reutilizáveis** (públicas, sem login):

| URL | Tamanho em 23/11 18:44 UTC | Conteúdo (pelo gerador) |
|---|---|---|
| `https://radar-pokeidle.github.io/dados/gerado.json` | 180 B (lido) | `{geradoEm, tamanhos:{mercado, destaques, coins, pvp, "em-alta", historico}}` |
| `.../dados/historico.json` | 288 KB | `{geradoEm, especies:{<nome>:{normal:[por dia], shiny:[por dia]}}}`: vendas de 45 dias por espécie, no fuso de São Paulo (`gerador.mjs:951-960`) |
| `.../dados/em-alta.json` | 6,7 KB | `{geradoEm, g, c, cambio}`: movimento em Gemas (`g`) e em ouro (`c`), e **série de câmbio ouro↔Gema de 30 dias** (`radar_cambio_serie`, `gerador.mjs:1127-1128`, `:1363`) |
| `.../dados/mercado.json` | 3,0 MB | anúncios ativos avaliados + destaques |
| `.../dados/coins.json` | 1,9 MB | anúncios em ouro |
| `.../dados/pvp.json` | 3,0 MB | candidatos de time a partir dos anúncios |

O formato interno de cada linha de `historico` e `cambio` não foi aberto (só 1 GET permitido) [?]. O `em-alta.json` é o mais útil para conferir o seu "~5 M de ouro por Gema".

**(d) Riscos**
- O coletor e o banco são de terceiros, sem código público. Os dados são deles, e não dá para auditar a qualidade.
- Há uma extensão com compra automática e "código de apoiador".
- Uso sugerido: só leitura ocasional do `em-alta.json`, com cache.

## 4. PedroLSCabral/pokeidletracker

**O que faz.** Robô Python que grava o Mercado em SQLite. Liga-se ao jogo por uma extensão do Idle Deck (só um "cano" até `ws://127.0.0.1:8772`) ou por uma conta de coleta com token. Tem painel local e alertas por Windows, Discord ou Telegram.

**(a) Fatos**
- **Export CSV:** `csv.pedir {tipo:'mercado', filtros}`, respondido com `csv {ok, mercado:{linhas, cortado}, esperaMs}`. Traz as 5.000 vendas mais recentes (~2h20 de mercado). O limite é 1 por hora, aplicado no servidor ("uma por conexão"), e o próprio `esperaMs` diz quanto falta (`docs/PLANO.md:31`, `:195-203`).
- **Linha do export:** `[em(ms), tipo, descrição, qtd, moeda, bruto, vendedor, comprador, [nível, shiny, nota, iv, potência, qualidade]]` (`PLANO.md:203`).
- **`market.historicoGlobal`:** 30 vendas por página, com id sequencial e a ficha completa (`PLANO.md:204`).
- **`market.itens`:** todos os itens de uma vez, com número de anúncios, unidades, menor preço e média de 7 dias por moeda (`PLANO.md:205`).
- **`market.listar`:** 24 anúncios por página, ~6.300 anúncios (~260 páginas). O robô espera 1 s entre páginas (`PLANO.md:64`).
- **Valores:** shiny vale ≈ 73× o comum da mesma espécie, numa amostra de 6 espécies (`PLANO.md:84`). Sempre 10 fragmentos = 1 item (`PLANO.md:305`).
- **Taxas (Termos, seção 13):**
  - item em Gema paga 15%; qualquer venda em ouro, 15%;
  - Pokémon em Gema paga 13% até 500, 10% de 501 a 5.000 e 7,5% acima;
  - anúncio de Pokémon custa 100 mil de ouro por dia;
  - Gema: compra a US$ 0,01, saque a US$ 0,009, mínimo de 1.000 (`PLANO.md:186-192`). Confirma o seu US$ 0,009.
- **Casa e bicicleta:** 5 iguais viram 1 da raridade seguinte, até a Rara; Comum sai em 74,5% (`PLANO.md:193`).
- **VPS não é permitido**, confirmado pela equipe em 09/11/2026 (`README.md:34`, `:65`; `PLANO.md:245-246`).

**(b) Ideias**
- Fazer um `csv.pedir` por hora, respeitando `esperaMs`, numa conta que já está online. Dá série completa de vendas sem varrer o Mercado. O seu `mercado/` coleta a cada 6 h e perderia vendas (o export cobre ~2 h).
- Preço justo = mediana de 5 ou mais vendas parecidas (mesma espécie e shiny, faixa de nível e nota), descartando o que passa de 4× a mediana (`PLANO.md:67`).

**(c) Dados.** API pública sem login, documentada em `PLANO.md:121-126`:
- `https://pokeidle.io/tracker/api/jogador?nick=`
- `.../meta?faixa=`
- `.../pokemon?id=`
- `.../ladder`

O robô usa 1,5 s entre pedidos e cache de 5 min a 12 h. O catálogo de itens está em `https://pokeidle.io/assets/items.json` (`src/coleta/coletor.py:57`). Formatos não abertos [?].

**(d) Riscos.** Baixo. O token fica em `config.local.json`, fora do git, e não há envio a terceiros. Os alertas vão para webhooks do próprio usuário.

## 5. prado1506/pokeidle-idle-manager

**O que faz** (só pelo README; o repositório tem 2 arquivos): app Windows fechado (`IdleManager-Setup-2.1.22.exe`, 50 MB, também na Microsoft Store) e um "painel online" em `painel.idlemanager.com`.

**(a) Fatos** citados sem código [?]: Prey com roleta de bônus, raid de Gigantamax semanal, Top Catch semanal, aviso de "voto liberado".

**(b) Ideias.** Metas de caça "Top Catch" (espécies novas da semana) e "Nv mais baixo (evolui sozinho)".

**(d) Riscos (altos)**
- Binário sem código.
- "Crie sua conta no app" (`README.md:105`).
- No painel online, "as contas rodam no servidor 24 horas" e os "dados das contas [ficam] no servidor do Idle Manager" (`README.md:112-118`). Ou seja: token sob custódia de terceiros e rodando em servidor, o que a equipe do jogo disse não permitir (ver repo 4).
- É pago (R$ 5 por conta a cada 30 dias, `README.md:120`).
- Lê e responde o chat de qualquer conta.

**Não usar.**

## 6. cristianpaxur/PokeIdle-Autopilot

**O que faz.** Bot Node com Playwright (Chromium com perfil persistente, `src/browser.mjs:138`) em Docker, até 4 contas. Planejador de progressão, captura, ginásio, boss, PvP, Safari, raid e mercado (vende tokens e fragmentos da Outland).

**(a) Fatos** (`docs/pokeidle.md`, cliente 1.414.1 a 1.420.0):
- **Corpo:** aceita uma tentativa; bola e estágio da espécie mudam a chance (`:11`).
- **Mercado:** exige Nv 50 e nota 3,5, com exceções para shiny, P5, lendário e mítico (`:12`).
- **Ginásios:** PvP assíncrono a partir do Nv 150. O bônus de dano para o tipo é 25%, 10% e 5% para os 3 primeiros; dois tipos usam o maior, sem somar; cooldown de 24 h por tipo (`:67-69`).
- **Bosses:** começam no Nv 300. Há penalidade por membro abaixo do nível recomendado, e a repetição nativa (`boss.auto`) continua mesmo após derrota e desconexão. A ficha não volta se você sair (`:71-73`).
- **PvP ranqueado:** a partir do Nv 150 (`:81`).
- **Safari:** ticket de 1 h (`docs/estrategia.md:43`).
- **Raid semanal:** inscrição uma vez por edição, com ficha (`:44`); não exige guild.
- **Casas e bicicletas:** casa com `maxEmUso`, capacidade × % de XP; bicicleta com `trocaLiberaEm` (`estrategia.md:23-26`).
- Fontes oficiais citadas: módulos públicos `https://pokeidle.io/shared/*.mjs` (`casas`, `bicicletas`, `passe-batalha`, `chocadeira`, `raid`, `safari`, `teto-captura`, `captura-degrau`, `ginasios`, `bosses-lendarios`) e `https://pokeidle.io/pokepedia.mjs` (`estrategia.md:90-100`).

**(b) Ideias**
- **Bola automática pelo custo-benefício:** `preço em ouro / chance`, com chance mínima de 0,5% e teto de 10 mil de ouro por bola (`docs/pokeidle.md:55`). Com uma tentativa por corpo, isso vira a régua certa: compare Ultra × Poke em ouro por shiny capturado.
- **Hunt por medição:** janelas de 90 s, até 3 candidatas, 5 min na melhor; medições de até 30 min são reutilizadas (`docs/pokeidle.md:29-31`).
- **Busca de pedra de evolução** caçando onde ela cai, em vez de comprar (`:41`).
- **Mudança de evento ou bônus de XP** reinicia a comparação de hunts (`:45`).
- **Intenção gravada antes de gastar**, com reconciliação depois de reconectar (`estrategia.md:50`, `:82-84`).

**(d) Riscos**
- **Saque de Gemas para carteira de cripto:** preenche `#orbs-endereco` e confirma (`src/browser.mjs:75-85`, `src/session.mjs:410`, `:798-818`).
- **Túnel Cloudflare** (`trycloudflare.com`) expõe o painel com "Assumir controle" do navegador na internet (`src/mobile-tunnel.mjs:4-15`), protegido por usuário e senha.
- Faz deploy em Dokploy, isto é, servidor, o que esbarra na regra "VPS não é permitido".

## 7. DiuleJR/pokeidle-manager-online e DiuleJR/pokeidle-manager

**7a (online).** Bot Python headless, WebSocket direto como o seu, até 4 contas, painel FastAPI e React.
- **(a) Fatos**
  - O corpo fica capturável por ~30 s depois de `morte` com `quem:'selvagem'`. Cada slot aceita só UMA tentativa, e o evento `bola` encerra a oportunidade. O cooldown mínimo confirmado é 1.200 ms. `fugiu` é só informativo e não vem depois de toda falha (`balls.py:1-15`; `config.py:43-44`).
  - Ping a cada 30 s; sem frame por 150 s com hunt ativa = sessão travada, reconectar (`config.py:29-32`).
  - "O jogo reinicia o servidor várias vezes por dia": quedas de menos de 2 min não geram aviso (`config.py:34`).
  - O evento `bola` traz `shiny` (`tests/test_shiny.py:10`).
  - **Termos:** 4 contas por pessoa no total, e no máximo 4 conectadas ao mesmo tempo por rede (`README.md:18-21`).
- **(b) Ideias**
  - Vigia de "frame silence".
  - Cooldown ao detectar o código 4001.
  - Detectar token vencido ou conta banida e parar de reconectar (`README.md:28-34`).
  - Contar shiny vistos e capturados por slot, associando `fugiu` à tentativa que falhou (`session_stats.py:75-87`). É exatamente o que falta para fechar a dúvida do shiny com dados seus.
- **(d) Riscos**
  - **Proxy SOCKS5/HTTP por conta**, com teste de IP de saída via `api.ipify.org` (`README.md:30`, `:99-104`; `connection.py:110-127`). Serve para burlar o limite "4 por rede".
  - Guia para rodar em VPS (`README.md:106`), contra a regra informada no repo 4.
  - Login por senha da conta do jogo pelo painel (`README.md`, "Adicionar contas").
  - O worker de "melhor hunt" carrega código de um site de terceiros, `https://pokeidle-gg.pages.dev` (`telemetry.py:272-276`), isolado por CSP.
  - A "telemetria" é só a API local do painel (`/api/telemetry`).

**7b (desktop).** App Tauri/Rust que controla o Brave, em RC4, com instaladores não assinados. O `PRIVACY.md:15` diz que não há telemetria própria. A "edição comunitária é compilada sem um serviço comercial de licenciamento" (`README.md`, "Compilar"), então existe uma edição comercial. Há documentação de protocolo de Twitch e Kick: `estado.twitch.{pct, extra, oficiais[].bonus}` e `estado.kick.bonus {xp, captura, shiny}` (`docs/protocol/lives.md:14-44`). Pouco útil para o bot.

## 8. FaputaSosu/pokeidle-rate

Extensão de 2 arquivos (`src/rate.js`, `src/rate.css`) que lê a ficha no DOM e mostra efetividade de tipos, IVs (de 0 a 32) e prévia de dano. Não tem rede. **(a)** nada novo; **(d)** nenhum risco.

## 9. Lincoln-MO/hunt-control-for-pokeidle

Extensão com ranking de hunts, hunt fixa, reposição, Pokédex e Top Catch. Os dois últimos usam o "Lançar até Capturar" do VIP.
- **(a)** O Top Catch semanal reinicia no domingo às 00h de Brasília (`README.md`, "Modos de captura VIP"). `auto.set` com reenvio e pausa depois de 65 s sem confirmação (`docs/NOTAS_DE_DESENVOLVIMENTO.md:16`).
- **(b)** Para completar a Pokédex, priorizar alvos que levam dano super efetivo do time, depois níveis baixos e baixo risco (`NOTAS:83`).
- **(d) Riscos**
  - Embute `src/jogo-bundle.js` (808 KB), uma cópia do código do jogo (risco de direitos).
  - É um fork que trocou a chave Pix e o Livepix "do autor antigo" (`NOTAS:59`, `:85`).

## 10. danielbonfante/pokeidle-smartmarket

Extensão só de leitura, na Chrome Web Store. Estima o preço de um Pokémon pelas vendas do próprio jogo: quartis "vender rápido / mercado / esperar".
- **(a) Fatos**
  - O limite do servidor é ~60 mensagens/min por conexão, e acima disso vem `{"t":"erro","msg":"Devagar aí — muitas mensagens."}`. O orçamento seguro adotado é 45/min, contando **tudo** o que sai pelo socket (`CLAUDE.md:16-17`).
  - Formato de `market.historicoGlobal {pagina, seq, tipo, moeda, busca}`, respondido com `market {aba:'historicoGlobal', porPagina:30, temMais, linhas}` (`CLAUDE.md:26-27`).
  - `busca:"+houndour"` traz a família inteira, e `busca:"#<pokemonId>"` traz as vendas daquele exemplar, sem janela de 30 dias (`CLAUDE.md:103`, `:76`).
- **(b) Ideia.** Contar todas as mensagens de saída num só balde e pausar 3 min ao receber "Devagar".
- **(d) Riscos.** Nenhum: tem só a permissão `storage` e não usa URL externa em `src/`.

## Não confirmado e onde procurei

- **Se o corpo aceita mais de uma bola:** o texto do jogo (`SRC/i18n.mjs:8109`), DiuleJR, Piloto e Autopilot dizem uma. Só o teste do DiuleJR (`tests/test_shiny.py:17-22`) sugere duas. Para fechar: logar os `erro` que voltam depois da 2ª bola no mesmo slot.
- **Se o bot sabe que o corpo é shiny antes da bola:** o bot lê `b.sh` (`bot.mjs:180`), e o Piloto lê `mobs[].sh` no campo (`captura.js:47`). Mas o jogo diz que o brilho aparece "na hora da bola". Não verifiquei em tráfego.
- **Quem alimenta o Supabase do Radar:** procurei em `gerador/`, `site/extensao` e `.github/`, sem resultado. O coletor não é público.
- **Formato interno de `historico.json` e `em-alta.json`:** só li o gerador, e o único GET foi no `gerado.json`.
- **prado1506:** só o README; não abri o binário.
- **API `pokeidle.io/tracker/api/*`:** só documentada pelo PedroL; não fiz nenhuma chamada.
