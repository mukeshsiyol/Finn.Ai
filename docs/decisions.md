# Initial product decisions

## Scope for the first working slice

1. A mobile-first portfolio dashboard with clear freshness and demo-data labels.
2. An investor-oriented alert feed with importance, event type, and a concise explanation.
3. A research entry point designed around cited primary-source evidence.
4. A 20-company demo universe, plus five research-only tickers.

## Trust rules

- Never present unavailable data as zero.
- Mark fixtures and illustrative figures visibly.
- Compute financial ratios and changes in deterministic backend code.
- Treat LLM output as explanation; attach source document, period, page, and passage to research claims.
- Do not use broker reports or general news as evidence for the research engine.

## Engineering choices

- Start with a modular FastAPI monolith.
- Keep data providers, announcement processing, research retrieval, and intelligence logic in separate service areas.
- Keep the first frontend simple and responsive; avoid premature infrastructure.
- Store the demo universe as JSON until persistence is needed.

## Open implementation decisions

- Confirm acceptable NSE/BSE access method and rate limits from the challenge materials.
- Select primary-source document acquisition approach.
- Select model provider and embedding store after the first retrieval workflow is scoped.
