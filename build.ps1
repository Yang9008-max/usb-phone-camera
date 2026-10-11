param([string]$NodeExe='')
$ErrorActionPreference='Stop'
if(-not $NodeExe){$NodeExe=(Get-Command node.exe).Source}
$cameraNodeVersion=(& $NodeExe --version).Trim()
if($cameraNodeVersion -ne 'v24.18.0'){throw '本发布包使用 Node.js 24.18.0，请通过 -NodeExe 指定对应可执行文件。'}
$cameraArtifacts=Join-Path $PSScriptRoot 'artifacts'
$cameraStage=Join-Path $cameraArtifacts 'stage'
New-Item -ItemType Directory -Path $cameraStage -Force | Out-Null
$cameraNames=@('server.js','mjpeg.js','index.html','camera.html','webcam.html','启动.ps1','关闭.ps1','启动USB摄像头.cmd','关闭USB摄像头.cmd','使用说明.txt')
foreach($cameraName in $cameraNames){
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('app\'+$cameraName)) -Destination (Join-Path $cameraStage $cameraName) -Force
}
Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $cameraStage 'node.exe') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'third-party\NODE-LICENSE.txt') -Destination (Join-Path $cameraStage 'NODE-LICENSE.txt') -Force
$cameraZip=Join-Path $cameraArtifacts 'usb-phone-camera-windows-x64.zip'
$cameraFiles=@($cameraNames + @('node.exe','NODE-LICENSE.txt') | ForEach-Object {Join-Path $cameraStage $_})
Compress-Archive -LiteralPath $cameraFiles -DestinationPath $cameraZip -CompressionLevel Optimal -Force
Write-Output $cameraZip
