import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { config } from './config.js';
import { updateHub } from './events.js';

const changeSchema = z.object({ kind:z.enum(['message','draft','receipt']),conversationId:z.uuid(),customerId:z.string().min(1).max(150) });
export function startRealtimeBridge(log: (entry: object) => void) {
  if (!config.supabaseUrl || !config.supabaseAnonKey || !process.env.AGENT_EMAIL || !process.env.AGENT_PASSWORD || process.env.REALTIME_ENABLED==='false') return async () => {};
  const client = createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:true}});
  let stopped = false, timer: ReturnType<typeof setTimeout>;
  const authSubscription = client.auth.onAuthStateChange((_event,session) => {
    if (session && !stopped) void client.realtime.setAuth(session.access_token);
  });
  async function connect() {
    if (stopped) return;
    try {
      const result = await client.auth.signInWithPassword({email:process.env.AGENT_EMAIL!,password:process.env.AGENT_PASSWORD!});
      if (result.error || !result.data.session) throw new Error('realtime_auth_failed');
      if (stopped) return;
      await client.realtime.setAuth(result.data.session.access_token);
      client.channel('verdant:events',{config:{private:true}}).on('broadcast',{event:'change'},({payload}) => {
        const change = changeSchema.safeParse(payload);
        if (change.success) updateHub.publish(change.data);
      }).subscribe(status => log({component:'supabase_realtime',status}));
      client.auth.startAutoRefresh();
    } catch {
      log({component:'supabase_realtime',status:'unavailable_polling_fallback'});
      if (!stopped) { timer=setTimeout(() => void connect(),15000); timer.unref(); }
    }
  }
  void connect();
  return async () => {
    stopped=true; clearTimeout(timer); authSubscription.data.subscription.unsubscribe();
    client.auth.stopAutoRefresh(); await client.removeAllChannels(); client.realtime.disconnect();
  };
}
