/* JNTUA Student Hub enhancements — free, client-side OCR.
Add before </body> in index.html:
<script src="./sgpa-enhancements.js"></script>
*/
(() => {
  const $ = id => document.getElementById(id);
  const gradePoints = {"A+":10,"A":9,"B":8,"C":7,"D":6,"E":5,"F":0,"AB":0,"MP":0};
  const table = $("subjects")?.closest("table");
  if (!table) return;
  const head = table.querySelector("thead tr");
  if (head) head.innerHTML = "<th>Subject name</th><th>Max credits</th><th>Obtained credits</th><th>Grade</th><th></th>";

  const oldAddSubject = window.addSubject;
  window.addSubject = function(name="", credits="", grade="", obtained="") {
    oldAddSubject(name, credits, grade);
    const row = $("subjects").lastElementChild;
    if (!row) return;
    const cells = row.querySelectorAll("td");
    if (cells.length < 4 || row.dataset.enhanced === "yes") return;
    row.dataset.enhanced = "yes";
    const creditInput = cells[1].querySelector("input");
    const gradeSelect = cells[2].querySelector("select");
    const td = document.createElement("td");
    const obtainedInput = document.createElement("input");
    obtainedInput.type = "number"; obtainedInput.min = "0"; obtainedInput.max = "30";
    obtainedInput.step = ".5"; obtainedInput.placeholder = "Auto";
    obtainedInput.setAttribute("aria-label", "Obtained credits");
    obtainedInput.value = obtained === "" ? "" : obtained;
    obtainedInput.title = "Editable. Defaults to max credits for passing grades and 0 for F/AB/MP.";
    td.appendChild(obtainedInput);
    row.insertBefore(td, cells[2]);
    const sync = () => {
      if (obtainedInput.dataset.edited === "yes") return;
      const gp = Number(gradeSelect.value), max = Number(creditInput.value);
      obtainedInput.value = Number.isFinite(gp) && gp > 0 && max > 0 ? String(max) : "0";
    };
    obtainedInput.addEventListener("input", () => { obtainedInput.dataset.edited = "yes"; window.saveSgpaDraft?.(); });
    creditInput.addEventListener("input", sync);
    gradeSelect.addEventListener("change", sync);
    sync();
  };

  // Upgrade rows that the original page created before this add-on loaded.
  const initialRows = [...$("subjects").querySelectorAll("tr")].map(row => {
    const a = row.querySelectorAll("input");
    return {name:a[0]?.value||"", credits:a[1]?.value||"", grade:row.querySelector("select")?.value??""};
  });
  $("subjects").innerHTML = "";
  initialRows.forEach(row => window.addSubject(row.name, row.credits, row.grade));

  const oldCollect = window.collectSgpaDraft;
  if (typeof oldCollect === "function") window.collectSgpaDraft = function() {
    const d = oldCollect();
    d.subjects = [...$("subjects").querySelectorAll("tr")].map(row => {
      const a = row.querySelectorAll("input");
      return {name:a[0]?.value||"", credits:a[1]?.value||"", obtainedCredits:a[2]?.value||"", grade:row.querySelector("select")?.value??""};
    });
    return d;
  };
  const oldApply = window.applySgpaDraft;
  if (typeof oldApply === "function") window.applySgpaDraft = function(d) {
    if (!d || !Array.isArray(d.subjects)) return oldApply(d);
    const saved = d.subjects;
    oldApply({...d, subjects:saved.map(s=>({name:s.name||"",credits:s.credits??"",grade:s.grade??""}))});
    [...$("subjects").querySelectorAll("tr")].forEach((row,i)=>{
      const input=row.querySelectorAll("input")[2], value=saved[i]?.obtainedCredits;
      if(input && value!==undefined && value!==""){input.value=value;input.dataset.edited="yes";}
    });
  };

  const totals=document.createElement("div");
  totals.className="notice"; totals.id="creditTotals"; totals.style.marginTop="10px";
  table.parentElement.insertAdjacentElement("afterend",totals);
  function updateTotals(){
    let max=0,got=0;
    $("subjects").querySelectorAll("tr").forEach(row=>{
      const a=row.querySelectorAll("input"); max+=Number(a[1]?.value)||0; got+=Number(a[2]?.value)||0;
    });
    totals.textContent=`Total max credits: ${max.toFixed(2).replace(/\.00$/,"")} · Total obtained credits: ${got.toFixed(2).replace(/\.00$/,"")}`;
  }
  $("subjects").addEventListener("input",updateTotals);
  $("subjects").addEventListener("change",updateTotals);
  new MutationObserver(updateTotals).observe($("subjects"),{childList:true});
  updateTotals();

  const actions=$("addSubject")?.parentElement;
  if(!actions) return;
  const label=document.createElement("label");
  label.className="btn secondary"; label.style.display="inline-flex"; label.style.alignItems="center";
  label.style.cursor="pointer"; label.textContent="📷 Scan marks memo";
  const file=document.createElement("input"); file.type="file"; file.accept="image/*"; file.capture="environment"; file.style.display="none";
  label.appendChild(file); actions.insertBefore(label,$("calcSgpa"));
  const status=document.createElement("p"); status.className="sub"; status.setAttribute("aria-live","polite");
  actions.insertAdjacentElement("afterend",status);

  file.addEventListener("change",async()=>{
    const image=file.files?.[0]; if(!image)return;
    if(!window.Tesseract){
      status.textContent="Loading free OCR engine… Internet is needed for the first load.";
      const script=document.createElement("script"); script.src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      script.onload=()=>runOCR(image); script.onerror=()=>status.textContent="OCR engine failed to load. Check internet and try again.";
      document.head.appendChild(script);
    } else runOCR(image);
  });
  async function runOCR(image){
    status.textContent="Reading memo… Keep this page open. OCR can make mistakes.";
    try{
      const result=await Tesseract.recognize(image,"eng");
      const parsed=[];
      for(const line of result.data.text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)){
        const m=line.match(/\b(A\+|A|B|C|D|E|F|AB|MP)\b/i); if(!m)continue;
        const grade=m[1].toUpperCase(), name=line.replace(m[0],"").replace(/\s{2,}/g," ").replace(/^[\W_]*\d{1,3}[\s.)-]+/,"").trim();
        if(name.length>=3 && name.length<=100)parsed.push({name,grade,points:gradePoints[grade]??0});
      }
      if(!parsed.length){status.textContent="No likely subject/grade rows found. Try a clear, straight, well-lit memo photo.";return;}
      if(!confirm(`OCR found ${parsed.length} possible rows. Import for review? OCR may be wrong; verify all names, grades and credits.`)){status.textContent="Import cancelled.";return;}
      parsed.forEach(x=>window.addSubject(x.name,"",String(x.points),"0"));
      window.saveSgpaDraft?.(); updateTotals();
      status.textContent=`Imported ${parsed.length} possible rows. Verify every row and enter max credits before calculating SGPA.`;
    }catch(e){console.error(e);status.textContent="OCR failed. Try another image or enter the marks manually."}
    finally{file.value=""}
  }
})();
