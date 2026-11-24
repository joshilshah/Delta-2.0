import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(url && key);

// Only the PUBLISHABLE key ever reaches the browser. Row Level Security limits what it can read.
export const supabase = supabaseConfigured ? createClient(url, key) : null;
