'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { createWebDashboardServer } = require('../src/web/server')

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        })
      })
    })
    req.on('error', reject)
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body))
    }
    req.end()
  })
}

function createMockController() {
  let mode = 'idle'
  let lastReason = 'initialized'
  const stoppedCalls = []
  const dispatchedCalls = []

  return {
    emergencyStop: (reason = 'operator_stop') => {
      mode = 'idle'
      lastReason = reason
      stoppedCalls.push(reason)
      return { ok: true, mode: 'idle', reason }
    },
    status: () => ({ mode, lastReason, activeFollow: false, activeOperation: false }),
    checkInventory: () => ({
      ok: true,
      items: { oak_log: 4, cobblestone: 16 },
      totalSlots: 2,
      freeSlots: 34,
      unauthorizedItems: [],
      hasUnauthorizedItems: false
    }),
    dispatchInstruction: async (input, context) => {
      dispatchedCalls.push({ input, context })
      if (input === 'para') {
        mode = 'idle'
        lastReason = 'operator_stop'
        return { ok: true, mode: 'idle', reason: 'operator_stop' }
      }
      return { ok: true, dispatched: input }
    },
    _getStoppedCalls: () => stoppedCalls,
    _getDispatchedCalls: () => dispatchedCalls
  }
}

test('Web Dashboard - Server lifecycle, binding and clean shutdown', async () => {
  const controller = createMockController()
  const dashboard = createWebDashboardServer({
    port: 0,
    host: '127.0.0.1',
    controller
  })

  const addr = await dashboard.listenPromise
  assert.equal(addr.address, '127.0.0.1')
  assert.ok(addr.port > 0)
  assert.ok(typeof dashboard.token === 'string' && dashboard.token.length === 64)

  await dashboard.close()
})

test('Web Dashboard - DNS Rebinding Protection', async () => {
  const controller = createMockController()
  const dashboard = createWebDashboardServer({ port: 0, controller })
  const addr = await dashboard.listenPromise

  try {
    // 1. Attack simulation: Host header points to attacker domain
    const attackRes = await request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: '/api/status',
      method: 'GET',
      headers: {
        'Host': 'attacker.malicious-rebind.com',
        'Authorization': `Bearer ${dashboard.token}`
      }
    })
    assert.equal(attackRes.statusCode, 403)
    const err = JSON.parse(attackRes.body)
    assert.match(err.error, /DNS rebinding protection/i)

    // 2. Legitimate request with Host: 127.0.0.1:port
    const validRes = await request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: '/api/status',
      method: 'GET',
      headers: {
        'Host': `127.0.0.1:${addr.port}`,
        'Authorization': `Bearer ${dashboard.token}`
      }
    })
    assert.equal(validRes.statusCode, 200)
    const data = JSON.parse(validRes.body)
    assert.equal(data.ok, true)
    assert.equal(data.event_type, 'bot_status')
  } finally {
    await dashboard.close()
  }
})

test('Web Dashboard - CSRF Protection on Mutative Endpoints', async () => {
  const controller = createMockController()
  const dashboard = createWebDashboardServer({ port: 0, controller })
  const addr = await dashboard.listenPromise

  try {
    // Cross-site Origin attack
    const crossOriginRes = await request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: '/api/emergency-stop',
      method: 'POST',
      headers: {
        'Host': `127.0.0.1:${addr.port}`,
        'Origin': 'http://evil-site.com',
        'Authorization': `Bearer ${dashboard.token}`
      }
    }, JSON.stringify({ reason: 'exploit' }))
    assert.equal(crossOriginRes.statusCode, 403)
    assert.match(JSON.parse(crossOriginRes.body).error, /cross-site/i)

    // Sec-Fetch-Site cross-site
    const crossSiteRes = await request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: '/api/emergency-stop',
      method: 'POST',
      headers: {
        'Host': `127.0.0.1:${addr.port}`,
        'Sec-Fetch-Site': 'cross-site',
        'Authorization': `Bearer ${dashboard.token}`
      }
    }, JSON.stringify({ reason: 'exploit' }))
    assert.equal(crossSiteRes.statusCode, 403)
  } finally {
    await dashboard.close()
  }
})

