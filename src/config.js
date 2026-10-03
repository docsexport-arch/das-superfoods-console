// Public configuration. Both values are designed to be shipped to a browser:
// the publishable key identifies the project and nothing more — every request
// it makes is still filtered by row-level security. The secret (service-role)
// key is never in this repository; it exists only inside the edge function.
export const SUPABASE_URL = "https://jvpziatizbaghxhyslrg.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_MPpqP5ZJ9_nN-lSH8n-wgg_gK5YL9z2";

// A call that never settles is worse than one that fails (Build Bible §9e).
export const RPC_TIMEOUT_MS = 30000;
// A stale session must never leave the app on a spinner.
export const BOOT_TIMEOUT_MS = 15000;
