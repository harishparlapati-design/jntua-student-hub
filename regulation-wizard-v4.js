/* Advanced regulation wizard V4: one regulation, many branch/semester batches. */
(()=>{"use strict";
 const $=id=>document.getElementById(id), sb=()=>window.supabaseClient;
 let branches=[],semesters=[],batch=[],allSubjects=[],pdfLibReady=false;
 const say=t=>{if($("v4Status"))$("v4Status").textContent=t};
 const modal=open=>$("regWizard")?.classList.toggle("open",open);
 const branchCode=()=> $("v4Branch").value;
 function addRow(name="",credits=""){
  const tr=document.createElement("tr");tr.innerHTML=`<td class="rownum"></td><td><input class="v4name" placeholder="Subject name"></td><td><input class="v4credits" type="number" min="0.5" step="0.5" placeholder="Credits"></td><td><button type="button" class="btn danger mini">Remove</button></td>`;
  tr.querySelector(".v4name").value=name;tr.querySelector(".v4credits").value=credits;tr.querySelector("button").onclick=()=>{tr.remove();renumber()};$("v4SubjectRows").append(tr);renumber();
 }
 function renumber(){[...$("v4SubjectRows").children].forEach((r,i)=>r.querySelector(".rownum").textContent=i+1)}
 function currentRows(){return [...$("v4SubjectRows").querySelectorAll("tr")].map(tr=>({subject_name:tr.querySelector(".v4name").value.trim(),credits:Number(tr.querySelector(".v4credits").value)})).filter(x=>x.subject_name)}
 function saveBatch(){
  const sem=$("v4Semester").value,branch=branchCode(),rows=currentRows();
  if(!sem||!branch||!rows.length)throw Error("Select semester and branch, then enter at least one subject.");
  if(rows.some(x=>!(x.credits>0)))throw Error("Every subject must have credits greater than zero.");
  const key=sem+"|"+branch;batch=batch.filter(x=>x.key!==key);batch.push({key,semester:sem,branch,subjects:rows});
  say(`Saved locally: ${sem} · ${$("v4Branch").selectedOptions[0]?.textContent}. ${rows.length} subjects. Choose the next branch/semester and continue.`);
 }
 function resetRows(){ $("v4SubjectRows").replaceChildren();addRow(); }
 async function pdfjs(){
  if(window.pdfjsLib)return;
  await new Promise((resolve,reject)=>{const s=document.createElement("script");s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";s.onload=resolve;s.onerror=reject;document.head.append(s)});
  pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
 }
 async function scan(){
  const f=$("v4Pdf").files[0];if(!f)return say("Choose a PDF first.");
  try{
   say("Scanning PDF text…");await pdfjs();const doc=await pdfjsLib.getDocument({data:await f.arrayBuffer()}).promise;let text="";
   for(let p=1;p<=doc.numPages;p++){const page=await doc.getPage(p),c=await page.getTextContent();text+="\n"+c.items.map(i=>i.str).join(" ")}
   const detected=[];
   // Conservative parser: code + title + trailing credit; review is mandatory.
   for(const line of text.split(/\n/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean)){
    const code=line.match(/\b[A-Z]{1,5}[- ]?\d{2,4}[A-Z]?\b/),credit=line.match(/\b(\d+(?:\.\d+)?)\s*$/);
    if(!code||!credit)continue;const title=line.slice(code.index+code[0].length).replace(/^[\s:.-]+/,"").replace(/\s+\d+(?:\.\d+)?$/,"").trim(),cr=Number(credit[1]);
    if(title.length>2&&cr>0&&cr<=10)detected.push({subject_name:title,credits:cr});
   }
   const uniq=detected.filter((x,i,a)=>a.findIndex(y=>y.subject_name===x.subject_name)===i);
   if(!uniq.length){say("No subjects detected. This may be a scanned PDF or complex table. Add entries manually; scanned-image OCR is not included in this build.");return}
   $("v4SubjectRows").replaceChildren();uniq.forEach(x=>addRow(x.subject_name,x.credits));
   say(`Detected ${uniq.length} possible subjects from ${doc.numPages} pages. Check and edit every subject and credit. PDF extraction is an estimate, not verified data.`);
  }catch(e){say("PDF scan failed: "+e.message)}
 }
 async function publish(){
  const client=sb();if(!client)return say("Supabase is not connected.");
  try{
   if(!batch.length)saveBatch();
   const code=$("v4RegCode").value.trim().toUpperCase(),year=Number($("v4StartYear").value)||null;
   if(!/^R\d{2,4}$/i.test(code))throw Error("Enter a regulation code such as R26.");
   if(!year)throw Error("Enter the starting year.");
   const {data:{user},error:authErr}=await client.auth.getUser();if(authErr)throw authErr;if(!user)throw Error("Supabase Auth administrator login is required. Google Drive sign-in alone does not authorise publishing.");
   const {data:admin,error:adminErr}=await client.from("academic_catalogue_admins").select("user_id").eq("user_id",user.id).maybeSingle();if(adminErr)throw adminErr;if(!admin)throw Error("Your Supabase Auth UID is not registered as an academic catalogue administrator.");
   const {data:old,error:findErr}=await client.from("academic_regulations").select("id").is("college_id",null).eq("regulation_code",code).limit(1);if(findErr)throw findErr;
   let reg;
   if(old?.length){const q=await client.from("academic_regulations").update({regulation_name:code,start_year:year,is_active:true,university_name:"JNTUA"}).eq("id",old[0].id).select().single();if(q.error)throw q.error;reg=q.data}
   else{const q=await client.from("academic_regulations").insert({college_id:null,university_name:"JNTUA",regulation_code:code,regulation_name:code,start_year:year,is_active:true}).select().single();if(q.error)throw q.error;reg=q.data}
   const bmap=branches, smap=semesters, payload=[];
   for(const group of batch){
    const b=bmap.find(x=>x.branch_code===group.branch||x.branch_name.toLowerCase()===group.branch.toLowerCase());
    const s=smap.find(x=>x.semester_code===group.semester||x.semester_name===group.semester);
    if(!b||!s)throw Error(`Branch/semester mapping missing for ${group.branch} / ${group.semester}. Check academic_branches and academic_semesters tables.`);
    group.subjects.forEach((x,i)=>payload.push({regulation_id:reg.id,branch_id:b.id,semester_id:s.id,subject_code:`${code}-${b.branch_code}-${group.semester}-${i+1}`,subject_name:x.subject_name,credits:x.credits,subject_type:"Theory",is_active:true}));
   }
   // Upsert each unique subject key after de-duplication.
   const dedup=[...new Map(payload.map(x=>[`${x.regulation_id}|${x.branch_id}|${x.semester_id}|${x.subject_code}`,x])).values()];
   const {error:subErr}=await client.from("academic_subjects").upsert(dedup,{onConflict:"regulation_id,branch_id,semester_id,subject_code"});if(subErr)throw subErr;
   say(`Published ${code} with ${batch.length} branch/semester groups and ${dedup.length} subjects. Refreshing student selectors…`);
   await window.JSHV4?.reload();modal(false);
  }catch(e){say("Publish failed: "+e.message)}
 }
 document.addEventListener("DOMContentLoaded",async()=>{
  const open=()=>{modal(true);if(!$("v4SubjectRows").children.length)addRow()};
  $("openRegWizard")?.addEventListener("click",open);$("closeRegWizard")?.addEventListener("click",()=>modal(false));
  $("regWizard")?.addEventListener("click",e=>{if(e.target===$("regWizard"))modal(false)});
  $("v4AddRow")?.addEventListener("click",()=>addRow());
  $("v4Scan")?.addEventListener("click",scan);
  $("v4SaveNext")?.addEventListener("click",()=>{try{saveBatch();$("v4Semester").value="";$("v4Branch").value="";resetRows()}catch(e){say(e.message)}});
  $("v4Publish")?.addEventListener("click",publish);
  try{
   const [b,s]=await Promise.all([sb().from("academic_branches").select("*").eq("is_active",true).order("branch_name"),sb().from("academic_semesters").select("*").eq("is_active",true).order("semester_order")]);
   if(b.error)throw b.error;if(s.error)throw s.error;branches=b.data||[];semesters=s.data||[];
   const branch=$("v4Branch");branch.replaceChildren(new Option("Select branch",""));branches.forEach(x=>branch.add(new Option(`${x.branch_name} (${x.branch_code})`,x.branch_code)));
   const sem=$("v4Semester");sem.replaceChildren(new Option("Select semester",""));semesters.forEach(x=>sem.add(new Option(x.semester_name,x.semester_code)));
  }catch(e){say("Could not load branch/semester lists: "+e.message)}
 });
})();
