$ErrorActionPreference='Stop'
$cameraPidPath=Join-Path $PSScriptRoot 'receiver.pid'
if(Test-Path -LiteralPath $cameraPidPath){
  $cameraID=[int](Get-Content -LiteralPath $cameraPidPath -Raw)
  $cameraProcess=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$cameraID)
  if($cameraProcess -and $cameraProcess.ExecutablePath -eq (Join-Path $PSScriptRoot 'node.exe') -and $cameraProcess.CommandLine.Contains((Join-Path $PSScriptRoot 'server.js'))){Stop-Process -Id $cameraID;Write-Output 'USB 摄像头接收已关闭。'}
}
