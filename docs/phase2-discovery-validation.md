# FINN.AI Phase 2 — Public-Source Discovery Validation

**Validation date:** 15 November 2026
**Scope:** Phase 2 Steps 3–7. Discovery is read-only; it does not download or import documents.

## Architecture implemented

- The existing issuer registry remains the identity source. Discovery resolves exact company names, aliases and verified exchange identifiers through the existing resolver.
- `NSEDiscoveryProvider` reads NSE's public corporate-announcements and integrated-financial-filings JSON feeds. It keeps the NSE filing sequence ID, dates, reporting period when present, filing page, direct attachment URL, revision data, statement basis and audited status.
- `CompanyIRProvider` contains reviewed page mappings for Reliance Industries and Titan. It parses only those specific listing pages; it does not crawl arbitrary sites or follow listing links recursively. Reliance's linked `rilstaticasset.akamaized.net` document host is allowlisted because the official RIL page links directly to it.
- `BSEDiscoveryProvider` uses only the verified BSE scrip mapping and reports an explicit unsupported-access result. It does not call undocumented or subscription-only endpoints.
- `DiscoveryService` queries providers independently in a bounded sequence, retains successful candidates when other sources fail, applies document-type and exact normalized reporting-period filters, preserves revisions, deduplicates conservative exact matches, records alternate source provenance, and sorts by period/publication recency.
- The additive read-only endpoint is `GET /api/research/discovery`. Existing Research routes and response contracts remain as they were.

## Providers and document types

| Provider | Companies | Supported discovery |
| --- | --- | --- |
| NSE | Issuers with a verified NSE symbol only | Quarterly results; integrated financial filings; annual results and other relevant investor disclosures are represented with `other` plus a subtype where the shared enum has no annual-results value |
| Company IR | Reliance Industries, Titan Company | Annual reports, quarterly results, earnings-call transcripts, investor presentations |
| BSE | Verified BSE mappings only | Not queried: a permitted anonymous structured source was not confirmed; provider status reports the limitation |

Only Reliance and Titan currently have verified exchange identifiers and verified IR domains in the registry. Inherited or unresolved exchange symbols are never sent to exchange providers as if they were verified.

## API example

```http
GET /api/research/discovery?company=RELIANCE&document_type=quarterly_results&reporting_period=Q2%20FY2026-27
```

The response contains `issuer`, normalized `candidates`, per-provider and per-document-type `providers` statuses, `discovered_at`, and `warnings`. Each candidate carries its listing-page URL separately from its optional direct document URL, provider/source host, verification status, publication date when known, reporting period, revision fields, and source metadata.

An unknown issuer returns HTTP 404, an ambiguous registry match returns HTTP 409, and an invalid document-type filter returns HTTP 422. Provider errors remain visible in the response even when another source succeeds.

## Limited live smoke test

The smoke test used the application API and the current public listing pages/JSON endpoints only. It did not fetch any PDF, transcript, spreadsheet or other document body. Each of the eight issuer/type requests returned HTTP 200.

| Issuer | Type | Candidates returned | Current IR example / period |
| --- | --- | ---: | --- |
| Reliance | Annual report | 10 | Annual Report for FY2025–2026 |
| Reliance | Quarterly results | 30 | Financial performance for quarter ended 30 Sep 2026; Q2 FY2026–27 |
| Reliance | Earnings-call transcript | 9 | Q2 FY2027 transcript (source label uses the abbreviated FY2027 form) |
| Reliance | Investor presentation | 21 | Q2 FY2026–27 presentation |
| Titan | Annual report | 34 | FY2025–26 annual report |
| Titan | Quarterly results | 34 | Q2 FY27 results |
| Titan | Earnings-call transcript | 23 | Q2 transcript; source does not state a fiscal year, so FINN does not infer one |
| Titan | Investor presentation | 75 | Q2 FY27 earnings presentation |

