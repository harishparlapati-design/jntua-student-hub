/* Regulation wizard V4.1 – multi-branch/semester publisher.
   Requires supabase-config.js and academic-catalogue.js. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const sb = () => window.supabaseClient || null;
  let branches = [], semesters = [], colleges = [], batch = [], initialized = false;

  const say = text => { if ($("v4Status")) $("v4Status").textContent = text; };
  const modal = open => $("regWizard")?.classList.toggle("open", open);

  function addRow(name = "", credits = "") {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="rownum"></td><td><input class="v4name" placeholder="Subject name"></td><td><input class="v4credits" type="number" min="0.5" step="0.5" placeholder="Credits"></td><td><button type="button" class="btn danger mini">Remove</button></td>`;
    tr.querySelector(".v4name").value = name;
    tr.querySelector(".v4credits").value = credits;
    tr.querySelector("button").onclick = () => { tr.remove(); renumber(); };
    $("v4SubjectRows").append(tr);
    renumber();
  }
  function renumber() {
    [...$("v4SubjectRows").children].forEach((row, i) => row.querySelector(".rownum").textContent = i + 1);
  }
  function currentRows() {
    return [...$("v4SubjectRows").querySelectorAll("tr")].map(row => ({
      subject_name: row.querySelector(".v4name").value.trim(),
      credits: Number(row.querySelector(".v4credits").value)
    })).filter(row => row.subject_name || row.credits);
  }
  function saveBatch() {
    const semester = $("v4Semester").value;
    const branch = $("v4Branch").value;
    const rows = currentRows();
    if (!semester || !branch || !rows.length) throw new Error("Select a semester and branch, then enter at least one subject.");
    if (rows.some(row => !row.subject_name || !(row.credits > 0))) throw new Error("Complete every subject name and enter credits greater than zero.");
    const key = `${semester}|${branch}`;
    batch = batch.filter(group => group.key !== key);
    batch.push({ key, semester, branch, subjects: rows });
    say(`Saved locally: ${$("v4Semester").selectedOptions[0].textContent} · ${$("v4Branch").selectedOptions[0].textContent}. ${rows.length} subjects. Choose the next branch/semester or publish.`);
  }
  function resetRows() {
    $("v4SubjectRows").replaceChildren();
    addRow();
  }
  async function loadPdfJs() {
    if (window.pdfjsLib) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load the PDF reader. Check your internet connection."));
      document.head.append(script);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
  async function scanPdf() {
    const file = $("v4Pdf").files?.[0];
    if (!file) return say("Choose a PDF first.");
    try {
      say("Reading PDF text…");
      await loadPdfJs();
      const doc = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      let text = "";
      for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
        const page = await doc.getPage(pageNo);
        const content = await page.getTextContent();
        text += "\n" + content.items.map(item => item.str).join(" ");
      }
      const detected = [];
      for (const line of text.split(/\n/).map(value => value.replace(/\s+/g, " ").trim()).filter(Boolean)) {
        const code = line.match(/\b[A-Z]{1,5}[- ]?\d{2,4}[A-Z]?\b/);
        const credit = line.match(/\b(\d+(?:\.\d+)?)\s*$/);
        if (!code || !credit) continue;
        const title = line.slice(code.index + code[0].length).replace(/^[\s:.-]+/, "").replace(/\s+\d+(?:\.\d+)?$/, "").trim();
        const amount = Number(credit[1]);
        if (title.length > 2 && amount > 0 && amount <= 10) detected.push({ subject_name: title, credits: amount });
      }
      const unique = detected.filter((row, i, all) => all.findIndex(item => item.subject_name === row.subject_name) === i);
      if (!unique.length) {
        say(`Read ${doc.numPages} pages but found no reliable subject rows. This may be a scanned PDF or a different table layout. Enter subjects manually.`);
        return;
      }
      $("v4SubjectRows").replaceChildren();
      unique.forEach(row => addRow(row.subject_name, row.credits));
      say(`Detected ${unique.length} possible subjects from ${doc.numPages} pages. Review and correct every row before publishing.`);
    } catch (error) {
      say("PDF scan failed: " + error.message);
    }
  }
  function fillSelect(id, rows, label, value, firstLabel) {
    const select = $(id);
    select.replaceChildren(new Option(firstLabel, ""));
    rows.forEach(row => select.add(new Option(label(row), value(row))));
  }
  async function loadMasterData() {
    const client = sb();
    if (!client) return;
    try {
      const [b, s, c] = await Promise.all([
        client.from("academic_branches").select("*").eq("is_active", true).order("branch_name"),
        client.from("academic_semesters").select("*").eq("is_active", true).order("semester_order"),
        client.from("academic_colleges").select("*").eq("is_active", true).order("college_name")
      ]);
      for (const result of [b, s, c]) if (result.error) throw result.error;
      branches = b.data || [];
      semesters = s.data || [];
      colleges = c.data || [];
      fillSelect("v4Branch", branches, row => `${row.branch_name} (${row.branch_code})`, row => row.branch_code, "Select branch");
      fillSelect("v4Semester", semesters, row => row.semester_name, row => row.semester_code, "Select semester");
      fillSelect("v4College", colleges, row => `${row.college_name}${row.college_type === "autonomous" ? " · Autonomous" : " · Affiliated curriculum"}`, row => row.id, "Select curriculum / college");
      const defaultCollege = colleges.find(row => row.college_code === "JNTUA") || colleges.find(row => row.college_type !== "autonomous");
      if (defaultCollege) $("v4College").value = defaultCollege.id;
      say("Catalogue lists loaded. Select the correct curriculum before adding a regulation.");
    } catch (error) {
      say("Could not load branch, semester and college lists: " + error.message);
    }
  }
  async function publish() {
    const client = sb();
    if (!client) return say("Supabase is not connected.");
    try {
      const collegeId = $("v4College").value;
      if (!collegeId) throw new Error("Select a curriculum / college.");
      const current = currentRows();
      const currentHasAny = current.length > 0 || $("v4Semester").value || $("v4Branch").value;
      if (currentHasAny) saveBatch();
      if (!batch.length) throw new Error("Add and save at least one branch/semester group.");
      const code = $("v4RegCode").value.trim().toUpperCase();
      const year = Number($("v4StartYear").value) || null;
      if (!/^R\d{2,4}$/i.test(code)) throw new Error("Enter a regulation code such as R26.");
      if (!year) throw new Error("Enter the starting year.");
      const college = colleges.find(row => row.id === collegeId);
      if (!college) throw new Error("Selected college is not in the active catalogue.");
      const collegeScope = college.college_type === "autonomous" ? collegeId : null;

      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError) throw authError;
      const user = authData?.user;
      if (!user) throw new Error("Supabase Auth administrator login is required. Google Drive sign-in alone does not authorise publishing.");
      const { data: admin, error: adminError } = await client.from("academic_catalogue_admins").select("user_id").eq("user_id", user.id).maybeSingle();
      if (adminError) throw adminError;
      if (!admin) throw new Error("Your Supabase Auth UID is not registered as an academic catalogue administrator.");

      let lookup = client.from("academic_regulations").select("id").eq("regulation_code", code);
      lookup = collegeScope ? lookup.eq("college_id", collegeScope) : lookup.is("college_id", null);
      const { data: oldRows, error: lookupError } = await lookup.limit(1);
      if (lookupError) throw lookupError;

      const regulationPayload = {
        college_id: collegeScope,
        university_name: "JNTUA",
        regulation_code: code,
        regulation_name: code,
        start_year: year,
        is_active: true
      };
      let regulation;
      if (oldRows?.length) {
        const result = await client.from("academic_regulations").update(regulationPayload).eq("id", oldRows[0].id).select().single();
        if (result.error) throw result.error;
        regulation = result.data;
      } else {
        const result = await client.from("academic_regulations").insert(regulationPayload).select().single();
        if (result.error) throw result.error;
        regulation = result.data;
      }

      const payload = [];
      for (const group of batch) {
        const branch = branches.find(row => row.branch_code === group.branch);
        const semester = semesters.find(row => row.semester_code === group.semester);
        if (!branch || !semester) throw new Error(`Branch/semester mapping missing for ${group.branch} / ${group.semester}.`);
        group.subjects.forEach((subject, index) => payload.push({
          regulation_id: regulation.id,
          branch_id: branch.id,
          semester_id: semester.id,
          subject_code: `${code}-${branch.branch_code}-${group.semester}-${index + 1}`,
          subject_name: subject.subject_name,
          credits: subject.credits,
          subject_type: "Theory",
          is_active: true
        }));
      }
      const unique = [...new Map(payload.map(row => [`${row.regulation_id}|${row.branch_id}|${row.semester_id}|${row.subject_code}`, row])).values()];
      const { error: subjectError } = await client.from("academic_subjects").upsert(unique, { onConflict: "regulation_id,branch_id,semester_id,subject_code" });
      if (subjectError) throw subjectError;

      say(`Published ${code} for ${college.college_name}: ${batch.length} branch/semester groups and ${unique.length} subjects. Refreshing catalogue…`);
      await window.JSHV4?.reload?.();
      batch = [];
      modal(false);
    } catch (error) {
      say("Publish failed: " + error.message);
    }
  }

  function wire() {
    if (initialized) return;
    initialized = true;
    $("openRegWizard")?.addEventListener("click", () => {
      modal(true);
      if (!$("v4SubjectRows").children.length) addRow();
      loadMasterData();
    });
    $("closeRegWizard")?.addEventListener("click", () => modal(false));
    $("regWizard")?.addEventListener("click", event => { if (event.target === $("regWizard")) modal(false); });
    $("v4AddRow")?.addEventListener("click", () => addRow());
    $("v4Scan")?.addEventListener("click", scanPdf);
    $("v4SaveNext")?.addEventListener("click", () => {
      try {
        saveBatch();
        $("v4Semester").value = "";
        $("v4Branch").value = "";
        resetRows();
      } catch (error) {
        say(error.message);
      }
    });
    $("v4Publish")?.addEventListener("click", publish);
    if (sb()) loadMasterData();
  }
  document.addEventListener("DOMContentLoaded", wire, { once: true });
  window.addEventListener("supabase-ready", () => { if (initialized) loadMasterData(); });
})();
