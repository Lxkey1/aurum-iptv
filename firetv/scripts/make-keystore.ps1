# Creates the local sideload signing key. It is intentionally gitignored — a
# private key does not belong in a public repository.
#
#   powershell -ExecutionPolicy Bypass -File scripts\make-keystore.ps1
#
# Override the defaults with AURUM_KEYSTORE_PASSWORD / AURUM_KEY_ALIAS /
# AURUM_KEY_PASSWORD before running a release build.

$ErrorActionPreference = "Stop"

$keytool = Join-Path $env:JAVA_HOME "bin\keytool.exe"
if (-not (Test-Path $keytool)) {
    $keytool = "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe"
}
if (-not (Test-Path $keytool)) {
    throw "keytool not found. Set JAVA_HOME, or install Android Studio."
}

$target = Join-Path $PSScriptRoot "..\app\aurum-sideload.jks"
if (Test-Path $target) {
    Write-Host "Keystore already exists at $target — nothing to do."
    exit 0
}

$storePass = if ($env:AURUM_KEYSTORE_PASSWORD) { $env:AURUM_KEYSTORE_PASSWORD } else { "aurumtv" }
$keyPass = if ($env:AURUM_KEY_PASSWORD) { $env:AURUM_KEY_PASSWORD } else { "aurumtv" }
$alias = if ($env:AURUM_KEY_ALIAS) { $env:AURUM_KEY_ALIAS } else { "aurum" }

& $keytool -genkeypair -v `
    -keystore $target `
    -storetype JKS `
    -storepass $storePass `
    -keypass $keyPass `
    -alias $alias `
    -keyalg RSA -keysize 2048 -validity 10950 `
    -dname "CN=Aurum TV, OU=Sideload, O=Aurum, C=GB"

Write-Host ""
Write-Host "Created $target"
Write-Host "Keep this file. Re-signing with a different key means uninstalling the app before you can update it."
