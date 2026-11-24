# Como a extensao "/hunt for PokeIdle" v1.0.23 ranqueia hunts

Bases (so leitura estatica; nada executado):
- EXT = <pasta-de-estudo>/hunt-ext/x/src
- JOGO = <pasta-de-estudo>/src
- jogo-bundle.js (800 KB) nao foi lido, so grep.

## 1. Origem dos dados e URLs externas
- Estado/welcome: escuta passiva do WebSocket do proprio jogo (so mesma origem); parse de welcome, estado, campo.init, campo; nada e enviado. EXT/hook.js:71-107 (troca de root.WebSocket em :96-107, filtro de host em :101). Delta remontado por modulo do jogo (hook.js:58-63).
- Catalogo: baixado do proprio pokeidle.io (location.origin): assets/creatures.json, creatures-novos, creatures-outland-novos, creatures-formas, creatures-audit-overrides (EXT/game.js:12-16, 45-51). Modulos shared e hunt-analyser vem EMBUTIDOS em jogo-bundle.js (EXT/boot.js:1-4; EXT/game.js:26-27, 60).
- Unica URL de terceiros com fetch: https://pokeidleguide.io/api/wishlist e reserva https://pokeidle-gg.pages.dev/api/wishlist; GET, credentials omit, sem corpo (EXT/wishlist-ponte.js:8, 12-14). Wishlist = lista publica dos Shiny que jogadores querem comprar (EXT/ui.js:267, 380; usa dados.abertos e dados.limites.recompensaPct, ui.js:606, 639). Nao entra no ranking de hunts.
- Outro fetch: /tracker/api/sprites no proprio pokeidle.io (arte das hunts) (EXT/ui.js:509).
- Links sem fetch: https://livepix.gg/crispim (ui.js:18), https://pokeidleguide.io/#wishlist (ui.js:19).
- Envio de dados do jogador: nao achei sendBeacon, XMLHttpRequest, ws.send nem fetch com corpo em engine/game/ui/prey/geo (grep). Persistencia so em localStorage (geo.js:15, 26, 35; ui.js:28-29; prey.js:17, 19). manifest.json:55-57 declara data_collection_permissions none. NAO CONFIRMADO para jogo-bundle.js (nao li; grep de URLs nao trouxe nada util).
- A ponte da wishlist roda em mundo isolado por causa da CSP (wishlist-ponte.js:1-3; manifest.json:34-44).

## 2. Modelo (EXT/engine.js)
Fluxo: analisar (660-710) chama simularHunt por hunt (426-596) e ordena (688-689).
- Selvagem: stat = (base + 2*IV) * nivel / 100, IV=16 (engine.js:198-202; REGRAS :65). HP de combate por mob = max(24, round(hpStat*12)) * multHpSelvagem (5), 32 amostras de IV 1 a 32 (engine.js:478-484; :63).
- Dano do golpe (engine.js:192-195): base = ((2*nivel/5+2) * power * atk/def)/50 + 2; dano = base * (stab ? 1.5 : 1) * efet * 0.925. Power minimo 15. Usa pk.stats.atk ou spAtk e pk.level do ativo (:466); category define fisico ou especial (:465).
- Efetividade amplificada: v igual a 0 ou 1 fica; v maior que 1 vira 1+(v-1)*f; v menor que 1 vira v/f; f = welcome.ampliacaoHunt (1.5) (engine.js:219-221, 225-231).
- Golpes: os da especie com learnLevel menor ou igual ao nivel, cooldown via cooldownGolpeComSpeed(cd, baseSpeed, ivs.speed) (engine.js:205-210). Gap entre golpes 900 ms, menos 10 ms por IV SPD, piso 400 (REGRAS :57, 61-62; engine.js:190, 440). Investida power 30, cd 2000 ms (:59-60, 441, 474-477).
- Luta: segundosPorAbate (engine.js:251-276): a cada ataque usa o golpe pronto de maior dano, senao Investida, senao espera; cada ataque ocupa gapS; luta = ultimo golpe menos inicio, media dos 32 HPs; recargas correm no tempo morto (:273).
- Ritmo base NAO e calculado: segundos por abate = tempo morto + tempo de luta (engine.js:15-18). O tempo do mapa s (quem mata de 1 golpe) vem de tabela do simulador do jogo por mapa (EXT/ritmo.js:1-2: mapas.NOME.s entre 3.05 e 3.76 s, sAoe, faixa, hunts slug para mapa). Lookup em engine.js:373-386; fallback 3.41 (MEDIDO.sPorAbatePadrao, :73). Numero de mobs entra so pelo mapa da tabela e por onda = h.totalSpawns ou total (engine.js:550) nos extras do Prey (419-424).
- Tempo morto: tempoMorto(sMapa,F) = sMapa - max(0, 0.83*sMapa - 1.41) * (1 - exp(-F/2.8)) (engine.js:392-395; constantes :82-84). Ponto fixo luta x tempo morto por bissecao (:530-542).
- kph = 3600 / porAbate(sBase); porAbate = tempoMorto(sMapa, luta) + luta; luta = ttk / porGolpe (AoE: 2 alvos, estimado) (engine.js:551-555; :88-89).
- XP e ouro por abate: xpKill soma w * recompensa.xpPorDerrota(h, nivel, esp); ouroKill soma w * recompensa.ouroPorDerrotaHunt(h, nivel, esp) (engine.js:495, 499), w = pontos/total. Na pratica: JOGO/shared/recompensa-hunt.mjs:18-20 (xpDoNivel(nivelMob)) e :107-109 (ouroPorKillDoNivel mais bonus de loot, sem Loot Boost); sell-value.mjs:17-20 e :69-73. XP e ouro por abate dependem so do nivel da hunt, nao da especie.
- Saida: xpPokemonH = kphEf * xpKill * multPk; xpTreinadorH = kphEf * xpKill * multTr; ouroH = kphEf * ouroKill (engine.js:590-592); kphEf = kph * uptime (:570).
- Bonus de XP (VIP, boosts, guild, Twitch, Kick, evento, atrasados): engine.js:106-184. Escalam todas as hunts igual; ouroH nao usa (592).
- Ordenacao: sort desc pela chave (xpPokemonH padrao; ouroH, shinyH, fragmentoH), desempate xpPokemonH e depois nivel menor (engine.js:688-689). Padrao soLiberadas=true filtra nivel menor ou igual a eu.level (engine.js:517, 706; ui.js:31). Recomendacao = linha 0 (ui.js:424, classe pih-top). Nao achei margem de seguranca nem histerese.

