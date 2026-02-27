import { invoke } from '@tauri-apps/api/core'

export interface FidelityPosition {
  symbol: string
  description: string
  quantity: number
  lastPrice: number
  currentValue: number
  totalGainLoss: number
  avgCostBasis: number
  isCash: boolean
}

export interface FidelityAccount {
  accountName: string
  accountNumber: string
  positions: FidelityPosition[]
  totalValue: number
  cashBalance: number
}

export async function loadFidelityAccounts(): Promise<FidelityAccount[]> {
  const json = await invoke<string>('read_fidelity_csv')
  const raw = JSON.parse(json)
  return raw.map((acct: any) => {
    const cashBalance = acct.positions
      .filter((p: any) => p.isCash)
      .reduce((s: number, p: any) => s + p.currentValue, 0)
    const totalValue = acct.positions.reduce((s: number, p: any) => s + p.currentValue, 0)
    return { ...acct, cashBalance, totalValue }
  })
}
