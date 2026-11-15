const API = import.meta.env.VITE_API_BASE_URL ?? ''

export type ResearchQueryScope =
  | { document_id: string; ticker?: never }
  | { ticker: string; document_id?: never }

export type ResearchQueryRequest = ResearchQueryScope & { question: string }

export type ResearchQuerySource = {
  id: string
  document_id?: string
  source_url?: string
  filename: string
  document_type: string
  reporting_period: string
  indexed_at?: string
  page: number
  excerpt: string
  relevance?: number
}

export type CitationFailure = {
  type: 'missing_source' | 'page_mapping' | 'source_mapping' | 'unsupported_claim'
  citation_id?: string
  page?: number
  expected_page?: number
  claim?: string
  reason: string
}

export type ResearchQueryResponse = {
  answer: string
  mode: 'ai_grounded' | 'extractive_local' | 'evidence_only' | 'no_matching_evidence' | string
  sources: ResearchQuerySource[]
  verification?: { status: string; failures: CitationFailure[]; note: string }
  cited_source_ids?: string[]
  unknown_citation_ids?: string[]
  ai_generated?: boolean
  document?: { company: string; ticker: string; filename: string }
}

export type ResearchDocumentSummary = {
  id: string
  company: string
  ticker: string
  filename: string
  document_type: string
  reporting_period: string
  pages: number
  source_url?: string
  superseded_by?: string
  replaces?: string
  version_number?: number
  indexed_at?: string
  indexing_status?: 'pending' | 'processing' | 'indexed' | 'failed'
  index_error?: string
}

export type ResearchDocumentsResponse = {
  documents: ResearchDocumentSummary[]
  ai_enabled: boolean
  ai_provider: string
}

export type DiscoveryCandidate = {
  candidate_id: string
  deduplication_key: string
  issuer_id: string
  document_type: 'annual_report' | 'quarterly_results' | 'earnings_call_transcript' | 'investor_presentation' | 'other'
  reporting_period: { raw_label: string; normalized_label: string; kind: string; fiscal_year?: string | null; quarter?: number | null } | null
  title: string
  source_page_url: string
  document_url: string | null
  publication_date: string | null
  source_provider: string
  source_host: string
  verification_status: 'verified' | 'unverified'
  revision_id?: string | null
  revision_label?: string | null
  metadata: Record<string, unknown>
}

export type DiscoveryResponse = {
  issuer: { issuer_id: string; canonical_name: string; nse_symbol?: { value: string | null; status: string }; bse_scrip_code?: { value: string | null; status: string } }
  candidates: DiscoveryCandidate[]
  providers: { provider_id: string; document_type: string; status: 'success' | 'empty' | 'timeout' | 'error'; message?: string | null; error_type?: string | null }[]
  discovered_at: string
  warnings: string[]
}

export type DocumentImportJob = {
  import_id: string
  candidate_id: string
  issuer_id: string
  company: string
  ticker?: string
  document_type: string
  reporting_period?: string | null
  status: 'pending' | 'downloading' | 'validating' | 'extracting' | 'indexing' | 'ready' | 'failed'
  stage: string
  progress: number
  document_id?: string | null
  created_at: string
  updated_at: string
  completed_at?: string | null
  retryable: boolean
  failure_category?: string | null
  failure_reason?: string | null
  extraction_summary?: { page_count?: number; text_pages?: number; chunk_count?: number; limitations?: string[] }
}

export type AnnouncementExplanationRequest = {
  company: string
  ticker: string
  subject: string
  details: string
  category: string
  importance: number
  source_url: string
}

export type ExplanationResponse = {
  explanation: string
  source_url?: string
  source_name?: string
  ai_generated: boolean
  mode: string
  notice?: string
  source_date?: string
  sources?: IntelligenceSource[]
  verification?: { status: string; failures: { type: string; citation_id?: string; claim?: string; reason: string }[]; note: string }
}

export type MarketSignalExplanation = ExplanationResponse & {
  ticker: string
  company: string
  session_date: string
  retrieved_at: string
  triggered_conditions: string[]
  facts: string[]
}