test('Web Dashboard - Bearer Token Authentication', async () => {
  const controller = createMockController()
  const dashboard = createWebDashboardServer({ port: 0, controller })
  const addr = await dashboard.listenPromise

  try {
    // 1. Missing token
    const noToken = await request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: '/api/status',
      method: 'GET',
      headers: { 'Host': `127.0.0.1:${addr.port}` }
    })
    assert.equal(noToken.statusCode, 401)

    // 2. Invalid token
    const badToken = await request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: '/api/status',
      method: 'GET',
      headers: {
        'Host': `127.0.0.1:${addr.port}`,
        'Authorization': 'Bearer bad_token_1234567890'
      }
    })
    assert.equal(badToken.statusCode, 401)

    // 3. Valid token
    const goodToken = await request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: '/api/status',
      method: 'GET',
      headers: {
        'Host': `127.0.0.1:${addr.port}`,
        'Authorization': `Bearer ${dashboard.token}`
      }
    })
    assert.equal(goodToken.statusCode, 200)
    assert.equal(JSON.parse(goodToken.body).ok, true)
  } finally {
    await dashboard.close()
  }
})

test('Web Dashboard - Static Files and Directory Traversal Prevention', async () => {
  const controller = createMockController()
  const dashboard = createWebDashboardServer({ port: 0, controller })
  const addr = await dashboard.listenPromise

  try {
    // 1. GET / serves index.html with bootstrap token
    const indexRes = await request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: '/',
      method: 'GET',
      headers: { 'Host': `127.0.0.1:${addr.port}` }
    })
    assert.equal(indexRes.statusCode, 200)
    assert.match(indexRes.headers['content-type'], /text\/html/)
    assert.ok(indexRes.body.includes(dashboard.token), 'Bootstrap token should be injected into index.html')
    assert.equal(indexRes.headers['x-frame-options'], 'DENY')
    assert.equal(indexRes.headers['x-content-type-options'], 'nosniff')

    // 2. GET /app.js
    const appRes = await request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: '/app.js',
      method: 'GET',
      headers: { 'Host': `127.0.0.1:${addr.port}` }
    })
    assert.equal(appRes.statusCode, 200)
    assert.match(appRes.headers['content-type'], /application\/javascript/)

    // 3. GET /style.css
    const cssRes = await request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: '/style.css',
      method: 'GET',
      headers: { 'Host': `127.0.0.1:${addr.port}` }
    })
    assert.equal(cssRes.statusCode, 200)
    assert.match(cssRes.headers['content-type'], /text\/css/)

    // 4. Directory Traversal Attack
    const traversalRes = await request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: '/../../package.json',
      method: 'GET',
      headers: { 'Host': `127.0.0.1:${addr.port}` }
    })
    assert.ok(traversalRes.statusCode === 403 || traversalRes.statusCode === 404)
  } finally {
    await dashboard.close()
  }
})

test('Web Dashboard - P0 Emergency Stop Endpoint with Local and Remote Separation', async () => {
  const controller = createMockController()
  const dashboard = createWebDashboardServer({ port: 0, controller })
  const addr = await dashboard.listenPromise

  try {
    const p0Res = await request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: '/api/emergency-stop',
      method: 'POST',
      headers: {
        'Host': `127.0.0.1:${addr.port}`,
        'Authorization': `Bearer ${dashboard.token}`,
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({ reason: 'operator_ui_click' }))

    assert.equal(p0Res.statusCode, 200)
    const data = JSON.parse(p0Res.body)
    assert.equal(data.ok, true)
    assert.equal(data.localHalted, true)
    assert.equal(data.remoteConfirmed, true)
    assert.equal(data.reason, 'operator_ui_click')
    assert.ok(controller._getStoppedCalls().includes('operator_ui_click'))
  } finally {
    await dashboard.close()
  }
})

