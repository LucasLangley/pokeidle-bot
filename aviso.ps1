# Mostra uma notificação do Windows. O texto vem por variável de ambiente
# (AVISO_TITULO, AVISO_TEXTO) para não montar comando com texto vindo do jogo.
$titulo = $env:AVISO_TITULO
$texto = $env:AVISO_TEXTO
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('<toast scenario="reminder"><visual><binding template="ToastGeneric"><text/><text/></binding></visual><audio src="ms-winsoundevent:Notification.Looping.Alarm2" loop="false"/><actions><action content="Abrir painel" activationType="protocol" arguments="http://localhost:8787"/><action content="OK" activationType="system" arguments="dismiss"/></actions></toast>')
$t = $xml.GetElementsByTagName('text')
[void]$t.Item(0).AppendChild($xml.CreateTextNode($titulo))
[void]$t.Item(1).AppendChild($xml.CreateTextNode($texto))
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
