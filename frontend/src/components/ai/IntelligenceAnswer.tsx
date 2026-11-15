import type { IntelligenceResponse } from '../../services/aiApi'

export function IntelligenceAnswer({ result }: { result: IntelligenceResponse }) {
  const failures = result.verification?.failures ?? []
  const renderInline = (line: string, key: number) => line.split(/(\*\*[^*]+\*\*|\[[A-Z][A-Z0-9_-]{0,15}\])/g).map((part, index) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={`${key}-strong-${index}`}>{part.slice(2, -2)}</strong>
    const citation = part.match(/^\[([A-Z][A-Z0-9_-]{0,15})\]$/)
    if (!citation) return part
    const id = citation[1]
    const source = result.sources.find(item => item.id === id)
    return source?.source_url ? <a className="ai-inline-citation" key={`${key}-${id}-${index}`} href={source.source_url} target="_blank" rel="noreferrer" aria-label={`Open ${source.label}`}>[{id}]</a> : source ? <span className="ai-inline-citation" key={`${key}-${id}-${index}`} title={`${source.label} · details below`}>[{id}]</span> : <span className="ai-citation-unverified" key={`${key}-${id}-${index}`}>[{id}]</span>
  })
  const renderLine = (line: string, key: number) => {
    if (line.startsWith('### ')) return <h4 key={key}>{renderInline(line.slice(4), key)}</h4>
    if (line.startsWith('- ')) return <p className="answer-bullet" key={key}><span aria-hidden="true">•</span><span className="answer-bullet-text">{renderInline(line.slice(2), key)}</span></p>
    return <p key={key}>{renderInline(line, key)}</p>
  }
  return <div className="intelligence-result">
    <div className="answer-heading"><b>{result.ai_generated?'FINN interpretation':result.mode==='evidence_only'?'Evidence and limitations':'FINN summary'}</b></div>
    <div className="intelligence-answer">{result.answer.split('\n').filter(Boolean).map(renderLine)}</div>
    {Boolean(result.facts?.length)&&<section className="intelligence-facts"><b>Facts checked</b><ul>{result.facts?.map((fact,index)=><li key={`fact-${index}`}>{fact}</li>)}</ul></section>}
    {Boolean(result.calculations?.length)&&<section className="intelligence-calculations"><b>FINN calculations</b><ul>{result.calculations?.map((item,index)=><li key={`calc-${index}`}><span>{item.name}</span><strong>{item.value ?? 'Unavailable'}{item.unit?` ${item.unit}`:''}</strong>{item.as_of_date&&<small>As of {item.as_of_date}</small>}</li>)}</ul></section>}
    {Boolean(result.interpretation)&&!result.ai_generated&&<section className="intelligence-interpretation"><b>Interpretation</b><p>{result.interpretation}</p></section>}
    {Boolean(result.uncertainties?.length)&&<section className="intelligence-uncertainties"><b>Uncertainty and coverage</b><ul>{result.uncertainties?.map((item,index)=><li key={`uncertainty-${index}`}>{item}</li>)}</ul></section>}
    {failures.length>0&&<div className="citation-diagnostics" role="alert"><b>Source checks need review</b><ul>{failures.map((failure,index)=><li key={`${failure.type}-${index}`}><strong>{failure.type.replaceAll('_',' ')}</strong>{failure.citation_id&&` · [${failure.citation_id}]`}<p>{failure.reason}</p>{failure.claim&&<blockquote>{failure.claim}</blockquote>}</li>)}</ul><small>{result.verification?.note}</small></div>}
    {result.verification?.note&&failures.length===0&&<small className="intelligence-note">{result.verification.note}</small>}
    {result.sources.length>0&&<div className="intelligence-sources"><b>Evidence</b>{result.sources.map(source=><details key={source.id}><summary>[{source.id}] {source.label}{source.source_date?` · ${source.source_date}`:''}</summary>{source.source_url&&<a href={source.source_url} target="_blank" rel="noreferrer">Open original source ↗</a>}<p>{source.excerpt}</p></details>)}</div>}
    {result.retention==='request_not_persisted'&&<small className="intelligence-note">This request was not saved by FINN. Provider processing follows the configured model service.</small>}
  </div>
}
