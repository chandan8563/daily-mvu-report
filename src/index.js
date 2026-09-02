const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
const MASTER_FILE = path.join(ROOT, 'data', 'master.json');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
let runtimeEnv = null;
let workerMasterCache = [];
function setRuntimeEnv(env) { runtimeEnv = env || null; }

app.use(express.json({ limit: '5mb' }));
if (globalThis.CLOUDFLARE_WORKER !== true) app.use(express.static(path.join(ROOT, 'public')));

const aliases = {
  created: ['CreatedDateTime', 'Created DateTime', 'Created Date', 'Date'],
  paravetId: ['ParavetID', 'Paravet ID', 'Pravet ID', 'ParavetId'],
  ticketId: ['Ticket ID', 'TicketID', 'Ticket Id'],
  levelType: ['LevelType', 'Level Type'],
  enquiry: ['Enquiry', 'Enquiry Type', 'Type'],
  closeRemarks: ['CloseRemarks', 'Close Remarks'],
  subStatus: ['SubStatus', 'Sub Status', 'Status'],
  division: ['Division'],
  district: ['District'],
  block: ['Block'],
  vehicle: ['Vehicle Number', 'VehicleNumber', 'MVU Number', 'MVU Number '],
  paravetName: ['Paravet Name', 'ParavetName', 'Pravet Name', 'Paravet'],
  source: ['Source', 'Treated By', 'Attend Source']
};

function norm(v) { return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' '); }
function keyNorm(v) { return norm(v).replace(/[^a-z0-9]/g, ''); }
function pick(row, names) {
  if (!row || typeof row !== 'object') return '';
  const keys = Object.keys(row);
  for (const name of names) {
    const exact = keys.find(k => keyNorm(k) === keyNorm(name));
    if (exact !== undefined) return row[exact];
  }
  return '';
}
function parseDate(v) {
  if (v instanceof Date && !isNaN(v)) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return new Date(d.y, d.m - 1, d.d);
  }
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = s.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const iso = new Date(s);
  return isNaN(iso) ? null : new Date(iso.getFullYear(), iso.getMonth(), iso.getDate());
}
function dateKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function displayDate(d) { return `${String(d.getDate()).padStart(2,'0')}-${d.toLocaleString('en-IN',{month:'long'})}-${d.getFullYear()}`; }
function excelDateLabel(d) { return `${String(d.getDate()).padStart(2,'0')}-${d.toLocaleString('en-IN',{month:'long'})}'${d.getFullYear()}`; }
function weekday(d) { return d.toLocaleDateString('en-US', { weekday: 'long' }); }
function isCamp(id) { return norm(id).startsWith('camp'); }
function isWt(row) { return /\bwt\b/i.test(String(pick(row, aliases.closeRemarks))); }
function isTa(row) { return norm(pick(row, aliases.levelType)) === 'ta'; }
function isEnquiry(row) { return norm(pick(row, ['Type'])) === 'enquiry'; }
function subStatusNorm(row) { return norm(pick(row, aliases.subStatus)); }
function isDeath(row) { const s=subStatusNorm(row); return s==='animal death' || /death.*before.*arrival|m death/i.test(s); }
function isLocalVet(row) { return subStatusNorm(row) === 'treated by local vet'; }
function isAttend(row) { return subStatusNorm(row) === 'visited farmer'; }

