import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Bell, BriefcaseBusiness, CalendarDays, FileSearch, FileText, LayoutDashboard, RefreshCw, Search, ShieldCheck, Sparkles, Target, TrendingDown, TrendingUp, Upload, Trash2, RotateCw } from 'lucide-react'
import { buildAccountHistory, calculateReturnCorrelations, deriveLedger, evaluateWatchlistAlert, loadPortfolioTransactions, positionAtDate, type LedgerPosition, type PortfolioTransaction, type TransactionKind } from './portfolioLedger'
import { askResearchQuestion, compareResearchCompanies as compareResearchCompaniesApi, explainAnnouncement as explainAnnouncementApi, explainMarketSignal as explainMarketSignalApi, getDailyBriefing, requestDailyBriefing, requestPortfolioIntelligence, getResearchDocumentDependencies, getResearchDocuments, type BriefingDevelopment, type CitationFailure, type ExplanationResponse, type IntelligenceResponse, type MarketSignalExplanation, type PortfolioIntelligenceInput, type ResearchComparisonResponse, type ResearchQueryResponse, type ResearchQueryScope } from './services/aiApi'
import { AIConversation, type AIConversationExchange } from './components/ai/AIConversation'
import { IntelligenceAnswer } from './components/ai/IntelligenceAnswer'
import { SourceDiscovery } from './components/research/SourceDiscovery'

type Company = { name: string; ticker: string; sector: string; market_status: 'available' | 'unavailable'; reason?: string; session_date?: string; price_updated_at?: string; checked_at?: string; source_name?: string; currency?: string; price?: number; previous_close?: number | null; change_pct?: number | null; volume?: number | null; average_volume_20d?: number | null; volume_ratio_20d?: number | null; unusual_volume?: boolean; unusual_price?: boolean }
type Portfolio = { source: string; retrieved_at: string; last_successful_update?: string | null; notice: string; companies: Company[]; available_count: number; alert_count: number; alerts: (Company & { alert_types?: string[] })[]; settings: { volume_multiple: number; price_move_pct: number } }
type Announcement = { id: string; company: string; ticker: string; subject: string; details: string; filed_at: string; source_url: string; source_name?: string; exchange?: string; category: string; importance: number; priority: string; rule_explanation: string; is_verified_example?: boolean }
type AlertHistoryItem = { id: string; kind: 'filing' | 'market'; ticker: string; company: string; subject?: string; details?: string; filed_at?: string; event_at: string; session_date?: string; source_url: string; source_name?: string; exchange?: string; category: string; signal_type?: string; importance: number; priority: string; rule_explanation?: string; change_pct?: number | null; price_threshold_pct?: number | null; previous_close?: number | null; volume_ratio_20d?: number | null; volume_threshold?: number | null; volume?: number | null; average_volume_20d?: number | null; price?: number | null; is_verified_example?: boolean; is_read: boolean }
type AlertSummary = { window_hours: number; total: number; unread: number; high_priority: number; filings: number; price_movements: number; volume_spikes: number; trend_7d_ist: {date:string;count:number}[]; category_counts: Record<string,number>; computed_at: string; coverage?: {market_source?:string|null;last_successful_market_update?:string|null;latest_completed_session?:string|null;market_companies_available?:number;market_companies_total?:number|null;market_status?:string} }
type AlertView = 'all' | 'filings' | 'price' | 'volume'
type FilingFilter = 'all' | 'results' | 'corporate' | 'shareholding' | 'dividend' | 'board' | 'mergers'
type ResearchSource = ResearchQueryResponse['sources'][number]
type ResearchDocument = import('./services/aiApi').ResearchDocumentSummary
type ResearchEvidenceQuality = { coverage: 'limited'|'moderate'|'broad'; confidence: 'low'|'moderate'; quality: string; independence: string; source_domains: number; near_duplicate_passage_pairs: number; compared_passage_pairs: number; source_pages: number; documents: number; document_types: number; note: string }
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
const briefingChangeLabel = (change?: { status: string; change_pct: number | null }) => change?.change_pct !== null && change?.change_pct !== undefined && ['available','negative_base'].includes(change.status) ? `${change.change_pct > 0 ? '+' : ''}${change.change_pct.toFixed(1)}%` : ({ missing_data: 'Missing', unit_mismatch: 'Unit mismatch', zero_base: 'Undefined · zero base', negative_revenue: 'Not comparable', non_positive_base: 'Not comparable' }[change?.status ?? ''] ?? 'Unavailable')
const changeValue = (change: FinancialChange) => ['available','negative_base'].includes(change.status) && change.change_pct !== null ? `${change.change_pct > 0 ? '+' : ''}${change.change_pct.toFixed(2)}${change.delta_type==='percentage_points'?' pp':'%'}` : ({ missing_data: 'Data missing', unit_mismatch: 'Unit mismatch', zero_base: 'Undefined · zero base', negative_revenue: 'Not comparable', non_positive_base: 'Not comparable', negative_base: 'Not calculated', available: 'Not calculated' }[change.status])
const changeNote = (change: FinancialChange, currentUnit: string) => change.status === 'missing_data' ? `${change.period} has not been entered` : change.status === 'unit_mismatch' ? `${change.period} · ${change.unit ?? 'unknown unit'} vs ${currentUnit}` : change.status === 'zero_base' ? `${change.period} · percentage undefined for zero base` : change.status === 'negative_base' ? `${change.period} · change relative to absolute prior value` : change.status === 'negative_revenue' ? `${change.period} · margin is not comparable against negative revenue` : change.period
const promiseStatusLabel = (status: string) => ({ achieved: 'achieved', exceeded: 'exceeded', missed: 'missed', pending: 'pending period', actual_missing: 'actual not entered', not_comparable: 'not comparable' }[status] ?? status.replaceAll('_',' '))
const citationFailureLabel = (type: CitationFailure['type']) => ({ missing_source: 'Missing source', page_mapping: 'Page mapping mismatch', source_mapping: 'Source metadata mismatch', unsupported_claim: 'Unsupported or uncited claim' }[type])
const returnFor = (rows: PricePoint[], points: number) => rows.length >= points ? (rows.at(-1)!.close / rows.at(-points)!.close - 1) * 100 : null
const staleSession = (date?: string) => !date || (Date.now() - Date.parse(`${date}T00:00:00Z`)) / 86400000 > 5

function BriefingSparkline({ points, ticker, throughDate }: { points: PricePoint[]; ticker: string; throughDate?: string }) {
  const rows = points.filter(point => Number.isFinite(point.close) && (!throughDate || point.date.slice(0,10) <= throughDate.slice(0,10))).slice(-20)
  if (rows.length < 2) return null
  const values = rows.map(point => point.close)
  const low = Math.min(...values), high = Math.max(...values), span = high - low || 1
  const coordinates = values.map((value,index) => `${(index/(values.length-1))*68},${27-((value-low)/span)*22}`)
  const path = coordinates.map((point,index) => `${index?'L':'M'}${point}`).join(' ')
  const direction = values.at(-1)! >= values[0] ? 'up' : 'down'
  return <svg className={`briefing-sparkline ${direction}`} viewBox="0 0 68 32" role="img" aria-label={`${ticker} Yahoo Finance adjusted daily closing-price trend from ${rows[0].date} to ${rows.at(-1)!.date}`}><path d={path}/></svg>
}

function HomeBriefingVisual({ result, histories }: { result: IntelligenceResponse; histories: PriceHistory }) {
  const items = result.developments ?? []
  const sources = result.sources ?? []
  const session = result.coverage?.latest_market_session
  const dateValue = typeof session === 'string' ? session : result.generated_at
  const dateLabel = dateValue ? new Date(`${dateValue.slice(0,10)}T12:00:00`).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'}) : 'Reporting date unavailable'
  const sourceFor = (item: BriefingDevelopment) => sources.find(source => source.id === item.source_id) ?? sources.find(source => source.label.toLowerCase().includes(item.company.toLowerCase()) && (!item.session_date || source.source_date?.slice(0,10) === item.session_date.slice(0,10)))
  const historyFor = (ticker: string) => Object.entries(histories).find(([key]) => tickerKey(key) === tickerKey(ticker))?.[1] ?? []

  return <section className="home-briefing-visual" aria-labelledby="home-briefing-visual-title">
    <header className="home-briefing-visual-heading"><div><span className="eyebrow-mini">PUSH INTELLIGENCE · FINN INTERPRETATION</span><h3 id="home-briefing-visual-title">Tracked-company developments — {dateLabel}</h3><p>Key market triggers, interpretation, checks and supporting evidence for this reporting window.</p></div><span className="briefing-date-badge"><CalendarDays size={13}/>{dateLabel}</span></header>
    {items.length ? <div className="home-briefing-signal-grid">{items.map(item=>{
      const market = item.kind === 'market'
      const source = sourceFor(item)
      const triggers = market ? (item.signal_types?.length ? item.signal_types : [item.category]).map(labelCategory).join(' + ') : labelCategory(item.category)
      const history = market ? historyFor(item.ticker) : []
      const hasAlignedHistory = history.filter(point => Number.isFinite(point.close) && (!item.session_date || point.date.slice(0,10) <= item.session_date.slice(0,10))).length > 1
      const price = item.price_change_pct
      const priceText = price == null ? 'Unavailable' : `${price > 0 ? '+' : ''}${price.toFixed(2)}%`
      return <article className={`home-briefing-signal-card ${item.priority==='high'?'is-high':''}`} key={item.id}>
        <div className="briefing-signal-main"><div className="briefing-signal-identity"><span className="briefing-signal-monogram" aria-hidden="true">{item.company.split(/\s+/).map(part=>part[0]).join('').slice(0,2).toUpperCase()}</span><div><b>{item.company}</b><small>{item.ticker}</small></div></div><span className={`briefing-trigger-badge ${market?'market-trigger':'filing-trigger'}`}>{triggers}</span>
          <p>{market ? <>{item.volume_ratio_20d != null && <>Volume was <b>{item.volume_ratio_20d.toFixed(2)}×</b> the 20-session average{item.volume_threshold != null && <>; above the <b>{item.volume_threshold.toFixed(2)}×</b> trigger</>}. </>}{price != null && <>Close moved <b className={price < 0?'signal-negative':'signal-positive'}>{priceText}</b> vs previous close{item.price_threshold_pct != null && <>; {Math.abs(price) >= item.price_threshold_pct ? 'crossing' : 'below'} the configured ±{item.price_threshold_pct.toFixed(2)}% threshold</>}.</>}{item.volume_ratio_20d == null && price == null && item.summary}</> : item.summary}</p>
          {item.why_it_may_matter&&<div className="briefing-signal-why"><b>Why it may matter</b><span>{item.why_it_may_matter}</span></div>}
          <div className="briefing-signal-footer"><span className={`briefing-priority-tag ${item.priority}`}>{labelCategory(item.priority)} priority</span>{source&&(source.source_url?<a href={source.source_url} target="_blank" rel="noreferrer" className="briefing-citation-chip" title={source.label}>[{source.id}]</a>:<span className="briefing-citation-chip" title={source.label}>[{source.id}]</span>)}</div>
        </div>
        <div className="briefing-signal-visual">{market&&hasAlignedHistory?<BriefingSparkline points={history} ticker={item.ticker} throughDate={item.session_date}/>:market&&price!=null?<span className={`briefing-price-metric ${price<0?'signal-negative':'signal-positive'}`}>{priceText}</span>:market?<span className="briefing-no-series">No price history</span>:null}{market&&price!=null&&<small>vs previous close</small>}{market&&item.volume_ratio_20d!=null&&<strong>Vol {item.volume_ratio_20d.toFixed(2)}×</strong>}</div>
        {item.details&&<details className="briefing-signal-details"><summary>Filing details</summary><p>{item.details}</p></details>}
      </article>
    })}</div> : <div className="home-briefing-visual-empty"><b>No material developments in this report.</b><span>{result.answer}</span></div>}
    {Boolean(result.uncertainties?.length)&&<section className="home-briefing-coverage"><b><ShieldCheck size={14}/> Uncertainty and coverage</b><ul>{result.uncertainties?.map((item,index)=><li key={index}>{item}</li>)}</ul></section>}
    {sources.length>0&&<section className="home-briefing-evidence"><header><b><FileText size={14}/> Evidence ({sources.length})</b></header><div>{sources.map(source=><details key={source.id}><summary><span>[{source.id}]</span>{source.label}{source.source_date?` · ${shortDate(source.source_date)}`:''}</summary><p>{source.excerpt}</p>{source.source_url&&<a href={source.source_url} target="_blank" rel="noreferrer">Open source ↗</a>}</details>)}</div></section>}
    <details className="home-briefing-full-analysis"><summary>View full FINN interpretation and verification</summary><IntelligenceAnswer result={result}/></details>
  </section>
}

