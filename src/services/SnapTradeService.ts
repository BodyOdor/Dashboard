/**
 * SnapTrade REST API client with HMAC-SHA256 request signing.
 * Config is loaded from src/data/snaptrade-config.json (gitignored).
 * Uses the Web Crypto API for signing — works in Tauri WebView.
 */

import snapConfig from '../data/snaptrade-config.json'

const BASE_URL = 'https://api.snaptrade.com'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SnapAccount {
  id: string
  name: string
  number: string
  institution_name: string
  meta: {
    type: string
    status: string
  }
}

export interface SnapBalance {
  currency: { code: string }
  cash: number
  buying_power: number
  total_cash: number
}

export interface SnapPosition {
  symbol: {
    symbol: {
      symbol: string
      description: string
    }
  }
  units: number
  price: number
  open_pnl: number
  fractional_units?: number
  average_purchase_price: number
}

export interface BrokerageAccount {
  id: string
  name: string
  institution: string
  accountNumber: string
  accountType: string
  status: string
  cashBalance: number
  totalValue: number
  positions: BrokeragePosition[]
}

export interface BrokeragePosition {
  ticker: string
  description: string
  shares: number
  currentPrice: number
  marketValue: number
  avgCost: number
  gainLoss: number
  gainLossPct: number
}

// ─── Signing ──────────────────────────────────────────────────────────────────

async function hmacSha256Base64(message: string, key: string): Promise<string> {
  const encoder = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message))
  // Convert ArrayBuffer to base64
  const bytes = new Uint8Array(sig)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

async function signedFetch(path: string): Promise<Response> {
  const { clientId, consumerKey, userId, userSecret } = snapConfig
  const timestamp = Math.floor(Date.now() / 1000).toString()

  // Build query params in deterministic order (without signature)
  const paramPairs: [string, string][] = [
    ['clientId', clientId],
    ['timestamp', timestamp],
    ['userId', userId],
    ['userSecret', userSecret],
  ]

  const queryStringNoSig = paramPairs
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  // Sign: HMAC-SHA256(path + '?' + query_without_sig, consumerKey)
  const message = path + '?' + queryStringNoSig
  const signature = await hmacSha256Base64(message, consumerKey)

  const finalQuery = queryStringNoSig + '&signature=' + encodeURIComponent(signature)
  const url = `${BASE_URL}${path}?${finalQuery}`

  return fetch(url, {
    headers: { Accept: 'application/json' },
  })
}

// ─── API calls ────────────────────────────────────────────────────────────────

async function fetchAccounts(): Promise<SnapAccount[]> {
  const res = await signedFetch('/api/v1/accounts')
  if (!res.ok) throw new Error(`accounts ${res.status}: ${await res.text()}`)
  return res.json()
}

async function fetchBalances(accountId: string): Promise<SnapBalance[]> {
  const res = await signedFetch(`/api/v1/accounts/${accountId}/balances`)
  if (!res.ok) throw new Error(`balances ${res.status}: ${await res.text()}`)
  return res.json()
}

async function fetchPositions(accountId: string): Promise<SnapPosition[]> {
  const res = await signedFetch(`/api/v1/accounts/${accountId}/positions`)
  if (!res.ok) throw new Error(`positions ${res.status}: ${await res.text()}`)
  return res.json()
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

export async function loadBrokerageAccounts(): Promise<BrokerageAccount[]> {
  const accounts = await fetchAccounts()
  if (!accounts || accounts.length === 0) return []

  const results = await Promise.allSettled(
    accounts.map(async (acct): Promise<BrokerageAccount> => {
      const [balancesRaw, positionsRaw] = await Promise.all([
        fetchBalances(acct.id).catch(() => [] as SnapBalance[]),
        fetchPositions(acct.id).catch(() => [] as SnapPosition[]),
      ])

      // Cash balance — pick USD first, fall back to first entry
      const usdBalance = balancesRaw.find(b => b.currency?.code === 'USD')
      const cashBalance = usdBalance?.cash ?? balancesRaw[0]?.cash ?? 0

      // Map positions
      const positions: BrokeragePosition[] = positionsRaw
        .filter(p => p && p.symbol?.symbol?.symbol)
        .map(p => {
          const shares = (p.units ?? 0) + (p.fractional_units ?? 0)
          const marketValue = shares * p.price
          const avgCost = p.average_purchase_price ?? 0
          const costBasis = avgCost * shares
          const gainLoss = marketValue - costBasis
          const gainLossPct = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0
          return {
            ticker: p.symbol.symbol.symbol,
            description: p.symbol.symbol.description ?? '',
            shares,
            currentPrice: p.price ?? 0,
            marketValue,
            avgCost,
            gainLoss,
            gainLossPct,
          }
        })
        .sort((a, b) => b.marketValue - a.marketValue)

      const positionsValue = positions.reduce((s, p) => s + p.marketValue, 0)

      return {
        id: acct.id,
        name: acct.name || 'Brokerage Account',
        institution: acct.institution_name || 'Unknown',
        accountNumber: acct.number || '',
        accountType: acct.meta?.type || 'individual',
        status: acct.meta?.status || 'ACTIVE',
        cashBalance,
        totalValue: cashBalance + positionsValue,
        positions,
      }
    })
  )

  return results
    .filter((r): r is PromiseFulfilledResult<BrokerageAccount> => r.status === 'fulfilled')
    .map(r => r.value)
}
