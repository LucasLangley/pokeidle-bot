# Impede o Windows de suspender enquanto o processo do bot (PID em $env:BOT_PID) existir.
# Usa SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED): a tela ainda pode apagar,
# e o pedido some sozinho quando este script termina. Não altera o plano de energia.
Add-Type -Namespace PokeIdle -Name Energia -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
$botPid = [int]$env:BOT_PID
[void][PokeIdle.Energia]::SetThreadExecutionState([uint32]'0x80000001')
while (Get-Process -Id $botPid -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 30 }
[void][PokeIdle.Energia]::SetThreadExecutionState([uint32]'0x80000000')
