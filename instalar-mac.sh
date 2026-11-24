#!/bin/bash
# Registra o bot no macOS (launchd): inicia sozinho quando você entra no Mac e tenta de novo a cada 30 min
# (uma cópia só roda por vez, pela trava bot.pid). É o equivalente do instalar-tarefa.ps1 do Windows.
# Rodar uma vez, no Terminal, de dentro desta pasta:   bash instalar-mac.sh
# Para remover:   bash instalar-mac.sh remover
set -e
PASTA="$(cd "$(dirname "$0")" && pwd)"
ROTULO="io.pokeidle.bot"
PLIST="$HOME/Library/LaunchAgents/$ROTULO.plist"
DOMINIO="gui/$(id -u)"

if [ "$1" = "remover" ]; then
  launchctl bootout "$DOMINIO/$ROTULO" 2>/dev/null || true
  rm -f "$PLIST"
  [ -f "$PASTA/bot.pid" ] && kill "$(cat "$PASTA/bot.pid")" 2>/dev/null || true
  echo "Agente removido e bot parado."
  exit 0
fi

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then echo "Node.js não encontrado. Instale o Node 22 ou mais novo (nodejs.org ou: brew install node) e rode de novo."; exit 1; fi
VERSAO="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if [ "$VERSAO" -lt 22 ]; then echo "Seu Node é o $VERSAO. O bot precisa do 22 ou mais novo (nodejs.org)."; exit 1; fi
if [ ! -f "$PASTA/.env" ]; then echo "Falta o arquivo .env (copie .env.example para .env e preencha nick e token; veja o LEIA-ME)."; exit 1; fi

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ROTULO</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$PASTA/bot.mjs</string></array>
  <key>WorkingDirectory</key><string>$PASTA</string>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>1800</integer>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>/dev/null</string>
</dict>
</plist>
PLIST

launchctl bootout "$DOMINIO/$ROTULO" 2>/dev/null || true
launchctl bootstrap "$DOMINIO" "$PLIST"
launchctl kickstart -k "$DOMINIO/$ROTULO"
echo "Bot registrado e iniciado. Painel: http://localhost:8787  ·  log: $PASTA/bot.log"
