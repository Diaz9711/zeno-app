// ── ZENO Supabase Sync Layer ──
// Setup: create a free project at supabase.com
// Add your URL and anon key below (or set as env vars)
// Then run the SQL in README-supabase.sql to create the tables

const SUPABASE_URL = window.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || '';

let _supabase = null;

function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  if (_supabase) return _supabase;
  // Use the global supabase client if loaded
  if (window.supabase) {
    _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _supabase;
}

window.zenoSupabase = {
  isConfigured: () => !!(SUPABASE_URL && SUPABASE_ANON_KEY),
  getClient: getSupabase,

  async syncUp(userId, data) {
    const sb = getSupabase();
    if (!sb || !userId) return false;
    try {
      const { error } = await sb.from('zeno_data').upsert({
        user_id: userId,
        data: data,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      return !error;
    } catch { return false; }
  },

  async syncDown(userId) {
    const sb = getSupabase();
    if (!sb || !userId) return null;
    try {
      const { data, error } = await sb
        .from('zeno_data')
        .select('data')
        .eq('user_id', userId)
        .single();
      return error ? null : data?.data;
    } catch { return null; }
  }
};
