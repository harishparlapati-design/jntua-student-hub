(() => {
  const $ = id => document.getElementById(id);

  let supabase = null;
  let currentUser = null;

  function status(id, message) {
    const el = $(id);
    if (el) el.textContent = message;
  }

  function initialize(client) {
    if (supabase) return;
    supabase = client;

    supabase.auth.onAuthStateChange((_event, session) => {
      currentUser = session?.user || null;

      status(
        "paperAuthStatus",
        currentUser
          ? "Signed in: " + currentUser.email
          : "Not signed in."
      );

      $("paperSignUp").style.display = currentUser ? "none" : "";
      $("paperSignIn").style.display = currentUser ? "none" : "";
      $("paperSignOut").style.display = currentUser ? "" : "none";
    });

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        status("paperAuthStatus", error.message);
        return;
      }

      currentUser = data.session?.user || null;

      status(
        "paperAuthStatus",
        currentUser ? "Signed in: " + currentUser.email : "Not signed in."
      );

      $("paperSignUp").style.display = currentUser ? "none" : "";
      $("paperSignIn").style.display = currentUser ? "none" : "";
      $("paperSignOut").style.display = currentUser ? "" : "none";
    });
  }

  function waitForSupabase() {
    if (window.supabaseClient) {
      initialize(window.supabaseClient);
      return;
    }

    window.addEventListener("supabase-ready", () => {
      if (window.supabaseClient) initialize(window.supabaseClient);
    }, { once: true });
  }

  $("paperSignUp").addEventListener("click", async () => {
    if (!supabase) return alert("Supabase is still loading.");

    const email = $("paperEmail").value.trim();
    const password = $("paperPassword").value;

    if (!email || password.length < 6) {
      return alert("Enter a valid email and password of at least 6 characters.");
    }

    status("paperAuthStatus", "Creating account...");

    const { data, error } = await supabase.auth.signUp({
      email,
      password
    });

    if (error) {
      status("paperAuthStatus", error.message);
      return;
    }

    status(
      "paperAuthStatus",
      data.session
        ? "Account created and signed in."
        : "Account created. Check your email to confirm your account, then sign in."
    );
  });

  $("paperSignIn").addEventListener("click", async () => {
    if (!supabase) return alert("Supabase is still loading.");

    const email = $("paperEmail").value.trim();
    const password = $("paperPassword").value;

    if (!email || !password) {
      return alert("Enter your email and password.");
    }

    status("paperAuthStatus", "Signing in...");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    status(
      "paperAuthStatus",
      error ? error.message : "Signed in successfully."
    );
  });

  $("paperSignOut").addEventListener("click", async () => {
    if (!supabase) return;

    const { error } = await supabase.auth.signOut();

    status(
      "paperAuthStatus",
      error ? error.message : "Signed out."
    );
  });

  $("paperUpload").addEventListener("click", async () => {
    if (!supabase) return alert("Supabase is still loading.");

    if (!currentUser) {
      return alert("Please sign in before uploading.");
    }

    const file = $("paperFile").files[0];

    if (!file) return alert("Choose a question paper first.");

    if (file.size > 50 * 1024 * 1024) {
      return alert("Maximum file size is 50 MB.");
    }

    const regulation = $("paperReg").value;
    const semester = $("paperSem").value;
    const branch = $("paperBranch").value;
    const subject = $("paperSubject").value.trim();

    if (!regulation || !semester || !branch || !subject) {
      return alert("Select regulation, semester, branch and subject.");
    }

    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp"
    ];

    if (!allowedTypes.includes(file.type)) {
      return alert("Only PDF, JPG, PNG and WEBP files are allowed.");
    }

    status("paperUploadStatus", "Uploading paper...");

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath =
      currentUser.id + "/" + Date.now() + "_" + safeName;

    try {
      const { error: uploadError } = await supabase.storage
        .from("question-papers")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type
        });

      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase
        .from("question_papers")
        .insert({
          regulation,
          semester,
          branch,
          subject_name: subject,
          subject_code: null,
          exam_session: null,
          file_name: file.name,
          file_path: filePath,
          file_type: file.type,
          uploaded_by: currentUser.id
        });

      if (insertError) {
        await supabase.storage
          .from("question-papers")
          .remove([filePath]);

        throw insertError;
      }

      status("paperUploadStatus", "Paper uploaded successfully!");
      $("paperFile").value = "";
      searchPapers();
    } catch (error) {
      status("paperUploadStatus", "Upload failed: " + error.message);
    }
  });

  async function searchPapers() {
    if (!supabase) {
      return status("paperResults", "Supabase is still loading.");
    }

    const regulation = $("paperReg").value;
    const semester = $("paperSem").value;
    const branch = $("paperBranch").value;
    const subject = $("paperSubject").value.trim();

    if (!regulation || !semester || !branch) {
      return status(
        "paperResults",
        "Select regulation, semester and branch."
      );
    }

    status("paperResults", "Searching question papers...");

    let query = supabase
      .from("question_papers")
      .select("*")
      .eq("regulation", regulation)
      .eq("semester", semester)
      .eq("branch", branch)
      .order("created_at", { ascending: false });

    if (subject) {
      query = query.eq("subject_name", subject);
    }

    const { data, error } = await query;

    if (error) {
      return status("paperResults", "Search failed: " + error.message);
    }

    const results = $("paperResults");
    results.replaceChildren();

    if (!data || data.length === 0) {
      results.textContent = "No question papers found.";
      return;
    }

    data.forEach(paper => {
      const item = document.createElement("div");
      item.className = "record";

      const details = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = paper.subject_name;

      const info = document.createElement("small");
      info.textContent =
        paper.file_name + " · " +
        paper.regulation + " · " +
        paper.semester + " · " +
        paper.branch;

      details.append(name, info);

      const link = document.createElement("a");
      link.textContent = "View / Download";
      link.href = "#";
      link.addEventListener("click", async event => {
        event.preventDefault();

        const { data: urlData } = supabase.storage
          .from("question-papers")
          .getPublicUrl(paper.file_path);

        if (urlData?.publicUrl) {
          window.open(urlData.publicUrl, "_blank", "noopener");
        }
      });

      item.append(details, link);
      results.appendChild(item);
    });
  }

  $("searchPapers").addEventListener("click", searchPapers);

  waitForSupabase();
})();
