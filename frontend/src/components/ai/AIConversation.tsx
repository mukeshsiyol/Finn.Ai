import { Sparkles } from 'lucide-react'
import type { ResearchQuerySource } from '../../services/aiApi'

export type AIConversationExchange = {
  id: string
  question: string
  pending: boolean
  error?: string
  response?: {
    answer: string
    mode: string
    sources: ResearchQuerySource[]
    verification?: { status: string; failures: { type: string; citation_id?: string; page?: number; expected_page?: number; claim?: string; reason: string }[]; note: string }
  }
}

type Props = {
  exchanges: AIConversationExchange[]
  citationHref: (source: ResearchQuerySource) => string
}

const modeLabel = (mode: string) => mode === 'ai_grounded'
  ? 'FINN model-assisted research'
  : mode === 'extractive_local'
    ? 'FINN extractive answer · not model-generated'
    : mode === 'evidence_only'
      ? 'Retrieved evidence · synthesis withheld'
      : mode === 'no_matching_evidence'
        ? 'No matching source passage'
        : 'FINN source evidence'

const failureLabel = (type: string) => type === 'missing_source'
  ? 'Missing source'
  : type === 'page_mapping'
    ? 'Page mapping mismatch'
    : 'Unsupported or uncited claim'

export function AIConversation({ exchanges, citationHref }: Props) {
  if (!exchanges.length) return <div className="ai-conversation-empty">Answers appear here with their source pages. This conversation is held in memory for this session only and is not saved.</div>

  return <div className="ai-conversation" id="ai-conversation" aria-live="polite" aria-relevant="additions text">
    {exchanges.map(exchange => <article className="ai-exchange" key={exchange.id}>
      <div className="ai-user-message"><span>You</span><p>{exchange.question}</p></div>
      <section className="ai-assistant-message" aria-label="FINN response">
        <div className="answer-heading"><Sparkles size={16}/><b>{exchange.pending ? 'FINN is checking the indexed sources…' : exchange.response ? modeLabel(exchange.response.mode) : 'FINN could not answer'}</b></div>
        {exchange.pending && <p className="ai-pending-message" role="status">Searching the selected source and preparing citations.</p>}
        {exchange.error && <p className="ai-error-message" role="alert">{exchange.error}</p>}
        {exchange.response && <>
          {exchange.response.verification?.failures?.length ? <div className="citation-diagnostics" role="alert">
            <b>Citation verification needs review</b>
            <ul>{exchange.response.verification.failures.map((failure, index) => <li key={`${failure.type}-${failure.citation_id ?? index}`}>
              <strong>{failureLabel(failure.type)}</strong>
              {failure.citation_id && <span> · [{failure.citation_id}]</span>}
              {failure.page && <span> · page {failure.page}{failure.expected_page ? ` (expected ${failure.expected_page})` : ''}</span>}
              <p>{failure.reason}</p>
              {failure.claim && <blockquote>{failure.claim}</blockquote>}
            </li>)}</ul>
            {exchange.response.verification.note && <small>{exchange.response.verification.note}</small>}
          </div> : null}
          <p className="ai-answer-text">{exchange.response.answer}</p>
          <small className="ai-answer-note">Review the cited source page for context. FINN does not save this conversation.</small>
          {exchange.response.sources.map(source => <details className="source-citation" key={`${exchange.id}-${source.id}`}>
            <summary>[{source.id}] {source.filename} · {source.document_type} · {source.reporting_period} · p. {source.page}</summary>
            {citationHref(source) && <a href={citationHref(source)} target="_blank" rel="noreferrer">Open exact source page ↗</a>}
            <blockquote>{source.excerpt}</blockquote>
          </details>)}
        </>}
      </section>
    </article>)}
  </div>
}
