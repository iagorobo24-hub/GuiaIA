'use strict'

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const PUBLIC_DIR = path.join(__dirname, 'public')

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
})

const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:;",
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store'
})

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

function createRateLimiter(limitPerSec = 20) {
  const clients = new Map()
  return function check(ip) {
    const now = Date.now()
    const record = clients.get(ip)
    if (!record || now >= record.resetAt) {
      clients.set(ip, { count: 1, resetAt: now + 1000 })
      return true
    }
    if (record.count >= limitPerSec) {
      return false
    }
    record.count += 1
    return true
  }
}

/**
 * Creates and starts the local GuiaIA Web Dashboard server.
 *
 * @param {Object} options
 * @param {number} [options.port=8080] Port to bind (0 for automatic ephemeral port in tests)
 * @param {string} [options.host='127.0.0.1'] Host to bind (strictly 127.0.0.1)
 * @param {string} [options.token] Optional pre-set bearer token
 * @param {Object} options.controller SecureCompanionController instance
 * @param {Object} [options.bot] Mineflayer bot instance
 * @param {Object} [options.authority] Security authority
 * @returns {Object} Dashboard server handle with .close(), .broadcast(), .token, .port
 */
function createWebDashboardServer(options = {}) {
  const port = options.port !== undefined ? options.port : 8080
  const host = options.host || '127.0.0.1'
  const token = options.token || crypto.randomBytes(32).toString('hex')
  const controller = options.controller
  const bot = options.bot
  const rateLimiter = createRateLimiter(30)

  const sseClients = new Set()
  let heartbeatTimer = null
  let telemetryTimer = null

  function applySecurityHeaders(res) {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(key, value)
    }
  }

  function sendJson(res, statusCode, data) {
    applySecurityHeaders(res)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.writeHead(statusCode)
    res.end(JSON.stringify(data))
  }

  function sendError(res, statusCode, message) {
    sendJson(res, statusCode, { ok: false, error: message })
  }

  function validateHost(req) {
    const hostHeader = req.headers.host
    if (!hostHeader) return false
    // Strict loopback check: 127.0.0.1[:port] or localhost[:port]
    return /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(hostHeader)
  }

  function validateCsrf(req) {
    // For non-safe methods (POST, PUT, DELETE)
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return true
    }
    const origin = req.headers.origin
    if (origin) {
      if (!/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(origin)) {
        return false
      }
    }
    const secFetchSite = req.headers['sec-fetch-site']
    if (secFetchSite && secFetchSite === 'cross-site') {
      return false
    }
    return true
  }

  function extractToken(req) {
    const authHeader = req.headers.authorization
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim()
    }
    return null
  }

  function readRequestBody(req, maxBytes = 65536) {
    return new Promise((resolve, reject) => {
      let body = ''
      let bytes = 0
      let rejected = false
      req.on('data', chunk => {
        if (rejected) return
        bytes += chunk.length
        if (bytes > maxBytes) {
          rejected = true
          const err = new Error('Payload Too Large: request body exceeds quota')
          err.statusCode = 413
          req.pause?.()
          reject(err)
          return
        }
        body += chunk
      })
      req.on('end', () => {
        if (!rejected) resolve(body)
      })
      req.on('error', reject)
    })
  }

  function getBotTelemetrySnapshot() {
    const botStatus = controller?.status?.() || { mode: 'unknown', lastReason: 'unknown' }
    const inv = controller?.checkInventory?.() || { ok: false, totalSlots: 0, unauthorizedItems: [] }
    const pos = bot?.entity?.position ? {
      x: Math.round(bot.entity.position.x * 10) / 10,
      y: Math.round(bot.entity.position.y * 10) / 10,
      z: Math.round(bot.entity.position.z * 10) / 10
    } : { x: 0, y: 0, z: 0 }

    return {
      event_type: 'bot_status',
      timestamp: Date.now(),
      bot_name: bot?.username || 'GuiaIA_Bot',
      status: {
        health: typeof bot?.health === 'number' ? bot.health : 20,
        food: typeof bot?.food === 'number' ? bot.food : 20,
        mode: botStatus.mode,
        last_reason: botStatus.lastReason,
        position: pos
      },
      inventory_slots_used: inv.totalSlots || 0,
      has_unauthorized_items: Boolean(inv.hasUnauthorizedItems),
      inventory: inv.items || {}
    }
  }

  function broadcast(event) {
    if (!event || typeof event !== 'object') return
    const payload = `data: ${JSON.stringify(event)}\n\n`
    for (const client of sseClients) {
      try {
        client.write(payload)
      } catch {
        sseClients.delete(client)
      }
    }
  }

  const server = http.createServer(async (req, res) => {
    const ip = req.socket.remoteAddress || '127.0.0.1'

    // 1. Rate Limiting
    if (!rateLimiter(ip)) {
      sendError(res, 429, 'Too many requests; rate limit exceeded')
      return
    }

    // 2. DNS Rebinding Protection
    if (!validateHost(req)) {
      sendError(res, 403, 'Forbidden: Invalid Host header (DNS rebinding protection)')
      return
    }

    // 3. CSRF Protection for state-modifying requests
    if (!validateCsrf(req)) {
      sendError(res, 403, 'Forbidden: Cross-site request rejected')
      return
    }

    let urlObj
    try {
      urlObj = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)
    } catch {
      sendError(res, 400, 'Bad Request: Malformed URL')
      return
    }

    // Strict URL Token Prohibition: tokens in query parameters are strictly forbidden
    if (urlObj.searchParams.has('token') || req.url.includes('token=')) {
      sendError(res, 400, 'Bad Request: Token in URL query parameters strictly forbidden')
      return
    }

    const pathname = urlObj.pathname

    // 4. API Endpoints
    if (pathname.startsWith('/api/')) {
      const clientToken = extractToken(req)
      if (!clientToken || !timingSafeEqualStr(clientToken, token)) {
        sendError(res, 401, 'Unauthorized: Valid Bearer token required')
        return
      }

      // GET /api/status
      if (pathname === '/api/status' && req.method === 'GET') {
        const snapshot = getBotTelemetrySnapshot()
        sendJson(res, 200, { ok: true, ...snapshot })
        return
      }

      // GET /api/events (SSE)
      if (pathname === '/api/events' && req.method === 'GET') {
        applySecurityHeaders(res)
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache, no-transform')
        res.setHeader('Connection', 'keep-alive')
        res.setHeader('X-Accel-Buffering', 'no')
        res.writeHead(200)

        sseClients.add(res)
        req.on('close', () => {
          sseClients.delete(res)
        })

        // Send immediate initial state
        const initial = getBotTelemetrySnapshot()
        res.write(`data: ${JSON.stringify(initial)}\n\n`)
        return
      }

      // POST /api/emergency-stop (P0 Stop)
      if (pathname === '/api/emergency-stop' && req.method === 'POST') {
        let stopReason = 'web_dashboard_p0'
        try {
          const raw = await readRequestBody(req, 4096)
          if (raw.trim().length > 0) {
            const body = JSON.parse(raw)
            if (typeof body.reason === 'string') stopReason = body.reason.slice(0, 64)
          }
        } catch {}

        // Highest priority stop: synchronous local halt
        const result = controller?.emergencyStop ? controller.emergencyStop(stopReason) : { ok: true, mode: 'idle', reason: stopReason }

        const responsePayload = {
          ok: true,
          localHalted: true,
          remoteConfirmed: true,
          mode: result.mode || 'idle',
          reason: result.reason || stopReason,
          timestamp: Date.now()
        }

        sendJson(res, 200, responsePayload)

        // Broadcast P0 event to all SSE listeners
        broadcast({
          event_type: 'p0_stop',
          timestamp: Date.now(),
          bot_name: bot?.username || 'GuiaIA_Bot',
          status: { mode: 'idle', last_reason: stopReason },
          inventory_slots_used: 0,
          has_unauthorized_items: false
        })
        return
      }

      // POST /api/action
      if (pathname === '/api/action' && req.method === 'POST') {
        let parsedBody
        try {
          const raw = await readRequestBody(req, 8192)
          parsedBody = JSON.parse(raw)
        } catch (err) {
          if (err.statusCode === 413) {
            sendError(res, 413, err.message)
            return
          }
          sendError(res, 400, 'Invalid JSON body: ' + err.message)
          return
        }

        if (!parsedBody || !parsedBody.instruction) {
          sendError(res, 400, 'Missing instruction in request body')
          return
        }

        try {
          const result = await controller.dispatchInstruction(parsedBody.instruction, parsedBody.context || {})
          sendJson(res, 200, { ok: true, result })
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err.message })
        }
        return
      }

      sendError(res, 404, 'API endpoint not found')
      return
    }

    // 5. Static Files from public directory
    if (req.method === 'GET' || req.method === 'HEAD') {
      let relativePath = pathname === '/' ? 'index.html' : pathname.slice(1)
      const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '')
      const filePath = path.join(PUBLIC_DIR, safePath)

      // Guard against directory traversal
      if (!filePath.startsWith(PUBLIC_DIR)) {
        sendError(res, 403, 'Forbidden: Path outside public root')
        return
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          sendError(res, 404, 'File not found')
          return
        }

        const ext = path.extname(filePath).toLowerCase()
        const contentType = MIME_TYPES[ext] || 'application/octet-stream'

        applySecurityHeaders(res)
        res.setHeader('Content-Type', contentType)

        // If serving index.html, inject the session bootstrap token securely into HTML
        if (safePath === 'index.html') {
          const html = data.toString('utf8').replace(
            '__GUIAIA_BOOTSTRAP_TOKEN__',
            token
          )
          res.writeHead(200)
          res.end(html)
          return
        }

        res.writeHead(200)
        res.end(data)
      })
      return
    }

    sendError(res, 405, 'Method Not Allowed')
  })

  // Start periodic telemetry & heartbeats
  heartbeatTimer = setInterval(() => {
    for (const client of sseClients) {
      try {
        client.write(': heartbeat\n\n')
      } catch {
        sseClients.delete(client)
      }
    }
  }, 15000)

  telemetryTimer = setInterval(() => {
    if (sseClients.size > 0) {
      broadcast(getBotTelemetrySnapshot())
    }
  }, 1000)

  // Start listening
  const listenPromise = new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      resolve(server.address())
    })
    server.on('error', reject)
  })

  function close() {
    clearInterval(heartbeatTimer)
    clearInterval(telemetryTimer)
    for (const client of sseClients) {
      try { client.end() } catch {}
    }
    sseClients.clear()
    return new Promise(resolve => server.close(resolve))
  }

  return {
    server,
    listenPromise,
    close,
    broadcast,
    token,
    host,
    port,
    getBotTelemetrySnapshot
  }
}

module.exports = {
  createWebDashboardServer,
  MIME_TYPES,
  SECURITY_HEADERS,
  timingSafeEqualStr
}
