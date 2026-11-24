# PokeIdle bot: como instalar

Bot que mantém a sua conta do PokeIdle caçando 24 h. Ele também troca de hunt conforme o nível, repõe poção, revive e bola, cura, evolui, resgata o passe diário e avisa quando aparece shiny. A partir do Nv 150, entra sozinho na fila de PvP Ranqueado (precisa de VIP). Todo dia pega o Prey grátis, põe no altar do Sacrifício as capturas fracas e faz a rota semanal do Top Catch. Os detalhes estão no [README.md](README.md), e o [DISCORD.md](DISCORD.md) resume o que o Discord do jogo tem de útil.

A automação é permitida pelos Termos do jogo. As regras que importam:
- **Até 4 contas por pessoa e por rede.** Passar disso bane todas e trava os saques.
- **Nada de VPN, VPS ou proxy.** Desde 22/11 isso está nos Termos e já deu ban. Rode o bot no seu PC de casa, nunca num servidor na nuvem.
- **Uma conexão por conta.** Abrir o jogo no navegador derruba o bot, e ele pausa sozinho por 2 h para não te derrubar enquanto você joga.

## 1. Instalar o Node.js

Baixe a versão LTS em https://nodejs.org (precisa ser a 22 ou mais nova) e instale com as opções padrão.

## 2. Pegar o seu nick e token

1. No Chrome, abra o jogo e faça login.
2. Aperte F12, vá na aba **Console** e cole a linha abaixo. Se o Chrome pedir, digite `allow pasting` antes.
   ```js
   copy(`POKEIDLE_NICK=${JSON.parse(localStorage.sessao).nick}\nPOKEIDLE_TOKEN=${JSON.parse(localStorage.sessao).token}\nPOKEIDLE_DISPOSITIVO=${localStorage['id-dispositivo']}`)
   ```
   Isso copia três linhas para a área de transferência.
3. Nesta pasta, copie `.env.example` para `.env`. Abra o `.env` no Bloco de Notas e troque as três primeiras linhas `POKEIDLE_…` pelo que você copiou.

O token é a sua sessão: **não mande o `.env` para ninguém.**

## 3. Testar

Feche a aba do jogo. Abra o PowerShell nesta pasta (Shift + botão direito na pasta → "Abrir janela do PowerShell aqui") e rode:

```powershell
node bot.mjs
```

Deve aparecer "conectado", depois "welcome" e a hunt escolhida. Abra http://localhost:8787 para ver o painel. Use Ctrl+C para parar.

## 4. Deixar rodando sozinho

No mesmo PowerShell, nesta pasta:

```powershell
powershell -ExecutionPolicy Bypass -File .\instalar-tarefa.ps1
```

O bot passa a iniciar escondido quando você entra no Windows e volta sozinho se cair. Comandos úteis:

```powershell
Stop-Process -Id (Get-Content bot.pid)                      # parar agora
Start-ScheduledTask 'PokeIdle Bot'                          # iniciar agora
Unregister-ScheduledTask 'PokeIdle Bot' -Confirm:$false     # remover a tarefa
```

## 5. Aviso de shiny no celular (opcional)

1. Instale o app **ntfy** (grátis, sem conta).
2. Invente um nome difícil de adivinhar, como `pkidle-7f3a9c2e81d4`, e assine esse canal no app.
3. Ponha o mesmo nome em `NTFY_TOPICO=` no `.env`.

Quem souber o nome do canal lê os avisos, por isso ele deve ser aleatório.

## Arquivos que o bot cria aqui

| Arquivo | O que é | Pode compartilhar? |
|---|---|---|
| `.env` | nick e token | **Nunca** |
| `bot.log` | log | Não (tem o seu nick) |
| `stats.json`, `historico.md` | números acumulados e resumo diário | Não |
| `shinies.log` | shiny encontrados | Não |
| `mercado/` | preços do Mercado coletados | Não |
| `torneios/` | últimas respostas dos torneios e do PvP | Não (tem o seu nick) |
