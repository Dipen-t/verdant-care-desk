import 'dotenv/config';
import { randomBytes } from 'node:crypto';
export const config = {
  production: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3001), host: process.env.HOST || '127.0.0.1',
  databaseUrl: process.env.DATABASE_URL || '', pgliteDir: process.env.PGLITE_DIR || '.data/verdant',
  sessionSecret: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
  webhookSecret: process.env.WEBHOOK_SECRET || 'verdant-demo-secret-2026',
  localAuth: process.env.LOCAL_DEMO_AUTH === 'true',
  localEmail: process.env.LOCAL_AGENT_EMAIL || 'agent@verdant.example',
  localPassword: process.env.LOCAL_AGENT_PASSWORD || 'verdant-local-2026',
  supabaseUrl: process.env.SUPABASE_URL || '', supabaseAnonKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '',
  llmBaseUrl: process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1',
  llmKey: process.env.LLM_API_KEY || '', llmModel: process.env.LLM_MODEL || '',
  llmFallbackModels: (process.env.LLM_FALLBACK_MODELS || '').split(',').map(model => model.trim()).filter(Boolean),
  llmTimeout: Number(process.env.LLM_TIMEOUT_MS || 25000),
};
export function assertProductionConfig() {
  if (!config.production) return;
  if (config.localAuth || !config.databaseUrl || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || !config.supabaseUrl || !config.supabaseAnonKey || !config.llmKey || !config.llmModel) {
    throw new Error('Production requires PostgreSQL, Supabase Auth, LLM configuration and a 32+ character SESSION_SECRET; LOCAL_DEMO_AUTH must be false.');
  }
}