export type IntelligenceSource = { id: string; label: string; source_date?: string | null; source_url?: string; excerpt: string }
export type IntelligenceResponse = {
  answer: string
  interpretation?: string | null
  facts?: string[]
  calculations?: { name: string; value: string | number | null; unit?: string; as_of_date?: string }[]
  uncertainties?: string[]
  mode: string
  ai_generated: boolean
  sources: IntelligenceSource[]
  verification?: { status: string; failures: { type: string; citation_id?: string; claim?: string; reason: string }[]; note: string }
  coverage?: Record<string, string | number | boolean>
  retention?: 'request_not_persisted'
}

export type ResearchComparisonResponse = IntelligenceResponse & {
  tickers: string[]
  statement_basis: 'consolidated' | 'standalone'
  figure_type: 'reported' | 'adjusted'
  adjustment_note: string
  comparisons: { period: string; metrics: { metric: string; unit: string; values: { ticker: string; company: string; value: number; unit: string; source_id: string; source_page: number; filename: string }[] }[] }[]
}

export type PortfolioIntelligenceInput = {
  question?: string
  as_of_date: string
  priced_holding_count: number
  total_holding_count: number
  metrics: {
    market_value: number; daily_pnl: number; unrealized_pnl: number
    largest_sector: string | null; largest_sector_pct: number | null; top_three_sector_pct: number | null
    stock_hhi: number | null; sector_count: number; volatility_pct: number | null; max_drawdown_pct: number | null
    account_return_pct: number | null; benchmark_return_pct: number | null
  }
  holdings: { ticker: string; company: string; sector: string; weight_pct: number; daily_change_pct: number | null; session_date: string | null }[]
  correlations?: { ticker_a: string; ticker_b: string; company_a: string; company_b: string; correlation: number; observations: number; from_date: string; to_date: string }[]
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API}${path}`, init)
  } catch {
    throw new Error('FINN could not reach the research service. Check your connection and try again.')
  }

  const payload: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'detail' in payload
      ? (payload as { detail?: unknown }).detail
      : null
    throw new Error(typeof detail === 'string' ? detail : 'The research request could not be completed.')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('FINN received an invalid response from the research service. Please try again.')
  }
  return payload as T
}

export function getResearchDocuments(): Promise<ResearchDocumentsResponse> {
  return requestJson<ResearchDocumentsResponse>('/api/research/documents').then(payload => {
    if (!Array.isArray(payload.documents)) throw new Error('FINN received an invalid research document list. Refresh and try again.')
    return payload
  })
}

export async function discoverResearchDocuments(company: string, filters: { document_type?: DiscoveryCandidate['document_type']; reporting_period?: string } = {}): Promise<DiscoveryResponse> {
  const query = new URLSearchParams({ company: company.trim() })
  if (filters.document_type) query.set('document_type', filters.document_type)
  if (filters.reporting_period?.trim()) query.set('reporting_period', filters.reporting_period.trim())
  const payload = await requestJson<DiscoveryResponse>(`/api/research/discovery?${query.toString()}`)
  if (!payload.issuer || !Array.isArray(payload.candidates) || !Array.isArray(payload.providers) || !Array.isArray(payload.warnings)) {
    throw new Error('FINN received an incomplete public-source discovery response.')
  }
  return payload
}

export async function startResearchDocumentImport(company: string, candidateId: string): Promise<DocumentImportJob> {
  const payload = await requestJson<DocumentImportJob & { scheduled: boolean }>('/api/research/discovery/import', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ company: company.trim(), candidate_id: candidateId }),
  })
  if (typeof payload.import_id !== 'string' || typeof payload.status !== 'string') throw new Error('FINN received an incomplete document import status.')
  return payload
}

export async function getResearchImports(issuerId?: string): Promise<DocumentImportJob[]> {
  const query = new URLSearchParams({ limit: '50' })
  if (issuerId) query.set('issuer_id', issuerId)
  const payload = await requestJson<{ imports: DocumentImportJob[] }>(`/api/research/imports?${query.toString()}`)
  if (!Array.isArray(payload.imports)) throw new Error('FINN received an incomplete import history.')
  return payload.imports
}

export async function getResearchImport(importId: string): Promise<DocumentImportJob> {
  return requestJson<DocumentImportJob>(`/api/research/imports/${encodeURIComponent(importId)}`)
}

export async function retryResearchImport(importId: string): Promise<DocumentImportJob> {
  return requestJson<DocumentImportJob>(`/api/research/imports/${encodeURIComponent(importId)}/retry`, { method: 'POST' })
}

export function getResearchDocumentDependencies(documentId: string): Promise<{ financial_figures: number; guidance_records: number; records: { kind: string; metric: string; period: string; page?: number }[] }> {
  return requestJson<{ financial_figures: number; guidance_records: number; records: { kind: string; metric: string; period: string; page?: number }[] }>(`/api/research/documents/${encodeURIComponent(documentId)}/dependencies`).then(payload => {
    if (typeof payload.financial_figures !== 'number' || typeof payload.guidance_records !== 'number' || !Array.isArray(payload.records)) {
      throw new Error('FINN received invalid document dependency details.')
    }
    return payload
  })
}

export async function askResearchQuestion(request: ResearchQueryRequest): Promise<ResearchQueryResponse> {
  const payload = await requestJson<ResearchQueryResponse>('/api/research/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (typeof payload.answer !== 'string' || !Array.isArray(payload.sources)) {
    throw new Error('FINN received an incomplete research response. No answer or source was displayed.')
  }
  const validSources = payload.sources.every(source => source && typeof source.id === 'string'
    && typeof source.filename === 'string' && typeof source.document_type === 'string'
    && typeof source.reporting_period === 'string' && Number.isInteger(source.page) && source.page > 0
    && typeof source.excerpt === 'string')
  if (!validSources) throw new Error('FINN received invalid citation details and could not safely display this response.')
  if (payload.verification && (!Array.isArray(payload.verification.failures)
    || payload.verification.failures.some(failure => !failure || typeof failure.reason !== 'string' || typeof failure.type !== 'string'))) {
    throw new Error('FINN received invalid citation verification details and could not safely display this response.')
  }
  return payload
}

export async function explainAnnouncement(request: AnnouncementExplanationRequest): Promise<ExplanationResponse> {
  const payload = await requestJson<ExplanationResponse>('/api/announcements/explain', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (typeof payload.explanation !== 'string') throw new Error('FINN received an invalid filing explanation.')
  return payload
}

export async function explainMarketSignal(ticker: string): Promise<MarketSignalExplanation> {
  const payload = await requestJson<MarketSignalExplanation>('/api/market/explain', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ticker }),
  })
  if (typeof payload.explanation !== 'string' || !Array.isArray(payload.triggered_conditions) || typeof payload.session_date !== 'string') {
    throw new Error('FINN received an incomplete market-signal explanation.')
  }
  return payload
}

export async function requestPortfolioIntelligence(input: PortfolioIntelligenceInput): Promise<IntelligenceResponse> {
  const payload = await requestJson<IntelligenceResponse>('/api/intelligence/portfolio', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
  if (typeof payload.answer !== 'string' || !Array.isArray(payload.sources) || payload.retention !== 'request_not_persisted') throw new Error('FINN received an incomplete portfolio intelligence response.')
  return payload
}

export async function requestDailyBriefing(companies: { ticker: string; company: string; sector: string }[], windowHours = 24): Promise<IntelligenceResponse> {
  const payload = await requestJson<IntelligenceResponse>('/api/intelligence/briefing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companies, window_hours: windowHours }) })
  if (typeof payload.answer !== 'string' || !Array.isArray(payload.sources) || payload.retention !== 'request_not_persisted') throw new Error('FINN received an incomplete daily briefing response.')
  return payload
}

export async function compareResearchCompanies(input: { tickers: string[]; statement_basis: 'consolidated'|'standalone'; figure_type: 'reported'|'adjusted'; adjustment_note?: string }): Promise<ResearchComparisonResponse> {
  const payload = await requestJson<ResearchComparisonResponse>('/api/research/compare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
  if (!Array.isArray(payload.comparisons) || !Array.isArray(payload.sources) || typeof payload.answer !== 'string') throw new Error('FINN received an incomplete company comparison.')
  return payload
}
