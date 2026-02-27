import { invoke } from '@tauri-apps/api/core'
import type { Account, PortfolioSummary, DataSource } from '../types/finance'
import type { BrokerageAccount } from '../services/SnapTradeService'

// Coinbase live data types
interface CoinbaseHolding {
  currency: string
  name: string
  balance: number
  usd_value: number
  price_usd: number
}

interface CoinbaseData {
  provider: string
  fetched_at: string
  total_usd: number
  account_count: number
  holdings: CoinbaseHolding[]
}

// Cached provider data
let coinbaseData: CoinbaseData | null = null
let strikeData: CoinbaseData | null = null  // Same shape
let snaptradeAccounts: BrokerageAccount[] | null = null
let snaptradeLastSync: string | null = null
let btcColdStorageUsd: number = 0

export function setBtcColdStorageUsd(usd: number): void {
  btcColdStorageUsd = usd
}

export function getBtcColdStorageUsd(): number {
  return btcColdStorageUsd
}

export function setSnaptradeAccounts(accounts: BrokerageAccount[]): void {
  snaptradeAccounts = accounts
  snaptradeLastSync = new Date().toISOString()
}

export function getSnaptradeAccounts(): BrokerageAccount[] | null {
  return snaptradeAccounts
}

export function getSnaptradeLastSync(): string | null {
  return snaptradeLastSync
}
export async function loadCoinbaseData(): Promise<CoinbaseData | null> {
  try {
    const raw = await invoke<string>('read_coinbase_data')
    coinbaseData = JSON.parse(raw)
    return coinbaseData
  } catch {
    return null
  }
}

export async function refreshCoinbaseData(): Promise<CoinbaseData | null> {
  try {
    const raw = await invoke<string>('fetch_coinbase')
    coinbaseData = JSON.parse(raw)
    return coinbaseData
  } catch (e) {
    console.error('Coinbase refresh failed:', e)
    return coinbaseData
  }
}

export async function loadStrikeData(): Promise<CoinbaseData | null> {
  try {
    const raw = await invoke<string>('read_strike_data')
    strikeData = JSON.parse(raw)
    return strikeData
  } catch {
    return null
  }
}

export async function refreshStrikeData(): Promise<CoinbaseData | null> {
  try {
    const raw = await invoke<string>('fetch_strike')
    strikeData = JSON.parse(raw)
    return strikeData
  } catch (e) {
    console.error('Strike refresh failed:', e)
    return strikeData
  }
}

function getStrikeAccounts(): Account[] {
  if (!strikeData) return []
  return strikeData.holdings
    .filter(h => h.usd_value > 0.01)
    .map(h => ({
      id: `strike-${h.currency.toLowerCase()}`,
      name: h.name,
      institution: 'Strike',
      type: 'crypto_exchange' as const,
      value: h.usd_value,
      dailyChange: 0,
      allocation: 0,
      chain: h.currency,
      lastUpdated: strikeData!.fetched_at.split('T')[0],
    }))
}

function getCoinbaseAccounts(): Account[] {
  if (!coinbaseData) return []
  return coinbaseData.holdings
    .filter(h => h.usd_value > 0.01)
    .map(h => ({
      id: `coinbase-${h.currency.toLowerCase()}`,
      name: h.name,
      institution: 'Coinbase',
      type: 'crypto_exchange' as const,
      value: h.usd_value,
      dailyChange: 0,
      allocation: 0,
      chain: h.currency,
      lastUpdated: coinbaseData!.fetched_at.split('T')[0],
    }))
}

// Mock data — will be replaced with Tauri fs read/write later

