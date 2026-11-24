# PokeIdle farm bot

Cliente WebSocket próprio que mantém a conta caçando 24 h. Node 22+ (usa o WebSocket nativo), sem dependências.

## Como funciona

A caça é simulada no servidor. O navegador só escolhe a área e liga as automações, e o bot faz o mesmo por conta própria:

| O quê | Mensagem | Quando |
|---|---|---|
| Escolher hunt | `hunt.select {slug}` | Vai para a maior hunt com `nivel <= nível do treinador`. Desce um degrau a cada `MORTES_PARA_RECUAR` desmaios em 10 min, porque morrer custa 10% do XP. |
| Automações grátis | `auto.set` | Religa revive, poção e voltar à hunt se estiverem desligados. |
| Repor estoque | `shop.buy` | A cada 60 s, se poção, revive ou bola estiver abaixo do mínimo. Gasta no máximo `GASTO_MAX_FRACAO` do ouro por compra. |
| Curar | `centro.curar` | Quando o time inteiro cai. |
| Capturar | `ball.throw {ballId, slot}` | O mesmo que o botão "caídos" da tela. Com `CAPTURAR=time` (o padrão), lança uma bola por caído enquanto o time tiver menos de 5. Em shiny, insiste até o corpo sumir. Com Poke Ball, cada captura custa em média ~1.370 de ouro, então capturar só para vender dá prejuízo. |
| Passe diário | `passe.resgatar` | Na partida e a cada 6 h. |
| Outland | `hunt.select` e `outland.tier` | Do Nv 150 ao 199 (`OUTLAND_DE`/`OUTLAND_ATE`) caça na Outland, sempre no maior tier liberado. Ela não tem shiny, mas rende mais XP (o caminho para Johto, no Nv 200) e tem drops raros (Boss Token, fragmentos). Depois de 10 min lá, se o XP/h medido for menor que o da hunt normal mais alta, volta para a normal (que tem shiny) e mede de novo 5 níveis depois. |
| Auto Venda | `shop.autoVendaDepot` | Liga a venda automática do próprio jogo: o capturado comum vai para o NPC, e shiny, lendário, mega e P4/P5 ficam guardados. |

## Estratégia (configurável no `.env`)