async function loadMaster() {
  if (runtimeEnv?.DB) {
    const { results } = await runtimeEnv.DB.prepare('SELECT division, district, block, vehicle_number AS vehicleNumber, paravet_id AS paravetId, week_off AS weekOff FROM master_data ORDER BY rowid').all();
    return results || [];
  }
  if (globalThis.CLOUDFLARE_WORKER === true) return workerMasterCache.slice();
  try {
    const parsed = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.rows)) return parsed.rows;
    return [];
  } catch { return []; }
}
async function saveMaster(rows) {
  if (runtimeEnv?.DB) {
    const db = runtimeEnv.DB;
    await db.exec('DELETE FROM master_data');
    if (rows.length) {
      const stmt = db.prepare('INSERT INTO master_data (division,district,block,vehicle_number,paravet_id,week_off) VALUES (?,?,?,?,?,?)');
      const batch = rows.map(r => stmt.bind(r.division||'', r.district||'', r.block||'', r.vehicleNumber||'', r.paravetId||'', r.weekOff||''));
      await db.batch(batch);
    }
    return;
  }
  if (globalThis.CLOUDFLARE_WORKER === true) { workerMasterCache = Array.isArray(rows) ? rows.slice() : []; return; }
  fs.writeFileSync(MASTER_FILE, JSON.stringify(rows, null, 2));
}
async function masterIndex() {
  const map = new Map();
  const rows = await loadMaster();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const pid = r.paravetId ?? r['Paravet ID'] ?? r.ParavetID ?? '';
    if (norm(pid)) map.set(norm(pid), { ...r, paravetId: String(pid).trim() });
  }
  return map;
}

function rowsFromWorkbook(buf) {
  if (!buf || !Buffer.isBuffer(buf) || !buf.length) throw new Error('Uploaded Excel file is empty or invalid.');
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true, raw: true, cellNF: false });
  if (!wb.SheetNames || !wb.SheetNames.length) throw new Error('No worksheet found in the uploaded Excel file.');
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet || !sheet['!ref']) throw new Error('The first worksheet is empty.');
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true, blankrows: false });
  if (!Array.isArray(rows)) throw new Error('Unable to read rows from the uploaded Excel file.');
  return rows.filter(r => r && typeof r === 'object' && !Array.isArray(r));
}

async function processDetailed(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('No data rows found in the Detailed Report.');

  const parsed = rows.map((r, i) => ({
    raw: r,
    rowNo: i + 2,
    date: parseDate(pick(r, aliases.created))
  })).filter(x => x.date);

  if (!parsed.length) {
    throw new Error('CreatedDateTime/date column was not found or contains no valid dates.');
  }

  const dates = [...new Map(parsed.map(x => [dateKey(x.date), x.date])).values()].sort((a,b) => a-b);
  if (dates.length > 5) throw new Error('Maximum 5 dates are allowed.');

  const master = await masterIndex();
  if (!(master instanceof Map)) throw new Error('Master Server Data is invalid. Please upload the Master Server Data again.');
  const missing = [];
  const hospital = [];
  const wtRows = [];
  const valid = [];

  for (const item of parsed) {
    const r = item.raw;

    // 1) TA is removed first.
    if (isTa(r)) continue;

    // 2) Type = Enquiry is completely removed.
    if (norm(pick(r, ['Type'])) === 'enquiry' || isEnquiry(r)) continue;

    // 3) WT is retained separately, but never enters normal MVU calculation.
    if (isWt(r)) {
      wtRows.push({ ...r, __date: dateKey(item.date), __dateLabel: displayDate(item.date), __rowNo: item.rowNo });
    }

    const pid = String(pick(r, aliases.paravetId)).trim();

    // Final Hospital Area rule: non-CAMP = Hospital Area.
    if (!isCamp(pid)) {
      hospital.push({ ...r, __date: dateKey(item.date), __dateLabel: displayDate(item.date), __rowNo: item.rowNo });
      continue;
    }

    // CAMP + WT is saved above but excluded from normal calculation.
    if (isWt(r)) continue;

    // Only CAMP IDs are checked against Master Server Data.
    if (!master.has(norm(pid))) {
      missing.push({
        'Sr.No.': missing.length + 1,
        'Division': pick(r, aliases.division),
        'District': pick(r, aliases.district),
        'Block': pick(r, aliases.block),
        'MVU Number': pick(r, aliases.vehicle),
        'Paravet Name': pick(r, aliases.paravetName),
        'ParavetID': pid,
        'Ticket ID': pick(r, aliases.ticketId)
      });
      continue;
    }

    const m = master.get(norm(pid));
    valid.push({ ...r, __date: dateKey(item.date), __dateLabel: displayDate(item.date), __master: m, __rowNo: item.rowNo });
  }

  const report = buildReport(valid, dates, master);
  return {
    dates: dates.map(dateKey),
    dateLabels: dates.map(displayDate),
    report,
    hospital,
    wtRows,
    missing,
    totalProcessed: rows.length,
    totalAfterTaEnquiry: parsed.length,
    totalNormalRows: valid.length
  };
}

