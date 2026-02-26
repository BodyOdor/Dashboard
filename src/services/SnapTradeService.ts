/**
 * SnapTrade API client — routes calls through Tauri Rust backend to avoid CORS.
 * The browser cannot send a custom `Signature` header cross-origin; Rust can.
 * Config is loaded from src/data/snaptrade-config.json (gitignored).
 */

import { invoke } from '@tauri-apps/api/core'
import snapConfig from '../data/snaptrade-config.json'

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

// ─── Rust backend call ────────────────────────────────────────────────────────
// The Rust `fetch_snaptrade_accounts` command signs requests server-side and
// returns a JSON string: Array<{ account, balances, positions }>.

interface RawEnriched {
  account: SnapAccount
  balances: SnapBalance[]
  positions: SnapPosition[]
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

export async function loadBrokerageAccounts(): Promise<BrokerageAccount[]> {
  const { clientId, consumerKey, userId, userSecret } = snapConfig

  const jsonStr = await invoke<string>('fetch_snaptrade_accounts', {
    clientId,
    consumerKey,
    userId,
    userSecret,
  })

  const enriched: RawEnriched[] = JSON.parse(jsonStr)
  if (!enriched || enriched.length === 0) return []

  return enriched.map((item): BrokerageAccount => {
    const acct = item.account
    const balancesRaw: SnapBalance[] = item.balances ?? []
    const positionsRaw: SnapPosition[] = item.positions ?? []

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
}
