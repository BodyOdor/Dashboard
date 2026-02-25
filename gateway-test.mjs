/**
 * gateway-test.mjs — Node.js gateway connectivity + chat.send verification
 * Mirrors the logic in src/useGatewayChat.ts + src/deviceIdentity.ts
 *
 * Run: node gateway-test.mjs
 * Output: printed to stdout AND saved to gateway-test-output.txt by the caller
 */

import { createRequire } from 'module'
import { webcrypto } from 'crypto'
import { WebSocket } from 'ws'

// Polyfill crypto for @noble/curves in Node
if (!globalThis.crypto) globalThis.crypto = webcrypto

const require = createRequire(import.meta.url)

// ─── Ed25519 helpers (mirrors deviceIdentity.ts) ────────────────────────────
const { ed25519 } = await import('@noble/curves/ed25519.js')

function b64urlEncode(bytes) {
  return Buffer.from(bytes).toString('base64url')
}

function b64urlDecode(s) {
  return new Uint8Array(Buffer.from(s, 'base64url'))
}

async function deriveDeviceId(pubKeyBytes) {
  const hash = await webcrypto.subtle.digest('SHA-256', pubKeyBytes)
  return Buffer.from(hash).toString('hex')
}

async function makeTestIdentity() {
  const { secretKey: privKeyBytes, publicKey: pubKeyBytes } = ed25519.keygen()
  const deviceId = await deriveDeviceId(pubKeyBytes)
  return {
    deviceId,
    publicKey: b64urlEncode(pubKeyBytes),
    privateKey: b64urlEncode(privKeyBytes),
  }
}

function buildDeviceAuthPayload({ deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce }) {
  return ['v2', deviceId, clientId, clientMode, role, scopes.join(','), String(signedAtMs), token ?? '', nonce].join('|')
}

function signDevicePayload(payload, privateKeyB64) {
  const privKeyBytes = b64urlDecode(privateKeyB64)
  const msgBytes = new TextEncoder().encode(payload)
  const sigBytes = ed25519.sign(msgBytes, privKeyBytes)
  return b64urlEncode(sigBytes)
}

// ─── Gateway config ──────────────────────────────────────────────────────────
const PORT  = 18789
const TOKEN = '789758ef4fb3d0c7c131c3390901a289f581a7b4607a3f07'
const SCOPES = ['operator.admin', 'operator.approvals', 'operator.pairing']

// ─── Logging ─────────────────────────────────────────────────────────────────
const lines = []
function log(...args) {
  const line = args.join(' ')
  console.log(line)
  lines.push(line)
}

function ts() { return new Date().toISOString() }

