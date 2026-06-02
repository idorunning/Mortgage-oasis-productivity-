#!/usr/bin/env python3
"""
build_dashboard.py — offline single-file export.

Produces a self-contained `dashboard.html` (no server, no external requests) plus
a plain-text report body, using the shared analytics engine in
`mortgage_oasis.analytics`. Use this when you want a portable file to email or
archive; for the interactive live app run `app.py` instead.

Input options:
  --src  <file>   JSON export {"fileContent": "<markdown tables>"} (default)
  --csv  <file>   A CSV export from Google Sheets (File -> Download -> CSV)
  --out  <file>   Output HTML path (default: dashboard.html)
"""
import argparse
import json
import datetime

from mortgage_oasis import analytics


def render_html(data):
    payload = json.dumps(data, ensure_ascii=False)
    return HTML_TEMPLATE.replace("/*__DATA__*/null", payload)


def build_report_text(data):
    k = data["kpis"]
    lines = []
    A = lines.append
    A("MORTGAGE OASIS — BUSINESS DEVELOPMENT INSIGHTS REPORT")
    A(f"Generated {datetime.date.today().isoformat()} from the case-log spreadsheet.\n")
    A("EXECUTIVE SUMMARY")
    A(f"- {k['total_rows']} case rows across {k['clients']} unique clients.")
    A(f"- {k['mortgage_clients']} mortgage clients; {k['protection_clients']} with protection.")
    A(f"- Protection attach rate: {k['attach_rate']}%  ->  {k['protection_gap']} mortgage "
      f"clients have NO protection on file (the primary cross-sell pool).")
    A(f"- Referral source recorded on only {k['source_coverage']}% of rows.")
    A(f"- {k['mcr_cases']} Mortgage Capacity Report (MCR) cases — a divorce/family-law "
      f"referral line worth nurturing.\n")

    A("1. PROTECTION CROSS-SELL (mortgage clients with no protection)")
    for x in data["protection_gap"][:40]:
        amt = f"£{x['amount']:,.0f}" if x["amount"] else "n/a"
        A(f"   - {x['client']} | {x['property']} | {x['lender']} | {amt}")
    if len(data["protection_gap"]) > 40:
        A(f"   ...and {len(data['protection_gap']) - 40} more (see dashboard).")
    A("")
    A("2. LIFE-ONLY UPSELL (have Life, missing CIC/Income Protection)")
    for x in data["life_only"]:
        A(f"   - {x['client']} | {x['property']}")
    A("")
    A("3. REMORTGAGE PIPELINE (review date assumes 2-yr product)")
    for x in data["pipeline"][:40]:
        flag = "  <-- DUE/OVERDUE" if x["overdue"] else ""
        A(f"   - review {x['review_date']} | {x['client']} | {x['lender']} "
          f"(completed {x['completed']}){flag}")
    if len(data["pipeline"]) > 40:
        A(f"   ...and {len(data['pipeline']) - 40} more (see dashboard).")
    A("")
    A("4. REFERRAL CHANNELS (by volume)")
    for x in data["referrals"][:25]:
        A(f"   - {x['source']}: {x['count']} cases, {x['clients']} clients, "
          f"£{x['comm']:,} commission written")
    A("")
    A("5. DATA CLEAN-UP — recommended fixes")
    A(f"   - {data['cleanup_variant_count']} clients appear under multiple name spellings "
      f"(merge to a single client ID).")
    A("   - Lender names leaked into the product column on some rows.")
    A(f"   - {100 - k['source_coverage']}% of rows have no introducer recorded — make the "
      f"source field mandatory to credit your best partners.")
    A("")
    A("RECOMMENDATIONS")
    A("   1. Run a protection-review campaign against the cross-sell list — warmest leads.")
    A("   2. Diary the remortgage pipeline ~3 months before maturity (bulk-add via dashboard).")
    A("   3. Formalise relationships with top introducers; thank & incentivise them.")
    A("   4. Clean client names / source capture so future cross-referencing is reliable.")
    return "\n".join(lines)


HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mortgage Oasis — BD Dashboard</title>
<style>
:root{--bg:#0f1724;--card:#16202e;--ink:#e6edf5;--mut:#8aa0b4;--acc:#3da9fc;
--good:#34d399;--warn:#fbbf24;--bad:#f87171;--line:#243245}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,Segoe UI,Roboto,sans-serif;
background:var(--bg);color:var(--ink)}
header{padding:18px 24px;border-bottom:1px solid var(--line);display:flex;
align-items:center;gap:16px;flex-wrap:wrap;position:sticky;top:0;background:var(--bg);z-index:5}
h1{font-size:18px;margin:0}.sub{color:var(--mut);font-size:12px}
.kpis{display:flex;gap:12px;flex-wrap:wrap;padding:16px 24px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:120px}
.kpi .n{font-size:22px;font-weight:700}.kpi .l{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
nav{display:flex;gap:6px;padding:0 24px;flex-wrap:wrap}
nav button{background:var(--card);color:var(--ink);border:1px solid var(--line);
padding:8px 14px;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px}
nav button.active{background:var(--acc);color:#04121f;border-color:var(--acc);font-weight:600}
main{padding:16px 24px 80px}.panel{display:none}.panel.active{display:block}
.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0 14px}
input[type=search]{background:var(--card);border:1px solid var(--line);color:var(--ink);
padding:8px 12px;border-radius:8px;min-width:220px}
.btn{background:var(--acc);color:#04121f;border:0;padding:9px 14px;border-radius:8px;
cursor:pointer;font-weight:600;font-size:13px}
.btn.sec{background:var(--card);color:var(--ink);border:1px solid var(--line)}
table{width:100%;border-collapse:collapse;background:var(--card);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);font-size:13px;vertical-align:top}
th{color:var(--mut);font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.03em;cursor:pointer;user-select:none}
tr:hover td{background:#1b2738}
td.amt{text-align:right;white-space:nowrap}
.done td{opacity:.4;text-decoration:line-through}
.tag{display:inline-block;padding:1px 8px;border-radius:20px;font-size:11px;font-weight:600}
.tag.due{background:rgba(248,113,113,.18);color:var(--bad)}
.tag.ok{background:rgba(52,211,153,.16);color:var(--good)}
.bar{height:9px;background:var(--acc);border-radius:5px}
.muted{color:var(--mut)}.right{margin-left:auto}
a{color:var(--acc)}.note{color:var(--mut);font-size:12px;margin:6px 0 14px}
.cal{cursor:pointer;color:var(--acc);text-decoration:none;white-space:nowrap}
.cnt{color:var(--mut);font-size:12px;margin-left:6px}
</style></head><body>
<header>
  <div><h1>🏠 Mortgage Oasis — BD Dashboard</h1>
  <div class="sub" id="meta"></div></div>
  <div class="right note">Offline &amp; private — all data stays in this file on your computer.</div>
</header>
<div class="kpis" id="kpis"></div>
<nav id="tabs"></nav>
<main id="main"></main>
<script>
const DATA = /*__DATA__*/null;
const $=s=>document.querySelector(s), ce=(t,c)=>{const e=document.createElement(t);if(c)e.className=c;return e};
const money=v=>v==null?'':'£'+Number(v).toLocaleString('en-GB',{maximumFractionDigits:0});
const store={get:k=>JSON.parse(localStorage.getItem('mo_'+k)||'{}'),
             set:(k,v)=>localStorage.setItem('mo_'+k,JSON.stringify(v))};

/* ---- iCal (bulk) ---- */
function pad(n){return String(n).padStart(2,'0')}
function icsDate(iso){const d=new Date(iso);return d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())}
function vevent(title,dateIso,desc){
  const dt=icsDate(dateIso), end=icsDate(dateIso);
  const uid=Math.random().toString(36).slice(2)+'@mortgageoasis';
  return ['BEGIN:VEVENT','UID:'+uid,'DTSTAMP:'+icsDate(new Date().toISOString())+'T090000Z',
    'DTSTART;VALUE=DATE:'+dt,'DTEND;VALUE=DATE:'+end,
    'SUMMARY:'+esc(title),'DESCRIPTION:'+esc(desc),
    'BEGIN:VALARM','TRIGGER:-P1D','ACTION:DISPLAY','DESCRIPTION:'+esc(title),'END:VALARM',
    'END:VEVENT'].join('\r\n');
}
function esc(s){return String(s||'').replace(/([,;\\])/g,'\\$1').replace(/\n/g,'\\n')}
function downloadICS(events,name){
  const cal=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Mortgage Oasis//BD Dashboard//EN',
    'CALSCALE:GREGORIAN',...events,'END:VCALENDAR'].join('\r\n');
  const blob=new Blob([cal],{type:'text/calendar'});const url=URL.createObjectURL(blob);
  const a=ce('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);
}
function gcalLink(title,dateIso,desc){
  const d=icsDate(dateIso);
  const nd=icsDate(new Date(new Date(dateIso).getTime()+864e5).toISOString());
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text='+
    encodeURIComponent(title)+'&dates='+d+'/'+nd+'&details='+encodeURIComponent(desc);
}

