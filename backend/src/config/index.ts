import { z } from 'zod';
import { config as dotenvConfig } from 'dotenv';

// Load .env file
dotenvConfig();

/**
 * Environment configuration schema with validation
 */
const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.string().transform(Number).default('8080'),
  API_VERSION: z.string().default('v1'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Storage
  STORAGE_BUCKET_AUDIO: z.string().default('recordings-audio'),
  STORAGE_BUCKET_EXPORTS: z.string().default('exports'),

  // File limits
  MAX_AUDIO_FILE_SIZE_MB: z.string().transform(Number).default('200'),
  MAX_RECORDING_DURATION_SECONDS: z.string().transform(Number).default('14400'),

  // Upload URL expiry (in seconds)
  UPLOAD_URL_EXPIRY_SECONDS: z.string().transform(Number).default('3600'),

  // Deepgram (Speech-to-Text)
  DEEPGRAM_API_KEY: z.string().optional(),

  // OpenAI (LLM for Q&A and summarization)
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  OPENAI_MAX_TOKENS: z.string().transform(Number).default('2048'),

  // Q&A Configuration
  QA_MAX_CONTEXT_TOKENS: z.string().transform(Number).default('50000'),
  QA_MAX_RELEVANT_SEGMENTS: z.string().transform(Number).default('15'),

  // Recall.ai (Meeting Bot)
  RECALL_API_KEY: z.string().optional(),
  RECALL_REGION: z.string().default('us-west-2'),
  RECALL_WEBHOOK_SECRET: z.string().optional(),

  // Google Calendar OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),

  // Microsoft (Outlook/Teams) Calendar OAuth
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_REDIRECT_URI: z.string().optional(),
  MICROSOFT_TENANT_ID: z.string().default('common'), // 'common' for multi-tenant

  // Encryption (for storing OAuth tokens)
  ENCRYPTION_KEY: z.string().optional(),

  // GCP Configuration (for Cloud Tasks in production)
  GCP_PROJECT_ID: z.string().optional(),
  GCP_LOCATION: z.string().default('us-central1'),
  BOT_SCHEDULER_QUEUE: z.string().default('bot-scheduler'),
  CLOUD_TASKS_QUEUE: z.string().optional(),

  // Service URL (for internal worker callbacks)
  SERVICE_URL: z.string().optional(),
  INTERNAL_SECRET: z.string().optional(),

  // Twilio (Phone Calls)
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(), // Twilio number for outbound calls
  TWILIO_VERIFY_SERVICE_SID: z.string().optional(), // Verify service for phone verification

  // Twilio Voice SDK (VoIP)
  TWILIO_API_KEY_SID: z.string().optional(), // API Key for access tokens
  TWILIO_API_KEY_SECRET: z.string().optional(), // API Key secret
  TWILIO_TWIML_APP_SID: z.string().optional(), // TwiML App for VoIP calls
});

export type Config = z.infer<typeof envSchema>;

/**
 * Load and validate configuration from environment variables
 */
function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.format();
    console.error('❌ Invalid environment variables:');
    console.error(JSON.stringify(formatted, null, 2));
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();

// Log configuration on startup (without sensitive values)
export function logConfig(): void {
  console.log('📋 Configuration loaded:');
  console.log(`   Environment: ${config.NODE_ENV}`);
  console.log(`   Port: ${config.PORT}`);
  console.log(`   Supabase URL: ${config.SUPABASE_URL}`);
  console.log(`   Max file size: ${config.MAX_AUDIO_FILE_SIZE_MB}MB`);
  console.log(`   Max duration: ${config.MAX_RECORDING_DURATION_SECONDS}s`);
}
