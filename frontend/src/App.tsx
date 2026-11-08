import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, BriefcaseBusiness, ChevronDown, FileText, LayoutDashboard, RefreshCw, Search, ShieldCheck, Sparkles, Upload } from 'lucide-react'

type Company = { name: string; ticker: string; sector: string; market_status: 'available' | 'unavailable'; reason?: string; session_date?: string; currency?: string; price?: number; change_pct?: number | null; volume?: number | null; average_volume_20d?: number | null; volume_ratio_20d?: number | null; unusual_volume?: boolean; unusual_price?: boolean }
type Alert = Company & { alert_types?: string[] }
type Portfolio = { source: string; retrieved_at: string; notice: string; companies: Company[]; available_count: number; alert_count: number; alerts: Alert[]; settings: { volume_multiple: number; price_move_pct: number } }
type Announcement = { id: string; company: string; ticker: string; subject: string; details: string; filed_at: string; source_url: string; category: string; importance: number; priority: string; rule_explanation: string; is_verified_example?: boolean }
type ResearchSource = { id: string; document_id?: string; source_url?: string; filename: string; document_type: string; reporting_period: string; page: number; excerpt: string }
type ResearchDocument = { id: string; company: string; ticker: string; filename: string; document_type: string; reporting_period: string; pages: number; source_url?: string }
type Holding = { shares: number; average_cost: number; demo?: boolean }
type FinancialChange = { period: string; value: number | null; unit: string | null; change_pct: number | null; status: 'available' | 'missing_data' | 'unit_mismatch' | 'non_positive_base' }
type FinancialComparison = { period: string; metrics: Record<string, { value: number; unit: string; source: { filename: string; page: number; excerpt: string; source_url?: string }; qoq: FinancialChange; yoy: FinancialChange }> }
type PromiseComparison = { id: string; metric: string; target_period: string; target_value: number; unit: string; quote: string; source: { filename: string; page: number; source_url?: string }; actual_value: number | null; actual_unit: string | null; deviation: number | null; status: string; actual_sources: { filename: string; page: number; excerpt: string; source_url?: string }[] }

const API = import.meta.env.VITE_API_BASE_URL ?? ''
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
const changeValue = (change: FinancialChange) => change.status === 'available' && change.change_pct !== null ? `${change.change_pct > 0 ? '+' : ''}${change.change_pct.toFixed(2)}%` : ({ missing_data: 'Data missing', unit_mismatch: 'Unit mismatch', non_positive_base: 'Not comparable', available: 'Not calculated' }[change.status])
const changeNote = (change: FinancialChange, currentUnit: string) => change.status === 'missing_data' ? `${change.period} has not been entered` : change.status === 'unit_mismatch' ? `${change.period} · ${change.unit ?? 'unknown unit'} vs ${currentUnit}` : change.status === 'non_positive_base' ? `${change.period} · prior value is zero or negative` : change.period
const marketSignalContext = (company: Alert) => {
  const price = company.change_pct === null || company.change_pct === undefined ? 'Price change unavailable' : `price ${company.change_pct > 0 ? 'rose' : company.change_pct < 0 ? 'fell' : 'was unchanged'} ${Math.abs(company.change_pct).toFixed(2)}%`
  const volume = company.volume_ratio_20d === null || company.volume_ratio_20d === undefined ? 'volume comparison unavailable' : `volume reached ${company.volume_ratio_20d.toFixed(2)}× its 20-session average`
  return `${price} and ${volume}. This is an unusual market signal; no cause has been established. Compare it with the latest exchange filings.`
}