function App() {
  const [active, setActive] = useState(pageFromUrl)
  const [alertsTab, setAlertsTab] = useState<AlertView>('all')
  const [filingFilter, setFilingFilter] = useState<FilingFilter>('all')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [researchTab, setResearchTab] = useState<'ask' | 'financials' | 'commitments' | 'analysis' | 'sources'>('ask')
  const [researchPathDialogOpen, setResearchPathDialogOpen] = useState(false)
  const [researchCompanyTicker, setResearchCompanyTicker] = useState('')
  const [researchCompanySearch, setResearchCompanySearch] = useState('')
  const [researchCompanyPickerOpen, setResearchCompanyPickerOpen] = useState(false)
  const [discoverySearch, setDiscoverySearch] = useState('')
  const [recentResearchTickers, setRecentResearchTickers] = useState<string[]>(() => { try { const value=JSON.parse(localStorage.getItem('finn-recent-research-v1')||'[]'); return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string').slice(0,6):[] } catch { return [] } })
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
  const [alertSummary, setAlertSummary] = useState<AlertSummary | null>(null)
  const [alertUnreadCount, setAlertUnreadCount] = useState(0)
  const alertHistoryRequestId = useRef(0)
  const [alertHistoryLoading, setAlertHistoryLoading] = useState(false)
  const [alertHistoryError, setAlertHistoryError] = useState('')
  const [announcementError, setAnnouncementError] = useState('')
  const [announcementUpdatedAt, setAnnouncementUpdatedAt] = useState('')
  const [announcementWindow, setAnnouncementWindow] = useState(24)
  const [explanations, setExplanations] = useState<Record<string, string>>({})
  const [explanationModes, setExplanationModes] = useState<Record<string, string>>({})
  const [explanationVerifications, setExplanationVerifications] = useState<Record<string, ExplanationResponse['verification']>>({})
  const [explaining, setExplaining] = useState('')
  const [marketExplanations, setMarketExplanations] = useState<Record<string, MarketSignalExplanation>>({})
  const [marketExplaining, setMarketExplaining] = useState('')
  const [dailyBriefing, setDailyBriefing] = useState<IntelligenceResponse | null>(null)
  const [dailyBriefingBusy, setDailyBriefingBusy] = useState(false)
  const [dailyBriefingError, setDailyBriefingError] = useState('')
  const [briefingWindow, setBriefingWindow] = useState(24)
  const [briefingLoading, setBriefingLoading] = useState(false)
  const [routineDevelopmentsOpen, setRoutineDevelopmentsOpen] = useState(false)
  const [portfolioIntelligence, setPortfolioIntelligence] = useState<IntelligenceResponse | null>(null)
  const [portfolioIntelligenceBusy, setPortfolioIntelligenceBusy] = useState(false)
  const [portfolioIntelligenceError, setPortfolioIntelligenceError] = useState('')
  const [comparisonTickers, setComparisonTickers] = useState<[string,string]>(['',''])
  const [researchComparison, setResearchComparison] = useState<ResearchComparisonResponse|null>(null)
  const [researchComparisonBusy, setResearchComparisonBusy] = useState(false)
  const [researchComparisonError, setResearchComparisonError] = useState('')
  const [settings, setSettings] = useState({ volume_multiple: 1.3, price_move_pct: 4 })
  const [settingsMessage, setSettingsMessage] = useState('')
  const [documents, setDocuments] = useState<ResearchDocument[]>([])
  const [researchDocumentsLoaded, setResearchDocumentsLoaded] = useState(false)
  const [researchDocumentsError, setResearchDocumentsError] = useState('')
  const [aiEnabled, setAiEnabled] = useState(false)
  const [aiProvider, setAiProvider] = useState('Local retrieval')
  const [documentId, setDocumentId] = useState('')
  const [researchQuestion, setResearchQuestion] = useState('')
  const [researchAllCompanySources, setResearchAllCompanySources] = useState(false)
  const [quickAskExchanges, setQuickAskExchanges] = useState<AIConversationExchange[]>([])
  const [homeAIQuestion, setHomeAIQuestion] = useState('')
  const [homeAICompanyTicker, setHomeAICompanyTicker] = useState('')
  const [homeQuestionHandoff, setHomeQuestionHandoff] = useState<{ id: string; question: string; ticker?: string } | null>(null)
  const [homeScopeNeedsConfirmation, setHomeScopeNeedsConfirmation] = useState(false)
  const [homeScopeDocumentId, setHomeScopeDocumentId] = useState('')
  const [homeScopeCompanyTicker, setHomeScopeCompanyTicker] = useState('')
  const consumedHomeHandoff = useRef<string | null>(null)
  const researchRequestLock = useRef(false)
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
  const [researchDatasetLoading, setResearchDatasetLoading] = useState({ financials: false, evidence: false, commitments: false })
  const [researchDatasetErrors, setResearchDatasetErrors] = useState({ financials: '', evidence: '', commitments: '' })
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
  const hasOpenDialog = Boolean(holdingEditor || priceAlertTarget || watchlistManageOpen || fundamentalCompany)
  const [activityKind,setActivityKind]=useState<Exclude<TransactionKind,'buy'|'sell'>>('dividend')
  const [activityTicker,setActivityTicker]=useState('')
  const [activityDate,setActivityDate]=useState(new Date().toLocaleDateString('en-CA'))
  const [activityRecordDate,setActivityRecordDate]=useState(new Date().toLocaleDateString('en-CA'))
  const [activityAmount,setActivityAmount]=useState('')
  const [activityRatio,setActivityRatio]=useState('')
  const [activityNote,setActivityNote]=useState('')
  const [activityError,setActivityError]=useState('')
  const [activityMessage,setActivityMessage]=useState('')

  useEffect(() => {
    if (!hasOpenDialog) return
    const previousOverflow = document.body.style.overflow
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = 'hidden'
    const dialog = document.querySelector<HTMLElement>('.modal-backdrop [role="dialog"]')
    const focusable = () => dialog ? [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')].filter(item => item.tabIndex >= 0) : []
    const firstFocus = focusable()[0]
    if (dialog && !dialog.contains(document.activeElement)) firstFocus?.focus()
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (watchlistManageOpen) setWatchlistManageOpen(false)
        else if (priceAlertTarget) setPriceAlertTarget(null)
        else if (fundamentalCompany) { setFundamentalCompany(null); setFundamentals(null) }
        else if (holdingEditor) setHoldingEditor(null)
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', trapFocus)
    return () => {
      document.removeEventListener('keydown', trapFocus)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [hasOpenDialog])

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
    } catch (error) {
      setAnnouncementError(error instanceof Error ? error.message : 'NSE announcement feed unavailable.')
      setAnnouncementUpdatedAt('')
      setAnnouncements([])
    }
  }

  async function loadAlertHistory(windowHours = 720) {
    const requestId = ++alertHistoryRequestId.current
    setAlertHistoryError('')
    setAlertHistoryLoading(true)
    try {
      const response = await fetch(`${API}/api/alerts/history?window_hours=${windowHours}`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || 'Alert history is unavailable.')
      if (requestId !== alertHistoryRequestId.current) return
      setAlertHistory(Array.isArray(payload.alerts) ? payload.alerts : [])
      if (payload.summary) setAlertSummary(payload.summary as AlertSummary)
      if (Number.isFinite(payload.all_unread_count)) setAlertUnreadCount(payload.all_unread_count)
    } catch (error) {
      if (requestId !== alertHistoryRequestId.current) return
      setAlertHistoryError(error instanceof Error ? error.message : 'Alert history is unavailable.')
    } finally { if (requestId === alertHistoryRequestId.current) setAlertHistoryLoading(false) }
  }

  async function setAlertRead(item: AlertHistoryItem, isRead: boolean) {
    try {
      const response = await fetch(`${API}/api/alerts/read`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: item.id, is_read: isRead }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || 'Could not update this alert.')
      setAlertHistory(current => current.map(alert => alert.id === item.id ? { ...alert, is_read: isRead } : alert))
      setAlertUnreadCount(current => Math.max(0, current + (isRead ? -1 : 1)))
    } catch (error) {
      setAlertHistoryError(error instanceof Error ? error.message : 'Could not update this alert.')
    }
  }

  async function loadDocuments(preferredId = ''): Promise<ResearchDocument[]> {
    setResearchDocumentsError('')
    try {
      const payload = await getResearchDocuments()
      const loaded: ResearchDocument[] = Array.isArray(payload.documents) ? payload.documents : []
      setDocuments(loaded)
      setAiEnabled(Boolean(payload.ai_enabled))
      setAiProvider(payload.ai_provider ?? 'Local retrieval')
      setResearchDocumentsLoaded(true)
      setDocumentId(current => preferredId && loaded.some(doc => doc.id === preferredId) ? preferredId : current && loaded.some(doc => doc.id === current) ? current : '')
      return loaded
    } catch (error) {
      setResearchDocumentsError(error instanceof Error ? error.message : 'Research service is unavailable.')
      setResearchDocumentsLoaded(true)
      throw error
    }
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

  useEffect(() => {
    if (active !== 'Research' || !homeQuestionHandoff || consumedHomeHandoff.current === homeQuestionHandoff.id) return
    consumedHomeHandoff.current = homeQuestionHandoff.id
    const handoff = homeQuestionHandoff
    const matchingDocument = handoff.ticker ? documents.find(doc => tickerKey(doc.ticker) === tickerKey(handoff.ticker!) && !doc.superseded_by) : documents.find(doc => doc.id === documentId && !doc.superseded_by)
    setHomeQuestionHandoff(null)
    setHomeAIQuestion('')
    setResearchTab('ask')
    setResearchQuestion(handoff.question)
    if (handoff.ticker) setResearchCompanyTicker(handoff.ticker)
    if (matchingDocument) setDocumentId(matchingDocument.id)
    setHomeScopeNeedsConfirmation(true)
    setHomeScopeDocumentId(matchingDocument?.id ?? '')
    setHomeScopeCompanyTicker(handoff.ticker ?? matchingDocument?.ticker ?? '')
    setResearchAllCompanySources(false)
    setResearchMessage('Your question is ready. Confirm the company and source scope before submitting it to FINN.')
  }, [active, homeQuestionHandoff, documents, documentId])

  const allCompanies = useMemo(() => [...(portfolio?.companies ?? []), ...customCompanies], [portfolio, customCompanies])
  const researchCompanyChoices = useMemo(() => {
    const byTicker = new Map<string, { ticker: string; name: string; sector?: string }>()
    documents.filter(doc => !doc.superseded_by).forEach(doc => byTicker.set(tickerKey(doc.ticker), { ticker: doc.ticker, name: doc.company }))
    allCompanies.forEach(company => { if (!byTicker.has(tickerKey(company.ticker))) byTicker.set(tickerKey(company.ticker), { ticker: company.ticker, name: company.name, sector: company.sector }) })
    return [...byTicker.values()].sort((a,b) => a.name.localeCompare(b.name))
  }, [documents, allCompanies])
  const researchPathCompanies = researchCompanyChoices.filter(company => portfolio?.companies.some(item => tickerKey(item.ticker) === tickerKey(company.ticker)) || documents.some(doc => !doc.superseded_by && tickerKey(doc.ticker) === tickerKey(company.ticker)))
  const researchPathCompanyMatches = researchPathCompanies.filter(company => !researchCompanySearch.trim() || `${company.name} ${company.ticker} ${company.sector ?? ''}`.toLowerCase().includes(researchCompanySearch.trim().toLowerCase()))
  const currentResearchTicker = researchCompanyTicker || documents.find(doc => doc.id === documentId)?.ticker || ''
  const currentResearchCompany = researchCompanyChoices.find(company => tickerKey(company.ticker) === tickerKey(currentResearchTicker))
  const currentResearchDocuments = documents.filter(doc => tickerKey(doc.ticker) === tickerKey(currentResearchTicker) && !doc.superseded_by)
  const researchCompanyMatches = researchCompanySearch.trim() ? researchCompanyChoices.filter(company => `${company.name} ${company.ticker} ${company.sector ?? ''}`.toLowerCase().includes(researchCompanySearch.trim().toLowerCase())).slice(0,8) : []
  const discoveryCompanyMatches = discoverySearch.trim() ? researchCompanyChoices.filter(company => `${company.name} ${company.ticker} ${company.sector ?? ''}`.toLowerCase().includes(discoverySearch.trim().toLowerCase())).slice(0,6) : []
  const featuredResearchCompanies = researchCompanyChoices.slice(0,4)
  const recentResearchCompanies = recentResearchTickers.map(ticker => researchCompanyChoices.find(company => tickerKey(company.ticker) === tickerKey(ticker))).filter((company): company is NonNullable<typeof company> => Boolean(company)).slice(0,4)
  const trackedCompanies = useMemo(() => {
    const tickers = trackedTickers ?? portfolio?.companies.map(company=>company.ticker) ?? []
    return allCompanies.filter(company=>tickers.includes(company.ticker))
  }, [allCompanies, trackedTickers, portfolio])
  useEffect(() => {
    if (trackedTickers === null || !trackedCompanies.length) { setDailyBriefing(null); return }
    let current = true
    setBriefingLoading(true)
    setDailyBriefing(null)
    setDailyBriefingError('')
    getDailyBriefing(trackedCompanies.slice(0, 20).map(company => company.ticker), briefingWindow)
      .then(result => { if (current) setDailyBriefing(result.briefing) })
      .catch(error => { if (current) { setDailyBriefing(null); setDailyBriefingError(error instanceof Error ? error.message : 'Saved briefing unavailable.') } })
      .finally(() => { if (current) setBriefingLoading(false) })
    return () => { current = false }
  }, [trackedTickers, trackedCompanies.map(company => company.ticker).join(','), briefingWindow])
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
      setResearchDatasetLoading({ financials: false, evidence: false, commitments: false })
      setResearchDatasetErrors({ financials: '', evidence: '', commitments: '' })
      return
    }
    const ticker = encodeURIComponent(selectedDocument.ticker)
    const controller = new AbortController()
    setResearchDatasetLoading({ financials: true, evidence: true, commitments: true })
    setResearchDatasetErrors({ financials: '', evidence: '', commitments: '' })
    const read = async (path: string) => {
      const response = await fetch(`${API}${path}`, { signal: controller.signal })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : `Research service returned ${response.status}.`)
      return payload
    }
    void read(`/api/research/financials?ticker=${ticker}&statement_basis=${statementBasis}&figure_type=${figureType}&adjustment_note=${encodeURIComponent(adjustmentNote)}`).then(payload => {
      if (!Array.isArray(payload.periods)) throw new Error('FINN returned an invalid financial comparison response.')
      setFinancialPeriods(payload.periods)
    }).catch(error => { if (!controller.signal.aborted) setResearchDatasetErrors(current => ({ ...current, financials: error instanceof Error ? error.message : 'Financial comparisons are unavailable.' })) }).finally(() => { if (!controller.signal.aborted) setResearchDatasetLoading(current => ({ ...current, financials: false })) })
    void read(`/api/research/evidence?ticker=${ticker}`).then(payload => {
      if (!Array.isArray(payload.records)) throw new Error('FINN returned an invalid financial evidence response.')
      setFinancialEvidence(payload.records)
    }).catch(error => { if (!controller.signal.aborted) setResearchDatasetErrors(current => ({ ...current, evidence: error instanceof Error ? error.message : 'The financial evidence ledger is unavailable.' })) }).finally(() => { if (!controller.signal.aborted) setResearchDatasetLoading(current => ({ ...current, evidence: false })) })
    void read(`/api/research/promises?ticker=${ticker}`).then(payload => {
      if (!Array.isArray(payload.promises)) throw new Error('FINN returned an invalid commitment response.')
      setPromiseRows(payload.promises)
      setPromiseTrackRecord(payload.track_record ?? null)
    }).catch(error => { if (!controller.signal.aborted) setResearchDatasetErrors(current => ({ ...current, commitments: error instanceof Error ? error.message : 'Management commitments are unavailable.' })) }).finally(() => { if (!controller.signal.aborted) setResearchDatasetLoading(current => ({ ...current, commitments: false })) })
    return () => controller.abort()
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

  function openCompanyResearch(ticker: string) {
    const source = documents.find(doc => tickerKey(doc.ticker) === tickerKey(ticker) && !doc.superseded_by)
    setDocumentId(source?.id ?? '')
    setResearchCompanyTicker(ticker)
    rememberResearchCompany(ticker)
    setResearchTab(source ? 'ask' : 'sources')
    navigate('Research', 'research')
  }

  function chooseResearchCompany(ticker: string) {
    const company = researchCompanyChoices.find(item => tickerKey(item.ticker) === tickerKey(ticker))
    if (!company) return
    const source = documents.find(doc => tickerKey(doc.ticker) === tickerKey(company.ticker) && !doc.superseded_by)
    setResearchCompanyTicker(company.ticker)
    rememberResearchCompany(company.ticker)
    setResearchCompanySearch('')
    setResearchCompanyPickerOpen(false)
    setDocumentId(source?.id ?? '')
    setResearchAllCompanySources(false)
    setHomeScopeCompanyTicker('')
    setResearchMessage('')
  }

  function rememberResearchCompany(ticker: string) {
    setRecentResearchTickers(current => {
      const next=[ticker,...current.filter(item=>tickerKey(item)!==tickerKey(ticker))].slice(0,6)
      try { localStorage.setItem('finn-recent-research-v1',JSON.stringify(next)) } catch { /* Recent selections are an optional browser convenience. */ }
      return next
    })
  }

  function selectResearchPath(tab: 'ask'|'financials'|'commitments'|'analysis'|'sources') {
    setResearchTab(tab)
    setResearchPathDialogOpen(true)
    navigate('Research','research')
  }

  function carryQuestionToResearch(question: string, ticker?: string) {
    const normalized=question.trim()
    if(normalized.length<5||homeQuestionHandoff||researchBusy||researchRequestLock.current)return
    setHomeAIQuestion(normalized)
    setHomeAICompanyTicker(ticker??'')
    setHomeQuestionHandoff({id:`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,question:normalized,ticker})
    navigate('Research','research')
  }

  function submitDiscoverySearch(event: any) {
    event.preventDefault()
    const query=discoverySearch.trim()
    if(query.length<2)return
    const company=discoveryCompanyMatches.find(item=>tickerKey(item.ticker)===tickerKey(query)||item.name.toLowerCase()===query.toLowerCase())
      ?? discoveryCompanyMatches.find(item=>item.name.toLowerCase().startsWith(query.toLowerCase())||item.ticker.toLowerCase().startsWith(query.toLowerCase()))
    if(company){chooseResearchCompany(company.ticker);setDiscoverySearch('');navigate('Research','research');return}
    if(query.length>=5){setDiscoverySearch('');carryQuestionToResearch(query)}
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
      const payload = await explainAnnouncementApi(item)
      setExplanations(previous => ({ ...previous, [item.id]: payload.explanation }))
      setExplanationModes(previous => ({ ...previous, [item.id]: payload.mode ?? (payload.ai_generated ? 'ai_grounded' : 'rule_based') }))
      setExplanationVerifications(previous => ({ ...previous, [item.id]: payload.verification }))
    } catch (error) {
      setExplanations(previous => ({ ...previous, [item.id]: error instanceof Error ? error.message : 'AI explanation unavailable.' }))
      setExplanationModes(previous => ({ ...previous, [item.id]: 'error' }))
    } finally { setExplaining('') }
  }

  async function explainMarketSignal(item: AlertHistoryItem) {
    setMarketExplaining(item.id)
    try {
      const payload = await explainMarketSignalApi(item.ticker)
      setMarketExplanations(previous => ({ ...previous, [item.id]: payload }))
    } catch (error) {
      setMarketExplanations(previous => ({ ...previous, [item.id]: { ticker: item.ticker, company: item.company, session_date: item.session_date ?? '', retrieved_at: '', triggered_conditions: [], facts: [], explanation: error instanceof Error ? error.message : 'Market explanation unavailable.', ai_generated: false, mode: 'error' } }))
    } finally { setMarketExplaining('') }
  }

  async function buildDailyBriefing() {
    setDailyBriefingBusy(true); setDailyBriefingError('')
    try { setDailyBriefing(await requestDailyBriefing(trackedCompanies.slice(0,20).map(company=>({ticker:company.ticker,company:company.name,sector:company.sector})),briefingWindow)) }
    catch(error) { setDailyBriefingError(error instanceof Error?error.message:'FINN could not build the daily briefing.') }
    finally { setDailyBriefingBusy(false) }
  }

  async function buildPortfolioIntelligence() {
    setPortfolioIntelligenceBusy(true); setPortfolioIntelligenceError('')
    try {
      if (!pricedHoldings.length || marketValue <= 0) throw new Error('Portfolio analysis needs at least one holding with a current price.')
      const asOfDate=latestSessionDate??new Date().toLocaleDateString('en-CA')
      let correlations: NonNullable<PortfolioIntelligenceInput['correlations']> = []
      try {
        const tickers=pricedHoldings.map(company=>company.ticker).slice(0,20)
        const response=await fetch(`${API}/api/portfolio/history?tickers=${encodeURIComponent(tickers.join(','))}&period=1y&basis=adjusted`)
        if(response.ok){const historyPayload=await response.json();correlations=calculateReturnCorrelations(historyPayload.histories??{},tickers).filter(pair=>Math.abs(pair.correlation)>=0.65).slice(0,5).map(pair=>({ticker_a:pair.ticker_a,ticker_b:pair.ticker_b,company_a:allCompanies.find(company=>company.ticker===pair.ticker_a)?.name??pair.ticker_a,company_b:allCompanies.find(company=>company.ticker===pair.ticker_b)?.name??pair.ticker_b,correlation:pair.correlation,observations:pair.observations,from_date:pair.from,to_date:pair.to}))}
      } catch { correlations=[] }
      setPortfolioIntelligence(await requestPortfolioIntelligence({
        as_of_date:asOfDate,priced_holding_count:pricedHoldings.length,total_holding_count:heldCompanies.length,
        metrics:{market_value:marketValue,daily_pnl:todayPnl,unrealized_pnl:unrealizedPnl,largest_sector:concentration.largestSector?.sector??null,largest_sector_pct:concentration.largestSector?.pct??null,top_three_sector_pct:concentration.sectorCount?concentration.topThreeSectors:null,stock_hhi:concentration.stockHhi,sector_count:concentration.sectorCount,volatility_pct:accountRisk.volatility,max_drawdown_pct:accountRisk.maxDrawdown,account_return_pct:accountReturn,benchmark_return_pct:accountBenchmarkReturn},
        holdings:pricedHoldings.map(company=>({ticker:company.ticker,company:company.name,sector:company.sector,weight_pct:marketValue?holdings[company.ticker].shares*(company.price??0)/marketValue*100:0,daily_change_pct:company.change_pct??null,session_date:company.session_date??null})),
        correlations,
      }))
    } catch(error) { setPortfolioIntelligenceError(error instanceof Error?error.message:'FINN could not analyze this portfolio snapshot.') }
    finally { setPortfolioIntelligenceBusy(false) }
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
      setDocumentActionMessage('')
      setDocumentUploadState({ filename: payload.filename, status: 'indexed', message: `Indexed · ${payload.pages} pages` })
    } catch (error) {
      setResearchMessage(error instanceof Error ? error.message : 'Could not upload the document.')
      setDocumentUploadState({ filename: file.name, status: 'failed', message: error instanceof Error ? error.message : 'Indexing failed' })
    } finally { setResearchBusy(false) }
  }

  async function deleteResearchDocument(doc: ResearchDocument) {
    try {
      const dependencies = await getResearchDocumentDependencies(doc.id)
      const warning = `Delete ${doc.filename} (version ${doc.version_number ?? 1})?\n\nThis source is used by ${dependencies.financial_figures ?? 0} financial figures and ${dependencies.guidance_records ?? 0} management guidance records. Linked entries and their citations will also be removed. Other document versions are kept.`
      if (!window.confirm(warning)) return
      setDocumentActionMessage('Removing the document and linked records…')
      const response = await fetch(`${API}/api/research/documents/${encodeURIComponent(doc.id)}`, { method: 'DELETE' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || 'Could not delete this document.')
      const loaded = await loadDocuments()
      if (doc.id === documentId) { setFinancialPeriods([]); setPromiseRows([]); setBullBear(null) }
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
      setDocumentActionMessage(`${payload.filename} indexed as version ${payload.version_number ?? 2}.`)
      setDocumentUploadState({ filename: payload.filename, status: 'indexed', message: `Indexed · version ${payload.version_number ?? 2}` })
    } catch (error) { setDocumentActionMessage(error instanceof Error ? error.message : 'Could not replace this document.'); setDocumentUploadState({ filename: file.name, status: 'failed', message: error instanceof Error ? error.message : 'Replacement failed' }) }
    finally { setReplaceTargetId('') }
  }

  async function runResearchQuestion(question: string, scope: ResearchQueryScope) {
    const normalizedQuestion = question.trim()
    if (normalizedQuestion.length < 5 || researchRequestLock.current) return
    researchRequestLock.current = true
    setResearchQuestion(normalizedQuestion)
    setResearchMessage('')
    setResearchBusy(true)
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    setQuickAskExchanges(current => [...current, { id, question: normalizedQuestion, pending: true }])
    requestAnimationFrame(() => document.getElementById('ai-conversation')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }))
    try {
      const response = await askResearchQuestion({ ...scope, question: normalizedQuestion })
      setQuickAskExchanges(current => current.map(exchange => exchange.id === id ? { ...exchange, response, pending: false } : exchange))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Research query failed. Please try again.'
      setQuickAskExchanges(current => current.map(exchange => exchange.id === id ? { ...exchange, pending: false, error: message } : exchange))
    } finally {
      researchRequestLock.current = false
      setResearchBusy(false)
    }
  }

  async function askResearch(event: any) {
    event.preventDefault()
    const selectedScopeId = homeScopeNeedsConfirmation ? homeScopeDocumentId : documentId
    if (!selectedScopeId) { setResearchMessage('Choose a source document before submitting this question.'); return }
    if (researchBusy || researchRequestLock.current) return
    const scopeDocument = documents.find(doc => doc.id === selectedScopeId)
    if (!scopeDocument) { setResearchMessage('Choose an available source document before submitting this question.'); return }
    const requestScope: ResearchQueryScope = researchAllCompanySources
      ? { ticker: scopeDocument.ticker }
      : { document_id: selectedScopeId }
    setResearchMessage('')
    setHomeScopeNeedsConfirmation(false)
    setResearchCompanyTicker(scopeDocument.ticker)
    setDocumentId(selectedScopeId)
    await runResearchQuestion(researchQuestion, requestScope)
  }

  function submitHomeQuestion(event: any) {
    event.preventDefault()
    carryQuestionToResearch(homeAIQuestion,homeAICompanyTicker||undefined)
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

  async function compareResearchCompanies() {
    const tickers=comparisonTickers.filter(Boolean)
    if(tickers.length!==2||tickers[0]===tickers[1]){setResearchComparisonError('Choose two different companies with saved, comparable financial figures.');return}
    setResearchComparisonBusy(true);setResearchComparisonError('')
    try{setResearchComparison(await compareResearchCompaniesApi({tickers,statement_basis:statementBasis,figure_type:figureType,adjustment_note:adjustmentNote}))}
    catch(error){setResearchComparisonError(error instanceof Error?error.message:'FINN could not compare these companies.')}
    finally{setResearchComparisonBusy(false)}
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

  return <div className={`app-shell ${hasOpenDialog?'modal-open':''}`}>
    <aside className="sidebar">
      <a className="brand" href="#/home" onClick={event=>{event.preventDefault();navigate('Home','home')}} aria-label="FINN home"><span className="brand-mark">f</span><span>finn<span className="brand-dot">.</span></span></a>
      <div className="workspace-label">CURRENT UNIVERSE</div>
      <div className="workspace"><div className="workspace-icon"><BriefcaseBusiness size={15}/></div><span><b>Investor desk</b><small>{portfolio?.companies.length ?? 20} NSE companies</small></span></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>{nav.map(({label,icon:Icon,target})=><button key={label} aria-current={active===label?'page':undefined} className={`nav-item ${active===label?'selected':''}`} onClick={()=>navigate(label,target)}><Icon size={18}/><span>{label}</span>{label==='Alerts'&&alertUnreadCount>0&&<b>{alertUnreadCount>99?'99+':String(alertUnreadCount).padStart(2,'0')}</b>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="source-note"><ShieldCheck size={17}/><span>Primary-source research<br/><small>Answers link back to evidence</small></span></div><div className="sidebar-footnote">FINN · INVESTOR INTELLIGENCE</div></div>
    </aside>
    <main className={`main ${active==='Home'?'home-page':''} ${active==='Alerts'?'alerts-page':''} ${active==='Research'?'research-page':''} ${active==='Portfolio'?'portfolio-page':''}`}>
      <header className="topbar"><div className="crumb">FINN <span>/</span> {active.toUpperCase()}</div><div className="top-actions"><span className={`market-status ${marketError?'status-error':latestSessionIsStale?'status-stale':'status-current'}`} role="status" aria-live="polite" aria-label={`${marketStatusLabel}${latestPortfolioUpdate?`; last successful update ${new Date(latestPortfolioUpdate).toLocaleString('en-IN')}`:''}`} title={`${portfolio?.source ?? 'Market data'}${latestPortfolioUpdate?` · last successful update ${new Date(latestPortfolioUpdate).toLocaleString('en-IN')}`:''}`}><i aria-hidden="true"/><span>{marketStatusLabel}</span></span><button className="icon-button" aria-label="Refresh market prices" onClick={()=>void loadPortfolio(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing?'spin':''}/></button><div className="avatar small">A</div></div></header>
      <div className="content" id="home">
      <div className="page-view" key={active}>
      {active==='Home'&&<>
        <div className="eyebrow"><span>FINN INVESTOR DESK</span><i/> DAILY BRIEFING</div>
        <section className="greeting"><div><h1>Daily intelligence</h1><p>What deserves your attention across tracked companies and priced holdings today?</p></div></section>
        <section className="home-briefing-card home-intelligence-primary" aria-labelledby="home-briefing-title">
          <div className="home-briefing-topline"><div><span className="eyebrow-mini">PUSH INTELLIGENCE · {dailyBriefing?.generated_at ? new Date(dailyBriefing.generated_at).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'}) : 'TRACKED COMPANY COVERAGE'}</span><h2 id="home-briefing-title">Daily intelligence briefing</h2><p>Material company developments, exchange filings and completed-session market signals.</p></div><button className="save-button" onClick={()=>void buildDailyBriefing()} disabled={dailyBriefingBusy||briefingLoading||!trackedCompanies.length}>{dailyBriefingBusy?<><RefreshCw size={14} className="spin"/> Reviewing sources…</>:<><RefreshCw size={14}/> {dailyBriefing?'Rebuild briefing':'Generate briefing'}</>}</button></div>
          <div className="briefing-controls"><label>Reporting window<select aria-label="Briefing reporting window" value={briefingWindow} onChange={event=>setBriefingWindow(Number(event.target.value))}><option value={24}>Last 24 hours</option><option value={48}>Last 48 hours</option><option value={168}>Last 7 days</option></select></label><span>{briefingLoading?'Checking for a saved briefing…':dailyBriefing?.generated_at?`Last generated ${new Date(dailyBriefing.generated_at).toLocaleString('en-IN')}`:'Saved briefing will load automatically when available'}</span></div>
          {dailyBriefingError&&<p className="error-banner" role="alert">{dailyBriefingError}</p>}
          {dailyBriefing ? <>
            <div className="briefing-stat-strip"><div><b>{dailyBriefing.coverage?.companies_covered??'—'}/{dailyBriefing.coverage?.companies_requested??trackedCompanies.length}</b><span>companies covered</span></div><div><b>{dailyBriefing.coverage?.announcements_reviewed??'—'}</b><span>announcements reviewed</span></div><div><b>{dailyBriefing.coverage?.material_developments??'—'}</b><span>material developments</span></div><div><b>{dailyBriefing.coverage?.market_signals??'—'}</b><span>market signals</span></div><div><b>{dailyBriefing.coverage?.latest_market_session??'Unavailable'}</b><span>latest completed session</span></div></div>
            <div className="briefing-provider-row" aria-label="Source coverage">{Object.entries(dailyBriefing.providers??{}).map(([key,provider])=><span key={key} className={`provider-chip provider-${provider.status}`}><i/>{provider.source??labelCategory(key)} · {labelCategory(provider.status)}{provider.errors?.length?` (${provider.errors.length} unavailable)`:''}</span>)}</div>
            {dailyBriefing.uncertainties?.map((item,index)=><p className="briefing-caveat" key={index}><ShieldCheck size={14}/>{item}</p>)}
            <div className="home-intelligence-split"><section className="priority-feed"><div className="section-heading compact-heading"><div><span className="eyebrow-mini">WHAT CHANGED</span><h3>Priority intelligence</h3></div></div><HomeBriefingVisual result={dailyBriefing} histories={priceHistory}/></section><aside className="briefing-side-rail"><section className="briefing-results-card"><span className="eyebrow-mini">PRIMARY-SOURCE FIGURES</span><h3>Quarterly results</h3><p>Latest saved Research figures for tracked companies. Values are page-checked entries, not automatically extracted.</p>{dailyBriefing.quarterly_results?.length?dailyBriefing.quarterly_results.slice(0,3).map(result=><article className="briefing-result" key={`${result.ticker}-${result.period}`}><div><b>{result.company}</b><span>{result.period} · {labelCategory(result.statement_basis)}</span></div><div className="result-metric-grid">{(['revenue','ebitda','pbt','pat'] as const).map(metric=>{const row=result.metrics[metric];return <div key={metric}><small>{metric.toUpperCase()}</small><b>{row?.value==null?'—':new Intl.NumberFormat('en-IN',{maximumFractionDigits:2}).format(row.value)} {row?.unit??''}</b><span>QoQ {row?.qoq?.status==='available'&&row.qoq.change_pct!=null?`${row.qoq.change_pct>0?'+':''}${row.qoq.change_pct.toFixed(1)}%`:row?.qoq?.status==='missing_data'?'Missing':'Unavailable'} · YoY {row?.yoy?.status==='available'&&row.yoy.change_pct!=null?`${row.yoy.change_pct>0?'+':''}${row.yoy.change_pct.toFixed(1)}%`:row?.yoy?.status==='missing_data'?'Missing':'Unavailable'}</span></div>})}</div>{Object.values(result.metrics).find(row=>row?.source)?.source&&<a href={(()=>{const source=Object.values(result.metrics).find(row=>row?.source)?.source;return source?.document_id?`${API}/api/research/documents/${encodeURIComponent(source.document_id)}/file#page=${source.page}`:source?.source_url??''})()} target="_blank" rel="noreferrer">Source page {Object.values(result.metrics).find(row=>row?.source)?.source?.page} · {Object.values(result.metrics).find(row=>row?.source)?.source?.filename}</a>}</article>):<div className="home-attention-empty">No page-checked quarterly figures are saved for these companies.</div>}</section>
              <section className="briefing-alert-summary"><span className="eyebrow-mini">ACTIVE MARKET SIGNALS</span><h3>Triggered alerts</h3>{portfolio?.alerts?.length?portfolio.alerts.slice(0,5).map(item=><div className="active-signal-row" key={item.ticker}><b>{item.name}</b><span>{item.ticker}</span><small>{item.unusual_price&&item.unusual_volume?'Price and volume':item.unusual_price?'Price movement':'Volume spike'} · {item.session_date??'session unavailable'}</small></div>):<p>No price or volume thresholds are currently triggered for available quotes.</p>}<button className="link-button" onClick={()=>navigate('Alerts','alerts')}>Manage alerts <ArrowRight size={14}/></button></section></aside></div>

          </> : !briefingLoading && <div className="briefing-empty-state"><div className="briefing-empty-mark"><FileSearch size={18}/></div><div><b>{trackedCompanies.length?'No saved briefing yet':'No companies are tracked yet'}</b><p>{trackedCompanies.length?'FINN checks for a previously generated report automatically. Generate a briefing to create the first source-backed review.':'Add companies to your watchlist before asking FINN to review company developments.'}</p></div>{!trackedCompanies.length&&<button className="link-button" onClick={()=>{setPortfolioTab('watchlist');navigate('Portfolio','portfolio')}}>Open watchlist <ArrowRight size={14}/></button>}</div>}
        </section>
        {marketError&&<div className="error-banner" role="alert"><span>{marketError}</span><button onClick={()=>void loadPortfolio(true)}>Retry <ArrowRight size={14}/></button></div>}
        <section className="home-ai-entry" aria-labelledby="home-ai-title">
          <div className="home-ai-heading"><span className="home-ai-mark"><Sparkles size={15}/></span><div><b id="home-ai-title">Ask FINN</b><p>Take a question into company research. It will only be submitted after you confirm its source scope.</p></div></div>
          <div className="home-ai-context"><label htmlFor="home-ai-company">Company context <span>optional</span></label><select id="home-ai-company" value={homeAICompanyTicker} onChange={event=>setHomeAICompanyTicker(event.target.value)}><option value="">Choose a company in Research</option>{researchCompanyChoices.map(company=><option key={company.ticker} value={company.ticker}>{company.name} · {company.ticker}</option>)}</select></div>
          <form onSubmit={submitHomeQuestion} className="home-ai-form"><label className="sr-only" htmlFor="home-ai-question">Ask FINN a research question</label><input id="home-ai-question" value={homeAIQuestion} onChange={event=>setHomeAIQuestion(event.target.value)} minLength={5} maxLength={500} required placeholder="Ask a question about an indexed company source…"/><button type="submit" disabled={researchBusy||Boolean(homeQuestionHandoff)||homeAIQuestion.trim().length<5}><span>{homeQuestionHandoff?'Opening Research…':'Continue to Research'}</span><ArrowRight size={15}/></button></form>
          <small>Questions are not submitted on Home. Research will show the selected company (if any) and ask you to confirm a document or company-wide indexed-source scope. This session transcript is not saved.</small>
        </section>
        {heldCompanies.length>0&&<section className="stats-grid portfolio-snapshot" aria-label="Portfolio snapshot">
          <article className="stat-card portfolio-stat"><div className="stat-heading">Market value <span className="subtle">{pricedHoldings.length}/{heldCompanies.length} PRICED</span></div><div className="stat-value">{pricedHoldings.length?money(marketValue):'—'}</div><div className="stat-foot"><span>Latest available market prices</span></div></article>
          <article className="stat-card"><div className="stat-heading">Invested cost</div><div className="stat-value">{pricedHoldings.length?money(pricedInvestedCapital):'—'}</div><div className="stat-foot"><span>Same priced positions</span></div></article>
          <article className="stat-card daily-pnl-stat"><div className="stat-heading">Daily P&amp;L</div><div className={`stat-value ${dailyPricedHoldings.length?(todayPnl<0?'loss-value':todayPnl>0?'gain-value':''):''}`}>{dailyPricedHoldings.length?signedMoney(todayPnl):'—'}</div><div className="stat-foot"><span>{dailyPricedHoldings.length}/{heldCompanies.length} holdings with both closes</span></div></article>
          <article className="stat-card"><div className="stat-heading">Unrealized P&amp;L</div><div className={`stat-value ${pricedHoldings.length?(unrealizedPnl<0?'loss-value':unrealizedPnl>0?'gain-value':''):''}`}>{pricedHoldings.length?signedMoney(unrealizedPnl):'—'}</div><div className="stat-foot"><span>Market value minus cost basis</span></div></article>
        </section>}
        {!loading&&!marketError&&heldCompanies.length===0&&<section className="home-empty-state"><span className="eyebrow-mini">NO OPEN POSITIONS</span><h2>Add holdings for a personalized portfolio briefing</h2><p>FINN will show market value, daily change, cost basis, and portfolio history when you record a holding.</p><button className="save-button" onClick={()=>{setPortfolioTab('watchlist');navigate('Portfolio','portfolio')}}>Choose a company <ArrowRight size={14}/></button></section>}
        <section className="performance-section" aria-labelledby="performance-title">
          <div className="performance-heading"><div><span className="eyebrow-mini">HISTORICAL VALUE · CURRENT HOLDINGS</span><h2 id="performance-title">Historical value of current holdings</h2><p>This is a price-history illustration using today’s share quantities, not transaction-based account performance.</p></div><div className="performance-ranges" role="group" aria-label="Performance period">{(['1D','1W','1M','3M','1Y'] as PerformanceRange[]).map(range=><button key={range} className={performanceRange===range?'active':''} aria-pressed={performanceRange===range} onClick={()=>setPerformanceRange(range)}>{range}</button>)}</div></div>
          <div className="performance-main performance-chart-only">
            <div className="performance-chart-card">
              <div className="chart-summary"><div><small>Estimated value at period end</small><strong>{performance.chartCurrent===null? '—' : money(performance.chartCurrent)}</strong></div><span className={`range-return ${performance.changePct===null?'':performance.changePct<0?'negative':'positive'}`}>{performance.changePct===null?'—':`${performance.changePct>0?'+':''}${performance.changePct.toFixed(2)}%`}<small>price change proxy · {performanceRange}</small></span></div>
              {historyLoading?<div className="performance-empty">Loading historical prices…</div>:performance.values.length>1?<><svg className="performance-chart" viewBox="0 0 760 210" role="img" aria-label={`${performanceRange} portfolio value chart, ${performance.included} of ${performance.total} positions with enough history`} preserveAspectRatio="none"><defs><linearGradient id="performance-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".24"/><stop offset="100%" stopColor="var(--accent)" stopOpacity="0"/></linearGradient></defs><path d="M 12 62 H 748 M 12 124 H 748 M 12 186 H 748" className="chart-gridline"/><path d={chartGeometry.area} fill="url(#performance-fill)"/><path d={chartGeometry.line} className="chart-line"/><circle cx="748" cy={chartGeometry.lastY} r="4" className="chart-last-dot"/></svg><div className="chart-dates"><span>{new Date(chartGeometry.firstDate+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</span><span>{new Date(chartGeometry.lastDate+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</span></div></>:<div className="performance-empty compact-empty"><b>{heldCompanies.length?'No verified history for this range':'Portfolio history appears here after you add holdings'}</b>{heldCompanies.length>0&&<span>{performance.included} of {performance.total} holdings have enough historical prices for {performanceRange}.</span>}{heldCompanies.length>0&&<button onClick={()=>setHistoryCoverageOpen(true)} disabled={historyLoading}>Inspect price coverage <ArrowRight size={13}/></button>}</div>}
              <p className="chart-footnote">Method: historical adjusted closes are scaled to latest unadjusted prices, then multiplied by today’s share quantities. It excludes actual trade dates, changes in share count, deposits, withdrawals, fees and cash flows. The percentage is a share-price proxy, not your realized or account return. {performance.included} of {performance.total} current positions included{performance.total>performance.included?' for this range':''}.</p>
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
        <section className="greeting page-greeting"><div><h1>Intelligence feed</h1><p>Company filings and completed-session market signals, prioritized with their source and trigger context.</p></div></section>
        <section className="alert-overview" aria-label="Alert summary">
          <article><small>TOTAL ALERTS</small><b>{String(alertSummary?.total??alertHistory.length).padStart(2,'0')}</b><span>{announcementWindow===24?'Last 24 hours':announcementWindow===168?'Last 7 days':'Last 30 days'} · {alertSummary?.unread??alertHistory.filter(item=>!item.is_read).length} unread</span></article>
          <article><small>HIGH PRIORITY</small><b>{String(alertSummary?.high_priority??alertHistory.filter(item=>item.priority==='high').length).padStart(2,'0')}</b><span>In the selected period</span></article>
          <article><small>PRICE MOVES</small><b>{String(alertSummary?.price_movements??alertHistory.filter(item=>item.signal_type==='price_movement').length).padStart(2,'0')}</b><span>Threshold-based daily moves</span></article>
          <article><small>VOLUME SPIKES</small><b>{String(alertSummary?.volume_spikes??alertHistory.filter(item=>item.signal_type==='volume_spike').length).padStart(2,'0')}</b><span>Against prior 20 sessions</span></article>
        </section>
        <section className="alert-analytics" aria-label="Alert activity analytics">
          <article className="alert-chart-card"><div className="alert-chart-heading"><div><span className="eyebrow-mini">RECORDED EVENTS · IST</span><h2>Seven-day trend</h2></div><span>Daily count</span></div>
            {alertSummary?.trend_7d_ist?.length?<div className="alert-trend-chart" role="img" aria-label={`Seven-day alert trend: ${alertSummary.trend_7d_ist.map(day=>`${day.date}, ${day.count} alerts`).join('; ')}`}>
              {alertSummary.trend_7d_ist.map(day=>{const peak=Math.max(1,...alertSummary.trend_7d_ist.map(row=>row.count));return <div className="alert-trend-column" key={day.date}><b>{day.count||''}</b><span className="alert-trend-bar" style={{height:`${Math.max(day.count?8:2,day.count/peak*100)}%`}}/><small>{new Date(`${day.date}T12:00:00+05:30`).toLocaleDateString('en-IN',{day:'numeric',month:'short',timeZone:'Asia/Kolkata'})}</small></div>})}
            </div>:<div className="alert-chart-empty">Trend data is unavailable until alert history loads.</div>}
          </article>
          <article className="alert-chart-card"><div className="alert-chart-heading"><div><span className="eyebrow-mini">SELECTED PERIOD</span><h2>Alerts by type</h2></div><span>{alertSummary?.total??alertHistory.length} total</span></div>
            <div className="alert-category-chart">{([['filings','Corporate filings','filings'],['price_movements','Price movements','price'],['volume_spikes','Volume spikes','volume']] as const).map(([key,label,kind])=>{const count=key==='filings'?(alertSummary?.filings??0):key==='price_movements'?(alertSummary?.price_movements??0):(alertSummary?.volume_spikes??0);const total=alertSummary?.total??alertHistory.length;return <div className={`alert-category-row ${kind}`} key={key}><div><span>{label}</span><b>{count} <small>{total?`${Math.round(count/total*100)}%`:''}</small></b></div><i><span style={{width:`${total?count/total*100:0}%`}}/></i></div>})}</div>
          </article>
        </section>
        <section className="alerts-section unified-alerts anchor-section" id="alerts">
          <div className="section-heading"><div><h2>Alert feed</h2><p className="alert-feed-freshness"><span><small>Source</small><b>{portfolio?.source??'Market data'}</b></span><span><small>Latest completed session</small><b>{portfolio?.companies.find(company=>company.session_date)?.session_date??'Unavailable'}</b></span><span><small>Last successful market update</small><b>{portfolio?.last_successful_update?new Date(portfolio.last_successful_update).toLocaleString('en-IN'):'Unavailable'}</b></span><span><small>NSE filings updated</small><b>{announcementUpdatedAt?new Date(announcementUpdatedAt).toLocaleString('en-IN'):'Unavailable'}</b></span></p></div><div className="section-tools"><select aria-label="Alert history period" value={announcementWindow} onChange={event=>{const hours=Number(event.target.value);setAnnouncementWindow(hours);void loadAnnouncements(hours);void loadAlertHistory(hours)}}><option value={24}>Last 24 hours</option><option value={168}>Last 7 days</option><option value={720}>Last 30 days</option></select><button className="link-button" onClick={()=>{void loadPortfolio(true);void loadAnnouncements(announcementWindow);void loadAlertHistory(announcementWindow)}}>Refresh <RefreshCw size={13}/></button></div></div>
          <details className="alert-settings-disclosure"><summary>Configure alert thresholds <span>Volume and daily price move · OR trigger</span></summary><form className="threshold-panel alert-threshold-form" onSubmit={updateSettings}>
            <div className="alert-settings-header"><div><h3>Alert trigger settings</h3><p>Either threshold can trigger an alert.</p></div><span className="alert-trigger-badge">OR trigger</span></div>
            <div className="alert-threshold-fields">
              <label>Volume spike multiple<span className="threshold-input-wrap"><input type="number" inputMode="decimal" min="1.1" max="10" step="0.1" value={settings.volume_multiple} onChange={event=>{setSettings({...settings,volume_multiple:Number(event.target.value)});setSettingsMessage('')}}/><span aria-hidden="true">×</span></span><small>Compared with the previous 20 sessions</small></label>
              <label>Daily price movement<span className="threshold-input-wrap"><input type="number" inputMode="decimal" min="0.5" max="25" step="0.5" value={settings.price_move_pct} onChange={event=>{setSettings({...settings,price_move_pct:Number(event.target.value)});setSettingsMessage('')}}/><span aria-hidden="true">%</span></span><small>Either direction · previous close</small></label>
            </div>
            <div className="alert-threshold-actions"><span role="status" aria-live="polite" className={settingsMessage.startsWith('Could not')?'settings-error':settingsMessage.startsWith('Thresholds saved')?'settings-success':''}>{settingsMessage}</span><button type="submit" disabled={settingsMessage==='Saving…'||settingsMessage==='Saved. Refreshing alerts…'}>{settingsMessage==='Saving…'||settingsMessage==='Saved. Refreshing alerts…'?'Saving…':'Save'}</button></div>
          </form></details>
          <div className="page-tabs alert-filter-tabs" role="tablist" aria-label="Alert categories">
            <button role="tab" aria-selected={alertsTab==='all'} className={alertsTab==='all'?'active':''} onClick={()=>{setAlertsTab('all');setFilingFilter('all')}}><Activity size={15}/> All alerts <span>{alertHistory.length}</span></button>
            <button role="tab" aria-selected={alertsTab==='filings'} className={alertsTab==='filings'?'active':''} onClick={()=>{setAlertsTab('filings');setFilingFilter('all')}}><FileText size={15}/> Company filings</button>
            <button role="tab" aria-selected={alertsTab==='price'} className={alertsTab==='price'?'active':''} onClick={()=>{setAlertsTab('price');setFilingFilter('all')}}><TrendingUp size={15}/> Price movements</button>
            <button role="tab" aria-selected={alertsTab==='volume'} className={alertsTab==='volume'?'active':''} onClick={()=>{setAlertsTab('volume');setFilingFilter('all')}}><BarChart3 size={15}/> Volume spikes</button>
          </div>
          <div className="alert-feed-tools">{alertsTab==='filings'&&<div className="filing-category-filters" aria-label="Filing type filters">{([['all','All filings'],['results','Financial results'],['corporate','Corporate announcements'],['shareholding','Shareholding changes'],['dividend','Dividends'],['board','Board meetings'],['mergers','Mergers & acquisitions']] as [FilingFilter,string][]).map(([filter,label])=><button key={filter} className={filingFilter===filter?'active':''} aria-pressed={filingFilter===filter} onClick={()=>setFilingFilter(filter)}>{label}</button>)}</div>}<label className="unread-filter"><input type="checkbox" checked={unreadOnly} onChange={event=>setUnreadOnly(event.target.checked)}/> Unread only <span>{alertHistory.filter(item=>!item.is_read).length}</span></label></div>
          {announcementError&&<div className="state-card alert-feed-notice"><span>{announcementError} Previously saved alerts remain available below.</span><button onClick={()=>{void loadAnnouncements(announcementWindow);void loadAlertHistory(announcementWindow)}}>Retry filings</button></div>}
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
                {isFiling&&explanations[item.id]&&<div className="unified-alert-relevance" role="status"><b>{explanationModes[item.id]==='ai_grounded'?'FINN interpretation':'Filing context'}</b><p>{explanations[item.id]}</p>{explanationVerifications[item.id]?.failures?.length&&<div className="citation-diagnostics" role="alert"><b>Source checks need review</b><ul>{explanationVerifications[item.id]?.failures?.map((failure,index)=><li key={`${failure.type}-${index}`}><strong>{failure.type.replaceAll('_',' ')}</strong><p>{failure.reason}</p></li>)}</ul><small>{explanationVerifications[item.id]?.note}</small></div>}</div>}
                {!isFiling&&marketExplanations[item.id]&&<div className="unified-alert-relevance" role="status"><b>{marketExplanations[item.id].ai_generated?'FINN interpretation':'Deterministic signal explanation'}</b><p>{marketExplanations[item.id].explanation}</p>{marketExplanations[item.id].session_date&&<small>Session {marketExplanations[item.id].session_date} · {marketExplanations[item.id].source_name??'Yahoo Finance via yfinance'} · retrieved {marketExplanations[item.id].retrieved_at?new Date(marketExplanations[item.id].retrieved_at).toLocaleString('en-IN'):'time unavailable'}</small>}</div>}
                {item.is_verified_example&&<span className="verified-filing">Verified filing · demonstration example</span>}
                <div className="unified-alert-actions"><a href={item.source_url} target="_blank" rel="noreferrer"><FileText size={14}/>{isFiling?'Open original NSE filing':'Open Yahoo Finance source'} ↗</a>{isFiling&&<button onClick={()=>void explainAnnouncement(filing)} disabled={explaining===item.id}><Sparkles size={14}/>{explaining===item.id?'Thinking…':'Why it may matter'}</button>}{!isFiling&&<button onClick={()=>void explainMarketSignal(item)} disabled={marketExplaining===item.id}><Sparkles size={14}/>{marketExplaining===item.id?'Checking session…':marketExplanations[item.id]?'Refresh explanation':'Explain signal'}</button>}<button onClick={()=>openCompanyResearch(item.ticker)}><Search size={14}/> Research company</button><button onClick={()=>void setAlertRead(item,!item.is_read)}>{item.is_read?'Mark unread':'Mark read'}</button></div>
              </div>
            </article>
          })}</div>:<div className="state-card alert-empty-state"><b>{unreadOnly?'No unread alerts in this filter.':alertsTab==='filings'?'No company filings in the selected period and filing category.':alertsTab==='price'?'No price movement alerts in the selected period.':alertsTab==='volume'?'No volume spike alerts in the selected period.':'No alerts in the selected period.'}</b><p>{alertsTab==='filings'?announcementError?'The NSE filing feed is unavailable; prior saved filings remain searchable when available.':`NSE returned no tracked-company filings in the last ${announcementWindow===24?'24 hours':announcementWindow===168?'7 days':'30 days'}. This does not mean there were no market signals.`:'FINN only records signals when a configured threshold is crossed using completed trading-session data. Missing values do not create alerts.'}</p>{unreadOnly&&<button className="link-button" onClick={()=>setUnreadOnly(false)}>Show all alerts</button>}</div>}
        </section>
      </>}

      {active==='Research'&&!currentResearchCompany&&<>
        {researchPathDialogOpen&&<div className="research-path-dialog-backdrop" onKeyDown={event=>{if(event.key==='Escape')setResearchPathDialogOpen(false)}} onMouseDown={event=>{if(event.target===event.currentTarget)setResearchPathDialogOpen(false)}}><section className="research-path-dialog" role="dialog" aria-modal="true" aria-labelledby="research-path-dialog-title"><header><div><span className="eyebrow-mini">{researchTab==='ask'?'ASK FINN':researchTab==='financials'?'FINANCIALS':researchTab==='commitments'?'COMMITMENTS':researchTab==='analysis'?'BULL / BEAR':'SOURCES'}</span><h2 id="research-path-dialog-title">Choose a company to research</h2><p>Company coverage comes from FINN’s portfolio API and indexed document library. Sections show available records and identify missing sources.</p></div><button type="button" aria-label="Close company selector" onClick={()=>setResearchPathDialogOpen(false)}>×</button></header><label className="research-path-dialog-search"><Search size={16}/><input autoFocus value={researchCompanySearch} onChange={event=>setResearchCompanySearch(event.target.value)} placeholder="Search company or ticker"/></label><div className="research-path-company-list">{researchPathCompanyMatches.map(company=>{const sourceDocs=documents.filter(doc=>tickerKey(doc.ticker)===tickerKey(company.ticker)&&!doc.superseded_by);const tracked=portfolio?.companies.some(item=>tickerKey(item.ticker)===tickerKey(company.ticker))??false;return <button type="button" key={company.ticker} onClick={()=>{chooseResearchCompany(company.ticker);setResearchPathDialogOpen(false);setResearchCompanySearch('')}}><span className="research-path-company-copy"><b>{company.name}</b><small>{company.ticker}{company.sector?` · ${company.sector}`:''}</small></span><span className="research-path-company-coverage">{tracked&&<small>Portfolio</small>}<small>{sourceDocs.length?`${sourceDocs.length} indexed source${sourceDocs.length===1?'':'s'}`:'No indexed sources'}</small></span><ArrowRight size={15}/></button>})}{!researchPathCompanies.length&&!marketError&&!researchDocumentsError&&(!portfolio||!researchDocumentsLoaded)&&<div className="state-card">Company coverage is still loading from FINN.</div>}{!researchPathCompanies.length&&(marketError||researchDocumentsError)&&<div className="state-card error-state">Company data is unavailable. Retry FINN’s Portfolio or Research service.</div>}{!researchPathCompanies.length&&portfolio&&researchDocumentsLoaded&&!marketError&&!researchDocumentsError&&<div className="state-card">FINN returned no portfolio companies or indexed-source issuers. Use Sources to search for a verified issuer.</div>}{researchPathCompanies.length&&researchCompanySearch.trim()&&!researchPathCompanyMatches.length&&<div className="state-card">No matching company in FINN’s portfolio or indexed source library. Use Sources to search the issuer registry.</div>}</div></section></div>}
        <section className="research-discovery-hero" aria-labelledby="research-discovery-title">
          <span className="discovery-kicker"><Search size={14}/> FINN RESEARCH</span><h1 id="research-discovery-title">Company research,<br/><em>grounded in evidence.</em></h1><p>Choose a company to investigate its results, management guidance, risks and primary-source documents.</p>
          <div className="research-landing-search-wrap"><label className="sr-only" htmlFor="research-landing-search">Search a company name or ticker</label><div className="research-landing-search"><Search size={19}/><input id="research-landing-search" role="combobox" aria-expanded={researchCompanyPickerOpen&&researchCompanySearch.trim().length>0} aria-controls="research-landing-results" aria-autocomplete="list" value={researchCompanySearch} onFocus={()=>setResearchCompanyPickerOpen(true)} onChange={event=>{setResearchCompanySearch(event.target.value);setResearchCompanyPickerOpen(true)}} onKeyDown={event=>{if(event.key==='Escape')setResearchCompanyPickerOpen(false);if(event.key==='Enter'&&researchCompanyMatches[0]){event.preventDefault();chooseResearchCompany(researchCompanyMatches[0].ticker)}}} placeholder="Search a registered company or NSE ticker…"/>{researchCompanySearch&&<button type="button" aria-label="Clear company search" onClick={()=>{setResearchCompanySearch('');setResearchCompanyPickerOpen(false)}}>×</button>}</div>
            {researchCompanyPickerOpen&&researchCompanySearch.trim()&&<div className="research-company-results research-landing-results" id="research-landing-results" role="listbox">{researchCompanyMatches.length?researchCompanyMatches.map(company=><button type="button" role="option" aria-selected="false" key={company.ticker} onClick={()=>chooseResearchCompany(company.ticker)}><span><b>{company.name}</b><small>{company.ticker}{company.sector?` · ${company.sector}`:''}</small></span>{documents.some(doc=>tickerKey(doc.ticker)===tickerKey(company.ticker)&&!doc.superseded_by)&&<small>Primary sources indexed</small>}</button>):<div className="research-no-company-match">No matching company in the current portfolio or source library. You can add a company in Portfolio or open Sources to search the issuer registry.</div>}</div>}
          </div>
          <div className="research-landing-coverage"><span>{portfolio?`${portfolio.companies.length} tracked portfolio companies`:marketError?'Portfolio company coverage unavailable':'Loading portfolio companies…'}</span><span>{researchDocumentsError?'Source coverage unavailable':researchDocumentsLoaded?`${documents.filter(doc=>!doc.superseded_by).length} indexed primary-source documents`:'Loading source coverage…'}</span></div>
        </section>
        {homeScopeNeedsConfirmation&&<aside className="research-question-handoff" role="status"><b>Your question is ready for source-scoped research</b><blockquote>{researchQuestion}</blockquote><span>Choose a company to review its available primary sources. FINN will wait for you to confirm a source before submitting the question.</span></aside>}
        <section className="discovery-section research-path-section"><div className="discovery-section-heading"><div><span className="eyebrow-mini">CHOOSE A RESEARCH PATH</span><h2>What would you like to understand?</h2></div></div>
          <div className="research-landing-paths">
            {([['ask',Sparkles,'Ask FINN','Find answers in indexed annual reports, results and transcripts.'],['financials',BarChart3,'Financials','Compare revenue, EBITDA, PBT and PAT by reported period.'],['commitments',Target,'Commitments','Track management guidance against reported results.'],['analysis',TrendingUp,'Bull / Bear','Review both cases with supporting source evidence.'],['sources',FileSearch,'Sources','Discover, select and manage primary-source documents.']] as const).map(([tab,Icon,title,description])=><button key={tab} className={researchPathDialogOpen&&researchTab===tab?'selected':''} aria-pressed={researchPathDialogOpen&&researchTab===tab} onClick={()=>selectResearchPath(tab)}><Icon size={21}/><span><b>{title}</b><small>{description}</small></span><ArrowRight size={16}/></button>)}
          </div>
        </section>
        <section className="discovery-section"><div className="discovery-section-heading"><div><span className="eyebrow-mini">COMPANY UNIVERSE</span><h2>Featured companies</h2></div><button className="link-button" onClick={()=>{setPortfolioTab('watchlist');navigate('Portfolio','portfolio')}}>Browse watchlist <ArrowRight size={14}/></button></div>
          {featuredResearchCompanies.length?<div className="featured-company-grid">{featuredResearchCompanies.map(company=><button key={company.ticker} onClick={()=>chooseResearchCompany(company.ticker)}><span className="company-monogram">{company.name.split(/\s+/).map(word=>word[0]).join('').slice(0,2).toUpperCase()}</span><span><b>{company.name}</b><small>{company.ticker}{company.sector?` · ${company.sector}`:''}</small><small>{documents.some(doc=>tickerKey(doc.ticker)===tickerKey(company.ticker)&&!doc.superseded_by)?'Indexed primary sources available':'No indexed primary source yet'}</small></span><ArrowRight size={15}/></button>)}</div>:<div className="discovery-empty">Featured companies will appear when the portfolio universe loads.</div>}
        </section>
        <section className="discovery-section"><div className="discovery-section-heading"><div><span className="eyebrow-mini">YOUR WORKSPACE</span><h2>Recently opened</h2></div><span className="discovery-subnote">Stored in this browser</span></div>{recentResearchCompanies.length?<div className="recent-company-list">{recentResearchCompanies.map(company=><button key={company.ticker} onClick={()=>chooseResearchCompany(company.ticker)}><span>{company.name}<small>{company.ticker}</small></span><ArrowRight size={14}/></button>)}</div>:<div className="discovery-empty">Your recent company selections will appear here after you open a company.</div>}</section>
      </>}

      {active==='Research'&&currentResearchCompany&&<>
        <div className="eyebrow"><span>PULL RESEARCH</span><i/> EVIDENCE WITH SOURCES</div>
        <section className="greeting page-greeting"><div><h1>{currentResearchCompany.name}</h1><p>{currentResearchCompany.ticker} · Investigate reported performance, management commentary and risks with source-backed evidence.</p></div></section>
        <section className="research-focus-card research-workspace-context" aria-label="Selected company context">
          <div className="research-company-search"><label htmlFor="research-company-search">Switch company</label><div className="research-search-control"><Search size={16}/><input id="research-company-search" role="combobox" aria-expanded={researchCompanyPickerOpen&&researchCompanySearch.trim().length>0} aria-controls="research-company-results" aria-autocomplete="list" value={researchCompanySearch} onFocus={()=>setResearchCompanyPickerOpen(true)} onChange={event=>{setResearchCompanySearch(event.target.value);setResearchCompanyPickerOpen(true)}} onKeyDown={event=>{if(event.key==='Escape')setResearchCompanyPickerOpen(false);if(event.key==='Enter'&&researchCompanyMatches[0]){event.preventDefault();chooseResearchCompany(researchCompanyMatches[0].ticker)}}} placeholder="Search company name or ticker"/>{researchCompanySearch&&<button type="button" aria-label="Clear company search" onClick={()=>{setResearchCompanySearch('');setResearchCompanyPickerOpen(false)}}>×</button>}</div>{researchCompanyPickerOpen&&researchCompanySearch.trim()&&<div className="research-company-results" id="research-company-results" role="listbox">{researchCompanyMatches.length?researchCompanyMatches.map(company=><button type="button" role="option" aria-selected={tickerKey(company.ticker)===tickerKey(currentResearchTicker)} key={company.ticker} onClick={()=>chooseResearchCompany(company.ticker)}><span><b>{company.name}</b><small>{company.ticker}{company.sector?` · ${company.sector}`:''}</small></span>{documents.some(doc=>tickerKey(doc.ticker)===tickerKey(company.ticker)&&!doc.superseded_by)&&<small>Sources indexed</small>}</button>):<div className="research-no-company-match">No matching company in the current portfolio and source library. For an outside company, search the issuer registry in Sources.</div>}</div>}</div>
          <div className="research-coverage-summary"><b>{currentResearchDocuments.length}</b><span>indexed sources</span><small>{currentResearchDocuments.length?Array.from(new Set(currentResearchDocuments.map(doc=>doc.document_type))).map(labelCategory).join(' · '):'No primary-source documents indexed for this company'}</small><button type="button" className="link-button" onClick={()=>setResearchTab('sources')}>{currentResearchDocuments.length?'Manage sources':'Find sources'} <ArrowRight size={13}/></button></div>
        </section>
        <div className="page-tabs research-tool-tabs" role="tablist" aria-label="Research workspace">
          <button role="tab" title="Ask FINN" aria-selected={researchTab==='ask'} className={researchTab==='ask'?'active':''} onClick={()=>selectSubview(setResearchTab,'ask')}><Sparkles size={15}/><span>Ask</span></button>
          <button role="tab" title="Financials" aria-selected={researchTab==='financials'} className={researchTab==='financials'?'active':''} onClick={()=>selectSubview(setResearchTab,'financials')}><BarChart3 size={15}/><span>Financials</span></button>
          <button role="tab" title="Commitments" aria-selected={researchTab==='commitments'} className={researchTab==='commitments'?'active':''} onClick={()=>selectSubview(setResearchTab,'commitments')}><Target size={15}/><span>Commitments</span></button>
          <button role="tab" title="Bull vs Bear" aria-selected={researchTab==='analysis'} className={researchTab==='analysis'?'active':''} onClick={()=>selectSubview(setResearchTab,'analysis')}><TrendingUp size={15}/><span>Bull / Bear</span></button>
          <button role="tab" title="Sources" aria-selected={researchTab==='sources'} className={researchTab==='sources'?'active':''} onClick={()=>selectSubview(setResearchTab,'sources')}><FileSearch size={15}/><span>Sources</span></button>
        </div>
        <section className="research-source-panel" hidden={researchTab!=='sources'}>
          <div className="research-source-panel-heading"><div><span className="eyebrow-mini">RESEARCH EVIDENCE</span><h2>Find and manage primary sources</h2><p>Search official public sources, explicitly import a verified PDF, or manage documents already in your library.</p></div><span className="coverage-count">{documents.filter(doc=>!doc.superseded_by).length} indexed</span></div>
          <SourceDiscovery initialCompany={currentResearchCompany?.name??currentResearchTicker} onIndexed={documentId=>{setDocumentId(documentId);setHomeScopeDocumentId(documentId);setHomeScopeCompanyTicker(currentResearchTicker);setResearchTab('ask');void loadDocuments(documentId)}}/>
          <details className="manage-documents-disclosure" id="research-document-management" open>
            <summary>Manual upload and document library <span>{documents.length} documents</span></summary>
            <div className="manage-documents-content"><p>Use manual upload when discovery has no direct attachment or the official source is unavailable.</p><form className="upload-panel" onSubmit={uploadResearch}><label>Company<input name="company" required placeholder="e.g. Reliance Industries"/></label><label>NSE ticker<input name="ticker" required placeholder="e.g. RELIANCE.NS"/></label><label>Source type<select name="document_type" required><option>Annual report</option><option>Quarterly results</option><option>Earnings-call transcript</option><option>Investor presentation</option></select></label><label>Reporting period<input name="reporting_period" required placeholder="e.g. FY2026 or Q2 FY2027"/></label><label>Official source URL (optional)<input name="source_url" type="url" placeholder="https://www.nseindia.com/..."/></label><label className="file-picker"><Upload size={16}/>{researchFilename||'Choose PDF'}<input type="file" name="file" accept="application/pdf,.pdf" required onChange={event=>setResearchFilename(event.target.files?.[0]?.name ?? '')}/></label><button type="submit" disabled={researchBusy}>Index primary source</button></form>{documentUploadState&&<p className={`indexing-message ${documentUploadState.status}`} role="status"><b>{documentUploadState.status}</b> · {documentUploadState.filename} · {documentUploadState.message}</p>}<small className="upload-hint">Text-searchable PDFs only · maximum 45 MB. Tracked-company names and tickers are checked as a pair. Scanned image PDFs need OCR before upload.</small>
              <div className="document-library"><div className="section-heading"><div><h3>Document library</h3><p>{documents.length} primary sources · search, cite, and manage their index.</p></div></div><div className="document-library-tools"><label className="search-field"><Search size={15}/><input value={documentSearch} onChange={event=>setDocumentSearch(event.target.value)} placeholder="Search company, ticker, period, or filename"/></label><select aria-label="Filter document type" value={documentTypeFilter} onChange={event=>setDocumentTypeFilter(event.target.value)}><option value="all">All source types</option>{Array.from(new Set(documents.map(doc=>doc.document_type))).sort().map(type=><option key={type}>{type}</option>)}</select></div><input ref={replaceInput} hidden type="file" accept="application/pdf,.pdf" onChange={replaceResearchDocument}/>{documentActionMessage&&<p className="workflow-message">{documentActionMessage}</p>}
                {visibleDocuments.length?<div className="document-list">{visibleDocuments.map(doc=><article className={`document-library-row ${doc.superseded_by?'superseded-document':''}`} key={doc.id}><FileText size={16}/><div className="document-library-copy"><b>{doc.company} · {doc.ticker} {doc.superseded_by&&<em>Previous version</em>}</b><span className="document-library-filename" title={doc.filename}>{doc.filename}</span><span className="document-library-details">{doc.document_type} · {doc.reporting_period} · {doc.pages} pages</span><small>Version {doc.version_number??1} · <strong className={`index-status ${doc.indexing_status??'indexed'}`}>{doc.indexing_status??'indexed'}</strong>{doc.index_error&&` · ${doc.index_error}`}{doc.source_url&&<> · <a href={doc.source_url} target="_blank" rel="noreferrer">Original source ↗</a></>} <a href={`${API}/api/research/documents/${encodeURIComponent(doc.id)}/file#page=1`} target="_blank" rel="noreferrer">Open PDF ↗</a></small></div><div className="document-library-actions"><button className="document-select-action" onClick={()=>{setDocumentId(doc.id);setResearchTab('ask')}}>Ask FINN</button><details className="document-actions-menu"><summary aria-label={`More actions for ${doc.company} ${doc.document_type}`}>More</summary><div><button onClick={()=>{setReplaceTargetId(doc.id);replaceInput.current?.click()}}><Upload size={13}/> Replace</button><button onClick={()=>void reindexResearchDocument(doc)}><RotateCw size={13}/> Re-index</button><button className="remove-action" onClick={()=>void deleteResearchDocument(doc)}><Trash2 size={13}/> Delete</button></div></details></div></article>)}</div>:<div className="state-card">{documents.length?'No documents match these filters.':'No primary-source documents are indexed yet.'}</div>}
              </div>
            </div>
          </details>
        </section>
        <section className={`research-workflow anchor-section research-workflow-${researchTab}`} id="research" hidden={researchTab==='sources'}><div className="section-heading"><div><span className="eyebrow-mini">{researchTab==='ask'?'EVIDENCE-LED Q&A':researchTab==='financials'?'REPORTED PERFORMANCE':researchTab==='commitments'?'GUIDANCE TRACK RECORD':'BALANCED THESIS'}</span><h2>{researchTab==='ask'?'Ask FINN':researchTab==='financials'?'Financial performance':researchTab==='commitments'?'Management commitments':'Bull vs Bear'}</h2><p>{researchTab==='ask'?'Ask a focused question against this company’s indexed primary sources. Answers are independent and citations can be opened at the exact page.':researchTab==='financials'?'Review reported quarterly figures, like-for-like comparisons, and the source pages behind each value.':researchTab==='commitments'?'Compare explicit management guidance with reported results on a matching basis and period.': 'Build a balanced view from retrieved company documents; inspect the evidence and coverage before relying on a conclusion.'}</p></div><span className="market-source">{aiEnabled?`${aiProvider} available`:'Local retrieval active'}</span></div>
          <div className="research-pane" hidden={researchTab!=='ask'}>
          {researchMessage&&<p className="workflow-message" role="status">{researchMessage}</p>}
          {homeScopeNeedsConfirmation&&<div className="ai-scope-prompt" role="status"><b>Choose the evidence scope for this question</b><p>{documents.length ? 'Select a document, or choose its company scope below. FINN will not submit until you confirm by pressing Ask FINN.' : 'Your question is preserved. Upload and index a primary-source PDF to choose a scope and submit it.'}</p>{researchQuestion&&<blockquote>{researchQuestion}</blockquote>}</div>}
          {documents.length>0&&<>
            <AIConversation exchanges={quickAskExchanges} citationHref={citationHref}/>
            <form className="question-panel" onSubmit={askResearch}>
              <label>Source document<select value={homeScopeNeedsConfirmation?homeScopeDocumentId:documentId} onChange={event=>{const value=event.target.value;const selected=documents.find(doc=>doc.id===value);setDocumentId(value);if(selected)setResearchCompanyTicker(selected.ticker);if(homeScopeNeedsConfirmation)setHomeScopeDocumentId(value);setResearchAllCompanySources(false)}}>{homeScopeNeedsConfirmation&&<option value="">Choose a document…</option>}{documents.filter(doc=>!currentResearchTicker||tickerKey(doc.ticker)===tickerKey(currentResearchTicker)||homeScopeNeedsConfirmation).map(doc=><option key={doc.id} value={doc.id}>{doc.company} · {doc.document_type} · {doc.reporting_period} ({doc.pages} pages)</option>)}</select></label>
              <label>Your question<input value={researchQuestion} onChange={event=>setResearchQuestion(event.target.value)} minLength={5} maxLength={500} required placeholder="What did management say about margins?"/></label>
              <label className="research-scope-toggle"><input type="checkbox" checked={researchAllCompanySources} disabled={homeScopeNeedsConfirmation&&!homeScopeDocumentId} onChange={event=>setResearchAllCompanySources(event.target.checked)}/><span>Search all indexed sources for {documents.find(doc=>doc.id===(homeScopeNeedsConfirmation?homeScopeDocumentId:documentId))?.company ?? 'this company'}</span></label>
              <button type="submit" disabled={researchBusy||researchQuestion.trim().length<5||(homeScopeNeedsConfirmation&&!homeScopeDocumentId)}>Ask FINN <ArrowRight size={14}/></button>
            </form>
          </>}
          {documents.length===0&&<div className="research-first-source"><b>No indexed source documents yet</b><p>Search official company sources or upload a text-searchable PDF to enable cited answers.</p><button className="primary-button" onClick={()=>setResearchTab('sources')}>Find a source <ArrowRight size={14}/></button></div>}
          </div>
          {selectedDocument&&<>
            <div className="research-subsection" hidden={researchTab!=='financials'}><div className="section-heading"><div><h3>Quarterly financial comparisons</h3><p>Compare like with like. Figures are grouped by statement basis and reported or adjusted presentation; every saved value keeps its source page and excerpt.</p></div></div>
              {researchDatasetLoading.financials&&<div className="state-card" role="status">Loading reported financial periods from FINN…</div>}{researchDatasetErrors.financials&&<div className="state-card error-state" role="alert">Financial comparisons could not be loaded: {researchDatasetErrors.financials}</div>}
              <div className="financial-scope-controls"><label>Statement basis<select value={statementBasis} onChange={event=>setStatementBasis(event.target.value as 'consolidated'|'standalone')}><option value="consolidated">Consolidated</option><option value="standalone">Standalone</option></select></label><label>Figure presentation<select value={figureType} onChange={event=>setFigureType(event.target.value as 'reported'|'adjusted')}><option value="reported">Reported</option><option value="adjusted">Adjusted</option></select></label>{figureType==='adjusted'&&<label className="adjustment-note-field">Adjustment definition<input value={adjustmentNote} onChange={event=>setAdjustmentNote(event.target.value)} maxLength={500} placeholder="e.g. exclude one-time restructuring charge"/><small>Comparisons include only figures using this same definition.</small></label>}</div>
              <details className="research-company-compare"><summary>Compare companies using shared saved quarters</summary><p>FINN compares only exact shared quarters, the same statement basis and presentation, and matching units. No missing figures are estimated.</p><div><label>Company one<select value={(comparisonTickers[0] ?? '')} onChange={event=>setComparisonTickers([event.target.value,(comparisonTickers[1] ?? '')])}><option value="">Choose a company</option>{Array.from(new Map(documents.filter(doc=>!doc.superseded_by).map(doc=>[doc.ticker,{ticker:doc.ticker,company:doc.company}])).values()).map(company=><option key={company.ticker} value={company.ticker}>{company.company} · {company.ticker}</option>)}</select></label><label>Company two<select value={(comparisonTickers[1] ?? '')} onChange={event=>setComparisonTickers([(comparisonTickers[0] ?? ''),event.target.value])}><option value="">Choose a company</option>{Array.from(new Map(documents.filter(doc=>!doc.superseded_by).map(doc=>[doc.ticker,{ticker:doc.ticker,company:doc.company}])).values()).map(company=><option key={company.ticker} value={company.ticker}>{company.company} · {company.ticker}</option>)}</select></label><button className="link-button" onClick={()=>void compareResearchCompanies()} disabled={researchComparisonBusy}>{researchComparisonBusy?'Comparing…':'Compare'} <ArrowRight size={14}/></button></div>{researchComparisonError&&<p className="workflow-message" role="alert">{researchComparisonError}</p>}{researchComparison&&<div className="research-compare-result"><b>{researchComparison.tickers.join(' vs ')} · {researchComparison.statement_basis} · {researchComparison.figure_type}</b><p>{researchComparison.answer}</p>{researchComparison.comparisons.map(period=><section key={period.period}><h4>{period.period}</h4>{period.metrics.map(metric=><div className="research-compare-row" key={metric.metric}><b>{metric.metric.replaceAll('_',' ').toUpperCase()}</b>{metric.values.map(value=>{const source=researchComparison.sources.find(item=>item.id===value.source_id);return <span key={value.ticker}>{value.company} <strong>{value.value.toLocaleString('en-IN')} {value.unit}</strong>{source?.source_url&&<a href={source.source_url} target="_blank" rel="noreferrer">[{source.id}] p.{value.source_page} ↗</a>}</span>})}</div>)}</section>)}</div>}</details>
              {missingHistoricalInputs.length>0&&<details className="missing-financial-inputs" aria-labelledby="missing-financial-title"><summary className="missing-financial-heading"><div><b id="missing-financial-title">Historical inputs missing</b><p>{missingHistoricalInputs.length} comparisons need cited figures. Missing values stay unavailable; they are never treated as zero or a loss.</p></div><strong>{missingHistoricalInputs.length}</strong></summary><div className="missing-financial-groups">{missingHistoricalGroups.map(group=><section className="missing-financial-period" key={group.period}><h4>{group.period}</h4><ul>{group.items.map(item=><li key={`${item.metric}-${item.period}`}><div><b>{item.metric.replaceAll('_',' ').toUpperCase()}</b><small>Needed for {item.comparison} comparison with {item.comparison_period}</small></div><button onClick={()=>{setFinancialEntryPeriod(item.period);requestAnimationFrame(()=>{const field=document.querySelector<HTMLInputElement>(`.financial-entry [name="${item.metric}"]`);field?.scrollIntoView({behavior:'smooth',block:'center'});field?.focus({preventScroll:true})})}}>Enter figure <ArrowRight size={13}/></button></li>)}</ul></section>)}</div></details>}
              <details className="financial-entry-disclosure"><summary>Add cited quarterly figures</summary><form className="financial-entry" onSubmit={saveQuarterlyFigures}><label>Fiscal quarter<input id="financial-period-input" name="period" value={financialEntryPeriod} onChange={event=>setFinancialEntryPeriod(event.target.value)} required pattern="FY20[0-9]{2}-Q[1-4]" placeholder="FY2026-Q2" title="Format: FY2026-Q2"/></label><label>Units<select name="unit"><option>₹ crore</option><option>₹ lakh</option><option>₹</option></select></label><label>Source page<input name="page" type="number" min="1" max={selectedDocument.pages} required placeholder="PDF page number"/></label><label>Revenue<input name="revenue" type="number" step="any" placeholder="As filed"/></label><label>EBITDA<input name="ebitda" type="number" step="any" placeholder="As filed"/></label><label>PBT<input name="pbt" type="number" step="any" placeholder="As filed"/></label><label>PAT<input name="pat" type="number" step="any" placeholder="As filed"/></label><label>O2C EBITDA<input name="o2c_ebitda" type="number" step="any" placeholder="Optional segment value"/></label><label className="financial-excerpt">Supporting passage<input name="excerpt" required minLength={10} maxLength={1200} placeholder="Copy the relevant financial-results statement/table text"/></label><button type="submit">Save cited figures</button></form></details>
              {financialMessage&&<p className="workflow-message">{financialMessage}</p>}
              {financialPeriods.length>1&&<div className="financial-chart-card"><div className="section-heading"><div><h4>Quarterly trend</h4><p>{financialChartMetric.toUpperCase()} · {statementBasis} · {figureType}</p></div><div className="financial-chart-controls"><select aria-label="Chart metric" value={financialChartMetric} onChange={event=>setFinancialChartMetric(event.target.value)}>{['revenue','ebitda','pbt','pat','o2c_ebitda','ebitda_margin','pbt_margin','pat_margin'].map(metric=><option key={metric} value={metric}>{metric.toUpperCase()}</option>)}</select><button className={financialChartRange===4?'active':''} onClick={()=>setFinancialChartRange(4)}>4 quarters</button><button className={financialChartRange===8?'active':''} onClick={()=>setFinancialChartRange(8)}>8 quarters</button></div></div>{financialChartGeometry&&chartRows.length>1?<><svg viewBox="0 0 600 205" role="img" aria-label={`${financialChartMetric} values over ${chartRows.length} quarters`}><line x1="24" x2="576" y1={financialChartGeometry.zeroY} y2={financialChartGeometry.zeroY} className="financial-chart-zero"/><polyline points={financialChartGeometry.points} className="financial-chart-line" fill="none"/>{chartRows.map((row,index)=>{const values=chartRows.map(point=>point.value as number);const min=Math.min(0,...values),max=Math.max(0,...values),span=max-min||1;const cx=24+index*552/(chartRows.length-1),cy=166-((row.value as number)-min)*132/span;return <g key={row.period}><circle cx={cx} cy={cy} r="4"/><text x={cx} y="194" textAnchor="middle">{row.period.replace('FY','').replace('-Q','·Q')}</text></g>})}</svg><small>{chartRows.length} quarters · {chartRows[0]?.unit} · margins shown in percentage; QoQ/YoY comparisons in percentage points</small></>:<div className="state-card">Add at least two quarters with {financialChartMetric.toUpperCase()} values to plot this trend.</div>}</div>}
              {financialPeriods.slice(0,8).map((period,index)=><details className="financial-period" key={period.period} open={index===0}><summary>{period.period}<small>QoQ and YoY use the same basis and figure presentation</small></summary><div className="financial-table"><div className="financial-row financial-header"><span>Metric</span><span>{figureType}</span><span>QoQ</span><span>YoY</span><span>Evidence</span></div>{Object.entries(period.metrics).map(([metric,data])=><div className="financial-row" key={metric}><b>{metric==='revenue'?'REVENUE':metric.toUpperCase()}</b><span>{data.value.toLocaleString('en-IN')} {data.unit}</span><span>{changeValue(data.qoq)}<small>{changeNote(data.qoq,data.unit)}</small></span><span>{changeValue(data.yoy)}<small>{changeNote(data.yoy,data.unit)}</small></span><details><summary>{data.calculated?'Calculated from cited figures · ':''}{data.source.filename} · PDF p.{data.source.page}</summary>{citationHref({...data.source,page:data.source.page})&&<a href={citationHref({...data.source,page:data.source.page})} target="_blank" rel="noreferrer">Open exact source page ↗</a>}{data.source.excerpt&&<blockquote>{data.source.excerpt}</blockquote>}{data.source.supporting_sources?.map((source,index)=><blockquote key={`${source.filename}-${index}`}>{source.filename} · p.{source.page}: {source.excerpt}{citationHref({...source,page:source.page})&&<> <a href={citationHref({...source,page:source.page})} target="_blank" rel="noreferrer">Open page ↗</a></>}</blockquote>)}</details></div>)}</div></details>)}
              <details className="unified-evidence-ledger"><summary>Shared financial evidence ledger · {researchDatasetLoading.evidence?'loading':researchDatasetErrors.evidence?'unavailable':`${financialEvidence.length} records`}</summary><p>Financial comparisons, management guidance outcomes, and Bull vs Bear use these same source-linked records.</p>{researchDatasetLoading.evidence?<div className="state-card" role="status">Loading cited records from FINN…</div>:researchDatasetErrors.evidence?<div className="state-card error-state" role="alert">The evidence ledger could not be loaded: {researchDatasetErrors.evidence}</div>:financialEvidence.length?<div className="financial-evidence-list">{financialEvidence.map(item=><article key={item.id}><div><b>{item.evidence_kind==='management_guidance'?'Management guidance':'Reported financial evidence'} · {item.metric.replaceAll('_',' ')}</b><span>{item.period??item.target_period} · {item.statement_basis} · {item.figure_type}{item.adjustment_note?` · ${item.adjustment_note}`:''}</span><small>{item.evidence_kind==='management_guidance'?`Target ${item.target_value?.toLocaleString('en-IN')} ${item.unit} · “${item.quote}”`:`${item.value?.toLocaleString('en-IN')} ${item.unit}`}</small></div><a href={citationHref({...item.source,page:item.source.page})} target="_blank" rel="noreferrer">{item.source.filename} · p.{item.source.page} ↗</a></article>)}</div>:<div className="state-card">No source-linked financial or management evidence is saved for this company yet.</div>}</details>
              {!researchDatasetLoading.financials&&!researchDatasetErrors.financials&&financialPeriods.length===0&&<div className="state-card">No reported quarters are saved for {selectedDocument.ticker}. Add figures from an indexed quarterly-results filing to calculate comparisons.</div>}
            </div>

            <div className="research-subsection" hidden={researchTab!=='commitments'}><div className="section-heading"><div><h3>Management promise vs reality</h3><p>Log explicit guidance with its source passage, then compare it with the matching reported period.</p></div></div>
              {researchDatasetLoading.commitments&&<div className="state-card" role="status">Loading company commitments from FINN…</div>}{researchDatasetErrors.commitments&&<div className="state-card error-state" role="alert">Management commitments could not be loaded: {researchDatasetErrors.commitments}</div>}
              <details className="promise-entry-disclosure"><summary>Log a management commitment</summary><form className="promise-entry" onSubmit={savePromise}><div className="promise-entry-groups"><section className="promise-entry-group"><h4>Commitment context</h4><div className="promise-entry-fields"><label>Guidance metric<select name="metric"><option value="revenue_growth_yoy">Revenue growth YoY</option><option value="revenue">Revenue</option><option value="ebitda">EBITDA</option><option value="ebitda_margin">EBITDA margin</option><option value="pbt">PBT</option><option value="pbt_margin">PBT margin</option><option value="pat">PAT</option><option value="pat_margin">PAT margin</option><option value="annualized_o2c_ebitda">O2C EBITDA, annualized from H1</option></select></label><label>Target quarter<input name="target_period" required pattern="FY20[0-9]{2}-Q[1-4]" placeholder="FY2027-Q1"/></label><label>Statement basis<select value={statementBasis} onChange={event=>setStatementBasis(event.target.value as 'consolidated'|'standalone')}><option value="consolidated">Consolidated</option><option value="standalone">Standalone</option></select></label><label>Figure type<select value={figureType} onChange={event=>setFigureType(event.target.value as 'reported'|'adjusted')}><option value="reported">Reported</option><option value="adjusted">Adjusted</option></select></label></div></section><section className="promise-entry-group"><h4>Guidance value and source</h4><div className="promise-entry-fields promise-value-fields"><label>Guidance value<input name="target_value" type="number" step="any" required placeholder="15"/></label><label>Unit<input name="unit" required placeholder="% or ₹ crore"/></label><label>Guidance page<input name="page" type="number" min="1" max={selectedDocument.pages} required placeholder="PDF page number"/></label></div></section></div><label className="promise-quote">Management’s exact guidance<input name="quote" required minLength={10} maxLength={1200} placeholder="Transcribe the commitment from the selected source"/></label><button type="submit">Track commitment / revision</button></form></details>
              {promiseMessage&&<p className="workflow-message">{promiseMessage}</p>}
              {promiseTrackRecord&&<div className="promise-track-record"><b>Historical guidance outcomes</b><span>{promiseTrackRecord.completed_count} completed guidance items · {promiseTrackRecord.achieved_count} achieved/exceeded · {promiseTrackRecord.missed_count} below</span>{promiseTrackRecord.achievement_rate_pct!==null&&<strong>{promiseTrackRecord.achievement_rate_pct}% achieved or exceeded</strong>}{promiseTrackRecord.mean_absolute_deviation_pct!==null&&<span>Mean absolute deviation from guidance: {promiseTrackRecord.mean_absolute_deviation_pct}%</span>}<small>{promiseTrackRecord.achievement_rate_pct===null?`At least ${promiseTrackRecord.minimum_sample} completed, current guidance items are needed for a rate.`:promiseTrackRecord.note}</small></div>}
              {promiseRows.length>0?<div className="promise-list">{promiseRows.map(item=>{const actualText=item.actual_value===null?((({pending:'Reporting period is not complete',actual_missing:'Period ended · add the actual figure',not_comparable:'A matching basis, presentation, or unit is not available'} as Record<string,string>)[item.status])??'Awaiting comparable reported figures'):`${item.actual_value.toLocaleString('en-IN')} ${item.actual_unit??item.unit}`;return <article className="promise-card" key={item.id}><div className="promise-card-head"><b>{labelCategory(item.metric)} · {item.target_period} · v{item.revision??1}</b><span className={`promise-status ${item.is_current_guidance?item.status:'superseded-guidance'}`}>{item.is_current_guidance?promiseStatusLabel(item.status):'revised guidance'}</span></div><div className="promise-comparison"><div><small>Management guidance</small><strong>{item.target_value.toLocaleString('en-IN')} {item.unit}</strong><span>{item.statement_basis??'consolidated'} · {item.figure_type??'reported'}{item.adjustment_note?` · ${item.adjustment_note}`:''}</span></div><div><small>Reported actual</small><strong>{actualText}</strong></div>{item.deviation!==null&&<div className="promise-difference"><small>Difference</small><strong>{item.deviation>0?'+':''}{item.deviation.toFixed(2)} {item.actual_unit??item.unit}</strong></div>}</div><blockquote>“{item.quote}”</blockquote>{item.metric==='annualized_o2c_ebitda'&&<p className="promise-qualification">Annualized H1 run-rate estimate: 2 × (Q1 plus Q2 O2C EBITDA). This is not a full-year forecast.</p>}<div className="promise-evidence"><b>Evidence</b><div><span>Guidance</span>{citationHref({...item.source,page:item.source.page})&&<a href={citationHref({...item.source,page:item.source.page})} target="_blank" rel="noreferrer">{item.source.filename} · PDF p.{item.source.page} ↗</a>}</div>{item.actual_sources.map((source,index)=><div key={`${source.filename}-${index}`}><span>Actual</span>{citationHref({...source,page:source.page})&&<a href={citationHref({...source,page:source.page})} target="_blank" rel="noreferrer">{source.filename} · PDF p.{source.page} ↗</a>}</div>)}</div></article>})}</div>:!researchDatasetLoading.commitments&&!researchDatasetErrors.commitments?<div className="state-card">No management commitments logged yet. Outcomes are pending until the reporting period ends and comparable figures are available.</div>:null}
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
          <div className="section-heading holdings-section-heading"><div><h2>Your holdings</h2><p>{heldCompanies.length} open positions · {pricedHoldings.length} with current market prices</p></div><div className="holding-heading-actions"><button className="link-button" onClick={()=>void buildPortfolioIntelligence()} disabled={portfolioIntelligenceBusy||!pricedHoldings.length}>{portfolioIntelligenceBusy?'Reviewing portfolio…':'Ask FINN about risk'} <Sparkles size={14}/></button><button className="link-button" disabled={!portfolio} onClick={()=>selectSubview(setPortfolioTab,'watchlist')}>Add to holdings</button><button className="link-button" onClick={()=>selectSubview(setPortfolioTab,'activity')}>Record cash or corporate action</button><button className="link-button" onClick={exportPortfolio}>Export CSV</button></div></div>
          <small className="intelligence-privacy-note">A minimal holdings snapshot (tickers, weights and calculated metrics) is sent to the configured AI provider for this request only; FINN does not save it.</small>
          {portfolioIntelligenceError&&<p className="error-banner" role="alert">{portfolioIntelligenceError}</p>}{portfolioIntelligence&&<IntelligenceAnswer result={portfolioIntelligence}/>}
          {heldCompanies.length === 0 ? <div className="state-card holdings-empty"><span className="empty-icon"><BriefcaseBusiness size={21}/></span><div><b>Your holdings start here</b><p>Record a buy from the watchlist. Every trade remains in your local transaction history.</p><div className="empty-actions"><button className="save-button" disabled={!portfolio} onClick={()=>selectSubview(setPortfolioTab,'watchlist')}>Choose a company</button><button className="cancel-button" disabled={!portfolio} onClick={addDemoPositions}>Load demo holdings</button></div><small>Transactions are saved in this browser. Export a CSV backup regularly.</small></div></div> : <>
            <div className="holdings-summary"><article><small>Invested cost · open positions</small><b>{money(investedCapital)}</b></article><article><small>Market value{pricedHoldings.length < heldCompanies.length ? ' · partial' : ''}</small><b>{money(marketValue)}</b></article><article><small>Today’s P&amp;L{dailyPricedHoldings.length < heldCompanies.length ? ' · partial' : ''}</small><b className={todayPnl < 0 ? 'loss-value' : todayPnl > 0 ? 'gain-value' : ''}>{money(todayPnl)}</b></article><article><small>Unrealized P&amp;L</small><b className={unrealizedPnl < 0 ? 'loss-value' : unrealizedPnl > 0 ? 'gain-value' : ''}>{money(unrealizedPnl)}</b></article><article><small>Realized P&amp;L</small><b className={ledger.realizedPnl < 0 ? 'loss-value' : ledger.realizedPnl > 0 ? 'gain-value' : ''}>{money(ledger.realizedPnl)}</b></article><article><small>Dividends recorded</small><b>{money(ledger.dividends)}</b></article></div>
            <div className="portfolio-allocation-card"><div className="mini-panel-title"><span>ASSET ALLOCATION</span><span>{money(marketValue+ledger.cash)} total marked assets</span></div><div className="asset-allocation-list"><div><span><i className="asset-equity"/>Equities</span><b>{money(marketValue)}</b><strong>{marketValue+ledger.cash>0?(marketValue/(marketValue+ledger.cash)*100).toFixed(1):'—'}%</strong></div><div><span><i className="asset-cash"/>Cash &amp; dividends</span><b>{money(ledger.cash)}</b><strong>{marketValue+ledger.cash>0?(ledger.cash/(marketValue+ledger.cash)*100).toFixed(1):'—'}%</strong></div></div><small>Asset weights use priced equity holdings plus recorded cash only. Unpriced positions and untracked assets are excluded.</small></div>
            <article className="portfolio-sector-card allocation-card"><div className="mini-panel-title"><span>ALLOCATION BY SECTOR</span><span>{money(marketValue)} priced value</span></div>{allocation.length?<div className="allocation-list">{allocation.map((item,index)=><details className="allocation-row" key={item.sector}><summary><div className="allocation-label"><i style={{'--sector-color':`var(--sector-${index%6})`} as CSSProperties}/><span>{item.sector}</span><b>{item.pct.toFixed(1)}%</b></div><div className="allocation-track"><i style={{width:`${item.pct}%`,'--sector-color':`var(--sector-${index%6})`} as CSSProperties}/></div><div className="allocation-values"><span>Invested <b>{money(item.invested)}</b></span><span>Market value <b>{money(item.amount)}</b></span></div></summary><div className="sector-holdings">{item.holdings.map(company=><div key={company.ticker}><span><b>{company.name}</b><small>{company.ticker} · {holdings[company.ticker].shares.toLocaleString('en-IN')} shares</small></span><span><b>{money(holdings[company.ticker].shares*holdings[company.ticker].average_cost)}</b><small>invested</small></span><span><b>{money(holdings[company.ticker].shares*(company.price??0))}</b><small>market value</small></span></div>)}</div></details>)}</div>:<p className="performance-empty compact">Add priced holdings to calculate allocation.</p>}</article>
            <article className="concentration-card portfolio-concentration-card"><div className="mini-panel-title"><span>CONCENTRATION &amp; DIVERSIFICATION</span><small>Priced holdings · by current market value</small></div><div className="concentration-metrics"><div><small>Largest sector</small><b>{concentration.largestSector?`${concentration.largestSector.pct.toFixed(1)}%`: '—'}</b><span>{concentration.largestSector?.sector ?? 'No priced positions'}</span></div><div><small>Top 3 sectors</small><b>{concentration.sectorCount?`${concentration.topThreeSectors.toFixed(1)}%`:'—'}</b><span>Combined exposure</span></div><div><small>Largest stock</small><b>{concentration.largestStock?`${concentration.largestStock.pct.toFixed(1)}%`: '—'}</b><span>{concentration.largestStock?.company.name ?? 'No priced positions'}</span></div><div><small>Top 3 stocks</small><b>{concentration.pricedCount?`${concentration.topThreeStocks.toFixed(1)}%`:'—'}</b><span>Combined exposure</span></div><div><small>Sectors represented</small><b>{concentration.sectorCount}</b><span>Across {pricedHoldings.length}/{heldCompanies.length} priced holdings</span></div><div title="Herfindahl-Hirschman Index: sum of squared individual stock weights, on a 0–10,000 scale."><small>Stock HHI</small><b>{marketValue?Math.round(concentration.stockHhi):'—'}</b><span>Sum of squared stock weights · lower means less concentrated</span></div></div><div className="concentration-bars" aria-label="Largest sector and holding share of priced portfolio">{concentration.largestSector&&<div><span><b>{concentration.largestSector.sector}</b><small>Largest sector</small></span><strong>{concentration.largestSector.pct.toFixed(1)}%</strong><div className="allocation-track"><i style={{width:`${concentration.largestSector.pct}%`}}/></div></div>}{concentration.largestStock&&<div><span><b>{concentration.largestStock.company.name}</b><small>Largest holding</small></span><strong>{concentration.largestStock.pct.toFixed(1)}%</strong><div className="allocation-track"><i style={{width:`${concentration.largestStock.pct}%`}}/></div></div>}</div><p>{concentration.largestStock?`${concentration.largestStock.company.name} is the largest single-company exposure at ${concentration.largestStock.pct.toFixed(1)}% of priced holdings.`:'No priced holding exposure can be calculated yet'} {concentration.largestSector?`${concentration.largestSector.sector} is the largest sector at ${concentration.largestSector.pct.toFixed(1)}%.`:'Sector exposure is unavailable.'} These are exposure observations, not risk ratings. Stock HHI is the sum of squared individual stock weights.</p></article>
            <div className="positions-table"><div className="position-row position-header"><span>Company</span><span>Shares</span><span>Avg. cost</span><span>Last price</span><span>Market value</span><span>Today</span><span>Unrealized</span><span></span></div>
              {heldCompanies.map(company => {
                const position = holdings[company.ticker]
                const currentValue = company.market_status === 'available' && company.price !== undefined && !staleSession(company.session_date) ? position.shares * company.price : null
                const dayPerShare = !staleSession(company.session_date)&&company.price !== undefined && company.previous_close !== null && company.previous_close !== undefined ? company.price - company.previous_close : null
                const dayValue = dayPerShare === null ? null : dayPerShare * position.shares
                const unrealized = currentValue === null ? null : currentValue - position.shares * position.average_cost
                return <div className="position-row" key={company.ticker}><span className="position-company"><b>{company.name}</b><small>{company.ticker} · {company.sector}{position.demo&&<strong className="demo-badge">DEMO</strong>}</small></span><span>{position.shares.toLocaleString('en-IN')}</span><span>{money(position.average_cost)}</span><span>{company.market_status === 'available' ? `${staleSession(company.session_date)?'Stale · ':''}${money(company.price)}` : 'Unavailable'}</span><b>{money(currentValue)}</b><b className={dayValue === null || dayValue===0 ? '' : dayValue < 0 ? 'loss-value' : 'gain-value'}>{money(dayValue)}</b><b className={unrealized === null || unrealized===0 ? '' : unrealized < 0 ? 'loss-value' : 'gain-value'}>{money(unrealized)}</b><span className="position-actions"><button onClick={()=>openHoldingEditor(company,'buy')}>Buy</button><button className="remove-action" onClick={()=>openHoldingEditor(company,'sell',true)}>Sell</button><button onClick={()=>openCompanyResearch(company.ticker)}>Research</button></span></div>
              })}
            </div>
            <p className="holdings-note">Cost basis uses weighted-average accounting. Buys reduce recorded cash; sells retain proceeds and calculate realized profit after fees. Missing or stale prices are excluded from market-value totals. {heldCompanies.some(company=>holdings[company.ticker]?.demo)?'DEMO transactions are synthetic and should be replaced before using the figures. ':''}Ledger data stays in this browser.</p>
          </>}
          <section className="actual-performance-card"><div className="section-heading"><div><h3>Actual account performance</h3><p>Transaction-based value and time-weighted return · starts from the first recorded ledger date · raw closes plus recorded dividends</p></div><div className="account-range-tabs">{(['1W','1M','3M','1Y'] as const).map(range=><button key={range} className={accountRange===range?'active':''} onClick={()=>setAccountRange(range)}>{range}</button>)}</div></div>{accountHistoryLoading?<div className="state-card">Loading transaction and price history…</div>:accountChartPoints.length>1?<><div className="account-performance-summary"><strong>{accountReturn===null?'—':`${accountReturn>0?'+':''}${accountReturn.toFixed(2)}%`}</strong><span>Actual account return · {accountRange}</span><b>{money(accountChartPoints.at(-1)?.value)}</b></div><svg viewBox="0 0 760 210" role="img" aria-label={`Transaction-based portfolio return over ${accountRange}`} className="account-performance-chart"><path d="M12 62H748 M12 124H748 M12 186H748" className="chart-gridline"/><polyline points={accountChartGeometry} fill="none" className="financial-chart-line"/></svg><div className="chart-dates"><span>{accountChartPoints[0].date}</span><span>{accountChartPoints.at(-1)?.date}</span></div><div className="account-risk-grid"><article><small>NIFTY 50 · SAME PERIOD</small><b>{accountBenchmarkReturn===null?'—':`${accountBenchmarkReturn>0?'+':''}${accountBenchmarkReturn.toFixed(2)}%`}</b></article><article><small>ANNUALIZED VOLATILITY</small><b>{accountRisk.volatility===null?'—':`${accountRisk.volatility.toFixed(1)}%`}</b><span>{accountRisk.observations} daily observations</span></article><article><small>MAXIMUM DRAWDOWN · 5Y WINDOW</small><b className="loss-value">{accountRisk.maxDrawdown===null?'—':`${accountRisk.maxDrawdown.toFixed(1)}%`}</b></article></div></>:<div className="state-card"><b>Not enough transaction history for this range</b><p>Performance appears after recorded trades overlap with available daily prices. Home shows a separate historical valuation using today’s holdings.</p><small>{accountPoints.length} complete daily account values · {accountTickerKey? 'up to five years of provider prices requested':'Add a holding to start the ledger'}</small></div>}</section>
          </div>
          <div hidden={portfolioTab!=='watchlist'}>
          <div className="section-heading watchlist-heading"><div><h2>Company watchlist</h2><p>Track ideas, set target crossings, inspect fundamentals, and add a buy without leaving the watchlist.</p></div><div className="watchlist-header-actions"><button className="link-button" onClick={()=>setWatchlistManageOpen(true)}>Manage tracked companies</button></div></div>
          <div className="watchlist-controls"><label className="portfolio-search search-field"><Search size={16}/><input aria-label="Search watchlist" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search name, ticker, or sector"/>{query&&<button type="button" aria-label="Clear search" onClick={()=>setQuery('')}>×</button>}</label><div className="watchlist-category-tabs">{(['All','Core','Long-term','Short-term','Monitor'] as const).map(category=><button key={category} className={watchlistCategoryFilter===category?'active':''} onClick={()=>setWatchlistCategoryFilter(category)}>{category}</button>)}</div><small>Source: {portfolio?.source ?? 'loading'} · last successful portfolio refresh {portfolio?.last_successful_update?new Date(portfolio.last_successful_update).toLocaleString('en-IN'):'not available'} · latest completed session {trackedCompanies.map(company=>company.session_date).filter((date):date is string=>Boolean(date)).sort().at(-1)??'unavailable'}. Refresh time indicates when FINN retrieved data; the session date indicates the quote date.</small></div>
          <form className="watchlist-add-company" onSubmit={addCustomWatchlistCompany}><input aria-label="Company name" value={watchlistAddName} onChange={event=>setWatchlistAddName(event.target.value)} placeholder="Company name" required/><input aria-label="Exchange ticker" value={watchlistAddTicker} onChange={event=>setWatchlistAddTicker(event.target.value)} placeholder="TICKER.NS or TICKER.BO" required/><input aria-label="Sector" value={watchlistAddSector} onChange={event=>setWatchlistAddSector(event.target.value)} placeholder="Sector (optional)"/><button type="submit">Add company</button></form>
          {watchlistAlertEvents.filter(item=>!item.seen).length>0&&<section className="watchlist-alert-events"><div><b>Watchlist alerts</b><span>{watchlistAlertEvents.filter(item=>!item.seen).length} new in-app alert(s)</span></div>{watchlistAlertEvents.filter(item=>!item.seen).slice(0,5).map(item=><article key={item.id}><b>{item.company} · {item.ticker}</b><span>{item.mode==='percent'?`Daily move ${item.change_pct!==undefined&&item.change_pct>0?'+':''}${item.change_pct?.toFixed(2)??'—'}% met ${item.direction==='either'?'either-direction':item.direction} threshold ${item.target}%`:`Price ${item.direction==='above'?'crossed above':'crossed below'} ${money(item.target)}`} · latest {money(item.price)}</span><button onClick={()=>setWatchlistAlertEvents(current=>current.map(value=>value.id===item.id?{...value,seen:true}:value))}>Mark read</button></article>)}</section>}
          <div className="watchlist-targets">{watchlistAlerts.map(alert=><span key={alert.id}>{alert.ticker} {alert.mode==='percent'?`${alert.direction} ${alert.percent}% daily move`:`${alert.direction} ${money(alert.price)}`}<button aria-label={`Remove alert for ${alert.ticker}`} onClick={()=>setWatchlistAlerts(current=>current.filter(item=>item.id!==alert.id))}>×</button></span>)}</div>
          {loading&&!portfolio?<div className="state-card">Loading companies…</div>:<div className="watchlist-table"><div className="watchlist-row watchlist-header"><span>Company</span><span>Last price</span><span>Daily move</span><span>Volume · 20-session baseline</span><span>Actions</span></div>{filteredCompanies.filter(company=>watchlistCategoryFilter==='All'||(watchlistCategories[company.ticker]??'Monitor')===watchlistCategoryFilter).map(company=>{const position=holdings[company.ticker];const rows=watchlistHistory[company.ticker]??[];const target=watchlistAlerts.find(item=>item.ticker===company.ticker);const checkedAt=company.checked_at??company.price_updated_at;return <div className="watchlist-row" key={company.ticker}><span className="position-company"><b>{company.name} <button className="company-detail-button" aria-label={`Fundamentals for ${company.name}`} onClick={()=>void openCompanyFundamentals(company)}>ⓘ</button></b><small>{company.ticker} · {company.sector}</small><select aria-label={`${company.name} watchlist category`} value={watchlistCategories[company.ticker]??'Monitor'} onChange={event=>setWatchlistCategory(company.ticker,event.target.value as WatchlistCategory)}><option>Core</option><option>Long-term</option><option>Short-term</option><option>Monitor</option></select></span><b>{company.market_status==='available'?money(company.price):'Unavailable'}</b><b className={company.change_pct!==null&&company.change_pct!==undefined?(company.change_pct<0?'loss-value':'gain-value'):''}>{company.change_pct!==null&&company.change_pct!==undefined?`${company.change_pct>0?'+':''}${company.change_pct.toFixed(2)}%`:'—'}</b><span>{company.volume_ratio_20d!==null&&company.volume_ratio_20d!==undefined?`${company.volume_ratio_20d.toFixed(2)}×`:'—'}<small className={`watchlist-freshness ${staleSession(company.session_date)?'stale-price':''}`}>{company.market_status==='available'?`${staleSession(company.session_date)?'STALE · ':''}Session ${company.session_date??'unknown'} · retrieved ${checkedAt?new Date(checkedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'time unavailable'}`:`Price unavailable · checked ${checkedAt?new Date(checkedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'time unavailable'}`}</small></span><div className="watchlist-row-actions"><button className="holding-action" onClick={()=>openHoldingEditor(company,'buy')}>{position?'Buy more':'Add buy'}</button><button className="holding-action" onClick={()=>openPriceAlert(company)}>{target?'Edit alert':'Price alert'}</button><button className="holding-action" onClick={()=>void openCompanyFundamentals(company)}>Details</button><button className="holding-action" onClick={()=>openCompanyResearch(company.ticker)}>Research</button><button className="remove-action" onClick={()=>removeTrackedCompany(company.ticker)}>Remove</button></div><details className="watchlist-returns"><summary>Historical returns</summary><div><span>1W <b className={(returnFor(rows,6)??0)<0?'loss-value':'gain-value'}>{returnFor(rows,6)===null?'—':`${returnFor(rows,6)!>0?'+':''}${returnFor(rows,6)!.toFixed(2)}%`}</b></span><span>1M <b>{returnFor(rows,22)===null?'—':`${returnFor(rows,22)!>0?'+':''}${returnFor(rows,22)!.toFixed(2)}%`}</b></span><span>3M <b>{returnFor(rows,64)===null?'—':`${returnFor(rows,64)!>0?'+':''}${returnFor(rows,64)!.toFixed(2)}%`}</b></span><span>1Y <b>{returnFor(rows,253)===null?'—':`${returnFor(rows,253)!>0?'+':''}${returnFor(rows,253)!.toFixed(2)}%`}</b></span></div></details></div>})}</div>}
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
        {watchlistManageOpen&&<div className="modal-backdrop watchlist-manager-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setWatchlistManageOpen(false)}}><section className="holding-modal watchlist-manager" role="dialog" aria-modal="true" aria-labelledby="watchlist-manager-title"><button className="modal-close" type="button" onClick={()=>setWatchlistManageOpen(false)} aria-label="Close watchlist manager">×</button><span className="eyebrow-mini">TRACKED COMPANIES · MAXIMUM 20</span><h2 id="watchlist-manager-title">Manage watchlist</h2><p>Removing a company hides it from the watchlist. It stays in your holdings and transaction history.</p><div className="watchlist-manager-list">{allCompanies.map(company=>{const isTracked=trackedCompanies.some(item=>item.ticker===company.ticker);return <label key={company.ticker}><input type="checkbox" checked={isTracked} disabled={!isTracked&&trackedCompanies.length>=20} onChange={event=>toggleTrackedCompany(company.ticker,event.target.checked)}/><span>{company.name}<small>{company.ticker} · {company.sector}</small></span></label>})}</div><div className="modal-actions"><button className="save-button" onClick={()=>setWatchlistManageOpen(false)}>Done</button></div></section></div>}
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
