# GuiaIA V1 - Asistente de Instalacion y Verificacion para Windows
$ErrorActionPreference = 'Stop'

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '          GUIAIA V1 - INSTALADOR Y VERIFICADOR              ' -ForegroundColor Cyan -BackgroundColor DarkBlue
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ''

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

# 1. Comprobar Node.js
Write-Host '[1/5] Verificando entorno Node.js... ' -NoNewline
try {
    $NodeVersionOutput = node --version 2>&1
    $NodeMajor = [int]($NodeVersionOutput -replace '^v(\d+)\..*', '$1')
    if ($NodeMajor -lt 22) {
        Write-Host 'ERROR' -ForegroundColor Red
        Write-Host "GuiaIA V1 requiere Node.js >= 22. Version detectada: $NodeVersionOutput" -ForegroundColor Red
        exit 1
    }
    Write-Host "OK ($NodeVersionOutput)" -ForegroundColor Green
} catch {
    Write-Host 'NO ENCONTRADO' -ForegroundColor Red
    Write-Host 'Node.js no esta instalado o no se encuentra en el PATH del sistema.' -ForegroundColor Red
    exit 1
}

# 2. Comprobar Python
Write-Host '[2/5] Verificando entorno Python... ' -NoNewline
try {
    $PythonVersionOutput = python --version 2>&1
    Write-Host "OK ($PythonVersionOutput)" -ForegroundColor Green
} catch {
    Write-Host 'AVISO: Python no encontrado (Opcional)' -ForegroundColor Yellow
}

# 3. Directorio de datos de usuario en %LOCALAPPDATA%
Write-Host '[3/5] Configurando almacenamiento protegido de usuario... ' -NoNewline
$AppDataDir = [System.IO.Path]::Combine($env:LOCALAPPDATA, 'GuiaIA')
$AuthDir = [System.IO.Path]::Combine($AppDataDir, 'auth')
$WitnessDir = [System.IO.Path]::Combine($AppDataDir, 'witness')
$LedgerDir = [System.IO.Path]::Combine($AppDataDir, 'ledger')

New-Item -ItemType Directory -Force -Path $AuthDir | Out-Null
New-Item -ItemType Directory -Force -Path $WitnessDir | Out-Null
New-Item -ItemType Directory -Force -Path $LedgerDir | Out-Null
Write-Host "OK ($AppDataDir)" -ForegroundColor Green

# 4. Instalacion de dependencias Node.js
Write-Host '[4/5] Instalando dependencias de companion (npm ci)... ' -NoNewline
Push-Location "$ScriptDir\companion"
try {
    npm ci --silent | Out-Null
    Write-Host 'OK' -ForegroundColor Green
} catch {
    Write-Host 'ERROR en npm ci' -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

# 5. Ejecucion de suite de verificacion rapida
Write-Host '[5/5] Ejecutando verificacion de integridad de contratos... ' -NoNewline
Push-Location "$ScriptDir\companion"
try {
    $TestOutput = node --test test/v1_schemas.test.js test/v1_cli.test.js 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host 'OK' -ForegroundColor Green
    } else {
        Write-Host 'ERROR' -ForegroundColor Red
        Write-Host $TestOutput
        Pop-Location
        exit 1
    }
} finally {
    Pop-Location
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host '       [OK] INSTALACION COMPLETADA EXITOSAMENTE             ' -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
Write-Host ''
Write-Host 'Para iniciar la consola interactiva:'
Write-Host '  1. Haz doble clic en iniciar.bat' -ForegroundColor Cyan
Write-Host '  2. O ejecuta: node companion/src/cli_v1.js' -ForegroundColor Cyan
Write-Host ''