function App() {
  const [active, setActive] = useState(pageFromUrl)
  const [alertsTab, setAlertsTab] = useState<'filings' | 'market'>('filings')
  const [researchTab, setResearchTab] = useState<'ask' | 'financials' | 'commitments' | 'analysis'>('ask')
  const [portfolioTab, setPortfolioTab] = useState<'holdings' | 'watchlist'>('holdings')
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [marketError, setMarketError] = useState('')
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [announcementError, setAnnouncementError] = useState('')
  const [announcementWindow, setAnnouncementWindow] = useState(24)
  const [showRoutine, setShowRoutine] = useState(false)
  const [explanations, setExplanations] = useState<Record<string, string>>({})
  const [explanationModes, setExplanationModes] = useState<Record<string, string>>({})
  const [explaining, setExplaining] = useState('')
  const [settings, setSettings] = useState({ volume_multiple: 2, price_move_pct: 5 })
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
  const [financialPeriods, setFinancialPeriods] = useState<FinancialComparison[]>([])
  const [financialMessage, setFinancialMessage] = useState('')
  const [promiseRows, setPromiseRows] = useState<PromiseComparison[]>([])
  const [promiseMessage, setPromiseMessage] = useState('')
  const [bullBear, setBullBear] = useState<{ mode: string; answer: string; sources: ResearchSource[] } | null>(null)
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

  useEffect(() => {
    localStorage.setItem('finn-holdings-v1', JSON.stringify(holdings))
  }, [holdings])

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
    } catch (error) {
      setAnnouncementError(error instanceof Error ? error.message : 'NSE announcement feed unavailable.')
      setAnnouncements([])
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
    setDocumentId(current => preferredId && loaded.some(doc => doc.id === preferredId) ? preferredId : current && loaded.some(doc => doc.id === current) ? current : loaded[0]?.id ?? '')
    return loaded
  }

  useEffect(() => {
    void loadPortfolio()
    void loadAnnouncements(24)
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
  const visibleAnnouncements = useMemo(() => announcements.filter(item => showRoutine || item.priority !== 'routine'), [announcements, showRoutine])
  const selectedDocument = documents.find(doc => doc.id === documentId)

  useEffect(() => {
    if (!selectedDocument) {
      setFinancialPeriods([])
      setPromiseRows([])
      return
    }
    const ticker = encodeURIComponent(selectedDocument.ticker)
    fetch(`${API}/api/research/financials?ticker=${ticker}`).then(response => response.ok ? response.json() : null).then(payload => setFinancialPeriods(payload?.periods ?? [])).catch(() => setFinancialPeriods([]))
    fetch(`${API}/api/research/promises?ticker=${ticker}`).then(response => response.ok ? response.json() : null).then(payload => setPromiseRows(payload?.promises ?? [])).catch(() => setPromiseRows([]))
  }, [selectedDocument?.ticker, documentId])
  const heldCompanies = useMemo(() => (portfolio?.companies ?? []).filter(company => (holdings[company.ticker]?.shares ?? 0) > 0), [portfolio, holdings])
  const pricedHoldings = heldCompanies.filter(company => company.market_status === 'available' && Number.isFinite(company.price))
  const investedCapital = heldCompanies.reduce((sum, company) => sum + holdings[company.ticker].shares * holdings[company.ticker].average_cost, 0)
  const marketValue = pricedHoldings.reduce((sum, company) => sum + holdings[company.ticker].shares * (company.price ?? 0), 0)
  const unrealizedPnl = pricedHoldings.reduce((sum, company) => sum + holdings[company.ticker].shares * ((company.price ?? 0) - holdings[company.ticker].average_cost), 0)
  const todayPnl = pricedHoldings.reduce((sum, company) => {
    const pct = company.change_pct
    if (pct === null || pct === undefined || pct <= -100 || company.price === undefined) return sum
    const previousClose = company.price / (1 + pct / 100)
    return sum + holdings[company.ticker].shares * (company.price - previousClose)
  }, 0)

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

  async function explainMarketAlert(company: Alert) {
    const key = `market-${company.ticker}`
    setExplaining(key)
    try {
      const response = await fetch(`${API}/api/market/explain`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ company: company.name, ticker: company.ticker, change_pct: company.change_pct ?? null, volume_ratio_20d: company.volume_ratio_20d ?? null, volume_threshold: settings.volume_multiple, price_threshold_pct: settings.price_move_pct }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || 'AI explanation unavailable.')
      setExplanations(previous => ({ ...previous, [key]: payload.explanation }))
      setExplanationModes(previous => ({ ...previous, [key]: payload.mode ?? (payload.ai_generated ? 'ai_grounded' : 'rule_based') }))
    } catch (error) {
      setExplanations(previous => ({ ...previous, [key]: error instanceof Error ? error.message : 'AI explanation unavailable.' }))
      setExplanationModes(previous => ({ ...previous, [key]: 'error' }))
    } finally { setExplaining('') }
  }

  async function uploadResearch(event: any) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) { setResearchMessage('Choose a PDF file before indexing it.'); return }
    if (file.size > 30 * 1024 * 1024) { setResearchMessage('This PDF is larger than the 30 MB upload limit.'); return }
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
    } catch (error) {
      setResearchMessage(error instanceof Error ? error.message : 'Could not upload the document.')
    } finally { setResearchBusy(false) }
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
      const response = await fetch(`${API}/api/research/financials`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document_id: selectedDocument.id, ticker: selectedDocument.ticker, period: form.get('period'), unit: form.get('unit'), page: Number(form.get('page')), excerpt: form.get('excerpt'), values }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || 'Could not save figures.')
      setFinancialPeriods(payload.comparisons.periods)
      setFinancialMessage(`Saved ${payload.saved.length} reported figure(s). Comparisons are calculated from entered quarters.`)
      await refreshPromises(selectedDocument.ticker)
    } catch (error) { setFinancialMessage(error instanceof Error ? error.message : 'Could not save figures.') }
  }

  async function refreshPromises(ticker: string) {
    try {
      const response = await fetch(`${API}/api/research/promises?ticker=${encodeURIComponent(ticker)}`)
      const payload = await response.json()
      if (response.ok) setPromiseRows(payload.promises)
    } catch { /* Keep current tracker until the next refresh. */ }
  }

  async function savePromise(event: any) {
    event.preventDefault()
    if (!selectedDocument) return
    const form = new FormData(event.currentTarget)
    setPromiseMessage('Saving management guidance with its source citation…')
    try {
      const response = await fetch(`${API}/api/research/promises`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document_id: selectedDocument.id, ticker: selectedDocument.ticker, metric: form.get('metric'), target_period: form.get('target_period'), target_value: Number(form.get('target_value')), unit: form.get('unit'), page: Number(form.get('page')), quote: form.get('quote') }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || 'Could not save the guidance item.')
      setPromiseRows(payload.promises)
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
    setHoldingEditor(company)
  }

  function saveHolding(event: any) {
    event.preventDefault()
    if (!holdingEditor) return
    const shares = Number(holdingShares)
    const averageCost = Number(holdingAverageCost)
    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(averageCost) || averageCost <= 0) return
    setHoldings(current => ({ ...current, [holdingEditor.ticker]: { shares, average_cost: averageCost } }))
    setHoldingEditor(null)
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

  function removeHolding(ticker: string) {
    setHoldings(current => {
      const next = { ...current }
      delete next[ticker]
      return next
    })
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#/home" onClick={event=>{event.preventDefault();navigate('Home','home')}} aria-label="FINN home"><span className="brand-mark">f</span><span>finn<span className="brand-dot">.</span></span></a>
      <div className="workspace-label">WORKSPACE</div>
      <div className="workspace"><div className="workspace-icon">A</div><span>Analyst workspace</span><ChevronDown size={15}/></div>
      <div className="nav-label">OVERVIEW</div>
      <nav>{nav.map(({label,icon:Icon,target})=><button key={label} aria-current={active===label?'page':undefined} className={`nav-item ${active===label?'selected':''}`} onClick={()=>navigate(label,target)}><Icon size={18}/><span>{label}</span>{label==='Alerts'&&portfolio&&<b>{String(portfolio.alert_count + announcements.filter(item=>item.priority==='high').length).padStart(2,'0')}</b>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="source-note"><ShieldCheck size={17}/><span>Evidence first<br/><small>Claims cite their source</small></span></div><div className="profile"><span className="avatar">A</span><span>Analyst workspace<small>Demo universe</small></span><ChevronDown size={15}/></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="crumb">FINN <span>/</span> {active.toUpperCase()}</div><div className="top-actions"><span className="market-status"><i className={portfolio?.available_count ? 'connected' : ''}/> {portfolio?.available_count ? 'Market data connected' : portfolio ? 'No market data' : 'Connecting'}</span><button className="icon-button" aria-label="Refresh data" onClick={()=>void loadPortfolio(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing?'spin':''}/></button><div className="avatar small">A</div></div></header>
      <div className="content" id="home">
      <div className="page-view" key={active}>
      {active==='Home'&&<>
        <div className="eyebrow"><span>INVESTMENT PORTFOLIO</span><i/> MARKET INTELLIGENCE</div>
        <section className="greeting"><div><h1>Market overview</h1><p>A quick view of your holdings, daily P&amp;L, and market signals.</p></div><div className="greeting-actions">{heldCompanies.length===0&&<button className="demo-load-button" onClick={addDemoPositions} disabled={!portfolio}>Load labelled demo portfolio</button>}<button className="date-button" onClick={()=>void loadPortfolio(true)} disabled={refreshing}>{refreshing?'Refreshing…':'Refresh prices'} <RefreshCw size={13}/></button></div></section>
        {marketError&&<div className="error-banner" role="alert"><span>{marketError}</span><button onClick={()=>void loadPortfolio(true)}>Retry <ArrowRight size={14}/></button></div>}
        <section className="stats-grid">
          <article className="stat-card portfolio-stat"><div className="stat-heading">Portfolio market value <span className="subtle">{heldCompanies.length ? `${pricedHoldings.length}/${heldCompanies.length} PRICED` : 'ADD HOLDINGS'}</span></div><div className="stat-value">{heldCompanies.length ? money(marketValue) : '—'}</div><div className="stat-foot"><span>{heldCompanies.length ? `${heldCompanies.length} positions · ${portfolio?.source ?? 'Market source pending'}` : 'Enter the shares you actually own'}</span><span>{portfolio?new Date(portfolio.retrieved_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'—'}</span></div></article>
          <article className="stat-card"><div className="stat-heading">Portfolio alerts <span className="stat-icon amber"><Bell size={17}/></span></div><div className="stat-value">{loading?'—':String((portfolio?.alert_count ?? 0) + announcements.filter(item=>item.priority==='high').length).padStart(2,'0')}</div><div className="stat-foot"><span>Price, volume, and filings</span><button className="text-amber" onClick={()=>navigate('Alerts','alerts')}>Review <ArrowRight size={13}/></button></div></article>
          <article className="stat-card"><div className="stat-heading">Daily P&L <span className="stat-icon blue"><Activity size={17}/></span></div><div className={`stat-value ${todayPnl < 0 ? 'loss-value' : todayPnl > 0 ? 'gain-value' : ''}`}>{heldCompanies.length ? money(todayPnl) : '—'}</div><div className="stat-foot"><span>From latest available close</span><button onClick={()=>navigate('Portfolio','portfolio')}>Holdings <ArrowRight size={13}/></button></div></article>
        </section>
        <div className="home-shortcuts">
          <button onClick={()=>navigate('Alerts','alerts')}><span className="shortcut-icon"><Bell size={17}/></span><span><b>Review market signals</b><small>Announcements, unusual volume, and price moves</small></span><ArrowRight size={17}/></button>
          <button onClick={()=>navigate('Research','research')}><span className="shortcut-icon"><Search size={17}/></span><span><b>Research a company</b><small>Ask questions against cited primary sources</small></span><ArrowRight size={17}/></button>
          <button onClick={()=>navigate('Portfolio','portfolio')}><span className="shortcut-icon"><BriefcaseBusiness size={17}/></span><span><b>Manage portfolio</b><small>Review holdings and the 20-company watchlist</small></span><ArrowRight size={17}/></button>
        </div>
      </>}

      {active==='Alerts'&&<>
        <div className="eyebrow"><span>PUSH INTELLIGENCE</span><i/> FILINGS & MARKET SIGNALS</div>
        <section className="greeting page-greeting"><div><h1>Alerts</h1><p>Exchange filings and unusual market activity, with source links and context.</p></div></section>
        <div className="page-tabs" role="tablist" aria-label="Alert views">
          <button role="tab" aria-selected={alertsTab==='filings'} className={alertsTab==='filings'?'active':''} onClick={()=>selectSubview(setAlertsTab,'filings')}>Company filings</button>
          <button role="tab" aria-selected={alertsTab==='market'} className={alertsTab==='market'?'active':''} onClick={()=>selectSubview(setAlertsTab,'market')}>Price & volume</button>
        </div>
        {alertsTab==='filings'&&<>
        <section id="alerts" className="anchor-section">
          <div className="section-heading"><div><h2>Announcement intelligence</h2><p>Exchange filings classified and ranked by likely relevance</p></div><div className="section-tools"><select aria-label="Announcement time window" value={announcementWindow} onChange={event=>{const hours=Number(event.target.value);setAnnouncementWindow(hours);void loadAnnouncements(hours)}}><option value={24}>Last 24 hours</option><option value={168}>Last 7 days</option><option value={720}>Last 30 days</option></select><button className="link-button" onClick={()=>void loadAnnouncements()}>Refresh <RefreshCw size={13}/></button></div></div>
          {announcementError?<div className="state-card error-state"><span>{announcementError} FINN is not filling the feed with invented filings.</span><button onClick={()=>void loadAnnouncements()}>Retry</button></div>:announcements.length===0?<div className="state-card">No portfolio filings in the last {announcementWindow===24?'24 hours':announcementWindow===168?'7 days':'30 days'}. {announcementWindow<720?'Try a wider window to inspect older filings.':'Check NSE directly or refresh later.'}</div>:<>
            <label className="routine-toggle"><input type="checkbox" checked={showRoutine} onChange={event=>setShowRoutine(event.target.checked)}/> Show routine filings</label>
            <div className="announcement-list">{visibleAnnouncements.map(item=><article className="announcement-card" key={item.id}><div className="alert-top"><span className={`priority ${item.priority==='high'?'':'medium'}`}><i/> {item.priority.toUpperCase()} · {labelCategory(item.category)}</span><span className="time">{new Date(item.filed_at).toLocaleString('en-IN')}</span></div><div className="announcement-title"><div><h3>{item.company}</h3><small>{item.ticker} · Importance {item.importance}/100</small></div><span className="score-pill">{item.importance}</span></div><p className="announcement-subject">{item.subject}</p>{item.details&&<p className="announcement-details">{item.details}</p>}<div className="why"><Sparkles size={15}/><span><b>Why it may matter</b><br/>{item.rule_explanation}</span></div>{item.is_verified_example&&<div className="verified-filing">Verified NSE filing · included as a Push demo example</div>}{explanations[item.id]&&<div className="ai-explanation"><b>{explanationModes[item.id]==='rule_based_fallback'?'Rule-based fallback':explanationModes[item.id]==='error'?'Explanation unavailable':explanationModes[item.id]==='rule_based'?'Rule-based explanation':'FINN AI explanation'}</b><p>{explanations[item.id]}</p>{explanationModes[item.id]==='rule_based_fallback'&&<small>OpenRouter did not respond. Check the backend terminal for the provider error.</small>}</div>}<div className="card-footer"><a href={item.source_url} target="_blank" rel="noreferrer"><FileText size={14}/> Open NSE source ↗</a><button onClick={()=>void explainAnnouncement(item)} disabled={explaining===item.id}><Sparkles size={14}/>{explaining===item.id?'Thinking…':aiEnabled?'AI explanation':'Explain signal'}</button></div></article>)}</div>
          </>}
        </section>
        </>}

        {alertsTab==='market'&&<>
        <section className="alerts-section">
          <div className="section-heading"><div><h2>Price & volume alerts</h2><p>Deterministic thresholds, calculated from daily market data</p></div><button className="link-button" onClick={()=>void loadPortfolio(true)}>Refresh data <RefreshCw size={13}/></button></div>
          <form className="threshold-panel" onSubmit={updateSettings}><label>Volume multiple<input type="number" min="1.1" max="10" step="0.1" value={settings.volume_multiple} onChange={event=>setSettings({...settings,volume_multiple:Number(event.target.value)})}/>× 20-session average</label><label>Daily price move<input type="number" min="0.5" max="25" step="0.5" value={settings.price_move_pct} onChange={event=>setSettings({...settings,price_move_pct:Number(event.target.value)})}/>± %</label><button type="submit">Save thresholds</button><span>{settingsMessage}</span></form>
          {loading&&!portfolio?<div className="state-card">Loading market data…</div>:portfolio?.alerts.length?<div className="intelligence-grid">{portfolio.alerts.map(company=><article className="alert-card" key={company.ticker}><div className="alert-top"><span className="priority"><i/> {(company.alert_types ?? (company.unusual_volume ? ['unusual_volume'] : [])).map(labelCategory).join(' + ').toUpperCase()}</span><span className="time">{company.session_date}</span></div><div className="company-line"><span className="company-logo green">{company.name[0]}</span><span><b>{company.name}</b><small>{company.ticker} · {company.sector}</small></span></div>{company.unusual_volume&&<h3>{company.volume_ratio_20d?.toFixed(1)}× its 20-session average volume</h3>}{company.unusual_price&&<h3>Daily price move {company.change_pct!==null&&company.change_pct!==undefined&&company.change_pct>0?'+':''}{company.change_pct?.toFixed(2)}%</h3>}<p>{marketSignalContext(company)} Latest close ₹{company.price?.toLocaleString('en-IN') ?? 'Unavailable'} · volume {company.volume?.toLocaleString('en-IN') ?? 'Unavailable'} shares.</p><div className="why"><Activity size={15}/><span>This is a statistical signal only. It does not establish a cause or predict future performance.</span></div>{explanations[`market-${company.ticker}`]&&<div className="ai-explanation"><b>{explanationModes[`market-${company.ticker}`]==='rule_based_fallback'?'Rule-based fallback':explanationModes[`market-${company.ticker}`]==='error'?'Explanation unavailable':explanationModes[`market-${company.ticker}`]==='rule_based'?'Rule-based explanation':'FINN AI explanation'}</b><p>{explanations[`market-${company.ticker}`]}</p>{explanationModes[`market-${company.ticker}`]==='rule_based_fallback'&&<small>OpenRouter did not respond. Check the backend terminal for the provider error.</small>}</div>}<div className="card-footer"><span>Source: <a href={`https://finance.yahoo.com/quote/${encodeURIComponent(company.ticker)}`} target="_blank" rel="noreferrer">Yahoo Finance ↗</a></span><button onClick={()=>void explainMarketAlert(company)} disabled={explaining===`market-${company.ticker}`}><Sparkles size={14}/>{explaining===`market-${company.ticker}`?'Thinking…':aiEnabled?'AI explanation':'Explain signal'}</button></div></article>)}</div>:<div className="state-card">{marketError?'Market data is unavailable, so FINN is not inferring that there are no alerts.':portfolio?.available_count?'No tracked company crossed the configured thresholds in the latest complete session.':'No market data returned.'}</div>}
        </section>
        </>}
      </>}

      {active==='Research'&&<>
        <div className="eyebrow"><span>PULL RESEARCH</span><i/> EVIDENCE WITH SOURCES</div>
        <section className="greeting page-greeting"><div><h1>Company research</h1><p>Search company filings and reports, then review answers with document and page citations.</p></div></section>
        <div className="page-tabs" role="tablist" aria-label="Research tools">
          <button role="tab" aria-selected={researchTab==='ask'} className={researchTab==='ask'?'active':''} onClick={()=>selectSubview(setResearchTab,'ask')}>Ask FINN</button>
          <button role="tab" aria-selected={researchTab==='financials'} className={researchTab==='financials'?'active':''} onClick={()=>selectSubview(setResearchTab,'financials')}>Financials</button>
          <button role="tab" aria-selected={researchTab==='commitments'} className={researchTab==='commitments'?'active':''} onClick={()=>selectSubview(setResearchTab,'commitments')}>Commitments</button>
          <button role="tab" aria-selected={researchTab==='analysis'} className={researchTab==='analysis'?'active':''} onClick={()=>selectSubview(setResearchTab,'analysis')}>Bull vs bear</button>
        </div>
        <section className="research-workflow anchor-section" id="research"><div className="section-heading"><div><h2>Primary-source company research</h2><p>Upload an annual report or earnings-call transcript, then ask a question with page citations.</p></div><span className="market-source">{aiEnabled?`${aiProvider} available`:'Local retrieval active'}</span></div>
          <div className="research-pane" hidden={researchTab!=='ask'}>
          <form className="upload-panel" onSubmit={uploadResearch}><label>Company<input name="company" required placeholder="e.g. Reliance Industries"/></label><label>NSE ticker<input name="ticker" required placeholder="e.g. RELIANCE"/></label><label>Source type<select name="document_type" required><option>Annual report</option><option>Quarterly results</option><option>Earnings-call transcript</option><option>Investor presentation</option></select></label><label>Reporting period<input name="reporting_period" required placeholder="e.g. FY2026 or Q2 FY2027"/></label><label className="file-picker"><Upload size={16}/>{researchFilename||'Choose PDF'}<input type="file" name="file" accept="application/pdf,.pdf" required onChange={event=>setResearchFilename(event.target.files?.[0]?.name ?? '')}/></label><button type="submit" disabled={researchBusy}>Index primary source</button></form><small className="upload-hint">Text-searchable PDFs only · maximum 45 MB. Scanned image PDFs need OCR before upload.</small>
          {documents.length>0&&<form className="question-panel" onSubmit={askResearch}><label>Source document<select value={documentId} onChange={event=>setDocumentId(event.target.value)}>{documents.map(doc=><option key={doc.id} value={doc.id}>{doc.company} · {doc.document_type} · {doc.reporting_period} ({doc.pages} pages)</option>)}</select></label><label>Your question<input value={researchQuestion} onChange={event=>setResearchQuestion(event.target.value)} minLength={5} required placeholder="What did management say about margins?"/></label><button type="submit" disabled={researchBusy}>Ask FINN <ArrowRight size={14}/></button></form>}
          {researchMessage&&<p className="workflow-message">{researchMessage}</p>}{researchAnswer&&<div className="research-answer"><div className="answer-heading"><Sparkles size={16}/><b>{researchMode==='ai_grounded'?'FINN model-assisted research':researchMode==='extractive_local'?'FINN extractive answer':'FINN source evidence'}</b></div><p>{researchAnswer}</p>{researchSources.map(source=><details className="source-citation" key={source.id} open><summary>[{source.id}] {source.filename} · {source.document_type} · {source.reporting_period} · p. {source.page}</summary>{source.source_url&&<a href={`${source.source_url}#page=${source.page}`} target="_blank" rel="noreferrer">Open cited source page ↗</a>}<blockquote>{source.excerpt}</blockquote></details>)}</div>}
          {documents.length>0&&!researchAnswer&&<div className="document-list">{documents.map(doc=><div key={doc.id}><FileText size={14}/><span>{doc.company} · {doc.filename} <small>{doc.document_type} · {doc.reporting_period} · {doc.pages} pages</small>{doc.source_url&&<a href={doc.source_url} target="_blank" rel="noreferrer">Open official source ↗</a>}</span></div>)}</div>}
          </div>
          {selectedDocument&&<>
            <div className="research-subsection" hidden={researchTab!=='financials'}><div className="section-heading"><div><h3>Quarterly financial comparisons</h3><p>Four consecutive quarters of cited consolidated results. Revenue is RIL-reported gross revenue; EBITDA, PBT, and PAT use the same consolidated-results table series.</p></div></div>
              <form className="financial-entry" onSubmit={saveQuarterlyFigures}><label>Fiscal quarter<input name="period" required pattern="FY20[0-9]{2}-Q[1-4]" placeholder="FY2026-Q2" title="Format: FY2026-Q2"/></label><label>Units<select name="unit"><option>₹ crore</option><option>₹ lakh</option><option>₹</option></select></label><label>Source page<input name="page" type="number" min="1" max={selectedDocument.pages} required placeholder="12"/></label><label>Revenue<input name="revenue" type="number" step="any" placeholder="As filed"/></label><label>EBITDA<input name="ebitda" type="number" step="any" placeholder="As filed"/></label><label>PBT<input name="pbt" type="number" step="any" placeholder="As filed"/></label><label>PAT<input name="pat" type="number" step="any" placeholder="As filed"/></label><label>O2C EBITDA<input name="o2c_ebitda" type="number" step="any" placeholder="Optional segment value"/></label><label className="financial-excerpt">Supporting passage<input name="excerpt" required minLength={10} maxLength={1200} placeholder="Copy the relevant financial-results statement/table text"/></label><button type="submit">Save cited figures</button></form>
              {financialMessage&&<p className="workflow-message">{financialMessage}</p>}
              {financialPeriods.slice(0,4).map((period,index)=><details className="financial-period" key={period.period} open={index===0}><summary>{period.period}<small>QoQ and YoY calculated from saved source figures</small></summary><div className="financial-table"><div className="financial-row financial-header"><span>Metric</span><span>Reported</span><span>QoQ</span><span>YoY</span><span>Evidence</span></div>{Object.entries(period.metrics).map(([metric,data])=><div className="financial-row" key={metric}><b>{metric==='revenue'?'GROSS REVENUE':metric.toUpperCase()}</b><span>{data.value.toLocaleString('en-IN')} {data.unit}</span><span>{changeValue(data.qoq)}<small>{changeNote(data.qoq,data.unit)}</small></span><span>{changeValue(data.yoy)}<small>{changeNote(data.yoy,data.unit)}</small></span><details><summary>{data.source.filename} · p.{data.source.page}</summary>{data.source.source_url&&<a href={`${data.source.source_url}#page=${data.source.page}`} target="_blank" rel="noreferrer">Open cited page ↗</a>}<blockquote>{data.source.excerpt}</blockquote></details></div>)}</div></details>)}
              {financialPeriods.length===0&&<div className="state-card">No reported quarters saved for {selectedDocument.ticker}. Add figures from a quarterly-results filing to calculate comparisons.</div>}
            </div>

            <div className="research-subsection" hidden={researchTab!=='commitments'}><div className="section-heading"><div><h3>Management promise vs reality</h3><p>Log explicit guidance with its source passage, then compare it with the matching reported period.</p></div></div>
              <form className="promise-entry" onSubmit={savePromise}><label>Guidance metric<select name="metric"><option value="revenue_growth_yoy">Revenue growth YoY</option><option value="revenue">Revenue</option><option value="ebitda">EBITDA</option><option value="ebitda_margin">EBITDA margin</option><option value="pbt">PBT</option><option value="pbt_margin">PBT margin</option><option value="pat">PAT</option><option value="pat_margin">PAT margin</option><option value="annualized_o2c_ebitda">O2C EBITDA, annualized from H1</option></select></label><label>Target quarter<input name="target_period" required pattern="FY20[0-9]{2}-Q[1-4]" placeholder="FY2027-Q1"/></label><label>Guidance value<input name="target_value" type="number" step="any" required placeholder="15"/></label><label>Unit<input name="unit" required placeholder="% or ₹ crore"/></label><label>Guidance page<input name="page" type="number" min="1" max={selectedDocument.pages} required placeholder="34"/></label><label className="promise-quote">Management’s exact guidance<input name="quote" required minLength={10} maxLength={1200} placeholder="Transcribe the commitment from the selected source"/></label><button type="submit">Track commitment</button></form>
              {promiseMessage&&<p className="workflow-message">{promiseMessage}</p>}
              {promiseRows.length>0?<div className="promise-list">{promiseRows.map(item=><article className="promise-card" key={item.id}><div className="promise-card-head"><b>{labelCategory(item.metric)} · {item.target_period}</b><span className={`promise-status ${item.status}`}>{item.status.replaceAll('_',' ')}</span></div><p>Guidance: {item.target_value.toLocaleString('en-IN')} {item.unit} <span>·</span> Actual: {item.status==='unit_mismatch'?'Unit mismatch — check the guidance unit':item.actual_value===null?'Awaiting reported figures':`${item.actual_value.toLocaleString('en-IN')} ${item.actual_unit ?? item.unit}`}</p>{item.deviation!==null&&<p>Difference: {item.deviation>0?'+':''}{item.deviation.toFixed(2)} {item.actual_unit ?? item.unit}</p>}<blockquote>“{item.quote}”</blockquote>{item.metric==='annualized_o2c_ebitda'&&<p>Actual is calculated as 2 × (Q1 plus Q2 O2C EBITDA), annualizing the reported first half.</p>}<small>Guidance source: {item.source.filename} · p.{item.source.page} {item.source.source_url&&<a href={`${item.source.source_url}#page=${item.source.page}`} target="_blank" rel="noreferrer">Open page ↗</a>}{item.actual_sources.map((source,index)=><span key={`${source.filename}-${index}`}> · Actual: {source.filename} p.{source.page} {source.source_url&&<a href={`${source.source_url}#page=${source.page}`} target="_blank" rel="noreferrer">Open page ↗</a>}</span>)}</small></article>)}</div>:<div className="state-card">No management commitments logged yet. Add an explicit target and source passage above. Actual status stays pending until you enter that quarter’s financials.</div>}
            </div>

            <div className="research-subsection" hidden={researchTab!=='analysis'}><div className="section-heading"><div><h3>Bull vs bear</h3><p>Build a balanced view from the uploaded annual reports, results, and concall transcripts.</p></div><button className="link-button" onClick={()=>void buildBullBear()} disabled={bullBearBusy}>{bullBearBusy?'Retrieving evidence…':'Build analysis'} <ArrowRight size={14}/></button></div>
              {!aiEnabled&&<p className="workflow-message">Local analysis is active without a model. For generated synthesis, FINN supports an optional local Ollama model or a hosted provider.</p>}
              {bullBear&&<div className="research-answer"><div className="answer-heading"><Sparkles size={16}/><b>{bullBear.mode==='ai_grounded'?'AI bull vs bear analysis':bullBear.mode==='local_analysis'?'Local bull vs bear analysis':'Evidence for bull and bear review'}</b></div><p>{bullBear.answer}</p>{bullBear.sources.map(source=><details className="source-citation" key={source.id} open><summary>[{source.id}] {source.filename} · {source.document_type} · {source.reporting_period} · p. {source.page}</summary><blockquote>{source.excerpt}</blockquote></details>)}</div>}
            </div>
          </>}
          {!selectedDocument&&researchTab!=='ask'&&<div className="state-card research-empty"><b>Add a source document to continue</b><p>Upload an annual report, quarterly result, or concall transcript in Ask FINN. The financial comparison, commitment tracker, and bull vs bear review will appear here after indexing.</p><button className="link-button" onClick={()=>setResearchTab('ask')}>Go to Ask FINN <ArrowRight size={14}/></button></div>}
        </section>
      </>}

      {active==='Portfolio'&&<>
        <div className="eyebrow"><span>PORTFOLIO WORKSPACE</span><i/> HOLDINGS & WATCHLIST</div>
        <section className="greeting page-greeting"><div><h1>Portfolio</h1><p>Track positions, check available market prices, and manage the company watchlist.</p></div></section>
        <div className="page-tabs" role="tablist" aria-label="Portfolio views">
          <button role="tab" aria-selected={portfolioTab==='holdings'} className={portfolioTab==='holdings'?'active':''} onClick={()=>selectSubview(setPortfolioTab,'holdings')}>Holdings</button>
          <button role="tab" aria-selected={portfolioTab==='watchlist'} className={portfolioTab==='watchlist'?'active':''} onClick={()=>selectSubview(setPortfolioTab,'watchlist')}>Watchlist <span>{portfolio?.companies.length ?? 20}</span></button>
        </div>
        <section id="portfolio" className="portfolio-preview anchor-section">
          <div hidden={portfolioTab!=='holdings'}>
          <div className="section-heading"><div><h2>Holdings</h2><p>{heldCompanies.length} positions · {pricedHoldings.length} with current market prices</p></div><div className="section-tools">{heldCompanies.length < 15&&<button className="link-button" disabled={!portfolio} onClick={addDemoPositions}>Add demo positions to reach 15</button>}<span className="market-source">{portfolio?.source ?? 'Source pending'}</span></div></div>
          {heldCompanies.length === 0 ? <div className="state-card holdings-empty"><BriefcaseBusiness size={22}/><div><b>Your holdings start here</b><p>Add your positions, or load a clearly labelled synthetic portfolio for the demo.</p></div></div> : <>
            <div className="holdings-summary"><article><small>Invested cost</small><b>{money(investedCapital)}</b></article><article><small>Market value{pricedHoldings.length < heldCompanies.length ? ' · partial' : ''}</small><b>{money(marketValue)}</b></article><article><small>Today’s P&amp;L</small><b className={todayPnl < 0 ? 'loss-value' : 'gain-value'}>{money(todayPnl)}</b></article><article><small>Unrealized P&amp;L{pricedHoldings.length < heldCompanies.length ? ' · partial' : ''}</small><b className={unrealizedPnl < 0 ? 'loss-value' : 'gain-value'}>{money(unrealizedPnl)}</b></article></div>
            <div className="positions-table"><div className="position-row position-header"><span>Company</span><span>Shares</span><span>Avg. cost</span><span>Last price</span><span>Market value</span><span>Today</span><span>Unrealized</span><span></span></div>
              {heldCompanies.map(company => {
                const position = holdings[company.ticker]
                const currentValue = company.market_status === 'available' && company.price !== undefined ? position.shares * company.price : null
                const dayPerShare = company.price !== undefined && company.change_pct !== null && company.change_pct !== undefined && company.change_pct > -100 ? company.price - company.price / (1 + company.change_pct / 100) : null
                const dayValue = dayPerShare === null ? null : dayPerShare * position.shares
                const unrealized = currentValue === null ? null : currentValue - position.shares * position.average_cost
                return <div className="position-row" key={company.ticker}><span className="position-company"><b>{company.name}</b><small>{company.ticker} · {company.sector}{position.demo&&<strong style={{color:'#9a6b16',marginLeft:5}}>DEMO DATA</strong>}</small></span><span>{position.shares.toLocaleString('en-IN')}</span><span>{money(position.average_cost)}</span><span>{company.market_status === 'available' ? money(company.price) : 'Unavailable'}</span><b>{money(currentValue)}</b><b className={dayValue === null ? '' : dayValue < 0 ? 'loss-value' : 'gain-value'}>{money(dayValue)}</b><b className={unrealized === null ? '' : unrealized < 0 ? 'loss-value' : 'gain-value'}>{money(unrealized)}</b><span className="position-actions"><button onClick={()=>openHoldingEditor(company)}>Edit</button><button onClick={()=>removeHolding(company.ticker)} aria-label={`Remove ${company.name}`}>Remove</button></span></div>
              })}
            </div>
            <p className="holdings-note">{pricedHoldings.length < heldCompanies.length ? 'Totals exclude positions without a current price. ' : ''}{heldCompanies.some(company=>holdings[company.ticker]?.demo)?'DEMO DATA positions are synthetic examples, not actual holdings. Edit a row to replace its sample values. ':''}Positions are saved in this browser only; average cost is the value you enter.</p>
          </>}
          </div>
          <div hidden={portfolioTab!=='watchlist'}>
          <div className="section-heading watchlist-heading"><div><h2>Watchlist</h2><p>Choose a company to add or update a holding</p></div><span className="market-source">{filteredCompanies.length} companies tracked</span></div>
          <label className="portfolio-search"><Search size={16}/><input aria-label="Search portfolio" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search company, ticker, or sector"/></label>
          {loading&&!portfolio?<div className="state-card">Loading companies…</div>:<div className="watchlist-table"><div className="watchlist-row watchlist-header"><span>Company</span><span>Last price</span><span>Daily move</span><span>Volume vs 20-session avg.</span><span>Holding</span></div>{filteredCompanies.map(company=>{const position=holdings[company.ticker];return <div className="watchlist-row" key={company.ticker}><span className="position-company"><b>{company.name}</b><small>{company.ticker} · {company.sector}</small></span><b>{company.market_status==='available'?money(company.price):'Unavailable'}</b><b className={company.change_pct!==null&&company.change_pct!==undefined?(company.change_pct<0?'loss-value':'gain-value'):''}>{company.change_pct!==null&&company.change_pct!==undefined?`${company.change_pct>0?'+':''}${company.change_pct.toFixed(2)}%`:'—'}</b><span>{company.volume_ratio_20d!==null&&company.volume_ratio_20d!==undefined?`${company.volume_ratio_20d.toFixed(2)}×`:'—'}</span><button className="holding-action" onClick={()=>openHoldingEditor(company)}>{position?`${position.shares.toLocaleString('en-IN')} shares · Edit`:'Add holding'}</button></div>})}</div>}
          {!loading&&filteredCompanies.length===0&&<div className="state-card">No tracked company matches “{query}”.</div>}
          </div>
        </section>
        {holdingEditor&&<div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setHoldingEditor(null)}}><form className="holding-modal" onSubmit={saveHolding}><button className="modal-close" type="button" onClick={()=>setHoldingEditor(null)} aria-label="Close">×</button><span className="eyebrow-mini">PORTFOLIO POSITION</span><h2>{holdingEditor.name}</h2><p>Enter your actual holding details. FINN uses these values only to calculate your portfolio view.</p><label>Shares owned<input type="number" min="0.0001" step="any" required value={holdingShares} onChange={event=>setHoldingShares(event.target.value)} placeholder="e.g. 10"/></label><label>Average buy price per share (₹)<input type="number" min="0.01" step="any" required value={holdingAverageCost} onChange={event=>setHoldingAverageCost(event.target.value)} placeholder="e.g. 2450"/></label><div className="modal-actions"><button type="button" className="cancel-button" onClick={()=>setHoldingEditor(null)}>Cancel</button><button type="submit" className="save-button">Save holding</button></div></form></div>}
      </>}
      </div>
        <footer className="disclaimer">{portfolio?.notice ?? 'Portfolio universe for product demonstration only; not an investment recommendation.'}<span>Market data may be delayed. Research answers cite uploaded primary sources.</span></footer>
      </div>
      <nav className="mobile-nav" aria-label="Main navigation">{nav.map(({label,icon:Icon,target})=><button key={label} aria-current={active===label?'page':undefined} className={active===label?'mobile-active':''} onClick={()=>navigate(label,target)}><Icon size={19}/><span>{label}</span></button>)}</nav>
    </main>
  </div>
}
export default App
