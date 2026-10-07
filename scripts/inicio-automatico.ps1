# Liga ou desliga o inicio automatico do minerador no Windows.
#
#   powershell -ExecutionPolicy Bypass -File scripts\inicio-automatico.ps1            (liga e inicia agora)
#   powershell -ExecutionPolicy Bypass -File scripts\inicio-automatico.ps1 -Remover   (desliga)
#
# Cria uma tarefa no Agendador de Tarefas, so para o usuario atual, que abre o
# minerador sem janela quando a sessao comeca. O Client Secret nao entra na
# tarefa: o minerador le a variavel de ambiente MELI_CLIENT_SECRET do usuario.

param([switch]$Remover)

$ErrorActionPreference = 'Stop'
$nome = 'Conecta Hub Sourcing - Minerador'

if ($Remover) {
  Stop-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $nome -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output 'Inicio automatico removido.'
  exit 0
}

$raiz = Split-Path -Parent $PSScriptRoot
$script = Join-Path $raiz 'minerador.js'
$node = (Get-Command node -ErrorAction Stop).Source

if (-not [Environment]::GetEnvironmentVariable('MELI_CLIENT_SECRET', 'User')) {
  Write-Warning 'A variavel de ambiente MELI_CLIENT_SECRET nao existe para este usuario. O minerador vai abrir, mas nao vai minerar.'
}

$comando = "& '$node' '$script'"
$acao = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"$comando`"" -WorkingDirectory $raiz
$gatilho = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$opcoes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -Settings $opcoes -Force | Out-Null
Start-ScheduledTask -TaskName $nome
Write-Output 'Inicio automatico ligado. Central: http://127.0.0.1:4310'
