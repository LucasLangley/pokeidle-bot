# Registra a tarefa do Windows "PokeIdle Bot": inicia o bot sem janela no logon
# e tenta de novo a cada 30 min (uma cópia só roda por vez, pela trava bot.pid).
# Rodar uma vez, no PowerShell, de dentro desta pasta:  .\instalar-tarefa.ps1
# Para remover:  Unregister-ScheduledTask 'PokeIdle Bot' -Confirm:$false
$pasta = $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'Node.js não encontrado. Instale o Node 22 ou mais novo (nodejs.org) e rode de novo.'; exit 1 }
if (-not (Test-Path "$pasta\.env")) { Write-Host 'Falta o arquivo .env (copie .env.example para .env e preencha nick e token; veja o LEIA-ME).'; exit 1 }
$u = "$env:USERDOMAIN\$env:USERNAME"
$acao = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$pasta\iniciar-oculto.vbs`"" -WorkingDirectory $pasta
$logon = New-ScheduledTaskTrigger -AtLogOn -User $u
$repete = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 30)
$cfg = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$quem = New-ScheduledTaskPrincipal -UserId $u -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'PokeIdle Bot' -Description "Farm do PokeIdle ($pasta). Painel: http://localhost:8787" -Action $acao -Trigger @($logon, $repete) -Settings $cfg -Principal $quem -Force | Out-Null
Start-ScheduledTask -TaskName 'PokeIdle Bot'
Write-Host 'Tarefa "PokeIdle Bot" registrada e iniciada. Painel: http://localhost:8787'
