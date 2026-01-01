# Summary AI

An iOS app for recording meetings, transcribing them with AI, generating summaries, and enabling Q&A over your recordings.

## Features

- **Audio Recording**: Record meetings with background support and screen lock
- **Transcription**: Automatic speech-to-text using Deepgram
- **AI Summarization**: Generate summaries, key points, and action items
- **Q&A**: Ask questions about your recordings and get AI-powered answers
- **Search**: Find content across all your transcripts
- **Export**: Export summaries as PDF, Markdown, or plain text

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         iOS App                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Record   │  │ Upload   │  │ View     │  │ Q&A      │        │
│  │ Screen   │  │ Progress │  │ Summary  │  │ Screen   │        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│       │             │             │             │               │
│       └─────────────┴─────────────┴─────────────┘               │
│                           │                                      │
│                    ┌──────┴──────┐                              │
│                    │ API Client  │                              │
│                    └──────┬──────┘                              │
└───────────────────────────┼─────────────────────────────────────┘
                            │ HTTPS
┌───────────────────────────┼─────────────────────────────────────┐
│                    ┌──────┴──────┐                              │
│                    │   Express   │        Backend (Cloud Run)   │
│                    │   Server    │                              │
│                    └──────┬──────┘                              │
│       ┌───────────────────┼───────────────────┐                 │
│       │                   │                   │                 │
│  ┌────┴────┐        ┌─────┴─────┐       ┌────┴────┐            │
│  │Supabase │        │ Deepgram  │       │ Claude  │            │
│  │DB/Store │        │   STT     │       │   LLM   │            │
│  └─────────┘        └───────────┘       └─────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

## Tech Stack

### iOS App
- **SwiftUI** with iOS 17+
- **MVVM** architecture
- **AVFoundation** for audio recording
- **Supabase Auth** for authentication

### Backend
- **Node.js** with TypeScript
- **Express** web framework
- **Supabase** for database and storage
- **Deepgram** for transcription
- **Anthropic Claude** for summarization and Q&A
- **Google Cloud Run** for deployment

## Project Structure

```
SummaryAI/
├── backend/                 # Node.js/Express API
│   ├── src/
│   │   ├── config/         # Environment configuration
│   │   ├── lib/            # Supabase client
│   │   ├── middleware/     # Auth and error handling
│   │   ├── routes/         # API endpoints
│   │   ├── services/       # Business logic
│   │   └── types/          # TypeScript types
│   ├── Dockerfile
│   └── package.json
│
├── ios/                     # iOS SwiftUI App
│   └── SummaryAI/
│       └── Sources/
│           ├── App/        # App entry point
│           ├── Models/     # Data models
│           ├── Services/   # API, Auth, Export services
│           ├── ViewModels/ # MVVM view models
│           └── Views/      # SwiftUI views
│
├── ARCHITECTURE.md          # System architecture
├── BACKEND_API.md          # API documentation
├── DATA_MODELS.md          # Database schema
├── PROCESSING_PIPELINE.md  # Transcription/summarization pipeline
└── UX_DESIGN.md            # UI/UX design specs
```

## Getting Started

### Backend Setup

```bash
cd backend
npm install
cp .env.example .env
# Fill in your API keys in .env
npm run dev
```

### iOS Setup

1. Open `ios/SummaryAI` in Xcode
2. Configure Supabase credentials
3. Build and run on simulator or device

## Documentation

- [Architecture](ARCHITECTURE.md) - System design and data flow
- [Backend API](BACKEND_API.md) - REST API documentation
- [Data Models](DATA_MODELS.md) - Database schema and Swift models
- [Processing Pipeline](PROCESSING_PIPELINE.md) - Transcription and summarization
- [UX Design](UX_DESIGN.md) - Screen flows and UI specifications

## License

MIT
