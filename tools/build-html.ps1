# Builds Das-Superfoods-ERP.html — one self-contained file with React, Tailwind,
# Babel and the icon set inlined, so it runs offline with no install step.
#
# Usage:  powershell -ExecutionPolicy Bypass -File build-html.ps1
param(
  [string]$Source = "",
  [string]$Out    = "C:\Users\ADMIN\Downloads\Das-Superfoods-ERP.html"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Source) { $Source = Join-Path $here "app.jsx" }
$vendorDir = Join-Path $here "vendor"
if (-not (Test-Path $vendorDir)) { New-Item -ItemType Directory -Path $vendorDir | Out-Null }

function Get-Cached([string]$url, [string]$file) {
  $path = Join-Path $vendorDir $file
  if (-not (Test-Path $path)) {
    Write-Host "  downloading $file ..."
    Invoke-WebRequest -Uri $url -OutFile $path -UseBasicParsing -TimeoutSec 120
  }
  return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

Write-Host "Collecting vendor scripts"
$react    = Get-Cached "https://unpkg.com/react@18.3.1/umd/react.production.min.js"        "react.js"
$reactDom = Get-Cached "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js" "react-dom.js"
$babel    = Get-Cached "https://unpkg.com/@babel/standalone@7.26.4/babel.min.js"            "babel.js"
$tailwind = Get-Cached "https://cdn.tailwindcss.com/3.4.16"                                 "tailwind.js"

# --- icons: pull just the ones the app uses out of lucide-static ---------------
$iconNames = @(
  "users", "file-text", "clipboard-list", "receipt", "building-2",
  "ship", "lock", "plus", "x", "chevron-right", "check",
  "trash-2", "shield-check", "boxes", "key-round", "history",
  "download", "upload", "triangle-alert", "search", "sun", "moon"
)
# Names lucide has renamed between versions — fall back to the older spelling.
$aliases = @{ "chart-column" = "bar-chart-3"; "triangle-alert" = "alert-triangle" }

Write-Host "Collecting icons"
$icons = @{}
foreach ($name in $iconNames) {
  $svg = $null
  foreach ($candidate in @($name) + @($aliases[$name] | Where-Object { $_ })) {
    try {
      $svg = Get-Cached "https://unpkg.com/lucide-static@0.454.0/icons/$candidate.svg" "icon-$candidate.svg"
      break
    } catch { $svg = $null }
  }
  if (-not $svg) { Write-Warning "icon not found: $name"; continue }
  if ($svg -match '(?s)<svg[^>]*>(.*)</svg>') {
    $icons[$name] = ($matches[1] -replace '\s+', ' ').Trim()
  } else {
    Write-Warning "could not parse icon: $name"
  }
}
Write-Host "  $($icons.Count) of $($iconNames.Count) icons inlined"

# ConvertTo-Json escapes <, >, & as \uXXXX, which also keeps the markup from
# terminating the surrounding <script> element.
$iconsJson = $icons | ConvertTo-Json -Compress -Depth 3

$app = [System.IO.File]::ReadAllText($Source, [System.Text.Encoding]::UTF8)
if ($app -match '</script') { throw "app source contains a </script sequence and cannot be inlined" }

$template = @'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Das Superfoods — Export management console</title>
<style>
  /* Design tokens — dark is the default, .light on <html> flips the console. */
  :root {
    --bg: #141312; --panel: #1b1a18; --card: #1e1c1a; --field: #262320; --line: #333029;
    --text: #efece8; --muted: #a19a92; --faint: #6f6862;
    --accent: #ff7a45; --accent-ink: #1a0e07; --danger: #f87171;
    color-scheme: dark;
  }
  :root.light {
    --bg: #faf8f6; --panel: #f2efea; --card: #ffffff; --field: #ffffff; --line: #e3ddd5;
    --text: #1c1a18; --muted: #6b645c; --faint: #9a938a;
    --accent: #d9541f; --accent-ink: #ffffff; --danger: #b42318;
    color-scheme: light;
  }
  html, body { background: var(--bg); }
  ::selection { background: var(--accent); color: var(--accent-ink); }
  #boot { display: flex; align-items: center; justify-content: center; height: 100vh;
          font: 14px ui-sans-serif, system-ui, sans-serif; color: var(--muted); }
  #boot-error { display: none; white-space: pre-wrap; font: 13px ui-monospace, Consolas, monospace;
                color: var(--danger); background: var(--card); border: 1px solid var(--line);
                border-radius: 10px; margin: 24px; padding: 16px; }
</style>
</head>
<body>
  <div id="root"><div id="boot">Starting the export console…</div></div>
  <pre id="boot-error"></pre>

  <script>/* react */ __REACT__</script>
  <script>/* react-dom */ __REACT_DOM__</script>
  <script>/* tailwind */ __TAILWIND__</script>
  <script>/* babel */ __BABEL__</script>
  <script>window.__LUCIDE_ICONS__ = __ICONS__;</script>
  <script>
    window.addEventListener("error", function (e) {
      var el = document.getElementById("boot-error");
      if (!el) return;
      el.style.display = "block";
      el.textContent = "Something went wrong while starting the console:\n\n" + (e.error && e.error.stack ? e.error.stack : e.message);
    });
  </script>

  <!-- ============================================================
       Application source (JSX). Edit this block and reload the page —
       it is compiled in the browser, so there is no build step.
       ============================================================ -->
  <script type="text/babel" data-presets="react">
__APP__
  </script>
</body>
</html>
'@

$html = $template.
  Replace("__REACT__", $react).
  Replace("__REACT_DOM__", $reactDom).
  Replace("__TAILWIND__", $tailwind).
  Replace("__BABEL__", $babel).
  Replace("__ICONS__", $iconsJson).
  Replace("__APP__", $app)

[System.IO.File]::WriteAllText($Out, $html, (New-Object System.Text.UTF8Encoding($false)))
$size = [Math]::Round((Get-Item $Out).Length / 1MB, 2)
Write-Host "Built $Out ($size MB)"
