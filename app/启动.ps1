$ErrorActionPreference='Stop'
$cameraRoot=$PSScriptRoot
$cameraURL='http://127.0.0.1:9890/'
$cameraAdapters=Get-NetAdapter | Where-Object {$_.Status -eq 'Up' -and $_.InterfaceDescription -match 'RNDIS|Remote NDIS|Internet Sharing|USB.*Ethernet|USB.*NCM|NCM.*USB'}
$cameraPhoneIP=$null
foreach($cameraAdapter in $cameraAdapters){
  $cameraConfig=Get-NetIPConfiguration -InterfaceIndex $cameraAdapter.ifIndex
  if($cameraConfig.IPv4DefaultGateway.NextHop){$cameraPhoneIP=$cameraConfig.IPv4DefaultGateway.NextHop;break}
}
if(-not $cameraPhoneIP){throw '未检测到本机的手机 USB 网络共享。请把手机接到这台电脑，在手机设置开启 USB 网络共享，再打开摄像头 App 后重新启动。'}
$cameraPhoneURL='http://'+$cameraPhoneIP+':4444'
$cameraRunning=$false
try{
  $cameraStatus=Invoke-RestMethod -Uri ($cameraURL+'api/status') -TimeoutSec 2
  if($cameraStatus.app -ne 'usb-local'){throw '9890 端口被其他接收程序占用。若之前运行了局域网接收端，请先双击旧包中的关闭本地预览.cmd。'}
  if($cameraStatus.version -ne '0.2.1'){throw '检测到旧版 USB 接收服务。请先双击旧包中的关闭USB摄像头.cmd，再从新包启动，才能使用新版 AI 分析功能。'}
  $cameraRunning=$true
}catch{
  if($_.Exception.Message -match '9890 端口|检测到旧版'){throw}
}
if(-not $cameraRunning){
  $cameraProcess=Start-Process -FilePath (Join-Path $cameraRoot 'node.exe') -ArgumentList @(('"'+(Join-Path $cameraRoot 'server.js')+'"'),'--phone',$cameraPhoneURL) -WorkingDirectory $cameraRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $cameraRoot 'receiver.log') -RedirectStandardError (Join-Path $cameraRoot 'receiver-error.log')
  $cameraProcess.Id | Set-Content -LiteralPath (Join-Path $cameraRoot 'receiver.pid')
  $cameraDeadline=(Get-Date).AddSeconds(8)
  while((Get-Date) -lt $cameraDeadline){
    try{$cameraStatus=Invoke-RestMethod -Uri ($cameraURL+'api/status') -TimeoutSec 1;$cameraRunning=$cameraStatus.app -eq 'usb-local';if($cameraRunning){break}}catch{}
    Start-Sleep -Milliseconds 200
  }
  if(-not $cameraRunning){throw '本地服务启动失败，请查看 receiver-error.log。'}
}else{
  Invoke-RestMethod -Uri ($cameraURL+'api/connect') -Method Post -ContentType 'application/json' -Body (@{url=$cameraPhoneURL}|ConvertTo-Json) | Out-Null
}
Start-Process $cameraURL
Write-Output ('本机手机地址：'+$cameraPhoneURL)
Write-Output '本机 USB 预览已启动，手机与这台电脑保持连接即可。'