## 3. Sobrevivencia, prey, boosts, VIP, drops
- Sobrevivencia: considera. ameacaDoSelvagem (engine.js:279-297): dano medio (92% golpes, 8% Investida), dps = media * multDano(1.8) / 1.4 s; hitMax = pior golpe. Morte (engine.js:557-569): com pocao (sempre ligada, ui.js:32) so morre se hitMax maior ou igual ao HP; senao 999 abates por vida; sem pocao hpPk/(dps*ttk). Custo da morte = 3 s de respawn + 20.6 tiles * 0.51 s (MEDIDO :74-76); uptime = vidaS/(vidaS+tempoMorte) reduz kph. Um selvagem bate por vez (engine.js:557-558). NAO considera custo de pocao nem a perda de 10% de XP por morte citada no README do bot (README.md:11); nao achei isso no engine.
- Prey (dano, defesa, captura, spawn extra): engine.js:35-40, 399-402, 458-463, 490, 502. Bestiario: 410-417, 459. Podio de ginasios: 306-309, 442, 463. Dia sazonal e Shield: 29-34, 436-439, 644-649. Boost e VIP: so no XP (106-184). Ouro sem Loot Boost, "por decisao de 18/10" (496-499). Captura, Shiny e fragmento: 313-362, 500-510 (fora de xpH e ouroH). Venda de capturados fora do ouro/h (320-321). AoE estimado, TM Elemental fora (42-48).

## 4. Diferenca para o jogo (hunt-analyser.mjs)
- Jogo: kph = killsPorHora(hunt) fixo por hunt (so pontos/MAX_MOBS e constantes) (JOGO/hunt-analyser.mjs:81-87); xpPokemonH = media.xp*kph*multPk, goldH = media.gold*kph (:198-208). Nao usa o seu pokemon (so tiposAtaque para fracos e fortes, :201).
- Os numeros 590-983 citados no brief: NAO CONFIRMADO (nao conferi as constantes CD_GOLPE_MS etc.).
- Extensao: kph depende do ttk do seu ativo (dano, tipo, SPD, golpes) contra o HP do mob no nivel da hunt (engine.js:485-487, 551-555) e do uptime/mortes. Estruturalmente SIM, pode ranquear uma hunt de nivel menor acima: XP por abate sobe com o nivel (sell-value.mjs:17-20), mas kph cai quando o ttk cresce (HP do mob escala com o nivel, engine.js:481-483) ou ha mortes. Sem rodar, NAO CONFIRMADO um exemplo concreto; e consequencia da formula (a tabela de s varia so de 3.05 a 3.76 s).
- Acima do nivel: com soLiberadas=false entram hunts acima do nivel do treinador, marcadas liberada=false (engine.js:517, 706; ui.js:379, 424). O teto e o nivel do treinador, nao o do pokemon.

## 5. Reproduzir no bot
Viavel. O bot ja tem: pokemons (stats, ivs.speed, level, tipos), welcome.hunts (especies pokeId e pontos, nivel, slug, totalSpawns), tabelaTipos, multHpSelvagem, multDanoSelvagem, creatures*.json (baseHp etc., type1 e type2, attacks com power, type, category, cooldownMs, learnLevel). ampliacaoHunt vem do welcome (ui.js:709): confirmar que o bot a le.
Faltam:
- (a) cooldownGolpeComSpeed (shared/cooldown-golpes.mjs) e efetividade (hunt-analyser.mjs): funcoes do jogo, que nao li (so os nomes: engine.js:206, 231).
- (b) Catalogo montado como o cliente (remap Outland, golpes especiais, planilhas, Orre, megas, overrides): EXT/game.js:62-103; o creatures cru pode divergir nos attacks.
- (c) Tabela de ritmo por mapa (ritmo.js: mapas e hunts slug para mapa); nao se deriva de creatures nem do welcome. Copiar a tabela (gerada do simulador do jogo 1.409.0, ritmo.js:1-2) ou usar 3.41 s (engine.js:73). Hunts novas precisam do mapa vindo de campo.init (geo.js:1-8).
- (d) xpDoNivel e ouroPorKillDoNivel (sell-value.mjs:17-20, 69-73).
- (e) Constantes MEDIDO e REGRAS (engine.js:54-90): copiaveis.
- (f) Opcionais: podio, sazonal, prey, bestiario, bonus de XP (eu.bonusXp). Para so ordenar por XP/h, bonus comuns podem ser ignorados; podio, sazonal e prey alteram o dano.
- Precisao declarada pelo autor (erro mediano 3-6%, maximo 19% contra 65 medidas; engine.js:21-25): afirmacao dele, nao verificada.
