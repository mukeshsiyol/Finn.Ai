import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Bell, BriefcaseBusiness, FileText, LayoutDashboard, RefreshCw, Search, ShieldCheck, Sparkles, Target, TrendingDown, TrendingUp, Upload, Trash2, RotateCw } from 'lucide-react'

type Company = { name: string; ticker: string; sector: string; market_status: 'available' | 'unavailable'; reason?: string; session_date?: string; currency?: string; price?: number; previous_close?: number | null; change_pct?: number | null; volume?: number | null; average_volume_20d?: number | null; volume_ratio_20d?: number | null; unusual_volume?: boolean; unusual_price?: boolean }
type Portfolio = { source: string; retrieved_at: string; last_successful_update?: string | null; notice: string; companies: Company[]; available_count: number; alert_count: number; alerts: (Company & { alert_types?: string[] })[]; settings: { volume_multiple: number; price_move_pct: number } }
type Announcement = { id: string; company: string; ticker: string; subject: string; details: string; filed_at: string; source_url: string; source_name?: string; exchange?: string; category: string; importance: number; priority: string; rule_explanation: string; is_verified_example?: boolean }
type AlertHistoryItem = { id: string; kind: 'filing' | 'market'; ticker: string; company: string; subject?: string; details?: string; filed_at?: string; event_at: string; session_date?: string; source_url: string; source_name?: string; exchange?: string; category: string; signal_type?: string; importance: number; priority: string; rule_explanation?: string; change_pct?: number | null; price_threshold_pct?: number | null; previous_close?: number | null; volume_ratio_20d?: number | null; volume_threshold?: number | null; volume?: number | null; average_volume_20d?: number | null; price?: number | null; is_verified_example?: boolean; is_read: boolean }
type AlertView = 'all' | 'filings' | 'price' | 'volume'
type FilingFilter = 'all' | 'results' | 'corporate' | 'shareholding' | 'dividend' | 'board' | 'mergers'
type ResearchSource = { id: string; document_id?: string; source_url?: string; filename: string; document_type: string; reporting_period: string; page: number; excerpt: string }
type ResearchDocument = { id: string; company: string; ticker: string; filename: string; document_type: string; reporting_period: string; pages: number; source_url?: string; superseded_by?: string }
type ResearchEvidenceQuality = { coverage: 'limited'|'moderate'|'broad'; confidence: 'low'|'moderate'; source_pages: number; documents: number; document_types: number; note: string }
type Holding = { shares: number; average_cost: number; demo?: boolean }
type PricePoint = { date: string; close: number }
type PriceHistory = Record<string, PricePoint[]>
type PerformanceRange = '1D' | '1W' | '1M' | '3M' | '1Y'
const pointCounts: Record<PerformanceRange, number> = { '1D': 2, '1W': 6, '1M': 22, '3M': 64, '1Y': 253 }
const minHistoryPoints: Record<PerformanceRange, number> = { '1D': 2, '1W': 6, '1M': 18, '3M': 52, '1Y': 240 }
type FinancialChange = { period: string; value: number | null; unit: string | null; change_pct: number | null; delta_type?: 'percentage_points'; status: 'available' | 'negative_base' | 'negative_revenue' | 'zero_base' | 'missing_data' | 'unit_mismatch' | 'non_positive_base' }
type FinancialEvidence = { document_id?: string; filename: string; page: number; excerpt?: string; source_url?: string; adjustment_note?: string; supporting_sources?: FinancialEvidence[] }
type FinancialComparison = { period: string; metrics: Record<string, { value: number; unit: string; calculated?: boolean; source: FinancialEvidence; qoq: FinancialChange; yoy: FinancialChange }> }
type PromiseComparison = { id: string; metric: string; target_period: string; target_value: number; unit: string; quote: string; revision?: number; is_current_guidance?: boolean; statement_basis?: string; figure_type?: string; adjustment_note?: string; source: { document_id?: string; filename: string; page: number; source_url?: string }; actual_value: number | null; actual_unit: string | null; deviation: number | null; status: string; actual_sources: { document_id?: string; filename: string; page: number; excerpt: string; source_url?: string }[] }
type PromiseTrackRecord = { completed_count: number; achieved_count: number; missed_count: number; achievement_rate_pct: number | null; mean_absolute_deviation_pct: number | null; minimum_sample: number; note: string }

