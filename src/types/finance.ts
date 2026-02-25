export interface Account {
  id: string
  name: string
  institution: string
  type: 'brokerage' | '401k' | 'ira' | 'crypto_wallet' | 'crypto_exchange' | 'alternative' | 'debit' | 'real_estate'
  value: number
  dailyChange: number // percentage
  allocation: number // percentage of total
  chain?: string // for crypto
  holdings?: Holding[]
  realEstate?: RealEstateDetails // for property accounts
  lastUpdated: string
}

export interface RealEstateDetails {
  marketValue: number
  mortgageBalance: number
  equity: number // marketValue - mortgageBalance
  address?: string
  // Mortgage details
  originalBalance?: number
  interestRate?: number // annual %
  closingDate?: string
  maturityDate?: string
  escrowBalance?: number
  // Monthly payment breakdown
  monthlyPrincipal?: number
  monthlyInterest?: number
  monthlyEscrow?: number
  extraPrincipal?: number // additional principal payment per month
  totalMonthlyPayment?: number
}

export interface Holding {
  symbol: string
  name: string
  quantity: number
  price: number
  value: number
  dailyChange: number
}

export interface CryptoWallet {
  id: string
  name: string
  type: 'hardware' | 'software' | 'exchange'
  chain: string
  address?: string
  balance: number
  value: number
}

export interface Transaction {
  id: string
  accountId: string
  date: string
  type: 'buy' | 'sell' | 'transfer' | 'dividend' | 'interest'
  symbol?: string
  amount: number
  description: string
}

export interface PortfolioSummary {
  totalNetWorth: number
  totalDailyChange: number
  traditionalInvestments: number
  cryptoHoldings: number
  alternativeInvestments: number
  realEstate: number
  lastUpdated: string
}

export interface DataSource {
  id: string
  name: string
  status: 'connected' | 'manual' | 'not_configured'
  lastSync: string | null
  accountCount: number
}
