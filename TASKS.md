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