function buildReport(rows, dates, master) {
  const byDate = Object.create(null);
  // ParavetID is the single unique business key. Every report row and every
  // calculation is aggregated by normalized ParavetID, never by district,
  // block, vehicle number, or Paravet name.
  const masterRows = Array.from(master.values());

  for (const d of dates) {
    const dk = dateKey(d);
    byDate[dk] = { date: dk, label: displayDate(d), rows: [], districts: {}, divisionTotals: {}, state: {} };

    // One and only one report row per unique Master ParavetID for each date.
    // This keeps zero-case MVUs visible for Week Off / Case not received logic.
    for (const m of masterRows) {
      const pid = String(m.paravetId || '').trim();
      if (!pid) continue;
      byDate[dk].rows.push({
        id: norm(pid),
        paravetId: pid,
        weekOff: m.weekOff || '',
        division: m.division || '',
        district: m.district || '',
        block: m.block || '',
        vehicle: m.vehicleNumber || m.vehicle || '',
        received: 0,
        attend: 0,
        localVet: 0,
        death: 0,
        notAttend: 0,
        grandTotal: 0
      });
    }
  }

  for (const r of rows) {
    const dk = r.__date;
    if (!byDate[dk]) continue;

    // The Detailed Report and Master Data both use ParavetID as the unique key.
    const pid = String(r.__master?.paravetId || pick(r, aliases.paravetId) || '').trim();
    const target = byDate[dk].rows.find(x => norm(x.paravetId) === norm(pid));
    if (!target) continue;

    // All ticket/case counts are accumulated against this ParavetID only.
    // Final SubStatus mapping is explicit and is calculated only against ParavetID:
    // Visited Farmer -> Case Attend By MVU
    // Treated by Local Vet -> Case attend by other source
    // Animal Death -> Animal Death (Before Arrival of MVU)
    // Everything else -> backend-only Not Attend
    if (isDeath(r)) {
      target.death += 1;
    } else if (isLocalVet(r)) {
      target.localVet += 1;
    } else if (isAttend(r)) {
      target.attend += 1;
    } else {
      target.notAttend += 1;
    }

    // Case Received = all calculated buckets for this ParavetID.
    // Not Attend remains backend-only and is never displayed.
    target.received = target.attend + target.localVet + target.death + target.notAttend;
  }

  for (const d of dates) {
    const obj = byDate[dateKey(d)];
    const districts = {};

    for (const r of obj.rows) {
      // Grand Total is exactly the sum of the three visible service columns.
      // Grand Total is exactly the sum of the three visible service columns.
      r.grandTotal = r.attend + r.localVet + r.death;
      const off = norm(r.weekOff) === norm(weekday(d));
      r.remark = off ? 'Week off' : (r.received === 0 ? 'Case not received' : '');

      if (!districts[r.district]) {
        districts[r.district] = { division: r.division, rows: [], received:0, attend:0, localVet:0, death:0, grandTotal:0, totalMvu:0 };
      }
      const g = districts[r.district];
      g.rows.push(r);
      g.received += r.received;
      g.attend += r.attend;
      g.localVet += r.localVet;
      g.death += r.death;
      g.grandTotal += r.grandTotal;
    }

    for (const [district, g] of Object.entries(districts || {})) {
      g.totalMvu = g.rows.length;
      // Off Road Vehicle % = count of MVUs with Case Attend By MVU = 0
      // divided by total MVUs in that district, multiplied by 100.
      g.offRoadCount = g.rows.filter(row => Number(row.attend || 0) === 0).length;
      g.offRoadPct = g.totalMvu ? (g.offRoadCount / g.totalMvu) * 100 : 0;
      if (!obj.divisionTotals[g.division]) {
        obj.divisionTotals[g.division] = { received:0, attend:0, localVet:0, death:0, grandTotal:0, totalMvu:0 };
      }
      const v = obj.divisionTotals[g.division];
      ['received','attend','localVet','death','grandTotal','totalMvu'].forEach(k => v[k] += g[k]);
    }

    obj.districts = districts;
    obj.state = Object.values(districts || {}).reduce((a,g)=>{
      ['received','attend','localVet','death','grandTotal','totalMvu'].forEach(k=>a[k]+=g[k]);
      return a;
    }, {received:0,attend:0,localVet:0,death:0,grandTotal:0,totalMvu:0});
    obj.state.offRoadCount = Object.values(districts || {}).reduce((a,g)=>a+Number(g.offRoadCount||0),0);
    obj.state.offRoadPct = obj.state.totalMvu ? (obj.state.offRoadCount / obj.state.totalMvu) * 100 : 0;
  }
  return byDate;
}