/* ---- generic table builder with select + bulk calendar ---- */
function tablePanel(opts){
  const wrap=ce('div');
  const note=ce('div','note');note.innerHTML=opts.note||'';wrap.appendChild(note);
  const tb=ce('div','toolbar');
  const search=ce('input');search.type='search';search.placeholder='Search…';
  const bulkIcs=ce('button','btn');bulkIcs.textContent='⬇ Download selected as .ics';
  const bulkGcal=ce('button','btn sec');bulkGcal.textContent='📅 Open selected in Google Calendar';
  const selAll=ce('button','btn sec');selAll.textContent='Select all';
  const cnt=ce('span','cnt');
  tb.append(search,selAll,bulkIcs,bulkGcal,cnt);wrap.appendChild(tb);
  const table=ce('table');const thead=ce('thead');const htr=ce('tr');
  const thSel=ce('th');thSel.textContent='✓';htr.appendChild(thSel);
  opts.cols.forEach((c,i)=>{const th=ce('th');th.textContent=c.label;
    th.onclick=()=>{sortBy=c.k;sortDir=(sortBy===c.k&&sortDir===1)?-1:1;render()};htr.appendChild(th)});
  if(opts.date){const th=ce('th');th.textContent='Calendar';htr.appendChild(th)}
  thead.appendChild(htr);table.appendChild(thead);
  const tbody=ce('tbody');table.appendChild(tbody);wrap.appendChild(table);
  let sortBy=null,sortDir=1;
  const doneState=store.get('done_'+opts.key);
  const checked=new Set();

  function visibleRows(){
    let rows=opts.rows.slice();
    const q=search.value.toLowerCase().trim();
    if(q)rows=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(q));
    if(sortBy)rows.sort((a,b)=>{let x=a[sortBy],y=b[sortBy];
      x=x==null?'':x;y=y==null?'':y;return (x>y?1:x<y?-1:0)*sortDir});
    return rows;
  }
  function rowId(r){return (r.client||'')+'|'+(r.property||'')+'|'+(r.review_date||r.date||'')}
  function render(){
    tbody.innerHTML='';
    const rows=visibleRows();
    rows.forEach(r=>{
      const id=rowId(r);const tr=ce('tr');if(doneState[id])tr.className='done';
      const tdS=ce('td');const cb=ce('input');cb.type='checkbox';cb.checked=checked.has(id);
      cb.onchange=()=>{cb.checked?checked.add(id):checked.delete(id);updateCnt()};tdS.appendChild(cb);
      tr.appendChild(tdS);
      opts.cols.forEach(c=>{const td=ce('td',c.cls);let v=r[c.k];
        v=c.fmt?c.fmt(v,r):(v==null?'':v);
        if(c.k==='__done'){const d=ce('input');d.type='checkbox';d.checked=!!doneState[id];
          d.onchange=()=>{doneState[id]=d.checked;store.set('done_'+opts.key,doneState);render()};
          td.appendChild(d);} else td.innerHTML=v;tr.appendChild(td)});
      if(opts.date){const td=ce('td');const iso=opts.date(r);
        if(iso){const a=ce('a','cal');a.href=gcalLink(opts.title(r),iso,opts.desc(r));
          a.target='_blank';a.textContent='＋ add';td.appendChild(a)}tr.appendChild(td)}
      tbody.appendChild(tr);
    });
    updateCnt();
  }
  function updateCnt(){cnt.textContent=visibleRows().length+' rows · '+checked.size+' selected'}
  function selectedRows(){return opts.rows.filter(r=>checked.has(rowId(r)))}
  search.oninput=render;
  selAll.onclick=()=>{visibleRows().forEach(r=>checked.add(rowId(r)));render()};
  bulkIcs.onclick=()=>{const sel=selectedRows();if(!sel.length||!opts.date)return alert('Select some rows first.');
    const ev=sel.map(r=>vevent(opts.title(r),opts.date(r),opts.desc(r)));
    downloadICS(ev,opts.key+'-reminders.ics')};
  bulkGcal.onclick=()=>{const sel=selectedRows();if(!sel.length||!opts.date)return alert('Select some rows first.');
    if(sel.length>12&&!confirm('Open '+sel.length+' Google Calendar tabs? (.ics download is smoother)'))return;
    sel.forEach((r,i)=>setTimeout(()=>window.open(gcalLink(opts.title(r),opts.date(r),opts.desc(r)),'_blank'),i*350))};
  if(!opts.date){bulkIcs.style.display=bulkGcal.style.display='none'}
  render();return wrap;
}

