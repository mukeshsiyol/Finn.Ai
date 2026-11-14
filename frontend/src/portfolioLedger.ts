export type TransactionKind = 'buy' | 'sell' | 'dividend' | 'deposit' | 'withdrawal' | 'split' | 'bonus'
export type PortfolioTransaction = {
  id: string
  date: string
  kind: TransactionKind
  ticker?: string
  quantity?: number
  price?: number
  fees?: number
  amount?: number
  ratio?: number
  note?: string
  demo?: boolean
  auto?: boolean
  origin?: 'migrated_opening'
  record_date?: string
  record_quantity?: number
}

export type LedgerPosition = { shares: number; average_cost: number; demo: boolean }
export type RealizedEvent = PortfolioTransaction & { realized_pnl: number }
export type AccountHistoryPoint = { date: string; value: number; return_index: number; daily_return: number; external_flow: number }
export type WatchlistAlertCondition = { mode?: 'price'|'percent'; direction: 'above'|'below'|'up'|'down'|'either'; price?: number; percent?: number }
const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export function evaluateWatchlistAlert(alert: WatchlistAlertCondition, currentPrice: number, previousPrice?: number, dailyMovePct?: number|null): boolean {
  if (alert.mode === 'percent') {
    if (!Number.isFinite(dailyMovePct) || !alert.percent || alert.percent <= 0) return false
    if (alert.direction === 'up') return (dailyMovePct as number) >= alert.percent
    if (alert.direction === 'down') return (dailyMovePct as number) <= -alert.percent
    return Math.abs(dailyMovePct as number) >= alert.percent
  }
  if (!Number.isFinite(previousPrice) || !Number.isFinite(currentPrice) || !Number.isFinite(alert.price) || (alert.price as number) <= 0) return false
  return alert.direction === 'below'
    ? (previousPrice as number) > (alert.price as number) && currentPrice <= (alert.price as number)
    : (previousPrice as number) < (alert.price as number) && currentPrice >= (alert.price as number)
}

export function deriveLedger(transactions: PortfolioTransaction[]) {
  const positions: Record<string, LedgerPosition> = {}
  const realized: RealizedEvent[] = []
  let cash = 0
  let dividends = 0
  let contributions = 0

  const ordered = transactions.map((transaction, index) => ({ transaction, index }))
    .sort((a, b) => a.transaction.date.localeCompare(b.transaction.date) || a.index - b.index)
    .map(item => item.transaction)

  for (const item of ordered) {
    const ticker = item.ticker?.toUpperCase()
    if (item.kind === 'deposit') {
      cash += item.amount ?? 0
      contributions += item.amount ?? 0
    } else if (item.kind === 'withdrawal') {
      cash -= item.amount ?? 0
      contributions -= item.amount ?? 0
    } else if (item.kind === 'dividend') {
      cash += item.amount ?? 0
      dividends += item.amount ?? 0
    } else if (item.kind === 'buy' && ticker) {
      const old = positions[ticker] ?? { shares: 0, average_cost: 0, demo: Boolean(item.demo) }
      const quantity = item.quantity ?? 0
      const totalCost = quantity * (item.price ?? 0) + (item.fees ?? 0)
      const shares = old.shares + quantity
      positions[ticker] = { shares, average_cost: shares ? (old.shares * old.average_cost + totalCost) / shares : 0, demo: old.shares > 0 ? old.demo && Boolean(item.demo) : Boolean(item.demo) }
      cash -= totalCost
    } else if (item.kind === 'sell' && ticker) {
      const old = positions[ticker]
      const quantity = item.quantity ?? 0
      if (!old || quantity <= 0) continue
      const proceeds = quantity * (item.price ?? 0) - (item.fees ?? 0)
      const pnl = proceeds - quantity * old.average_cost
      realized.push({ ...item, realized_pnl: pnl })
      cash += proceeds
      const remaining = Math.max(0, old.shares - quantity)
      if (remaining <= 1e-8) delete positions[ticker]
      else positions[ticker] = { ...old, shares: remaining }
    } else if ((item.kind === 'split' || item.kind === 'bonus') && ticker) {
      const old = positions[ticker]
      if (!old || !item.ratio || item.ratio <= 0) continue
      const multiplier = item.kind === 'split' ? item.ratio : 1 + item.ratio
      positions[ticker] = { ...old, shares: old.shares * multiplier, average_cost: old.average_cost / multiplier }
    }
  }
  const investedCost = Object.values(positions).reduce((total, position) => total + position.shares * position.average_cost, 0)
  return { positions, cash, dividends, contributions, realized, realizedPnl: realized.reduce((sum, item) => sum + item.realized_pnl, 0), investedCost }
}

export function positionAtDate(transactions: PortfolioTransaction[], ticker: string, date: string): LedgerPosition | undefined {
  return deriveLedger(transactions.filter(item => item.date <= date)).positions[ticker.toUpperCase()]
}

