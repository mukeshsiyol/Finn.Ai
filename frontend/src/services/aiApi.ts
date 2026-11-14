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
  page: number
  excerpt: string
  relevance?: number
}

export type CitationFailure = {
  type: 'missing_source' | 'page_mapping' | 'unsupported_claim'
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