const mockAccounts: Account[] = [
  // Fidelity
  { id: 'fid-401k', name: '401(k)', institution: 'Fidelity', type: '401k', value: 185000, dailyChange: 0.42, allocation: 0, lastUpdated: '2026-02-18' },
  { id: 'fid-brokerage', name: 'Individual Brokerage', institution: 'Fidelity', type: 'brokerage', value: 72000, dailyChange: -0.18, allocation: 0, lastUpdated: '2026-02-18' },
  { id: 'fid-roth', name: 'Roth IRA', institution: 'Fidelity', type: 'ira', value: 43000, dailyChange: 0.31, allocation: 0, lastUpdated: '2026-02-18' },
  // Strike — now pulled live via API
  // Masterworks
  { id: 'masterworks', name: 'Art Portfolio', institution: 'Masterworks', type: 'alternative', value: 37000, dailyChange: 0.0, allocation: 0, lastUpdated: '2026-02-18' },
  // Fellow Products — 200k shares, ~0.5% of company. $100M revenue * 1.5x multiple = $150M valuation. 0.5% = $750,000
  { id: 'fellow', name: 'Private Equity (200K shares)', institution: 'Fellow Products', type: 'alternative', value: 750000, dailyChange: 0.0, allocation: 0, lastUpdated: '2026-02-18' },
  // Real Estate
  { id: 'home', name: 'Primary Residence', institution: 'Real Estate', type: 'real_estate', value: 703055.19, dailyChange: 0.0, allocation: 0, lastUpdated: '2026-02-18',
    realEstate: {
      marketValue: 1050000,
      mortgageBalance: 346944.81,
      equity: 703055.19,
      originalBalance: 450000,
      interestRate: 2.875,
      closingDate: '2021-04-16',
      maturityDate: '2041-05-01',
      escrowBalance: 4460.67,
      monthlyPrincipal: 1631.78,
      monthlyInterest: 835.85,
      monthlyEscrow: 1160.97,
      extraPrincipal: 300,
      totalMonthlyPayment: 3928.60,
    } },
]

function withAllocations(accounts: Account[]): Account[] {
  const total = accounts.reduce((s, a) => s + a.value, 0)
  return accounts.map(a => ({ ...a, allocation: total > 0 ? (a.value / total) * 100 : 0 }))
}

function getAllAccounts(): Account[] {
  return [...mockAccounts, ...getCoinbaseAccounts(), ...getStrikeAccounts()]
}

export function getAccounts(): Account[] {
  return withAllocations(getAllAccounts())
}

export function getNetWorth(): number {
  return getAllAccounts().reduce((s, a) => s + a.value, 0)
}

export function getPortfolio(): PortfolioSummary {
  const accounts = getAllAccounts()
  const total = accounts.reduce((s, a) => s + a.value, 0) + btcColdStorageUsd
  const traditional = accounts
    .filter(a => ['brokerage', '401k', 'ira'].includes(a.type))
    .reduce((s, a) => s + a.value, 0)
  const crypto = accounts
    .filter(a => ['crypto_wallet', 'crypto_exchange', 'bitcoin_cold_storage'].includes(a.type))
    .reduce((s, a) => s + a.value, 0) + btcColdStorageUsd
  const alternative = accounts
    .filter(a => a.type === 'alternative')
    .reduce((s, a) => s + a.value, 0)
  const realEstate = accounts
    .filter(a => a.type === 'real_estate')
    .reduce((s, a) => s + a.value, 0)

  // Weighted average daily change
  const weightedChange = total > 0
    ? accounts.reduce((s, a) => s + a.dailyChange * (a.value / total), 0)
    : 0

  return {
    totalNetWorth: total,
    totalDailyChange: weightedChange,
    traditionalInvestments: traditional,
    cryptoHoldings: crypto,
    alternativeInvestments: alternative,
    realEstate,
    lastUpdated: new Date().toISOString(),
  }
}

export function getDataSources(): DataSource[] {
  return [
    { id: 'fidelity', name: 'Fidelity', status: 'not_configured', lastSync: null, accountCount: 3 },
    { id: 'snaptrade', name: 'SnapTrade (Robinhood + E*Trade)', status: snaptradeAccounts ? 'connected' : 'not_configured', lastSync: snaptradeLastSync, accountCount: snaptradeAccounts?.length ?? 0 },
    { id: 'mempool', name: 'Mempool.space (BTC cold storage)', status: 'connected', lastSync: new Date().toISOString(), accountCount: 0 },
    { id: 'coinbase', name: 'Coinbase', status: coinbaseData ? 'connected' : 'not_configured', lastSync: coinbaseData?.fetched_at || null, accountCount: coinbaseData?.account_count || 0 },
    { id: 'strike', name: 'Strike', status: strikeData ? 'connected' : 'not_configured', lastSync: strikeData?.fetched_at || null, accountCount: strikeData?.account_count || 0 },
    { id: 'masterworks', name: 'Masterworks', status: 'manual', lastSync: '2026-02-10T08:00:00Z', accountCount: 1 },
    { id: 'fellow', name: 'Fellow Products', status: 'manual', lastSync: '2026-01-15T12:00:00Z', accountCount: 1 },
    { id: 'real-estate', name: 'Real Estate', status: 'manual', lastSync: null, accountCount: 1 },
  ]
}

export function updateAccount(id: string, updates: Partial<Account>): Account | null {
  const idx = mockAccounts.findIndex(a => a.id === id)
  if (idx === -1) return null
  Object.assign(mockAccounts[idx], updates)
  return mockAccounts[idx]
}