export function buildAccountHistory(transactions: PortfolioTransaction[], histories: Record<string,{date:string;close:number}[]>): AccountHistoryPoint[] {
  const normalizedHistories=Object.fromEntries(Object.entries(histories).map(([ticker,rows])=>[ticker,rows.slice().sort((a,b)=>a.date.localeCompare(b.date))]))
  const allDates = [...new Set(Object.values(normalizedHistories).flatMap(rows => rows.map(row => row.date)))].sort()
  const ordered = transactions.map((transaction,index)=>({transaction,index})).sort((a,b)=>a.transaction.date.localeCompare(b.transaction.date)||a.index-b.index).map(item=>item.transaction)
  if (!allDates.length||!ordered.length) return []
  const dates = allDates.filter(date=>date>=ordered[0].date)
  const positions: Record<string,{shares:number}> = {}
  let cash = 0
  let cursor = 0
  let indexValue = 100
  let previousValue: number|null = null
  const priceIndexes:Record<string,number>={}
  const result: AccountHistoryPoint[] = []
  for (const date of dates) {
    let externalFlow = 0
    while (cursor < ordered.length && ordered[cursor].date <= date) {
      const item = ordered[cursor++]
      const ticker = item.ticker?.toUpperCase()
      if (item.kind === 'deposit') { cash += item.amount ?? 0; if (item.date === date) externalFlow += item.amount ?? 0 }
      else if (item.kind === 'withdrawal') { cash -= item.amount ?? 0; if (item.date === date) externalFlow -= item.amount ?? 0 }
      else if (item.kind === 'dividend') cash += item.amount ?? 0
      else if (item.kind === 'buy' && ticker) { positions[ticker] = { shares: (positions[ticker]?.shares ?? 0) + (item.quantity ?? 0) }; cash -= (item.quantity ?? 0) * (item.price ?? 0) + (item.fees ?? 0) }
      else if (item.kind === 'sell' && ticker) { positions[ticker] = { shares: Math.max(0,(positions[ticker]?.shares ?? 0) - (item.quantity ?? 0)) }; cash += (item.quantity ?? 0) * (item.price ?? 0) - (item.fees ?? 0) }
      else if ((item.kind === 'split' || item.kind === 'bonus') && ticker && positions[ticker]) positions[ticker].shares *= item.kind === 'split' ? (item.ratio ?? 1) : 1 + (item.ratio ?? 0)
    }
    let value = cash
    let coverageComplete = true
    for (const [ticker, position] of Object.entries(positions)) {
      if (position.shares <= 1e-8) continue
      const rows=normalizedHistories[ticker]??[]
      let pointIndex=priceIndexes[ticker]??-1
      while(pointIndex+1<rows.length&&rows[pointIndex+1].date<=date)pointIndex++
      priceIndexes[ticker]=pointIndex
      const point=pointIndex>=0?rows[pointIndex]:undefined
      if (!point || (new Date(date).getTime() - new Date(point.date).getTime()) / 86400000 > 5) { coverageComplete = false; break }
      value += point.close * position.shares
    }
    if (!coverageComplete || !Number.isFinite(value)) continue
    let dailyReturn = 0
    if (previousValue !== null && previousValue > 0) {
      dailyReturn = (value - externalFlow - previousValue) / previousValue
      indexValue *= Math.max(0, 1 + dailyReturn)
    }
    result.push({ date, value, return_index: indexValue, daily_return: dailyReturn, external_flow: externalFlow })
    previousValue = value
  }
  return result
}

export function loadPortfolioTransactions(): PortfolioTransaction[] {
  try {
    const existing = localStorage.getItem('finn-transactions-v1')
    if (existing !== null) return JSON.parse(existing) as PortfolioTransaction[]
    const oldHoldings = JSON.parse(localStorage.getItem('finn-holdings-v1') || '{}') as Record<string, LedgerPosition>
    const positions = Object.entries(oldHoldings).filter(([, position]) => position.shares > 0 && position.average_cost > 0)
    if (!positions.length) return []
    const date = new Date().toLocaleDateString('en-CA')
    const total = positions.reduce((sum, [, position]) => sum + position.shares * position.average_cost, 0)
    const migrated: PortfolioTransaction[] = [{ id: makeId(), date, kind: 'deposit', amount: total, note: 'Estimated opening basis migrated from saved holdings; not an actual cash transfer', origin: 'migrated_opening' }]
    for (const [ticker, position] of positions) migrated.push({ id: makeId(), date, kind: 'buy', ticker, quantity: position.shares, price: position.average_cost, note: 'Estimated opening position migrated from saved average cost; not a dated purchase', demo: position.demo, origin: 'migrated_opening' })
    return migrated
  } catch { return [] }
}