/* ---- build UI ---- */
function init(){
  $('#meta').textContent='Generated '+DATA.generated+' · '+DATA.kpis.total_rows+' cases · review dates assume a '+DATA.term_months+'-month product';
  const kdefs=[['total_rows','Cases'],['clients','Clients'],['mortgage_clients','Mortgage clients'],
    ['attach_rate','Protection attach %'],['protection_gap','No-protection clients'],
    ['mcr_cases','MCR (divorce) cases'],['source_coverage','Source recorded %']];
  kdefs.forEach(([k,l])=>{const d=ce('div','kpi');d.innerHTML='<div class="n">'+DATA.kpis[k]+'</div><div class="l">'+l+'</div>';$('#kpis').appendChild(d)});

  const tabs=[
    ['Protection cross-sell',()=>tablePanel({key:'gap',rows:DATA.protection_gap,
      note:'Mortgage clients with <b>no protection</b> on file — your warmest leads. Tick rows and bulk-create calendar reminders.',
      cols:[{k:'__done',label:'Done'},{k:'client',label:'Client'},{k:'property',label:'Property'},
        {k:'lender',label:'Lender'},{k:'amount',label:'Loan',fmt:money,cls:'amt'},{k:'admin',label:'Adviser'}],
      date:r=>r.date||DATA.generated, title:r=>'Protection review: '+r.client,
      desc:r=>r.action+' — '+r.property+' ('+(r.lender||'')+')'})],
    ['Life-only upsell',()=>tablePanel({key:'life',rows:DATA.life_only,
      note:'Clients with a <b>Life</b> policy but missing Critical Illness / Income Protection.',
      cols:[{k:'__done',label:'Done'},{k:'client',label:'Client'},{k:'property',label:'Property'},
        {k:'missing',label:'Missing'},{k:'admin',label:'Adviser'}],
      date:r=>DATA.generated, title:r=>'CIC/IP top-up: '+r.client, desc:r=>r.action})],
    ['Remortgage pipeline',()=>tablePanel({key:'pipe',rows:DATA.pipeline,
      note:'Remortgages &amp; product transfers, sorted by suggested review date (completion + '+DATA.term_months+' months). Bulk-add the whole quarter to your calendar.',
      cols:[{k:'__done',label:'Done'},{k:'review_date',label:'Review',
          fmt:(v,r)=>v+(r.overdue?' <span class="tag due">due</span>':'')},
        {k:'client',label:'Client'},{k:'lender',label:'Lender'},
        {k:'amount',label:'Loan',fmt:money,cls:'amt'},{k:'completed',label:'Completed'},{k:'admin',label:'Adviser'}],
      date:r=>r.review_date, title:r=>'Remortgage review: '+r.client,
      desc:r=>'Approaching maturity — '+r.property+' ('+(r.lender||'')+', completed '+r.completed+')'})],
    ['Referral channels',()=>referralPanel()],
    ['Data clean-up',()=>cleanupPanel()],
  ];
  const nav=$('#tabs'),main=$('#main');
  tabs.forEach(([label,fn],i)=>{const b=ce('button',i===0?'active':'');b.textContent=label;
    const p=ce('div','panel'+(i===0?' active':''));main.appendChild(p);
    b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');p.classList.add('active');
      if(!p.dataset.built){p.appendChild(fn());p.dataset.built='1'}};
    nav.appendChild(b);
    if(i===0){p.appendChild(fn());p.dataset.built='1'}});
}
function referralPanel(){
  const wrap=ce('div');wrap.innerHTML='<div class="note">Where introducers are recorded they\'re dominated by local conveyancers (Glanvilles, O\'Shea, Setfords, Larcomes) and family-law firms feeding MCR cases. <b>'+(100-DATA.kpis.source_coverage)+'% of rows have no source</b> — fix capture to credit your best partners.</div>';
  const max=Math.max(...DATA.referrals.map(r=>r.count));
  const t=ce('table');t.innerHTML='<thead><tr><th>Source</th><th>Cases</th><th>Clients</th><th>Comm written</th><th>Volume</th></tr></thead>';
  const tb=ce('tbody');
  DATA.referrals.forEach(r=>{const tr=ce('tr');tr.innerHTML='<td>'+r.source+'</td><td>'+r.count+'</td><td>'+r.clients+'</td><td class="amt">'+money(r.comm)+'</td><td><div class="bar" style="width:'+(100*r.count/max)+'%"></div></td>';tb.appendChild(tr)});
  t.appendChild(tb);wrap.appendChild(t);return wrap;
}
function cleanupPanel(){
  const wrap=ce('div');wrap.innerHTML='<div class="note">Fixing these makes every future cross-reference reliable. '+DATA.cleanup_variant_count+' clients appear under multiple spellings.</div>';
  const t=ce('table');t.innerHTML='<thead><tr><th>Issue</th><th>Detail</th></tr></thead>';
  const tb=ce('tbody');
  DATA.cleanup.forEach(r=>{const tr=ce('tr');tr.innerHTML='<td>'+r.type+'</td><td>'+r.detail+'</td>';tb.appendChild(tr)});
  t.appendChild(tb);wrap.appendChild(t);return wrap;
}
init();
</script></body></html>"""


def main():
    ap = argparse.ArgumentParser()
    default_src = ("/root/.claude/projects/-home-user-Mortgage-oasis-productivity-/"
                   "5349ce7c-9d8e-475e-8316-1c55ff004174/tool-results/"
                   "mcp-491e05dc-17f9-4f77-9dca-2cf229d34fc1-read_file_content-1780380241473.txt")
    ap.add_argument("--src", default=default_src)
    ap.add_argument("--csv")
    ap.add_argument("--out", default="dashboard.html")
    ap.add_argument("--report", default="report.txt")
    args = ap.parse_args()

    if args.csv:
        rows = analytics.parse_csv(args.csv)
    else:
        rows = analytics.parse_markdown(analytics.load_markdown(args.src))

    data = analytics.analyse(rows)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(render_html(data))
    with open(args.report, "w", encoding="utf-8") as fh:
        fh.write(build_report_text(data))

    k = data["kpis"]
    print("=== build summary ===")
    for key in ("total_rows", "clients", "mortgage_clients", "attach_rate",
                "protection_gap", "mcr_cases", "source_coverage"):
        print(f"  {key}: {k[key]}")
    print(f"  pipeline rows: {len(data['pipeline'])}")
    print(f"wrote {args.out} and {args.report}")


if __name__ == "__main__":
    main()
