# TASKS: PokeIdle bot

## Rodada "fazer tudo" (23/11/2026)
- [x] Estatísticas acumuladas em `stats.json` (bolas confirmadas por tipo, capturas, shiny, abates, drops), para medir se o shiny sai por arremesso ou por captura
- [x] Manter o PC acordado só enquanto o bot roda (`manter-acordado.ps1`, filho do bot)
- [x] Equipe: os 5 de maior poder que podem ser usados; o mais forte como ativo. Shiny fica de fora.
- [x] Evolução: a partir do Nv 20, com pedra do tipo comprada em ouro (teto de 300 mil e 40% do ouro). Espécies com evolução ramificada ficam de fora.
- [x] Hunt pelo tipo: dentro do mesmo degrau, a hunt onde o ativo mais bate e menos apanha
- [x] Estudo de bosses, Safari, Mística e Raid (`estudo-bosses-safari.md`)
- [x] README atualizado

## Pendente: regras decididas, aplicar quando chegar a hora
- [ ] **Boss Token:** abaixo do Nv 3.100, vender (~4 Gemas cada). A partir do Nv 3.100 (Hoenn), usar com `boss.auto` no boss mais alto liberado. Rende de 6 a 18 Gemas por token.
- [ ] **Safari Ticket:** vender (~400 Gemas). Usar rende ~110 a 220 Gemas em valor esperado.
- [ ] **Raid semanal:** inscrição de terça 12:00 a segunda 16:00, custa 1 token, dá até +20% de XP por 12 h. Automatizar quando houver token sobrando (mensagens em `estudo-bosses-safari.md`).
- [ ] **Medir o shiny:** depois de alguns dias, ler `stats.json` (bolas confirmadas e shiny capturados) e decidir se o Shiny Secret Lure compensa.
- [ ] **Evolução:** confirmar no log a primeira evolução real (Charmander no Nv 20+).
- [ ] **Hunt por tipo:** conferir a escolha na troca de degrau (Nv 20).

## Rodada "melhorias de XP" (24/11/2026)
- [x] Remedição de degrau só quando o de baixo perdeu por menos de 30% (`MEDIR_FOLGA`); antes tomava 1/3 do tempo no nível 80
- [x] Top Catch desligado por padrão (`TOP_CATCH=0`): ia para hunts de nível 1, ~43 mil XP/h contra ~12 mi
- [x] Venda da Auto Venda (`vendidoAuto`, evento `venda`) conta como farm, não como prêmio; coluna "Vendas" no histórico; 24/11 corrigido no `stats.json`
- [x] `REGIOES=auto` e áreas das hunts no log da partida (Johto fica dentro de `kanto`, níveis 1–470; Orre começa no 500)
- [x] Sacrifício não leva espécie LEGENDARY, MYTHIC nem EPIC (`rarity` do catálogo)
- [x] Erro numa rotina vai para o `bot.log` e não derruba o bot
- [x] Repositório público: https://github.com/LucasLangley/pokeidle-bot
- [ ] Conferir no log, na próxima volta para a hunt normal, a linha "degrau medido: não meço de novo (nível 80 …)"
- [ ] Convidar o colaborador (falta o usuário do GitHub dele)
