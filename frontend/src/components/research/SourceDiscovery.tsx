import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowDownToLine, ArrowRight, ExternalLink, FileSearch, RefreshCw, RotateCw, Search, ShieldCheck } from 'lucide-react'
import { discoverResearchDocuments, getResearchImport, getResearchImports, retryResearchImport, startResearchDocumentImport, type DiscoveryCandidate, type DiscoveryResponse, type DocumentImportJob } from '../../services/aiApi'

const types: { value: DiscoveryCandidate['document_type'] | ''; label: string }[] = [
  { value: '', label: 'All document types' },
  { value: 'annual_report', label: 'Annual reports' },
  { value: 'quarterly_results', label: 'Quarterly results' },
  { value: 'earnings_call_transcript', label: 'Earnings-call transcripts' },
  { value: 'investor_presentation', label: 'Investor presentations' },
  { value: 'other', label: 'Other filings' },
]
const activeStates = new Set(['pending', 'downloading', 'validating', 'extracting', 'indexing'])
const label = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase())

type Props = { onIndexed: (documentId: string) => void; initialCompany?: string }

export function SourceDiscovery({ onIndexed, initialCompany = '' }: Props) {
  const [company, setCompany] = useState(initialCompany)
  const [documentType, setDocumentType] = useState<DiscoveryCandidate['document_type'] | ''>('')
  const [period, setPeriod] = useState('')
  const [response, setResponse] = useState<DiscoveryResponse | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [jobs, setJobs] = useState<DocumentImportJob[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const indexedRef = useRef(new Set<string>())
  const seenActiveRef = useRef(new Set<string>())

  async function refreshJobs() {
    try {
      const rows = await getResearchImports(response?.issuer.issuer_id)
      setJobs(rows)
      for (const row of rows) {
        if (activeStates.has(row.status)) seenActiveRef.current.add(row.import_id)
        if (row.status === 'ready' && row.document_id && seenActiveRef.current.has(row.import_id) && !indexedRef.current.has(row.import_id)) {
          indexedRef.current.add(row.import_id)
          seenActiveRef.current.delete(row.import_id)
          onIndexed(row.document_id)
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Import history is unavailable.')
    }
  }

  useEffect(() => { void refreshJobs() }, [])
  useEffect(() => { if (initialCompany.trim()) setCompany(initialCompany) }, [initialCompany])
  const polling = jobs.some(job => activeStates.has(job.status))
  useEffect(() => {
    if (!polling) return
    const timer = window.setInterval(() => { void refreshJobs() }, 1800)
    return () => window.clearInterval(timer)
  }, [polling, response?.issuer.issuer_id])

  const importByCandidate = useMemo(() => new Map(jobs.map(job => [job.candidate_id, job])), [jobs])

  async function search(event: FormEvent) {
    event.preventDefault()
    if (!company.trim()) return
    setLoading(true); setError(''); setNotice(''); setSelectedId(''); setResponse(null)
    try {
      const result = await discoverResearchDocuments(company, { document_type: documentType || undefined, reporting_period: period || undefined })
      setResponse(result)
      setNotice(result.candidates.length ? `${result.candidates.length} candidate${result.candidates.length === 1 ? '' : 's'} returned by the available official sources.` : 'No matching documents were returned by the available sources.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Public-source discovery failed. Try again.')
    } finally { setLoading(false) }
  }

  async function importSelected(candidate: DiscoveryCandidate) {
    if (!response) return
    setLoading(true); setError(''); setNotice('')
    try {
      const job = await startResearchDocumentImport(response.issuer.canonical_name, candidate.candidate_id)
      if (activeStates.has(job.status)) seenActiveRef.current.add(job.import_id)
      setJobs(current => [job, ...current.filter(item => item.import_id !== job.import_id)])
      setNotice(job.status === 'ready' ? 'This document is already indexed in FINN Research.' : 'Import started. You can keep working while FINN validates and indexes the PDF.')
      if (job.status === 'ready' && job.document_id) onIndexed(job.document_id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'FINN could not start this import.')
    } finally { setLoading(false) }
  }

  async function retry(job: DocumentImportJob) {
    setError(''); setNotice('')
    try {
      const updated = await retryResearchImport(job.import_id)
      setJobs(current => current.map(item => item.import_id === updated.import_id ? updated : item))
      setNotice('Retry started. FINN will preserve the previous attempt details.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'This import could not be retried.')
    }
  }

  const chosen = response?.candidates.find(candidate => candidate.candidate_id === selectedId)

  return <section className="source-discovery" aria-labelledby="source-discovery-title">
    <div className="source-discovery-intro">
      <div className="source-discovery-icon"><FileSearch size={19}/></div>
      <div><span className="eyebrow-mini">OFFICIAL PUBLIC SOURCES</span><h3 id="source-discovery-title">Find company documents</h3><p>Search the issuer registry, then import only a document you explicitly select.</p></div>
    </div>
    <form className="source-discovery-form" onSubmit={search}>
      <label className="discovery-company"><span>Company or verified ticker</span><span className="search-field"><Search size={15}/><input value={company} onChange={event => setCompany(event.target.value)} maxLength={160} required placeholder="e.g. Reliance Industries or RELIANCE.NS"/></span></label>
      <label><span>Document type</span><select value={documentType} onChange={event => setDocumentType(event.target.value as typeof documentType)}>{types.map(item => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}</select></label>
      <label><span>Reporting period <small>optional</small></span><input value={period} onChange={event => setPeriod(event.target.value)} maxLength={120} placeholder="FY2025-26 or Q2 FY2026"/></label>
      <button type="submit" className="primary-button" disabled={loading || !company.trim()}>{loading ? <RefreshCw size={15} className="spin"/> : <Search size={15}/>}<span>{loading ? 'Checking sources' : 'Search sources'}</span></button>
    </form>
    {error && <div className="state-card error-state" role="alert">{error}</div>}
    {notice && <p className="source-discovery-notice" role="status">{notice}</p>}
    {response && <>
      <div className="issuer-resolution"><div><ShieldCheck size={16}/><span><b>{response.issuer.canonical_name}</b><small>{response.issuer.issuer_id} · resolved from FINN's issuer registry</small></span></div><span>{new Date(response.discovered_at).toLocaleString('en-IN')}</span></div>
      {response.warnings.length > 0 && <div className="provider-warnings" role="status"><b>Some sources were unavailable</b>{response.warnings.map((warning, index) => <span key={`${warning}-${index}`}>{warning}</span>)}</div>}
      <div className="provider-status-list" aria-label="Source provider results">{response.providers.map((provider, index) => <span className={`provider-status provider-${provider.status}`} key={`${provider.provider_id}-${provider.document_type}-${index}`}><i/>{provider.provider_id.toUpperCase()} · {label(provider.document_type)} · {label(provider.status)}</span>)}</div>
      {response.candidates.length > 0 && <div className="discovery-candidate-list">{response.candidates.map(candidate => {
        const job = importByCandidate.get(candidate.candidate_id)
        const selected = selectedId === candidate.candidate_id
        const reportPeriod = candidate.reporting_period?.normalized_label ?? 'Period not specified'
        return <article className={`discovery-candidate ${selected ? 'candidate-selected' : ''}`} key={candidate.candidate_id}>
          <button type="button" className="candidate-select" onClick={() => setSelectedId(selected ? '' : candidate.candidate_id)} aria-expanded={selected}>
            <span className="candidate-document-icon"><ArrowDownToLine size={16}/></span>
            <span className="candidate-copy"><b>{candidate.title}</b><small>{label(candidate.document_type)} · {reportPeriod}{candidate.publication_date ? ` · Published ${new Date(candidate.publication_date).toLocaleDateString('en-IN')}` : ''}</small><small>{candidate.source_provider.toUpperCase()} · {candidate.source_host}{candidate.revision_label ? ` · ${candidate.revision_label}` : ''}</small></span>
            <span className={`verification-label ${candidate.verification_status}`}>{candidate.verification_status}</span>
            <ArrowRight size={16} className="candidate-chevron"/>
          </button>
          {selected && <div className="candidate-details"><p>{candidate.document_url ? candidate.verification_status === 'verified' ? 'A verified direct PDF attachment is available for explicit import.' : 'A direct attachment is listed, but its source is not verified for secure import.' : 'This filing has a source listing but no direct PDF attachment, so FINN cannot import it automatically.'}</p><div className="candidate-links"><a href={candidate.source_page_url} target="_blank" rel="noreferrer">Open official listing <ExternalLink size={13}/></a>{candidate.document_url && <a href={candidate.document_url} target="_blank" rel="noreferrer">Review PDF <ExternalLink size={13}/></a>}</div>{candidate.document_url && candidate.verification_status === 'verified' && <button type="button" className="primary-button" disabled={loading || Boolean(job && activeStates.has(job.status))} onClick={() => void importSelected(candidate)}>{job?.status === 'ready' ? 'Already indexed' : job && activeStates.has(job.status) ? `${label(job.status)}…` : 'Import selected document'}<ArrowRight size={15}/></button>}</div>}
        </article>
      })}</div>}
    </>}
    <section className="import-history" aria-labelledby="import-history-title"><div className="import-history-heading"><div><h4 id="import-history-title">Recent imports</h4><p>Import runs and their current indexing state.</p></div><button type="button" aria-label="Refresh import status" onClick={() => void refreshJobs()}><RefreshCw size={14}/></button></div>{jobs.length ? <div className="import-job-list">{jobs.slice(0, 8).map(job => <article className={`import-job import-${job.status}`} key={job.import_id}><div className="import-job-heading"><span><b>{job.company}</b><small>{label(job.document_type)} · {job.reporting_period || 'Period unavailable'}</small></span><span className={`import-state ${job.status}`}>{label(job.status)}</span></div><div className="import-progress" aria-label={`Import ${job.progress}% complete`}><i style={{ width: `${job.progress}%` }}/></div>{job.status === 'failed' && <p className="import-failure" role="status">{job.failure_reason || 'Import failed.'}</p>}{job.extraction_summary?.limitations?.map((item, index) => <p className="import-limitation" key={`${item}-${index}`}>{item}</p>)}<div className="import-job-footer"><small>Updated {new Date(job.updated_at).toLocaleString('en-IN')}</small>{job.status === 'failed' && job.retryable && <button type="button" onClick={() => void retry(job)}><RotateCw size={13}/> Retry</button>}{job.status === 'ready' && job.document_id && <button type="button" onClick={() => onIndexed(job.document_id!)}>Open in Research <ArrowRight size={13}/></button>}</div></article>)}</div> : <div className="state-card">No document imports yet. Search for a company above to see official-source candidates.</div>}</section>
  </section>
}
