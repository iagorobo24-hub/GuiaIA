'use strict';

(function () {
  // 1. Token Initialization (strictly via secure pairing handshake; never from URL or plaintext HTML)
  let token = null
  try {
    token = sessionStorage.getItem('guiaia_session_token') || null
  } catch {}

  // Pairing Elements
  const pairingOverlay = document.getElementById('pairing-overlay')
  const pairingForm = document.getElementById('pairing-form')
  const pairingPinInput = document.getElementById('pairing-pin-input')
  const pairingError = document.getElementById('pairing-error')

  // State
  let botPosition = { x: 0, y: 64, z: 0 }
  let botYaw = 0
  let zoomLevel = 1.0
  let sseSource = null

  // DOM Elements
  const botNameEl = document.getElementById('bot-name')
  const healthBarEl = document.getElementById('health-bar')
  const healthTextEl = document.getElementById('health-text')
  const foodBarEl = document.getElementById('food-bar')
  const foodTextEl = document.getElementById('food-text')
  const botModeEl = document.getElementById('bot-mode')
  const sseStatusEl = document.getElementById('sse-status')
  const coordsTextEl = document.getElementById('coords-text')
  const inventoryGridEl = document.getElementById('inventory-grid')
  const invSlotsCountEl = document.getElementById('inv-slots-count')
  const unauthorizedAlertEl = document.getElementById('unauthorized-alert')
  const p0Btn = document.getElementById('p0-stop-button')
  const localHaltDot = document.getElementById('local-halt-indicator')
  const localHaltText = document.getElementById('local-halt-text')
  const remoteHaltDot = document.getElementById('remote-halt-indicator')
  const remoteHaltText = document.getElementById('remote-halt-text')
  const lastStopReasonEl = document.getElementById('last-stop-reason')
  const telemetryLogEl = document.getElementById('telemetry-log')
  const commandForm = document.getElementById('command-form')
  const commandInput = document.getElementById('command-input')
  const zoomInBtn = document.getElementById('zoom-in-btn')
  const zoomOutBtn = document.getElementById('zoom-out-btn')
  const zoomLevelText = document.getElementById('zoom-level')
  const clearLogsBtn = document.getElementById('clear-logs-btn')
  const canvas = document.getElementById('minimap-canvas')
  const ctx = canvas.getContext('2d')

  // Log helper
  function addLog(message, type = 'info') {
    const entry = document.createElement('div')
    entry.className = `log-entry ${type}`
    const time = new Date().toLocaleTimeString()
    entry.textContent = `[${time}] ${message}`
    telemetryLogEl.appendChild(entry)
    telemetryLogEl.scrollTop = telemetryLogEl.scrollHeight
  }

  // 2. Render 36 Inventory Slots
  function renderInventory(items = {}, unauthorized = false) {
    inventoryGridEl.innerHTML = ''
    const entries = Object.entries(items)
    const totalOccupied = entries.length
    invSlotsCountEl.textContent = `${totalOccupied} / 36 slots`

    if (unauthorized) {
      unauthorizedAlertEl.style.display = 'block'
    } else {
      unauthorizedAlertEl.style.display = 'none'
    }

    for (let i = 0; i < 36; i++) {
      const slot = document.createElement('div')
      slot.className = 'inv-slot'
      if (i < entries.length) {
        const [itemName, count] = entries[i]
        slot.classList.add('occupied')
        const nameSpan = document.createElement('span')
        nameSpan.className = 'inv-slot-name'
        nameSpan.textContent = itemName
        nameSpan.title = itemName

        const countSpan = document.createElement('span')
        countSpan.className = 'inv-slot-count'
        countSpan.textContent = count

        slot.appendChild(nameSpan)
        slot.appendChild(countSpan)
      }
      inventoryGridEl.appendChild(slot)
    }
  }

  // 3. Minimap Canvas 2D
  function drawMinimap() {
    const width = canvas.width
    const height = canvas.height
    const cx = width / 2
    const cy = height / 2

    // Background
    ctx.fillStyle = '#060a0f'
    ctx.fillRect(0, 0, width, height)

    // Grid lines
    const gridSize = 20 * zoomLevel
    ctx.strokeStyle = '#162230'
    ctx.lineWidth = 1

    const offsetX = (botPosition.x * zoomLevel) % gridSize
    const offsetZ = (botPosition.z * zoomLevel) % gridSize

    for (let x = -offsetX; x < width; x += gridSize) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }
    for (let y = -offsetZ; y < height; y += gridSize) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    // Compass indicators
    ctx.fillStyle = '#485868'
    ctx.font = '10px monospace'
    ctx.fillText('N (-Z)', cx - 18, 16)
    ctx.fillText('S (+Z)', cx - 18, height - 6)
    ctx.fillText('W (-X)', 6, cy + 4)
    ctx.fillText('E (+X)', width - 42, cy + 4)

    // Range rings
    ctx.strokeStyle = '#223447'
    ctx.lineWidth = 1
    const radii = [16 * zoomLevel, 32 * zoomLevel, 64 * zoomLevel]
    for (const r of radii) {
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()
    }

    // Draw Bot (Center)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(botYaw)

    // Bot icon (Triangle facing forward)
    ctx.fillStyle = '#58a6ff'
    ctx.beginPath()
    ctx.moveTo(0, -12)
    ctx.lineTo(8, 8)
    ctx.lineTo(0, 4)
    ctx.lineTo(-8, 8)
    ctx.closePath()
    ctx.fill()

    ctx.restore()

    // Bot Label
    ctx.fillStyle = '#f0f6fc'
    ctx.font = 'bold 11px sans-serif'
    ctx.fillText('GuiaIA', cx - 20, cy + 22)
  }

  // 4. Update HUD
  function updateHud(event) {
    if (event.bot_name) botNameEl.textContent = event.bot_name

    if (event.status) {
      const { health = 20, food = 20, mode = 'idle', last_reason = '', position } = event.status
      const healthPct = Math.max(0, Math.min(100, (health / 20) * 100))
      healthBarEl.style.width = `${healthPct}%`
      healthTextEl.textContent = `${health}/20`

      const foodPct = Math.max(0, Math.min(100, (food / 20) * 100))
      foodBarEl.style.width = `${foodPct}%`
      foodTextEl.textContent = `${food}/20`

      botModeEl.textContent = mode
      botModeEl.className = `badge badge-${mode === 'idle' ? 'idle' : (mode === 'following' ? 'following' : 'busy')}`

      if (position) {
        botPosition = position
        coordsTextEl.textContent = `X: ${position.x.toFixed(1)}, Y: ${position.y.toFixed(1)}, Z: ${position.z.toFixed(1)}`
        drawMinimap()
      }

      if (last_reason) {
        lastStopReasonEl.textContent = `Motivo: ${last_reason}`
      }
    }

    if (event.inventory !== undefined) {
      renderInventory(event.inventory, event.has_unauthorized_items)
    }
  }

  // 5. Connect SSE Stream (using fetch + Authorization header; zero URL query tokens)
  async function connectSse() {
    if (!token) {
      addLog('No se encontró Bearer token de autenticación. Las llamadas API fallarán.', 'error')
      sseStatusEl.textContent = 'sin token'
      sseStatusEl.className = 'badge badge-busy'
      return
    }

    sseStatusEl.textContent = 'conectando...'
    sseStatusEl.className = 'badge badge-connecting'

    try {
      const response = await fetch('/api/events', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      sseStatusEl.textContent = 'en línea'
      sseStatusEl.className = 'badge badge-connected'
      addLog('Canal de telemetría SSE establecido exitosamente con cabecera Authorization.', 'success')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop()

        for (const part of parts) {
          const lines = part.split('\n')
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                if (data.event_type === 'p0_stop') {
                  localHaltDot.className = 'dot dot-red'
                  localHaltText.textContent = 'DETENIDO'
                  remoteHaltDot.className = 'dot dot-red'
                  remoteHaltText.textContent = 'PARADA P0 ACTIVA'
                  addLog(`[P0] Parada de emergencia confirmada en el servidor: ${data.status?.last_reason || ''}`, 'error')
                }
                updateHud(data)
              } catch (err) {
                console.error('Error parseando evento SSE:', err)
              }
            }
          }
        }
      }
    } catch (err) {
      sseStatusEl.textContent = 'desconectado'
      sseStatusEl.className = 'badge badge-busy'
      addLog(`Canal SSE desconectado (${err.message}). Reintentando...`, 'warn')
      setTimeout(connectSse, 3000)
    }
  }

  // 6. P0 Emergency Stop Button
  p0Btn.addEventListener('click', async () => {
    // 1. Immediate local halt indication (no waiting for network)
    localHaltDot.className = 'dot dot-red'
    localHaltText.textContent = 'DETENIDO (LOCAL)'
    remoteHaltDot.className = 'dot dot-green'
    remoteHaltText.textContent = 'ENVIANDO P0...'
    addLog('🛑 [P0 LOCAL] Disparador local activado. Transmitiendo parada de emergencia...', 'warn')

    try {
      const res = await fetch('/api/emergency-stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ reason: 'web_dashboard_p0_click' })
      })

      const data = await res.json()
      if (res.ok && data.ok) {
        if (data.remoteConfirmed === true) {
          remoteHaltDot.className = 'dot dot-red'
          remoteHaltText.textContent = 'CONFIRMADO REMOTO'
          addLog(`🛑 [P0] Parada confirmada por testigo remoto (${data.reason}).`, 'error')
        } else {
          remoteHaltDot.className = 'dot dot-yellow'
          remoteHaltText.textContent = 'PARADA LOCAL (SIN TESTIGO REMOTO)'
          addLog(`🛑 [P0] Parada ejecutada localmente en el bot (${data.reason}). Sin testigo remoto activo.`, 'warn')
        }
        lastStopReasonEl.textContent = `Motivo: ${data.reason}`
      } else {
        remoteHaltText.textContent = 'ERROR EN TRANSMISIÓN'
        addLog(`⚠️ Fallo confirmando P0 en el servidor: ${data.error || 'Respuesta inválida'}`, 'error')
      }
    } catch (err) {
      remoteHaltText.textContent = 'DESCONECTADO'
      addLog(`❌ Error de red transmitiendo P0: ${err.message}`, 'error')
    }
  })

  // 7. Dispatch Action Form
  commandForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    const input = commandInput.value.trim()
    if (!input) return

    addLog(`> Enviando: "${input}"...`, 'info')
    commandInput.value = ''

    try {
      const res = await fetch('/api/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ instruction: input })
      })

      const data = await res.json()
      if (res.ok && data.ok) {
        addLog(`✔ Acción aceptada: ${JSON.stringify(data.result)}`, 'success')
      } else {
        addLog(`✖ Rechazada: ${data.error || 'Error desconocido'}`, 'error')
      }
    } catch (err) {
      addLog(`❌ Error despachando acción: ${err.message}`, 'error')
    }
  })

  // Quick Command buttons
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      commandInput.value = btn.dataset.cmd
      commandForm.dispatchEvent(new Event('submit'))
    })
  })

  // Zoom controls
  zoomInBtn.addEventListener('click', () => {
    zoomLevel = Math.min(3.0, zoomLevel + 0.25)
    zoomLevelText.textContent = `${zoomLevel.toFixed(2)}x`
    drawMinimap()
  })

  zoomOutBtn.addEventListener('click', () => {
    zoomLevel = Math.max(0.25, zoomLevel - 0.25)
    zoomLevelText.textContent = `${zoomLevel.toFixed(2)}x`
    drawMinimap()
  })

  clearLogsBtn.addEventListener('click', () => {
    telemetryLogEl.innerHTML = ''
    addLog('Registro de telemetría limpiado por el operador.', 'info')
  })

  // 8. Pairing Form Submission (Secure Session Bootstrap)
  if (pairingForm) {
    pairingForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      const pin = pairingPinInput.value.trim()
      if (!pin) return

      if (pairingError) pairingError.style.display = 'none'

      try {
        const res = await fetch('/api/session/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin })
        })

        const data = await res.json()
        if (res.ok && data.ok && data.token) {
          token = data.token
          try { sessionStorage.setItem('guiaia_session_token', token) } catch {}
          if (pairingOverlay) pairingOverlay.style.display = 'none'
          addLog('✔ Emparejamiento seguro completado exitosamente con la consola.', 'success')
          connectSse()
        } else {
          if (pairingError) {
            pairingError.textContent = data.error || 'PIN incorrecto o ya utilizado'
            pairingError.style.display = 'block'
          }
          addLog(`❌ Fallo en emparejamiento: ${data.error || 'PIN inválido'}`, 'error')
        }
      } catch (err) {
        if (pairingError) {
          pairingError.textContent = 'Error de conexión: ' + err.message
          pairingError.style.display = 'block'
        }
      }
    })
  }

  // Initial setup
  renderInventory({}, false)
  drawMinimap()
  if (token) {
    if (pairingOverlay) pairingOverlay.style.display = 'none'
    connectSse()
  } else {
    if (pairingOverlay) pairingOverlay.style.display = 'flex'
    addLog('Esperando emparejamiento con el PIN de la consola...', 'warn')
  }
})()
