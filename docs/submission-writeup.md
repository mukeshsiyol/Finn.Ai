# ENAM submission write-up

Use this as a short covering-email outline. Replace the repository link with the final public GitHub URL, verify the deployed demo is awake, and attach/share the AI build history requested in the brief. Do not send until those links and attachments are checked.

**To:** assessment@enam.com

**Subject:** IIT Delhi – AI Engineer – 2027

Dear ENAM Assessment Team,

I am submitting FINN, a mobile-first investment intelligence prototype for Indian listed companies.

**What I built:** FINN combines a Push workflow for source-linked company announcements and completed-session market signals with a Pull workflow for company research. The application includes Home, Alerts, Portfolio, and a five-part Research workspace. Users can ask evidence-grounded questions, inspect citations, compare page-referenced quarterly figures, track management commitments, review Bull/Bear evidence, discover approved public documents, and explicitly import selected PDFs into the same research index.

**Links:**
- Responsive web demo: https://finn-ai-bhj4.onrender.com/ *(confirm availability before sending)*
- GitHub repository: https://github.com/mukeshsiyol/Finn.Ai *(confirm the latest commit is pushed before sending)*
- AI build history: [attach or insert conversation export/share link]

**Key decisions and trade-offs:** I kept market calculations and alert thresholds in the backend, separated tracked companies from actual holdings, and reused one document library/extraction/retrieval path for manual uploads and discovered documents. Public-source import requires explicit user selection and source validation. Evidence is preferred over unsupported model knowledge. The current prototype uses JSON/file persistence and a single-process background task model to avoid introducing infrastructure that the prototype does not require.

**Deliberately left out:** authenticated multi-user accounts, durable database/object storage and distributed job queues; BSE structured discovery where a permitted public source could not be confirmed; broad generic crawling; OCR for scanned PDFs; and automatic extraction of arbitrary financial tables and management guidance. These limitations are documented in the repository README.

**Next steps:** add durable user-scoped persistence and authentication, expand reviewed issuer/provider coverage, implement validated table and guidance extraction with human review, and add a durable scheduled ingestion/job system after selecting permitted data sources.

Thank you for your consideration.

Regards,
[Your name]