test('Web Dashboard - Action Dispatching Endpoint', async () => {
  const controller = createMockController()
  const dashboard = createWebDashboardServer({ port: 0, controller })
  const addr = await dashboard.listenPromise

  try {
    const actionRes = await request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: '/api/action',
      method: 'POST',
      headers: {
        'Host': `127.0.0.1:${addr.port}`,
        'Authorization': `Bearer ${dashboard.token}`,
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({ instruction: 'para' }))

    assert.equal(actionRes.statusCode, 200)
    const data = JSON.parse(actionRes.body)
    assert.equal(data.ok, true)
    assert.equal(data.result.reason, 'operator_stop')
    assert.equal(controller._getDispatchedCalls().length, 1)
  } finally {
    await dashboard.close()
  }
})

test('Web Dashboard - Server-Sent Events (SSE) Stream with Bearer Header', async () => {
  const controller = createMockController()
  const dashboard = createWebDashboardServer({ port: 0, controller })
  const addr = await dashboard.listenPromise

  try {
    const ssePromise = new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: addr.port,
        path: '/api/events',
        method: 'GET',
        headers: {
          'Host': `127.0.0.1:${addr.port}`,
          'Authorization': `Bearer ${dashboard.token}`
        }
      }, (res) => {
        assert.equal(res.statusCode, 200)
        assert.match(res.headers['content-type'], /text\/event-stream/)
        let buffer = ''
        res.on('data', chunk => {
          buffer += chunk
          if (buffer.includes('data:')) {
            const match = buffer.match(/data:\s*({.+})\n\n/)
            if (match) {
              const event = JSON.parse(match[1])
              resolve(event)
              req.destroy()
            }
          }
        })
      })
      req.on('error', (err) => {
        if (err.code !== 'ECONNRESET') reject(err)
      })
      req.end()
    })

    const initialEvent = await ssePromise
    assert.equal(initialEvent.event_type, 'bot_status')
    assert.equal(initialEvent.status.mode, 'idle')
    assert.equal(initialEvent.inventory_slots_used, 2)
  } finally {
    await dashboard.close()
  }
})

test('Web Dashboard - Negative Tests: Query Param Tokens Strictly Rejected with 400', async () => {
  const controller = createMockController()
  const dashboard = createWebDashboardServer({ port: 0, controller })
  const addr = await dashboard.listenPromise

  try {
    // 1. Query token in /api/events
    const resEvents = await request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: `/api/events?token=${dashboard.token}`,
      method: 'GET',
      headers: { 'Host': `127.0.0.1:${addr.port}` }
    })
    assert.equal(resEvents.statusCode, 400)
    assert.match(JSON.parse(resEvents.body).error, /Token in URL query parameters strictly forbidden/i)

    // 2. Query token in /api/status
    const resStatus = await request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: `/api/status?token=${dashboard.token}`,
      method: 'GET',
      headers: { 'Host': `127.0.0.1:${addr.port}` }
    })
    assert.equal(resStatus.statusCode, 400)
    assert.match(JSON.parse(resStatus.body).error, /Token in URL query parameters strictly forbidden/i)
  } finally {
    await dashboard.close()
  }
})

test('Web Dashboard - Negative Tests: Oversized Payloads Rejected with 413', async () => {
  const controller = createMockController()
  const dashboard = createWebDashboardServer({ port: 0, controller })
  const addr = await dashboard.listenPromise

  try {
    const hugePayload = JSON.stringify({ instruction: 'x'.repeat(16384) })
    const res = await request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: '/api/action',
      method: 'POST',
      headers: {
        'Host': `127.0.0.1:${addr.port}`,
        'Authorization': `Bearer ${dashboard.token}`,
        'Content-Type': 'application/json'
      }
    }, hugePayload)

    assert.equal(res.statusCode, 413)
    assert.match(JSON.parse(res.body).error, /Payload Too Large/i)
  } finally {
    await dashboard.close()
  }
})
