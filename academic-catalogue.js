/* Shared academic catalogue for JNTUA Student Hub.
   Requires window.supabaseClient from supabase-config.js.
   Catalogue reads are public; writes require an authenticated UID listed in
   public.academic_catalogue_admins. PDF extraction is client-side and must be reviewed. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const state = { colleges: [], regulations: [], branches: [], semesters: [], subjects: [], extracted: [], pdfText: "" };
  let eventsBound = false;
  const client = () => window.supabaseClient || null;
  const val = id => $(id)?.value || "";
  const setOptions = (id, rows, label, value, first = "Select") => {
    const el = $(id); if (!el) return;
    const previous = el.value;
    el.replaceChildren(new Option(first, ""));
    rows.forEach(row => el.add(new Option(label(row), value(row))));
    if ([...el.options].some(o => o.value === previous)) el.value = previous;
  };
  const message = (text) => { if ($("catalogueAdminStatus")) $("catalogueAdminStatus").textContent = text; };
  const collegeName = c => c.college_name + (c.college_type === "autonomous" ? " · Autonomous" : c.college_type === "university" ? " · University" : " · Affiliated curriculum");
  const branchLabel = b => `${b.branch_code} — ${b.branch_name}`;

  async function loadBase() {
    const sb = client(); if (!sb) return;
    const [c,r,b,s] = await Promise.all([
      sb.from("academic_colleges").select("id,college_name,college_type,college_code").eq("is_active", true).order("college_name"),
      sb.from("academic_regulations").select("id,college_id,regulation_code,regulation_name,start_year,university_name").eq("is_active", true).order("start_year", {ascending:true}),
      sb.from("academic_branches").select("id,branch_code,branch_name").eq("is_active", true).order("branch_name"),
      sb.from("academic_semesters").select("id,semester_name,semester_code,semester_order").eq("is_active", true).order("semester_order")
    ]);
    for (const x of [c,r,b,s]) if (x.error) throw x.error;
    state.colleges=c.data||[]; state.regulations=r.data||[]; state.branches=b.data||[]; state.semesters=s.data||[];
    ["collegeS","collegeGuide","adminCollege","paperCollege"].forEach(id=>setOptions(id,state.colleges,collegeName,x=>x.id,"Select college / curriculum"));
    ["adminBranch"].forEach(id=>setOptions(id,state.branches,branchLabel,x=>x.id,"Select branch"));
    refreshBranches();
    ["adminSemester","paperSem","semS"].forEach(id=>setOptions(id,state.semesters,x=>x.semester_name,x=>x.id,"Select semester"));
    refreshRegulations();
    const jntua = state.colleges.find(x=>x.college_code==="JNTUA");
    const acep = state.colleges.find(x=>x.college_code==="JNTUACEP");
    if (jntua) $("collegeS").value=jntua.id;
    if (jntua) $("collegeGuide").value=jntua.id;
    if (jntua) $("paperCollege").value=jntua.id;
    refreshRegulations();
    bind();
    message("Catalogue connected. College-specific regulations and branch lists are loaded; only verified subject entries are displayed.");
  }
  function regsForCollege(collegeId) {
    // NULL college_id denotes the common JNTUA affiliated/non-autonomous curriculum.
    // Autonomous-college regulations are scoped to that college.
    const c=state.colleges.find(x=>x.id===collegeId);
    if (!c) return [];
    if (c.college_type==="autonomous") return state.regulations.filter(r=>r.college_id===collegeId);
    return state.regulations.filter(r=>!r.college_id && (r.university_name||"JNTUA")==="JNTUA");
  }
  function branchesForCollege(collegeId) {
    const college=state.colleges.find(x=>x.id===collegeId);
    if(college?.college_type==="autonomous") {
      const acepCodes=new Set(["CE","ECE","ME","EEE","CSE"]);
      return state.branches.filter(b=>acepCodes.has(String(b.branch_code||"").toUpperCase()));
    }
    return state.branches;
  }
  function refreshBranches() {
    const sgpaRows=branchesForCollege(val("collegeS"));
    const paperRows=branchesForCollege(val("paperCollege"));
    setOptions("branchS",sgpaRows,b=>({CE:"Civil Engineering",ECE:"Electronics and Communication Engineering",ME:"Mechanical Engineering",EEE:"Electrical and Electronics Engineering",CSE:"Computer Science and Engineering"}[String(b.branch_code).toUpperCase()]||branchLabel(b)),b=>b.id,"Select branch");
    setOptions("paperBranch",paperRows,branchLabel,b=>b.id,"Select branch");
  }
  function refreshRegulations() {
    refreshBranches();
    const pairs=[["regS","collegeS"],["regGuide","collegeGuide"],["paperReg","paperCollege"]];
    pairs.forEach(([rid,cid])=>{
      const allRows=regsForCollege(val(cid));
      const rows=allRows;
      const previous=$(rid)?.value;
      setOptions(rid,rows,r=>rid==="regS"?r.regulation_code:`${r.regulation_code} — ${r.regulation_name}`,r=>r.id,"Select regulation");
      if(rid==="regS") {
        const addOption=new Option("＋ Add Regulation","__add_regulation__");
        $(rid).add(addOption);
        if(previous && previous!=="__add_regulation__" && [...$(rid).options].some(o=>o.value===previous)) $(rid).value=previous;
      }
      const r20=rows.find(r=>r.regulation_code==="R20");
      const r23=rows.find(r=>r.regulation_code==="R23");
      const preferred=r23||r20;
      if (preferred && !val(rid)) $(rid).value=preferred.id;
    });
    loadSubjectsForSgpa().catch(console.error);
    loadPaperSubjects().catch(console.error);
    updateRegulationDetails();
    if($("guideBranch"))fillGuideBranches();
    if($("guideSubjectTable"))loadRegulationView();
  }
  async function subjectRows(collegeId, regulationId, branchId, semesterId) {
    const sb=client(); if(!sb||!regulationId||!branchId||!semesterId)return [];
    const q=sb.from("academic_subjects").select("id,subject_code,subject_name,credits,subject_type,regulation_id,branch_id,semester_id").eq("regulation_id",regulationId).eq("branch_id",branchId).eq("semester_id",semesterId).eq("is_active",true).order("subject_code");
    const {data,error}=await q; if(error)throw error;
    const rows=data||[];
    const {data:{user}}=await sb.auth.getUser();
    if(user && rows.length){
      const {data:overrides,error:overrideError}=await sb.from("academic_subject_credit_overrides").select("subject_id,credits").eq("user_id",user.id).in("subject_id",rows.map(x=>x.id));
      if(overrideError)throw overrideError;
      const map=new Map((overrides||[]).map(x=>[x.subject_id,Number(x.credits)]));
      rows.forEach(x=>{x.official_credits=Number(x.credits);x.personal_credits=map.has(x.id)?map.get(x.id):null;if(map.has(x.id))x.credits=map.get(x.id);});
    }else rows.forEach(x=>{x.official_credits=Number(x.credits);x.personal_credits=null;});
    return rows;
  }
  // Ignore older requests when students change regulation / semester / branch quickly.
  let sgpaLoadToken = 0;
  async function loadSubjectsForSgpa() {
    const token = ++sgpaLoadToken;
    if(!$("subjects"))return;
    const cid=val("collegeS"), rid=val("regS"), bid=val("branchS"), sid=val("semS");
    // Do not show subject rows until regulation, branch and semester are selected.
    // Clear stale/default rows so subjects from a previous selection cannot remain visible.
    const subjectTable=$("subjects").closest("table");
    const addButton=$("addSubject");
    if(!cid||!rid||!bid||!sid){
      $("subjects").replaceChildren();
      if(subjectTable)subjectTable.hidden=true;
      if(addButton)addButton.hidden=true;
      const note=document.querySelector("#page-sgpa .notice");
      if(note)note.textContent="Select regulation, branch and semester to display the subjects.";
      return;
    }
    if(subjectTable)subjectTable.hidden=true;
    if(addButton)addButton.hidden=true;
    try{
      const rows=await subjectRows(cid,rid,bid,sid);
      // Display order: Mathematics first, then other 3-credit subjects,
      // then remaining non-lab subjects, and all labs at the end.
      const isLab = s => /lab/i.test(String(s.subject_type||"")) || /\blab\b/i.test(String(s.subject_name||""));
      const isMath = s => /linear algebra|calculus|mathematics|maths/i.test(String(s.subject_name||""));
      const rank = s => isMath(s) ? 0 : isLab(s) ? 3 : Number(s.credits) >= 3 ? 1 : 2;
      rows.sort((a,b) => rank(a)-rank(b) || String(a.subject_code||"").localeCompare(String(b.subject_code||"")));
      // A slower earlier query must never overwrite the latest selection.
      if(token!==sgpaLoadToken || cid!==val("collegeS") || rid!==val("regS") || bid!==val("branchS") || sid!==val("semS"))return;
      if(!rows.length){
        $("subjects").replaceChildren();
        if(subjectTable)subjectTable.hidden=true;
        if(addButton)addButton.hidden=true;
        const note=document.querySelector("#page-sgpa .notice");
        if(note)note.textContent="No verified subjects are published for this selection yet.";
        return;
      }
      $("subjects").replaceChildren();
      rows.forEach(s=>window.addSubject?.(s.subject_name,s.credits,""));
      if(subjectTable)subjectTable.hidden=false;
      if(addButton)addButton.hidden=false;
      const note=document.querySelector("#page-sgpa .notice");
      if(note)note.textContent=`Loaded all ${rows.length} subjects for this regulation, semester and branch. Enter obtained credits and select grades.`;
      window.saveSgpaDraft?.();
    }catch(e){
      if(token===sgpaLoadToken)console.error("Could not load SGPA subjects:",e);
    }
  }
  async function loadPaperSubjects(){
    if(!$("paperSubject"))return;
    const rows=await subjectRows(val("paperCollege"),val("paperReg"),val("paperBranch"),val("paperSem"));
    const el=$("paperSubject"); const old=el.value;
    el.replaceChildren(new Option("All subjects",""));
    rows.forEach(s=>el.add(new Option(s.subject_name+" · "+Number(s.credits).toFixed(2).replace(/\.00$/,"")+" credits",s.subject_name)));
    if([...el.options].some(o=>o.value===old))el.value=old;
  }
  function updateRegulationDetails(){
    const guideRows=regsForCollege(val("collegeGuide"));
    const chips=$("regulationChips");
    if(chips){
      chips.replaceChildren();
      guideRows.forEach(reg=>{
        const chip=document.createElement("span");
        chip.className="reg-chip";
        chip.textContent=reg.regulation_code;
        chips.append(chip);
      });
    }
    const r=guideRows.find(x=>x.id===val("regGuide"));
    if($("regulationDetails"))$("regulationDetails").textContent=r?`${r.regulation_code}: ${r.regulation_name}. ${r.start_year ? "Starting year: "+r.start_year+". " : ""}Subject data is shown only after official course structures have been reviewed and published.`:"Choose a college and regulation.";
  }
  async function loadRegulationView(){
    const table=$("guideSubjectTable"), body=$("guideSubjectRows"), note=$("regulationDetails");
    if(!table||!body)return;
    const rid=val("regGuide"),bid=val("guideBranch"),sid=val("guideSemester");
    body.replaceChildren();table.hidden=true;
    if(!rid||!bid||!sid){note.textContent="Choose a regulation, branch and semester to view subjects.";return;}
    try{
      const rows=await subjectRows(val("collegeGuide"),rid,bid,sid);
      if(!rows.length){note.textContent="No subjects are published for this selection yet.";return;}
      const {data:{user}}=await client().auth.getUser();
      rows.forEach(subject=>{
        const tr=document.createElement("tr");
        const code=document.createElement("td");code.textContent=subject.subject_code||"—";
        const name=document.createElement("td");name.textContent=subject.subject_name;
        const official=document.createElement("td");official.textContent=Number(subject.official_credits??subject.credits).toFixed(2).replace(/\.00$/,"");
        const personal=document.createElement("td");
        if(user){
          const input=document.createElement("input");input.type="number";input.min="0";input.max="30";input.step="0.5";input.value=String(subject.credits);input.setAttribute("aria-label","Your personal credits for "+subject.subject_name);
          input.style.cssText="width:92px;min-width:75px";
          input.addEventListener("change",async()=>{
            const value=Number(input.value);
            if(!Number.isFinite(value)||value<0||value>30){input.value=String(subject.credits);return;}
            try{
              const {error}=await client().from("academic_subject_credit_overrides").upsert({user_id:user.id,subject_id:subject.id,credits:value,updated_at:new Date().toISOString()},{onConflict:"user_id,subject_id"});
              if(error)throw error;
              subject.credits=value;subject.personal_credits=value;
              note.textContent="Personal credit saved. Only your signed-in account sees this change; the official catalogue remains unchanged.";
              loadSubjectsForSgpa().catch(console.error);loadPaperSubjects().catch(console.error);
            }catch(e){note.textContent="Could not save personal credit: "+e.message;input.value=String(subject.credits);}
          });
          personal.append(input);
        }else personal.textContent=official.textContent+" (sign in to customise)";
        tr.append(code,name,official,personal);body.append(tr);
      });
      table.hidden=false;
      note.textContent=rows.length+" subjects loaded. "+(user?"Edit the Your credits column; changes are private to your account.":"Sign in with Google to set personal credits.");
    }catch(e){note.textContent="Could not load subjects: "+e.message;}
  }
  function fillGuideBranches(){
    const rows=branchesForCollege(val("collegeGuide"));
    setOptions("guideBranch",rows,branchLabel,x=>x.id,"Select branch");
    setOptions("guideSemester",state.semesters,x=>x.semester_name,x=>x.id,"Select semester");
  }
  function bind(){
    if (eventsBound) return;
    eventsBound = true;
    ["collegeS","collegeGuide","paperCollege"].forEach(id=>$(id)?.addEventListener("change",()=>{
      refreshRegulations();
      if(id==="collegeGuide"){fillGuideBranches();loadRegulationView();}
    }));
    ["guideBranch","guideSemester","regGuide"].forEach(id=>$(id)?.addEventListener("change",loadRegulationView));
    document.querySelectorAll("[data-reg-code]").forEach(button=>button.addEventListener("click",()=>{
      const reg=regsForCollege(val("collegeGuide")).find(x=>x.regulation_code===button.dataset.regCode);
      if(reg){$("regGuide").value=reg.id;document.querySelectorAll("[data-reg-code]").forEach(x=>x.classList.toggle("active",x===button));loadRegulationView();}
    }));
    $("regS")?.addEventListener("change",()=>{
      if($("regS").value==="__add_regulation__") {
        $("regS").value="";
        $("openRegWizard")?.click();
        return;
      }
      loadSubjectsForSgpa().catch(console.error);
    });
    ["branchS","semS"].forEach(id=>$(id)?.addEventListener("change",()=>loadSubjectsForSgpa().catch(console.error)));
    ["paperReg","paperBranch","paperSem"].forEach(id=>$(id)?.addEventListener("change",()=>loadPaperSubjects().catch(console.error)));
    $("regGuide")?.addEventListener("change",updateRegulationDetails);
  }
  async function ensurePdfJs(){
    if(window.pdfjsLib)return;
    await new Promise((resolve,reject)=>{
      const s=document.createElement("script");s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload=resolve;s.onerror=()=>reject(new Error("Could not load PDF reader. Connect to the internet and retry."));document.head.append(s);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
  async function extractPdf(){
    try{
      const file=$("regulationPdf")?.files?.[0]; if(!file||file.type!=="application/pdf")throw new Error("Choose an official PDF file first.");
      message("Reading PDF text…");
      await ensurePdfJs();
      const doc=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
      let all="";
      for(let p=1;p<=doc.numPages;p++){
        const page=await doc.getPage(p);const content=await page.getTextContent();
        all+="\n"+content.items.map(x=>x.str).join(" ");
      }
      state.pdfText=all;
      const code=val("adminRegCode").trim().toUpperCase();
      const branch=state.branches.find(x=>x.id===val("adminBranch"));
      const sem=state.semesters.find(x=>x.id===val("adminSemester"));
      const rows=[];
      // Conservative heuristic: extract likely code/name/credit rows; scanned PDFs need OCR and manual entry.
      const lines=all.split(/\n|(?<=\s{2,})/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
      const codeRx=/\b[A-Z]{1,5}[- ]?\d{2,4}[A-Z]?\b/;
      for(const line of lines){
        const m=line.match(codeRx); if(!m)continue;
        const creditMatches=[...line.matchAll(/\b([0-9]+(?:\.[05])?)\s*$/g)];
        if(!creditMatches.length)continue;
        const credits=Number(creditMatches[creditMatches.length-1][1]);
        if(!(credits>0&&credits<=10))continue;
        const subjectName=line.slice(m.index+m[0].length).replace(/^[\s:.-]+/,"").replace(/\s+\d+(?:\.\d+)?\s*$/,"").trim();
        if(subjectName.length<3)continue;
        rows.push({subject_code:m[0].replace(/\s/g,""),subject_name:subjectName,credits,subject_type:"Theory"});
      }
      state.extracted=rows.filter((x,i,a)=>a.findIndex(y=>y.subject_code===x.subject_code)===i);
      const box=$("extractedSubjects");box.replaceChildren();
      if(!state.extracted.length){
        box.textContent="No reliable subject rows were detected. This may be a scanned PDF or a different table layout. Add rows manually after checking the official PDF.";
      }else{
        const table=document.createElement("table");table.innerHTML="<thead><tr><th>Subject code</th><th>Subject name</th><th>Credits</th></tr></thead>";
        const body=document.createElement("tbody");
        state.extracted.forEach((x,i)=>{
          const tr=document.createElement("tr");
          [x.subject_code,x.subject_name,String(x.credits)].forEach((v,j)=>{
            const td=document.createElement("td"),input=document.createElement("input");input.value=v;input.addEventListener("input",()=>state.extracted[i][["subject_code","subject_name","credits"][j]]=j===2?Number(input.value):input.value);td.append(input);tr.append(td);
          });body.append(tr);
        });table.append(body);box.append(table);
      }
      $("publishRegulation").disabled=!state.extracted.length;
      message(`PDF read: ${doc.numPages} pages. Detected ${state.extracted.length} possible subject rows for ${branch?.branch_code||"selected branch"} / ${sem?.semester_name||"selected semester"}. Review every row before publishing.`);
    }catch(e){message("PDF extraction failed: "+e.message)}
  }
  async function publish(){
    const sb=client();if(!sb)return message("Supabase is not connected.");
    try{
      const {data:{user}}=await sb.auth.getUser();if(!user)throw new Error("Sign in with an authorised administrator account first.");
      const {data:admin,error:adminError}=await sb.from("academic_catalogue_admins").select("user_id").eq("user_id",user.id).maybeSingle();
      if(adminError)throw adminError;if(!admin)throw new Error("This Google/Supabase account is not listed as a catalogue administrator. Add its Supabase Auth UID in the admin table.");
      const collegeId=val("adminCollege"),code=val("adminRegCode").trim().toUpperCase(),name=val("adminRegName").trim();
      const branchId=val("adminBranch"),semesterId=val("adminSemester"),year=Number(val("adminStartYear"))||null;
      if(!collegeId||!code||!name||!branchId||!semesterId||!state.extracted.length)throw new Error("Complete college, regulation, branch, semester and extracted subjects.");
      const college=state.colleges.find(x=>x.id===collegeId);
      const regPayload={college_id:college?.college_type==="autonomous"?collegeId:null,university_name:"JNTUA",regulation_code:code,regulation_name:name,start_year:year,is_active:true};
      // Avoid NULL-composite-key upsert ambiguity for common JNTUA regulations.
      const existingQuery=sb.from("academic_regulations").select("id").eq("regulation_code",code);
      const {data:existingRows,error:lookupError}=regPayload.college_id
        ? await existingQuery.eq("college_id",regPayload.college_id).limit(1)
        : await existingQuery.is("college_id",null).limit(1);
      if(lookupError)throw lookupError;
      let reg;
      if(existingRows?.length){
        const {data,error}=await sb.from("academic_regulations").update({regulation_name:name,start_year:year,is_active:true,university_name:"JNTUA"}).eq("id",existingRows[0].id).select().single();
        if(error)throw error; reg=data;
      }else{
        const {data,error}=await sb.from("academic_regulations").insert(regPayload).select().single();
        if(error)throw error; reg=data;
      }
      const payload=state.extracted.map(x=>({regulation_id:reg.id,branch_id:branchId,semester_id:semesterId,subject_code:String(x.subject_code).trim(),subject_name:String(x.subject_name).trim(),credits:Number(x.credits),subject_type:x.subject_type||"Theory",is_active:true}));
      const {error:subError}=await sb.from("academic_subjects").upsert(payload,{onConflict:"regulation_id,branch_id,semester_id,subject_code"});
      if(subError)throw subError;
      message(`Published ${payload.length} subjects for ${code}. Reloading shared catalogue…`);
      const fresh=await sb.from("academic_regulations").select("*").eq("is_active",true).order("start_year");
      if(!fresh.error)state.regulations=fresh.data||[];
      refreshRegulations();
    }catch(e){message("Publish failed: "+e.message)}
  }

  // Keep long subject names readable in the SGPA table and let them wrap naturally.
  const wrapStyle = document.createElement("style");
  wrapStyle.textContent = `
    #page-sgpa #subjects td:first-child { width:42%; white-space:normal; overflow-wrap:anywhere; word-break:normal; line-height:1.35; }
    #page-sgpa #subjects td:first-child textarea { display:block; box-sizing:border-box; white-space:pre-wrap; overflow-wrap:anywhere; min-width:0; width:100%; height:48px; min-height:48px; max-height:48px; overflow-y:auto; resize:none; font:inherit; line-height:1.35; }
    #page-sgpa #subjects td:nth-child(2) { width:16%; }
    #page-sgpa #subjects td:nth-child(3) { width:30%; }
    #page-sgpa #subjects td:last-child { width:12%; }
    #page-sgpa #subjects input[type=number] { min-width:60px; }
  `;
  document.head.appendChild(wrapStyle);
  // V4 wizard compatibility: retain the original catalogue implementation and expose a safe reload hook.
  window.JSHV4 = {
    reload: () => loadBase(),
    branches: () => state.branches,
    semesters: () => state.semesters,
    regulations: () => state.regulations
  };
  window.addEventListener("supabase-ready",()=>loadBase().catch(e=>message("Catalogue error: "+e.message)));
  if(client())loadBase().catch(e=>message("Catalogue error: "+e.message));
  // A periodic read refreshes published regulation choices; it does not crawl external websites.
  setInterval(()=>{if(client())loadBase().catch(()=>{});},6*60*60*1000);
})();
