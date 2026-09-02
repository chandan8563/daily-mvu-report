let state=null;let reportMode='evening';const $=id=>document.getElementById(id);
function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function n(x){return Number(x||0).toLocaleString('en-IN')}function pct(x){return `${Math.round(Number(x||0))}%`}
function render(){
  if(!state||!state.report)return;
  const dk=$('dateSelect').value;
  const d=state.report[dk];
  if(!d)return;
  const morning = reportMode === 'morning';
  const districts=d.districts&&typeof d.districts==='object'?d.districts:{};
  const st=d.state&&typeof d.state==='object'?d.state:{received:0,attend:0,localVet:0,death:0,grandTotal:0,offRoadPct:0};
  // Morning and Evening use the SAME underlying case data.
  // Morning changes ONLY the displayed calculation: Received and Attend stay
  // exactly as Evening; Other Source = 0, Animal Death = 0, Grand Total = Attend.
  const display = r => { const received=Number(r.received||0), attend=Number(r.attend||0); return morning ? {received, attend, other:0, death:0, grandTotal:attend} : {received, attend, other:Number(r.localVet||0), death:Number(r.death||0), grandTotal:Number(r.grandTotal||0)}; };
  const displayTotals = g => { const received=Number(g.received||0), attend=Number(g.attend||0); return morning ? {received, attend, other:0, death:0, grandTotal:attend} : {received, attend, other:Number(g.localVet||0), death:Number(g.death||0), grandTotal:Number(g.grandTotal||0)}; };
  const displayState = morning ? {received:Number(st.received||0), attend:Number(st.attend||0), other:0, death:0, grandTotal:Number(st.attend||0)} : {received:Number(st.received||0), attend:Number(st.attend||0), other:Number(st.localVet||0), death:Number(st.death||0), grandTotal:Number(st.grandTotal||0)};
  updateModeButtons();
  const subtitle=$('reportSubtitle'); if(subtitle) subtitle.textContent=d.label||dk;
  // Keep the reference-report structure: ONE continuous table with merged
  // Division, District and % Off Road Vehicle cells. Paravet/Week Off remain hidden.
  const hospital=Array.isArray(state.hospital)?state.hospital:[];
  const h=hospital.filter(x=>x&&x.__date===dk);
  $('hospital').innerHTML=h.length?`<h3>🔔 Hospital Area Update</h3><p><b>${esc(d.label||dk)}</b></p><div class="hospital-item"><strong>${n(h.length)} Hospital Area Tickets</strong><div class="hospital-actions"><button onclick="location.href='/api/hospital/download/${encodeURIComponent(dk)}'">Download</button></div></div>`:'';

  const missing=Array.isArray(state.missing)?state.missing:[];
  $('missing').innerHTML=missing.length?`<div class="missing"><b>⚠ ParavetID Not Found in Master Data</b><div style="overflow:auto;margin-top:10px"><table><tr><th>Sr.No.</th><th>Division</th><th>District</th><th>Block</th><th>MVU Number</th><th>Paravet Name</th><th>ParavetID</th><th>Ticket ID</th></tr>${missing.map(r=>`<tr><td>${esc(r['Sr.No.'])}</td><td>${esc(r.Division)}</td><td>${esc(r.District)}</td><td>${esc(r.Block)}</td><td>${esc(r['MVU Number'])}</td><td>${esc(r['Paravet Name'])}</td><td>${esc(r.ParavetID)}</td><td>${esc(r['Ticket ID'])}</td></tr>`).join('')}</table></div></div>`:'';

  const districtEntries=Object.entries(districts);
  const divisionGroups=[];
  for(const [district,g0] of districtEntries){
    const g=g0||{};
    const division=String(g.division||'').trim()||'—';
    let group=divisionGroups.find(x=>x.division===division);
    if(!group){group={division,districts:[]};divisionGroups.push(group)}
    group.districts.push({district,g});
  }

  let html=`<div class="report-table-wrap"><table class="report-table"><thead><tr>
    <th>Sr.No.</th><th>Division</th><th>District</th><th>Block</th><th>Vehicle Number</th>
    <th>Case Received on ${esc(d.label||dk)}</th><th>Case Attend By MVU ${esc(d.label||dk)}</th>
    <th>Case attend by other source</th><th>Animal Death ( Before Arrival of MVU)</th><th>Grand Total</th>
    <th>Remark</th><th>% of Off Road Vehicle</th>
  </tr></thead><tbody>`;

  let globalSr=1;
  for(const divGroup of divisionGroups){
    const divRowCount=divGroup.districts.reduce((sum,{g})=>(sum+(Array.isArray(g.rows)?g.rows.length:0)+1),0);
    let divCell=true;
    for(const {district,g} of divGroup.districts){
      const rows=Array.isArray(g.rows)?g.rows:[];
      const districtRowSpan=rows.length+1;
      for(const r of rows){
        html+=`<tr>`;
        html+=`<td>${globalSr++}</td>`;
        if(divCell){html+=`<td class="merged division-cell" rowspan="${divRowCount}">${esc(divGroup.division)}</td>`;divCell=false}
        if(r===rows[0]) html+=`<td class="merged district-cell" rowspan="${districtRowSpan}">${esc(district)}</td>`;
        const v=display(r); const remark=r.remark==='Week off'?'<span class="status-chip week-off">Week off</span>':r.remark==='Case not received'?'<span class="status-chip not-received">Case not received</span>':''; html+=`<td>${esc(r.block)}</td><td>${esc(r.vehicle)}</td><td>${n(v.received)}</td><td>${n(v.attend)}</td><td>${n(v.other)}</td><td>${n(v.death)}</td><td>${n(v.grandTotal)}</td><td>${remark}</td>`;
        if(r===rows[0]) html+=`<td class="merged pct-cell" rowspan="${districtRowSpan}">${pct(g.offRoadPct)}</td>`;
        html+=`</tr>`;
      }
      const gt=displayTotals(g); html+=`<tr class="district-total"><td></td><td class="total-label">DISTRICT TOTAL</td><td>${n(rows.length)}</td><td>${n(gt.received)}</td><td>${n(gt.attend)}</td><td>${n(gt.other)}</td><td>${n(gt.death)}</td><td>${n(gt.grandTotal)}</td><td></td></tr>`;
    }
    const divReceived=divGroup.districts.reduce((a,x)=>a+Number(x.g.received||0),0);
    const divAttend=divGroup.districts.reduce((a,x)=>a+Number(x.g.attend||0),0);
    const divOther=divGroup.districts.reduce((a,x)=>a+Number(x.g.localVet||0),0);
    const divDeath=divGroup.districts.reduce((a,x)=>a+Number(x.g.death||0),0);
    const divGrand=divGroup.districts.reduce((a,x)=>a+Number(x.g.grandTotal||0),0);
    const divDisplay={received:divReceived,attend:divAttend,other:divOther,death:divDeath,grandTotal:divGrand};
    const divMvu=divGroup.districts.reduce((a,x)=>a+Number(x.g.totalMvu||0),0);
    html+=`<tr class="division-total"><td></td><td></td><td></td><td class="total-label">DIVISION TOTAL</td><td>${n(divMvu)}</td><td>${n(divDisplay.received)}</td><td>${n(divDisplay.attend)}</td><td>${n(divDisplay.other)}</td><td>${n(divDisplay.death)}</td><td>${n(divDisplay.grandTotal)}</td><td></td><td></td></tr>`;
  }

  const stateDisplay=displayState; html+=`<tr class="state-total"><td></td><td></td><td></td><td class="total-label">STATE TOTAL</td><td>${n(Object.values(districts).reduce((a,g)=>a+Number(g.totalMvu||0),0))}</td><td>${n(stateDisplay.received)}</td><td>${n(stateDisplay.attend)}</td><td>${n(stateDisplay.other)}</td><td>${n(stateDisplay.death)}</td><td>${n(stateDisplay.grandTotal)}</td><td></td><td></td></tr>`;
  html+=`</tbody></table></div><div class="report-download"><button onclick="location.href='/api/report/download/${encodeURIComponent(dk)}?mode=${reportMode}'">📥 Download ${morning?'Morning':'Evening'} Report</button></div>`;
  $('tableWrap').innerHTML=html;
}

function updateModeButtons(){
  const m=$('morningBtn'), e=$('eveningBtn');
  if(m)m.classList.toggle('active',reportMode==='morning');
  if(e)e.classList.toggle('active',reportMode==='evening');
}
function setReportMode(mode){
  reportMode = mode === 'morning' ? 'morning' : 'evening';
  render();
}
function downloadCurrentPDF(){ const dk=$('dateSelect')?.value; if(!dk) return; location.href='/api/report/download/'+encodeURIComponent(dk)+'?mode='+reportMode; }
async function init(){try{state=JSON.parse(sessionStorage.getItem('mvuReportResult')||'null');if(!state){const r=await fetch('/api/report');if(r.ok)state=await r.json()}if(!state||!state.report){document.getElementById('empty').textContent='No report available. Upload a Detailed Report first.';return}const s=$('dateSelect');s.innerHTML='';(state.dateLabels||[]).forEach((label,i)=>{const o=document.createElement('option');o.value=(state.dates||[])[i]||'';o.textContent=label;s.appendChild(o)});if((state.dates||[]).length)s.value=state.dates[0];const e=$('empty');if(e)e.style.display='none';render()}catch(e){console.error(e);document.getElementById('empty').textContent=e.message||'Unable to load report.'}}
init();
