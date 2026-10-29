/* Free SEO Health Check
   Reading order: 1) this site's own Netlify Function, 2) backup readers,
   3) if the page can't be read at all, Google Lighthouse audits still produce a report. */
(function(){
  var form=document.getElementById('chkForm');
  if(!form)return;
  var input=document.getElementById('chkUrl'),btn=document.getElementById('chkBtn');
  var empty=document.getElementById('chkEmpty'),status=document.getElementById('chkStatus'),statusText=document.getElementById('chkStatusText'),out=document.getElementById('chkOut');

  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function normalize(v){v=(v||'').trim();if(!v)return null;if(!/^https?:\/\//i.test(v))v='https://'+v;try{var u=new URL(v);if(!u.hostname.includes('.'))return null;return u.href;}catch(e){return null;}}
  function timed(url,ms,opts){var c=new AbortController();var t=setTimeout(function(){c.abort();},ms);opts=opts||{};opts.signal=c.signal;return fetch(url,opts).finally(function(){clearTimeout(t);});}
  function setStatus(msg){status.style.display=msg?'flex':'none';if(msg)statusText.textContent=msg;}

  /* ---------- reading a page ---------- */
  var READERS=[
    {name:'own',run:async function(u,ms){var r=await timed('/.netlify/functions/fetch-page?url='+encodeURIComponent(u),ms);if(!r.ok&&r.status!==502&&r.status!==400)return null;var j=await r.json();if(j.error||typeof j.body!=='string')return null;return{body:j.body,status:j.status,finalUrl:j.finalUrl,xRobots:j.xRobotsTag||'',via:'own'};}},
    {name:'jina',run:async function(u,ms){var r=await timed('https://r.jina.ai/'+u,ms,{headers:{'X-Return-Format':'html'}});if(!r.ok)return null;var t=await r.text();return t&&t.length>200?{body:t,via:'jina'}:null;}},
    {name:'allorigins',run:async function(u,ms){var r=await timed('https://api.allorigins.win/get?url='+encodeURIComponent(u),ms);if(!r.ok)return null;var j=await r.json();if(!j||!j.contents)return null;return{body:j.contents,status:j.status&&j.status.http_code,via:'allorigins'};}},
    {name:'corsproxy',run:async function(u,ms){var r=await timed('https://corsproxy.io/?url='+encodeURIComponent(u),ms);if(!r.ok)return null;var t=await r.text();return t&&t.length>40?{body:t,via:'corsproxy'}:null;}}
  ];
  async function readPage(u,ms,onlyFast){
    var list=onlyFast?[READERS[0],READERS[2]]:READERS;
    for(var i=0;i<list.length;i++){try{var res=await list[i].run(u,ms);if(res&&res.body)return res;}catch(e){}}
    return null;
  }

  /* ---------- Google PageSpeed / Lighthouse ---------- */
  function psi(url){
    return timed('https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url='+encodeURIComponent(url)+'&strategy=mobile&category=performance&category=seo&category=accessibility',90000)
      .then(function(r){if(!r.ok)throw new Error('psi '+r.status);return r.json();});
  }

  /* ---------- analysis of real HTML ---------- */
  function analyze(page,url){
    var doc=new DOMParser().parseFromString(page.body,'text/html'),u=new URL(page.finalUrl||url),R=[];
    function add(g,s,t,d,w){R.push({group:g,state:s,title:t,detail:d||'',w:w||1});}
    var q=function(s){return doc.querySelector(s);},qa=function(s){return Array.prototype.slice.call(doc.querySelectorAll(s));};

    var title=(q('title')&&q('title').textContent||'').trim();
    if(!title)add('Titles and Meta','bad','Missing page title','Add a unique title tag. It is the headline Google shows in results.',3);
    else if(title.length<30||title.length>60)add('Titles and Meta','warn','Title is '+title.length+' characters','"'+esc(title)+'". Aim for 30 to 60 characters so it is not cut off.',3);
    else add('Titles and Meta','ok','Title length is good ('+title.length+' characters)','"'+esc(title)+'"',3);
    var md=q('meta[name="description" i]'),desc=md?(md.getAttribute('content')||'').trim():'';
    if(!desc)add('Titles and Meta','bad','Missing meta description','Write a 70 to 160 character summary. Google often uses it as the snippet.',2);
    else if(desc.length<70||desc.length>160)add('Titles and Meta','warn','Meta description is '+desc.length+' characters','Aim for 70 to 160 characters.',2);
    else add('Titles and Meta','ok','Meta description length is good ('+desc.length+' characters)','',2);
    if(desc&&title&&desc.toLowerCase()===title.toLowerCase())add('Titles and Meta','warn','Meta description repeats the title','Write a description that adds detail and gives a reason to click.',1);
    if(q('meta[property="og:title"]')&&q('meta[property="og:description"]'))add('Titles and Meta','ok','Social preview tags found','Open Graph title and description are set.',1);
    else add('Titles and Meta','warn','Social preview tags missing','Add og:title and og:description so shared links look right.',1);
    if(q('meta[property="og:image"]'))add('Titles and Meta','ok','Social preview image set','',1);
    else add('Titles and Meta','warn','No social preview image','Add og:image so links shared on LinkedIn, Facebook and WhatsApp show a picture.',1);
    if(q('link[rel~="icon" i]')||q('link[rel="shortcut icon" i]'))add('Titles and Meta','ok','Favicon set','',1);
    else add('Titles and Meta','warn','No favicon found','Add a favicon. Google shows it next to your result on mobile.',1);

    var hs=qa('h1,h2,h3,h4,h5,h6').map(function(h){return{l:+h.tagName[1],t:(h.textContent||'').replace(/\s+/g,' ').trim()};}).filter(function(h){return h.t;});
    var h1=hs.filter(function(h){return h.l===1;});
    if(!h1.length)add('Headings','bad','No H1 heading','Every page needs one H1 that says what the page is about.',3);
    else if(h1.length>1)add('Headings','warn',h1.length+' H1 headings found','Use one H1 per page and H2s for sections.',3);
    else add('Headings','ok','One H1 heading','"'+esc(h1[0].t.slice(0,90))+'"',3);
    if(h1.length&&h1[0].t.length>70)add('Headings','warn','H1 is '+h1[0].t.length+' characters','Keep the main heading short and clear, ideally under 70 characters.',1);
    var h2n=hs.filter(function(h){return h.l===2;}).length;
    if(h2n<2)add('Headings','warn','Only '+h2n+' H2 subheading'+(h2n===1?'':'s'),'Break the page into sections with H2s so readers and AI tools can scan it.',2);
    else add('Headings','ok',h2n+' H2 subheadings','The page has a clear section structure.',2);
    var skips=0;for(var i=1;i<hs.length;i++){if(hs[i].l-hs[i-1].l>1)skips++;}
    if(skips)add('Headings','warn','Heading levels skipped '+skips+' time'+(skips>1?'s':''),'For example an H2 followed by an H4. Keep levels in order.',1);
    else if(hs.length)add('Headings','ok','Heading levels are in order','',1);

    var body=doc.body?doc.body.cloneNode(true):null,words=0;
    if(body){body.querySelectorAll('script,style,noscript,svg,template').forEach(function(n){n.remove();});words=(body.textContent||'').trim().split(/\s+/).filter(Boolean).length;}
    if(words<300)add('Content','bad','Thin content: about '+words+' words','Pages under 300 words rarely rank. Add useful detail and answers. (Sites that build content with JavaScript can show low counts here.)',3);
    else if(words<600)add('Content','warn','About '+words+' words','Fine for some pages. Service pages usually do better with 600+ words.',3);
    else add('Content','ok','About '+words+' words of content','Enough depth to rank and be cited.',3);
    var imgs=qa('img'),noalt=imgs.filter(function(i){return !i.hasAttribute('alt');}).length;
    if(!imgs.length)add('Content','warn','No image tags found','Relevant images with alt text help engagement and image search.',1);
    else if(noalt)add('Content',noalt>5?'bad':'warn',noalt+' of '+imgs.length+' images missing alt text','Describe each image in its alt attribute.',2);
    else add('Content','ok','All '+imgs.length+' images have alt text','',2);
    var raster=imgs.filter(function(i){var s=(i.getAttribute('src')||i.getAttribute('data-src')||'').toLowerCase().split('?')[0];return s&&!/\.svg$/.test(s)&&!/^data:/.test(s);});
    if(raster.length){
      var nosize=raster.filter(function(i){return !(i.getAttribute('width')&&i.getAttribute('height'));}).length;
      if(nosize/raster.length>0.2)add('Content','warn',nosize+' of '+raster.length+' images have no width and height','Set width and height on images so the layout does not jump while the page loads.',1);
      else add('Content','ok','Images have size attributes','',1);
      var modern=raster.filter(function(i){var s=(i.getAttribute('src')||i.getAttribute('data-src')||'').toLowerCase();return /\.(webp|avif)(\?|$)/.test(s)||(i.parentElement&&i.parentElement.tagName==='PICTURE'&&i.parentElement.querySelector('source[type*="webp"],source[type*="avif"]'))||/format=(webp|avif)|fm=(webp|avif)|auto=format/.test(s);}).length;
      if(modern/raster.length<0.5)add('Content','warn','Most images use older formats','Only '+modern+' of '+raster.length+' images are WebP or AVIF. Modern formats load much faster.',1);
      else add('Content','ok','Images use modern formats','',1);
      if(raster.length>4&&!raster.some(function(i){return i.getAttribute('loading')==='lazy';}))add('Content','warn','No images are lazy-loaded','Add loading="lazy" to images further down the page.',1);
    }
    var internal=0,external=0,vague=0,emptyA=0,VAGUE=['click here','here','read more','learn more','more','this','link','click'];
    qa('a[href]').forEach(function(a){var txt=(a.textContent||'').replace(/\s+/g,' ').trim().toLowerCase();if(VAGUE.indexOf(txt)>-1)vague++;if(!txt&&!a.getAttribute('aria-label')&&!a.getAttribute('title')&&!a.querySelector('img[alt]:not([alt=""])'))emptyA++;});
    if(vague)add('Content','warn',vague+' link'+(vague>1?'s':'')+' with vague text','Text like "click here" or "read more" tells Google nothing. Describe where the link goes.',1);
    else add('Content','ok','Link text is descriptive','',1);
    if(emptyA)add('Content','warn',emptyA+' link'+(emptyA>1?'s have':' has')+' no text','Add text or an aria-label so search engines and screen readers know what it is.',1);
    qa('a[href]').forEach(function(a){var h=a.getAttribute('href')||'';if(/^(#|mailto:|tel:|javascript:)/i.test(h))return;try{var x=new URL(h,u.href);if(x.hostname===u.hostname)internal++;else external++;}catch(e){}});
    if(internal<3)add('Content','warn','Only '+internal+' internal link'+(internal===1?'':'s'),'Link to your related pages so Google can find and rank them.',2);
    else add('Content','ok',internal+' internal and '+external+' external links','',2);

    if(page.status&&page.status>=400)add('Indexing','bad','Page returns HTTP '+page.status,'Google cannot index a page that returns an error status.',4);
    else if(page.status)add('Indexing','ok','Page returns HTTP '+page.status,'',2);
    if(page.finalUrl&&page.finalUrl.replace(/\/$/,'')!==url.replace(/\/$/,''))add('Indexing','warn','The address redirects','It ends up at '+esc(page.finalUrl)+'. Link to the final address directly.',1);
    if(u.protocol!=='https:')add('Indexing','bad','Not using HTTPS','Move the site to HTTPS. Browsers mark HTTP pages as not secure.',3);
    else add('Indexing','ok','Page uses HTTPS','',3);
    var rb=q('meta[name="robots" i]'),rv=(rb?(rb.getAttribute('content')||''):'')+' '+(page.xRobots||'');
    if(/noindex/i.test(rv))add('Indexing','bad','Page is set to noindex','Google is told not to index this page. Remove noindex if it should rank.',4);
    else add('Indexing','ok','Page can be indexed','No noindex tag or header found.',4);
    var cans=qa('link[rel="canonical" i]'),can=cans[0];
    if(cans.length>1)add('Indexing','bad',cans.length+' canonical tags','Use exactly one canonical tag. Conflicting tags may be ignored.',2);
    else if(can){
      var ch='';try{ch=new URL(can.getAttribute('href')||'',u.href).href;}catch(e){}
      if(ch&&ch.replace(/\/$/,'')!==u.href.replace(/\/$/,''))add('Indexing','warn','Canonical points to a different page','It points to '+esc(ch)+'. Fine if intended, but this page itself won\'t rank.',2);
      else add('Indexing','ok','Canonical tag points to this page','',2);
    }
    else add('Indexing','warn','No canonical tag','Add one to tell Google which URL is the main version.',2);
    if(page.body.length>500000)add('Indexing','warn','Page HTML is '+Math.round(page.body.length/1024)+' KB','Very large pages load slowly and may not be fully processed. Aim for under 500 KB of HTML.',1);
    if(q('meta[name="viewport" i]'))add('Indexing','ok','Mobile viewport set','',2);
    else add('Indexing','bad','No mobile viewport tag','The page may not display properly on phones.',2);
    var lang=doc.documentElement.getAttribute('lang');
    if(lang)add('Indexing','ok','Language declared ('+esc(lang)+')','',1);
    else add('Indexing','warn','No language declared','Add a lang attribute to the html tag.',1);
    var types=[],ldErr=0;qa('script[type="application/ld+json"]').forEach(function(s){try{(function walk(o){if(Array.isArray(o))return o.forEach(walk);if(o&&typeof o==='object'){if(o['@type'])types=types.concat(o['@type']);if(o['@graph'])walk(o['@graph']);}})(JSON.parse(s.textContent));}catch(e){ldErr++;}});
    if(ldErr)add('Indexing','bad',ldErr+' broken structured data block'+(ldErr>1?'s':''),'The JSON-LD code has syntax errors, so Google ignores it. Test it in Google\'s Rich Results Test.',2);
    types=types.filter(function(t,i,a){return a.indexOf(t)===i;});
    if(types.length)add('Indexing','ok','Structured data found','Schema types: '+esc(types.slice(0,6).join(', ')),2);
    else add('Indexing','warn','No structured data','Add schema (for example LocalBusiness, Service or FAQPage) to help Google and AI tools understand the page.',2);
    return{results:R,headings:hs};
  }

  /* ---------- fallback analysis from Lighthouse when HTML can't be read ---------- */
  function fromLighthouse(j){
    var a=j.lighthouseResult.audits,R=[];
    function m(id,g,okT,badT,detail,w){var x=a[id];if(!x||x.score===null||x.score===undefined)return;R.push({group:g,state:x.score>=0.9?'ok':(x.score>=0.5?'warn':'bad'),title:x.score>=0.9?okT:badT,detail:detail,w:w||1});}
    m('document-title','Titles and Meta','Page has a title','Missing page title','',3);
    m('meta-description','Titles and Meta','Page has a meta description','Missing meta description','Write a 70 to 160 character summary.',2);
    m('heading-order','Headings','Heading levels are in order','Heading levels are skipped','Keep H1, H2 and H3 in order.',2);
    m('link-text','Content','Links have descriptive text','Some links say things like "click here"','Use text that describes where the link goes.',1);
    m('image-alt','Content','Images have alt text','Some images are missing alt text','Describe each image in its alt attribute.',2);
    m('crawlable-anchors','Content','Links are crawlable','Some links can\'t be crawled','Use real href links so Google can follow them.',1);
    m('http-status-code','Indexing','Page returns a successful status','Page returns an error status','',4);
    m('is-crawlable','Indexing','Page can be indexed','Page is blocked from indexing','Check for noindex tags or robots.txt rules.',4);
    m('canonical','Indexing','Canonical tag is valid','Canonical tag has a problem','',2);
    m('robots-txt','Indexing','robots.txt is valid','robots.txt has errors','',1);
    m('hreflang','Indexing','Language tags are valid','Language tags have errors','',1);
    return{results:R,headings:[]};
  }

  /* ---------- rendering ---------- */
  var STATE=null;
  function speedRows(j){
    if(!j)return[];var a=j.lighthouseResult.audits,c=j.lighthouseResult.categories,R=[];
    function n(k){return a[k]&&typeof a[k].numericValue==='number'?a[k].numericValue:null;}
    var p=c.performance&&c.performance.score;
    if(p!=null)R.push({group:'Speed',state:p>=.9?'ok':p>=.5?'warn':'bad',title:'Mobile performance score '+Math.round(p*100),detail:p>=.9?'':'Google rates 90+ as good on mobile.',w:3});
    var l=n('largest-contentful-paint');if(l!=null)R.push({group:'Speed',state:l<=2500?'ok':l<=4000?'warn':'bad',title:'Largest Contentful Paint '+(l/1000).toFixed(1)+' s',detail:l<=2500?'':'The main content should appear within 2.5 seconds.',w:2});
    var s=n('cumulative-layout-shift');if(s!=null)R.push({group:'Speed',state:s<=.1?'ok':s<=.25?'warn':'bad',title:'Layout shift '+s.toFixed(2),detail:s<=.1?'':'Keep layout shift under 0.1 so the page does not jump while loading.',w:2});
    var b=n('total-blocking-time');if(b!=null)R.push({group:'Speed',state:b<=200?'ok':b<=600?'warn':'bad',title:'Total Blocking Time '+Math.round(b)+' ms',detail:b<=200?'':'Heavy scripts delay clicks and taps. Aim for under 200 ms.',w:1});
    return R;
  }
  function render(data,url,extra,note){
    STATE=Object.assign(STATE||{},{data:data,url:url,extra:extra,note:note});
    var R=data.results.concat(extra||[],STATE.speed||[]);
    var tot=0,got=0,c={ok:0,warn:0,bad:0};
    R.forEach(function(r){tot+=r.w;got+=r.w*(r.state==='ok'?1:r.state==='warn'?.5:0);c[r.state]++;});
    var score=tot?Math.round(got/tot*100):0,col=score>=80?'var(--ok)':score>=55?'var(--warn)':'var(--bad)',grade=score>=80?'Healthy':score>=55?'Needs Work':'Poor';
    var C=2*Math.PI*54,off=C*(1-score/100),icon={ok:'&#10003;',warn:'!',bad:'&#10005;'};
    var groups=['Titles and Meta','Headings','Content','Indexing','Speed'],gcol={'Titles and Meta':'var(--violet)','Headings':'var(--coral)','Content':'#0E8F84','Indexing':'var(--reef)','Speed':'#B26A00'};
    var h='<div class="summary"><div class="ring"><svg viewBox="0 0 132 132" aria-hidden="true"><circle cx="66" cy="66" r="54" fill="none" stroke="#EEF0F3" stroke-width="12"/><circle cx="66" cy="66" r="54" fill="none" stroke="'+col+'" stroke-width="12" stroke-linecap="round" stroke-dasharray="'+C.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'"/></svg><div class="num" style="color:'+col+'"><span>'+score+'<small>out of 100</small></span></div></div>';
    h+='<div class="sum-text"><h3>Basic SEO Check: '+grade+'</h3><p>'+esc(url)+'</p><div class="counts"><span class="c-ok">'+c.ok+' passed</span><span class="c-warn">'+c.warn+' to improve</span><span class="c-bad">'+c.bad+' issues</span></div></div></div>';
    h+='<p class="basic-note">'+(STATE.speed?'This score includes Google\'s speed results. ':'The score updates when Google\'s speed test finishes. ')+'It covers one page\'s on-page and technical basics. It can\'t see backlinks, rankings, competitors or your other pages, which a <a href="/contact/">full SEO audit</a> covers.</p>';
    if(note)h+='<p class="tool-note" style="margin-top:16px">'+note+'</p>';
    h+='<div class="groups">';
    groups.forEach(function(g){
      var rows=R.filter(function(r){return r.group===g;}).sort(function(a,b){var o={bad:0,warn:1,ok:2};return o[a.state]-o[b.state];});
      if(!rows.length)return;
      h+='<div class="group" style="--g:'+gcol[g]+'"><h4>'+g+'</h4>';
      rows.forEach(function(r){h+='<div class="row '+r.state+'"><i aria-hidden="true">'+icon[r.state]+'</i><div><b>'+r.title+'</b>'+(r.detail?'<span>'+r.detail+'</span>':'')+'</div></div>';});
      h+='</div>';
    });
    h+='</div>';
    if(data.headings.length){
      h+='<div class="outline"><h4>Heading Outline</h4><ol>';
      data.headings.slice(0,60).forEach(function(x){h+='<li class="l'+x.l+'"><b>H'+x.l+'</b>'+esc(x.t.slice(0,110))+'</li>';});
      h+='</ol></div>';
    }
    h+='<div class="speed" id="chkSpeed">'+(STATE.speedHtml||'<h4>Speed and Core Web Vitals (Google PageSpeed, mobile)</h4><p style="margin:0;color:var(--soft);display:flex;align-items:center;gap:10px"><span class="spinner" aria-hidden="true"></span>Running Google\'s test. This can take 20 to 60 seconds.</p>')+'</div>';
    h+='<div class="tool-cta"><p>Want these fixed? I\'ll send a free, detailed review of this page.</p><a class="btn btn-sun" href="/contact/?site='+encodeURIComponent(url)+'">Get a Free Review</a></div>';
    out.innerHTML=h;out.style.display='block';
  }
  function finishSpeed(j){
    if(!STATE)return;
    var holder=document.createElement('div');holder.id='chkSpeedTmp';document.body.appendChild(holder);
    holder.innerHTML='<div id="chkSpeedX"></div>';
    renderSpeed(j,holder.firstChild);
    STATE.speedHtml=holder.firstChild.innerHTML;holder.remove();
    STATE.speed=speedRows(j);
    render(STATE.data,STATE.url,STATE.extra,STATE.note);
  }
  function renderSpeed(j,target){
    var box=target||document.getElementById('chkSpeed');if(!box)return;
    if(!j){box.innerHTML='<h4>Speed and Core Web Vitals</h4><p style="margin:0;color:var(--soft)">Google\'s speed test is busy or could not reach this page. Try again in a minute, or test it at <a href="https://pagespeed.web.dev/" target="_blank" rel="noopener">pagespeed.web.dev</a>.</p>';return;}
    var cat=j.lighthouseResult.categories,a=j.lighthouseResult.audits;
    function sc(v){if(v==null)return '<b>n/a</b>';var n=Math.round(v*100),c=n>=90?'var(--ok)':n>=50?'var(--warn)':'var(--bad)';return '<b style="color:'+c+'">'+n+'</b>';}
    function au(k){return a[k]&&a[k].displayValue?esc(a[k].displayValue):'n/a';}
    box.innerHTML='<h4>Speed and Core Web Vitals (Google PageSpeed, mobile)</h4><div class="speed-grid"><div>'+sc(cat.performance&&cat.performance.score)+'<span>Performance score</span></div><div>'+sc(cat.seo&&cat.seo.score)+'<span>Lighthouse SEO score</span></div><div><b>'+au('largest-contentful-paint')+'</b><span>Largest Contentful Paint</span></div><div><b>'+au('cumulative-layout-shift')+'</b><span>Cumulative Layout Shift</span></div><div><b>'+au('total-blocking-time')+'</b><span>Total Blocking Time</span></div></div>';
  }
  function fail(msg){out.innerHTML='<div class="row bad"><i aria-hidden="true">&#10005;</i><div><b>We could not check that page</b><span>'+msg+'</span></div></div>';out.style.display='block';}

  form.addEventListener('submit',async function(e){
    e.preventDefault();
    var url=normalize(input.value);
    if(!url){input.setCustomValidity('Enter a full website address, like https://example.com');input.reportValidity();input.setCustomValidity('');return;}
    input.value=url;btn.disabled=true;btn.textContent='Checking...';
    empty&&(empty.style.display='none');out.style.display='none';setStatus('Reading the page...');
    var speedJob=psi(url).catch(function(){return null;});
    try{
      var page=await readPage(url,15000);
      if(page){
        var data=analyze(page,url);
        setStatus('Checking robots.txt and sitemap...');
        var origin=new URL(page.finalUrl||url).origin,extra=[];
        var rob=await readPage(origin+'/robots.txt',8000,true),rt=rob&&rob.body||'';
        var robotsOk=!!(rt&&(!rob.status||rob.status<400)&&/user-agent|sitemap|disallow|allow/i.test(rt)&&!/<html/i.test(rt));
        var sitemapOk=robotsOk&&/^\s*sitemap:/im.test(rt);
        if(!sitemapOk){var sm=await readPage(origin+'/sitemap.xml',8000,true);sitemapOk=!!(sm&&(!sm.status||sm.status<400)&&/<(urlset|sitemapindex)/i.test(sm.body));}
        extra.push(robotsOk?{group:'Indexing',state:'ok',title:'robots.txt found',detail:'',w:1}:{group:'Indexing',state:'warn',title:'robots.txt not found',detail:'Add a robots.txt file so search engines know what to crawl.',w:1});
        extra.push(sitemapOk?{group:'Indexing',state:'ok',title:'XML sitemap found',detail:'',w:1}:{group:'Indexing',state:'warn',title:'XML sitemap not found',detail:'No /sitemap.xml and no sitemap line in robots.txt.',w:1});
        setStatus('');STATE=null;render(data,url,extra,'');
        out.scrollIntoView({behavior:'smooth',block:'start'});
        finishSpeed(await speedJob);
      }else{
        setStatus('This site blocks direct reading. Running Google\'s checks instead (up to a minute)...');
        var j=await speedJob;
        setStatus('');
        if(!j){fail('The site did not respond to us or to Google\'s test. Check the address is correct and the site is online, then try again.');return;}
        STATE=null;render(fromLighthouse(j),url,[],'This site blocked our direct reader, so this report uses Google\'s Lighthouse checks. Word count and the heading outline are not available for this site.');
        finishSpeed(j);
        out.scrollIntoView({behavior:'smooth',block:'start'});
      }
    }finally{btn.disabled=false;btn.textContent='Check My Site';setStatus('');}
  });
  /* prefill from ?check= */
  var pre=new URLSearchParams(location.search).get('check');if(pre){input.value=pre;}
})();
