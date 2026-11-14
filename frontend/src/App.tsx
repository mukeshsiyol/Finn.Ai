import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Bell, BriefcaseBusiness, FileText, LayoutDashboard, RefreshCw, Search, ShieldCheck, Sparkles, Target, TrendingDown, TrendingUp, Upload, Trash2, RotateCw } from 'lucide-react'
import { buildAccountHistory, deriveLedger, evaluateWatchlistAlert, loadPortfolioTransactions, positionAtDate, type LedgerPosition, type PortfolioTransaction, type TransactionKind } from './portfolioLedger'

type Company = { name: string; ticker: string; sector: string; market_status: 'available' | 'unavailable'; reason?: string; session_date?: string; price_updated_at?: string; checked_at?: string; source_name?: string; currency?: string; price?: number; previous_close?: number | null; change_pct?: number | null; volume?: number | null; average_volume_20d?: number | null; volume_ratio_20d?: number | null; unusual_volume?: boolean; unusual_price?: boolean }
type Portfolio = { source: string; retrieved_at: string; last_successful_update?: string | null; notice: string; companies: Company[]; available_count: number; alert_count: number; alerts: (Company & { alert_types?: string[] })[]; settings: { volume_multiple: number; price_move_pct: number } }
type Announcement = { id: string; company: string; ticker: string; subject: string; details: string; filed_at: string; source_url: string; source_name?: string; exchange?: string; category: string; importance: number; priority: string; rule_explanation: string; is_verified_example?: boolean }
type AlertHistoryItem = { id: string; kind: 'filing' | 'market'; ticker: string; company: string; subject?: string; details?: string; filed_at?: string; event_at: string; session_date?: string; source_url: string; source_name?: string; exchange?: string; category: string; signal_type?: string; importance: number; priority: string; rule_explanation?: string; change_pct?: number | null; price_threshold_pct?: number | null; previous_close?: number | null; volume_ratio_20d?: number | null; volume_threshold?: number | null; volume?: number | null; average_volume_20d?: number | null; price?: number | null; is_verified_example?: boolean; is_read: boolean }
type AlertView = 'all' | 'filings' | 'price' | 'volume'
type FilingFilter = 'all' | 'results' | 'corporate' | 'shareholding' | 'dividend' | 'board' | 'mergers'
type ResearchSource = { id: string; document_id?: string; source_url?: string; filename: string; document_type: string; reporting_period: string; page: number; excerpt: string }
type ResearchDocument = { id: string; company: string; ticker: string; filename: string; document_type: string; reporting_period: string; pages: number; source_url?: string; superseded_by?: string; replaces?: string; version_number?: number; indexing_status?: 'pending'|'processing'|'indexed'|'failed'; index_error?: string }
type ResearchEvidenceQuality = { coverage: 'limited'|'moderate'|'broad'; confidence: 'low'|'moderate'; quality: string; independence: string; source_domains: number; near_duplicate_passage_pairs: number; compared_passage_pairs: number; source_pages: number; documents: number; document_types: number; note: string }
type CitationFailure = { type: 'missing_source'|'page_mapping'|'unsupported_claim'; citation_id?: string; page?: number; expected_page?: number; claim?: string; reason: string }
type ResearchVerification = { status: string; failures: CitationFailure[]; note: string }
type Holding = LedgerPosition
type PricePoint = { date: string; close: number }
type PriceHistory = Record<string, PricePoint[]>
type PerformanceRange = '1D' | '1W' | '1M' | '3M' | '1Y'
type WatchlistCategory = 'Core' | 'Long-term' | 'Short-term' | 'Monitor'
type PriceTarget = { id: string; ticker: string; mode?: 'price'|'percent'; direction: 'above'|'below'|'up'|'down'|'either'; price?: number; percent?: number; active: boolean; created_at: string }
type PriceTargetEvent = { id: string; ticker: string; company: string; mode?: 'price'|'percent'; direction: 'above'|'below'|'up'|'down'|'either'; target: number; price: number; change_pct?: number; created_at: string; seen: boolean }
type Fundamentals = { ticker: string; metrics: Record<string, number|string|null>; source: string; retrieved_at: string; notice: string }
const pointCounts: Record<PerformanceRange, number> = { '1D': 2, '1W': 6, '1M': 22, '3M': 64, '1Y': 253 }
const minHistoryPoints: Record<PerformanceRange, number> = { '1D': 2, '1W': 6, '1M': 18, '3M': 52, '1Y': 240 }
type FinancialChange = { period: string; value: number | null; unit: string | null; change_pct: number | null; delta_type?: 'percentage_points'; status: 'available' | 'negative_base' | 'negative_revenue' | 'zero_base' | 'missing_data' | 'unit_mismatch' | 'non_positive_base' }
type FinancialEvidence = { document_id?: string; filename: string; page: number; excerpt?: string; source_url?: string; adjustment_note?: string; supporting_sources?: FinancialEvidence[] }
type FinancialComparison = { period: string; metrics: Record<string, { value: number; unit: string; calculated?: boolean; source: FinancialEvidence; qoq: FinancialChange; yoy: FinancialChange }> }
type PromiseComparison = { id: string; metric: string; target_period: string; target_value: number; unit: string; quote: string; revision?: number; is_current_guidance?: boolean; statement_basis?: string; figure_type?: string; adjustment_note?: string; source: { document_id?: string; filename: string; page: number; source_url?: string }; actual_value: number | null; actual_unit: string | null; deviation: number | null; status: string; actual_sources: { document_id?: string; filename: string; page: number; excerpt: string; source_url?: string }[] }
type PromiseTrackRecord = { completed_count: number; achieved_count: number; missed_count: number; achievement_rate_pct: number | null; mean_absolute_deviation_pct: number | null; minimum_sample: number; note: string }
type FinancialEvidenceRecord = { id: string; evidence_kind: 'financial_value'|'management_guidance'; company?: string; ticker: string; metric: string; period?: string; target_period?: string; value?: number; target_value?: number; unit: string; quote?: string; statement_basis: string; figure_type: string; adjustment_note?: string; source: FinancialEvidence }

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
const signedMoney = (value: number) => `${value > 0 ? '+' : ''}${money(value)}`
const tickerKey = (ticker: string) => ticker.toUpperCase().replace(/\.(NS|BO)$/, '')
const shortDate = (date?: string | null) => date ? new Date(`${date.slice(0,10)}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'date unavailable'
const changeValue = (change: FinancialChange) => ['available','negative_base'].includes(change.status) && change.change_pct !== null ? `${change.change_pct > 0 ? '+' : ''}${change.change_pct.toFixed(2)}${change.delta_type==='percentage_points'?' pp':'%'}` : ({ missing_data: 'Data missing', unit_mismatch: 'Unit mismatch', zero_base: 'Undefined · zero base', negative_revenue: 'Not comparable', non_positive_base: 'Not comparable', negative_base: 'Not calculated', available: 'Not calculated' }[change.status])
const changeNote = (change: FinancialChange, currentUnit: string) => change.status === 'missing_data' ? `${change.period} has not been entered` : change.status === 'unit_mismatch' ? `${change.period} · ${change.unit ?? 'unknown unit'} vs ${currentUnit}` : change.status === 'zero_base' ? `${change.period} · percentage undefined for zero base` : change.status === 'negative_base' ? `${change.period} · change relative to absolute prior value` : change.status === 'negative_revenue' ? `${change.period} · margin is not comparable against negative revenue` : change.period
const promiseStatusLabel = (status: string) => ({ achieved: 'achieved', exceeded: 'exceeded', missed: 'missed', pending: 'pending period', actual_missing: 'actual not entered', not_comparable: 'not comparable' }[status] ?? status.replaceAll('_',' '))
const citationFailureLabel = (type: CitationFailure['type']) => ({ missing_source: 'Missing source', page_mapping: 'Page mapping mismatch', unsupported_claim: 'Unsupported or uncited claim' }[type])
const returnFor = (rows: PricePoint[], points: number) => rows.length >= points ? (rows.at(-1)!.close / rows.at(-points)!.close - 1) * 100 : null
const staleSession = (date?: string) => !date || (Date.now() - Date.parse(`${date}T00:00:00Z`)) / 86400000 > 5

function App() {
  const [active, setActive] = useState(pageFromUrl)
  const [alertsTab, setAlertsTab] = useState<AlertView>('all')
  const [filingFilter, setFilingFilter] = useState<FilingFilter>('all')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [researchTab, setResearchTab] = useState<'ask' | 'financials' | 'commitments' | 'analysis'>('ask')
  const [portfolioTab, setPortfolioTab] = useState<'holdings' | 'watchlist' | 'activity'>('holdings')
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [priceHistory, setPriceHistory] = useState<PriceHistory>({})
  const [historyLoading, setHistoryLoading] = useState(false)
  const [performanceRange, setPerformanceRange] = useState<PerformanceRange>('1M')
  const [historyCoverageOpen, setHistoryCoverageOpen] = useState(false)
  const [accountHistory, setAccountHistory] = useState<PriceHistory>({})
  const [accountHistoryLoading, setAccountHistoryLoading] = useState(false)
  const [benchmarkHistory, setBenchmarkHistory] = useState<PricePoint[]>([])
  const [benchmarkMessage, setBenchmarkMessage] = useState('')
  const [accountRange, setAccountRange] = useState<'1W'|'1M'|'3M'|'1Y'>('1M')
  const [watchlistHistory, setWatchlistHistory] = useState<PriceHistory>({})
  const [watchlistCategories, setWatchlistCategories] = useState<Record<string,WatchlistCategory>>(() => { try { return JSON.parse(localStorage.getItem('finn-watchlist-categories-v1') || '{}') } catch { return {} } })
  const [trackedTickers, setTrackedTickers] = useState<string[] | null>(() => { try { const saved=localStorage.getItem('finn-watchlist-v1'); return saved===null?null:JSON.parse(saved) } catch { return null } })
  const [customCompanies, setCustomCompanies] = useState<Company[]>(() => { try { return JSON.parse(localStorage.getItem('finn-watchlist-custom-v1') || '[]') } catch { return [] } })
  const [watchlistAlerts, setWatchlistAlerts] = useState<PriceTarget[]>(() => { try { return JSON.parse(localStorage.getItem('finn-price-alerts-v1') || '[]') } catch { return [] } })
  const [watchlistAlertEvents, setWatchlistAlertEvents] = useState<PriceTargetEvent[]>(() => { try { return JSON.parse(localStorage.getItem('finn-price-alert-events-v1') || '[]') } catch { return [] } })
  const [watchlistManageOpen, setWatchlistManageOpen] = useState(false)
  const [watchlistCategoryFilter, setWatchlistCategoryFilter] = useState<'All'|WatchlistCategory>('All')
  const [watchlistAddName, setWatchlistAddName] = useState('')
  const [watchlistAddTicker, setWatchlistAddTicker] = useState('')
  const [watchlistAddSector, setWatchlistAddSector] = useState('')
  const [priceAlertTarget, setPriceAlertTarget] = useState<Company|null>(null)
  const [priceAlertMode, setPriceAlertMode] = useState<'price'|'percent'>('price')
  const [priceAlertDirection, setPriceAlertDirection] = useState<'above'|'below'|'up'|'down'|'either'>('above')
  const [priceAlertValue, setPriceAlertValue] = useState('')
  const [priceAlertError, setPriceAlertError] = useState('')
  const [fundamentalCompany, setFundamentalCompany] = useState<Company|null>(null)
  const [fundamentals, setFundamentals] = useState<Fundamentals|null>(null)
  const [fundamentalsLoading, setFundamentalsLoading] = useState(false)
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
  const [researchAllCompanySources, setResearchAllCompanySources] = useState(false)
  const [researchAnswer, setResearchAnswer] = useState('')
  const [researchMode, setResearchMode] = useState('')
  const [researchSources, setResearchSources] = useState<ResearchSource[]>([])
  const [researchVerification, setResearchVerification] = useState<ResearchVerification|null>(null)
  const [researchBusy, setResearchBusy] = useState(false)
  const [researchMessage, setResearchMessage] = useState('')
  const [researchFilename, setResearchFilename] = useState('')
  const [documentSearch, setDocumentSearch] = useState('')
  const [documentTypeFilter, setDocumentTypeFilter] = useState('all')
  const [replaceTargetId, setReplaceTargetId] = useState('')
  const [documentActionMessage, setDocumentActionMessage] = useState('')
  const [documentUploadState, setDocumentUploadState] = useState<{ filename: string; status: 'pending'|'processing'|'indexed'|'failed'; message: string } | null>(null)
  const replaceInput = useRef<HTMLInputElement>(null)
  const [statementBasis, setStatementBasis] = useState<'consolidated'|'standalone'>('consolidated')
  const [figureType, setFigureType] = useState<'reported'|'adjusted'>('reported')
  const [adjustmentNote, setAdjustmentNote] = useState('')
  const [financialChartMetric, setFinancialChartMetric] = useState('revenue')
  const [financialChartRange, setFinancialChartRange] = useState<4|8>(8)
  const [financialEntryPeriod, setFinancialEntryPeriod] = useState('')
  const [financialPeriods, setFinancialPeriods] = useState<FinancialComparison[]>([])
  const [financialEvidence, setFinancialEvidence] = useState<FinancialEvidenceRecord[]>([])
  const [financialMessage, setFinancialMessage] = useState('')
  const [promiseRows, setPromiseRows] = useState<PromiseComparison[]>([])
  const [promiseTrackRecord, setPromiseTrackRecord] = useState<PromiseTrackRecord | null>(null)
  const [promiseMessage, setPromiseMessage] = useState('')
  const [bullBear, setBullBear] = useState<{ mode: string; answer: string; sources: ResearchSource[]; evidence_quality?: ResearchEvidenceQuality; verification?: ResearchVerification } | null>(null)
  const [bullBearBusy, setBullBearBusy] = useState(false)
  const [transactions, setTransactions] = useState<PortfolioTransaction[]>(loadPortfolioTransactions)
  const ledger = useMemo(() => deriveLedger(transactions), [transactions])
  const holdings = ledger.positions
  const [holdingEditor, setHoldingEditor] = useState<Company | null>(null)
  const [holdingShares, setHoldingShares] = useState('')
  const [holdingTradePrice, setHoldingTradePrice] = useState('')
  const [holdingFees, setHoldingFees] = useState('0')
  const [holdingTradeDate, setHoldingTradeDate] = useState(new Date().toLocaleDateString('en-CA'))
  const [holdingTradeKind, setHoldingTradeKind] = useState<'buy'|'sell'>('buy')
  const [holdingIsDemo, setHoldingIsDemo] = useState(false)
  const [holdingError, setHoldingError] = useState('')
  const [activityKind,setActivityKind]=useState<Exclude<TransactionKind,'buy'|'sell'>>('dividend')
  const [activityTicker,setActivityTicker]=useState('')
  const [activityDate,setActivityDate]=useState(new Date().toLocaleDateString('en-CA'))
  const [activityRecordDate,setActivityRecordDate]=useState(new Date().toLocaleDateString('en-CA'))
  const [activityAmount,setActivityAmount]=useState('')
  const [activityRatio,setActivityRatio]=useState('')
  const [activityNote,setActivityNote]=useState('')
  const [activityError,setActivityError]=useState('')
  const [activityMessage,setActivityMessage]=useState('')

  useEffect(() => { localStorage.setItem('finn-transactions-v1', JSON.stringify(transactions)) }, [transactions])
  useEffect(() => { if (trackedTickers) localStorage.setItem('finn-watchlist-v1', JSON.stringify(trackedTickers)) }, [trackedTickers])
  useEffect(() => { localStorage.setItem('finn-watchlist-categories-v1', JSON.stringify(watchlistCategories)) }, [watchlistCategories])
  useEffect(() => { localStorage.setItem('finn-watchlist-custom-v1', JSON.stringify(customCompanies)) }, [customCompanies])
  useEffect(() => { localStorage.setItem('finn-price-alerts-v1', JSON.stringify(watchlistAlerts)) }, [watchlistAlerts])
  useEffect(() => { localStorage.setItem('finn-price-alert-events-v1', JSON.stringify(watchlistAlertEvents)) }, [watchlistAlertEvents])

  useEffect(() => {
    if (!holdingEditor) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHoldingEditor(null)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [holdingEditor])

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
      if (trackedTickers === null) setTrackedTickers(result.companies.map(company => company.ticker))
      const lastCompletedSession = result.companies.find(company => company.session_date)?.session_date
      if (lastCompletedSession && transactions.some(item => item.note?.includes('Opening balance migrated'))) {
        setTransactions(current => current.map(item => item.note?.includes('Opening balance migrated') || item.note?.includes('Opening position migrated') ? { ...item, date: lastCompletedSession } : item))
      }
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

  const allCompanies = useMemo(() => [...(portfolio?.companies ?? []), ...customCompanies], [portfolio, customCompanies])
  const trackedCompanies = useMemo(() => {
    const tickers = trackedTickers ?? portfolio?.companies.map(company=>company.ticker) ?? []
    return allCompanies.filter(company=>tickers.includes(company.ticker))
  }, [allCompanies, trackedTickers, portfolio])
  const filteredCompanies = useMemo(() => {
    const list = trackedCompanies
    const search = query.trim().toLowerCase()
    if (!search) return list
    return list.filter(company => `${company.name} ${company.ticker} ${company.sector}`.toLowerCase().includes(search))
  }, [trackedCompanies, query])
  useEffect(() => {
    const customTickers = trackedCompanies.filter(company=>customCompanies.some(item=>item.ticker===company.ticker)).map(company=>company.ticker)
    if (!customTickers.length) return
    const controller = new AbortController()
    fetch(`${API}/api/portfolio/quotes?tickers=${encodeURIComponent(customTickers.join(','))}`,{signal:controller.signal})
      .then(response=>response.ok?response.json():Promise.reject(new Error('Custom watchlist quotes unavailable')))
      .then(payload=>setCustomCompanies(current=>current.map(company=>payload.companies?.find((value:Company)=>value.ticker===company.ticker)??company)))
      .catch(error=>{if(error.name!=='AbortError')undefined})
    return ()=>controller.abort()
  }, [trackedTickers, customCompanies.length, portfolio?.retrieved_at])
  useEffect(() => {
    if (portfolioTab!=='watchlist'||!trackedCompanies.length) return
    const tickers=trackedCompanies.map(company=>company.ticker).slice(0,20)
    const controller=new AbortController()
    fetch(`${API}/api/portfolio/history?tickers=${encodeURIComponent(tickers.join(','))}&period=1y&basis=adjusted`,{signal:controller.signal})
      .then(response=>response.ok?response.json():Promise.reject(new Error('Watchlist history unavailable')))
      .then(payload=>setWatchlistHistory(payload.histories??{}))
      .catch(error=>{if(error.name!=='AbortError')setWatchlistHistory({})})
    return ()=>controller.abort()
  }, [portfolioTab, trackedCompanies.map(company=>company.ticker).join(',')])
  const accountTickerKey=useMemo(()=>Object.keys(holdings).sort().join(','),[holdings])
  useEffect(() => {
    if (active!=='Portfolio'||!accountTickerKey) { setAccountHistory({}); return }
    const controller=new AbortController()
    setAccountHistoryLoading(true)
    fetch(`${API}/api/portfolio/history?tickers=${encodeURIComponent(accountTickerKey)}&period=5y&basis=raw`,{signal:controller.signal})
      .then(response=>response.ok?response.json():Promise.reject(new Error('Transaction history prices are unavailable')))
      .then(payload=>setAccountHistory(payload.histories??{}))
      .catch(error=>{if(error.name!=='AbortError')setAccountHistory({})})
      .finally(()=>{if(!controller.signal.aborted)setAccountHistoryLoading(false)})
    return ()=>controller.abort()
  }, [active,accountTickerKey])
  useEffect(() => {
    if(active!=='Portfolio')return
    const controller=new AbortController()
    fetch(`${API}/api/portfolio/benchmark?period=5y`,{signal:controller.signal})
      .then(response=>response.ok?response.json():Promise.reject(new Error('NIFTY 50 history is unavailable')))
      .then(payload=>{setBenchmarkHistory(payload.history??[]);setBenchmarkMessage('')})
      .catch(error=>{if(error.name!=='AbortError'){setBenchmarkHistory([]);setBenchmarkMessage(error instanceof Error?error.message:'Benchmark history unavailable')}})
    return ()=>controller.abort()
  }, [active])
  useEffect(() => {
    if(!portfolio)return
    let previous:Record<string,number>={}
    try{previous=JSON.parse(localStorage.getItem('finn-watchlist-observed-prices-v1')||'{}')}catch{}
    const next={...previous}
    const events:PriceTargetEvent[]=[]
    for(const company of trackedCompanies){
      if(company.market_status!=='available'||!Number.isFinite(company.price))continue
      const after=company.price as number
      if(staleSession(company.session_date)){next[company.ticker]=after;continue}
      const before=previous[company.ticker]
      for(const alert of watchlistAlerts.filter(item=>item.active&&item.ticker===company.ticker)){
        const isPercent=alert.mode==='percent'
        const change=company.change_pct
        const threshold=isPercent?(alert.percent??0):(alert.price??0)
        const crossed=evaluateWatchlistAlert(alert,after,before,change)
        const id=`${alert.id}:${company.session_date??company.price_updated_at??portfolio.retrieved_at}`
        if(crossed&&!watchlistAlertEvents.some(item=>item.id===id))events.push({id,ticker:company.ticker,company:company.name,mode:isPercent?'percent':'price',direction:alert.direction,target:threshold,price:after,change_pct:change??undefined,created_at:company.price_updated_at??portfolio.retrieved_at,seen:false})
      }
      next[company.ticker]=after
    }
    localStorage.setItem('finn-watchlist-observed-prices-v1',JSON.stringify(next))
    if(events.length)setWatchlistAlertEvents(current=>[...events,...current].slice(0,100))
  }, [portfolio?.retrieved_at,trackedCompanies,watchlistAlerts])
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
  const missingHistoricalInputs = useMemo(() => {
    const found = new Map<string,{ metric:string; period:string; comparison_period:string; comparison:string }>()
    for (const period of financialPeriods) for (const [metric,data] of Object.entries(period.metrics)) for (const [comparison,change] of [['QoQ',data.qoq],['YoY',data.yoy]] as const) {
      if (change.status === 'missing_data') found.set(`${metric}-${change.period}`, { metric, period: change.period, comparison_period: period.period, comparison })
    }
    return Array.from(found.values())
  }, [financialPeriods])
  const missingHistoricalGroups = useMemo(() => {
    const groups = new Map<string, typeof missingHistoricalInputs>()
    for (const item of missingHistoricalInputs) {
      const group = groups.get(item.period) ?? []
      group.push(item)
      groups.set(item.period, group)
    }
    return Array.from(groups, ([period, items]) => ({ period, items }))
  }, [missingHistoricalInputs])
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
      setFinancialEvidence([])
      setPromiseRows([])
      setPromiseTrackRecord(null)
      return
    }
    const ticker = encodeURIComponent(selectedDocument.ticker)
    fetch(`${API}/api/research/financials?ticker=${ticker}&statement_basis=${statementBasis}&figure_type=${figureType}&adjustment_note=${encodeURIComponent(adjustmentNote)}`).then(response => response.ok ? response.json() : null).then(payload => setFinancialPeriods(payload?.periods ?? [])).catch(() => setFinancialPeriods([]))
    fetch(`${API}/api/research/evidence?ticker=${ticker}`).then(response => response.ok ? response.json() : null).then(payload => setFinancialEvidence(payload?.records ?? [])).catch(() => setFinancialEvidence([]))
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
  const pricedHoldings = heldCompanies.filter(company => company.market_status === 'available' && Number.isFinite(company.price) && !staleSession(company.session_date))
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
      const freshCurrentPrice=company.market_status === 'available' && Number.isFinite(company.price) && !staleSession(company.session_date)
      const scale = freshCurrentPrice && company.price && lastAdjusted ? company.price / lastAdjusted : 1
      return { company, rows: rawRows.map(row => ({...row, close: row.close * scale})), currentPriceAvailable: freshCurrentPrice }
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
  const currentAccountHistory=useMemo(()=>{
    const next:PriceHistory=Object.fromEntries(Object.entries(accountHistory).map(([ticker,rows])=>[ticker,rows.slice()]))
    for(const company of heldCompanies){
      if(company.market_status!=='available'||!Number.isFinite(company.price)||!company.session_date||staleSession(company.session_date))continue
      const rows=next[company.ticker]??[]
      const same=rows.findIndex(row=>row.date===company.session_date)
      if(same>=0)rows[same]={date:company.session_date,close:company.price as number}
      else rows.push({date:company.session_date,close:company.price as number})
      next[company.ticker]=rows
    }
    return next
  },[accountHistory,heldCompanies])
  const accountPoints=useMemo(()=>buildAccountHistory(transactions,currentAccountHistory),[transactions,currentAccountHistory])
  const researchVerificationWithFailures=researchVerification&&researchVerification.failures.length>0?researchVerification:null
  const bullBearVerificationWithFailures=bullBear?.verification&&bullBear.verification.failures.length>0?bullBear.verification:null
  const accountRangeCount={'1W':5,'1M':22,'3M':64,'1Y':252} as const
  const accountChartPoints=useMemo(()=>accountPoints.slice(-accountRangeCount[accountRange]),[accountPoints,accountRange])
  const accountReturn=useMemo(()=>{
    const first=accountChartPoints[0]?.return_index,last=accountChartPoints.at(-1)?.return_index
    return first&&last!==undefined?(last/first-1)*100:null
  },[accountChartPoints])
  const accountBenchmarkReturn=useMemo(()=>{
    const firstDate=accountChartPoints[0]?.date,lastDate=accountChartPoints.at(-1)?.date
    if(!firstDate||!lastDate||!benchmarkHistory.length)return null
    const base=benchmarkHistory.filter(point=>point.date<=firstDate).at(-1)??benchmarkHistory.find(point=>point.date>=firstDate)
    const last=benchmarkHistory.filter(point=>point.date<=lastDate).at(-1)
    return base&&last&&base.close?(last.close/base.close-1)*100:null
  },[accountChartPoints,benchmarkHistory])
  const accountRisk=useMemo(()=>{
    const returns=accountPoints.slice(-253).map(point=>point.daily_return).filter(value=>Number.isFinite(value))
    const mean=returns.length?returns.reduce((sum,value)=>sum+value,0)/returns.length:0
    const volatility=returns.length>1?Math.sqrt(returns.reduce((sum,value)=>sum+(value-mean)**2,0)/(returns.length-1))*Math.sqrt(252)*100:null
    let peak=0,maxDrawdown=0
    for(const point of accountPoints){peak=Math.max(peak,point.return_index);if(peak>0)maxDrawdown=Math.min(maxDrawdown,point.return_index/peak-1)}
    return {volatility,maxDrawdown:accountPoints.length?maxDrawdown*100:null,observations:returns.length}
  },[accountPoints])
  const accountChartGeometry=useMemo(()=>{
    if(accountChartPoints.length<2)return ''
    const values=accountChartPoints.map(point=>point.return_index)
    const low=Math.min(...values),high=Math.max(...values),span=high-low||1
    return values.map((value,index)=>`${12+index*736/(values.length-1)},${184-(value-low)*152/span}`).join(' ')
  },[accountChartPoints])
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
  const latestSessionDate = portfolio?.companies.map(company => company.session_date).filter((date): date is string => Boolean(date)).sort().at(-1) ?? null
  const latestSessionIsStale = latestSessionDate ? staleSession(latestSessionDate) : true
  const latestPortfolioUpdate = portfolio?.last_successful_update ?? portfolio?.retrieved_at ?? null
  const trackedTickerSet = new Set([...trackedCompanies, ...heldCompanies].map(company => tickerKey(company.ticker)))
  const homePriorityAlerts = useMemo(() => alertHistory
    .filter(item => trackedTickerSet.has(tickerKey(item.ticker)))
    .sort((a,b) => {
      const priorityRank = { high: 0, medium: 1, routine: 2 }
      const priority = (priorityRank[a.priority as keyof typeof priorityRank] ?? 3) - (priorityRank[b.priority as keyof typeof priorityRank] ?? 3)
      return priority || Date.parse(b.event_at) - Date.parse(a.event_at)
    }).slice(0,3), [alertHistory, trackedCompanies, heldCompanies])
  const homeAnnouncement = announcements.find(item => trackedTickerSet.has(tickerKey(item.ticker)))
  const homeAnnouncementAlreadyShown = Boolean(homeAnnouncement && homePriorityAlerts.some(item => item.kind === 'filing' && tickerKey(item.ticker) === tickerKey(homeAnnouncement.ticker) && item.subject === homeAnnouncement.subject))
  const watchlistPricedCount = trackedCompanies.filter(company => company.market_status === 'available' && Number.isFinite(company.price) && !staleSession(company.session_date)).length
  const marketStatusLabel = !portfolio ? (marketError ? 'Prices unavailable' : 'Loading prices') : !portfolio.available_count ? 'No current prices' : latestSessionDate ? `${latestSessionIsStale ? 'Stale quotes' : 'Quote session'} · ${shortDate(latestSessionDate)}` : 'Quote date unavailable'
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
    document.querySelector('.alerts-page > .content')?.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
    requestAnimationFrame(() => document.querySelector('.research-page > .content')?.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }))
  }

  function selectSubview<T extends string>(setSubview: (value: T) => void, value: T) {
    setSubview(value)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
    document.querySelector('.research-page > .content')?.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
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
    setDocumentUploadState({ filename: file.name, status: 'pending', message: 'Waiting to index' })
    setResearchMessage('Extracting pages and indexing the primary source…')
    setDocumentUploadState({ filename: file.name, status: 'processing', message: 'Validating PDF and indexing pages' })
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
      setResearchVerification(null)
      setDocumentActionMessage('')
      setDocumentUploadState({ filename: payload.filename, status: 'indexed', message: `Indexed · ${payload.pages} pages` })
    } catch (error) {
      setResearchMessage(error instanceof Error ? error.message : 'Could not upload the document.')
      setDocumentUploadState({ filename: file.name, status: 'failed', message: error instanceof Error ? error.message : 'Indexing failed' })
    } finally { setResearchBusy(false) }
  }

  async function deleteResearchDocument(doc: ResearchDocument) {
    try {
      const dependencyResponse = await fetch(`${API}/api/research/documents/${encodeURIComponent(doc.id)}/dependencies`)
      const dependencies = await dependencyResponse.json().catch(() => ({}))
      if (!dependencyResponse.ok) throw new Error(dependencies.detail || 'Could not check document dependencies.')
      const warning = `Delete ${doc.filename} (version ${doc.version_number ?? 1})?\n\nThis source is used by ${dependencies.financial_figures ?? 0} financial figures and ${dependencies.guidance_records ?? 0} management guidance records. Linked entries and their citations will also be removed. Other document versions are kept.`
      if (!window.confirm(warning)) return
      setDocumentActionMessage('Removing the document and linked records…')
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
    setDocuments(current => current.map(item => item.id === doc.id ? { ...item, indexing_status: 'processing', index_error: undefined } : item))
    try {
      const response = await fetch(`${API}/api/research/documents/${encodeURIComponent(doc.id)}/reindex`, { method: 'POST' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || 'Could not re-index this PDF.')
      await loadDocuments(doc.id)
      setDocumentActionMessage(`${doc.filename} re-indexed · ${payload.pages} pages`)
    } catch (error) { await loadDocuments().catch(() => undefined); setDocumentActionMessage(error instanceof Error ? error.message : 'Could not re-index this PDF.') }
  }

  async function replaceResearchDocument(event: any) {
    const file = event.currentTarget.files?.[0] as File | undefined
    const doc = documents.find(item => item.id === replaceTargetId)
    event.currentTarget.value = ''
    if (!file || !doc) return
    if (file.size > 45 * 1024 * 1024) { setDocumentActionMessage('This PDF is larger than the 45 MB upload limit.'); return }
    setDocumentUploadState({ filename: file.name, status: 'processing', message: 'Replacing and indexing document version' })
    const form = new FormData()
    form.set('company', doc.company); form.set('ticker', doc.ticker); form.set('document_type', doc.document_type); form.set('reporting_period', doc.reporting_period); form.set('source_url', doc.source_url ?? ''); form.set('file', file)
    setDocumentActionMessage(`Replacing ${doc.filename}…`)
    try {
      const response = await fetch(`${API}/api/research/documents/${encodeURIComponent(doc.id)}`, { method: 'PUT', body: form })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || 'Could not replace this document.')
      await loadDocuments(payload.id)
      setResearchAnswer(''); setResearchSources([])
      setDocumentActionMessage(`${payload.filename} indexed as version ${payload.version_number ?? 2}.`)
      setDocumentUploadState({ filename: payload.filename, status: 'indexed', message: `Indexed · version ${payload.version_number ?? 2}` })
    } catch (error) { setDocumentActionMessage(error instanceof Error ? error.message : 'Could not replace this document.'); setDocumentUploadState({ filename: file.name, status: 'failed', message: error instanceof Error ? error.message : 'Replacement failed' }) }
    finally { setReplaceTargetId('') }
  }

  async function askResearch(event: any) {
    event.preventDefault()
    if (!documentId) { setResearchMessage('Upload a primary-source PDF first.'); return }
    setResearchBusy(true)
    setResearchMessage('Searching the selected source…')
    try {
      const requestScope = researchAllCompanySources && selectedDocument ? { ticker: selectedDocument.ticker } : { document_id: documentId }
      const response = await fetch(`${API}/api/research/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...requestScope, question: researchQuestion }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || 'Research query failed.')
      setResearchAnswer(payload.answer)
      setResearchMode(payload.mode)
      setResearchSources(payload.sources)
      setResearchVerification(payload.verification ?? null)
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
      await refreshFinancialEvidence(selectedDocument.ticker)
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

  async function refreshFinancialEvidence(ticker: string) {
    try {
      const response = await fetch(`${API}/api/research/evidence?ticker=${encodeURIComponent(ticker)}`)
      const payload = await response.json()
      if (response.ok) setFinancialEvidence(payload.records ?? [])
    } catch { /* Keep the research views usable if the evidence ledger refresh fails. */ }
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
      await refreshFinancialEvidence(selectedDocument.ticker)
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

  function openHoldingEditor(company: Company, kind: 'buy'|'sell' = 'buy', allShares = false) {
    const current = holdings[company.ticker]
    setHoldingShares(current && (kind==='sell'||allShares) ? String(current.shares) : '')
    setHoldingTradePrice(company.price?String(company.price):'')
    setHoldingFees('0')
    setHoldingTradeDate(company.session_date??new Date().toLocaleDateString('en-CA'))
    setHoldingTradeKind(kind)
    setHoldingIsDemo(Boolean(current?.demo))
    setHoldingError('')
    setHoldingEditor(company)
  }

  function saveHolding(event: any) {
    event.preventDefault()
    if (!holdingEditor) return
    const shares = Number(holdingShares)
    const price = Number(holdingTradePrice)
    const fees = Number(holdingFees)
    const current = positionAtDate(transactions,holdingEditor.ticker,holdingTradeDate)
    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(price) || price <= 0 || !Number.isFinite(fees) || fees < 0) {
      setHoldingError('Enter a positive quantity and trade price, and non-negative fees.')
      return
    }
    if (holdingTradeKind==='sell'&&(!current||shares>current.shares+1e-8)) { setHoldingError('You cannot sell more shares than were held on the selected trade date.'); return }
    const transaction:PortfolioTransaction={id:`trade-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,date:holdingTradeDate,kind:holdingTradeKind,ticker:holdingEditor.ticker,quantity:shares,price,fees,note:holdingIsDemo?'Demo transaction':undefined,demo:holdingIsDemo}
    const next:PortfolioTransaction[]=[]
    if(holdingTradeKind==='buy'){
      const cash=deriveLedger(transactions.filter(item=>item.date<=holdingTradeDate)).cash
      const funding=shares*price+fees-cash
      if(funding>0)next.push({id:`fund-${Date.now().toString(36)}`,date:holdingTradeDate,kind:'deposit',amount:funding,note:'Auto-funded buy · edit with the actual transfer amount',auto:true,demo:holdingIsDemo})
    }
    next.push(transaction)
    setTransactions(existing=>[...existing,...next])
    setHoldingEditor(null)
    setHoldingError('')
  }

  function addDemoPositions() {
    if (!portfolio) return
    const entries:PortfolioTransaction[]=[]
    let count=Object.keys(holdings).length
    for(const company of portfolio.companies){
      if(count>=15)break
      if(holdings[company.ticker])continue
      const price=company.price&&company.price>0?company.price:100
      const date=company.session_date??new Date().toLocaleDateString('en-CA')
      entries.push({id:`demo-fund-${company.ticker}-${Date.now()}`,date,kind:'deposit',amount:10*price,note:'Demo funding',demo:true})
      entries.push({id:`demo-buy-${company.ticker}-${Date.now()}`,date,kind:'buy',ticker:company.ticker,quantity:10,price,note:'Synthetic demo opening position',demo:true})
      count++
    }
    setTransactions(existing=>[...existing,...entries])
  }

  function saveActivity(event:any){
    event.preventDefault()
    const amount=Number(activityAmount),ratio=Number(activityRatio)
    const transaction:PortfolioTransaction={id:`event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,date:activityDate,kind:activityKind,ticker:activityTicker||undefined,note:activityNote.trim()||undefined}
    if(['deposit','withdrawal','dividend'].includes(activityKind)){
      if(!Number.isFinite(amount)||amount<=0){setActivityError('Enter an amount greater than zero.');return}
      if(activityKind==='withdrawal'&&amount>deriveLedger(transactions.filter(item=>item.date<=activityDate)).cash){setActivityError('The withdrawal is larger than the recorded cash balance.');return}
      transaction.amount=amount
      if(activityKind==='dividend'&&!activityTicker){setActivityError('Choose the company that paid this dividend.');return}
      if(activityKind==='dividend'){
        if(!activityRecordDate||activityRecordDate>activityDate){setActivityError('Enter a record date on or before the dividend payment date.');return}
        const eligible=positionAtDate(transactions,activityTicker,activityRecordDate)
        if(!eligible){setActivityError('No shares are recorded on the dividend record date. Check the trade history or correct the record date.');return}
        transaction.record_date=activityRecordDate
        transaction.record_quantity=eligible.shares
      }
    }else if(activityKind==='split'||activityKind==='bonus'){
      const datedPosition=positionAtDate(transactions,activityTicker,activityDate)
      if(!activityTicker||!Number.isFinite(ratio)||ratio<=0||!datedPosition){setActivityError('Choose a company held on the selected corporate-action date and enter a valid ratio.');return}
      transaction.ratio=ratio
    }
    setTransactions(current=>[...current,transaction])
    setActivityError('')
    setActivityMessage(`${activityKind.replaceAll('_',' ')} recorded. Review it in the activity list.`)
    setActivityAmount('');setActivityRatio('');setActivityNote('')
  }

  function addCustomWatchlistCompany(event:any){
    event.preventDefault()
    const ticker=watchlistAddTicker.trim().toUpperCase()
    if(trackedCompanies.length>=20&&!trackedCompanies.some(company=>company.ticker===ticker)){setDocumentActionMessage('Watchlist limit is 20 companies. Remove one before adding another.');return}
    if(!watchlistAddName.trim()||!/^([A-Z0-9&.-]{1,15})\.(NS|BO)$/.test(ticker)){setDocumentActionMessage('Enter a company name and an Indian exchange ticker ending in .NS or .BO.');return}
    if(allCompanies.some(company=>company.ticker===ticker)){setTrackedTickers(current=>[...new Set([...(current??portfolio?.companies.map(company=>company.ticker)??[]),ticker])]);setDocumentActionMessage(`${ticker} is already available; it has been added to your watchlist.`);return}
    const company:Company={name:watchlistAddName.trim(),ticker,sector:watchlistAddSector.trim()||'Unclassified',market_status:'unavailable',reason:'Loading first quote'}
    setCustomCompanies(current=>[...current.filter(item=>item.ticker!==ticker),company])
    setTrackedTickers(current=>[...new Set([...(current??portfolio?.companies.map(item=>item.ticker)??[]),ticker])])
    setWatchlistAddName('');setWatchlistAddTicker('');setWatchlistAddSector('');setDocumentActionMessage('Company added. FINN is checking its latest price and historical returns.')
  }

  function setWatchlistCategory(ticker:string,category:WatchlistCategory){setWatchlistCategories(current=>({...current,[ticker]:category}))}
  function removeTrackedCompany(ticker:string){setTrackedTickers(current=>(current??portfolio?.companies.map(item=>item.ticker)??[]).filter(value=>value!==ticker))}
  function toggleTrackedCompany(ticker:string,checked:boolean){setTrackedTickers(current=>{const base=current??portfolio?.companies.map(item=>item.ticker)??[];if(checked&&base.length>=20&&!base.includes(ticker))return base;return checked?[...new Set([...base,ticker])]:base.filter(value=>value!==ticker)})}

  function openPriceAlert(company:Company){
    setPriceAlertTarget(company)
    const existing=watchlistAlerts.find(item=>item.ticker===company.ticker)
    setPriceAlertMode(existing?.mode??'price')
    setPriceAlertValue(String(existing?.mode==='percent'?existing.percent??5:existing?.price??company.price??''))
    setPriceAlertDirection(existing?.direction??'above')
    setPriceAlertError('')
  }
  function savePriceAlert(event:any){
    event.preventDefault()
    if(!priceAlertTarget)return
    const value=Number(priceAlertValue)
    if(!Number.isFinite(value)||value<=0||(priceAlertMode==='percent'&&value>100)){setPriceAlertError(priceAlertMode==='percent'?'Enter a percentage from 0.1% to 100%.':'Enter a price greater than zero.');return}
    const direction=priceAlertMode==='price'?(priceAlertDirection==='below'?'below':'above'):(['up','down','either'].includes(priceAlertDirection)?priceAlertDirection:'up')
    const alert:PriceTarget={id:`target-${priceAlertTarget.ticker}-${Date.now()}`,ticker:priceAlertTarget.ticker,mode:priceAlertMode,direction,...(priceAlertMode==='price'?{price:value}:{percent:value}),active:true,created_at:new Date().toISOString()}
    setWatchlistAlerts(current=>[...current.filter(item=>item.ticker!==alert.ticker),alert])
    try{const seen=JSON.parse(localStorage.getItem('finn-watchlist-observed-prices-v1')||'{}');if(priceAlertTarget.price!==undefined)seen[priceAlertTarget.ticker]=priceAlertTarget.price;localStorage.setItem('finn-watchlist-observed-prices-v1',JSON.stringify(seen))}catch{}
    setPriceAlertTarget(null)
  }
  async function openCompanyFundamentals(company:Company){
    setFundamentalCompany(company);setFundamentals(null);setFundamentalsLoading(true)
    try{const response=await fetch(`${API}/api/portfolio/fundamentals?ticker=${encodeURIComponent(company.ticker)}`);const payload=await response.json();if(!response.ok)throw new Error(payload.detail||'Fundamentals unavailable');setFundamentals(payload)}
    catch(error){setFundamentals({ticker:company.ticker,metrics:{error:error instanceof Error?error.message:'Fundamentals unavailable'},source:'Unavailable',retrieved_at:'',notice:'Retry when market data is reachable.'})}
    finally{setFundamentalsLoading(false)}
  }
  function exportPortfolio(){
    const realizedById=new Map(ledger.realized.map(item=>[item.id,item.realized_pnl]))
    const header=['Date','Type','Ticker','Quantity','Price','Fees','Amount','Record date','Record-date shares','Realized P&L','Provenance','Note']
    const rows=transactions.map(item=>[item.date,item.kind,item.ticker??'',item.quantity??'',item.price??'',item.fees??'',item.amount??'',item.record_date??'',item.record_quantity??'',realizedById.get(item.id)??'',item.origin??(item.demo?'demo':item.note?.toLowerCase().includes('migrated from saved')?'migrated_opening':'user-entered'),item.note??''])
    const csv=[header,...rows].map(row=>row.map(value=>`"${String(value).replaceAll('"','""')}"`).join(',')).join('\r\n')
    const blob=new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'})
    const href=URL.createObjectURL(blob);const link=document.createElement('a');link.href=href;link.download=`finn-portfolio-${new Date().toLocaleDateString('en-CA')}.csv`;link.click();URL.revokeObjectURL(href)
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
    <main className={`main ${active==='Alerts'?'alerts-page':''} ${active==='Research'?'research-page':''} ${active==='Portfolio'?'portfolio-page':''}`}>
      <header className="topbar"><div className="crumb">FINN <span>/</span> {active.toUpperCase()}</div><div className="top-actions"><span className={`market-status ${marketError?'status-error':latestSessionIsStale?'status-stale':'status-current'}`} role="status" aria-live="polite" aria-label={`${marketStatusLabel}${latestPortfolioUpdate?`; last successful update ${new Date(latestPortfolioUpdate).toLocaleString('en-IN')}`:''}`} title={`${portfolio?.source ?? 'Market data'}${latestPortfolioUpdate?` · last successful update ${new Date(latestPortfolioUpdate).toLocaleString('en-IN')}`:''}`}><i aria-hidden="true"/><span>{marketStatusLabel}</span></span><button className="icon-button" aria-label="Refresh market prices" onClick={()=>void loadPortfolio(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing?'spin':''}/></button><div className="avatar small">A</div></div></header>
      <div className="content" id="home">
      <div className="page-view" key={active}>
      {active==='Home'&&<>
        <div className="eyebrow"><span>FINN INVESTOR DESK</span><i/> DAILY BRIEFING</div>
        <section className="greeting"><div><h1>Today’s briefing</h1><p>Your portfolio, relevant signals, and the latest company updates.</p></div></section>
        {marketError&&<div className="error-banner" role="alert"><span>{marketError}</span><button onClick={()=>void loadPortfolio(true)}>Retry <ArrowRight size={14}/></button></div>}
        <section className="home-coverage-summary" aria-label="Watchlist price coverage">
          <div><span className="eyebrow-mini">TRACKED PRICE COVERAGE</span><strong className={trackedCompanies.length&&watchlistPricedCount<trackedCompanies.length?'coverage-partial':''}>{trackedCompanies.length?`${watchlistPricedCount}/${trackedCompanies.length}`:'—'}</strong><small>{trackedCompanies.length?'tracked companies with quotes dated within 5 days':'No companies tracked'}</small></div>
          <div className="coverage-track" aria-hidden="true"><i style={{width:`${trackedCompanies.length?Math.min(100,watchlistPricedCount/trackedCompanies.length*100):0}%`}}/></div>
          {latestPortfolioUpdate&&<small className="coverage-updated">Last successful refresh · {new Date(latestPortfolioUpdate).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'})}</small>}
          <button className="link-button" onClick={()=>{setPortfolioTab('watchlist');navigate('Portfolio','portfolio')}}>Open watchlist <ArrowRight size={14}/></button>
        </section>
        {heldCompanies.length>0&&<section className="stats-grid portfolio-snapshot" aria-label="Portfolio snapshot">
          <article className="stat-card portfolio-stat"><div className="stat-heading">Market value <span className="subtle">{pricedHoldings.length}/{heldCompanies.length} PRICED</span></div><div className="stat-value">{pricedHoldings.length?money(marketValue):'—'}</div><div className="stat-foot"><span>Latest available market prices</span></div></article>
          <article className="stat-card"><div className="stat-heading">Invested cost</div><div className="stat-value">{pricedHoldings.length?money(pricedInvestedCapital):'—'}</div><div className="stat-foot"><span>Same priced positions</span></div></article>
          <article className="stat-card daily-pnl-stat"><div className="stat-heading">Daily P&amp;L <span className="stat-icon blue"><Activity size={17}/></span></div><div className={`stat-value ${dailyPricedHoldings.length?(todayPnl<0?'loss-value':todayPnl>0?'gain-value':''):''}`}>{dailyPricedHoldings.length?signedMoney(todayPnl):'—'}</div><div className="stat-foot"><span>{dailyPricedHoldings.length}/{heldCompanies.length} holdings with both closes</span></div></article>
          <article className="stat-card"><div className="stat-heading">Unrealized P&amp;L</div><div className={`stat-value ${pricedHoldings.length?(unrealizedPnl<0?'loss-value':unrealizedPnl>0?'gain-value':''):''}`}>{pricedHoldings.length?signedMoney(unrealizedPnl):'—'}</div><div className="stat-foot"><span>Market value minus cost basis</span></div></article>
        </section>}
        {!loading&&!marketError&&heldCompanies.length===0&&<section className="home-empty-state"><span className="eyebrow-mini">NO OPEN POSITIONS</span><h2>Add holdings for a personalized portfolio briefing</h2><p>FINN will show market value, daily change, cost basis, and portfolio history when you record a holding.</p><button className="save-button" onClick={()=>{setPortfolioTab('watchlist');navigate('Portfolio','portfolio')}}>Choose a company <ArrowRight size={14}/></button></section>}
        <section className="home-attention" aria-labelledby="home-attention-title">
          <div className="section-heading"><div><h2 id="home-attention-title">Needs attention</h2><p>Recent alerts and company filings for your holdings and watchlist.</p></div><button className="link-button" onClick={()=>navigate('Alerts','alerts')}>All alerts <ArrowRight size={14}/></button></div>
          <div className="home-attention-list">
            {homePriorityAlerts.map(item=>{
              const isFiling=item.kind==='filing'
              const latestTickerQuoteDate=portfolio?.companies.find(company=>tickerKey(company.ticker)===tickerKey(item.ticker))?.session_date
              const quoteIsOlderThanAlert=Boolean(!isFiling&&item.session_date&&latestTickerQuoteDate&&item.session_date>latestTickerQuoteDate)
              const title=isFiling?item.subject??'Company filing':item.signal_type==='price_movement'?'Price movement alert':'Volume spike alert'
              const detail=isFiling?item.details:item.signal_type==='price_movement'?`Session move ${item.change_pct===null||item.change_pct===undefined?'—':`${item.change_pct>0?'+':''}${item.change_pct.toFixed(2)}%`} · compared with previous close.`:`Volume ${item.volume_ratio_20d?.toFixed(2)??'—'}× the 20-session average.`
              return <article className={`home-attention-item ${item.priority==='high'?'attention-high':''}`} key={item.id}><div className="home-attention-meta"><b>{item.ticker.replace(/\.(NS|BO)$/i,'')}</b><span className={`attention-priority ${item.priority}`}>{item.priority} priority</span><span>{isFiling?'Company filing':item.signal_type==='price_movement'?'Price movement':'Volume spike'}</span><time>{isFiling?'Filed':'Session'} · {shortDate(isFiling?item.filed_at??item.event_at:item.session_date??item.event_at)}</time></div><h3>{item.company}</h3><p>{title}</p>{detail&&<small>{detail}</small>}{quoteIsOlderThanAlert&&<small className="home-alert-data-gap" role="status">Latest quote · {shortDate(latestTickerQuoteDate)} · older than this alert session</small>}{isFiling&&item.source_url&&<a href={item.source_url} target="_blank" rel="noreferrer">Open exchange filing <ArrowRight size={13}/></a>}</article>
            })}
            {homeAnnouncement&&!homeAnnouncementAlreadyShown&&<article className="home-attention-item"><div className="home-attention-meta"><b>{homeAnnouncement.ticker.replace(/\.(NS|BO)$/i,'')}</b><span>Company filing</span><span>{labelCategory(homeAnnouncement.category)}</span><time>Filed · {shortDate(homeAnnouncement.filed_at)}</time></div><h3>{homeAnnouncement.company}</h3><p>{homeAnnouncement.subject}</p><small>Importance {homeAnnouncement.importance}/100{homeAnnouncement.is_verified_example?' · verified demo filing':''}</small><a href={homeAnnouncement.source_url} target="_blank" rel="noreferrer">Open exchange filing <ArrowRight size={13}/></a></article>}
            {alertHistoryLoading&&!homePriorityAlerts.length&&!homeAnnouncement?<div className="home-attention-empty">Loading recent company alerts…</div>:!homePriorityAlerts.length&&!homeAnnouncement?<div className="home-attention-empty">No recent priority alerts or tracked-company filings in this feed.{announcementError&&<span> Filing feed unavailable: {announcementError}</span>}</div>:null}
          </div>
        </section>
        <section className="performance-section" aria-labelledby="performance-title">
          <div className="performance-heading"><div><span className="eyebrow-mini">POSITION WEIGHTED · CURRENT SHARES</span><h2 id="performance-title">Portfolio performance</h2><p>Historical value using the share quantities you hold today.</p></div><div className="performance-ranges" role="group" aria-label="Performance period">{(['1D','1W','1M','3M','1Y'] as PerformanceRange[]).map(range=><button key={range} className={performanceRange===range?'active':''} aria-pressed={performanceRange===range} onClick={()=>setPerformanceRange(range)}>{range}</button>)}</div></div>
          <div className="performance-main performance-chart-only">
            <div className="performance-chart-card">
              <div className="chart-summary"><div><small>Period-end value</small><strong>{performance.chartCurrent===null? '—' : money(performance.chartCurrent)}</strong></div><span className={`range-return ${performance.changePct===null?'':performance.changePct<0?'negative':'positive'}`}>{performance.changePct===null?'—':`${performance.changePct>0?'+':''}${performance.changePct.toFixed(2)}%`}<small>{performanceRange} return</small></span></div>
              {historyLoading?<div className="performance-empty">Loading historical prices…</div>:performance.values.length>1?<><svg className="performance-chart" viewBox="0 0 760 210" role="img" aria-label={`${performanceRange} portfolio value chart, ${performance.included} of ${performance.total} positions with enough history`} preserveAspectRatio="none"><defs><linearGradient id="performance-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".24"/><stop offset="100%" stopColor="var(--accent)" stopOpacity="0"/></linearGradient></defs><path d="M 12 62 H 748 M 12 124 H 748 M 12 186 H 748" className="chart-gridline"/><path d={chartGeometry.area} fill="url(#performance-fill)"/><path d={chartGeometry.line} className="chart-line"/><circle cx="748" cy={chartGeometry.lastY} r="4" className="chart-last-dot"/></svg><div className="chart-dates"><span>{new Date(chartGeometry.firstDate+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</span><span>{new Date(chartGeometry.lastDate+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</span></div></>:<div className="performance-empty compact-empty"><b>{heldCompanies.length?'No verified history for this range':'Portfolio history appears here after you add holdings'}</b>{heldCompanies.length>0&&<span>{performance.included} of {performance.total} holdings have enough historical prices for {performanceRange}.</span>}{heldCompanies.length>0&&<button onClick={()=>setHistoryCoverageOpen(true)} disabled={historyLoading}>Inspect price coverage <ArrowRight size={13}/></button>}</div>}
              <p className="chart-footnote">Yahoo Finance adjusted closes, scaled to latest market prices · {performance.included} of {performance.total} positions included{performance.total>performance.included?' for this range':''}.</p>
            </div>
          </div>
          <div className="performance-lower">
            <article className="movers-card home-movers-card"><div className="mini-panel-title"><span>TODAY’S POSITION MOVERS</span><small>Contribution to daily P&amp;L · latest completed session</small></div>{dailyMovers.length?<div className="movers-columns"><div><label>GAINERS</label>{dailyMovers.filter(item=>item.pnl>0).slice(0,3).map(item=><div className="mover-row" key={item.company.ticker}><span className="mover-mark up"><TrendingUp size={13}/></span><span className="mover-company"><b>{item.company.name}</b><small>{item.company.ticker} · {item.pct>0?'+':''}{item.pct.toFixed(2)}%</small></span><strong className="gain-value">+{money(item.pnl)}</strong></div>)}{dailyMovers.every(item=>item.pnl<=0)&&<small className="mover-empty">No gainers in priced holdings today.</small>}</div><div><label>LOSERS</label>{dailyMovers.filter(item=>item.pnl<0).slice(-3).reverse().map(item=><div className="mover-row" key={item.company.ticker}><span className="mover-mark down"><TrendingDown size={13}/></span><span className="mover-company"><b>{item.company.name}</b><small>{item.company.ticker} · {item.pct.toFixed(2)}%</small></span><strong className="loss-value">{money(item.pnl)}</strong></div>)}{dailyMovers.every(item=>item.pnl>=0)&&<small className="mover-empty">No losers in priced holdings today.</small>}</div></div>:<p className="performance-empty compact">Daily movers appear when held companies have current prices.</p>}</article>
          </div>
          {heldCompanies.length>0&&<article className="concentration-card home-shape-card"><div className="mini-panel-title"><span>PORTFOLIO SHAPE</span><small>Priced holdings · current market value</small></div>{pricedHoldings.length?<div className="home-shape-metrics"><div><small>Largest sector</small><b>{concentration.largestSector?`${concentration.largestSector.pct.toFixed(1)}% · ${concentration.largestSector.sector}`:'—'}</b></div><div><small>Largest stock</small><b>{concentration.largestStock?`${concentration.largestStock.pct.toFixed(1)}% · ${concentration.largestStock.company.name}`:'—'}</b></div></div>:<p className="home-attention-empty">No current prices to calculate portfolio exposure.</p>}<button className="link-button" onClick={()=>{setPortfolioTab('holdings');navigate('Portfolio','portfolio')}}>Sector and concentration details <ArrowRight size={14}/></button></article>}
        </section>
        {historyCoverageOpen&&<div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setHistoryCoverageOpen(false)}}><section className="holding-modal coverage-modal" role="dialog" aria-modal="true" aria-labelledby="coverage-dialog-title"><button className="modal-close" type="button" onClick={()=>setHistoryCoverageOpen(false)} aria-label="Close price coverage">×</button><span className="eyebrow-mini">HISTORICAL PRICE DATA</span><h2 id="coverage-dialog-title">Coverage by holding</h2><p>Yahoo Finance adjusted daily closes are scaled to the latest unadjusted market price. Missing history stays missing; it is not filled with estimated returns.</p><div className="coverage-table"><div className="coverage-table-head"><span>Holding</span><span>Daily rows</span><span>Latest history</span><span>Ranges available</span></div>{historyCoverage.map(item=><div className="coverage-table-row" key={item.company.ticker}><b>{item.company.name}<small>{item.company.ticker}</small></b><span>{historyLoading?'…':item.points}</span><span>{item.currentPriceAvailable?(item.latestDate??'No data'):'Current price unavailable'}</span><span>{item.availableRanges.length?item.availableRanges.join(' · '):'No range'}</span></div>)}</div><div className="modal-actions"><button type="button" className="save-button" onClick={()=>setHistoryCoverageOpen(false)}>Done</button></div></section></div>}
      </>}

      {active==='Alerts'&&<>
        <div className="eyebrow"><span>PUSH INTELLIGENCE</span><i/> EXCHANGE FILINGS & MARKET SIGNALS</div>
        <section className="greeting page-greeting"><div><h1>Alerts &amp; Intelligence</h1><p>Monitor company announcements and unusual market activity across your tracked companies. Market alerts use completed sessions; illustrative signals are not added.</p></div></section>
        <section className="alert-overview" aria-label="Alert summary"><article><small>TOTAL ALERTS</small><b>{alertHistory.length.toString().padStart(2,'0')}</b><span>{unreadOnly?`${alertHistory.filter(item=>!item.is_read).length} unread`:'Recorded in selected period'}</span></article><article><small>HIGH PRIORITY</small><b>{alertHistory.filter(item=>item.priority==='high').length.toString().padStart(2,'0')}</b><span>Results, price moves and material filings</span></article><article><small>MARKET SIGNALS</small><b>{alertHistory.filter(item=>item.kind==='market').length.toString().padStart(2,'0')}</b><span>One per company, signal and session</span></article></section>
        <section className="alerts-section unified-alerts anchor-section" id="alerts">
          <div className="section-heading"><div><h2>Alert feed</h2><p className="alert-feed-freshness"><span><small>Source</small><b>{portfolio?.source??'Market data'}</b></span><span><small>Latest completed session</small><b>{portfolio?.companies.find(company=>company.session_date)?.session_date??'Unavailable'}</b></span><span><small>Last successful market update</small><b>{portfolio?.last_successful_update?new Date(portfolio.last_successful_update).toLocaleString('en-IN'):'Unavailable'}</b></span><span><small>NSE filings updated</small><b>{announcementUpdatedAt?new Date(announcementUpdatedAt).toLocaleString('en-IN'):'Unavailable'}</b></span></p></div><div className="section-tools"><select aria-label="Alert history period" value={announcementWindow} onChange={event=>{const hours=Number(event.target.value);setAnnouncementWindow(hours);void loadAnnouncements(hours);void loadAlertHistory(hours)}}><option value={24}>Last 24 hours</option><option value={168}>Last 7 days</option><option value={720}>Last 30 days</option></select><button className="link-button" onClick={()=>{void loadPortfolio(true);void loadAnnouncements(announcementWindow);void loadAlertHistory(announcementWindow)}}>Refresh <RefreshCw size={13}/></button></div></div>
          <form className="threshold-panel alert-threshold-form" onSubmit={updateSettings}>
            <div className="alert-settings-header"><div><h3>Alert trigger settings</h3><p>Either threshold can trigger an alert.</p></div><span className="alert-trigger-badge">OR trigger</span></div>
            <div className="alert-threshold-fields">
              <label>Volume spike multiple<span className="threshold-input-wrap"><input type="number" inputMode="decimal" min="1.1" max="10" step="0.1" value={settings.volume_multiple} onChange={event=>{setSettings({...settings,volume_multiple:Number(event.target.value)});setSettingsMessage('')}}/><span aria-hidden="true">×</span></span><small>Compared with the previous 20 sessions</small></label>
              <label>Daily price movement<span className="threshold-input-wrap"><input type="number" inputMode="decimal" min="0.5" max="25" step="0.5" value={settings.price_move_pct} onChange={event=>{setSettings({...settings,price_move_pct:Number(event.target.value)});setSettingsMessage('')}}/><span aria-hidden="true">%</span></span><small>Either direction · previous close</small></label>
            </div>
            <div className="alert-threshold-actions"><span role="status" aria-live="polite" className={settingsMessage.startsWith('Could not')?'settings-error':settingsMessage.startsWith('Thresholds saved')?'settings-success':''}>{settingsMessage}</span><button type="submit" disabled={settingsMessage==='Saving…'||settingsMessage==='Saved. Refreshing alerts…'}>{settingsMessage==='Saving…'||settingsMessage==='Saved. Refreshing alerts…'?'Saving…':'Save'}</button></div>
          </form>
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
              <div className="unified-alert-content"><h3>{item.company}</h3><p className="unified-alert-summary">{isFiling?item.subject:marketSummary}</p><div className="unified-alert-meta"><b>{item.ticker.replace('.NS','').replace('.BO','')}</b><span className={`severity-pill ${item.priority}`}>{item.priority} priority</span><span className="alert-kind-pill">{isFiling?'Corporate filing':signal}</span><time>{new Date(eventTime).toLocaleString('en-IN')}</time></div>
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
        <div className="page-tabs research-tool-tabs" role="tablist" aria-label="Research tools">
          <button role="tab" aria-selected={researchTab==='ask'} className={researchTab==='ask'?'active':''} onClick={()=>selectSubview(setResearchTab,'ask')}><Search size={15}/> Ask FINN</button>
          <button role="tab" aria-selected={researchTab==='financials'} className={researchTab==='financials'?'active':''} onClick={()=>selectSubview(setResearchTab,'financials')}><BarChart3 size={15}/> Financials</button>
          <button role="tab" aria-selected={researchTab==='commitments'} className={researchTab==='commitments'?'active':''} onClick={()=>selectSubview(setResearchTab,'commitments')}><Target size={15}/> Commitments</button>
          <button role="tab" aria-selected={researchTab==='analysis'} className={researchTab==='analysis'?'active':''} onClick={()=>selectSubview(setResearchTab,'analysis')}><TrendingUp size={15}/> Bull vs bear</button>
        </div>
        <section className="research-workflow anchor-section" id="research"><div className="section-heading"><div><h2>Primary-source company research</h2><p>Upload an annual report or earnings-call transcript, then ask a question with page citations.</p></div><span className="market-source">{aiEnabled?`${aiProvider} available`:'Local retrieval active'}</span></div>
          <div className="research-pane" hidden={researchTab!=='ask'}>
          <form className="upload-panel" onSubmit={uploadResearch}><label>Company<input name="company" required placeholder="e.g. Reliance Industries"/></label><label>NSE ticker<input name="ticker" required placeholder="e.g. RELIANCE.NS"/></label><label>Source type<select name="document_type" required><option>Annual report</option><option>Quarterly results</option><option>Earnings-call transcript</option><option>Investor presentation</option></select></label><label>Reporting period<input name="reporting_period" required placeholder="e.g. FY2026 or Q2 FY2027"/></label><label>Official source URL (optional)<input name="source_url" type="url" placeholder="https://www.nseindia.com/..."/></label><label className="file-picker"><Upload size={16}/>{researchFilename||'Choose PDF'}<input type="file" name="file" accept="application/pdf,.pdf" required onChange={event=>setResearchFilename(event.target.files?.[0]?.name ?? '')}/></label><button type="submit" disabled={researchBusy}>Index primary source</button></form>{documentUploadState&&<p className={`indexing-message ${documentUploadState.status}`} role="status"><b>{documentUploadState.status}</b> · {documentUploadState.filename} · {documentUploadState.message}</p>}<small className="upload-hint">Text-searchable PDFs only · maximum 45 MB. Tracked-company names and tickers are checked as a pair. Scanned image PDFs need OCR before upload.</small>
          {documents.length>0&&<form className="question-panel" onSubmit={askResearch}><label>Source document<select value={documentId} onChange={event=>{setDocumentId(event.target.value);setResearchAllCompanySources(false)}}>{documents.map(doc=><option key={doc.id} value={doc.id}>{doc.company} · {doc.document_type} · {doc.reporting_period} ({doc.pages} pages)</option>)}</select></label><label>Your question<input value={researchQuestion} onChange={event=>setResearchQuestion(event.target.value)} minLength={5} required placeholder="What did management say about margins?"/></label><label className="research-scope-toggle"><input type="checkbox" checked={researchAllCompanySources} onChange={event=>setResearchAllCompanySources(event.target.checked)}/><span>Search all indexed sources for {selectedDocument?.company ?? 'this company'}</span></label><button type="submit" disabled={researchBusy}>Ask FINN <ArrowRight size={14}/></button></form>}
          {researchMessage&&<p className="workflow-message">{researchMessage}</p>}{researchVerificationWithFailures&&<div className="citation-diagnostics" role="alert"><b>Citation verification failed · synthesis withheld</b><ul>{researchVerificationWithFailures.failures.map((failure,index)=><li key={`${failure.type}-${failure.citation_id??index}`}><strong>{citationFailureLabel(failure.type)}</strong>{failure.citation_id&&<span> · [{failure.citation_id}]</span>}{failure.page&&<span> · page {failure.page}{failure.expected_page?` (expected ${failure.expected_page})`:''}</span>}<p>{failure.reason}</p>{failure.claim&&<blockquote>{failure.claim}</blockquote>}</li>)}</ul><small>{researchVerificationWithFailures.note}</small></div>}{researchAnswer&&<div className="research-answer"><div className="answer-heading"><Sparkles size={16}/><b>{researchMode==='ai_grounded'?'FINN model-assisted research':researchMode==='extractive_local'?'FINN extractive answer':'FINN source evidence'}</b></div><p>{researchAnswer}</p><small>Management statements are quoted from the source. Any FINN interpretation is labeled separately.</small>{researchSources.map(source=><details className="source-citation" key={source.id} open><summary>[{source.id}] {source.filename} · {source.document_type} · {source.reporting_period} · p. {source.page}</summary>{citationHref(source)&&<a href={citationHref(source)} target="_blank" rel="noreferrer">Open exact source page ↗</a>}<blockquote>{source.excerpt}</blockquote></details>)}</div>}
          <div className="document-library"><div className="section-heading"><div><h3>Document library</h3><p>{documents.length} indexed primary sources · choose a source, search metadata, or manage its index.</p></div></div><div className="document-library-tools"><label><Search size={15}/><input value={documentSearch} onChange={event=>setDocumentSearch(event.target.value)} placeholder="Search company, ticker, period, or filename"/></label><select aria-label="Filter document type" value={documentTypeFilter} onChange={event=>setDocumentTypeFilter(event.target.value)}><option value="all">All source types</option>{Array.from(new Set(documents.map(doc=>doc.document_type))).sort().map(type=><option key={type}>{type}</option>)}</select></div><input ref={replaceInput} hidden type="file" accept="application/pdf,.pdf" onChange={replaceResearchDocument}/>{documentActionMessage&&<p className="workflow-message">{documentActionMessage}</p>}
            {visibleDocuments.length?<div className="document-list">{visibleDocuments.map(doc=><article className={`document-library-row ${doc.superseded_by?'superseded-document':''}`} key={doc.id}><FileText size={16}/><div className="document-library-copy"><b>{doc.company} · {doc.ticker} {doc.superseded_by&&<em>Previous version</em>}</b><span className="document-library-filename" title={doc.filename}>{doc.filename}</span><span className="document-library-details">{doc.document_type} · {doc.reporting_period} · {doc.pages} pages</span><small>Version {doc.version_number??1} · <strong className={`index-status ${doc.indexing_status??'indexed'}`}>{doc.indexing_status??'indexed'}</strong>{doc.index_error&&` · ${doc.index_error}`}{doc.source_url&&<> · <a href={doc.source_url} target="_blank" rel="noreferrer">Original source ↗</a></>} <a href={`${API}/api/research/documents/${encodeURIComponent(doc.id)}/file#page=1`} target="_blank" rel="noreferrer">Open PDF ↗</a></small></div><div className="document-library-actions"><button className="document-select-action" onClick={()=>setDocumentId(doc.id)}>Select</button><details className="document-actions-menu"><summary aria-label={`More actions for ${doc.company} ${doc.document_type}`}>More</summary><div><button onClick={()=>{setReplaceTargetId(doc.id);replaceInput.current?.click()}}><Upload size={13}/> Replace</button><button onClick={()=>void reindexResearchDocument(doc)}><RotateCw size={13}/> Re-index</button><button className="remove-action" onClick={()=>void deleteResearchDocument(doc)}><Trash2 size={13}/> Delete</button></div></details></div></article>)}</div>:<div className="state-card">{documents.length?'No documents match these filters.':'Upload a primary source to start your research library.'}</div>}
          </div>
          </div>
          {selectedDocument&&<>
            <div className="research-subsection" hidden={researchTab!=='financials'}><div className="section-heading"><div><h3>Quarterly financial comparisons</h3><p>Compare like with like. Figures are grouped by statement basis and reported or adjusted presentation; every saved value keeps its source page and excerpt.</p></div></div>
              <div className="financial-scope-controls"><label>Statement basis<select value={statementBasis} onChange={event=>setStatementBasis(event.target.value as 'consolidated'|'standalone')}><option value="consolidated">Consolidated</option><option value="standalone">Standalone</option></select></label><label>Figure presentation<select value={figureType} onChange={event=>setFigureType(event.target.value as 'reported'|'adjusted')}><option value="reported">Reported</option><option value="adjusted">Adjusted</option></select></label>{figureType==='adjusted'&&<label className="adjustment-note-field">Adjustment definition<input value={adjustmentNote} onChange={event=>setAdjustmentNote(event.target.value)} maxLength={500} placeholder="e.g. exclude one-time restructuring charge"/><small>Comparisons include only figures using this same definition.</small></label>}</div>
              {missingHistoricalInputs.length>0&&<section className="missing-financial-inputs" aria-labelledby="missing-financial-title"><div className="missing-financial-heading"><div><b id="missing-financial-title">Historical inputs missing</b><p>Missing figures stay unavailable; they are never treated as zero or a loss.</p></div><strong>{missingHistoricalInputs.length}</strong></div><div className="missing-financial-groups">{missingHistoricalGroups.map(group=><section className="missing-financial-period" key={group.period}><h4>{group.period}</h4><ul>{group.items.map(item=><li key={`${item.metric}-${item.period}`}><div><b>{item.metric.replaceAll('_',' ').toUpperCase()}</b><small>Needed for {item.comparison} comparison with {item.comparison_period}</small></div><button onClick={()=>{setFinancialEntryPeriod(item.period);requestAnimationFrame(()=>{const field=document.querySelector<HTMLInputElement>(`.financial-entry [name="${item.metric}"]`);field?.scrollIntoView({behavior:'smooth',block:'center'});field?.focus({preventScroll:true})})}}>Enter figure <ArrowRight size={13}/></button></li>)}</ul></section>)}</div></section>}
              <form className="financial-entry" onSubmit={saveQuarterlyFigures}><label>Fiscal quarter<input id="financial-period-input" name="period" value={financialEntryPeriod} onChange={event=>setFinancialEntryPeriod(event.target.value)} required pattern="FY20[0-9]{2}-Q[1-4]" placeholder="FY2026-Q2" title="Format: FY2026-Q2"/></label><label>Units<select name="unit"><option>₹ crore</option><option>₹ lakh</option><option>₹</option></select></label><label>Source page<input name="page" type="number" min="1" max={selectedDocument.pages} required placeholder="PDF page number"/></label><label>Revenue<input name="revenue" type="number" step="any" placeholder="As filed"/></label><label>EBITDA<input name="ebitda" type="number" step="any" placeholder="As filed"/></label><label>PBT<input name="pbt" type="number" step="any" placeholder="As filed"/></label><label>PAT<input name="pat" type="number" step="any" placeholder="As filed"/></label><label>O2C EBITDA<input name="o2c_ebitda" type="number" step="any" placeholder="Optional segment value"/></label><label className="financial-excerpt">Supporting passage<input name="excerpt" required minLength={10} maxLength={1200} placeholder="Copy the relevant financial-results statement/table text"/></label><button type="submit">Save cited figures</button></form>
              {financialMessage&&<p className="workflow-message">{financialMessage}</p>}
              {financialPeriods.length>1&&<div className="financial-chart-card"><div className="section-heading"><div><h4>Quarterly trend</h4><p>{financialChartMetric.toUpperCase()} · {statementBasis} · {figureType}</p></div><div className="financial-chart-controls"><select aria-label="Chart metric" value={financialChartMetric} onChange={event=>setFinancialChartMetric(event.target.value)}>{['revenue','ebitda','pbt','pat','o2c_ebitda','ebitda_margin','pbt_margin','pat_margin'].map(metric=><option key={metric} value={metric}>{metric.toUpperCase()}</option>)}</select><button className={financialChartRange===4?'active':''} onClick={()=>setFinancialChartRange(4)}>4 quarters</button><button className={financialChartRange===8?'active':''} onClick={()=>setFinancialChartRange(8)}>8 quarters</button></div></div>{financialChartGeometry&&chartRows.length>1?<><svg viewBox="0 0 600 205" role="img" aria-label={`${financialChartMetric} values over ${chartRows.length} quarters`}><line x1="24" x2="576" y1={financialChartGeometry.zeroY} y2={financialChartGeometry.zeroY} className="financial-chart-zero"/><polyline points={financialChartGeometry.points} className="financial-chart-line" fill="none"/>{chartRows.map((row,index)=>{const values=chartRows.map(point=>point.value as number);const min=Math.min(0,...values),max=Math.max(0,...values),span=max-min||1;const cx=24+index*552/(chartRows.length-1),cy=166-((row.value as number)-min)*132/span;return <g key={row.period}><circle cx={cx} cy={cy} r="4"/><text x={cx} y="194" textAnchor="middle">{row.period.replace('FY','').replace('-Q','·Q')}</text></g>})}</svg><small>{chartRows.length} quarters · {chartRows[0]?.unit} · margins shown in percentage; QoQ/YoY comparisons in percentage points</small></>:<div className="state-card">Add at least two quarters with {financialChartMetric.toUpperCase()} values to plot this trend.</div>}</div>}
              {financialPeriods.slice(0,8).map((period,index)=><details className="financial-period" key={period.period} open={index===0}><summary>{period.period}<small>QoQ and YoY use the same basis and figure presentation</small></summary><div className="financial-table"><div className="financial-row financial-header"><span>Metric</span><span>{figureType}</span><span>QoQ</span><span>YoY</span><span>Evidence</span></div>{Object.entries(period.metrics).map(([metric,data])=><div className="financial-row" key={metric}><b>{metric==='revenue'?'REVENUE':metric.toUpperCase()}</b><span>{data.value.toLocaleString('en-IN')} {data.unit}</span><span>{changeValue(data.qoq)}<small>{changeNote(data.qoq,data.unit)}</small></span><span>{changeValue(data.yoy)}<small>{changeNote(data.yoy,data.unit)}</small></span><details><summary>{data.calculated?'Calculated from cited figures · ':''}{data.source.filename} · PDF p.{data.source.page}</summary>{citationHref({...data.source,page:data.source.page})&&<a href={citationHref({...data.source,page:data.source.page})} target="_blank" rel="noreferrer">Open exact source page ↗</a>}{data.source.excerpt&&<blockquote>{data.source.excerpt}</blockquote>}{data.source.supporting_sources?.map((source,index)=><blockquote key={`${source.filename}-${index}`}>{source.filename} · p.{source.page}: {source.excerpt}{citationHref({...source,page:source.page})&&<> <a href={citationHref({...source,page:source.page})} target="_blank" rel="noreferrer">Open page ↗</a></>}</blockquote>)}</details></div>)}</div></details>)}
              <details className="unified-evidence-ledger"><summary>Shared financial evidence ledger · {financialEvidence.length} records</summary><p>Financial comparisons, management guidance outcomes, and Bull vs Bear use these same source-linked records.</p>{financialEvidence.length?<div className="financial-evidence-list">{financialEvidence.map(item=><article key={item.id}><div><b>{item.evidence_kind==='management_guidance'?'Management guidance':'Reported financial evidence'} · {item.metric.replaceAll('_',' ')}</b><span>{item.period??item.target_period} · {item.statement_basis} · {item.figure_type}{item.adjustment_note?` · ${item.adjustment_note}`:''}</span><small>{item.evidence_kind==='management_guidance'?`Target ${item.target_value?.toLocaleString('en-IN')} ${item.unit} · “${item.quote}”`:`${item.value?.toLocaleString('en-IN')} ${item.unit}`}</small></div><a href={citationHref({...item.source,page:item.source.page})} target="_blank" rel="noreferrer">{item.source.filename} · p.{item.source.page} ↗</a></article>)}</div>:<div className="state-card">Saved figures and guidance passages will appear here as one source-linked evidence model.</div>}</details>
              {financialPeriods.length===0&&<div className="state-card">No reported quarters saved for {selectedDocument.ticker}. Add figures from a quarterly-results filing to calculate comparisons.</div>}
            </div>

            <div className="research-subsection" hidden={researchTab!=='commitments'}><div className="section-heading"><div><h3>Management promise vs reality</h3><p>Log explicit guidance with its source passage, then compare it with the matching reported period.</p></div></div>
              <form className="promise-entry" onSubmit={savePromise}><div className="promise-entry-groups"><section className="promise-entry-group"><h4>Commitment context</h4><div className="promise-entry-fields"><label>Guidance metric<select name="metric"><option value="revenue_growth_yoy">Revenue growth YoY</option><option value="revenue">Revenue</option><option value="ebitda">EBITDA</option><option value="ebitda_margin">EBITDA margin</option><option value="pbt">PBT</option><option value="pbt_margin">PBT margin</option><option value="pat">PAT</option><option value="pat_margin">PAT margin</option><option value="annualized_o2c_ebitda">O2C EBITDA, annualized from H1</option></select></label><label>Target quarter<input name="target_period" required pattern="FY20[0-9]{2}-Q[1-4]" placeholder="FY2027-Q1"/></label><label>Statement basis<select value={statementBasis} onChange={event=>setStatementBasis(event.target.value as 'consolidated'|'standalone')}><option value="consolidated">Consolidated</option><option value="standalone">Standalone</option></select></label><label>Figure type<select value={figureType} onChange={event=>setFigureType(event.target.value as 'reported'|'adjusted')}><option value="reported">Reported</option><option value="adjusted">Adjusted</option></select></label></div></section><section className="promise-entry-group"><h4>Guidance value and source</h4><div className="promise-entry-fields promise-value-fields"><label>Guidance value<input name="target_value" type="number" step="any" required placeholder="15"/></label><label>Unit<input name="unit" required placeholder="% or ₹ crore"/></label><label>Guidance page<input name="page" type="number" min="1" max={selectedDocument.pages} required placeholder="PDF page number"/></label></div></section></div><label className="promise-quote">Management’s exact guidance<input name="quote" required minLength={10} maxLength={1200} placeholder="Transcribe the commitment from the selected source"/></label><button type="submit">Track commitment / revision</button></form>
              {promiseMessage&&<p className="workflow-message">{promiseMessage}</p>}
              {promiseTrackRecord&&<div className="promise-track-record"><b>Historical guidance outcomes</b><span>{promiseTrackRecord.completed_count} completed guidance items · {promiseTrackRecord.achieved_count} achieved/exceeded · {promiseTrackRecord.missed_count} below</span>{promiseTrackRecord.achievement_rate_pct!==null&&<strong>{promiseTrackRecord.achievement_rate_pct}% achieved or exceeded</strong>}{promiseTrackRecord.mean_absolute_deviation_pct!==null&&<span>Mean absolute deviation from guidance: {promiseTrackRecord.mean_absolute_deviation_pct}%</span>}<small>{promiseTrackRecord.achievement_rate_pct===null?`At least ${promiseTrackRecord.minimum_sample} completed, current guidance items are needed for a rate.`:promiseTrackRecord.note}</small></div>}
              {promiseRows.length>0?<div className="promise-list">{promiseRows.map(item=>{const actualText=item.actual_value===null?((({pending:'Reporting period is not complete',actual_missing:'Period ended · add the actual figure',not_comparable:'A matching basis, presentation, or unit is not available'} as Record<string,string>)[item.status])??'Awaiting comparable reported figures'):`${item.actual_value.toLocaleString('en-IN')} ${item.actual_unit??item.unit}`;return <article className="promise-card" key={item.id}><div className="promise-card-head"><b>{labelCategory(item.metric)} · {item.target_period} · v{item.revision??1}</b><span className={`promise-status ${item.is_current_guidance?item.status:'superseded-guidance'}`}>{item.is_current_guidance?promiseStatusLabel(item.status):'revised guidance'}</span></div><div className="promise-comparison"><div><small>Management guidance</small><strong>{item.target_value.toLocaleString('en-IN')} {item.unit}</strong><span>{item.statement_basis??'consolidated'} · {item.figure_type??'reported'}{item.adjustment_note?` · ${item.adjustment_note}`:''}</span></div><div><small>Reported actual</small><strong>{actualText}</strong></div>{item.deviation!==null&&<div className="promise-difference"><small>Difference</small><strong>{item.deviation>0?'+':''}{item.deviation.toFixed(2)} {item.actual_unit??item.unit}</strong></div>}</div><blockquote>“{item.quote}”</blockquote>{item.metric==='annualized_o2c_ebitda'&&<p className="promise-qualification">Annualized H1 run-rate estimate: 2 × (Q1 plus Q2 O2C EBITDA). This is not a full-year forecast.</p>}<div className="promise-evidence"><b>Evidence</b><div><span>Guidance</span>{citationHref({...item.source,page:item.source.page})&&<a href={citationHref({...item.source,page:item.source.page})} target="_blank" rel="noreferrer">{item.source.filename} · PDF p.{item.source.page} ↗</a>}</div>{item.actual_sources.map((source,index)=><div key={`${source.filename}-${index}`}><span>Actual</span>{citationHref({...source,page:source.page})&&<a href={citationHref({...source,page:source.page})} target="_blank" rel="noreferrer">{source.filename} · PDF p.{source.page} ↗</a>}</div>)}</div></article>})}</div>:<div className="state-card">No management commitments logged yet. Outcomes are pending until the reporting period ends and comparable figures are available.</div>}
            </div>

            <div className="research-subsection" hidden={researchTab!=='analysis'}><div className="section-heading"><div><h3>Bull vs bear</h3><p>Build a balanced view from the uploaded annual reports, results, and concall transcripts.</p></div><button className="link-button" onClick={()=>void buildBullBear()} disabled={bullBearBusy}>{bullBearBusy?'Retrieving evidence…':'Build analysis'} <ArrowRight size={14}/></button></div>
              {!aiEnabled&&<p className="workflow-message">Local analysis is active without a model. For generated synthesis, FINN supports an optional local Ollama model or a hosted provider.</p>}
              {bullBear&&<div className="research-answer"><div className="answer-heading"><Sparkles size={16}/><b>{bullBear.mode==='ai_grounded'?'AI bull vs bear analysis':bullBear.mode==='local_analysis'?'Local bull vs bear analysis':'Evidence for bull and bear review'}</b></div>{bullBear.evidence_quality&&<div className={`evidence-quality ${bullBear.evidence_quality.coverage}`}><b>Coverage: {bullBear.evidence_quality.coverage} · Retrieval confidence: {bullBear.evidence_quality.confidence}</b><span>{bullBear.evidence_quality.source_pages} pages · {bullBear.evidence_quality.documents} documents · {bullBear.evidence_quality.document_types} source types</span><strong>Evidence quality: {bullBear.evidence_quality.quality}</strong><span>{bullBear.evidence_quality.independence} · {bullBear.evidence_quality.source_domains} source domains · {bullBear.evidence_quality.near_duplicate_passage_pairs} near-duplicate passage pairs</span><small>{bullBear.evidence_quality.note}</small></div>}{bullBearVerificationWithFailures&&<div className="citation-diagnostics" role="alert"><b>Citation verification failed · synthesis withheld</b><ul>{bullBearVerificationWithFailures.failures.map((failure,index)=><li key={`${failure.type}-${failure.citation_id??index}`}><strong>{citationFailureLabel(failure.type)}</strong>{failure.citation_id&&<span> · [{failure.citation_id}]</span>}{failure.page&&<span> · page {failure.page}{failure.expected_page?` (expected ${failure.expected_page})`:''}</span>}<p>{failure.reason}</p>{failure.claim&&<blockquote>{failure.claim}</blockquote>}</li>)}</ul><small>{bullBearVerificationWithFailures.note}</small></div>}<p>{bullBear.answer}</p><small>FINN may conclude the evidence is mixed or insufficient. A missing case is not filled with invented claims.</small>{bullBear.sources.map(source=><details className="source-citation" key={source.id} open><summary>[{source.id}] {source.filename} · {source.document_type} · {source.reporting_period} · p. {source.page}</summary>{citationHref({...source,page:source.page})&&<a href={citationHref({...source,page:source.page})} target="_blank" rel="noreferrer">Open exact source page ↗</a>}<blockquote>{source.excerpt}</blockquote></details>)}</div>}
            </div>
          </>}
          {!selectedDocument&&researchTab!=='ask'&&<div className="state-card research-empty"><b>Add a source document to continue</b><p>Upload an annual report, quarterly result, or concall transcript in Ask FINN. The financial comparison, commitment tracker, and bull vs bear review will appear here after indexing.</p><button className="link-button" onClick={()=>setResearchTab('ask')}>Go to Ask FINN <ArrowRight size={14}/></button></div>}
        </section>
      </>}

      {active==='Portfolio'&&<>
        <div className="eyebrow"><span>PORTFOLIO WORKSPACE</span><i/> HOLDINGS & WATCHLIST</div>
        <section className="greeting page-greeting"><div><h1>Portfolio</h1><p>Track positions, check available market prices, and manage the company watchlist.</p></div></section>
        <div className="page-tabs portfolio-view-tabs" role="tablist" aria-label="Portfolio views">
          <button role="tab" aria-selected={portfolioTab==='holdings'} className={portfolioTab==='holdings'?'active':''} onClick={()=>selectSubview(setPortfolioTab,'holdings')}><BriefcaseBusiness size={15}/> Holdings <span>{heldCompanies.length}</span></button>
          <button role="tab" aria-selected={portfolioTab==='watchlist'} className={portfolioTab==='watchlist'?'active':''} onClick={()=>selectSubview(setPortfolioTab,'watchlist')}><Search size={15}/> Watchlist <span>{trackedCompanies.length}</span></button>
          <button role="tab" aria-selected={portfolioTab==='activity'} className={portfolioTab==='activity'?'active':''} onClick={()=>selectSubview(setPortfolioTab,'activity')}><Activity size={15}/> Activity <span>{transactions.length}</span></button>
        </div>
        <section id="portfolio" className="portfolio-preview anchor-section">
          <div hidden={portfolioTab!=='holdings'}>
          <div className="section-heading holdings-section-heading"><div><h2>Your holdings</h2><p>{heldCompanies.length} open positions · {pricedHoldings.length} with current market prices</p></div><div className="holding-heading-actions"><button className="link-button" disabled={!portfolio} onClick={()=>selectSubview(setPortfolioTab,'watchlist')}>Add to holdings</button><button className="link-button" onClick={()=>selectSubview(setPortfolioTab,'activity')}>Record cash or corporate action</button><button className="link-button" onClick={exportPortfolio}>Export CSV</button></div></div>
          {heldCompanies.length === 0 ? <div className="state-card holdings-empty"><span className="empty-icon"><BriefcaseBusiness size={21}/></span><div><b>Your holdings start here</b><p>Record a buy from the watchlist. Every trade remains in your local transaction history.</p><div className="empty-actions"><button className="save-button" disabled={!portfolio} onClick={()=>selectSubview(setPortfolioTab,'watchlist')}>Choose a company</button><button className="cancel-button" disabled={!portfolio} onClick={addDemoPositions}>Load demo holdings</button></div><small>Transactions are saved in this browser. Export a CSV backup regularly.</small></div></div> : <>
            <div className="holdings-summary"><article><small>Invested cost · open positions</small><b>{money(investedCapital)}</b></article><article><small>Market value{pricedHoldings.length < heldCompanies.length ? ' · partial' : ''}</small><b>{money(marketValue)}</b></article><article><small>Today’s P&amp;L{dailyPricedHoldings.length < heldCompanies.length ? ' · partial' : ''}</small><b className={todayPnl < 0 ? 'loss-value' : todayPnl > 0 ? 'gain-value' : ''}>{money(todayPnl)}</b></article><article><small>Unrealized P&amp;L</small><b className={unrealizedPnl < 0 ? 'loss-value' : unrealizedPnl > 0 ? 'gain-value' : ''}>{money(unrealizedPnl)}</b></article><article><small>Realized P&amp;L</small><b className={ledger.realizedPnl < 0 ? 'loss-value' : ledger.realizedPnl > 0 ? 'gain-value' : ''}>{money(ledger.realizedPnl)}</b></article><article><small>Dividends recorded</small><b>{money(ledger.dividends)}</b></article></div>
            <div className="portfolio-allocation-card"><div className="mini-panel-title"><span>ASSET ALLOCATION</span><span>{money(marketValue+ledger.cash)} total marked assets</span></div><div className="asset-allocation-list"><div><span><i className="asset-equity"/>Equities</span><b>{money(marketValue)}</b><strong>{marketValue+ledger.cash>0?(marketValue/(marketValue+ledger.cash)*100).toFixed(1):'—'}%</strong></div><div><span><i className="asset-cash"/>Cash &amp; dividends</span><b>{money(ledger.cash)}</b><strong>{marketValue+ledger.cash>0?(ledger.cash/(marketValue+ledger.cash)*100).toFixed(1):'—'}%</strong></div></div><small>Asset weights use priced equity holdings plus recorded cash only. Unpriced positions and untracked assets are excluded.</small></div>
            <article className="portfolio-sector-card allocation-card"><div className="mini-panel-title"><span>ALLOCATION BY SECTOR</span><span>{money(marketValue)} priced value</span></div>{allocation.length?<div className="allocation-list">{allocation.map((item,index)=><details className="allocation-row" key={item.sector}><summary><div className="allocation-label"><i style={{'--sector-color':`var(--sector-${index%6})`} as CSSProperties}/><span>{item.sector}</span><b>{item.pct.toFixed(1)}%</b></div><div className="allocation-track"><i style={{width:`${item.pct}%`,'--sector-color':`var(--sector-${index%6})`} as CSSProperties}/></div><div className="allocation-values"><span>Invested <b>{money(item.invested)}</b></span><span>Market value <b>{money(item.amount)}</b></span></div></summary><div className="sector-holdings">{item.holdings.map(company=><div key={company.ticker}><span><b>{company.name}</b><small>{company.ticker} · {holdings[company.ticker].shares.toLocaleString('en-IN')} shares</small></span><span><b>{money(holdings[company.ticker].shares*holdings[company.ticker].average_cost)}</b><small>invested</small></span><span><b>{money(holdings[company.ticker].shares*(company.price??0))}</b><small>market value</small></span></div>)}</div></details>)}</div>:<p className="performance-empty compact">Add priced holdings to calculate allocation.</p>}</article>
            <article className="concentration-card portfolio-concentration-card"><div className="mini-panel-title"><span>CONCENTRATION &amp; DIVERSIFICATION</span><small>Priced holdings · by current market value</small></div><div className="concentration-metrics"><div><small>Largest sector</small><b>{concentration.largestSector?`${concentration.largestSector.pct.toFixed(1)}%`: '—'}</b><span>{concentration.largestSector?.sector ?? 'No priced positions'}</span></div><div><small>Top 3 sectors</small><b>{concentration.sectorCount?`${concentration.topThreeSectors.toFixed(1)}%`:'—'}</b><span>Combined exposure</span></div><div><small>Largest stock</small><b>{concentration.largestStock?`${concentration.largestStock.pct.toFixed(1)}%`:'—'}</b><span>{concentration.largestStock?.company.name ?? 'No priced positions'}</span></div><div><small>Top 3 stocks</small><b>{concentration.pricedCount?`${concentration.topThreeStocks.toFixed(1)}%`:'—'}</b><span>Combined exposure</span></div><div><small>Sectors represented</small><b>{concentration.sectorCount}</b><span>Across {pricedHoldings.length}/{heldCompanies.length} priced holdings</span></div><div title="Herfindahl-Hirschman Index: sum of squared individual stock weights, on a 0–10,000 scale."><small>Stock HHI</small><b>{marketValue?Math.round(concentration.stockHhi):'—'}</b><span>Sum of squared stock weights · lower means less concentrated</span></div></div><p>Exposure uses priced holdings by market value. Sector count alone does not describe diversification; HHI is the sum of squared individual stock weights.</p></article>
            <div className="positions-table"><div className="position-row position-header"><span>Company</span><span>Shares</span><span>Avg. cost</span><span>Last price</span><span>Market value</span><span>Today</span><span>Unrealized</span><span></span></div>
              {heldCompanies.map(company => {
                const position = holdings[company.ticker]
                const currentValue = company.market_status === 'available' && company.price !== undefined && !staleSession(company.session_date) ? position.shares * company.price : null
                const dayPerShare = !staleSession(company.session_date)&&company.price !== undefined && company.previous_close !== null && company.previous_close !== undefined ? company.price - company.previous_close : null
                const dayValue = dayPerShare === null ? null : dayPerShare * position.shares
                const unrealized = currentValue === null ? null : currentValue - position.shares * position.average_cost
                return <div className="position-row" key={company.ticker}><span className="position-company"><b>{company.name}</b><small>{company.ticker} · {company.sector}{position.demo&&<strong className="demo-badge">DEMO</strong>}</small></span><span>{position.shares.toLocaleString('en-IN')}</span><span>{money(position.average_cost)}</span><span>{company.market_status === 'available' ? `${staleSession(company.session_date)?'Stale · ':''}${money(company.price)}` : 'Unavailable'}</span><b>{money(currentValue)}</b><b className={dayValue === null || dayValue===0 ? '' : dayValue < 0 ? 'loss-value' : 'gain-value'}>{money(dayValue)}</b><b className={unrealized === null || unrealized===0 ? '' : unrealized < 0 ? 'loss-value' : 'gain-value'}>{money(unrealized)}</b><span className="position-actions"><button onClick={()=>openHoldingEditor(company,'buy')}>Buy</button><button className="remove-action" onClick={()=>openHoldingEditor(company,'sell',true)}>Sell</button></span></div>
              })}
            </div>
            <p className="holdings-note">Cost basis uses weighted-average accounting. Buys reduce recorded cash; sells retain proceeds and calculate realized profit after fees. Missing or stale prices are excluded from market-value totals. {heldCompanies.some(company=>holdings[company.ticker]?.demo)?'DEMO transactions are synthetic and should be replaced before using the figures. ':''}Ledger data stays in this browser.</p>
          </>}
          <section className="actual-performance-card"><div className="section-heading"><div><h3>Actual account performance</h3><p>Transaction-based value and time-weighted return · starts from the first recorded ledger date · raw closes plus recorded dividends</p></div><div className="account-range-tabs">{(['1W','1M','3M','1Y'] as const).map(range=><button key={range} className={accountRange===range?'active':''} onClick={()=>setAccountRange(range)}>{range}</button>)}</div></div>{accountHistoryLoading?<div className="state-card">Loading transaction and price history…</div>:accountChartPoints.length>1?<><div className="account-performance-summary"><strong>{accountReturn===null?'—':`${accountReturn>0?'+':''}${accountReturn.toFixed(2)}%`}</strong><span>Actual account return · {accountRange}</span><b>{money(accountChartPoints.at(-1)?.value)}</b></div><svg viewBox="0 0 760 210" role="img" aria-label={`Transaction-based portfolio return over ${accountRange}`} className="account-performance-chart"><path d="M12 62H748 M12 124H748 M12 186H748" className="chart-gridline"/><polyline points={accountChartGeometry} fill="none" className="financial-chart-line"/></svg><div className="chart-dates"><span>{accountChartPoints[0].date}</span><span>{accountChartPoints.at(-1)?.date}</span></div><div className="account-risk-grid"><article><small>NIFTY 50 · SAME PERIOD</small><b>{accountBenchmarkReturn===null?'—':`${accountBenchmarkReturn>0?'+':''}${accountBenchmarkReturn.toFixed(2)}%`}</b></article><article><small>ANNUALIZED VOLATILITY</small><b>{accountRisk.volatility===null?'—':`${accountRisk.volatility.toFixed(1)}%`}</b><span>{accountRisk.observations} daily observations</span></article><article><small>MAXIMUM DRAWDOWN · 5Y WINDOW</small><b className="loss-value">{accountRisk.maxDrawdown===null?'—':`${accountRisk.maxDrawdown.toFixed(1)}%`}</b></article></div></>:<div className="state-card"><b>Not enough transaction history for this range</b><p>Performance appears after recorded trades overlap with available daily prices. Home shows a separate historical valuation using today’s holdings.</p><small>{accountPoints.length} complete daily account values · {accountTickerKey? 'up to five years of provider prices requested':'Add a holding to start the ledger'}</small></div>}</section>
          </div>
          <div hidden={portfolioTab!=='watchlist'}>
          <div className="section-heading watchlist-heading"><div><h2>Company watchlist</h2><p>Track ideas, set target crossings, inspect fundamentals, and add a buy without leaving the watchlist.</p></div><div className="watchlist-header-actions"><button className="link-button" onClick={()=>setWatchlistManageOpen(true)}>Manage tracked companies</button></div></div>
          <div className="watchlist-controls"><label className="portfolio-search"><Search size={16}/><input aria-label="Search watchlist" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search name, ticker, or sector"/>{query&&<button type="button" aria-label="Clear search" onClick={()=>setQuery('')}>×</button>}</label><div className="watchlist-category-tabs">{(['All','Core','Long-term','Short-term','Monitor'] as const).map(category=><button key={category} className={watchlistCategoryFilter===category?'active':''} onClick={()=>setWatchlistCategoryFilter(category)}>{category}</button>)}</div><small>Source: {portfolio?.source ?? 'loading'} · last successful portfolio refresh {portfolio?.last_successful_update?new Date(portfolio.last_successful_update).toLocaleString('en-IN'):'not available'} · latest completed session {trackedCompanies.map(company=>company.session_date).filter((date):date is string=>Boolean(date)).sort().at(-1)??'unavailable'}. Refresh time indicates when FINN retrieved data; the session date indicates the quote date.</small></div>
          <form className="watchlist-add-company" onSubmit={addCustomWatchlistCompany}><input aria-label="Company name" value={watchlistAddName} onChange={event=>setWatchlistAddName(event.target.value)} placeholder="Company name" required/><input aria-label="Exchange ticker" value={watchlistAddTicker} onChange={event=>setWatchlistAddTicker(event.target.value)} placeholder="TICKER.NS or TICKER.BO" required/><input aria-label="Sector" value={watchlistAddSector} onChange={event=>setWatchlistAddSector(event.target.value)} placeholder="Sector (optional)"/><button type="submit">Add company</button></form>
          {watchlistAlertEvents.filter(item=>!item.seen).length>0&&<section className="watchlist-alert-events"><div><b>Watchlist alerts</b><span>{watchlistAlertEvents.filter(item=>!item.seen).length} new in-app alert(s)</span></div>{watchlistAlertEvents.filter(item=>!item.seen).slice(0,5).map(item=><article key={item.id}><b>{item.company} · {item.ticker}</b><span>{item.mode==='percent'?`Daily move ${item.change_pct!==undefined&&item.change_pct>0?'+':''}${item.change_pct?.toFixed(2)??'—'}% met ${item.direction==='either'?'either-direction':item.direction} threshold ${item.target}%`:`Price ${item.direction==='above'?'crossed above':'crossed below'} ${money(item.target)}`} · latest {money(item.price)}</span><button onClick={()=>setWatchlistAlertEvents(current=>current.map(value=>value.id===item.id?{...value,seen:true}:value))}>Mark read</button></article>)}</section>}
          <div className="watchlist-targets">{watchlistAlerts.map(alert=><span key={alert.id}>{alert.ticker} {alert.mode==='percent'?`${alert.direction} ${alert.percent}% daily move`:`${alert.direction} ${money(alert.price)}`}<button aria-label={`Remove alert for ${alert.ticker}`} onClick={()=>setWatchlistAlerts(current=>current.filter(item=>item.id!==alert.id))}>×</button></span>)}</div>
          {loading&&!portfolio?<div className="state-card">Loading companies…</div>:<div className="watchlist-table"><div className="watchlist-row watchlist-header"><span>Company</span><span>Last price</span><span>Daily move</span><span>Volume · 20-session baseline</span><span>Actions</span></div>{filteredCompanies.filter(company=>watchlistCategoryFilter==='All'||(watchlistCategories[company.ticker]??'Monitor')===watchlistCategoryFilter).map(company=>{const position=holdings[company.ticker];const rows=watchlistHistory[company.ticker]??[];const target=watchlistAlerts.find(item=>item.ticker===company.ticker);const checkedAt=company.checked_at??company.price_updated_at;return <div className="watchlist-row" key={company.ticker}><span className="position-company"><b>{company.name} <button className="company-detail-button" aria-label={`Fundamentals for ${company.name}`} onClick={()=>void openCompanyFundamentals(company)}>ⓘ</button></b><small>{company.ticker} · {company.sector}</small><select aria-label={`${company.name} watchlist category`} value={watchlistCategories[company.ticker]??'Monitor'} onChange={event=>setWatchlistCategory(company.ticker,event.target.value as WatchlistCategory)}><option>Core</option><option>Long-term</option><option>Short-term</option><option>Monitor</option></select></span><b>{company.market_status==='available'?money(company.price):'Unavailable'}</b><b className={company.change_pct!==null&&company.change_pct!==undefined?(company.change_pct<0?'loss-value':'gain-value'):''}>{company.change_pct!==null&&company.change_pct!==undefined?`${company.change_pct>0?'+':''}${company.change_pct.toFixed(2)}%`:'—'}</b><span>{company.volume_ratio_20d!==null&&company.volume_ratio_20d!==undefined?`${company.volume_ratio_20d.toFixed(2)}×`:'—'}<small className={`watchlist-freshness ${staleSession(company.session_date)?'stale-price':''}`}>{company.market_status==='available'?`${staleSession(company.session_date)?'STALE · ':''}Session ${company.session_date??'unknown'} · retrieved ${checkedAt?new Date(checkedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'time unavailable'}`:`Price unavailable · checked ${checkedAt?new Date(checkedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'time unavailable'}`}</small></span><div className="watchlist-row-actions"><button className="holding-action" onClick={()=>openHoldingEditor(company,'buy')}>{position?'Buy more':'Add buy'}</button><button className="holding-action" onClick={()=>openPriceAlert(company)}>{target?'Edit alert':'Price alert'}</button><button className="holding-action" onClick={()=>void openCompanyFundamentals(company)}>Details</button><button className="remove-action" onClick={()=>removeTrackedCompany(company.ticker)}>Remove</button></div><details className="watchlist-returns"><summary>Historical returns</summary><div><span>1W <b className={(returnFor(rows,6)??0)<0?'loss-value':'gain-value'}>{returnFor(rows,6)===null?'—':`${returnFor(rows,6)!>0?'+':''}${returnFor(rows,6)!.toFixed(2)}%`}</b></span><span>1M <b>{returnFor(rows,22)===null?'—':`${returnFor(rows,22)!>0?'+':''}${returnFor(rows,22)!.toFixed(2)}%`}</b></span><span>3M <b>{returnFor(rows,64)===null?'—':`${returnFor(rows,64)!>0?'+':''}${returnFor(rows,64)!.toFixed(2)}%`}</b></span><span>1Y <b>{returnFor(rows,253)===null?'—':`${returnFor(rows,253)!>0?'+':''}${returnFor(rows,253)!.toFixed(2)}%`}</b></span></div></details></div>})}</div>}
          {!loading&&filteredCompanies.length===0&&<div className="state-card">No tracked company matches “{query}”.</div>}
          </div>
          <div hidden={portfolioTab!=='activity'} className="portfolio-activity-view"><div className="section-heading"><div><h2>Transactions &amp; events</h2><p>Weighted-average cost basis · trades, cash flows, dividends, splits, and bonus issues remain in this browser’s ledger.</p></div><button className="link-button" onClick={exportPortfolio}>Export CSV</button></div><form className="portfolio-event-entry" onSubmit={saveActivity}><label>Activity<select value={activityKind} onChange={event=>{const kind=event.target.value as Exclude<TransactionKind,'buy'|'sell'>;setActivityKind(kind);if(kind==='dividend'&&activityRecordDate>activityDate)setActivityRecordDate(activityDate)}}><option value="dividend">Dividend received</option><option value="deposit">Cash deposit</option><option value="withdrawal">Cash withdrawal</option><option value="split">Stock split</option><option value="bonus">Bonus shares</option></select></label>{['dividend','split','bonus'].includes(activityKind)&&<label>Company<select value={activityTicker} onChange={event=>setActivityTicker(event.target.value)}><option value="">Choose a company</option>{allCompanies.map(company=><option key={company.ticker} value={company.ticker}>{company.name} · {company.ticker}</option>)}</select></label>}<label>{activityKind==='dividend'?'Payment date':'Activity date'}<input type="date" value={activityDate} onChange={event=>{const date=event.target.value;setActivityDate(date);if(activityRecordDate>date)setActivityRecordDate(date)}} required/></label>{activityKind==='dividend'&&<label>Dividend record date<input type="date" value={activityRecordDate} max={activityDate} onChange={event=>setActivityRecordDate(event.target.value)} required/><small>FINN checks that shares were recorded on this date. Enter the dividend amount received on the payment date.</small></label>}{['deposit','withdrawal','dividend'].includes(activityKind)&&<label>{activityKind==='dividend'?'Dividend amount received':'Cash amount'}<input type="number" min="0.01" step="any" value={activityAmount} onChange={event=>setActivityAmount(event.target.value)} required placeholder="₹ amount"/></label>}{['split','bonus'].includes(activityKind)&&<label>{activityKind==='split'?'New shares per old share':'Bonus shares per existing share'}<input type="number" min="0.01" step="any" value={activityRatio} onChange={event=>setActivityRatio(event.target.value)} required placeholder={activityKind==='split'?'2 for a 2:1 split':'0.5 for 1 bonus per 2 shares'}/></label>}<label>Note<input value={activityNote} onChange={event=>setActivityNote(event.target.value)} placeholder="Optional source or reference"/></label><button type="submit">Save activity</button></form>{activityError&&<p className="activity-error" role="alert">{activityError}</p>}{activityMessage&&<p className="workflow-message">{activityMessage}</p>}{transactions.some(item=>item.origin==='migrated_opening'||item.note?.toLowerCase().includes('migrated from saved'))&&<p className="migration-notice"><b>Estimated opening history</b> Some saved holdings were converted into opening entries dated at migration time. These are cost-basis estimates, not actual trade dates or a cash transfer. Replace them with real transactions if you have the records.</p>}<div className="activity-summary"><article><small>Cash balance</small><b>{money(ledger.cash)}</b></article><article><small>Realized P&amp;L</small><b>{money(ledger.realizedPnl)}</b></article><article><small>Dividends received</small><b>{money(ledger.dividends)}</b></article><article><small>Net contributions{transactions.some(item=>item.origin==='migrated_opening'||item.note?.toLowerCase().includes('migrated from saved'))?' · includes migrated basis':''}</small><b>{money(ledger.contributions)}</b></article></div><div className="transaction-list"><div className="transaction-row transaction-head"><span>Date</span><span>Activity</span><span>Company</span><span>Details</span><span>Realized P&amp;L</span><span></span></div>{transactions.slice().reverse().map(item=>{const realized=ledger.realized.find(value=>value.id===item.id)?.realized_pnl;return <article className="transaction-row" key={item.id}><span>{item.date}</span><b>{item.kind.replaceAll('_',' ')}{item.auto&&<small>auto-funded</small>}{(item.origin==='migrated_opening'||item.note?.toLowerCase().includes('migrated from saved'))&&<small className="migrated-badge">estimated opening · not actual trade</small>}</b><span>{item.ticker??'Cash'}</span><span>{item.quantity?`${item.quantity.toLocaleString('en-IN')} @ ${money(item.price)}`:item.amount?money(item.amount):item.ratio?`${item.ratio}× action`:''}{item.record_date&&<small>record date {item.record_date} · {item.record_quantity?.toLocaleString('en-IN')} eligible shares</small>}{item.note&&<small>{item.note}</small>}</span><b className={realized===undefined?'':realized<0?'loss-value':'gain-value'}>{realized===undefined?'—':money(realized)}</b><button className="remove-action" aria-label={`Delete ${item.kind} entry from ${item.date}`} onClick={()=>{if(window.confirm('Delete this ledger entry? Portfolio figures will be recalculated.'))setTransactions(current=>current.filter(value=>value.id!==item.id))}}>Delete</button></article>})}</div><p className="holdings-note">Cash is funded automatically when a buy would exceed recorded cash, and that deposit is marked for review. Add the actual external transfer if known. Delete an incorrect entry and record it again. Splits and bonus issues adjust weighted-average cost without creating profit. Dividends add to cash and realized income separately.</p></div>
        </section>
        {holdingEditor&&<div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setHoldingEditor(null)}}><form className="holding-modal position-editor" onSubmit={saveHolding} role="dialog" aria-modal="true" aria-labelledby="holding-modal-title" aria-describedby="holding-modal-description">
          <button className="modal-close" type="button" onClick={()=>setHoldingEditor(null)} aria-label="Close position editor">×</button>
          <span className="eyebrow-mini">RECORD A TRADE · WEIGHTED-AVERAGE COST</span>
          <h2 id="holding-modal-title">{holdingEditor.name}</h2>
          <p className="holding-ticker">{holdingEditor.ticker} · {holdingEditor.sector}</p>
          <p id="holding-modal-description">Record the executed quantity, price, date, and fees. FINN recalculates shares and cost basis from the ledger.</p>
          <div className="holding-market-reference"><span>Latest market price</span><b>{holdingEditor.market_status==='available'&&holdingEditor.price!==undefined?money(holdingEditor.price):'Unavailable'}</b><small>{holdingEditor.market_status==='available'?'Market data may be delayed.':'Price data is currently unavailable.'}</small></div>
          <label>Trade type<select value={holdingTradeKind} onChange={event=>setHoldingTradeKind(event.target.value as 'buy'|'sell')}><option value="buy">Buy shares</option>{holdings[holdingEditor.ticker]&&<option value="sell">Sell shares</option>}</select></label>
          <label>Trade date<input type="date" required value={holdingTradeDate} onChange={event=>setHoldingTradeDate(event.target.value)}/></label>
          <label>Shares<input type="number" min="0.0001" step="any" required value={holdingShares} onChange={event=>setHoldingShares(event.target.value)} placeholder="e.g. 10" autoFocus/><small>Fractional quantities are supported.{holdingTradeKind==='sell'&&holdings[holdingEditor.ticker]?` Available: ${holdings[holdingEditor.ticker].shares.toLocaleString('en-IN')}`:''}</small></label>
          <label>Executed price per share<input type="number" min="0.01" step="any" required value={holdingTradePrice} onChange={event=>setHoldingTradePrice(event.target.value)} placeholder="₹ per share"/></label>
          <label>Fees and charges<input type="number" min="0" step="any" value={holdingFees} onChange={event=>setHoldingFees(event.target.value)} required/></label>
          {holdingIsDemo&&<label className="demo-choice"><span><b>Demo position</b><small>This legacy position began as sample data. New trades are recorded against it.</small></span></label>}
          {holdingTradeKind==='buy'&&<small>When recorded cash is short, FINN adds a clearly marked auto-funded cash deposit. You can correct it in Activity.</small>}
          {holdingError&&<p className="holding-error" role="alert">{holdingError}</p>}
          <div className="modal-actions"><button type="button" className="cancel-button" onClick={()=>setHoldingEditor(null)}>Cancel</button><button type="submit" className="save-button">Save {holdingTradeKind}</button></div>
        </form></div>}
        {priceAlertTarget&&<div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setPriceAlertTarget(null)}}><form className="holding-modal" onSubmit={savePriceAlert} role="dialog" aria-modal="true" aria-labelledby="price-alert-title"><button className="modal-close" type="button" onClick={()=>setPriceAlertTarget(null)} aria-label="Close price alert">×</button><span className="eyebrow-mini">WATCHLIST PRICE ALERT</span><h2 id="price-alert-title">{priceAlertTarget.name}</h2><p>Alerts are checked against completed-session prices when FINN refreshes while open.</p><label>Alert condition<select value={priceAlertMode} onChange={event=>{const mode=event.target.value as 'price'|'percent';setPriceAlertMode(mode);setPriceAlertDirection(mode==='price'?'above':'up');setPriceAlertError('')}}><option value="price">Price reaches a level</option><option value="percent">Daily move reaches a percentage</option></select></label><label>{priceAlertMode==='price'?'Trigger when price':'Daily move direction'}<select value={priceAlertDirection} onChange={event=>setPriceAlertDirection(event.target.value as 'above'|'below'|'up'|'down'|'either')}><option value={priceAlertMode==='price'?'above':'up'}>{priceAlertMode==='price'?'Crosses above':'Rises by at least'}</option><option value={priceAlertMode==='price'?'below':'down'}>{priceAlertMode==='price'?'Crosses below':'Falls by at least'}</option>{priceAlertMode==='percent'&&<option value="either">Either direction</option>}</select></label><label>{priceAlertMode==='price'?'Target price (₹)':'Daily movement threshold (%)'}<input type="number" min={priceAlertMode==='price'?'0.01':'0.1'} max={priceAlertMode==='percent'?'100':undefined} step={priceAlertMode==='price'?'any':'0.1'} required value={priceAlertValue} onChange={event=>{setPriceAlertValue(event.target.value);setPriceAlertError('')}}/></label>{priceAlertMode==='percent'&&<small>Compared with the previous completed session close. A signal is recorded once per session when the selected movement condition is met.</small>}{priceAlertError&&<p className="activity-error" role="alert">{priceAlertError}</p>}<div className="modal-actions"><button type="button" className="cancel-button" onClick={()=>setPriceAlertTarget(null)}>Cancel</button><button type="submit" className="save-button">Save alert</button></div></form></div>}
        {watchlistManageOpen&&<div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setWatchlistManageOpen(false)}}><section className="holding-modal watchlist-manager" role="dialog" aria-modal="true" aria-labelledby="watchlist-manager-title"><button className="modal-close" type="button" onClick={()=>setWatchlistManageOpen(false)} aria-label="Close watchlist manager">×</button><span className="eyebrow-mini">TRACKED COMPANIES · MAXIMUM 20</span><h2 id="watchlist-manager-title">Manage watchlist</h2><p>Removing a company hides it from the watchlist. It stays in your holdings and transaction history.</p><div className="watchlist-manager-list">{allCompanies.map(company=>{const isTracked=trackedCompanies.some(item=>item.ticker===company.ticker);return <label key={company.ticker}><input type="checkbox" checked={isTracked} disabled={!isTracked&&trackedCompanies.length>=20} onChange={event=>toggleTrackedCompany(company.ticker,event.target.checked)}/><span>{company.name}<small>{company.ticker} · {company.sector}</small></span></label>})}</div><div className="modal-actions"><button className="save-button" onClick={()=>setWatchlistManageOpen(false)}>Done</button></div></section></div>}
        {fundamentalCompany&&<div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget){setFundamentalCompany(null);setFundamentals(null)}}}><section className="holding-modal fundamentals-modal" role="dialog" aria-modal="true" aria-labelledby="fundamentals-title"><button className="modal-close" type="button" onClick={()=>{setFundamentalCompany(null);setFundamentals(null)}} aria-label="Close fundamentals">×</button><span className="eyebrow-mini">COMPANY SNAPSHOT · {fundamentalCompany.ticker}</span><h2 id="fundamentals-title">{fundamentalCompany.name}</h2>{fundamentalsLoading?<div className="state-card">Loading provider metrics…</div>:fundamentals&&<><div className="fundamentals-grid">{Object.entries(fundamentals.metrics).filter(([,value])=>value!==null&&value!==undefined).map(([key,value])=><article key={key}><small>{key.replaceAll('_',' ')}</small><b>{typeof value==='number'?(key==='market_cap'?money(value):['revenue_growth','earnings_growth','dividend_yield','profit_margin','return_on_equity'].includes(key)?`${(value*100).toFixed(2)}%`:value.toFixed(2)):String(value)}</b></article>)}</div><p>{fundamentals.notice}</p><small>Source: {fundamentals.source} · Retrieved {fundamentals.retrieved_at?new Date(fundamentals.retrieved_at).toLocaleString('en-IN'):'unknown'}</small></>}<div className="modal-actions"><button className="save-button" onClick={()=>{setFundamentalCompany(null);setFundamentals(null)}}>Done</button></div></section></div>}
      </>}
      </div>
        <footer className="disclaimer">{portfolio?.notice ?? 'Portfolio universe for product demonstration only; not an investment recommendation.'}<span>Market data may be delayed. Research answers cite uploaded primary sources.</span></footer>
      </div>
      <nav className="mobile-nav" aria-label="Main navigation">{nav.map(({label,icon:Icon,target})=><button key={label} aria-current={active===label?'page':undefined} className={active===label?'mobile-active':''} onClick={()=>navigate(label,target)}><Icon size={19}/><span>{label}</span></button>)}</nav>
    </main>
  </div>
}
export default App
