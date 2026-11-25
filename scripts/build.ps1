param([string]$OutputPath, [switch]$UpdateFeed, [switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $VerifyOnly) {
    Push-Location $projectRoot
    try {
        & npm run build:bundle
        if ($LASTEXITCODE -ne 0) { throw 'Type check or bundle failed' }
    } finally { Pop-Location }
}
$manifest = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'manifest.json') | ConvertFrom-Json
if (-not $OutputPath) { $OutputPath = Join-Path $projectRoot ('dist\Zotero-BridgeFlow-' + $manifest.version + '.xpi') }
$runtimeFiles = @(
    'manifest.json',
    'bootstrap.js',
    'prefs.js',
    'prefs.xhtml',
    'settings.css',
    'zoterobridgeflow.js',
    'zoterobridgeflow_prefs.js',
    'LICENSE'
)
$entries = @($runtimeFiles | ForEach-Object {
    [PSCustomObject]@{ Source = Join-Path $projectRoot $_; Name = $_ }
})
foreach ($dir in @('assets', 'locale', 'csl')) {
    $fullDir = Join-Path $projectRoot $dir
    if (Test-Path -LiteralPath $fullDir -PathType Container) {
        $entries += @(Get-ChildItem -LiteralPath $fullDir -Recurse -File | Sort-Object FullName | ForEach-Object {
            [PSCustomObject]@{ Source = $_.FullName; Name = [IO.Path]::GetRelativePath($projectRoot, $_.FullName).Replace('\','/') }
        })
    }
}
foreach ($entry in $entries) { if (-not (Test-Path -LiteralPath $entry.Source -PathType Leaf)) { throw "Missing runtime file: $($entry.Name)" } }
$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
if (-not $VerifyOnly) {
    $distDir = Split-Path -Parent $resolvedOutput
    New-Item -ItemType Directory -Path $distDir -Force | Out-Null
    Add-Type -AssemblyName System.IO.Compression
    $temporaryOutput = Join-Path $distDir ([IO.Path]::GetRandomFileName())
    try {
        $stream = [IO.File]::Open($temporaryOutput, [IO.FileMode]::CreateNew)
        $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($entry in $entries) {
                $zipEntry = $archive.CreateEntry($entry.Name, [IO.Compression.CompressionLevel]::Optimal)
                $zipEntry.LastWriteTime = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
                $inputStream = [IO.File]::OpenRead($entry.Source)
                $outputStream = $zipEntry.Open()
                try { $inputStream.CopyTo($outputStream) } finally { $inputStream.Dispose(); $outputStream.Dispose() }
            }
        } finally { $archive.Dispose(); $stream.Dispose() }
        [IO.File]::Move($temporaryOutput, $resolvedOutput, $true)
    } finally {
        if ([IO.File]::Exists($temporaryOutput)) { [IO.File]::Delete($temporaryOutput) }
    }
}
$hash = (Get-FileHash -LiteralPath $resolvedOutput -Algorithm SHA256).Hash
$hash512 = (Get-FileHash -LiteralPath $resolvedOutput -Algorithm SHA512).Hash
if ($VerifyOnly) {
    if ($UpdateFeed) { throw 'VerifyOnly cannot be combined with UpdateFeed' }
    $feed = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'update.json') | ConvertFrom-Json
    $entry = $feed.addons.($manifest.applications.zotero.id).updates[0]
    if ($entry.version -ne $manifest.version -or $entry.update_hash -ne ('sha512:' + $hash512)) {
        throw 'Installer version or checksum differs from the maintained feed'
    }
}
if ($UpdateFeed) {
    $feedPath = Join-Path $projectRoot 'update.json'
    $feed = Get-Content -LiteralPath $feedPath -Raw | ConvertFrom-Json
    $update = $feed.addons.($manifest.applications.zotero.id).updates[0]
    if ($update.version -ne $manifest.version) { throw 'Update feed version does not match manifest' }
    $update | Add-Member -NotePropertyName update_hash -NotePropertyValue ('sha512:' + $hash512.ToLowerInvariant()) -Force
    $feedText = ($feed | ConvertTo-Json -Depth 12).Replace("`r`n", "`n") + "`n"
    [IO.File]::WriteAllText($feedPath, $feedText, [Text.UTF8Encoding]::new($false))
}
[PSCustomObject]@{ Path = $resolvedOutput; Bytes = (Get-Item -LiteralPath $resolvedOutput).Length; SHA512 = $hash512; SHA256 = $hash; RuntimeFiles = $entries.Count } | Format-List
