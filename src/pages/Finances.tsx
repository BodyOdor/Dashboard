import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { getAccounts, getPortfolio, getDataSources, loadCoinbaseData, refreshCoinbaseData, loadStrikeData, refreshStrikeData } from '../data/financial-store'
import type { Account, DataSource } from '../types/finance'
import btcAddressConfig from '../data/btc-addresses.json'

const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const fmtPct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%'

function SummaryCard({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  return (
    <div className={`bg-white/5 backdrop-blur-xl rounded-2xl p-5 border border-white/10 hover:border-${color}/40 transition-all`}>
      <div className="flex items-center gap-2 mb-1 text-white/60 text-sm">{icon} {label}</div>
      <div className="text-2xl font-bold text-white">{fmt(value)}</div>
    </div>
  )
}

function AccountCard({ account }: { account: Account }) {
  if (account.type === 'real_estate' && account.realEstate) {
    return <RealEstateCard account={account} />
  }
  const changeColor = account.dailyChange >= 0 ? 'text-green-400' : 'text-red-400'
  return (
    <div className="bg-white/5 backdrop-blur-xl rounded-xl p-4 border border-white/10 hover:bg-white/10 transition-all">
      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="text-white font-medium">{account.name}</div>
          <div className="text-white/50 text-xs">{account.institution}{account.chain ? ` · ${account.chain}` : ''}</div>
        </div>
        <span className={`text-xs font-mono ${changeColor}`}>{fmtPct(account.dailyChange)}</span>
      </div>
      <div className="text-xl font-bold text-white">{fmt(account.value)}</div>
      <div className="text-white/40 text-xs mt-1">{account.allocation.toFixed(1)}% of portfolio</div>
    </div>
  )
}

function RealEstateCard({ account }: { account: Account }) {
  const re = account.realEstate!
  const hasData = re.marketValue > 0
  const paidOff = re.originalBalance ? ((re.originalBalance - re.mortgageBalance) / re.originalBalance * 100) : 0
  return (
    <div className="bg-white/5 backdrop-blur-xl rounded-xl p-5 border border-white/10 hover:bg-white/10 transition-all sm:col-span-2 lg:col-span-3">
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="text-white font-medium text-lg">{account.name}</div>
          {re.address && <div className="text-white/50 text-xs">{re.address}</div>}
        </div>
        <div className="text-white/40 text-xs">{account.allocation.toFixed(1)}% of portfolio</div>
      </div>
      {hasData ? (
        <>
          {/* Top row: Value / Owed / Equity */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <div className="text-white/50 text-xs mb-1">Market Value</div>
              <div className="text-2xl font-bold text-white">{fmt(re.marketValue)}</div>
            </div>
            <div>
              <div className="text-white/50 text-xs mb-1">Mortgage Balance</div>
              <div className="text-2xl font-bold text-red-400">{fmt(re.mortgageBalance)}</div>
            </div>
            <div>
              <div className="text-white/50 text-xs mb-1">Equity</div>
              <div className="text-2xl font-bold text-green-400">{fmt(re.equity)}</div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mb-4">
            <div className="flex justify-between text-xs text-white/50 mb-1">
              <span>Mortgage Progress</span>
              <span>{paidOff.toFixed(1)}% paid off</span>
            </div>
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full transition-all" style={{ width: `${paidOff}%` }} />
            </div>
            <div className="flex justify-between text-xs text-white/30 mt-1">
              <span>Original: {fmt(re.originalBalance || 0)}</span>
              <span>Remaining: {fmt(re.mortgageBalance)}</span>
            </div>
          </div>

          {/* Mortgage details grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {re.interestRate != null && (
              <div className="bg-white/5 rounded-lg p-3">
                <div className="text-white/40 text-xs">Interest Rate</div>
                <div className="text-white font-semibold">{re.interestRate}%</div>
              </div>
            )}
            {re.escrowBalance != null && (
              <div className="bg-white/5 rounded-lg p-3">
                <div className="text-white/40 text-xs">Escrow Balance</div>
                <div className="text-white font-semibold">${re.escrowBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
              </div>
            )}
            {re.closingDate && (
              <div className="bg-white/5 rounded-lg p-3">
                <div className="text-white/40 text-xs">Closing Date</div>
                <div className="text-white font-semibold">{new Date(re.closingDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div>
              </div>
            )}
            {re.maturityDate && (
              <div className="bg-white/5 rounded-lg p-3">
                <div className="text-white/40 text-xs">Maturity Date</div>
                <div className="text-white font-semibold">{new Date(re.maturityDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div>
              </div>
            )}
          </div>

          {/* Monthly Payment breakdown */}
          {re.totalMonthlyPayment && (
            <div className="mt-4 bg-white/5 rounded-lg p-4">
              <div className="text-white/60 text-xs mb-2 font-medium">Monthly Payment — ${re.totalMonthlyPayment.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <div className="text-white/40 text-xs">Principal</div>
                  <div className="text-blue-400 font-medium">${re.monthlyPrincipal?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                </div>
                <div>
                  <div className="text-white/40 text-xs">Interest</div>
                  <div className="text-red-400 font-medium">${re.monthlyInterest?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                </div>
                <div>
                  <div className="text-white/40 text-xs">Escrow</div>
                  <div className="text-yellow-400 font-medium">${re.monthlyEscrow?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                </div>
                {re.extraPrincipal && re.extraPrincipal > 0 && (
                  <div>
                    <div className="text-white/40 text-xs">Extra Principal</div>
                    <div className="text-green-400 font-medium">+${re.extraPrincipal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-white/40 text-sm italic">Enter your home value and mortgage to see equity breakdown</div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: DataSource['status'] }) {
  const styles = {
    connected: 'bg-green-500/20 text-green-400',
    manual: 'bg-yellow-500/20 text-yellow-400',
    not_configured: 'bg-white/10 text-white/40',
  }
  const labels = { connected: 'Connected', manual: 'Manual', not_configured: 'Not Configured' }
  return <span className={`text-xs px-2 py-0.5 rounded-full ${styles[status]}`}>{labels[status]}</span>
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = key(item)
    ;(acc[k] ||= []).push(item)
    return acc
  }, {} as Record<string, T[]>)
}

// ─── Bitcoin Cold Storage ────────────────────────────────────────────────────

interface BtcAddressCfg {
  label: string
  address: string
}

interface BtcWalletRow extends BtcAddressCfg {
  btcBalance: number | null
  usdValue: number | null
  loading: boolean
  error: string | null
}

const PLACEHOLDER = 'YOUR_ADDRESS_HERE'
const SATS_PER_BTC = 1e8

function abbrevAddr(addr: string): string {
  if (addr === PLACEHOLDER) return '(not configured)'
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function fmtBtc(n: number): string {
  return n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '') + ' BTC'
}

function BitcoinWallets() {
  const addresses: BtcAddressCfg[] = btcAddressConfig
  const [btcPrice, setBtcPrice] = useState<number | null>(null)
  const [wallets, setWallets] = useState<BtcWalletRow[]>(
    addresses.map(a => ({ ...a, btcBalance: null, usdValue: null, loading: a.address !== PLACEHOLDER, error: a.address === PLACEHOLDER ? 'Add your address to btc-addresses.json' : null }))
  )
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const priceRef = useRef<number | null>(null)

  const fetchAll = useCallback(async () => {
    // Fetch BTC/USD price
    let price = priceRef.current
    try {
      const res = await fetch('https://mempool.space/api/v1/prices')
      const data = await res.json()
      price = data.USD
      priceRef.current = price
      setBtcPrice(price)
    } catch {
      // keep existing price if fetch fails
    }

    // Fetch balance for each configured address (skip placeholders)
    const updated: BtcWalletRow[] = await Promise.all(
      addresses.map(async (cfg) => {
        if (cfg.address === PLACEHOLDER) {
          return { ...cfg, btcBalance: null, usdValue: null, loading: false, error: 'Add your address to btc-addresses.json' }
        }
        try {
          const res = await fetch(`https://mempool.space/api/address/${cfg.address}`)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = await res.json()
          const sats: number = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum
          const btcBalance = sats / SATS_PER_BTC
          return {
            ...cfg,
            btcBalance,
            usdValue: price !== null ? btcBalance * price : null,
            loading: false,
            error: null,
          }
        } catch (e) {
          return { ...cfg, btcBalance: null, usdValue: null, loading: false, error: 'Fetch failed — check address or network' }
        }
      })
    )
    setWallets(updated)
    setLastUpdated(new Date())
  }, [addresses])

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 60_000)
    return () => clearInterval(interval)
  }, [fetchAll])

  const configuredWallets = wallets.filter(w => w.address !== PLACEHOLDER)
  const totalBtc = configuredWallets.reduce((s, w) => s + (w.btcBalance ?? 0), 0)
  const totalUsd = configuredWallets.reduce((s, w) => s + (w.usdValue ?? 0), 0)
  const anyLoaded = configuredWallets.some(w => w.btcBalance !== null)

  return (
    <div className="bg-orange-500/5 backdrop-blur-xl rounded-2xl border border-orange-500/20 p-5 mb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            🔐 Bitcoin Cold Storage
          </h2>
          {btcPrice !== null && (
            <span className="text-xs text-orange-300/60 font-mono">
              1 BTC = ${btcPrice.toLocaleString('en-US')}
            </span>
          )}
        </div>
        <button
          onClick={fetchAll}
          className="text-white/30 hover:text-white/70 text-sm transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
          title="Refresh blockchain data"
        >
          ↻
        </button>
      </div>

      {/* Address Rows */}
      <div className="space-y-2">
        {wallets.map((w, i) => (
          <div
            key={i}
            className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/8 transition-all"
          >
            <div className="min-w-0">
              <div className="text-white font-medium text-sm">{w.label}</div>
              <div className="text-white/35 text-xs font-mono mt-0.5">{abbrevAddr(w.address)}</div>
              {w.error && !w.loading && w.address !== PLACEHOLDER && (
                <div className="text-red-400/80 text-xs mt-1">⚠ {w.error}</div>
              )}
              {w.address === PLACEHOLDER && (
                <div className="text-yellow-500/70 text-xs mt-1">⚙ {w.error}</div>
              )}
            </div>
            <div className="text-right shrink-0 ml-4">
              {w.loading ? (
                <div className="text-white/25 text-sm animate-pulse">Fetching…</div>
              ) : w.address === PLACEHOLDER ? (
                <div className="text-white/20 text-sm">—</div>
              ) : w.error ? (
                <div className="text-red-400/60 text-sm">—</div>
              ) : (
                <>
                  <div className="text-white font-bold text-sm">{w.btcBalance !== null ? fmtBtc(w.btcBalance) : '—'}</div>
                  <div className="text-orange-400 text-xs mt-0.5">{w.usdValue !== null ? fmt(w.usdValue) : '—'}</div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Total row */}
      {anyLoaded && (
        <div className="mt-4 pt-4 border-t border-orange-500/15 flex justify-between items-center">
          <div>
            <div className="text-white/60 text-sm">Total Cold Storage</div>
            {lastUpdated && (
              <div className="text-white/20 text-xs mt-0.5">
                Updated {lastUpdated.toLocaleTimeString()} · auto-refresh 60s
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-white font-bold">{fmtBtc(totalBtc)}</div>
            <div className="text-orange-400 text-sm">{fmt(totalUsd)}</div>
          </div>
        </div>
      )}

      {/* No addresses configured yet */}
      {addresses.every(a => a.address === PLACEHOLDER) && (
        <div className="mt-4 pt-4 border-t border-orange-500/10 text-orange-300/40 text-xs">
          Edit <code className="font-mono">src/data/btc-addresses.json</code> to add your Ledger wallet addresses.
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Finances() {
  const [dataVersion, setDataVersion] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [coinbaseLoaded, setCoinbaseLoaded] = useState(false)

  // Load live data on mount
  useEffect(() => {
    Promise.all([loadCoinbaseData(), loadStrikeData()]).then(() => {
      setCoinbaseLoaded(true)
      setDataVersion(v => v + 1)
    })
  }, [])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([refreshCoinbaseData(), refreshStrikeData()])
    setDataVersion(v => v + 1)
    setRefreshing(false)
  }, [])

  const accounts = useMemo(() => getAccounts(), [dataVersion, coinbaseLoaded])
  const portfolio = useMemo(() => getPortfolio(), [dataVersion, coinbaseLoaded])
  const dataSources = useMemo(() => getDataSources(), [dataVersion, coinbaseLoaded])
  const [showStatus, setShowStatus] = useState(false)

  const grouped = groupBy(accounts, a => a.institution)

  const sectionIcons: Record<string, string> = {
    'Fidelity': '🏦', 'Robinhood': '🪶', 'E*Trade': '📈',
    'Ledger': '🔐', 'Phantom': '👻', 'MetaMask': '🦊', 'Coinbase': '🪙',
    'Fold': '⚡', 'Strike': '⚡', 'Masterworks': '🎨', 'Fellow Products': '☕', 'Real Estate': '🏠',
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white p-6 overflow-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-3xl font-bold">💰 Financial Overview</h1>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-all text-sm disabled:opacity-50"
          >
            {refreshing ? '⟳ Refreshing…' : '🔄 Refresh Live Data'}
          </button>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="text-5xl font-bold bg-gradient-to-r from-green-400 to-emerald-300 bg-clip-text text-transparent">
            {fmt(portfolio.totalNetWorth)}
          </span>
          <span className={`text-lg font-mono ${portfolio.totalDailyChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {fmtPct(portfolio.totalDailyChange)} today
          </span>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <SummaryCard label="Net Worth" value={portfolio.totalNetWorth} icon="💎" color="blue-500" />
        <SummaryCard label="Traditional" value={portfolio.traditionalInvestments} icon="🏛️" color="purple-500" />
        <SummaryCard label="Crypto" value={portfolio.cryptoHoldings} icon="₿" color="orange-500" />
        <SummaryCard label="Alternatives" value={portfolio.alternativeInvestments} icon="🎨" color="pink-500" />
        <SummaryCard label="Real Estate" value={portfolio.realEstate} icon="🏠" color="emerald-500" />
      </div>

      {/* Bitcoin Cold Storage */}
      <BitcoinWallets />

      {/* Account Sections */}
      <div className="space-y-6 mb-8">
        {Object.entries(grouped).map(([institution, accts]) => (
          <div key={institution}>
            <h2 className="text-lg font-semibold text-white/80 mb-3 flex items-center gap-2">
              {sectionIcons[institution] || '📊'} {institution}
              <span className="text-white/30 text-sm font-normal">
                {fmt(accts.reduce((s, a) => s + a.value, 0))}
              </span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {accts.map(a => <AccountCard key={a.id} account={a} />)}
            </div>
          </div>
        ))}
      </div>

      {/* Data Status Panel */}
      <div>
        <button
          onClick={() => setShowStatus(!showStatus)}
          className="text-white/50 hover:text-white/80 text-sm mb-3 flex items-center gap-1 transition-colors"
        >
          📡 Data Sources {showStatus ? '▾' : '▸'}
        </button>
        {showStatus && (
          <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {dataSources.map(ds => (
                <div key={ds.id} className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                  <div>
                    <div className="text-white text-sm font-medium">{ds.name}</div>
                    <div className="text-white/30 text-xs">
                      {ds.lastSync ? `Synced ${new Date(ds.lastSync).toLocaleDateString()}` : 'Never synced'}
                    </div>
                  </div>
                  <StatusBadge status={ds.status} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
