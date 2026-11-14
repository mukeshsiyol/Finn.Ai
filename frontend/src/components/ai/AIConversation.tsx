import type { ReactNode } from 'react'
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
    document?: { company: string; ticker: string; filename: string }
    verification?: { status: string; failures: { type: string; citation_id?: string; page?: number; expected_page?: number; claim?: string; reason: string }[]; note: string }
  }
}

type Props = { exchanges: AIConversationExchange[]; citationHref: (source: ResearchQuerySource) => string }

const modeLabel = (mode: string) => mode === 'ai_grounded' ? 'FINN model-assisted research' : mode === 'extractive_local' ? 'FINN extractive answer · not model-generated' : mode === 'evidence_only' ? 'Retrieved evidence · synthesis withheld' : mode === 'no_matching_evidence' ? 'No matching source passage' : 'FINN source evidence'
const failureLabel = (type: string) => type === 'missing_source' ? 'Missing source' : type === 'page_mapping' ? 'Page mapping mismatch' : 'Unsupported or uncited claim'

function InlineMarkdown({ text, sources, citationHref }: { text: string; sources: ResearchQuerySource[]; citationHref: Props['citationHref'] }): ReactNode[] {
  const tokens = /\*\*([^*]+)\*\*|`([^`]+)`|\[([A-Z][A-Z0-9_-]{0,15})\]/g
  const output: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = tokens.exec(text))) {
    if (match.index > cursor) output.push(text.slice(cursor, match.index))
    if (match[1]) output.push(<strong key={`b-${match.index}`}>{match[1]}</strong>)
    else if (match[2]) output.push(<code key={`c-${match.index}`}>{match[2]}</code>)
    else {
      const source = sources.find(item => item.id === match![3])
      const href = source ? citationHref(source) : ''
      output.push(href ? <a className="ai-inline-citation" key={`s-${match.index}`} href={href} target="_blank" rel="noreferrer" aria-label={`Open verified source ${match[3]}, page ${source!.page}`}>[{match[3]}]</a> : <span className="ai-citation-unverified" key={`u-${match.index}`} title="No matching verified source was returned">[{match[3]}]</span>)
    }
    cursor = tokens.lastIndex
  }
  if (cursor < text.length) output.push(text.slice(cursor))
  return output
}

function MarkdownAnswer({ answer, sources, citationHref }: { answer: string; sources: ResearchQuerySource[]; citationHref: Props['citationHref'] }) {
  const lines = answer.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  const inline = (value: string) => <InlineMarkdown text={value} sources={sources} citationHref={citationHref}/>
  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) { index++; continue }
    const tableRow = (value: string) => value.startsWith('|') && value.endsWith('|')
    if (tableRow(line) && index + 1 < lines.length && /^\|?\s*:?-{3,}/.test(lines[index + 1].trim())) {
      const cells = (value: string) => value.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
      const headers = cells(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length && tableRow(lines[index].trim())) rows.push(cells(lines[index++]))
      blocks.push(<div className="ai-markdown-table-wrap" key={`table-${index}`}><table className="ai-markdown-table"><thead><tr>{headers.map((cell, col) => <th key={col}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, col) => <td key={col}>{inline(row[col] ?? '')}</td>)}</tr>)}</tbody></table></div>)
      continue
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      const Tag = `h${heading[1].length + 2}` as 'h3' | 'h4' | 'h5'
      blocks.push(<Tag className="ai-markdown-heading" key={`h-${index}`}>{inline(heading[2])}</Tag>); index++; continue
    }
    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*[-*+]\s+/, ''))
      blocks.push(<ul key={`ul-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</ul>); continue
    }
    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*\d+[.)]\s+/, ''))
      blocks.push(<ol key={`ol-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</ol>); continue
    }
    if (line.startsWith('> ')) {
      const quote: string[] = []
      while (index < lines.length && lines[index].trim().startsWith('>')) quote.push(lines[index++].trim().replace(/^>\s?/, ''))
      blocks.push(<blockquote className="ai-markdown-quote" key={`q-${index}`}>{quote.map((part, partIndex) => <p key={partIndex}>{inline(part)}</p>)}</blockquote>); continue
    }
    const paragraph = [line]; index++
    while (index < lines.length && lines[index].trim() && !/^(#{1,3}\s|[-*+]\s|\d+[.)]\s|>\s)/.test(lines[index].trim()) && !(tableRow(lines[index].trim()) && index + 1 < lines.length && /^\|?\s*:?-{3,}/.test(lines[index + 1].trim()))) paragraph.push(lines[index++].trim())
    blocks.push(<p key={`p-${index}`}>{inline(paragraph.join(' '))}</p>)
  }
  return <div className="ai-answer-text">{blocks}</div>
}

export function AIConversation({ exchanges, citationHref }: Props) {
  return <section className="ai-transcript" aria-label="FINN AI session transcript">
    <p className="ai-transcript-note">Session transcript · each question is answered independently; earlier messages are not sent to FINN. This transcript is not saved.</p>
    {!exchanges.length ? <div className="ai-conversation-empty">Answers and verified source pages will appear here after you submit a question.</div> : <div className="ai-conversation" id="ai-conversation" aria-live="polite" aria-relevant="additions text">
      {exchanges.map(exchange => <article className="ai-exchange" key={exchange.id}>
        <div className="ai-user-message"><span>You</span><p>{exchange.question}</p></div>
        <section className="ai-assistant-message" aria-label="FINN response">
          <div className="answer-heading"><Sparkles size={16}/><b>{exchange.pending ? 'FINN is checking the indexed sources…' : exchange.response ? modeLabel(exchange.response.mode) : 'FINN could not answer'}</b></div>
          {exchange.pending && <p className="ai-pending-message" role="status">Searching the selected source and preparing citations.</p>}
          {exchange.error && <p className="ai-error-message" role="alert">{exchange.error}</p>}
          {exchange.response && <>
            {exchange.response.verification?.failures?.length ? <div className="citation-diagnostics" role="alert"><b>Citation verification needs review</b><ul>{exchange.response.verification.failures.map((failure, failureIndex) => <li key={`${failure.type}-${failure.citation_id ?? failureIndex}`}><strong>{failureLabel(failure.type)}</strong>{failure.citation_id && <span> · [{failure.citation_id}]</span>}{failure.page && <span> · page {failure.page}{failure.expected_page ? ` (expected ${failure.expected_page})` : ''}</span>}<p>{failure.reason}</p>{failure.claim && <blockquote>{failure.claim}</blockquote>}</li>)}</ul>{exchange.response.verification.note && <small>{exchange.response.verification.note}</small>}</div> : null}
            <MarkdownAnswer answer={exchange.response.answer} sources={exchange.response.sources} citationHref={citationHref}/>
            <small className="ai-answer-note">Claims should be checked against the cited source passage.</small>
            {exchange.response.sources.map(source => <details className="source-citation" key={`${exchange.id}-${source.id}`}>
              <summary><b>[{source.id}]</b> {exchange.response?.document?.company ?? 'Company source'}{exchange.response?.document?.ticker ? ` · ${exchange.response.document.ticker}` : ''} · {source.document_type} · {source.reporting_period} · p. {source.page}</summary>
              <p className="ai-source-filename">{source.filename}</p>
              {citationHref(source) && <a href={citationHref(source)} target="_blank" rel="noreferrer">Open exact source page ↗</a>}
              <blockquote>{source.excerpt}</blockquote>
            </details>)}
          </>}
        </section>
      </article>)}
    </div>}
  </section>
}