// ─── Main test ───────────────────────────────────────────────────────────────
async function runTest() {
  log('='.repeat(60))
  log(`GATEWAY TEST — ${ts()}`)
  log('='.repeat(60))
  log(`Target: ws://127.0.0.1:${PORT}`)
  log(`Token:  ${TOKEN.slice(0, 8)}...`)
  log(`Scopes: ${SCOPES.join(', ')}`)
  log('')

  const identity = await makeTestIdentity()
  log(`Device ID:  ${identity.deviceId}`)
  log(`Public key: ${identity.publicKey.slice(0, 20)}...`)
  log('')

  return new Promise((resolve) => {
    // Tauri apps connect with tauri://localhost origin; try that first, fallback to localhost
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, {
      headers: { Origin: 'tauri://localhost' },
    })
    const pending = new Map()
    let reqCounter = 0
    let sessionKey = 'agent:main:main'
    let connected = false
    let testDone = false
    let deltasSeen = 0
    let finalSeen = false

    const finish = (status) => {
      if (testDone) return
      testDone = true
      log('')
      log('='.repeat(60))
      log(`TEST ${status} — ${ts()}`)
      log('='.repeat(60))
      ws.close()
      resolve(lines.join('\n'))
    }

    // Safety timeout — 45s
    const globalTimeout = setTimeout(() => finish('TIMEOUT'), 45000)

    function sendRaw(obj) {
      const raw = JSON.stringify(obj)
      log(`[SEND] ${raw.slice(0, 200)}`)
      ws.send(raw)
    }

    function sendReq(method, params) {
      const id = `r-${++reqCounter}`
      return new Promise((res, rej) => {
        pending.set(id, { res, rej })
        sendRaw({ type: 'req', id, method, params })
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id)
            rej(new Error(`timeout waiting for ${method}`))
          }
        }, 30000)
      })
    }

    ws.on('open', () => {
      log(`[${ts()}] WebSocket OPEN`)
    })

    ws.on('error', (err) => {
      log(`[${ts()}] WebSocket ERROR: ${err.message}`)
      clearTimeout(globalTimeout)
      finish('FAILED')
    })

    ws.on('close', (code) => {
      log(`[${ts()}] WebSocket CLOSED (code=${code})`)
      if (!testDone) {
        clearTimeout(globalTimeout)
        finish('CLOSED_UNEXPECTEDLY')
      }
    })

    ws.on('message', async (raw) => {
      const str = raw.toString()
      log(`[RECV] ${str.slice(0, 400)}`)

      let frame
      try { frame = JSON.parse(str) } catch { return }

      if (frame.type === 'event' && frame.event === 'connect.challenge') {
        const nonce = frame.payload?.nonce ?? ''
        log(`[${ts()}] Got connect.challenge (nonce=${nonce.slice(0,8)}...)`)

        const signedAt = Date.now()
        const payloadStr = buildDeviceAuthPayload({
          deviceId: identity.deviceId,
          clientId: 'openclaw-control-ui',
          clientMode: 'webchat',
          role: 'operator',
          scopes: SCOPES,
          signedAtMs: signedAt,
          token: TOKEN,
          nonce,
        })
        const signature = signDevicePayload(payloadStr, identity.privateKey)

        sendRaw({
          type: 'req',
          id: 'connect-1',
          method: 'connect',
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: { id: 'openclaw-control-ui', version: '0.1.0', platform: 'macos', mode: 'webchat' },
            role: 'operator',
            scopes: SCOPES,
            auth: { token: TOKEN },
            device: { id: identity.deviceId, publicKey: identity.publicKey, signature, signedAt, nonce },
          },
        })
      }

      if (frame.type === 'event' && frame.event === 'chat') {
        const p = frame.payload ?? {}
        log(`[${ts()}] chat event state=${p.state} runId=${p.runId}`)
        if (p.state === 'delta') {
          deltasSeen++
          const text = typeof p.message === 'string' ? p.message : JSON.stringify(p.message)
          log(`  delta #${deltasSeen}: "${text.slice(0, 80)}..."`)
        }
        if (p.state === 'final') {
          finalSeen = true
          const text = typeof p.message === 'string' ? p.message : JSON.stringify(p.message)
          log(`  final text: "${text.slice(0, 200)}"`)
          log(`  delta count seen: ${deltasSeen}`)
          clearTimeout(globalTimeout)
          finish('PASSED')
        }
        if (p.state === 'error') {
          log(`  chat error: ${JSON.stringify(p.message)}`)
          clearTimeout(globalTimeout)
          finish('FAILED (chat error)')
        }
      }

      if (frame.type === 'res' && frame.id === 'connect-1') {
        if (!frame.ok) {
          log(`[${ts()}] connect FAILED: ${JSON.stringify(frame.error)}`)
          clearTimeout(globalTimeout)
          finish('FAILED')
          return
        }
        connected = true
        const sk = frame.payload?.snapshot?.sessionDefaults?.mainSessionKey
        if (sk) sessionKey = sk
        log(`[${ts()}] connect OK — sessionKey=${sessionKey}`)

        // Step 2: send test message
        log('')
        log(`[${ts()}] Sending chat.send test message...`)
        try {
          const result = await sendReq('chat.send', {
            sessionKey,
            message: 'Gateway test (automated): reply with one short sentence confirming you received this. Do not engage further.',
            deliver: false,
            idempotencyKey: `gateway-test-${Date.now()}`,
          })
          log(`[${ts()}] chat.send response: ok=${result?.ok ?? 'n/a'} ${JSON.stringify(result).slice(0,120)}`)
        } catch (err) {
          log(`[${ts()}] chat.send FAILED: ${err.message || err}`)
          clearTimeout(globalTimeout)
          finish('FAILED')
        }
      }

      if (frame.type === 'res' && frame.id !== 'connect-1') {
        const cb = pending.get(frame.id)
        if (cb) {
          pending.delete(frame.id)
          if (frame.ok !== false) cb.res(frame.payload)
          else cb.rej(new Error(frame.error?.message || JSON.stringify(frame.error)))
        }
      }
    })
  })
}

const output = await runTest()

import { writeFileSync } from 'fs'
const outPath = new URL('./gateway-test-output.txt', import.meta.url).pathname
const finalOutput = [
  `# Gateway Test Output`,
  `# Generated: ${new Date().toISOString()}`,
  `# Script:    gateway-test.mjs`,
  '',
  output,
].join('\n')

writeFileSync(outPath, finalOutput, 'utf8')
console.log(`\nOutput saved to: ${outPath}`)