const API = import.meta.env.VITE_API_BASE_URL ?? ''
const citationHref = (source: { document_id?: string; source_url?: string; page: number }) => source.document_id ? `${API}/api/research/documents/${encodeURIComponent(source.document_id)}/file#page=${source.page}` : source.source_url ? `${source.source_url}#page=${source.page}` : ''
const nav = [
  { label: 'Home', icon: LayoutDashboard, target: 'home' },
  { label: 'Alerts', icon: Bell, target: 'alerts' },
  { label: 'Research', icon: Search, target: 'research' },
  { label: 'Portfolio', icon: BriefcaseBusiness, target: 'portfolio' },
]
const pageFromUrl = () => {
  const target = window.location.hash.replace(/^#\/?/, '').split(/[/?#]/)[0]
  return nav.find(item => item.target === target)?.label ?? 'Home'
}
const labelCategory = (value: string) => value.replaceAll('_', ' ').replace('m&a', 'M&A')
const money = (value: number | null | undefined) => value === null || value === undefined || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
const changeValue = (change: FinancialChange) => ['available','negative_base'].includes(change.status) && change.change_pct !== null ? `${change.change_pct > 0 ? '+' : ''}${change.change_pct.toFixed(2)}${change.delta_type==='percentage_points'?' pp':'%'}` : ({ missing_data: 'Data missing', unit_mismatch: 'Unit mismatch', zero_base: 'Undefined · zero base', negative_revenue: 'Not comparable', non_positive_base: 'Not comparable', negative_base: 'Not calculated', available: 'Not calculated' }[change.status])
const changeNote = (change: FinancialChange, currentUnit: string) => change.status === 'missing_data' ? `${change.period} has not been entered` : change.status === 'unit_mismatch' ? `${change.period} · ${change.unit ?? 'unknown unit'} vs ${currentUnit}` : change.status === 'zero_base' ? `${change.period} · percentage undefined for zero base` : change.status === 'negative_base' ? `${change.period} · change relative to absolute prior value` : change.status === 'negative_revenue' ? `${change.period} · margin is not comparable against negative revenue` : change.period
const promiseStatusLabel = (status: string) => ({ met: 'achieved', above_guidance: 'exceeded guidance', below_guidance: 'missed guidance', awaiting_actual: 'pending actual', unit_mismatch: 'unit mismatch' }[status] ?? status.replaceAll('_',' '))

function App() {
  const [active, setActive] = useState(pageFromUrl)
  const [alertsTab, setAlertsTab] = useState<AlertView>('all')
  const [filingFilter, setFilingFilter] = useState<FilingFilter>('all')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [researchTab, setResearchTab] = useState<'ask' | 'financials' | 'commitments' | 'analysis'>('ask')
  const [portfolioTab, setPortfolioTab] = useState<'holdings' | 'watchlist'>('holdings')
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [priceHistory, setPriceHistory] = useState<PriceHistory>({})
  const [historyLoading, setHistoryLoading] = useState(false)
  const [performanceRange, setPerformanceRange] = useState<PerformanceRange>('1M')
  const [historyCoverageOpen, setHistoryCoverageOpen] = useState(false)
  const [marketError, setMarketError] = useState('')
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [alertHistory, setAlertHistory] = useState<AlertHistoryItem[]>([])
  const [alertHistoryLoading, setAlertHistoryLoading] = useState(false)
  const [alertHistoryError, setAlertHistoryError] = useState('')
  const [announcementError, setAnnouncementError] = useState('')
  const [announcementUpdatedAt, setAnnouncementUpdatedAt] = useState('')
  const [announcementWindow, setAnnouncementWindow] = useState(24)
  const [explanations, setExplanations] = useState<Record<string, string>>({})
  const [explanationModes, setExplanationModes] = useState<Record<string, string>>({})
  const [explaining, setExplaining] = useState('')
  const [settings, setSettings] = useState({ volume_multiple: 1.3, price_move_pct: 4 })
  const [settingsMessage, setSettingsMessage] = useState('')
  const [documents, setDocuments] = useState<ResearchDocument[]>([])
  const [aiEnabled, setAiEnabled] = useState(false)
  const [aiProvider, setAiProvider] = useState('Local retrieval')
  const [documentId, setDocumentId] = useState('')
  const [researchQuestion, setResearchQuestion] = useState('')
  const [researchAnswer, setResearchAnswer] = useState('')
  const [researchMode, setResearchMode] = useState('')
  const [researchSources, setResearchSources] = useState<ResearchSource[]>([])
  const [researchBusy, setResearchBusy] = useState(false)
  const [researchMessage, setResearchMessage] = useState('')
  const [researchFilename, setResearchFilename] = useState('')
  const [documentSearch, setDocumentSearch] = useState('')
  const [documentTypeFilter, setDocumentTypeFilter] = useState('all')
  const [replaceTargetId, setReplaceTargetId] = useState('')
  const [documentActionMessage, setDocumentActionMessage] = useState('')
  const replaceInput = useRef<HTMLInputElement>(null)
  const [statementBasis, setStatementBasis] = useState<'consolidated'|'standalone'>('consolidated')
  const [figureType, setFigureType] = useState<'reported'|'adjusted'>('reported')
  const [adjustmentNote, setAdjustmentNote] = useState('')
  const [financialChartMetric, setFinancialChartMetric] = useState('revenue')
  const [financialChartRange, setFinancialChartRange] = useState<4|8>(8)
  const [financialPeriods, setFinancialPeriods] = useState<FinancialComparison[]>([])
  const [financialMessage, setFinancialMessage] = useState('')
  const [promiseRows, setPromiseRows] = useState<PromiseComparison[]>([])
  const [promiseTrackRecord, setPromiseTrackRecord] = useState<PromiseTrackRecord | null>(null)
  const [promiseMessage, setPromiseMessage] = useState('')
  const [bullBear, setBullBear] = useState<{ mode: string; answer: string; sources: ResearchSource[]; evidence_quality?: ResearchEvidenceQuality } | null>(null)
  const [bullBearBusy, setBullBearBusy] = useState(false)
  const [holdings, setHoldings] = useState<Record<string, Holding>>(() => {
    try {
      const saved = localStorage.getItem('finn-holdings-v1')
      return saved ? JSON.parse(saved) as Record<string, Holding> : {}
    } catch { return {} }
  })
  const [holdingEditor, setHoldingEditor] = useState<Company | null>(null)
  const [holdingShares, setHoldingShares] = useState('')
  const [holdingAverageCost, setHoldingAverageCost] = useState('')
  const [holdingIsDemo, setHoldingIsDemo] = useState(false)
  const [holdingError, setHoldingError] = useState('')
  const [pendingRemoval, setPendingRemoval] = useState<Company | null>(null)

  useEffect(() => {
    localStorage.setItem('finn-holdings-v1', JSON.stringify(holdings))
  }, [holdings])

  useEffect(() => {
    if (!holdingEditor && !pendingRemoval) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHoldingEditor(null)
        setPendingRemoval(null)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [holdingEditor, pendingRemoval])

  async function loadPortfolio(force = false) {
    setMarketError('')
    if (!portfolio) setLoading(true)
    else setRefreshing(true)
    try {
      const response = await fetch(`${API}/api/portfolio${force ? '?refresh=true' : ''}`)
      if (!response.ok) throw new Error(`Portfolio service returned ${response.status}.`)
      const result: Portfolio = await response.json()
      if (!Array.isArray(result.companies) || !Array.isArray(result.alerts)) throw new Error('Portfolio service returned an incomplete response. Restart the backend to load the current API.')
      setPortfolio(result)
      if (result.settings) setSettings(result.settings)
      void loadAlertHistory(announcementWindow)
    } catch {
      setMarketError('FINN could not reach the market data service. Check that the backend is running, then try again.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  async function loadAnnouncements(windowHours = announcementWindow) {
    setAnnouncementError('')
    try {
      const response = await fetch(`${API}/api/announcements?window_hours=${windowHours}`)
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || 'The NSE announcement feed is unavailable.')
      setAnnouncements(payload.items)
      setAnnouncementUpdatedAt(payload.last_successful_update ?? '')
      void loadAlertHistory(windowHours)
    } catch (error) {
      setAnnouncementError(error instanceof Error ? error.message : 'NSE announcement feed unavailable.')
      setAnnouncementUpdatedAt('')
      setAnnouncements([])
      void loadAlertHistory(windowHours)
    }
  }

  async function loadAlertHistory(windowHours = 720) {
    setAlertHistoryError('')
    setAlertHistoryLoading(true)
    try {
      const response = await fetch(`${API}/api/alerts/history?window_hours=${windowHours}`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || 'Alert history is unavailable.')
      setAlertHistory(Array.isArray(payload.alerts) ? payload.alerts : [])
    } catch (error) {
      setAlertHistoryError(error instanceof Error ? error.message : 'Alert history is unavailable.')
    } finally { setAlertHistoryLoading(false) }
  }

  async function setAlertRead(item: AlertHistoryItem, isRead: boolean) {
    try {
      const response = await fetch(`${API}/api/alerts/read`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: item.id, is_read: isRead }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || 'Could not update this alert.')
      setAlertHistory(current => current.map(alert => alert.id === item.id ? { ...alert, is_read: isRead } : alert))
    } catch (error) {
      setAlertHistoryError(error instanceof Error ? error.message : 'Could not update this alert.')
    }
  }

  async function loadDocuments(preferredId = ''): Promise<ResearchDocument[]> {
    const response = await fetch(`${API}/api/research/documents`)
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.detail || 'Could not load indexed research documents. Check the backend and retry.')
    const loaded: ResearchDocument[] = Array.isArray(payload.documents) ? payload.documents : []
    setDocuments(loaded)
    setAiEnabled(Boolean(payload.ai_enabled))
    setAiProvider(payload.ai_provider ?? 'Local retrieval')
    const activeDocuments = loaded.filter(doc => !doc.superseded_by)
    setDocumentId(current => preferredId && loaded.some(doc => doc.id === preferredId) ? preferredId : current && loaded.some(doc => doc.id === current) ? current : activeDocuments[0]?.id ?? loaded[0]?.id ?? '')
    return loaded
  }

  useEffect(() => {
    void loadPortfolio()
    void loadAnnouncements(24)
    void loadAlertHistory(24)
    void loadDocuments().catch(error => setResearchMessage(error instanceof Error ? error.message : 'Research service is unavailable.'))
    fetch(`${API}/api/settings/alerts`).then(response => response.ok ? response.json() : null).then(value => value && setSettings(value)).catch(() => undefined)
  }, [])

  useEffect(() => {
    const syncPageFromUrl = () => {
      setActive(pageFromUrl())
      window.scrollTo({ top: 0, behavior: 'auto' })
    }
    window.addEventListener('popstate', syncPageFromUrl)
    window.addEventListener('hashchange', syncPageFromUrl)
    return () => {
      window.removeEventListener('popstate', syncPageFromUrl)
      window.removeEventListener('hashchange', syncPageFromUrl)
    }
  }, [])

  const filteredCompanies = useMemo(() => {
    const list = portfolio?.companies ?? []
    const search = query.trim().toLowerCase()
    if (!search) return list
    return list.filter(company => `${company.name} ${company.ticker} ${company.sector}`.toLowerCase().includes(search))
  }, [portfolio, query])
  const visibleAlertHistory = useMemo(() => alertHistory.filter(item => {
    if (unreadOnly && item.is_read) return false
    if (alertsTab === 'filings' && item.kind !== 'filing') return false
    if (alertsTab === 'price' && item.signal_type !== 'price_movement') return false
    if (alertsTab === 'volume' && item.signal_type !== 'volume_spike') return false
    if (alertsTab !== 'all' && alertsTab !== 'filings' && item.kind !== 'market') return false
    if (filingFilter !== 'all' && item.kind !== 'filing') return false
    if (filingFilter === 'all' || item.kind !== 'filing') return true
    const category = item.category
    if (filingFilter === 'results') return category === 'results'
    if (filingFilter === 'shareholding') return ['shareholding_change','pledging','insider_trading'].includes(category)
    if (filingFilter === 'dividend') return category === 'dividend'
    if (filingFilter === 'board') return category === 'board_meeting'
    if (filingFilter === 'mergers') return category === 'm&a'
    return !['results','shareholding_change','pledging','insider_trading','dividend','board_meeting','m&a'].includes(category)
  }).sort((a,b)=>{
    const priorityRank = { high: 0, medium: 1, routine: 2 }
    const priorityOrder = (priorityRank[a.priority as keyof typeof priorityRank] ?? 3) - (priorityRank[b.priority as keyof typeof priorityRank] ?? 3)
    return priorityOrder || Date.parse(b.event_at) - Date.parse(a.event_at)
  }), [alertHistory, unreadOnly, alertsTab, filingFilter])
  const selectedDocument = documents.find(doc => doc.id === documentId)
  const visibleDocuments = useMemo(() => {
    const term = documentSearch.trim().toLowerCase()
    return documents.filter(doc => (documentTypeFilter === 'all' || doc.document_type === documentTypeFilter) && (!term || `${doc.company} ${doc.ticker} ${doc.filename} ${doc.reporting_period}`.toLowerCase().includes(term)))
  }, [documents, documentSearch, documentTypeFilter])
  const chartRows = useMemo(() => financialPeriods.slice(0, financialChartRange).slice().reverse().map(period => ({ period: period.period, value: period.metrics[financialChartMetric]?.value ?? null, unit: period.metrics[financialChartMetric]?.unit ?? '' })).filter(row => row.value !== null), [financialPeriods, financialChartRange, financialChartMetric])
  const financialChartGeometry = useMemo(() => {
    const values = chartRows.map(row => row.value as number)
    if (values.length < 2) return null
    const min = Math.min(0, ...values)
    const max = Math.max(0, ...values)
    const span = max - min || 1
    const points = values.map((value, index) => `${24 + index * 552 / (values.length - 1)},${166 - (value - min) * 132 / span}`)
    return { points: points.join(' '), min, max, zeroY: 166 - (0 - min) * 132 / span }
  }, [chartRows])

  useEffect(() => {
    if (!selectedDocument) {
      setFinancialPeriods([])
      setPromiseRows([])
      setPromiseTrackRecord(null)
      return
    }
    const ticker = encodeURIComponent(selectedDocument.ticker)
    fetch(`${API}/api/research/financials?ticker=${ticker}&statement_basis=${statementBasis}&figure_type=${figureType}&adjustment_note=${encodeURIComponent(adjustmentNote)}`).then(response => response.ok ? response.json() : null).then(payload => setFinancialPeriods(payload?.periods ?? [])).catch(() => setFinancialPeriods([]))
    fetch(`${API}/api/research/promises?ticker=${ticker}`).then(response => response.ok ? response.json() : null).then(payload => { setPromiseRows(payload?.promises ?? []); setPromiseTrackRecord(payload?.track_record ?? null) }).catch(() => { setPromiseRows([]); setPromiseTrackRecord(null) })
  }, [selectedDocument?.ticker, documentId, statementBasis, figureType, adjustmentNote])
  const heldCompanies = useMemo(() => (portfolio?.companies ?? []).filter(company => (holdings[company.ticker]?.shares ?? 0) > 0), [portfolio, holdings])
  const heldTickerKey = useMemo(() => heldCompanies.map(company => company.ticker).sort().join(','), [heldCompanies])
  useEffect(() => {
    if (!heldTickerKey) {
      setPriceHistory({})
      setHistoryLoading(false)
      return
    }
    const controller = new AbortController()
    setHistoryLoading(true)
    const tickers = encodeURIComponent(heldTickerKey)
    fetch(`${API}/api/portfolio/history?tickers=${tickers}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Historical prices unavailable.')))
      .then(payload => setPriceHistory(payload?.histories ?? {}))
      .catch(error => { if (error.name !== 'AbortError') setPriceHistory({}) })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false) })
    return () => controller.abort()
  }, [heldTickerKey])
  const pricedHoldings = heldCompanies.filter(company => company.market_status === 'available' && Number.isFinite(company.price))
  const dailyPricedHoldings = pricedHoldings.filter(company => Number.isFinite(company.previous_close))
  const investedCapital = heldCompanies.reduce((sum, company) => sum + holdings[company.ticker].shares * holdings[company.ticker].average_cost, 0)
  const pricedInvestedCapital = pricedHoldings.reduce((sum, company) => sum + holdings[company.ticker].shares * holdings[company.ticker].average_cost, 0)
  const marketValue = pricedHoldings.reduce((sum, company) => sum + holdings[company.ticker].shares * (company.price ?? 0), 0)
  const unrealizedPnl = pricedHoldings.reduce((sum, company) => sum + holdings[company.ticker].shares * ((company.price ?? 0) - holdings[company.ticker].average_cost), 0)
  const todayPnl = dailyPricedHoldings.reduce((sum, company) => {
    if (company.previous_close === null || company.previous_close === undefined || company.price === undefined) return sum
    return sum + holdings[company.ticker].shares * (company.price - company.previous_close)
  }, 0)
  const performance = useMemo(() => {
    const histories = heldCompanies.map(company => {
      const rawRows = priceHistory[company.ticker] ?? []
      const lastAdjusted = rawRows.at(-1)?.close
      const scale = company.market_status === 'available' && company.price && lastAdjusted ? company.price / lastAdjusted : 1
      return { company, rows: rawRows.map(row => ({...row, close: row.close * scale})), currentPriceAvailable: company.market_status === 'available' && Number.isFinite(company.price) }
    })
      .filter(item => item.currentPriceAvailable)
      .filter(item => item.rows.length >= minHistoryPoints[performanceRange])
    const allDates = [...new Set(histories.flatMap(item => item.rows.map(row => row.date)))].sort()
    const dates = allDates.slice(-pointCounts[performanceRange])
    const values = dates.map(date => {
      const amount = histories.reduce((total, { company, rows }) => {
        const point = [...rows].reverse().find(row => row.date <= date)
        return total + (point ? point.close * holdings[company.ticker].shares : 0)
      }, 0)
      return { date, value: amount }
    }).filter(point => point.value > 0)
    const first = values[0]?.value
    const last = values[values.length - 1]?.value
    return {
      values,
      included: histories.length,
      total: heldCompanies.length,
      changePct: first && last !== undefined ? (last / first - 1) * 100 : null,
      chartCurrent: last ?? null,
    }
  }, [heldCompanies, holdings, performanceRange, priceHistory])
  const historyCoverage = useMemo(() => heldCompanies.map(company => {
    const rows = priceHistory[company.ticker] ?? []
    return {
      company,
      points: rows.length,
      latestDate: rows.at(-1)?.date ?? null,
      currentPriceAvailable: company.market_status === 'available' && Number.isFinite(company.price),
      availableRanges: (['1D','1W','1M','3M','1Y'] as PerformanceRange[]).filter(range => company.market_status === 'available' && Number.isFinite(company.price) && rows.length >= minHistoryPoints[range]),
    }
  }), [heldCompanies, priceHistory])
  const allocation = useMemo(() => {
    const bySector = new Map<string, { amount: number; invested: number; holdings: typeof pricedHoldings }>()
    for (const company of pricedHoldings) {
      const amount = holdings[company.ticker].shares * (company.price ?? 0)
      const sector = bySector.get(company.sector) ?? { amount: 0, invested: 0, holdings: [] }
      sector.amount += amount
      sector.invested += holdings[company.ticker].shares * holdings[company.ticker].average_cost
      sector.holdings.push(company)
      bySector.set(company.sector, sector)
    }
    return [...bySector.entries()].map(([sector, data]) => ({ sector, ...data, pct: marketValue ? data.amount / marketValue * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount)
  }, [pricedHoldings, holdings, marketValue])
  const concentration = useMemo(() => {
    const sectors = [...allocation].sort((a,b) => b.pct-a.pct)
    const stocks = pricedHoldings.map(company => ({
      company,
      amount: holdings[company.ticker].shares * (company.price ?? 0),
      pct: marketValue ? holdings[company.ticker].shares * (company.price ?? 0) / marketValue * 100 : 0,
    })).sort((a,b) => b.amount-a.amount)
    return {
      sectorCount: sectors.length,
      largestSector: sectors[0] ?? null,
      topThreeSectors: sectors.slice(0,3).reduce((sum,item)=>sum+item.pct,0),
      largestStock: stocks[0] ?? null,
      pricedCount: stocks.length,
      topThreeStocks: stocks.slice(0,3).reduce((sum,item)=>sum+item.pct,0),
      stockHhi: stocks.reduce((sum,item)=>sum+item.pct*item.pct,0),
    }
  }, [allocation, pricedHoldings, holdings, marketValue])
  const dailyMovers = useMemo(() => pricedHoldings.map(company => {
    const pct = company.change_pct
    if (pct === null || pct === undefined || company.previous_close === null || company.previous_close === undefined || company.price === undefined) return null
    const shares = holdings[company.ticker].shares
    return { company, pnl: shares * (company.price - company.previous_close), pct }
  }).filter((item): item is { company: Company; pnl: number; pct: number } => item !== null)
    .sort((a, b) => b.pnl - a.pnl), [pricedHoldings, holdings])
  const chartGeometry = useMemo(() => {
    const values = performance.values
    if (!values.length) return { line: '', area: '', lastY: 0, firstDate: '', lastDate: '' }
    const numbers = values.map(point => point.value)
    const min = Math.min(...numbers)
    const max = Math.max(...numbers)
    const spread = max - min || Math.max(1, max * .01)
    const coords = numbers.map((value, index) => ({
      x: values.length === 1 ? 380 : 12 + index / (values.length - 1) * 736,
      y: 184 - (value - min) / spread * 152,
    }))
    const line = coords.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
    return { line, area: `${line} L 748 196 L 12 196 Z`, lastY: coords[coords.length - 1].y, firstDate: values[0].date, lastDate: values[values.length - 1].date }
  }, [performance.values])

  function navigate(label: string, target: string) {
    const nextHash = `#/${target}`
    if (window.location.hash !== nextHash) window.history.pushState(null, '', nextHash)
    setActive(label)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  function selectSubview<T extends string>(setSubview: (value: T) => void, value: T) {
    setSubview(value)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  async function updateSettings(event: any) {
    event.preventDefault()
    setSettingsMessage('Saving…')
    try {
      const response = await fetch(`${API}/api/settings/alerts`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || 'Could not save thresholds.')
      setSettings(payload)
      setSettingsMessage('Saved. Refreshing alerts…')
      await loadPortfolio(true)
      setSettingsMessage('Thresholds saved.')
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : 'Could not save thresholds.')
    }
  }

  async function explainAnnouncement(item: Announcement) {
    setExplaining(item.id)
    try {
      const response = await fetch(`${API}/api/announcements/explain`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || 'AI explanation unavailable.')
      setExplanations(previous => ({ ...previous, [item.id]: payload.explanation }))
      setExplanationModes(previous => ({ ...previous, [item.id]: payload.mode ?? (payload.ai_generated ? 'ai_grounded' : 'rule_based') }))
    } catch (error) {
      setExplanations(previous => ({ ...previous, [item.id]: error instanceof Error ? error.message : 'AI explanation unavailable.' }))
      setExplanationModes(previous => ({ ...previous, [item.id]: 'error' }))
    } finally { setExplaining('') }
  }

  async function uploadResearch(event: any) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) { setResearchMessage('Choose a PDF file before indexing it.'); return }
    if (file.size > 45 * 1024 * 1024) { setResearchMessage('This PDF is larger than the 45 MB upload limit.'); return }
    setResearchBusy(true)
    setResearchMessage('Extracting pages and indexing the primary source…')
    try {
      const response = await fetch(`${API}/api/research/documents`, { method: 'POST', body: form })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || 'Could not upload the document.')
      const loaded = await loadDocuments(payload.id)
      if (!loaded.some(doc => doc.id === payload.id)) throw new Error('The PDF uploaded, but FINN could not refresh the document list. Retry the page or restart the backend.')
      setResearchMessage(`${payload.filename} indexed · ${payload.pages} pages`)
      setResearchFilename('')
      setResearchAnswer('')
      setResearchMode('')
      setResearchSources([])
      setDocumentActionMessage('')
    } catch (error) {
      setResearchMessage(error instanceof Error ? error.message : 'Could not upload the document.')
    } finally { setResearchBusy(false) }
  }

  async function deleteResearchDocument(doc: ResearchDocument) {
    if (!window.confirm(`Delete ${doc.filename}? Its saved financial entries and guidance records that cite this document will also be removed.`)) return
    setDocumentActionMessage('Removing the document and linked records…')
    try {
      const response = await fetch(`${API}/api/research/documents/${encodeURIComponent(doc.id)}`, { method: 'DELETE' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || 'Could not delete this document.')
      const loaded = await loadDocuments()
      if (doc.id === documentId) { setResearchAnswer(''); setResearchSources([]); setFinancialPeriods([]); setPromiseRows([]); setBullBear(null) }
      setDocumentActionMessage(`${doc.filename} and its linked entries were deleted.`)
      await refreshPromises(doc.ticker)
    } catch (error) { setDocumentActionMessage(error instanceof Error ? error.message : 'Could not delete this document.') }
  }

  async function reindexResearchDocument(doc: ResearchDocument) {
    setDocumentActionMessage(`Re-indexing ${doc.filename}…`)
    try {
      const response = await fetch(`${API}/api/research/documents/${encodeURIComponent(doc.id)}/reindex`, { method: 'POST' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || 'Could not re-index this PDF.')
      setDocumentActionMessage(`${doc.filename} re-indexed · ${payload.pages} pages`)
    } catch (error) { setDocumentActionMessage(error instanceof Error ? error.message : 'Could not re-index this PDF.') }
  }

  async function replaceResearchDocument(event: any) {
    const file = event.currentTarget.files?.[0] as File | undefined
    const doc = documents.find(item => item.id === replaceTargetId)
    event.currentTarget.value = ''
    if (!file || !doc) return
    if (file.size > 45 * 1024 * 1024) { setDocumentActionMessage('This PDF is larger than the 45 MB upload limit.'); return }
    const form = new FormData()
    form.set('company', doc.company); form.set('ticker', doc.ticker); form.set('document_type', doc.document_type); form.set('reporting_period', doc.reporting_period); form.set('source_url', doc.source_url ?? ''); form.set('file', file)
    setDocumentActionMessage(`Replacing ${doc.filename}…`)
    try {
      const response = await fetch(`${API}/api/research/documents/${encodeURIComponent(doc.id)}`, { method: 'PUT', body: form })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || 'Could not replace this document.')
      await loadDocuments(payload.id)
      setResearchAnswer(''); setResearchSources([])
      setDocumentActionMessage(`${payload.filename} replaced and ready to index.`)
    } catch (error) { setDocumentActionMessage(error instanceof Error ? error.message : 'Could not replace this document.') }
    finally { setReplaceTargetId('') }
  }

  async function askResearch(event: any) {
    event.preventDefault()
    if (!documentId) { setResearchMessage('Upload a primary-source PDF first.'); return }
    setResearchBusy(true)
    setResearchMessage('Searching the selected source…')
    try {
      const response = await fetch(`${API}/api/research/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document_id: documentId, question: researchQuestion }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || 'Research query failed.')
      setResearchAnswer(payload.answer)
      setResearchMode(payload.mode)
      setResearchSources(payload.sources)
      setResearchMessage(payload.mode === 'evidence_only' ? 'Evidence found · model synthesis unavailable; review the cited passages' : payload.mode === 'ai_grounded' ? 'AI answer grounded in retrieved pages' : payload.mode === 'extractive_local' ? 'Answer extracted from source text · not model-generated' : payload.mode === 'no_matching_evidence' ? 'No matching passage found. Try a more specific question.' : 'Source evidence retrieved')
    } catch (error) {
      setResearchMessage(error instanceof Error ? error.message : 'Research query failed.')
    } finally { setResearchBusy(false) }
  }

  async function saveQuarterlyFigures(event: any) {
    event.preventDefault()
    if (!selectedDocument) return
    const form = new FormData(event.currentTarget)
    const values = Object.fromEntries(['revenue', 'ebitda', 'pbt', 'pat', 'o2c_ebitda'].map(metric => {
      const raw = String(form.get(metric) ?? '').trim()
      return [metric, raw ? Number(raw) : null]
    }))
    if (!Object.values(values).some(value => value !== null)) { setFinancialMessage('Enter at least one reported figure.'); return }
    setFinancialMessage('Saving cited figures and calculating comparisons…')
    try {
      const response = await fetch(`${API}/api/research/financials`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document_id: selectedDocument.id, ticker: selectedDocument.ticker, period: form.get('period'), unit: form.get('unit'), page: Number(form.get('page')), excerpt: form.get('excerpt'), statement_basis: statementBasis, figure_type: figureType, adjustment_note: adjustmentNote, values }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || 'Could not save figures.')
      setFinancialPeriods(payload.comparisons.periods)
      setFinancialMessage(`Saved ${payload.saved.length} ${figureType} figure(s). Page match: ${Math.round((payload.source_page_match ?? 0) * 100)}% of the entered passage matched the selected PDF page.`)
      await refreshPromises(selectedDocument.ticker)
    } catch (error) { setFinancialMessage(error instanceof Error ? error.message : 'Could not save figures.') }
  }

  async function refreshPromises(ticker: string) {
    try {
      const response = await fetch(`${API}/api/research/promises?ticker=${encodeURIComponent(ticker)}`)
      const payload = await response.json()
      if (response.ok) { setPromiseRows(payload.promises); setPromiseTrackRecord(payload.track_record ?? null) }
    } catch { /* Keep current tracker until the next refresh. */ }
  }

  async function savePromise(event: any) {
    event.preventDefault()
    if (!selectedDocument) return
    const form = new FormData(event.currentTarget)
    setPromiseMessage('Saving management guidance with its source citation…')
    try {
      const response = await fetch(`${API}/api/research/promises`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document_id: selectedDocument.id, ticker: selectedDocument.ticker, metric: form.get('metric'), target_period: form.get('target_period'), target_value: Number(form.get('target_value')), unit: form.get('unit'), page: Number(form.get('page')), quote: form.get('quote'), statement_basis: statementBasis, figure_type: figureType, adjustment_note: adjustmentNote }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || 'Could not save the guidance item.')
      setPromiseRows(payload.promises)
      setPromiseTrackRecord(payload.track_record ?? null)
      setPromiseMessage('Guidance saved. Its outcome updates when you enter the matching quarter’s results.')
    } catch (error) { setPromiseMessage(error instanceof Error ? error.message : 'Could not save guidance.') }
  }

  async function buildBullBear() {
    if (!selectedDocument) return
    setBullBearBusy(true)
    setBullBear(null)
    try {
      const response = await fetch(`${API}/api/research/bull-bear`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticker: selectedDocument.ticker }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || 'Could not retrieve evidence for this analysis.')
      setBullBear(payload)
    } catch (error) { setBullBear({ mode: 'error', answer: error instanceof Error ? error.message : 'Bull/bear analysis failed.', sources: [] }) }
    finally { setBullBearBusy(false) }
  }

  function openHoldingEditor(company: Company) {
    const current = holdings[company.ticker]
    setHoldingShares(current ? String(current.shares) : '')
    setHoldingAverageCost(current ? String(current.average_cost) : '')
    setHoldingIsDemo(Boolean(current?.demo))
    setHoldingError('')
    setHoldingEditor(company)
  }

  function saveHolding(event: any) {
    event.preventDefault()
    if (!holdingEditor) return
    const shares = Number(holdingShares)
    const averageCost = Number(holdingAverageCost)
    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(averageCost) || averageCost <= 0) {
      setHoldingError('Enter a share quantity and average cost greater than zero.')
      return
    }
    setHoldings(current => ({ ...current, [holdingEditor.ticker]: { shares, average_cost: averageCost, demo: holdingIsDemo } }))
    setHoldingEditor(null)
    setHoldingError('')
  }

  function addDemoPositions() {
    if (!portfolio) return
    setHoldings(current => {
      const next = { ...current }
      let count = Object.values(next).filter(position => position.shares > 0).length
      for (const company of portfolio.companies) {
        if (count >= 15) break
        if (next[company.ticker]?.shares > 0) continue
        next[company.ticker] = { shares: 10, average_cost: company.price && company.price > 0 ? company.price : 100, demo: true }
        count += 1
      }
      return next
    })
  }

  function removeHolding() {
    if (!pendingRemoval) return
    setHoldings(current => {
      const next = { ...current }
      delete next[pendingRemoval.ticker]
      return next
    })
    setPendingRemoval(null)
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#/home" onClick={event=>{event.preventDefault();navigate('Home','home')}} aria-label="FINN home"><span className="brand-mark">f</span><span>finn<span className="brand-dot">.</span></span></a>
      <div className="workspace-label">CURRENT UNIVERSE</div>
      <div className="workspace"><div className="workspace-icon"><BriefcaseBusiness size={15}/></div><span><b>Investor desk</b><small>{portfolio?.companies.length ?? 20} NSE companies</small></span></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>{nav.map(({label,icon:Icon,target})=><button key={label} aria-current={active===label?'page':undefined} className={`nav-item ${active===label?'selected':''}`} onClick={()=>navigate(label,target)}><Icon size={18}/><span>{label}</span>{label==='Alerts'&&portfolio&&<b>{String(portfolio.alert_count + announcements.filter(item=>item.priority==='high').length).padStart(2,'0')}</b>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="source-note"><ShieldCheck size={17}/><span>Primary-source research<br/><small>Answers link back to evidence</small></span></div><div className="sidebar-footnote">FINN · INVESTOR INTELLIGENCE</div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="crumb">FINN <span>/</span> {active.toUpperCase()}</div><div className="top-actions"><span className="market-status"><i className={portfolio?.available_count ? 'connected' : ''}/> {portfolio?.available_count ? 'Market data connected' : portfolio ? 'No market data' : 'Connecting'}</span><button className="icon-button" aria-label="Refresh data" onClick={()=>void loadPortfolio(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing?'spin':''}/></button><div className="avatar small">A</div></div></header>
      <div className="content" id="home">
      <div className="page-view" key={active}>
      {active==='Home'&&<>
        <div className="eyebrow"><span>FINN INVESTOR DESK</span><i/> PORTFOLIO SIGNALS</div>
        <section className="greeting"><div><h1>Market overview</h1><p>A quick view of your holdings, daily P&amp;L, and market signals.</p></div><div className="greeting-actions"><button className="date-button" onClick={()=>void loadPortfolio(true)} disabled={refreshing}>{refreshing?'Refreshing…':'Refresh prices'} <RefreshCw size={13}/></button></div></section>
        {marketError&&<div className="error-banner" role="alert"><span>{marketError}</span><button onClick={()=>void loadPortfolio(true)}>Retry <ArrowRight size={14}/></button></div>}
        <section className="stats-grid">
          {heldCompanies.length ? <article className="stat-card portfolio-stat"><div className="stat-heading">Market value · priced holdings <span className="subtle">{pricedHoldings.length} OF {heldCompanies.length} PRICED</span></div><div className="stat-value">{money(marketValue)}</div><div className="stat-foot"><span>Of {heldCompanies.length} portfolio positions · {portfolio?.source ?? 'Market source pending'}</span><span>{portfolio?new Date(portfolio.retrieved_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'—'}</span></div></article> : <article className="stat-card portfolio-stat setup-stat"><div className="stat-heading">PORTFOLIO SETUP <span className="subtle">NO POSITIONS</span></div><div className="setup-copy"><b>Start with your holdings</b><p>Add positions to calculate portfolio value and P&amp;L.</p></div><div className="setup-actions"><button onClick={()=>{setPortfolioTab('watchlist');navigate('Portfolio','portfolio')}}>Choose holdings <ArrowRight size={14}/></button><button onClick={addDemoPositions} disabled={!portfolio}>Load demo</button></div></article>}
          <article className="stat-card"><div className="stat-heading">Portfolio alerts <span className="stat-icon amber"><Bell size={17}/></span></div><div className="stat-value">{loading?'—':String((portfolio?.alert_count ?? 0) + announcements.filter(item=>item.priority==='high').length).padStart(2,'0')}</div><div className="stat-foot"><span>Price, volume, and filings</span><button className="text-amber" onClick={()=>navigate('Alerts','alerts')}>Review <ArrowRight size={13}/></button></div></article>
          <article className="stat-card daily-pnl-stat" title="Sum of shares multiplied by each latest unadjusted close minus its previous unadjusted close."><div className="stat-heading">Daily P&amp;L <span className="stat-icon blue"><Activity size={17}/></span></div><div className={`stat-value ${todayPnl < 0 ? 'loss-value' : todayPnl > 0 ? 'gain-value' : ''}`}>{dailyPricedHoldings.length ? money(todayPnl) : '—'}</div><div className="stat-foot"><span>Today’s change · {dailyPricedHoldings.length}/{heldCompanies.length} holdings with both closes</span><button onClick={()=>navigate('Portfolio','portfolio')}>Holdings <ArrowRight size={13}/></button></div></article>
        </section>
        <section className="performance-section" aria-labelledby="performance-title">
          <div className="performance-heading"><div><span className="eyebrow-mini">POSITION WEIGHTED · CURRENT SHARES</span><h2 id="performance-title">Portfolio performance</h2><p>Historical value using the share quantities you hold today.</p></div><div className="performance-ranges" role="group" aria-label="Performance period">{(['1D','1W','1M','3M','1Y'] as PerformanceRange[]).map(range=><button key={range} className={performanceRange===range?'active':''} aria-pressed={performanceRange===range} onClick={()=>setPerformanceRange(range)}>{range}</button>)}</div></div>
          <div className="performance-main">
            <div className="performance-chart-card">
              <div className="chart-summary"><div><small>PERIOD VALUE</small><strong>{performance.chartCurrent===null? '—' : money(performance.chartCurrent)}</strong></div><span className={`range-return ${performance.changePct===null?'':performance.changePct<0?'negative':'positive'}`}>{performance.changePct===null?'—':`${performance.changePct>0?'+':''}${performance.changePct.toFixed(2)}%`}<small>{performanceRange} return</small></span></div>
              {historyLoading?<div className="performance-empty">Loading historical prices…</div>:performance.values.length>1?<><svg className="performance-chart" viewBox="0 0 760 210" role="img" aria-label={`${performanceRange} portfolio value chart, ${performance.included} of ${performance.total} positions with enough history`} preserveAspectRatio="none"><defs><linearGradient id="performance-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#d58c59" stopOpacity=".24"/><stop offset="100%" stopColor="#d58c59" stopOpacity="0"/></linearGradient></defs><path d="M 12 62 H 748 M 12 124 H 748 M 12 186 H 748" className="chart-gridline"/><path d={chartGeometry.area} fill="url(#performance-fill)"/><path d={chartGeometry.line} className="chart-line"/><circle cx="748" cy={chartGeometry.lastY} r="4" className="chart-last-dot"/></svg><div className="chart-dates"><span>{new Date(chartGeometry.firstDate+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</span><span>{new Date(chartGeometry.lastDate+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</span></div></>:<div className="performance-empty compact-empty"><b>{heldCompanies.length?'No verified history for this range':'Add holdings to see performance'}</b><span>{performance.included} of {performance.total} holdings have enough historical prices for {performanceRange}.</span><button onClick={()=>setHistoryCoverageOpen(true)} disabled={historyLoading}>Inspect price coverage <ArrowRight size={13}/></button></div>}
              <p className="chart-footnote">Yahoo Finance adjusted closes, scaled to latest market prices · {performance.included} of {performance.total} positions included{performance.total>performance.included?' for this range':''}.</p>
            </div>
            <aside className="capital-card"><div className="mini-panel-title"><span>CAPITAL AT WORK</span><span>{pricedHoldings.length}/{heldCompanies.length} priced</span></div><div className="capital-row"><span>Invested amount</span><b>{money(pricedInvestedCapital)}</b></div><div className="capital-row"><span>Current market value</span><b>{money(marketValue)}</b></div><div className="capital-track"><i style={{width:`${pricedInvestedCapital>0?Math.min(100,marketValue/pricedInvestedCapital*100):0}%`}}/></div><div className={`capital-return ${marketValue-pricedInvestedCapital<0?'negative':'positive'}`}><span>Unrealized P&amp;L</span><b>{money(marketValue-pricedInvestedCapital)}</b></div><small>Matched priced positions only. Invested amount = shares × saved average cost; current value uses the latest unadjusted close. DEMO basis is seeded from the reference price when loaded.</small></aside>
          </div>
          <div className="performance-lower">
            <article className="allocation-card"><div className="mini-panel-title"><span>ALLOCATION BY SECTOR</span><span>{money(marketValue)} priced value</span></div>{allocation.length?<div className="allocation-list">{allocation.map((item,index)=><details className="allocation-row" key={item.sector}><summary><div className="allocation-label"><i style={{'--sector-color':`var(--sector-${index%6})`} as CSSProperties}/><span>{item.sector}</span><b>{item.pct.toFixed(1)}%</b></div><div className="allocation-track"><i style={{width:`${item.pct}%`,'--sector-color':`var(--sector-${index%6})`} as CSSProperties}/></div><div className="allocation-values"><span>Invested <b>{money(item.invested)}</b></span><span>Market value <b>{money(item.amount)}</b></span></div></summary><div className="sector-holdings">{item.holdings.map(company=><div key={company.ticker}><span><b>{company.name}</b><small>{company.ticker} · {holdings[company.ticker].shares.toLocaleString('en-IN')} shares</small></span><span><b>{money(holdings[company.ticker].shares * holdings[company.ticker].average_cost)}</b><small>invested</small></span><span><b>{money(holdings[company.ticker].shares * (company.price ?? 0))}</b><small>market value</small></span></div>)}</div></details>)}</div>:<p className="performance-empty compact">Add priced holdings to calculate allocation.</p>}</article>
            <article className="movers-card"><div className="mini-panel-title"><span>TODAY’S POSITION MOVERS</span><small>Contribution to daily P&amp;L</small></div>{dailyMovers.length?<div className="movers-columns"><div><label>GAINERS</label>{dailyMovers.filter(item=>item.pnl>0).slice(0,3).map(item=><div className="mover-row" key={item.company.ticker}><span className="mover-mark up"><TrendingUp size={13}/></span><span className="mover-company"><b>{item.company.name}</b><small>{item.company.ticker} · {item.pct>0?'+':''}{item.pct.toFixed(2)}%</small></span><strong className="gain-value">+{money(item.pnl)}</strong></div>)}{dailyMovers.every(item=>item.pnl<=0)&&<small className="mover-empty">No gainers in priced holdings today.</small>}</div><div><label>LOSERS</label>{dailyMovers.filter(item=>item.pnl<0).slice(-3).reverse().map(item=><div className="mover-row" key={item.company.ticker}><span className="mover-mark down"><TrendingDown size={13}/></span><span className="mover-company"><b>{item.company.name}</b><small>{item.company.ticker} · {item.pct.toFixed(2)}%</small></span><strong className="loss-value">{money(item.pnl)}</strong></div>)}{dailyMovers.every(item=>item.pnl>=0)&&<small className="mover-empty">No losers in priced holdings today.</small>}</div></div>:<p className="performance-empty compact">Daily movers appear when held companies have current prices.</p>}</article>
          </div>
          <article className="concentration-card"><div className="mini-panel-title"><span>PORTFOLIO CONCENTRATION</span><small>Priced holdings · by current market value</small></div><div className="concentration-metrics"><div><small>Largest sector</small><b>{concentration.largestSector?`${concentration.largestSector.pct.toFixed(1)}%`: '—'}</b><span>{concentration.largestSector?.sector ?? 'No priced positions'}</span></div><div><small>Top 3 sectors</small><b>{concentration.sectorCount?`${concentration.topThreeSectors.toFixed(1)}%`:'—'}</b><span>Combined exposure</span></div><div><small>Largest stock</small><b>{concentration.largestStock?`${concentration.largestStock.pct.toFixed(1)}%`:'—'}</b><span>{concentration.largestStock?.company.name ?? 'No priced positions'}</span></div><div><small>Top 3 stocks</small><b>{concentration.pricedCount?`${concentration.topThreeStocks.toFixed(1)}%`:'—'}</b><span>Combined exposure</span></div><div><small>Sectors represented</small><b>{concentration.sectorCount}</b><span>Across {pricedHoldings.length}/{heldCompanies.length} priced holdings</span></div><div title="Herfindahl-Hirschman Index: sum of squared individual stock weights, on a 0–10,000 scale."><small>Stock HHI</small><b>{marketValue?Math.round(concentration.stockHhi):'—'}</b><span>Sum of squared stock weights · lower means less concentrated</span></div></div><p>Exposure measures use each holding’s share of priced market value. Sector count alone does not describe diversification.</p></article>
        </section>
        {historyCoverageOpen&&<div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setHistoryCoverageOpen(false)}}><section className="holding-modal coverage-modal" role="dialog" aria-modal="true" aria-labelledby="coverage-dialog-title"><button className="modal-close" type="button" onClick={()=>setHistoryCoverageOpen(false)} aria-label="Close price coverage">×</button><span className="eyebrow-mini">HISTORICAL PRICE DATA</span><h2 id="coverage-dialog-title">Coverage by holding</h2><p>Yahoo Finance adjusted daily closes are scaled to the latest unadjusted market price. Missing history stays missing; it is not filled with estimated returns.</p><div className="coverage-table"><div className="coverage-table-head"><span>Holding</span><span>Daily rows</span><span>Latest history</span><span>Ranges available</span></div>{historyCoverage.map(item=><div className="coverage-table-row" key={item.company.ticker}><b>{item.company.name}<small>{item.company.ticker}</small></b><span>{historyLoading?'…':item.points}</span><span>{item.currentPriceAvailable?(item.latestDate??'No data'):'Current price unavailable'}</span><span>{item.availableRanges.length?item.availableRanges.join(' · '):'No range'}</span></div>)}</div><div className="modal-actions"><button type="button" className="save-button" onClick={()=>setHistoryCoverageOpen(false)}>Done</button></div></section></div>}
        <section className="home-briefing">
          <div className="briefing-main"><div className="briefing-heading"><div><span className="eyebrow-mini">PUSH · MOST RECENT</span><h2>Latest company filing</h2></div><button className="link-button" onClick={()=>navigate('Alerts','alerts')}>All alerts <ArrowRight size={14}/></button></div>
            {announcements[0]?<article className="briefing-filing"><div className="filing-meta"><span>{announcements[0].ticker}</span><span>{labelCategory(announcements[0].category)}</span><span>IMPORTANCE {announcements[0].importance}</span><time>{new Date(announcements[0].filed_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</time></div>{announcements[0].is_verified_example&&<span className="demo-filing-tag">VERIFIED DEMO FILING</span>}<h3>{announcements[0].company}</h3><p>{announcements[0].subject}</p><a href={announcements[0].source_url} target="_blank" rel="noreferrer">Read exchange filing <ArrowRight size={14}/></a></article>:<div className="briefing-empty">{announcementError?'Filing feed is unavailable right now.':'No matching filings in the selected window.'}</div>}
          </div>
          <aside className="coverage-panel"><span className="eyebrow-mini">WATCHLIST PRICE COVERAGE</span><strong>{portfolio?.available_count ?? '—'}<small> / {portfolio?.companies.length ?? 20}</small></strong><p>tracked companies with latest prices</p><div className="coverage-track"><i style={{width:`${portfolio?.companies.length?Math.min(100,(portfolio.available_count/portfolio.companies.length)*100):0}%`}}/></div><small className="coverage-definition">Universe coverage; does not count position size.</small><button onClick={()=>navigate('Portfolio','portfolio')}>Open watchlist <ArrowRight size={14}/></button></aside>
        </section>
      </>}

      {active==='Alerts'&&<>
        <div className="eyebrow"><span>PUSH INTELLIGENCE</span><i/> EXCHANGE FILINGS & MARKET SIGNALS</div>
        <section className="greeting page-greeting"><div><h1>Alerts &amp; Intelligence</h1><p>Monitor corporate announcements and unusual market activity across your tracked companies. Market alerts use completed sessions; no illustrative market signals are added.</p></div></section>
        <section className="alert-overview" aria-label="Alert summary"><article><small>TOTAL ALERTS</small><b>{alertHistory.length.toString().padStart(2,'0')}</b><span>{unreadOnly?`${alertHistory.filter(item=>!item.is_read).length} unread`:'Recorded in selected period'}</span></article><article><small>HIGH PRIORITY</small><b>{alertHistory.filter(item=>item.priority==='high').length.toString().padStart(2,'0')}</b><span>Results, price moves and material filings</span></article><article><small>MARKET SIGNALS</small><b>{alertHistory.filter(item=>item.kind==='market').length.toString().padStart(2,'0')}</b><span>One per company, signal and session</span></article></section>
        <section className="alerts-section unified-alerts anchor-section" id="alerts">
          <div className="section-heading"><div><h2>Alert feed</h2><p>{portfolio?.source??'Market data'} · Latest completed session: {portfolio?.companies.find(company=>company.session_date)?.session_date??'unavailable'} · Last successful market update {portfolio?.last_successful_update?new Date(portfolio.last_successful_update).toLocaleString('en-IN'):'unavailable'} · NSE filings updated {announcementUpdatedAt?new Date(announcementUpdatedAt).toLocaleString('en-IN'):'unavailable'}</p></div><div className="section-tools"><select aria-label="Alert history period" value={announcementWindow} onChange={event=>{const hours=Number(event.target.value);setAnnouncementWindow(hours);void loadAnnouncements(hours);void loadAlertHistory(hours)}}><option value={24}>Last 24 hours</option><option value={168}>Last 7 days</option><option value={720}>Last 30 days</option></select><button className="link-button" onClick={()=>{void loadPortfolio(true);void loadAnnouncements(announcementWindow);void loadAlertHistory(announcementWindow)}}>Refresh <RefreshCw size={13}/></button></div></div>
          <div className="alert-summary-cards"><article><span>Volume spike</span><b>≥ {settings.volume_multiple.toFixed(1)}×</b><small>Previous 20 completed sessions</small></article><article><span>Daily price move</span><b>≥ ±{settings.price_move_pct.toFixed(1)}%</b><small>Previous completed close</small></article><article className="trigger-rule"><span>Alert rule</span><b>Either condition</b><small>OR logic: each trigger works independently</small></article></div>
          <form className="threshold-panel alert-threshold-form" onSubmit={updateSettings}><label>Volume spike multiple<input type="number" min="1.1" max="10" step="0.1" value={settings.volume_multiple} onChange={event=>setSettings({...settings,volume_multiple:Number(event.target.value)})}/><small>× the previous 20 completed sessions</small></label><label>Daily price movement<input type="number" min="0.5" max="25" step="0.5" value={settings.price_move_pct} onChange={event=>setSettings({...settings,price_move_pct:Number(event.target.value)})}/><small>Either direction, versus previous close</small></label><button type="submit">Save trigger settings</button><span>{settingsMessage}</span></form>
          <div className="page-tabs alert-filter-tabs" role="tablist" aria-label="Alert categories">
            <button role="tab" aria-selected={alertsTab==='all'} className={alertsTab==='all'?'active':''} onClick={()=>{setAlertsTab('all');setFilingFilter('all')}}><Activity size={15}/> All alerts <span>{alertHistory.length}</span></button>
            <button role="tab" aria-selected={alertsTab==='filings'} className={alertsTab==='filings'?'active':''} onClick={()=>{setAlertsTab('filings');setFilingFilter('all')}}><FileText size={15}/> Company filings</button>
            <button role="tab" aria-selected={alertsTab==='price'} className={alertsTab==='price'?'active':''} onClick={()=>{setAlertsTab('price');setFilingFilter('all')}}><TrendingUp size={15}/> Price movements</button>
            <button role="tab" aria-selected={alertsTab==='volume'} className={alertsTab==='volume'?'active':''} onClick={()=>{setAlertsTab('volume');setFilingFilter('all')}}><BarChart3 size={15}/> Volume spikes</button>
          </div>
          <div className="alert-feed-tools">{alertsTab==='filings'&&<div className="filing-category-filters" aria-label="Filing type filters">{([['all','All filings'],['results','Financial results'],['corporate','Corporate announcements'],['shareholding','Shareholding changes'],['dividend','Dividends'],['board','Board meetings'],['mergers','Mergers & acquisitions']] as [FilingFilter,string][]).map(([filter,label])=><button key={filter} className={filingFilter===filter?'active':''} aria-pressed={filingFilter===filter} onClick={()=>setFilingFilter(filter)}>{label}</button>)}</div>}<label className="unread-filter"><input type="checkbox" checked={unreadOnly} onChange={event=>setUnreadOnly(event.target.checked)}/> Unread only <span>{alertHistory.filter(item=>!item.is_read).length}</span></label></div>
          {announcementError&&<div className="state-card alert-feed-notice"><span>{announcementError} Previously saved alerts remain available below.</span><button onClick={()=>void loadAnnouncements(announcementWindow)}>Retry filings</button></div>}
          {alertHistoryError&&<div className="state-card error-state" role="alert">{alertHistoryError}</div>}
          {alertHistoryLoading&&!alertHistory.length?<div className="state-card">Loading recorded alerts…</div>:visibleAlertHistory.length?<div className="unified-alert-feed">{visibleAlertHistory.map(item=>{
            const eventTime = item.filed_at ?? item.event_at
            const isFiling = item.kind==='filing'
            const filing = item as AlertHistoryItem & Announcement
            const signal = item.signal_type==='price_movement'?'Price movement':'Volume spike'
            const marketSummary = item.signal_type==='price_movement'
              ? `Unusual price movement detected: ${item.change_pct===null||item.change_pct===undefined?'—':`${item.change_pct>0?'+':''}${item.change_pct.toFixed(2)}%`}.`
              : `Trading volume reached ${item.volume_ratio_20d?.toFixed(2)??'—'}× its 20-session average.`
            return <article className={`unified-alert-card ${item.priority==='high'?'priority-high':''} ${item.is_read?'is-read':''}`} key={item.id}>
              <div className="unified-alert-rail"><span className={`severity-dot ${item.priority}`}/><span>{item.is_read?'READ':'NEW'}</span></div>
              <div className="unified-alert-content"><div className="unified-alert-meta"><b>{item.ticker.replace('.NS','').replace('.BO','')}</b><span className={`severity-pill ${item.priority}`}>{item.priority} priority</span><span className="alert-kind-pill">{isFiling?'Corporate filing':signal}</span><time>{new Date(eventTime).toLocaleString('en-IN')}</time></div>
                <h3>{item.company}</h3><p className="unified-alert-summary">{isFiling?item.subject:marketSummary}</p>
                {isFiling&&item.details&&<p className="unified-alert-details">{item.details}</p>}
                {isFiling&&<div className="filing-facts"><span>Filing type <b>{labelCategory(item.category)}</b></span><span>Exchange <b>{item.exchange??'NSE'}</b></span><span>Importance <b>{item.importance}/100</b></span></div>}
                {!isFiling&&<div className="filing-facts"><span>Trigger <b>{item.signal_type==='price_movement'?`≥ ±${(item.price_threshold_pct??settings.price_move_pct).toFixed(1)}%`:`≥ ${(item.volume_threshold??settings.volume_multiple).toFixed(1)}×`}</b></span><span>Session <b>{item.session_date??'—'}</b></span>{item.signal_type==='price_movement'?<span>Close <b>{money(item.price)} vs {money(item.previous_close)}</b></span>:<span>Volume <b>{item.volume?.toLocaleString('en-IN')??'—'} vs {item.average_volume_20d?.toLocaleString('en-IN')??'—'} avg. shares</b></span>}</div>}
                {item.rule_explanation&&<p className="unified-alert-relevance">{item.rule_explanation}</p>}
                {item.is_verified_example&&<span className="verified-filing">Verified filing · demonstration example</span>}
                <div className="unified-alert-actions"><a href={item.source_url} target="_blank" rel="noreferrer"><FileText size={14}/>{isFiling?'Open original NSE filing':'Open Yahoo Finance source'} ↗</a>{isFiling&&<button onClick={()=>void explainAnnouncement(filing)} disabled={explaining===item.id}><Sparkles size={14}/>{explaining===item.id?'Thinking…':'Why it may matter'}</button>}<button onClick={()=>void setAlertRead(item,!item.is_read)}>{item.is_read?'Mark unread':'Mark read'}</button></div>
              </div>
            </article>
          })}</div>:<div className="state-card alert-empty-state"><b>{unreadOnly?'No unread alerts in this filter.':alertsTab==='filings'?'No company filings in the selected period and filing category.':alertsTab==='price'?'No price movement alerts in the selected period.':alertsTab==='volume'?'No volume spike alerts in the selected period.':'No alerts in the selected period.'}</b><p>{alertsTab==='filings'?announcementError?'The NSE filing feed is unavailable; prior saved filings remain searchable when available.':`NSE returned no tracked-company filings in the last ${announcementWindow===24?'24 hours':announcementWindow===168?'7 days':'30 days'}. This does not mean there were no market signals.`:'FINN only records signals when a configured threshold is crossed using completed trading-session data. Missing values do not create alerts.'}</p>{unreadOnly&&<button className="link-button" onClick={()=>setUnreadOnly(false)}>Show all alerts</button>}</div>}
        </section>
      </>}

      {active==='Research'&&<>
        <div className="eyebrow"><span>PULL RESEARCH</span><i/> EVIDENCE WITH SOURCES</div>
        <section className="greeting page-greeting"><div><h1>Company research</h1><p>Search company filings and reports, then review answers with document and page citations.</p></div></section>
        <div className="page-tabs" role="tablist" aria-label="Research tools">
          <button role="tab" aria-selected={researchTab==='ask'} className={researchTab==='ask'?'active':''} onClick={()=>selectSubview(setResearchTab,'ask')}><Search size={15}/> Ask FINN</button>
          <button role="tab" aria-selected={researchTab==='financials'} className={researchTab==='financials'?'active':''} onClick={()=>selectSubview(setResearchTab,'financials')}><BarChart3 size={15}/> Financials</button>
          <button role="tab" aria-selected={researchTab==='commitments'} className={researchTab==='commitments'?'active':''} onClick={()=>selectSubview(setResearchTab,'commitments')}><Target size={15}/> Commitments</button>
          <button role="tab" aria-selected={researchTab==='analysis'} className={researchTab==='analysis'?'active':''} onClick={()=>selectSubview(setResearchTab,'analysis')}><TrendingUp size={15}/> Bull vs bear</button>
        </div>
        <section className="research-workflow anchor-section" id="research"><div className="section-heading"><div><h2>Primary-source company research</h2><p>Upload an annual report or earnings-call transcript, then ask a question with page citations.</p></div><span className="market-source">{aiEnabled?`${aiProvider} available`:'Local retrieval active'}</span></div>
          <div className="research-pane" hidden={researchTab!=='ask'}>
          <form className="upload-panel" onSubmit={uploadResearch}><label>Company<input name="company" required placeholder="e.g. Reliance Industries"/></label><label>NSE ticker<input name="ticker" required placeholder="e.g. RELIANCE.NS"/></label><label>Source type<select name="document_type" required><option>Annual report</option><option>Quarterly results</option><option>Earnings-call transcript</option><option>Investor presentation</option></select></label><label>Reporting period<input name="reporting_period" required placeholder="e.g. FY2026 or Q2 FY2027"/></label><label>Official source URL (optional)<input name="source_url" type="url" placeholder="https://www.nseindia.com/..."/></label><label className="file-picker"><Upload size={16}/>{researchFilename||'Choose PDF'}<input type="file" name="file" accept="application/pdf,.pdf" required onChange={event=>setResearchFilename(event.target.files?.[0]?.name ?? '')}/></label><button type="submit" disabled={researchBusy}>Index primary source</button></form><small className="upload-hint">Text-searchable PDFs only · maximum 45 MB. Tracked-company names and tickers are checked as a pair. Scanned image PDFs need OCR before upload.</small>
          {documents.length>0&&<form className="question-panel" onSubmit={askResearch}><label>Source document<select value={documentId} onChange={event=>setDocumentId(event.target.value)}>{documents.map(doc=><option key={doc.id} value={doc.id}>{doc.company} · {doc.document_type} · {doc.reporting_period} ({doc.pages} pages)</option>)}</select></label><label>Your question<input value={researchQuestion} onChange={event=>setResearchQuestion(event.target.value)} minLength={5} required placeholder="What did management say about margins?"/></label><button type="submit" disabled={researchBusy}>Ask FINN <ArrowRight size={14}/></button></form>}
          {researchMessage&&<p className="workflow-message">{researchMessage}</p>}{researchAnswer&&<div className="research-answer"><div className="answer-heading"><Sparkles size={16}/><b>{researchMode==='ai_grounded'?'FINN model-assisted research':researchMode==='extractive_local'?'FINN extractive answer':'FINN source evidence'}</b></div><p>{researchAnswer}</p><small>Management statements are quoted from the source. Any FINN interpretation is labeled separately.</small>{researchSources.map(source=><details className="source-citation" key={source.id} open><summary>[{source.id}] {source.filename} · {source.document_type} · {source.reporting_period} · p. {source.page}</summary>{citationHref(source)&&<a href={citationHref(source)} target="_blank" rel="noreferrer">Open exact source page ↗</a>}<blockquote>{source.excerpt}</blockquote></details>)}</div>}
          <div className="document-library"><div className="section-heading"><div><h3>Document library</h3><p>{documents.length} indexed primary sources · choose a source, search metadata, or manage its index.</p></div></div><div className="document-library-tools"><label><Search size={15}/><input value={documentSearch} onChange={event=>setDocumentSearch(event.target.value)} placeholder="Search company, ticker, period, or filename"/></label><select aria-label="Filter document type" value={documentTypeFilter} onChange={event=>setDocumentTypeFilter(event.target.value)}><option value="all">All source types</option>{Array.from(new Set(documents.map(doc=>doc.document_type))).sort().map(type=><option key={type}>{type}</option>)}</select></div><input ref={replaceInput} hidden type="file" accept="application/pdf,.pdf" onChange={replaceResearchDocument}/>{documentActionMessage&&<p className="workflow-message">{documentActionMessage}</p>}
            {visibleDocuments.length?<div className="document-list">{visibleDocuments.map(doc=><article className={`document-library-row ${doc.superseded_by?'superseded-document':''}`} key={doc.id}><FileText size={16}/><div><b>{doc.company} · {doc.ticker} {doc.superseded_by&&<em>Previous version</em>}</b><span>{doc.filename} · {doc.document_type} · {doc.reporting_period} · {doc.pages} pages</span><small>{doc.source_url&&<a href={doc.source_url} target="_blank" rel="noreferrer">Original source ↗</a>} <a href={`${API}/api/research/documents/${encodeURIComponent(doc.id)}/file#page=1`} target="_blank" rel="noreferrer">Open PDF ↗</a></small></div><div className="document-library-actions"><button onClick={()=>setDocumentId(doc.id)}>Select</button><button onClick={()=>{setReplaceTargetId(doc.id);replaceInput.current?.click()}}><Upload size={13}/> Replace</button><button onClick={()=>void reindexResearchDocument(doc)}><RotateCw size={13}/> Re-index</button><button className="remove-action" onClick={()=>void deleteResearchDocument(doc)}><Trash2 size={13}/> Delete</button></div></article>)}</div>:<div className="state-card">{documents.length?'No documents match these filters.':'Upload a primary source to start your research library.'}</div>}
          </div>
          </div>
          {selectedDocument&&<>
            <div className="research-subsection" hidden={researchTab!=='financials'}><div className="section-heading"><div><h3>Quarterly financial comparisons</h3><p>Compare like with like. Figures are grouped by statement basis and reported or adjusted presentation; every saved value keeps its source page and excerpt.</p></div></div>
              <div className="financial-scope-controls"><label>Statement basis<select value={statementBasis} onChange={event=>setStatementBasis(event.target.value as 'consolidated'|'standalone')}><option value="consolidated">Consolidated</option><option value="standalone">Standalone</option></select></label><label>Figure presentation<select value={figureType} onChange={event=>setFigureType(event.target.value as 'reported'|'adjusted')}><option value="reported">Reported</option><option value="adjusted">Adjusted</option></select></label>{figureType==='adjusted'&&<label className="adjustment-note-field">Adjustment definition<input value={adjustmentNote} onChange={event=>setAdjustmentNote(event.target.value)} maxLength={500} placeholder="e.g. exclude one-time restructuring charge"/><small>Comparisons include only figures using this same definition.</small></label>}</div>
              <form className="financial-entry" onSubmit={saveQuarterlyFigures}><label>Fiscal quarter<input name="period" required pattern="FY20[0-9]{2}-Q[1-4]" placeholder="FY2026-Q2" title="Format: FY2026-Q2"/></label><label>Units<select name="unit"><option>₹ crore</option><option>₹ lakh</option><option>₹</option></select></label><label>Source page<input name="page" type="number" min="1" max={selectedDocument.pages} required placeholder="PDF page number"/></label><label>Revenue<input name="revenue" type="number" step="any" placeholder="As filed"/></label><label>EBITDA<input name="ebitda" type="number" step="any" placeholder="As filed"/></label><label>PBT<input name="pbt" type="number" step="any" placeholder="As filed"/></label><label>PAT<input name="pat" type="number" step="any" placeholder="As filed"/></label><label>O2C EBITDA<input name="o2c_ebitda" type="number" step="any" placeholder="Optional segment value"/></label><label className="financial-excerpt">Supporting passage<input name="excerpt" required minLength={10} maxLength={1200} placeholder="Copy the relevant financial-results statement/table text"/></label><button type="submit">Save cited figures</button></form>
              {financialMessage&&<p className="workflow-message">{financialMessage}</p>}
              {financialPeriods.length>1&&<div className="financial-chart-card"><div className="section-heading"><div><h4>Quarterly trend</h4><p>{financialChartMetric.toUpperCase()} · {statementBasis} · {figureType}</p></div><div className="financial-chart-controls"><select aria-label="Chart metric" value={financialChartMetric} onChange={event=>setFinancialChartMetric(event.target.value)}>{['revenue','ebitda','pbt','pat','o2c_ebitda','ebitda_margin','pbt_margin','pat_margin'].map(metric=><option key={metric} value={metric}>{metric.toUpperCase()}</option>)}</select><button className={financialChartRange===4?'active':''} onClick={()=>setFinancialChartRange(4)}>4 quarters</button><button className={financialChartRange===8?'active':''} onClick={()=>setFinancialChartRange(8)}>8 quarters</button></div></div>{financialChartGeometry&&chartRows.length>1?<><svg viewBox="0 0 600 205" role="img" aria-label={`${financialChartMetric} values over ${chartRows.length} quarters`}><line x1="24" x2="576" y1={financialChartGeometry.zeroY} y2={financialChartGeometry.zeroY} className="financial-chart-zero"/><polyline points={financialChartGeometry.points} className="financial-chart-line" fill="none"/>{chartRows.map((row,index)=>{const values=chartRows.map(point=>point.value as number);const min=Math.min(0,...values),max=Math.max(0,...values),span=max-min||1;const cx=24+index*552/(chartRows.length-1),cy=166-((row.value as number)-min)*132/span;return <g key={row.period}><circle cx={cx} cy={cy} r="4"/><text x={cx} y="194" textAnchor="middle">{row.period.replace('FY','').replace('-Q','·Q')}</text></g>})}</svg><small>{chartRows.length} quarters · {chartRows[0]?.unit} · margins shown in percentage; QoQ/YoY comparisons in percentage points</small></>:<div className="state-card">Add at least two quarters with {financialChartMetric.toUpperCase()} values to plot this trend.</div>}</div>}
              {financialPeriods.slice(0,8).map((period,index)=><details className="financial-period" key={period.period} open={index===0}><summary>{period.period}<small>QoQ and YoY use the same basis and figure presentation</small></summary><div className="financial-table"><div className="financial-row financial-header"><span>Metric</span><span>{figureType}</span><span>QoQ</span><span>YoY</span><span>Evidence</span></div>{Object.entries(period.metrics).map(([metric,data])=><div className="financial-row" key={metric}><b>{metric==='revenue'?'REVENUE':metric.toUpperCase()}</b><span>{data.value.toLocaleString('en-IN')} {data.unit}</span><span>{changeValue(data.qoq)}<small>{changeNote(data.qoq,data.unit)}</small></span><span>{changeValue(data.yoy)}<small>{changeNote(data.yoy,data.unit)}</small></span><details><summary>{data.calculated?'Calculated from cited figures · ':''}{data.source.filename} · PDF p.{data.source.page}</summary>{citationHref({...data.source,page:data.source.page})&&<a href={citationHref({...data.source,page:data.source.page})} target="_blank" rel="noreferrer">Open exact source page ↗</a>}{data.source.excerpt&&<blockquote>{data.source.excerpt}</blockquote>}{data.source.supporting_sources?.map((source,index)=><blockquote key={`${source.filename}-${index}`}>{source.filename} · p.{source.page}: {source.excerpt}{citationHref({...source,page:source.page})&&<> <a href={citationHref({...source,page:source.page})} target="_blank" rel="noreferrer">Open page ↗</a></>}</blockquote>)}</details></div>)}</div></details>)}
              {financialPeriods.length===0&&<div className="state-card">No reported quarters saved for {selectedDocument.ticker}. Add figures from a quarterly-results filing to calculate comparisons.</div>}
            </div>

            <div className="research-subsection" hidden={researchTab!=='commitments'}><div className="section-heading"><div><h3>Management promise vs reality</h3><p>Log explicit guidance with its source passage, then compare it with the matching reported period.</p></div></div>
              <form className="promise-entry" onSubmit={savePromise}><label>Guidance metric<select name="metric"><option value="revenue_growth_yoy">Revenue growth YoY</option><option value="revenue">Revenue</option><option value="ebitda">EBITDA</option><option value="ebitda_margin">EBITDA margin</option><option value="pbt">PBT</option><option value="pbt_margin">PBT margin</option><option value="pat">PAT</option><option value="pat_margin">PAT margin</option><option value="annualized_o2c_ebitda">O2C EBITDA, annualized from H1</option></select></label><label>Target quarter<input name="target_period" required pattern="FY20[0-9]{2}-Q[1-4]" placeholder="FY2027-Q1"/></label><label>Statement basis<select value={statementBasis} onChange={event=>setStatementBasis(event.target.value as 'consolidated'|'standalone')}><option value="consolidated">Consolidated</option><option value="standalone">Standalone</option></select></label><label>Figure type<select value={figureType} onChange={event=>setFigureType(event.target.value as 'reported'|'adjusted')}><option value="reported">Reported</option><option value="adjusted">Adjusted</option></select></label><label>Guidance value<input name="target_value" type="number" step="any" required placeholder="15"/></label><label>Unit<input name="unit" required placeholder="% or ₹ crore"/></label><label>Guidance page<input name="page" type="number" min="1" max={selectedDocument.pages} required placeholder="PDF page number"/></label><label className="promise-quote">Management’s exact guidance<input name="quote" required minLength={10} maxLength={1200} placeholder="Transcribe the commitment from the selected source"/></label><button type="submit">Track commitment / revision</button></form>
              {promiseMessage&&<p className="workflow-message">{promiseMessage}</p>}
              {promiseTrackRecord&&<div className="promise-track-record"><b>Historical guidance outcomes</b><span>{promiseTrackRecord.completed_count} completed guidance items · {promiseTrackRecord.achieved_count} achieved/exceeded · {promiseTrackRecord.missed_count} below</span>{promiseTrackRecord.achievement_rate_pct!==null&&<strong>{promiseTrackRecord.achievement_rate_pct}% achieved or exceeded</strong>}{promiseTrackRecord.mean_absolute_deviation_pct!==null&&<span>Mean absolute deviation from guidance: {promiseTrackRecord.mean_absolute_deviation_pct}%</span>}<small>{promiseTrackRecord.achievement_rate_pct===null?`At least ${promiseTrackRecord.minimum_sample} completed, current guidance items are needed for a rate.`:promiseTrackRecord.note}</small></div>}
              {promiseRows.length>0?<div className="promise-list">{promiseRows.map(item=><article className="promise-card" key={item.id}><div className="promise-card-head"><b>{labelCategory(item.metric)} · {item.target_period} · v{item.revision??1}</b><span className={`promise-status ${item.is_current_guidance?'current-guidance':'superseded-guidance'}`}>{item.is_current_guidance?promiseStatusLabel(item.status):'revised guidance'}</span></div><p>Guidance: {item.target_value.toLocaleString('en-IN')} {item.unit} · {item.statement_basis??'consolidated'} · {item.figure_type??'reported'}{item.adjustment_note?` · ${item.adjustment_note}`:''} <span>·</span> Actual: {item.status==='unit_mismatch'?'Unit mismatch — check guidance and actual units':item.actual_value===null?'Awaiting reported figures':`${item.actual_value.toLocaleString('en-IN')} ${item.actual_unit ?? item.unit}`}</p>{item.deviation!==null&&<p>Difference: {item.deviation>0?'+':''}{item.deviation.toFixed(2)} {item.actual_unit ?? item.unit}</p>}<blockquote>“{item.quote}”</blockquote>{item.metric==='annualized_o2c_ebitda'&&<p>Annualized H1 run-rate estimate: 2 × (Q1 plus Q2 O2C EBITDA). This is not a full-year forecast.</p>}<small>Guidance source: {item.source.filename} · PDF p.{item.source.page} {citationHref({...item.source,page:item.source.page})&&<a href={citationHref({...item.source,page:item.source.page})} target="_blank" rel="noreferrer">Open exact page ↗</a>}{item.actual_sources.map((source,index)=><span key={`${source.filename}-${index}`}> · Actual: {source.filename} p.{source.page} {citationHref({...source,page:source.page})&&<a href={citationHref({...source,page:source.page})} target="_blank" rel="noreferrer">Open page ↗</a>}</span>)}</small></article>)}</div>:<div className="state-card">No management commitments logged yet. Add an explicit target and source passage above. Actual status stays pending until you enter that quarter’s financials.</div>}
            </div>

            <div className="research-subsection" hidden={researchTab!=='analysis'}><div className="section-heading"><div><h3>Bull vs bear</h3><p>Build a balanced view from the uploaded annual reports, results, and concall transcripts.</p></div><button className="link-button" onClick={()=>void buildBullBear()} disabled={bullBearBusy}>{bullBearBusy?'Retrieving evidence…':'Build analysis'} <ArrowRight size={14}/></button></div>
              {!aiEnabled&&<p className="workflow-message">Local analysis is active without a model. For generated synthesis, FINN supports an optional local Ollama model or a hosted provider.</p>}
              {bullBear&&<div className="research-answer"><div className="answer-heading"><Sparkles size={16}/><b>{bullBear.mode==='ai_grounded'?'AI bull vs bear analysis':bullBear.mode==='local_analysis'?'Local bull vs bear analysis':'Evidence for bull and bear review'}</b></div>{bullBear.evidence_quality&&<div className={`evidence-quality ${bullBear.evidence_quality.coverage}`}><b>{bullBear.evidence_quality.coverage} evidence coverage · {bullBear.evidence_quality.confidence} confidence</b><span>{bullBear.evidence_quality.source_pages} pages · {bullBear.evidence_quality.documents} documents · {bullBear.evidence_quality.document_types} source types</span><small>{bullBear.evidence_quality.note}</small></div>}<p>{bullBear.answer}</p><small>FINN may conclude the evidence is mixed or insufficient. A missing case is not filled with invented claims.</small>{bullBear.sources.map(source=><details className="source-citation" key={source.id} open><summary>[{source.id}] {source.filename} · {source.document_type} · {source.reporting_period} · p. {source.page}</summary>{citationHref({...source,page:source.page})&&<a href={citationHref({...source,page:source.page})} target="_blank" rel="noreferrer">Open exact source page ↗</a>}<blockquote>{source.excerpt}</blockquote></details>)}</div>}
            </div>
          </>}
          {!selectedDocument&&researchTab!=='ask'&&<div className="state-card research-empty"><b>Add a source document to continue</b><p>Upload an annual report, quarterly result, or concall transcript in Ask FINN. The financial comparison, commitment tracker, and bull vs bear review will appear here after indexing.</p><button className="link-button" onClick={()=>setResearchTab('ask')}>Go to Ask FINN <ArrowRight size={14}/></button></div>}
        </section>
      </>}

      {active==='Portfolio'&&<>
        <div className="eyebrow"><span>PORTFOLIO WORKSPACE</span><i/> HOLDINGS & WATCHLIST</div>
        <section className="greeting page-greeting"><div><h1>Portfolio</h1><p>Track positions, check available market prices, and manage the company watchlist.</p></div></section>
        <div className="page-tabs" role="tablist" aria-label="Portfolio views">
          <button role="tab" aria-selected={portfolioTab==='holdings'} className={portfolioTab==='holdings'?'active':''} onClick={()=>selectSubview(setPortfolioTab,'holdings')}><BriefcaseBusiness size={15}/> Holdings <span>{heldCompanies.length}</span></button>
          <button role="tab" aria-selected={portfolioTab==='watchlist'} className={portfolioTab==='watchlist'?'active':''} onClick={()=>selectSubview(setPortfolioTab,'watchlist')}><Search size={15}/> Watchlist <span>{portfolio?.companies.length ?? 20}</span></button>
        </div>
        <section id="portfolio" className="portfolio-preview anchor-section">
          <div hidden={portfolioTab!=='holdings'}>
          <div className="section-heading"><div><h2>Your holdings</h2><p>{heldCompanies.length} positions · {pricedHoldings.length} with current market prices</p></div><div className="holding-heading-actions"><button className="link-button" disabled={!portfolio} onClick={()=>selectSubview(setPortfolioTab,'watchlist')}>Add or edit a holding</button>{heldCompanies.length < 15&&<button className="demo-secondary" disabled={!portfolio} onClick={addDemoPositions}>Add demo positions to reach 15</button>}<span className="market-source">{portfolio?.source ?? 'Source pending'}</span></div></div>
          {heldCompanies.length === 0 ? <div className="state-card holdings-empty"><span className="empty-icon"><BriefcaseBusiness size={21}/></span><div><b>Your holdings start here</b><p>Add a company and enter the shares and average cost you own. Or load clearly labelled sample positions for the demo.</p><div className="empty-actions"><button className="save-button" disabled={!portfolio} onClick={()=>selectSubview(setPortfolioTab,'watchlist')}>Choose a company</button><button className="cancel-button" disabled={!portfolio} onClick={addDemoPositions}>Load demo holdings</button></div><small>Holdings are saved in this browser only.</small></div></div> : <>
            <div className="holdings-summary"><article><small>Invested cost</small><b>{money(investedCapital)}</b></article><article><small>Market value{pricedHoldings.length < heldCompanies.length ? ' · partial' : ''}</small><b>{money(marketValue)}</b></article><article><small>Today’s P&amp;L{dailyPricedHoldings.length < heldCompanies.length ? ' · partial' : ''}</small><b className={todayPnl < 0 ? 'loss-value' : 'gain-value'}>{money(todayPnl)}</b></article><article><small>Unrealized P&amp;L{pricedHoldings.length < heldCompanies.length ? ' · partial' : ''}</small><b className={unrealizedPnl < 0 ? 'loss-value' : 'gain-value'}>{money(unrealizedPnl)}</b></article></div>
            <div className="positions-table"><div className="position-row position-header"><span>Company</span><span>Shares</span><span>Avg. cost</span><span>Last price</span><span>Market value</span><span>Today</span><span>Unrealized</span><span></span></div>
              {heldCompanies.map(company => {
                const position = holdings[company.ticker]
                const currentValue = company.market_status === 'available' && company.price !== undefined ? position.shares * company.price : null
                const dayPerShare = company.price !== undefined && company.previous_close !== null && company.previous_close !== undefined ? company.price - company.previous_close : null
                const dayValue = dayPerShare === null ? null : dayPerShare * position.shares
                const unrealized = currentValue === null ? null : currentValue - position.shares * position.average_cost
                return <div className="position-row" key={company.ticker}><span className="position-company"><b>{company.name}</b><small>{company.ticker} · {company.sector}{position.demo&&<strong className="demo-badge">DEMO</strong>}</small></span><span>{position.shares.toLocaleString('en-IN')}</span><span>{money(position.average_cost)}</span><span>{company.market_status === 'available' ? money(company.price) : 'Unavailable'}</span><b>{money(currentValue)}</b><b className={dayValue === null ? '' : dayValue < 0 ? 'loss-value' : 'gain-value'}>{money(dayValue)}</b><b className={unrealized === null ? '' : unrealized < 0 ? 'loss-value' : 'gain-value'}>{money(unrealized)}</b><span className="position-actions"><button onClick={()=>openHoldingEditor(company)}>Edit</button><button className="remove-action" onClick={()=>setPendingRemoval(company)}>Remove</button></span></div>
              })}
            </div>
            <p className="holdings-note">Invested cost uses saved shares × average cost for all positions. Market value, today’s P&amp;L and unrealized P&amp;L include priced positions only. {heldCompanies.some(company=>holdings[company.ticker]?.demo)?'DEMO positions are synthetic; their sample cost starts at the reference close and can therefore show near-zero initial unrealized P&amp;L. ':''}Holdings are saved in this browser; replace sample costs with actual purchase costs.</p>
          </>}
          </div>
          <div hidden={portfolioTab!=='watchlist'}>
          <div className="section-heading watchlist-heading"><div><h2>Company watchlist</h2><p>Add a company to holdings or edit its current position</p></div><span className="market-source">{filteredCompanies.length} of {portfolio?.companies.length ?? 20} companies</span></div>
          <div className="watchlist-controls"><label className="portfolio-search"><Search size={16}/><input aria-label="Search watchlist" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search name, ticker, or sector"/>{query&&<button type="button" aria-label="Clear search" onClick={()=>setQuery('')}>×</button>}</label><small>Market data: {portfolio?.source ?? 'loading'}</small></div>
          {loading&&!portfolio?<div className="state-card">Loading companies…</div>:<div className="watchlist-table"><div className="watchlist-row watchlist-header"><span>Company</span><span>Last price</span><span>Daily move</span><span>Volume vs 20-session avg.</span><span>Action</span></div>{filteredCompanies.map(company=>{const position=holdings[company.ticker];return <div className="watchlist-row" key={company.ticker}><span className="position-company"><b>{company.name}</b><small>{company.ticker} · {company.sector}</small></span><b>{company.market_status==='available'?money(company.price):'Unavailable'}</b><b className={company.change_pct!==null&&company.change_pct!==undefined?(company.change_pct<0?'loss-value':'gain-value'):''}>{company.change_pct!==null&&company.change_pct!==undefined?`${company.change_pct>0?'+':''}${company.change_pct.toFixed(2)}%`:'—'}</b><span>{company.volume_ratio_20d!==null&&company.volume_ratio_20d!==undefined?`${company.volume_ratio_20d.toFixed(2)}×`:'—'}</span><button className={`holding-action ${position?'is-held':''}`} onClick={()=>openHoldingEditor(company)}>{position?'Edit position':'Add holding'}</button></div>})}</div>}
          {!loading&&filteredCompanies.length===0&&<div className="state-card">No tracked company matches “{query}”.</div>}
          </div>
        </section>
        {holdingEditor&&<div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setHoldingEditor(null)}}><form className="holding-modal position-editor" onSubmit={saveHolding} role="dialog" aria-modal="true" aria-labelledby="holding-modal-title" aria-describedby="holding-modal-description">
          <button className="modal-close" type="button" onClick={()=>setHoldingEditor(null)} aria-label="Close position editor">×</button>
          <span className="eyebrow-mini">{holdings[holdingEditor.ticker]?'EDIT POSITION':'NEW POSITION'}</span>
          <h2 id="holding-modal-title">{holdingEditor.name}</h2>
          <p className="holding-ticker">{holdingEditor.ticker} · {holdingEditor.sector}</p>
          <p id="holding-modal-description">Enter the shares and average price you paid. Current market prices are fetched separately.</p>
          <div className="holding-market-reference"><span>Latest market price</span><b>{holdingEditor.market_status==='available'&&holdingEditor.price!==undefined?money(holdingEditor.price):'Unavailable'}</b><small>{holdingEditor.market_status==='available'?'Market data may be delayed.':'Price data is currently unavailable.'}</small></div>
          <label>Shares owned<input type="number" min="0.0001" step="any" required value={holdingShares} onChange={event=>setHoldingShares(event.target.value)} placeholder="e.g. 10" autoFocus/><small>Fractional quantities are supported.</small></label>
          <label>Average cost per share<input type="number" min="0.01" step="any" required value={holdingAverageCost} onChange={event=>setHoldingAverageCost(event.target.value)} placeholder="e.g. 2,450"/><small>Enter your purchase cost in rupees.</small></label>
          <label className="demo-choice"><input type="checkbox" checked={holdingIsDemo} onChange={event=>setHoldingIsDemo(event.target.checked)}/><span><b>Label as demo data</b><small>Use this for synthetic sample positions, not real holdings.</small></span></label>
          {holdingError&&<p className="holding-error" role="alert">{holdingError}</p>}
          <div className="modal-actions"><button type="button" className="cancel-button" onClick={()=>setHoldingEditor(null)}>Cancel</button><button type="submit" className="save-button">{holdings[holdingEditor.ticker]?'Save changes':'Add holding'}</button></div>
        </form></div>}
        {pendingRemoval&&<div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setPendingRemoval(null)}}><div className="holding-modal remove-confirm" role="alertdialog" aria-modal="true" aria-labelledby="remove-title" aria-describedby="remove-description"><span className="eyebrow-mini">REMOVE POSITION</span><h2 id="remove-title">Remove {pendingRemoval.name}?</h2><p id="remove-description">This removes the holding from this browser’s portfolio. The company stays in your watchlist.</p><div className="modal-actions"><button className="cancel-button" onClick={()=>setPendingRemoval(null)}>Keep holding</button><button className="remove-confirm-button" onClick={removeHolding}>Remove position</button></div></div></div>}
      </>}
      </div>
        <footer className="disclaimer">{portfolio?.notice ?? 'Portfolio universe for product demonstration only; not an investment recommendation.'}<span>Market data may be delayed. Research answers cite uploaded primary sources.</span></footer>
      </div>
      <nav className="mobile-nav" aria-label="Main navigation">{nav.map(({label,icon:Icon,target})=><button key={label} aria-current={active===label?'page':undefined} className={active===label?'mobile-active':''} onClick={()=>navigate(label,target)}><Icon size={19}/><span>{label}</span></button>)}</nav>
    </main>
  </div>
}
export default App
