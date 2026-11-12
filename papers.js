(() => {
  const $ = id => document.getElementById(id);
  let supabase = null, currentUser = null;
  const status = (id,msg) => { const el=$(id); if(el)el.textContent=msg; };
  const getLabel=(id)=>$(id)?.selectedOptions?.[0]?.textContent||"";
  function initialize(client){
    if(supabase)return;supabase=client;
    supabase.auth.onAuthStateChange((_event,session)=>{currentUser=session?.user||null;});
    supabase.auth.getSession().then(({data})=>{currentUser=data.session?.user||null;});
    $("paperUpload")?.addEventListener("click",upload);
    $("searchPapers")?.addEventListener("click",searchPapers);
  }
  function wait(){if(window.supabaseClient)initialize(window.supabaseClient);else window.addEventListener("supabase-ready",()=>window.supabaseClient&&initialize(window.supabaseClient),{once:true});}
  async function selected(){
    const regulationId=$("paperReg").value, branchId=$("paperBranch").value, semester=$("paperSem").value;
    if(!regulationId||!branchId||!semester)throw new Error("Select regulation, semester and branch.");
    const {data:reg,error}=await supabase.from("academic_regulations").select("regulation_code").eq("id",regulationId).single();if(error)throw error;
    const {data:branch,error:be}=await supabase.from("academic_branches").select("branch_code").eq("id",branchId).single();if(be)throw be;
    const {data:subjects,error:se}=await supabase.from("academic_subjects").select("subject_code,subject_name").eq("regulation_id",regulationId).eq("branch_id",branchId).eq("semester_id",semester).eq("is_active",true);if(se)throw se;
    return {regulation:reg.regulation_code,semester,branch:branch.branch_code,subjects:subjects||[]};
  }
  async function upload(){
    try{
      if(!supabase)throw new Error("Supabase is still loading.");
      const file=$("paperFile")?.files?.[0];if(!file)throw new Error("Choose a question paper first.");
      if(file.size>50*1024*1024)throw new Error("Maximum file size is 50 MB.");
      if(!["application/pdf","image/jpeg","image/png","image/webp"].includes(file.type))throw new Error("Only PDF, JPG, PNG and WEBP files are allowed.");
      const s=await selected(), subject=$("paperSubject").value;
      if(!subject)throw new Error("Choose a subject before uploading.");
      if(!s.subjects.some(x=>x.subject_name===subject))throw new Error("This subject is not in the published catalogue.");
      status("paperUploadStatus","Uploading paper…");
      const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,"_"),folder=currentUser?currentUser.id:"public-inbox",path=`${folder}/${Date.now()}_${safe}`;
      const {error:up}=await supabase.storage.from("question-papers").upload(path,file,{cacheControl:"3600",upsert:false,contentType:file.type});if(up)throw up;
      const {data:sub}=await supabase.from("academic_subjects").select("id,subject_code").eq("regulation_id",$("paperReg").value).eq("branch_id",$("paperBranch").value).eq("semester_id",$("paperSem").value).eq("subject_name",subject).single();
      const {error:ins}=await supabase.from("question_papers").insert({regulation:s.regulation,semester:s.semester,branch:s.branch,subject_name:subject,subject_code:sub?.subject_code||null,file_name:file.name,file_path:path,file_type:file.type,uploaded_by:currentUser?.id||null});
      if(ins){await supabase.storage.from("question-papers").remove([path]);throw ins;}
      status("paperUploadStatus","Paper uploaded successfully.");$("paperFile").value="";await searchPapers();
    }catch(e){status("paperUploadStatus","Upload failed: "+e.message);}
  }
  async function searchPapers(){
    try{
      if(!supabase)throw new Error("Supabase is still loading.");
      const s=await selected();status("paperResults","Searching…");
      let q=supabase.from("question_papers").select("*").eq("regulation",s.regulation).eq("semester",s.semester).eq("branch",s.branch).order("created_at",{ascending:false});
      if($("paperSubject").value)q=q.eq("subject_name",$("paperSubject").value);
      const {data,error}=await q;if(error)throw error;
      const root=$("paperResults");root.replaceChildren();
      if(!data?.length){root.textContent="No question papers found.";return;}
      data.forEach(p=>{
        const item=document.createElement("div");item.className="record";
        const detail=document.createElement("div"),name=document.createElement("strong"),info=document.createElement("small");
        name.textContent=p.subject_name;info.textContent=`${p.file_name} · ${p.regulation} · ${p.semester} · ${p.branch}`;detail.append(name,info);
        const a=document.createElement("a");a.textContent="View / Download";a.href="#";a.onclick=e=>{e.preventDefault();const {data:u}=supabase.storage.from("question-papers").getPublicUrl(p.file_path);if(u?.publicUrl)window.open(u.publicUrl,"_blank","noopener");};
        item.append(detail,a);root.append(item);
      });
    }catch(e){status("paperResults","Search failed: "+e.message);}
  }
  wait();
})();
