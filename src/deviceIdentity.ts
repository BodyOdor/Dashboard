/**
 * Device Identity for OpenClaw Gateway authentication
 *
 * The OpenClaw Gateway requires Ed25519 device identity to grant scopes to WebSocket connections.
 * Without device identity, the gateway clears all requested scopes (leaving []) and only allows
 * minimal access — so chat.send will fail with "missing scope: operator.write".
 *
 * This module provides browser-side Ed25519 key generation (stored in localStorage),
 * matching the approach used by the OpenClaw Control UI. Local connections are auto-approved
 * silently by the gateway on first use.
 */

import { ed25519 } from '@noble/curves/ed25519.js'

const STORAGE_KEY = 'openclaw-dashboard-device-identity'

export interface DeviceIdentity {
  deviceId: string   // SHA-256 of raw public key bytes, as hex string
  publicKey: string  // base64url-encoded raw 32-byte Ed25519 public key
  privateKey: string // base64url-encoded raw 32-byte Ed25519 private key
}

function base64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function base64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

async function deriveDeviceId(publicKeyBytes: Uint8Array): Promise<string> {
  // Ensure a clean ArrayBuffer to satisfy crypto.subtle requirements
  const buf = new Uint8Array(publicKeyBytes).buffer as ArrayBuffer
  const hashBuffer = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function loadOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed: unknown = JSON.parse(stored)
      if (
        parsed &&
        typeof parsed === 'object' &&
        'version' in parsed && (parsed as Record<string, unknown>).version === 1 &&
        'deviceId' in parsed && typeof (parsed as Record<string, unknown>).deviceId === 'string' &&
        'publicKey' in parsed && typeof (parsed as Record<string, unknown>).publicKey === 'string' &&
        'privateKey' in parsed && typeof (parsed as Record<string, unknown>).privateKey === 'string'
      ) {
        const p = parsed as { version: number; deviceId: string; publicKey: string; privateKey: string }
        // Re-derive deviceId to ensure it's still correct
        const pubKeyBytes = base64urlDecode(p.publicKey)
        const deviceId = await deriveDeviceId(pubKeyBytes)
        if (deviceId !== p.deviceId) {
          const updated = { ...p, deviceId }
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
          return { deviceId, publicKey: p.publicKey, privateKey: p.privateKey }
        }
        return { deviceId: p.deviceId, publicKey: p.publicKey, privateKey: p.privateKey }
      }
    }
  } catch {
    // Fall through to generate new identity
  }

  // Generate new Ed25519 key pair
  const { secretKey: privKeyBytes, publicKey: pubKeyBytes } = ed25519.keygen()
  const deviceId = await deriveDeviceId(pubKeyBytes)
  const publicKey = base64urlEncode(pubKeyBytes)
  const privateKey = base64urlEncode(privKeyBytes)

  const identity: DeviceIdentity = { deviceId, publicKey, privateKey }
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 1, createdAtMs: Date.now(), ...identity })
  )
  return identity
}

/**
 * Build the device auth payload string (must match server-side buildDeviceAuthPayload)
 * Format: "v2|deviceId|clientId|clientMode|role|scopes,joined|signedAtMs|token|nonce"
 */
export function buildDeviceAuthPayload(params: {
  deviceId: string
  clientId: string
  clientMode: string
  role: string
  scopes: string[]
  signedAtMs: number
  token: string | null
  nonce: string
}): string {
  const scopes = params.scopes.join(',')
  const token = params.token ?? ''
  return ['v2', params.deviceId, params.clientId, params.clientMode, params.role, scopes, String(params.signedAtMs), token, params.nonce].join('|')
}

/**
 * Sign a payload string with the device's Ed25519 private key.
 * Returns base64url-encoded signature.
 */
export function signDevicePayload(payload: string, privateKeyBase64: string): string {
  const privKeyBytes = base64urlDecode(privateKeyBase64)
  const msgBytes = new TextEncoder().encode(payload)
  const sigBytes = ed25519.sign(msgBytes, privKeyBytes)
  return base64urlEncode(sigBytes)
}
