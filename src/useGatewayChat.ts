import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  loadOrCreateDeviceIdentity,
  buildDeviceAuthPayload,
  signDevicePayload,
} from './deviceIdentity'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  /** If true, this message represents a send/network/scope error and should be shown with error styling */
  isError?: boolean
}

interface GatewayConfig {
  token: string
  port: number
}

let reqCounter = 0
function nextId(prefix = 'r') {
  return `${prefix}-${++reqCounter}`
}

function extractText(content: unknown): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text' || b.text)
      .map((b: any) => b.text ?? '')
      .join('')
  }
  // Handle { content: ... } wrapper (delta/final messages from gateway)
  if (typeof content === 'object' && 'content' in (content as any)) {
    return extractText((content as any).content)
  }
  // Handle { text: ... }
  if (typeof content === 'object' && 'text' in (content as any)) {
    return String((content as any).text)
  }
  return ''
}

const SCOPES = ['operator.admin', 'operator.approvals', 'operator.pairing']

export function useGatewayChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const sessionKeyRef = useRef<string>('agent:main:main')
  const pendingRef = useRef<Map<string, { resolve: (payload: any) => void; reject: (err: any) => void }>>(new Map())
  const streamingRef = useRef<Map<string, string>>(new Map())
  const finalizedRef = useRef<Set<string>>(new Set())
  const spokenRef = useRef<Set<string>>(new Set())
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const configRef = useRef<GatewayConfig | null>(null)

  const sendReq = useCallback((method: string, params: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return reject('not connected')
      const id = nextId()
      pendingRef.current.set(id, { resolve, reject })
      ws.send(JSON.stringify({ type: 'req', id, method, params }))
      setTimeout(() => {
        if (pendingRef.current.has(id)) {
          pendingRef.current.delete(id)
          reject('timeout')
        }
      }, 30000)
    })
  }, [])

  const connect = useCallback(async () => {
    if (!configRef.current) {
      try {
        configRef.current = await invoke<GatewayConfig>('get_gateway_config')
      } catch (e) {
        console.error('Failed to get gateway config:', e)
        return
      }
    }
    const { token, port } = configRef.current
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    wsRef.current = ws

    ws.onopen = () => console.log('WS connected')

    ws.onmessage = (ev) => {
      let frame: any
      try { frame = JSON.parse(ev.data) } catch { return }

      if (frame.type === 'event') {
        if (frame.event === 'connect.challenge') {
          // Build device-authenticated connect request (async, fires-and-forgets into ws.send)
          ;(async () => {
            try {
              const nonce: string = frame.payload?.nonce ?? ''
              const identity = await loadOrCreateDeviceIdentity()
              const signedAt = Date.now()

              const payloadStr = buildDeviceAuthPayload({
                deviceId: identity.deviceId,
                clientId: 'openclaw-control-ui',
                clientMode: 'webchat',
                role: 'operator',
                scopes: SCOPES,
                signedAtMs: signedAt,
                token,
                nonce,
              })

              const signature = signDevicePayload(payloadStr, identity.privateKey)

              ws.send(JSON.stringify({
                type: 'req',
                id: 'connect-1',
                method: 'connect',
                params: {
                  minProtocol: 3,
                  maxProtocol: 3,
                  client: {
                    id: 'openclaw-control-ui',
                    version: '0.1.0',
                    platform: 'macos',
                    mode: 'webchat',
                  },
                  role: 'operator',
                  scopes: SCOPES,
                  auth: { token },
                  device: {
                    id: identity.deviceId,
                    publicKey: identity.publicKey,
                    signature,
                    signedAt,
                    nonce,
                  },
                },
              }))
            } catch (err) {
              console.error('Device identity / connect error:', err)
            }
          })()
        } else if (frame.event === 'chat') {
          handleChatEvent(frame.payload)
        }
      } else if (frame.type === 'res') {
        if (frame.id === 'connect-1') {
          if (frame.ok) {
            setIsConnected(true)
            const sk = frame.payload?.snapshot?.sessionDefaults?.mainSessionKey
            if (sk) sessionKeyRef.current = sk
            // Fetch chat history
            sendReq('chat.history', { sessionKey: sessionKeyRef.current, limit: 100 })
              .then((payload: any) => {
                if (payload?.messages) {
                  setMessages(
                    payload.messages
                      .map((m: any) => ({
                        role: m.role === 'user' ? 'user' : 'assistant',
                        text: extractText(m.content),
                      }))
                      .filter((m: ChatMessage) => m.text.trim())
                  )
                }
              })
              .catch(console.error)
          } else {
            console.error('Connect failed:', frame.error)
          }
        } else {
          const cb = pendingRef.current.get(frame.id)
          if (cb) {
            pendingRef.current.delete(frame.id)
            // Reject on ok:false so callers (e.g. sendMessage) surface gateway errors as visible UI errors
            if (frame.ok === false) {
              cb.reject(frame.error?.message ?? JSON.stringify(frame.error) ?? 'Gateway rejected request')
            } else {
              cb.resolve(frame.payload)
            }
          }
        }
      }
    }

    ws.onclose = () => {
      setIsConnected(false)
      wsRef.current = null
      reconnectTimer.current = setTimeout(connect, 3000)
    }

    ws.onerror = () => ws.close()
  }, [sendReq])

  const handleChatEvent = useCallback((payload: any) => {
    if (!payload) return
    const { state, runId, message, role } = payload

    // Skip events for already-finalized runs
    if (runId && finalizedRef.current.has(runId)) return

    if (state === 'delta' && runId) {
      const text = extractText(message)
      if (!text) return
      // Gateway sends CUMULATIVE delta text — replace, don't concatenate
      streamingRef.current.set(runId, text)
      setMessages(prev => {
        const idx = prev.findIndex((m: any) => m._runId === runId)
        const msg = { role: 'assistant' as const, text, _runId: runId } as any
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = msg
          return next
        }
        return [...prev, msg]
      })
    } else if (state === 'final') {
      if (runId) {
        finalizedRef.current.add(runId)
        streamingRef.current.delete(runId)
      }
      const finalText = extractText(message)
      // Speak the response (only once per runId)
      if (finalText && runId && !spokenRef.current.has(runId)) {
        spokenRef.current.add(runId)
        invoke('speak_text', { text: finalText }).catch(console.error)
      }
      setMessages(prev => {
        const idx = prev.findIndex((m: any) => m._runId === runId)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { role: 'assistant' as const, text: finalText || next[idx].text }
          return next
        }
        if (finalText) return [...prev, { role: 'assistant', text: finalText }]
        return prev
      })
      setIsLoading(false)
    } else if (state === 'error') {
      setIsLoading(false)
      if (runId) finalizedRef.current.add(runId)
      setMessages(prev => [
        ...prev,
        { role: 'assistant', text: `Failed to send — ${extractText(message) || 'Unknown error'}`, isError: true },
      ])
      if (runId) streamingRef.current.delete(runId)
    } else if (state === 'user' || role === 'user') {
      // Incoming user message from another channel
      const text = extractText(message ?? payload.content)
      if (text) {
        setMessages(prev => [...prev, { role: 'user', text }])
      }
    }
  }, [])

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return
      setMessages(prev => [...prev, { role: 'user', text }])
      setIsLoading(true)
      try {
        const result = await sendReq('chat.send', {
          sessionKey: sessionKeyRef.current,
          message: text,
          deliver: false,      // Suppress delivery to external channels; response comes via chat events
          idempotencyKey: crypto.randomUUID(),
        })
        // If gateway returned ok:false without throwing (shouldn't happen with new sendReq, defensive check)
        if (result && result.ok === false) {
          throw new Error(result.error?.message ?? 'Gateway returned not-ok')
        }
      } catch (e) {
        // Surface the error visibly — clear the spinner and show an inline error message
        setIsLoading(false)
        const errText = typeof e === 'string' ? e : (e instanceof Error ? e.message : String(e))
        setMessages(prev => [
          ...prev,
          { role: 'assistant', text: `Failed to send — ${errText}`, isError: true },
        ])
      }
    },
    [sendReq]
  )

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { messages, sendMessage, isConnected, isLoading }
}
