' Inicia o PokeIdle bot sem janela, a partir da pasta onde este arquivo está.
' Usado pela tarefa agendada "PokeIdle Bot" (instalar-tarefa.ps1). Precisa do Node no PATH.
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = pasta
sh.Run "node """ & pasta & "\bot.mjs""", 0, False
