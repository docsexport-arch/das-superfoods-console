# Minimal static file server (no node/python required).
# Usage:  powershell -ExecutionPolicy Bypass -File server.ps1 [-Port 5173]
param(
  [int]$Port = 5173,
  [string]$Root = $(Split-Path -Parent $MyInvocation.MyCommand.Path)
)

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".jsx"  = "text/plain; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".ico"  = "image/x-icon"
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
Write-Host "Serving $Root at http://localhost:$Port/  (Ctrl+C to stop)"

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII)

    $requestLine = $reader.ReadLine()
    if (-not $requestLine) { $client.Close(); continue }
    while ($true) { $h = $reader.ReadLine(); if ($null -eq $h -or $h -eq "") { break } }

    $parts = $requestLine.Split(" ")
    $method = $parts[0]
    $path = [System.Uri]::UnescapeDataString($parts[1].Split("?")[0])
    if ($path -eq "/") { $path = "/index.html" }

    $full = Join-Path $Root ($path.TrimStart("/") -replace "/", "\")
    $rootFull = (Resolve-Path $Root).Path

    $status = "200 OK"
    $body = $null
    $type = "application/octet-stream"

    if ((Test-Path -LiteralPath $full -PathType Leaf) -and ((Resolve-Path -LiteralPath $full).Path).StartsWith($rootFull)) {
      $body = [System.IO.File]::ReadAllBytes($full)
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      if ($mime.ContainsKey($ext)) { $type = $mime[$ext] }
    } else {
      $status = "404 Not Found"
      $type = "text/plain; charset=utf-8"
      $body = [System.Text.Encoding]::UTF8.GetBytes("404 - $path")
    }

    Write-Host "$method $path -> $status"

    if ($method -eq "HEAD") { $bodyOut = @() } else { $bodyOut = $body }
    $header = "HTTP/1.1 $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($bodyOut.Length -gt 0) { $stream.Write($bodyOut, 0, $bodyOut.Length) }
    $stream.Flush()
  } catch {
    Write-Host "error: $($_.Exception.Message)"
  } finally {
    $client.Close()
  }
}
