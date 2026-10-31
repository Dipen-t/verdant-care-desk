import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { createDatabase,migrate } from '../server/db.js';
const email = process.env.AGENT_EMAIL, password = process.env.AGENT_PASSWORD;
const adminKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!email || !password || !process.env.SUPABASE_URL || !adminKey) throw new Error('Set AGENT_EMAIL, AGENT_PASSWORD, SUPABASE_URL and SUPABASE_SECRET_KEY locally.');
const auth = createClient(process.env.SUPABASE_URL,adminKey,{ auth: { persistSession: false } });
const { data,error } = await auth.auth.admin.createUser({ email,password,email_confirm: true });
if (error) throw new Error(`Agent creation failed: ${error.code}. Use an existing user ID with a membership SQL insert if the account already exists.`);
const db = await createDatabase();
try { await migrate(db); await db.query(`INSERT INTO agent_memberships(user_id,brand_id) VALUES($1,'verdant-co') ON CONFLICT DO NOTHING`,[data.user.id]); console.log('Agent created and granted Verdant access.'); } finally { await db.close(); }