These counts are live observations, not guaranteed totals. NSE and company sites can revise listings, throttle requests or change page structures. The source URL and reporting-period metadata remain the evidence for each candidate.

## Test results

Automated provider tests use saved local fixtures; they make no live requests.

| Test group | Result | Time |
| --- | ---: | ---: |
| Issuer registry | 9 passed | 0.05 s |
| Discovery contract/schema | 20 passed | 0.24 s |
| Providers and orchestration | 20 passed | 0.65 s |
| Discovery API | 4 passed | 1.93 s |
| Full backend suite | **72 passed** | **16.64 s** |

The full suite exited successfully on Windows. The earlier TestClient/socketpair concern did not recur; the existing TestClient tests completed. The new discovery API tests use an in-process ASGI transport and do not open local sockets. Pytest reported one existing Starlette/httpx deprecation warning.

Python compilation completed successfully. `git diff --check` completed without whitespace errors; Git printed only existing LF-to-CRLF working-copy notices.

## Security and preservation checks

- External requests require HTTPS, an approved source host and public DNS addresses. Redirects are checked again before following them; private/internal destinations and nonstandard ports are rejected.
- Responses are limited to HTML/JSON/text, bounded in size, and use short timeouts with one bounded retry for timeouts/server errors. HTTP 429 is not retried.
- Direct document links are HTTPS and source-host allowlisted. Discovery does not request their content.
- No credentials or API keys were added.
- No document was downloaded, written, extracted, indexed or imported.
- `portfolio.json`, issuer-registry data, existing Research document records/PDFs, financial/commitment data, upload behavior, Phase 1 extraction/retrieval, announcements, alerts and frontend files were not changed for this work. The only existing application-file integration is an additive router include in `backend/app/main.py`.
- Existing Research and announcement/intelligence tests pass in the full backend suite.

## Limitations and remaining work

1. **BSE structured discovery is intentionally unavailable.** The public announcement UI is an interactive page, while BSE describes structured market-data products through separately offered/subscription products. FINN has not established an authorized anonymous structured feed. The API reports this as a provider error rather than pretending BSE returned no filings. No CAPTCHA, access control, authentication or paywall is bypassed.
2. **IR support is company-specific.** Only Reliance and Titan have reviewed adapters. Other issuers report missing/unverified source configuration rather than being crawled generically.
3. **Fiscal-period normalization stays conservative.** Titan's transcript says Q2 but not the fiscal year, so the candidate reports `Q2` without adding an inferred year. Reliance's transcript labels the period Q2 FY2027, while its results page spells out FY2026–27; the source wording is retained.
4. **NSE is best-effort.** The integrated-filings endpoint is limited to its latest page of results; announcement lookback is bounded to two years. A source timeout, malformed payload or rate limit appears in the provider status and warning list.
5. **Cross-source deduplication is conservative.** Exact direct document URLs and matching title/period/publication-day records are merged, with alternate source links preserved; title variants that cannot be shown to refer to the same filing remain separate to avoid deleting real revisions or separate statement bases.

### Official source pages reviewed

- [NSE corporate filings and announcements](https://www.nseindia.com/companies-listing/corporate-filings-announcements)
- [NSE integrated filings](https://www.nseindia.com/companies-listing/corporate-integrated-filing)
- [BSE corporate announcements](https://www.bseindia.com/corporates/ann)
- [BSE information products](https://www.bseindia.com/downloads1/Information_Products_Pricing_Sheet.pdf)
- [Reliance financial reporting](https://www.ril.com/investors/financial-reporting)
- [Reliance events and presentations](https://www.ril.com/investors/events-presentations)
- [Titan annual reports](https://www.titancompany.in/investors/annual-reports)
- [Titan quarterly results](https://www.titancompany.in/investors/investor-relations/quarterly-results)
- [Titan corporate announcements](https://www.titancompany.in/investors/corporate-announcements)
- [Titan investor-conference presentations](https://www.titancompany.in/investors/presentations-at-investor-conferences)
