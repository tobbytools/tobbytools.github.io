(()=>{
const $=id=>document.getElementById(id);
const API='https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const T={LCP:[2500,4000],INP:[200,500],CLS:[0.1,0.25]};
const M={LCP:'LARGEST_CONTENTFUL_PAINT_MS',INP:'INTERACTION_TO_NEXT_PAINT',CLS:'CUMULATIVE_LAYOUT_SHIFT_SCORE'};
const NAMES={LCP:'Largest Contentful Paint',INP:'Interaction to Next Paint',CLS:'Cumulative Layout Shift'};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rate=(k,v)=>v<=T[k][0]?'good':v<=T[k][1]?'ni':'poor';
const LBL={good:'Good',ni:'Needs improvement',poor:'Poor'};
const fmt=(k,v)=>k==='CLS'?v.toFixed(2):k==='LCP'?(v/1000).toFixed(1)+' s':Math.round(v)+' ms';
let busy=false,timer;
function norm(s){s=s.trim();if(!s)return null;if(!/^https?:\/\//i.test(s))s='https://'+s;
 try{const u=new URL(s);if(!/^https?:$/.test(u.protocol)||!u.hostname.includes('.')||/\s/.test(s))return null;return u.href}catch(e){return null}}
function status(html,cls){const el=$('status');el.className='card '+(cls||'');el.innerHTML=html;el.hidden=false}
function getKey(){try{return localStorage.getItem('psiKey')||''}catch(e){return ''}}
function keyForm(){return `<form class="key" id="kf"><label for="k" class="sr">Your PageSpeed Insights API key</label><input id="k" autocomplete="off" placeholder="Optional: paste your own free PSI API key"><button type="submit">Save key &amp; retry</button></form><p class="dist">Get a free key at <a href="https://developers.google.com/speed/docs/insights/v5/get-started">developers.google.com</a>. It is stored only in this browser.</p>`}
async function run(url){
 if(busy)return;busy=true;$('go').disabled=true;$('results').hidden=true;
 const t0=Date.now();
 status(`<strong>Testing ${esc(url)}…</strong><div class="progress" role="progressbar" aria-label="Test progress"><span id="pb"></span></div><p class="dist" id="pt">Loading the page in Lighthouse. This usually takes 20–60 seconds.</p>`);
 const steps=[[0,'Requesting the test from PageSpeed Insights…'],[4,'Loading the page on a simulated mobile device…'],[15,'Measuring loading, layout shifts and blocking time…'],[30,'Running SEO audits…'],[45,'Slow page – still working, hang tight…']];
 timer=setInterval(()=>{const s=(Date.now()-t0)/1000;const p=Math.min(95,100*(1-Math.exp(-s/22)));const pb=$('pb');if(pb)pb.style.width=p+'%';
  const st=steps.filter(x=>s>=x[0]).pop();const pt=$('pt');if(pt)pt.textContent=st[1]+' ('+Math.round(s)+'s)'},1000);
 const q=new URLSearchParams({url,strategy:'mobile'});q.append('category','performance');q.append('category','seo');
 const k=getKey();if(k)q.set('key',k);
 const ctl=new AbortController();const to=setTimeout(()=>ctl.abort(),120000);
 try{
  const r=await fetch(API+'?'+q,{signal:ctl.signal});let d={};try{d=await r.json()}catch(e){}
  if(!r.ok){const m=(d.error&&d.error.message)||('HTTP '+r.status);
   if(r.status===429)return status(`<div class="err"><strong>Google's free test limit was hit.</strong><p>PageSpeed Insights is rate-limiting free requests right now. Wait a minute and try again, or use your own free API key.</p>${keyForm()}</div>`);
   if(r.status===400&&/key/i.test(m))return status(`<div class="err"><strong>That API key was rejected.</strong>${keyForm()}</div>`);
   const unreachable=/FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|DNS|NO_FCP|unable to process/i.test(m);
   return status(`<div class="err"><strong>${unreachable?'Lighthouse could not load that page.':'The test failed.'}</strong><p>${unreachable?'Check the URL is public, spelled correctly and returns a page (not a login wall or error).':'Please try again in a moment.'}</p><p class="dist">Details: ${esc(m.slice(0,300))}</p></div>`)}
  render(url,d);$('status').hidden=true;
 }catch(e){status(`<div class="err"><strong>${e.name==='AbortError'?'The test took over 2 minutes and was stopped.':'Network error.'}</strong><p>Please check your connection and try again.</p></div>`)}
 finally{clearInterval(timer);clearTimeout(to);busy=false;$('go').disabled=false;bindKey(url)}
}
function bindKey(url){const kf=$('kf');if(!kf)return;kf.onsubmit=e=>{e.preventDefault();const v=$('k').value.trim();try{v?localStorage.setItem('psiKey',v):localStorage.removeItem('psiKey')}catch(x){}run(url)}}
function hasData(le){return le&&le.metrics&&Object.keys(le).length&&(le.metrics[M.LCP]||le.metrics[M.INP]||le.metrics[M.CLS])}
function render(url,d){
 let le=d.loadingExperience,src='url';
 if(!hasData(le)||le.origin_fallback){if(hasData(d.originLoadingExperience)){le=d.originLoadingExperience;src='origin'}else if(!hasData(le))le=null;else src='origin'}
 const host=new URL(url).hostname;
 if(!le){$('field-sub').textContent='';$('field').innerHTML=`<div class="note warn"><strong>Not enough real-user data.</strong> Chrome UX Report has no field data for this URL or for ${esc(host)} – the site likely has too little Chrome traffic. Google can't assess its Core Web Vitals from real users yet. Use the lab result below in the meantime.</div>`}
 else{
  $('field-sub').textContent=(src==='url'?'Field data for this exact URL':'Not enough data for this URL, so this is the whole origin ('+host+')')+' – Chrome users on mobile, last 28 days, 75th percentile.';
  let all=true,any=0;const cards=Object.keys(M).map(k=>{const m=le.metrics[M[k]];
   if(!m){all=false;return `<div class="metric"><div class="name">${k} <small>${NAMES[k]}</small></div><div class="val">–</div><div class="dist">Not enough data for this metric.</div></div>`}
   any++;const v=k==='CLS'?m.percentile/100:m.percentile;const c=rate(k,v);if(c!=='good')all=false;
   const ds=(m.distributions||[]).map(x=>Math.round((x.proportion||0)*100));
   return `<div class="metric ${c}"><div class="name">${k} <small>${NAMES[k]}</small></div><div class="val">${fmt(k,v)}</div><span class="pill ${c}">${LBL[c]}</span>
   ${ds.length===3?`<div class="bar" aria-hidden="true"><span style="width:${ds[0]}%"></span><span style="width:${ds[1]}%"></span><span style="width:${ds[2]}%"></span></div><div class="dist">${ds[0]}% good · ${ds[1]}% needs improvement · ${ds[2]}% poor</div>`:''}</div>`}).join('');
  const pass=all&&any===3;
  $('field').innerHTML=`<div class="verdict"><span class="pill ${pass?'good':'poor'}" style="font-size:1rem;padding:4px 14px">${pass?'✓ Passes':'✗ Does not pass'} Core Web Vitals</span><span class="dist">All three must be "good" at p75 to pass.</span></div><div class="grid">${cards}</div>`}
 const lr=d.lighthouseResult||{},a=lr.audits||{},cat=lr.categories||{};
 const ps=cat.performance&&cat.performance.score!=null?Math.round(cat.performance.score*100):null;
 const sc=ps==null?'na':ps>=90?'good':ps>=50?'ni':'poor';const col={good:'var(--good)',ni:'#f59e0b',poor:'var(--poor)',na:'#94a3b8'}[sc];
 const lab=['largest-contentful-paint','cumulative-layout-shift','total-blocking-time','first-contentful-paint','speed-index'].filter(x=>a[x]).map(x=>{const s=a[x].score;const c=s==null?'':s>=.9?'t-good':s>=.5?'t-ni':'t-poor';return `<div>${esc(a[x].title)}<b class="${c}">${esc(a[x].displayValue||'–')}</b></div>`}).join('');
 $('lab').innerHTML=`<div class="score"><div class="gauge" style="background:conic-gradient(${col} ${(ps||0)*3.6}deg,#e2e8f0 0);"><span style="background:#fff;width:88px;height:88px;border-radius:50%;display:grid;place-items:center;color:${col}" aria-label="Performance score ${ps??'unavailable'} out of 100">${ps??'–'}</span></div><div class="labs">${lab}</div></div>${lr.runtimeError?`<p class="note warn">Lighthouse reported: ${esc(lr.runtimeError.message||lr.runtimeError.code)}</p>`:''}`;
 const seoIds=[['is-crawlable','Page can be indexed (no noindex)'],['canonical','Valid canonical tag'],['http-status-code','Successful HTTP status'],['document-title','Has a title tag'],['meta-description','Has a meta description'],['robots-txt','robots.txt is valid'],['crawlable-anchors','Links are crawlable'],['link-text','Links have descriptive text'],['image-alt','Images have alt text'],['hreflang','Valid hreflang']];
 const seo=cat.seo&&cat.seo.score!=null?Math.round(cat.seo.score*100):null;
 $('seo').innerHTML=(seo!=null?`<li><span class="ico ${seo>=90?'pass':'fail'}">${seo}</span><div><strong>Lighthouse SEO score: ${seo}/100</strong></div></li>`:'')+seoIds.filter(x=>a[x[0]]).map(([id,lbl])=>{const au=a[id];const s=au.score;const na=s==null||au.scoreDisplayMode==='notApplicable'||au.scoreDisplayMode==='manual';const ok=s===1;
  return `<li><span class="ico ${na?'na':ok?'pass':'fail'}" aria-hidden="true">${na?'–':ok?'✓':'!'}</span><div><strong>${esc(lbl)}</strong> <span class="pill ${na?'na':ok?'good':'poor'}">${na?'Not applicable':ok?'Pass':'Fail'}</span><div class="d">${esc(au.title)}${au.explanation?' – '+esc(au.explanation):''}</div></div></li>`}).join('');
 $('results').hidden=false;$('results').scrollIntoView({behavior:'smooth',block:'start'});
}
$('f').addEventListener('submit',e=>{e.preventDefault();const u=norm($('u').value);
 if(!u){status('<div class="err"><strong>That doesn\'t look like a valid URL.</strong><p>Enter a full web address, e.g. https://example.com/page</p></div>');$('u').focus();return}
 $('u').value=u;history.replaceState(null,'','?url='+encodeURIComponent(u));run(u)});
const p=new URLSearchParams(location.search).get('url');if(p){const u=norm(p);if(u){$('u').value=u;run(u)}}
})();