function styleWorksheet(ws) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:L1');
  for (let c = range.s.c; c <= Math.min(range.e.c, 11); c++) {
    const cell = ws[XLSX.utils.encode_cell({r:1,c})];
    if (cell) { cell.s = { font:{bold:true,color:'FFFFFF'}, fill:{fgColor:{rgb:'1B7F5A'}}, alignment:{horizontal:'center',vertical:'center',wrapText:true}, border:{bottom:{style:'thin',color:{rgb:'FFFFFF'}}} }; }
  }
  ws['!cols'] = [{wch:8},{wch:15},{wch:16},{wch:16},{wch:20},{wch:24},{wch:27},{wch:24},{wch:32},{wch:15},{wch:22},{wch:20}];
}

function makeExport(result, dateKeyValue, mode='evening') {
  const d = result && result.report ? result.report[dateKeyValue] : null;
  if (!d) throw new Error('Invalid report date.');
  const data = [['MVU WISE DAILY REPORT'], ['Sr.No.','Division','District','Block','Vehicle Number',`Case Received on ${excelDateLabel(new Date(dateKeyValue))}`,`Case Attend By MVU ${excelDateLabel(new Date(dateKeyValue))}`,'Case attend by other source','Animal Death ( Before Arrival of MVU)','Grand Total','Remark','% of Off Road Vehicle']];
  let sr = 1;
  for (const [district, g] of Object.entries(d.districts)) {
    for (const r of g.rows) {
      // Morning keeps Received and Attend exactly as Evening, but displays
      // Other Source = 0, Animal Death = 0, and Grand Total = Attend.
      const received = Number(r.received||0);
      const attend = Number(r.attend||0);
      const other = mode === 'morning' ? 0 : Number(r.localVet||0);
      const death = mode === 'morning' ? 0 : Number(r.death||0);
      const grand = mode === 'morning' ? attend : Number(r.grandTotal||0);
      data.push([sr++,r.division,r.district,r.block,r.vehicle,received,attend,other,death,grand,r.remark,'']);
    }
      const gReceived = Number(g.received||0);
    const gAttend = Number(g.attend||0);
    const gOther = mode === 'morning' ? 0 : Number(g.localVet||0);
    const gDeath = mode === 'morning' ? 0 : Number(g.death||0);
    const gGrand = mode === 'morning' ? gAttend : Number(g.grandTotal||0);
    data.push(['','','', '', 'DISTRICT TOTAL',gReceived,gAttend,gOther,gDeath,gGrand,'',Math.round(Number(g.offRoadPct||0))/100]);
  }
  const sOther = mode === 'morning' ? 0 : Number(d.state.localVet||0);
  const sDeath = mode === 'morning' ? 0 : Number(d.state.death||0);
  const sReceived = Number(d.state.received||0);
  const sAttend = Number(d.state.attend||0);
  const sGrand = mode === 'morning' ? sAttend : Number(d.state.grandTotal||0);
  data.push(['','','','', 'STATE TOTAL',sReceived,sAttend,sOther,sDeath,sGrand,'',Math.round(Number(d.state.offRoadPct||0))/100]);
  const ws = XLSX.utils.aoa_to_sheet(data); styleWorksheet(ws);
  ws['!merges'] = [{s:{r:0,c:0},e:{r:0,c:11}}];
  for (let r=2;r<data.length;r++) if (ws[XLSX.utils.encode_cell({r,c:11})]) ws[XLSX.utils.encode_cell({r,c:11})].z='0%';
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Daily Report');
  return XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
}

