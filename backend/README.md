# Summary AI Backend

Node.js/TypeScript backend API for Summary AI - meeting transcription and summarization.

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage
- **Deployment**: Google Cloud Run

## Getting Started

### Prerequisites

- Node.js 20+
- npm or yarn
- Supabase project (for database and storage)

### Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your values
# (see .env.example for required variables)
```

### Development

```bash
# Start development server with hot reload
npm run dev

# Type checking
npm run typecheck

# Build for production
npm run build

# Start production server
npm start
```

### Environment Variables

Required environment variables:

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anonymous/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side) |

See `.env.example` for all available options.

## API Endpoints

### Authentication

All endpoints except `/health` require a valid JWT token in the `Authorization` header:

```
Authorization: Bearer <supabase_access_token>
```

### Recordings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/recordings` | Create recording, get upload URL |
| `POST` | `/api/recordings/:id/complete-upload` | Signal upload complete, trigger processing |
| `GET` | `/api/recordings` | List recordings (paginated) |
| `GET` | `/api/recordings/:id` | Get recording details |
| `PATCH` | `/api/recordings/:id` | Update recording metadata |
| `DELETE` | `/api/recordings/:id` | Delete recording |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Basic health check |
| `GET` | `/health/detailed` | Detailed health with dependency status |

## Docker

### Build

```bash
docker build -t summary-ai-backend .
```

### Run

```bash
docker run -p 8080:8080 \
  -e SUPABASE_URL=your_url \
  -e SUPABASE_ANON_KEY=your_anon_key \
  -e SUPABASE_SERVICE_ROLE_KEY=your_service_key \
  summary-ai-backend
```

## Deployment to Cloud Run

```bash
# Build and push to Container Registry
gcloud builds submit --tag gcr.io/PROJECT_ID/summary-ai-backend

# Deploy to Cloud Run
gcloud run deploy summary-ai-backend \
  --image gcr.io/PROJECT_ID/summary-ai-backend \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "SUPABASE_URL=xxx,SUPABASE_ANON_KEY=xxx" \
  --set-secrets "SUPABASE_SERVICE_ROLE_KEY=supabase-service-key:latest"
```

## Drip email sender and the outreach metrics layer

`scripts/send-promo.ts` (the 3-touch drip) is wired to the shared outreach metrics layer (Calldesk `docs/OUTREACH-METRICS.md`). Always on:
every send carries Resend tags `campaign_id` (`meetingmind-promoN-<yyyymm01>`) and `product`, and every accepted send is written to a
local ledger (`~/.outreach-ledger/meetingmind.jsonl`, hashes only) so touch 1 skips anyone this product mailed in the last 90 days.
Behind `OUTREACH_METRICS=1` (default off, set it in the environment of the cron that runs the script, together with `CRON_SECRET`
and `OUTREACH_EVENT_SECRET`): campaign registration, the layer's dedupe, the bounce circuit breaker (`pause_recommended` stops the
batch) and `sent` events. All layer calls are fail-open with a 3 s timeout; links are never rewritten by the drip. Enable only after
`https://calldesk.tech/api/outreach/check` is verified live. `scripts/lib/outreach-metrics.mjs` is a verbatim copy of
`harness/lib/outreach-metrics/outreach-metrics.mjs` in the ops repo; do not edit it here.

## Project Structure

```
src/
├── config/          # Configuration loading
├── lib/             # Shared utilities (Supabase client)
├── middleware/      # Express middleware (auth, error handling)
├── routes/          # API route handlers
├── services/        # Business logic services
└── types/           # TypeScript type definitions
    ├── api.ts       # API request/response types
    └── database.ts  # Database schema types
```

## License

MIT
