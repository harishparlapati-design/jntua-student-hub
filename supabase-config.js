// JNTUA Student Hub - Supabase configuration

const SUPABASE_URL = "https://oijxkmwihnmcfxlzohzp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_iI3RWnBxNYhujLo7pCh_mw_6-jU56bl";

const supabaseScript = document.createElement("script");
supabaseScript.src =
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

supabaseScript.onload = () => {
  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );

  console.log("JNTUA Student Hub connected to Supabase");
  window.dispatchEvent(new Event("supabase-ready"));
};

document.head.appendChild(supabaseScript);