function makeHospitalExport(rows) {
  const clean = (Array.isArray(rows) ? rows : []).map(r => Object.fromEntries(Object.entries(r && typeof r === 'object' ? r : {}).filter(([k])=>!k.startsWith('__'))));
  const ws = XLSX.utils.json_to_sheet(clean); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Hospital Area');
  return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
}

let lastResult = null;

app.get('/api/health', (_,res)=>res.json({ok:true}));
app.get('/api/master/sample', (_,res)=>{
  const data = [
    ['Division','District','Block','Vehicle Number','Paravet ID','Week off'],
    ['Division 1','District 1','Block 1','MVU-001','CAMP001','Sunday'],
    ['Division 1','District 1','Block 2','MVU-002','CAMP002','Monday']
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:16},{wch:18},{wch:18},{wch:20},{wch:18},{wch:14}];
  for (let c=0;c<6;c++) {
    const cell=ws[XLSX.utils.encode_cell({r:0,c})];
    if(cell) cell.s={font:{bold:true,color:'FFFFFF'},fill:{fgColor:{rgb:'1B7F5A'}},alignment:{horizontal:'center',vertical:'center'}};
  }
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Master Data');
  const buf=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
  res.setHeader('Content-Disposition','attachment; filename=Master-Server-Data-Sample.xlsx');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buf);
});
app.get('/api/master', async (_,res)=>{ try { res.json(await loadMaster()); } catch(e){ res.status(500).json({error:e.message}); } });
app.post('/api/master', async (req,res)=>{
  const rows = Array.isArray(req.body) ? req.body : req.body.rows;
  if (!Array.isArray(rows)) return res.status(400).json({error:'Master data must be an array.'});
  const unique = new Map();
  for (const r of rows) {
    const item={division:r.Division||r.division||'',district:r.District||r.district||'',block:r.Block||r.block||'',vehicleNumber:r['Vehicle Number']||r.vehicleNumber||r.MVUNumber||'',paravetId:String(r['Paravet ID']||r.paravetId||r.ParavetID||'').trim(),weekOff:r['Week off']||r['Week Off']||r.weekOff||''};
    if (item.paravetId) unique.set(norm(item.paravetId), item);
  }
  const cleaned = Array.from(unique.values());
  await saveMaster(cleaned); res.json({ok:true,count:cleaned.length});
});
app.post('/api/master/bulk-upload', upload.array('files', 20), async (req,res)=>{
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({error:'Please select at least one Master Data file.'});
    const map = new Map((await loadMaster()).filter(r=>r && r.paravetId).map(r=>[norm(r.paravetId), r]));
    let added=0, updated=0;
    for (const file of files) {
      const rows = rowsFromWorkbook(file.buffer);
      for (const r of rows) {
        const item={division:pick(r,aliases.division),district:pick(r,aliases.district),block:pick(r,aliases.block),vehicleNumber:pick(r,aliases.vehicle),paravetId:String(pick(r,['Paravet ID','ParavetID','Pravet ID'])).trim(),weekOff:pick(r,['Week off','Week Off'])};
        if (!item.paravetId) continue;
        const k=norm(item.paravetId); if(map.has(k)) updated++; else added++; map.set(k,item);
      }
    }
    const cleaned=Array.from(map.values()); await saveMaster(cleaned);
    res.json({ok:true,count:cleaned.length,added,updated});
  } catch(e){res.status(400).json({error:e.message});}
});
app.put('/api/master/:paravetId', async (req,res)=>{
  try {
    const id=norm(req.params.paravetId); const rows=await loadMaster(); const idx=rows.findIndex(r=>norm(r?.paravetId)===id);
    if(idx<0) return res.status(404).json({error:'Paravet ID not found.'});
    const b=req.body||{}; const current=rows[idx];
    rows[idx]={...current,division:String(b.division??current.division??'').trim(),district:String(b.district??current.district??'').trim(),block:String(b.block??current.block??'').trim(),vehicleNumber:String(b.vehicleNumber??current.vehicleNumber??'').trim(),paravetId:String(b.paravetId??current.paravetId??'').trim(),weekOff:String(b.weekOff??current.weekOff??'').trim()};
    if(!rows[idx].paravetId) return res.status(400).json({error:'Paravet ID is required.'});
    const duplicate = rows.findIndex((r,i)=>i!==idx && norm(r?.paravetId)===norm(rows[idx].paravetId));
    if(duplicate>=0) return res.status(400).json({error:'Duplicate Paravet ID. ParavetID must be unique.'});
    await saveMaster(rows); res.json({ok:true,row:rows[idx]});
  } catch(e){res.status(400).json({error:e.message});}
});
app.post('/api/master/delete', async (req,res)=>{
  try { const ids=Array.isArray(req.body?.ids)?req.body.ids.map(norm).filter(Boolean):[]; if(!ids.length)return res.status(400).json({error:'No Master Data rows selected.'}); const set=new Set(ids); const rows=await loadMaster(); const kept=rows.filter(r=>!set.has(norm(r?.paravetId))); const deleted=rows.length-kept.length; await saveMaster(kept); res.json({ok:true,deleted,count:kept.length}); }
  catch(e){res.status(400).json({error:e.message});}
});
app.post('/api/master/upload', upload.single('file'), async (req,res)=>{
  try { const rows=rowsFromWorkbook(req.file.buffer); const cleaned=rows.map(r=>({division:pick(r,aliases.division),district:pick(r,aliases.district),block:pick(r,aliases.block),vehicleNumber:pick(r,aliases.vehicle),paravetId:pick(r,['Paravet ID','ParavetID','Pravet ID']),weekOff:pick(r,['Week off','Week Off'])})).filter(r=>r.paravetId); await saveMaster(cleaned); res.json({ok:true,count:cleaned.length}); }
  catch(e){res.status(400).json({error:e.message});}
});
app.post('/api/report/upload', upload.single('file'), async (req,res)=>{
  try { const rows=rowsFromWorkbook(req.file.buffer); lastResult=await processDetailed(rows); res.json(lastResult); }
  catch(e){res.status(400).json({error:e.message});}
});
app.get('/api/report', (_,res)=>{ if(!lastResult) return res.status(404).json({error:'No report uploaded.'}); res.json(lastResult); });
app.get('/api/report/download/:date', (req,res)=>{ try { if(!lastResult) throw new Error('No report uploaded.'); const mode=req.query.mode==='morning'?'morning':'evening'; const buf=makeExport(lastResult,req.params.date,mode); res.setHeader('Content-Disposition',`attachment; filename="MVU-${mode==='morning'?'Morning':'Evening'}-Report-${req.params.date}.xlsx"`); res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buf); } catch(e){res.status(400).json({error:e.message});} });
app.get('/api/hospital/download/:date', (req,res)=>{ try { if(!lastResult) throw new Error('No report uploaded.'); const rows=lastResult.hospital.filter(r=>r.__date===req.params.date); const buf=makeHospitalExport(rows); res.setHeader('Content-Disposition',`attachment; filename="Hospital-Area-${req.params.date}.xlsx"`); res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buf); } catch(e){res.status(400).json({error:e.message});} });
app.get('/report',(req,res)=>res.sendFile(path.join(ROOT,'public','report.html')));
app.get('*',(req,res)=>res.sendFile(path.join(ROOT,'public','index.html')));

if (globalThis.CLOUDFLARE_WORKER !== true) {
  app.listen(PORT,()=>console.log(`MVU Report Website running at http://localhost:${PORT}`));
}

module.exports = { app, setRuntimeEnv };
