# Estudo: equipe, depot/colecao, evolucao, mercado, tipos (cliente PokeIdle)
Base: scratchpad/src/app.js (linhas = app.js) e shared/*.mjs.

## 1. slot / depot / colecao
- slot != null = na equipe; slot == null = guardado (depot ou colecao): app.js:6150, 25748-25752 (proximoSlotLivre), 73638-73641 (localDoPokemon: equipe / colecao / depot).
- Slots da equipe: 0..4 (MAX_EQUIPE=5, app.js:25745; servidor manda estado.maxEquipe, 5064).
- estado.pokemons traz TODOS os pokemon da conta (equipe+depot+colecao); depot e filtrado do mesmo array: slot==null e fora da colecao (app.js:26534-26538). Mesclador: shared/estado-delta.mjs (campos cheio, pokemons, pkMud, pkFora); msg welcome = cheio, msg estado = delta (app.js:1914-1923).
- Colecao NAO e campo do pokemon: e a lista estado.eu.automation.pokemonTravado (ids) (app.js:73610-73612, 73643-73645). Nao ha mensagem separada de listagem de depot (nenhum t:'depot' no cliente).
- Mover: colecao.mover {pokemonId, para} com para 'colecao' (app.js:73683; valor para depot: nao confirmado). Resposta: evento colecao {id, naColecao, pasta, recusado} (32807, 73690-73707). Pastas: colecao.pasta.mover/criar/editar/apagar (73924, 74030-74046).

## 2. team.move
- {t:'team.move', pokemonId, slot} com slot inteiro 0..4 = posicao na equipe (25887, 25911; slot vem de proximoSlotLivre). slot:null = tirar da equipe (73704, 73731).
- Cliente so checa equipe cheia (25886) e, ao tirar o ativo sem substituto utilizavel, manda slot:null direto (73728-73733). Regras de servidor (nivel, ultimo, ativo): NAO confirmadas no cliente.
- Resposta: sem evento proprio; efeito aparece no proximo estado (slot muda). Erros chegam como aviso {msg, params} (32826). Texto de recusa: nao confirmado.
- Trocar um por outro: team.move {A, slot:null} e depois team.move {B, slot:livre}; nao ha swap atomico no cliente (inferido).
- Captura: evento de batalha capturado {pokemon, paraDepot, vendidoAuto, levelSelvagem} (31837-31858). paraDepot=true -> foi ao depot; a regra de vaga e do servidor (nao confirmada). vendidoAuto = Auto Venda vendeu.
- Auto Venda: estado.eu.automation.autoVendaDepot (32369-32371). Auto Colecao: shop.autoColecao {regra} (75517); linhas lendario, shiny, pot(min 2-5), qual, iv, nota, potencial em shared/auto-colecao.mjs.

## 3. Melhor / ativo
- Cliente nao escolhe o melhor. Ao entrar, se nao ha ativo valido, manda team.active para o primeiro da equipe com podeUsarPokemon (6150-6153). Equipe exibida ordenada por slot (25917).
- team.active {pokemonId} (25905); espera 3000 ms (shared/cooldown-ativo.mjs:70; app.js:25896-25898), so bloqueia se o ativo atual ainda luta (ativoAindaLuta 25776-25780). Pokemon da equipe com nivel > treinador+5 (nao starter) fica bloqueado (shared/pokemon-nivel-treinador.mjs; app.js:25892-25894).
- Evento troca {id, nome} (32307). Cliente usa so o ativo (painel de golpes e heroi = activeId: 29426, 31883). Se os demais sao so reserva e quem entra quando o ativo morre: NAO confirmado (servidor). Evento morte sem quem=selvagem = desmaiou (31808-31826).

## 4. Evolucao
- Catalogo: /assets/creatures.json + creatures-novos + creatures-outland-novos + creatures-formas (app.js:2348-2366). Campos evolvesToId, evolveLevel, type1, type2 (conferido em creatures.json: Bulbasaur evolvesToId 2, evolveLevel 40). O cliente ajusta depois (aplicarEvolucoesEntreGeracoes, alinharNivelPadraoRamificado, corrigirNiveisDeEvolucao, normalizarEvolveLevel600: 2437-2440; Outland zera evolucao: 2411-2415), entao evolveLevel final pode diferir do JSON cru.
- Funcao: infoEvolucao(pk) app.js:24204-24252. Ignora Outland (24205); destinos = destinosDeEvolucao(esp, buscar) (shared/evolucoes-ramificadas.mjs:301-319: usa EVOLUCOES_RAMIFICADAS[pokeId] mais evolvesToId/evolveLevel; destino {pokeId, nivel, especie, temArte}).
- Opcao: {pokeId, nome, nivel, tipos, temArte, semShiny, faltaNv (= pk.level < d.nivel), pedra, itemId, qtdPedra, disponivel} (24218-24238). disponivel = temArte && !semShiny && !faltaNv. Consome 1 pedra (modal x1, 24465), qtd em estado.eu.items[itemId] (24214, 24219).
- Pedra: pedraDaEspecie (24109-24114): tipo = tipoDaPedraDeEvolucao (evolucoes-ramificadas.mjs:282-288: TIPO_DA_PEDRA_POR_ESPECIE forcado; senao type1 do destino se ramificada; senao type1 da base) -> estado.pedrasEvolucao[tipo] ?? ...NORMAL (welcome m.pedrasEvolucao, app.js:5077; uso do formato {itemId, nome, tipo}: 24124-24127). Nomes por tipo: shared/pedras-evolucao.mjs:1-24 (FIRE Fire Stone, WATER Water Stone, GRASS Leaf Stone, ELECTRIC Thunder Stone, NORMAL Sun Stone, DARK/GHOST Darkness Stone, etc.). Shiny: estado.shinyStone.pedras (24116-24128). itemId real da pedra: so vem do servidor (nao confirmado; items.json categoria stone, app.js:46816).
- Enviar: {t:'pokemon.evoluir', pokemonId, alvoId} com alvoId = pokeId numerico do destino (pedirEvolucao 24650-24653). Sucesso: evento evolucao {id, de, nome} (31877-31881). Mega: pokemon.mega (24442).

## 5. Mercado (ouro)
- Anuncios do item: {t:'market.item', itemId, moeda:'gold'|'orb'} (47082; gold=ouro, orb=gema: 46797, 51188). Resposta {t:'market', aba:'item', itemId, moeda, linhas:[...]} (2059, 48180-48183). Campos de linha usados: id, vendedor, qtd, preco (unitario), moeda, compravelEm, ficha (46805-46818, 49342). Ordenacao por preco: NAO confirmada, ordene no bot por preco.
- Compra simples: {t:'market.comprar', id, qtd, preco, moeda, sorteioUi:1} (48843; preco = unitario do anuncio, moeda = a.moeda). Resposta: evento marketComprado {id, descricao, trancado, sorteio} (32412).
- Lote (mais barato automatico): 1) {t:'market.cotarLote', tipo:'item', itemId, moeda, qtd, seq} (51293; alvo 51227). Resposta {t:'market', aba:'cotacaoLote', seq, tipo, moeda, itemId, disponivel, qtd, pedido, total, precoMax, faixas:[{qtd,preco,anuncios}], vendedores, anuncios, noTeto} (48135, 51287-51318). 2) {t:'market.comprarLote', tipo:'item', itemId, moeda, qtd, precoMax, totalMax} (51341, valores da cotacao). Resposta: evento marketCompradoLote {tipo, itemId, moeda, qtd, pedido, total, anuncios, vendedores, motivo} (32427-32440). MAX_QTD_LOTE=1000000 (51150).
- Confirmacao: dupla so na UI; o servidor recebe uma unica mensagem. Ha retencao: anuncio com compravelEm > agora do servidor nao e comprável (49342, 49411-49420).

## 6. Tabela de tipos
- welcome.tabelaTipos -> estado.tabelaTipos (5065). Formato inferido de shared/tipo-efetividade.mjs: tabela[ATAQUE][DEFESA] = multiplicador, chaves em maiusculas, ausente = 1. Mesmo tipo (atq==def) usa DIAGONAL_DE_TIPOS (FIRE/WATER/ELECTRIC/GRASS/ICE/POISON/PSYCHIC/DARK/STEEL 0.5; GHOST/DRAGON 2; demais 1). Dupla: efetividade(atq,d1,d2,tab) = produto (d2 ignorado se igual a d1). Melhor golpe: melhorEfetividadeContra (hunt-analyser.mjs:89-96) = maior. Exemplo real do welcome: nao confirmado.
- Tipos da hunt: welcome.hunts -> estado.hunts (5026); h.especies[] tem pokeId e pontos (2476-2480, 53055); tipos = estado.especies.get(pokeId).type1/type2 (53014-53020), do catalogo creatures*.json (campos conferidos). aplicarAjustesTipos (2380) pode sobrescrever tipos; nao aprofundado.
- Golpes no catalogo: attacks[] {name, power, type, category, cooldownMs} (conferido). Cooldowns: shared/cooldown-golpes.mjs (nao lido).
