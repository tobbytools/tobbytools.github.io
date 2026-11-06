/* Optional Umami adapter. Disabled unless analytics-config.js is complete.
   Sends a fixed event name plus the page pathname. Does not send query
   strings, referrers, typed URLs, API keys, cookies, or stored ids.
   See ANALYTICS.md. Active collection follows the config, which ships off. */
(()=>{
const EVENTS=new Set([
  'pageview',
  'checker_start',
  'checker_success',
  'checker_error_invalid_url',
  'checker_error_rate_limit',
  'checker_error_key_rejected',
  'checker_error_unreachable',
  'checker_error_test_failed',
  'checker_error_timeout',
  'checker_error_network',
  'kit_cta_checker_results',
  'kit_cta_kit_hero',
  'kit_cta_kit_pricing'
]);
const COLLECT='https://gateway.umami.is/api/send';
const DOC_EXAMPLE_ID='94db1cb1-74f4-4a40-ad6c-962362670409';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cfg=()=>{const c=window.TOBBY_ANALYTICS;return c&&typeof c==='object'?c:{}};
function privacyOptOut(){
  const n=navigator;
  const dnt=n.doNotTrack||window.doNotTrack;
  return dnt==='1'||dnt==='yes'||n.globalPrivacyControl===true;
}
function active(){
  const c=cfg();
  if(c.enabled!==true||c.provider!=='umami')return false;
  if(privacyOptOut())return false;
  if(typeof c.websiteId!=='string'||!UUID.test(c.websiteId)||c.websiteId.toLowerCase()===DOC_EXAMPLE_ID)return false;
  return c.endpoint===COLLECT;
}
function pagePath(){
  const p=location.pathname||'/';
  if(!/^\/[A-Za-z0-9._/-]*$/.test(p)||p.includes('..'))return null;
  return p;
}
function leaks(serialized){
  if(serialized.includes('?')||serialized.includes('#')||/https?:\/\//i.test(serialized))return true;
  if(/AIza[0-9A-Za-z\-_]{10,}/.test(serialized))return true;
  const blobs=[];
  const urlField=document.getElementById('u');
  const keyField=document.getElementById('k');
  if(urlField&&urlField.value.trim().length>=8)blobs.push(urlField.value.trim());
  if(keyField&&keyField.value.trim().length>=4)blobs.push(keyField.value.trim());
  if(location.search.length>1){
    blobs.push(location.search.slice(1));
    try{const q=new URLSearchParams(location.search).get('url');if(q)blobs.push(q);}catch(e){}
  }
  return blobs.some(b=>b&&serialized.includes(b));
}
function buildBody(eventName){
  if(!EVENTS.has(eventName))return null;
  const path=pagePath();
  const host=location.hostname;
  if(!path||!/^[A-Za-z0-9.-]+$/.test(host))return null;
  const payload={website:cfg().websiteId,hostname:host,url:path};
  if(eventName!=='pageview')payload.name=eventName;
  const body={type:'event',payload};
  if(leaks(JSON.stringify(body)))return null;
  return body;
}
function send(eventName){
  try{
    if(!active())return;
    const body=buildBody(eventName);
    if(!body)return;
    fetch(COLLECT,{
      method:'POST',
      keepalive:true,
      credentials:'omit',
      mode:'cors',
      cache:'no-store',
      redirect:'error',
      referrerPolicy:'no-referrer',
      headers:{
        'Content-Type':'application/json',
        'x-umami-website-id':cfg().websiteId,
        'x-umami-hostname':location.hostname
      },
      body:JSON.stringify(body)
    }).then(res=>{
      if(res&&res.body&&typeof res.body.cancel==='function')res.body.cancel();
    }).catch(()=>{});
  }catch(e){}
}
window.tobbyTrack=send;
function arm(){
  send('pageview');
  document.addEventListener('click',ev=>{
    const node=ev.target&&ev.target.closest?ev.target.closest('[data-track]'):null;
    if(!node)return;
    const name=node.getAttribute('data-track')||'';
    if(name.indexOf('kit_cta_')!==0||!EVENTS.has(name))return;
    send(name);
  },true);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',arm);
else arm();
})();
