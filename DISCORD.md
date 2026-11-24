# O que o Discord do PokeIdle tem de útil (lido em 24/11/2026)

Canais lidos: rules, how-to-play, reedem-codes, parceria-streamers, anúncios, daily-report, radar-shiny, radar-do-ovo, radar-lendario, radar-depositos-saques. Nos chats (chat-br, marketplace) usei a busca do servidor por assunto. Não postei nada.

## Regras que afetam o bot
- **Proibido jogar por VPN, VPS ou proxy.** Está nos Termos de Uso (revisão de 22/11), anunciado na v1.474.0 de 23/11. A conta fica sujeita a punição, e a equipe pode bloquear o provedor inteiro. Desde 23–24/11, jogadores no chat contam que foram banidos por isso.
  → O bot tem que rodar **no PC de casa**. Nunca em servidor na nuvem (AWS, VPS, etc.). Vale também para o zip do amigo.
- **Automação é permitida.** Um anúncio de 20/11 diz: "Usar automações no Mercado da Comunidade para achar preço melhor continua permitido". O jogo tem extensão oficial de compra automática, a Rotom Sniper. O que é proibido é **manipular preço** (anunciar muito barato, comprar o que os outros baixaram e revender).
- **Pedras compradas no Mercado ficam presas à conta.** O **Boss Token voltou a ser revendável** em 21/11.
- **O reset do BETA já aconteceu.** O lançamento oficial foi em 07/09/2026, e o aviso de reset no canal how-to-play é de agosto. Não há reset previsto.

## Dinheiro grátis (quem faz é você, no Discord)
- **Tag IDLE no perfil do Discord:** 5 diamantes na hora e mais 5 a cada 10 dias seguidos com ela. Para pôr: Configurações → Perfis → Tag do servidor → IDLE. Depois clique em "Resgatar Recompensa de TAG" no canal reedem-codes e digite `/resgatar <código>` no chat do jogo, uma vez só. Só vale para conta de Discord com mais de 1 ano.
- **Indicação (Referral):** convidando pessoas pelo seu link de convite do canal invites-tutorial, há marcos em 1, 5, 10, 20, 50, 100 e 500 convidados.
- **Booster:** cada impulso dá 10 diamantes e mais 10 a cada 30 dias, mas o impulso exige Nitro, que é pago.

## Números do servidor (daily-report, 14 a 23/11)
- ~770 milhões de abates por dia. A região com mais abates é sempre a **Outland**.
- **~17–19 mil shiny vistos e ~160–255 capturados por dia** (1,3%; a nossa taxa é 1,4%). Isso dá ~1 shiny visto a cada ~41 mil abates no servidor.
- O shiny mais capturado é quase sempre o **Larvitar** (15–22 por dia), depois Numel e Snover.
- Os melhores jogadores fazem 50–65 mil abates por dia e 3–4 mil capturas por dia. O recorde de "encontrou shiny" é de 7 a 11 por dia.
- Depósitos de 1,2–1,7 milhão de Gemas por dia (US$ 12–17 mil). Saques de 0,5–1,2 milhão de Gemas por dia (US$ 5–10 mil).
- Câmbio (radar-depositos-saques): **depósito US$ 1 = 100 Gemas. Saque: 1.765 Gemas → US$ 15,88, ou seja, US$ 0,009 por Gema** (~10% de taxa). Os pagamentos são via Solana.

## Torneios
- Os oficiais (Showdown, Amador, Mundial) ficam com ~760–1.300 inscritos cada. Veja `torneios/`.
- **Torneios de streamer** (BiscoitoCUP, Copa do techzz, Copa D2K…): 64–128 vagas, regras restritas (pokemon até Nv 100, sem refino, P1–P4, às vezes "só Outland"), prêmio de até 3.000 Gemas. **A senha é dada na live**, e as vagas lotam rápido. Os jogadores guardam pokemon P4 sem shiny para esses torneios.

## Comparação com outros jogadores
- Jogadores com ~10–11 M XP/h relatam "98h, vistos 2, capturados 0" e "127h, vistos 2, capturados 0". Nós estamos a ~13 M XP/h.
- Combo de shiny que o chat recomenda: **Prey de capture boost + Secret Lure** (do passe ou das lives). O Secret Lure é o único que sobe a chance de **aparecer** shiny.
- "Snover, pelo /hunt, é o melhor para XP/h", segundo um jogador no Nv ~300 (não confirmado para o nosso nível).

## Dos guias do pokeidleguide.io (lidos pela API pública; cópia em scratchpad/guias)
- **Gema só entra por** depósito, comissão de indicação, **Top PvP Mensal**, pódio de campeonato ou venda no Mercado. Nenhum drop dá Gema. (guia Gemas: depósito e saque)
- **Top PvP Mensal:** no fim do mês, **metade da comissão em Gemas do Mercado** vira prêmio em Gemas para os **2.000 primeiros** do PvP. Pede ao menos 10 partidas válidas e 7 dias de jogo. O PvP Ranqueado pede Nv 150 e é grátis. A seed do campeonato vem do PR do mês. (guia PvP Ranqueado)
  - Código do jogo: a "Fila automática" do PvP é VIP e roda no servidor (`automation.pvpAutoFila`; app.js:13735, i18n.mjs:6108).
  - Na arena, o nível acima de 150 é comprimido (um Nv 3.000 luta como 578).
- **Prey** (código do jogo, shared/prey.mjs): a cartela grátis do dia sai às 18:00 e dá 9 opções. Os bônus contra a espécie escolhida são dano +10–50%, defesa −10–50%, captura +2–10% ou spawn +1–5 por onda. Não há bônus de XP nem de shiny. Escolher é grátis; re-roletar custa 1 M de ouro, dobrando a cada vez. A segunda cartela custa 100 diamantes.
- **Top Catch:** conta as espécies diferentes capturadas na semana, com marcos que dão boosts (com 600 espécies: 5 h de cada XP Boost, 40 h de Lure e 1.000 Beast Balls).
- **Outland:** as chances são as mesmas em todas (Boss Token 1/10.000 por abate; Chave, Shiny Stone, Bicicleta e Osso 1/250.000 cada). Nenhuma Outland dá mais XP ou ouro que outra.
- **Mystery Egg P2 custa 20 M de ouro.** O Ovo Shiny só sai de hunts Nv 5.000+.
- **Raid Gigantamax:** Snorlax em 07/12, com inscrição a partir de 01/12 (custa 1 Boss Token).
- **Saque:** conta fora do grupo vinculado entrando pela mesma internet **segura ou reprova o saque**. Venda por PIX ou por fora dá ban.

## Fontes externas citadas no Discord
- Guias oficiais: https://pokeidleguide.io/#guias (19 guias novos em 19/11).
- Extensão oficial de compra no Mercado: Rotom Sniper (Chrome Web Store), com 5 itens sem VIP e 15 com VIP.
