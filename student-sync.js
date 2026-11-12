/* JNTUA Student Hub — Supabase Auth + private student record sync.
   Google OAuth is handled by Supabase Auth. Each account can access only its own row.
*/
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  let sb = null, activeUser = null, syncing = false, saveTimer = null;
  const readLocal = key => {
    try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; }
    catch { return []; }
  };
  const setStatus = message => { const el = $("googleStatus"); if (el) el.textContent = message; };
  const setSignedOutUI = () => {
    if ($("googleCardTitle")) $("googleCardTitle").textContent = "Sign in with Google";
    if ($("googleIntro")) $("googleIntro").textContent = "Sign in securely with your Google account to access your JNTUA Student Hub. Your academic records will sync automatically.";
    if ($("googleProfile")) $("googleProfile").style.display = "none";
    if ($("googlePhoto")) $("googlePhoto").style.display = "none";
    if ($("googlePrivacy")) $("googlePrivacy").style.display = "block";
    if ($("googleConnect")) { $("googleConnect").style.display = "inline-flex"; $("googleConnect").disabled = false; }
    if ($("googleSignOut")) $("googleSignOut").style.display = "none";
    if ($("brandAvatar")) { $("brandAvatar").textContent = "J"; $("brandAvatar").style.padding = ""; $("brandAvatar").style.overflow = ""; }
  };
  const setSignedInUI = user => {
    const meta = user.user_metadata || {};
    const name = meta.full_name || meta.name || user.email?.split("@")[0] || "Student";
    const first = name.trim().split(/\s+/)[0] || "Student";
    if ($("googleCardTitle")) $("googleCardTitle").textContent = "Signed in with Google";
    if ($("googleName")) $("googleName").textContent = name;
    if ($("googleEmail")) $("googleEmail").textContent = user.email || "";
    if ($("googleProfile")) $("googleProfile").style.display = "flex";
    const photo = meta.avatar_url || meta.picture;
    if (photo && $("googlePhoto")) { $("googlePhoto").src = photo; $("googlePhoto").style.display = "block"; }
    if ($("googleIntro")) $("googleIntro").textContent = "Your SGPA, CGPA history and backlog records sync automatically to your private account.";
    if ($("googlePrivacy")) $("googlePrivacy").style.display = "none";
    if ($("googleConnect")) $("googleConnect").style.display = "none";
    if ($("googleSignOut")) $("googleSignOut").style.display = "inline-flex";
    if ($("heroFirstName")) $("heroFirstName").textContent = first + "'s semester.";
    if (photo && $("brandAvatar")) $("brandAvatar").innerHTML = '<img src="' + photo.replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '" alt="Profile" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">';
  };
  const mergeById = (remote, local, kind) => {
    const map = new Map();
    for (const item of [...(remote || []), ...(local || [])]) {
      const key = item?.id != null ? String(item.id) :
        kind === "semester" ? [item?.regulation,item?.semester,item?.branch,item?.label].join("|") :
        [item?.name,item?.semester].join("|");
      map.set(key, item);
    }
    return [...map.values()];
  };
  async function saveRemote(showMessage = false) {
    if (!sb || !activeUser || syncing) return;
    const payload = {
      user_id: activeUser.id,
      semesters: readLocal("jsh_semesters"),
      backlogs: readLocal("jsh_backlogs"),
      updated_at: new Date().toISOString()
    };
    const { error } = await sb.from("student_academic_records").upsert(payload, { onConflict: "user_id" });
    if (error) {
      console.error("Student data sync failed:", error);
      setStatus("Signed in, but cloud save failed. " + error.message);
      return;
    }
    if (showMessage) setStatus("Signed in · academic records synced successfully.");
  }
  async function loadAndSync(user) {
    if (!sb || !user || syncing) return;
    syncing = true;
    activeUser = user;
    try {
      const previousOwner = localStorage.getItem("jsh_owner_uid");
      const sameAccount = !previousOwner || previousOwner === user.id;
      const localSemesters = sameAccount ? readLocal("jsh_semesters") : [];
      const localBacklogs = sameAccount ? readLocal("jsh_backlogs") : [];
      const { data, error } = await sb.from("student_academic_records")
        .select("semesters,backlogs,updated_at").eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      const mergedSemesters = mergeById(data?.semesters || [], localSemesters, "semester");
      const mergedBacklogs = mergeById(data?.backlogs || [], localBacklogs, "backlog");
      localStorage.setItem("jsh_semesters", JSON.stringify(mergedSemesters));
      localStorage.setItem("jsh_backlogs", JSON.stringify(mergedBacklogs));
      localStorage.setItem("jsh_owner_uid", user.id);
      // Keep the existing calculator/history UI in sync with the restored cloud records.
      if (typeof semesters !== "undefined") semesters = mergedSemesters;
      if (typeof backlogs !== "undefined") backlogs = mergedBacklogs;
      if (typeof update === "function") update();
      const { error: saveError } = await sb.from("student_academic_records").upsert({
        user_id: user.id, semesters: mergedSemesters, backlogs: mergedBacklogs,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id" });
      if (saveError) throw saveError;
      setStatus("Signed in · academic records synced successfully.");
    } catch (error) {
      console.error("Could not load student records:", error);
      setStatus("Signed in, but database sync needs attention: " + error.message);
    } finally {
      syncing = false;
    }
  }
  async function signIn() {
    if (!sb) { setStatus("Database is still connecting. Please try again in a moment."); return; }
    $("googleConnect").disabled = true;
    setStatus("Redirecting to Google sign-in…");
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, queryParams: { access_type: "offline", prompt: "consent" } }
    });
    if (error) {
      $("googleConnect").disabled = false;
      setStatus("Google sign-in could not start: " + error.message);
    }
  }
  async function signOut() {
    if (!sb) return;
    const { error } = await sb.auth.signOut();
    if (error) { setStatus("Sign-out failed: " + error.message); return; }
    activeUser = null;
    setSignedOutUI();
    setStatus("Signed out. Your records remain saved on this device.");
  }
  function scheduleSave() {
    if (!activeUser) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveRemote(true), 650);
  }
  function initialize(client) {
    if (sb) return;
    sb = client;
    $("googleConnect")?.addEventListener("click", signIn);
    if ($("googleSignOut")) $("googleSignOut").addEventListener("click", signOut);
    window.addEventListener("jsh-data-changed", scheduleSave);
    sb.auth.onAuthStateChange((event, session) => {
      // Defer database work out of the auth callback to avoid holding the auth lock.
      setTimeout(() => {
        if (session?.user) {
          setSignedInUI(session.user);
          if (activeUser?.id !== session.user.id) loadAndSync(session.user);
        } else if (event === "SIGNED_OUT") {
          activeUser = null;
          setSignedOutUI();
          setStatus("Signed out. Your records remain saved on this device.");
        }
      }, 0);
    });
    sb.auth.getSession().then(({ data, error }) => {
      if (error) { setStatus("Could not check sign-in status: " + error.message); return; }
      if (data.session?.user) {
        setSignedInUI(data.session.user);
        loadAndSync(data.session.user);
      } else {
        setSignedOutUI();
        setStatus("Not signed in. Calculations remain available on this device.");
      }
    });
  }
  if (window.supabaseClient) initialize(window.supabaseClient);
  else window.addEventListener("supabase-ready", () => {
    if (window.supabaseClient) initialize(window.supabaseClient);
  }, { once: true });
})();
