#!/usr/bin/env bash
# GuiaIA V1 - Launcher para entornos Linux / macOS / Chromebook

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================================"
echo "          INICIANDO GUIAIA V1 - AGENTE MINECRAFT            "
echo "============================================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
    if [ -d "$HOME/.local/opt/node-v22.23.2/bin" ]; then
        export PATH="$HOME/.local/opt/node-v22.23.2/bin:$PATH"
    elif [ -d "$HOME/.nvm" ]; then
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    fi
fi

if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js no está instalado o no se encuentra en el PATH."
    exit 1
fi

cd "$SCRIPT_DIR/companion"
if [ ! -d "node_modules" ]; then
    echo "[AVISO] Dependencias no encontradas. Ejecutando npm ci..."
    npm ci
fi

node src/cli_v1.js "$@"
