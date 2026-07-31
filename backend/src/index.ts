/**
 * Meeting Mind Backend
 * Main entry point
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { config, logConfig } from './config/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { testConnection } from './lib/supabase.js';
import routes from './routes/index.js';

// Create Express app
const app = express();

// ============================================================================
// Middleware
// ============================================================================

// Security headers
app.use(helmet());

// CORS configuration
const allowedOrigins = [
  'https://summaryai.app',
  'https://www.summaryai.app',
  'https://meetingmind.app',
  'https://www.meetingmind.app',
  'https://meetingmind.org',
  'https://www.meetingmind.org',
];

// Allow Cloud Run URLs in production
const corsOrigin = config.NODE_ENV === 'production'
  ? (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) {
        callback(null, true);
        return;
      }
      // Allow listed origins
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      // Allow Cloud Run URLs
      if (origin.endsWith('.run.app')) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    }
  : '*';

app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Request logging
app.use(morgan(config.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Body parsing
// IMPORTANT: Stripe webhooks must receive raw body for signature verification
// This must come BEFORE express.json() middleware
app.use('/v1/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '10mb' }));
// Twilio webhooks send application/x-www-form-urlencoded data
app.use(express.urlencoded({ extended: true }));

// Trust proxy (for Cloud Run)
app.set('trust proxy', true);

// ============================================================================
// Routes
// ============================================================================

// API version prefix
app.use(`/${config.API_VERSION}`, routes);

// Also mount at root for health checks
app.use('/', routes);

// Root endpoint
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Meeting Mind API',
    version: config.API_VERSION,
    status: 'running',
  });
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found',
    },
  });
});

// Global error handler
app.use(errorHandler);

// ============================================================================
// Server Startup
// ============================================================================

async function startServer(): Promise<void> {
  console.log('🚀 Starting Meeting Mind Backend...');
  logConfig();

  // Test Supabase connection
  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.error('❌ Failed to connect to Supabase. Check your configuration.');
    process.exit(1);
  }

  // Start listening
  app.listen(config.PORT, () => {
    console.log(`✅ Server running on port ${config.PORT}`);
    console.log(`📍 API available at http://localhost:${config.PORT}/${config.API_VERSION}`);
    // Re-attach tickers for any coaching sessions that were in flight when this
    // process last died (e.g. previous deploy / Fly machine restart).
    import('./services/coachingService.js').then(m => m.recoverActiveSessions())
      .catch(e => console.error('[Coaching] recovery failed:', e));
    // Backstop for the Recall bot.status_change webhook subscription gap:
    // auto-stitches live_transcripts into the transcripts table for any
    // recording stuck in `pending` for >10 min.
    import('./services/stuckMeetingRecovery.js').then(m => m.startStuckMeetingRecoveryLoop())
      .catch(e => console.error('[StuckRecovery] init failed:', e));
  });
}

// Handle uncaught errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

// Start the server
startServer();