| O quê | Como funciona | Chave |
|---|---|---|
| Equipe e ativo | Os 5 de maior poder que podem ser usados (nível ≤ treinador + 5) entram na equipe, e o mais forte fica como ativo. Só o ativo luta. Shiny fica de fora para ser vendido. | `GERIR_EQUIPE=1` |
| Evolução | A partir do Nv 20 (`EVO_NIVEL_MIN`), tenta evoluir com a pedra do tipo. Se não tiver a pedra, compra 1 em ouro no Mercado, com teto de `PEDRA_PRECO_MAX` (300 mil) e no máximo 40% do ouro. Espécies com evolução ramificada (Eevee, Pikachu…) ficam de fora. | `EVOLUIR=1` |
| Hunt por tipo | Entre as hunts do mesmo degrau de nível, escolhe aquela em que o ativo causa mais dano e leva menos. Só troca se for 5% melhor que a atual. | `HUNT_POR_TIPO=1` |
| Hunt por valor | Entre as hunts de tipo bom (até 10% pior que a melhor), escolhe a de shiny mais caro: mediana de 14 dias do Radar por espécie, pesada pelos spawns e pela chance de captura do estágio. Espécie sem venda conta 500 Gemas. Só troca se for 10% mais valiosa. | `HUNT_VALOR=1`, `HUNT_VALOR_FOLGA=0.9`, `HUNT_VALOR_SEM_DADO=500` |
| Captura | Padrão `CAPTURAR=vip`: liga o "Lançar até Capturar" do servidor (benefício VIP), da melhor bola para a pior, e o bot não lança nada sozinho. Sem VIP, nada é lançado. `sempre`, `time` e `rajada` fazem o bot lançar por conta própria. Lançar bola automática sem VIP pode ser visto como burlar um benefício pago, então use por sua conta. O jogo aceita uma tentativa por corpo. | `CAPTURAR` |
| Melhor bola | Compra a melhor bola de ouro cujo caixa cubra ~30 min de arremessos (Great com ~13 mil, Super com ~32 mil, Ultra com ~82 mil). | — |
| Aviso de shiny | Notificação do Windows, faixa dourada no painel e `shinies.log`. | `AVISO_WINDOWS=1` |
| Aviso no celular | Manda o aviso de shiny pelo **ntfy** (app grátis, sem conta). No app, assine o canal que está em `NTFY_TOPICO`, no servidor ntfy.sh. A mensagem leva só o pokemon e o nível. O nome do canal funciona como senha: quem souber o nome lê os avisos. | `NTFY_TOPICO` |
| Guardar capturas fortes | Liga a regra de nota da Auto Coleção do jogo. Capturas com nota ≥ 3,5 ficam guardadas em vez de irem para a Auto Venda. A equipe tem só o ativo (`EQUIPE_MAX=1`), porque só ele luta. | `COLECAO_NOTA=1`, `COLECAO_NOTA_MIN=3.5`, `EQUIPE_MAX=1` |
| Sacrifício | A cada 2 min, coloca no altar as capturas guardadas com nota de 3,5 até 5 (`sacrificio.sacrificar`), deixando sempre 1 de sobra porque o jogo exige 2 pokemon na conta. Com 1.000 pontos, resgata 14 dias de +20% de XP. Shiny, P4+, inicial e nota ≥ 5 nunca vão para o altar: as de nota ≥ 5 podem valer Gemas no Mercado. | `SACRIFICIO=1`, `SACRIFICIO_NOTA_MAX=5`, `SACRIFICIO_RESGATAR_PTS=1000` |
| Top Catch | Toda semana (domingo a sábado), sai da hunt de XP e vai de hunt em hunt (sem Outland) atrás de espécies ainda não capturadas na semana (`topcatch.pedir`), escolhendo a hunt com mais spawn de espécie nova. Uma hunt sem espécie nova em 20 min fica de lado. Para ao chegar na meta, no teto de horas ou se render menos que o mínimo por hora, e volta para a hunt de XP. Os marcos pagam na hora: 100 espécies = Shiny Secret Lure 30 min; 150/200/300 = XP Boost duplo + Lure por 0,5/1/2 h; 400 = Lure 12 h. Ritmo medido em 24/11: ~12 espécies por hora. Enquanto houver XP Boost ativo, espera (não gasta boost em hunt de nível baixo). | `TOP_CATCH=1`, `TOP_CATCH_SEM_BOOST=1`, `TOP_CATCH_META=200`, `TOP_CATCH_HORAS=10`, `TOP_CATCH_MIN_POR_HORA=4` |
| Prey | Todo dia, depois das 18h de Brasília, roleta a cartela grátis (`prey.roletar`) e escolhe, entre as 9 opções, a espécie que mais aparece na hunt atual (`prey.escolher`). Os bônus contra essa espécie são dano, defesa, captura ou spawn. Não paga roleta extra. | `PREY=1` |
| PvP Ranqueado | Do Nv 150 em diante: se não houver time de PvP salvo, salva os 5 de maior nível (`pvp.time.salvar`) e liga a Fila automática do servidor (`pvpAutoFila`, VIP). A luta roda ao lado da hunt. Metade da comissão em Gemas do Mercado vai, no fim do mês, para os 2.000 primeiros do placar mensal. | `PVP=1` |
| PC acordado | Impede a suspensão enquanto o bot roda. A tela ainda pode apagar. | `MANTER_ACORDADO=1` |
| Estatísticas | `stats.json` soma tudo entre reinícios (bolas confirmadas por tipo, capturas, shiny, abates, drops). | — |
| Preço de shiny | A cada 6 h baixa o histórico público do [Radar](https://radar-pokeidle.github.io) (mediana diária por espécie) e os anúncios abertos. O preço sugerido é a mediana das vendas dos últimos 14 dias, um pouco abaixo do anúncio mais barato, sem descer de 80% da mediana. Ele já vem no aviso de shiny capturado e fica em `http://localhost:8787/preco?nome=Larvitar`. Nível, nota e potência mudam o valor: é um ponto de partida, não o preço final. | `RADAR=1` |
| Bosses | A partir do Nv 3.100 (`BOSS_NIVEL_MIN`), liga o `boss.auto` no boss mais alto liberado, guardando `TOKEN_RESERVA` (1) token para a raid. Abaixo disso o token vale mais vendido. Enquanto estiver em boss, o bot não mexe na hunt. | `BOSSES=1` |
| Raid semanal | Uma inscrição por semana (terça 12:00 a segunda 16:00, Brasília), quando houver Boss Token. Custa 1 token e dá até +20% de XP por 12 h. | `RAID=1` |
| Torneios grátis | A cada 6 h consulta o campeonato oficial (Nv 300+) e o Showdown (Nv 100+). Se a inscrição estiver aberta e o nível der, se inscreve sozinho. Pula campeonato com senha e registra no log as recusas do servidor. No Showdown, se estiver inscrito sem equipe (o que vira W.O.), monta a equipe com os 5 de maior nível que podem lutar (sem shiny, P5, lendário ou espécie da Outland). A última resposta de cada torneio fica em `torneios/` (inscritos, níveis, pódios passados). | `TORNEIOS=1` |
| Chocadeira | Se houver Mystery Egg na mochila e vaga livre na chocadeira, coloca para chocar (o melhor ovo primeiro). | `CHOCADEIRA=1` |
| Histórico diário | `historico.md` tem uma linha por dia: horas online, nível de início e fim, ouro do farm (sem prêmios), abates, desmaios, bolas, capturas, shiny e drops. Os últimos 7 dias também aparecem no painel. | — |
| Mercado | Coleta de preços só de leitura a cada 6 h, em `mercado/`. | — |

## Tarefa do Windows

A tarefa agendada **PokeIdle Bot** inicia o bot sem janela quando você entra no Windows e tenta de novo a cada 30 min. Uma cópia só roda por vez, graças à trava em `bot.pid`.

- **Abriu o jogo no navegador?** O bot é derrubado, cria o arquivo `PAUSADO` e fica 2 h sem voltar (`PAUSA_HORAS`). Para ele voltar antes, apague `PAUSADO`.
- **Token renovado pelo servidor** é salvo sozinho no `.env`.

Comandos (PowerShell):

```powershell
Start-ScheduledTask 'PokeIdle Bot'        # iniciar agora
Stop-Process -Id (Get-Content bot.pid)    # parar o bot
Disable-ScheduledTask 'PokeIdle Bot'      # desligar o agendamento
Enable-ScheduledTask 'PokeIdle Bot'       # religar o agendamento
```

## Painel ao vivo

Com o bot rodando, abra http://localhost:8787. Ele mostra nível, XP/h, ouro/h, equipe, os selvagens do campo, mochila, drops, capturas e o log em tempo real. Só aceita acesso da própria máquina.

O bot não toca em Mercado, Orbs, diamantes, venda de pokemon nem em nada que envolva dinheiro real.

## Uma conexão por conta

O servidor mantém uma sessão por conta. Abrir o jogo no navegador derruba o bot (código 4001), e o bot então **para sozinho**. Para voltar a farmar, feche a aba e rode o bot de novo.

## Configurar

1. No Chrome, com o jogo aberto e logado, abra o DevTools (F12) → Console e rode:
   ```js
   copy(`POKEIDLE_NICK=${JSON.parse(localStorage.sessao).nick}\nPOKEIDLE_TOKEN=${JSON.parse(localStorage.sessao).token}\nPOKEIDLE_DISPOSITIVO=${localStorage['id-dispositivo']}`)
   ```
   Isso copia as três linhas para a área de transferência.
2. Copie `.env.example` para `.env` e cole essas linhas no lugar das que já existem.
3. Feche a aba do jogo e rode:
   ```powershell
   node bot.mjs
   ```

Para um primeiro teste, ponha `SOMENTE_LER=1`: o bot conecta, mostra o estado e as decisões, mas não manda nenhuma ação.

O log vai para o terminal e para `bot.log`. Há um resumo por minuto com nível, XP/h, ouro/h, abates, capturas e desmaios. Use Ctrl+C para parar.

## Limites conhecidos

- A troca de token pelo servidor (`sessao.renovada`) vale só até o bot reiniciar. Se o bot começar a falhar no hello, gere o `.env` de novo.
- A dificuldade das hunts depende do seu pokemon, não só do nível. Se morrer muito, aumente `MARGEM_NIVEL` ou trave uma área com `HUNT_FIXA=slug`.
- Bolas VIP ("Lançar até Capturar") não são usadas. O bot lança uma bola por caído, como faria um jogador sem VIP.
