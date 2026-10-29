/* Free Basic SEO Check
   - Reads the page through this site's Netlify Function (backups if unavailable)
   - Samples up to 10 pages from the sitemap for site-wide problems
   - Adds Google PageSpeed (speed, technical and accessibility findings)
   - Scores by severity; explains every issue in plain English without fix instructions */
(function(){
  var form=document.getElementById('chkForm');
  if(!form)return;

  /* Optional: a free Google API key for PageSpeed Insights, restricted to your domain.
     Without it, Google's shared limit sometimes refuses the speed test. */
  var PSI_KEY='';
  var SAMPLE_PAGES=10;

  var input=document.getElementById('chkUrl'),btn=document.getElementById('chkBtn');
  var empty=document.getElementById('chkEmpty'),status=document.getElementById('chkStatus'),statusText=document.getElementById('chkStatusText'),out=document.getElementById('chkOut');
  var SEV={critical:{label:'Critical',p:12,o:0},high:{label:'High',p:7,o:1},medium:{label:'Medium',p:3,o:2},low:{label:'Low',p:1,o:3}};
  var GROUPS=['Indexing and Crawling','Across Your Site','Titles and Descriptions','Headings and Content','Images','Speed and Technical','Accessibility'];

  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function normalize(v){v=(v||'').trim();if(!v)return null;if(!/^https?:\/\//i.test(v))v='https://'+v;try{var u=new URL(v);if(!u.hostname.includes('.'))return null;return u.href;}catch(e){return null;}}
  function timed(url,ms,opts){var c=new AbortController();var t=setTimeout(function(){c.abort();},ms);opts=opts||{};opts.signal=c.signal;return fetch(url,opts).finally(function(){clearTimeout(t);});}
  function setStatus(msg){status.style.display=msg?'flex':'none';if(msg)statusText.textContent=msg;}
  function plural(n,a,b){return n+' '+(n===1?a:(b||a+'s'));}
  function pathOf(u){try{var x=new URL(u);return x.pathname+(x.search||'');}catch(e){return u;}}

  /* ---------- reading pages ---------- */
  var OWN_OK=null;
  async function readOwn(u,ms){
    try{var r=await timed('/.netlify/functions/fetch-page?url='+encodeURIComponent(u),ms||11000);
      if(r.status===404){OWN_OK=false;return null;}
      var j=await r.json();OWN_OK=true;if(j.error)return{error:j.error};return j;}catch(e){return null;}
  }
  var BACKUPS=[
    async function(u,ms){var r=await timed('https://r.jina.ai/'+u,ms,{headers:{'X-Return-Format':'html'}});if(!r.ok)return null;var t=await r.text();return t&&t.length>200?{body:t}:null;},
    async function(u,ms){var r=await timed('https://api.allorigins.win/get?url='+encodeURIComponent(u),ms);if(!r.ok)return null;var j=await r.json();return j&&j.contents?{body:j.contents,status:j.status&&j.status.http_code}:null;},
    async function(u,ms){var r=await timed('https://corsproxy.io/?url='+encodeURIComponent(u),ms);if(!r.ok)return null;var t=await r.text();return t&&t.length>40?{body:t}:null;}
  ];
  async function readPage(u,ms,ownOnly){
    var j=await readOwn(u,ms);if(j&&!j.error&&typeof j.body==='string')return j;
    if(j&&j.error&&OWN_OK)return null;
    if(ownOnly)return null;
    for(var i=0;i<BACKUPS.length;i++){try{var r=await BACKUPS[i](u,ms||15000);if(r&&r.body)return r;}catch(e){}}
    return null;
  }
  function psi(url){
    var api='https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url='+encodeURIComponent(url)+'&strategy=mobile&category=performance&category=seo&category=accessibility&category=best-practices'+(PSI_KEY?'&key='+PSI_KEY:'');
    return timed(api,90000).then(function(r){if(!r.ok)throw new Error('psi '+r.status);return r.json();});
  }

  /* ---------- single page analysis ---------- */
  function analyze(page,url){
    var doc=new DOMParser().parseFromString(page.body,'text/html'),u=new URL(page.finalUrl||url),I=[],P=[];
    function issue(g,sev,title,why){I.push({group:g,sev:sev,title:title,why:why});}
    function pass(t){P.push(t);}
    var q=function(s){return doc.querySelector(s);},qa=function(s){return Array.prototype.slice.call(doc.querySelectorAll(s));};
    var isHome=u.pathname==='/'||u.pathname==='';

    /* Indexing */
    if(page.status&&page.status>=400)issue('Indexing and Crawling','critical','The page returns an error ('+page.status+')','Google cannot list a page that returns an error, and visitors see a broken page.');
    if(u.protocol!=='https:')issue('Indexing and Crawling','critical','The page is not secure (no HTTPS)','Browsers show a "Not secure" warning, and Google favors secure sites.');else pass('Secure connection (HTTPS)');
    var rb=q('meta[name="robots" i]'),rv=(rb?(rb.getAttribute('content')||''):'')+' '+(page.xRobotsTag||'');
    if(/noindex/i.test(rv))issue('Indexing and Crawling','critical','This page is hidden from Google','The page tells search engines not to list it, so it cannot appear in Google or AI answers at all.');else pass('Page is allowed in Google');
    var cans=qa('link[rel="canonical" i]');
    if(!cans.length)issue('Indexing and Crawling','high','No official address is set for this page','Links with tracking tags (like ?ref= from Product Hunt or ads) can be treated as separate copies, splitting the page\'s ranking strength.');
    else if(cans.length>1)issue('Indexing and Crawling','high','The page gives Google '+cans.length+' different official addresses','Conflicting signals mean Google may ignore all of them and pick an address on its own.');
    else{var ch='';try{ch=new URL(cans[0].getAttribute('href')||'',u.href).href;}catch(e){}
      if(ch&&ch.replace(/\/$/,'')!==u.href.replace(/[?#].*$/,'').replace(/\/$/,''))issue('Indexing and Crawling','medium','The page points Google to a different address','Google is told another page is the main version, so this page itself is unlikely to rank.');else pass('Official address (canonical) set');}
    if(!q('meta[name="viewport" i]'))issue('Indexing and Crawling','high','The page is not set up for phones','Without mobile settings the page can display tiny and zoomed out on phones, and Google ranks sites by their mobile version.');else pass('Mobile settings present');
    if(!doc.documentElement.getAttribute('lang'))issue('Indexing and Crawling','low','The page doesn\'t declare its language','Search engines and screen readers have to guess the language of the page.');else pass('Language declared');
    if(page.redirected||(page.finalUrl&&page.finalUrl.replace(/\/$/,'')!==url.replace(/\/$/,'')))issue('Indexing and Crawling','low','The address you entered redirects','Every redirect adds a delay and passes slightly less value to the final page.');

    /* Structured data */
    var types=[],ldErr=0;
    qa('script[type="application/ld+json"]').forEach(function(s){try{(function walk(o){if(Array.isArray(o))return o.forEach(walk);if(o&&typeof o==='object'){if(o['@type'])types=types.concat(o['@type']);if(o['@graph'])walk(o['@graph']);}})(JSON.parse(s.textContent));}catch(e){ldErr++;}});
    types=types.filter(function(t,i,a){return a.indexOf(t)===i;});
    if(ldErr)issue('Indexing and Crawling','high',plural(ldErr,'block')+' of structured data are broken','Google ignores structured data with errors, so the facts it was meant to share are lost.');
    if(!types.length)issue('Indexing and Crawling','high','No structured data on the page','Google and AI assistants have to guess who you are, what you offer and what it costs, and they often guess wrong.');
    else{pass('Structured data found ('+types.slice(0,4).join(', ')+')');
      if(isHome&&!types.some(function(t){return /Organization|LocalBusiness|Corporation|ProfessionalService|Person|WebSite/.test(t);}))issue('Indexing and Crawling','medium','Your business isn\'t described to Google','The homepage doesn\'t tell search engines the business name, logo and profiles, which AI assistants rely on to describe you correctly.');}

    /* Titles and descriptions */
    var title=(q('title')&&q('title').textContent||'').trim();
    if(!title)issue('Titles and Descriptions','critical','The page has no title','Google has no headline to show for this page in search results.');
    else if(title.length>60)issue('Titles and Descriptions','medium','The page title is too long ('+title.length+' characters)','Google cuts titles at about 60 characters, so searchers see a clipped headline: "'+esc(title.slice(0,70))+(title.length>70?'...':'')+'"');
    else if(title.length<30)issue('Titles and Descriptions','medium','The page title is too short ('+title.length+' characters)','"'+esc(title)+'" uses little of the space Google gives you to attract the click.');
    else pass('Title length ('+title.length+' characters)');
    var md=q('meta[name="description" i]'),desc=md?(md.getAttribute('content')||'').trim():'';
    if(!desc)issue('Titles and Descriptions','high','There is no search result description','Google writes its own summary from random page text, which usually gets fewer clicks.');
    else if(desc.length>160)issue('Titles and Descriptions','medium','The search description is too long ('+desc.length+' characters)','Google shows about 155 characters, so the end of your message is cut off.');
    else if(desc.length<70)issue('Titles and Descriptions','medium','The search description is too short ('+desc.length+' characters)','A short summary gives searchers little reason to choose your result.');
    else pass('Description length ('+desc.length+' characters)');
    if(desc&&title&&desc.toLowerCase()===title.toLowerCase())issue('Titles and Descriptions','low','The description just repeats the title','Searchers get no extra reason to click.');
    if(!(q('meta[property="og:title"]')&&q('meta[property="og:description"]')))issue('Titles and Descriptions','low','Shared links won\'t show a proper preview','When the page is shared on LinkedIn, Facebook or WhatsApp, the preview text is missing or random.');else pass('Social preview text set');
    if(!q('meta[property="og:image"]'))issue('Titles and Descriptions','low','Shared links have no preview image','Posts without an image get far less attention on social media.');else pass('Social preview image set');
    if(!(q('link[rel~="icon" i]')||q('link[rel="shortcut icon" i]')))issue('Titles and Descriptions','low','No site icon (favicon)','Google shows this small icon next to your result on mobile; without it the result looks generic.');else pass('Site icon set');

    /* Headings and content */
    var hs=qa('h1,h2,h3,h4,h5,h6').map(function(h){return{l:+h.tagName[1],t:(h.textContent||'').replace(/\s+/g,' ').trim()};}).filter(function(h){return h.t;});
    var h1=hs.filter(function(h){return h.l===1;}),h1txt=h1.map(function(h){return h.t.toLowerCase();});
    var h1dup=h1txt.length-h1txt.filter(function(t,i,a){return a.indexOf(t)===i;}).length;
    if(!h1.length)issue('Headings and Content','high','The page has no main heading','The main heading is the strongest signal of what a page is about. Without one, Google has to guess.');
    else if(h1.length>3||h1dup)issue('Headings and Content','high','The main heading is split into '+h1.length+' pieces','Google sees '+h1.length+' separate main headings ('+esc(h1.slice(0,4).map(function(h){return'"'+h.t.slice(0,30)+'"';}).join(', '))+(h1.length>4?', ...':'')+') instead of one clear statement of what the page is about.');
    else if(h1.length>1)issue('Headings and Content','medium',h1.length+' main headings compete with each other','With more than one main heading, the page\'s topic is less clear to Google.');
    else{pass('One main heading');if(h1[0].t.length>70)issue('Headings and Content','low','The main heading is very long','Long headings are harder for visitors to scan and for Google to read as a clear topic.');}
    var h2n=hs.filter(function(h){return h.l===2;}).length;
    if(h2n<2)issue('Headings and Content','medium','The page has almost no section headings','Search engines and AI tools use section headings to understand, and quote, what each part of a page covers.');else pass(h2n+' section headings');
    var skips=0;for(var i=1;i<hs.length;i++){if(hs[i].l-hs[i-1].l>1)skips++;}
    if(skips)issue('Headings and Content','low','Heading levels are out of order','A jumbled heading structure makes the page harder for Google and screen readers to follow.');
    var body=doc.body?doc.body.cloneNode(true):null,words=0,text='';
    if(body){body.querySelectorAll('script,style,noscript,svg,template,nav,footer,header').forEach(function(n){n.remove();});text=(body.textContent||'').replace(/\s+/g,' ').trim();words=text?text.split(' ').length:0;}
    if(words<300)issue('Headings and Content','high','Very little text on the page (about '+words+' words)','Pages with little text rarely rank for anything except the brand name, and AI tools have nothing to quote.');
    else if(words<500)issue('Headings and Content','low','Light content (about '+words+' words)','Competing pages usually cover the topic in more depth.');
    else pass('About '+words+' words of content');
    var raw=page.body;
    var PH=[['Lorem ipsum','lorem ipsum'],['This is some text inside of a div block','inside of a div block'],['Your browser does not support the video tag','does not support the video tag'],['Heading text placeholder','heading placeholder'],['Add your text here','add your text here']];
    var found=PH.filter(function(p){return raw.toLowerCase().indexOf(p[1])>-1;});
    if(found.length)issue('Headings and Content','high','Template placeholder text is published','The page code still contains default template text ("'+esc(found[0][0])+'"). Google and AI tools read it as part of your content, and it looks unfinished.');
    var vague=0,emptyA=0,internal=0,VAGUE=['click here','here','read more','learn more','more','this','link','click'];
    qa('a[href]').forEach(function(a){var t=(a.textContent||'').replace(/\s+/g,' ').trim().toLowerCase();if(VAGUE.indexOf(t)>-1)vague++;if(!t&&!a.getAttribute('aria-label')&&!a.getAttribute('title')&&!a.querySelector('img[alt]:not([alt=""])'))emptyA++;
      var h=a.getAttribute('href')||'';if(/^(#|mailto:|tel:|javascript:)/i.test(h))return;try{if(new URL(h,u.href).hostname===u.hostname)internal++;}catch(e){}});
    if(vague)issue('Headings and Content','low',plural(vague,'link')+' with vague text like "read more"','Link text tells Google what the linked page is about. "Click here" tells it nothing.');
    if(emptyA)issue('Accessibility','low',plural(emptyA,'link')+' with no text at all','Screen readers announce these as just "link", and Google can\'t tell where they go.');
    if(internal<3)issue('Headings and Content','medium','Very few links to your other pages','Internal links help Google find, understand and rank your other pages.');else pass(internal+' links to other pages on the site');

    /* Images */
    var imgs=qa('img'),noalt=imgs.filter(function(i){return !i.hasAttribute('alt');}).length;
    if(imgs.length){
      if(noalt)issue('Images',noalt/imgs.length>.25?'high':'medium',noalt+' of '+imgs.length+' images have no description','Images without descriptions are invisible to Google Images and to blind visitors using screen readers.');else pass('All images have descriptions');
      var raster=imgs.filter(function(i){var s=(i.getAttribute('src')||i.getAttribute('data-src')||'').toLowerCase().split('?')[0];return s&&!/\.svg$/.test(s)&&!/^data:/.test(s);});
      if(raster.length){
        var nosize=raster.filter(function(i){return !(i.getAttribute('width')&&i.getAttribute('height'));}).length;
        if(nosize/raster.length>.2)issue('Images','medium',nosize+' of '+raster.length+' images have no set size','The page jumps around as these images load, which frustrates visitors and hurts Google\'s page-experience score.');else pass('Images have set sizes');
        var modern=raster.filter(function(i){var s=(i.getAttribute('src')||i.getAttribute('data-src')||'').toLowerCase();return /\.(webp|avif)(\?|$)/.test(s)||(i.parentElement&&i.parentElement.tagName==='PICTURE'&&i.parentElement.querySelector('source[type*="webp"],source[type*="avif"]'))||/format=(webp|avif)|fm=(webp|avif)|auto=format/.test(s);}).length;
        if(modern/raster.length<.5)issue('Images','medium','Most images use old, heavy formats','Only '+modern+' of '+raster.length+' images use modern formats. Heavy images are the most common reason pages load slowly on phones.');else pass('Images use modern formats');
        var first=raster[0];
        if(first&&first.getAttribute('loading')==='lazy')issue('Images','high','The main image is set to load late','The first image on the page is told to wait before loading. Google measures how fast the main content appears, so this makes the page score worse.');
        if(raster.length>4&&!raster.some(function(i){return i.getAttribute('loading')==='lazy';}))issue('Images','low','All images load at once','Images far down the page download before visitors need them, slowing the first view.');
      }
    }

    /* Scripts and technical */
    var headScripts=qa('head script[src]').filter(function(s){return !s.hasAttribute('async')&&!s.hasAttribute('defer')&&(s.getAttribute('type')||'')!=='module';});
    if(headScripts.length>=2)issue('Speed and Technical','medium',plural(headScripts.length,'script')+' hold up the page before it appears','Visitors see a blank screen while these files download, which is most noticeable on phones.');
    var libs={};qa('script[src]').forEach(function(s){var src=(s.getAttribute('src')||'').split('?')[0].toLowerCase();var name=src.split('/').pop().replace(/\.min\.js$|\.js$/,'');var pkg=(src.match(/npm\/(@?[^@\/]+(?:\/[^@\/]+)?)@/)||[])[1];var key=pkg||name;if(!key||key.length<3)return;libs[key]=(libs[key]||0)+1;});
    var dups=Object.keys(libs).filter(function(k){return libs[k]>1;});
    if(dups.length)issue('Speed and Technical','high','The same script is loaded more than once','"'+esc(dups[0])+'" is loaded '+libs[dups[0]]+' times, so every visitor downloads the same code twice.');
    if(page.bytes&&page.bytes>500000)issue('Speed and Technical','medium','The page code is very large ('+Math.round(page.bytes/1024)+' KB)','Very large pages load slowly and may not be fully processed by search engines.');
    if(page.headers){
      var H=page.headers;
      if(page.ms>800)issue('Speed and Technical',page.ms>1800?'high':'medium','The server is slow to respond ('+(page.ms/1000).toFixed(1)+' s)','Nothing can appear until the server responds, so every visitor waits before the page even starts loading.');else pass('Server responds quickly');
      if(!H['content-encoding']&&page.bytes>20000)issue('Speed and Technical','medium','Page files are not compressed','Uncompressed pages take longer to download, especially on mobile data.');
      var sec=['x-frame-options','x-content-type-options','referrer-policy','content-security-policy','permissions-policy'].filter(function(k){return !H[k];});
      if(sec.length>=3)issue('Speed and Technical','low',sec.length+' standard security settings are missing','They protect visitors from some common attacks, and security-minded buyers check them.');
    }
    return{issues:I,passed:P,headings:hs,info:{title:title,desc:desc,origin:u.origin,home:isHome}};
  }

  /* ---------- site-wide sample from the sitemap ---------- */
  function summary(html){
    var d=new DOMParser().parseFromString(html,'text/html');
    var rb=d.querySelector('meta[name="robots" i]');var b=d.body?d.body.cloneNode(true):null,w=0;
    if(b){b.querySelectorAll('script,style,noscript,svg,template,nav,footer,header').forEach(function(n){n.remove();});var t=(b.textContent||'').replace(/\s+/g,' ').trim();w=t?t.split(' ').length:0;}
    return{title:((d.querySelector('title')||{}).textContent||'').trim(),desc:((d.querySelector('meta[name="description" i]')||{getAttribute:function(){return'';}}).getAttribute('content')||'').trim(),
      noindex:/noindex/i.test(rb?rb.getAttribute('content')||'':''),canonical:!!d.querySelector('link[rel="canonical" i]'),h1:d.querySelectorAll('h1').length,words:w};
  }
  async function locs(xml){return(xml.match(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)||[]).map(function(m){return m.replace(/<\/?loc>/gi,'').trim().replace(/&amp;/g,'&');});}
  async function siteSample(origin,robotsTxt,current){
    var smUrl=(robotsTxt&&(robotsTxt.match(/^\s*sitemap:\s*(\S+)/im)||[])[1])||origin+'/sitemap.xml';
    var sm=await readPage(smUrl,9000,true);if(!sm||!sm.body||!/<(urlset|sitemapindex)/i.test(sm.body))return null;
    var list=await locs(sm.body);
    if(/<sitemapindex/i.test(sm.body)){var all=[];for(var i=0;i<Math.min(list.length,3);i++){var c=await readPage(list[i],9000,true);if(c&&c.body)all=all.concat(await locs(c.body));}list=all;}
    var total=list.length,cur=current.replace(/\/$/,'');
    list=list.filter(function(x){return x.replace(/\/$/,'')!==cur;});
    /* spread the sample across the sitemap */
    var pick=[];var step=Math.max(1,Math.floor(list.length/SAMPLE_PAGES));for(var k=0;k<list.length&&pick.length<SAMPLE_PAGES;k+=step)pick.push(list[k]);
    var res=[],idx=0;
    async function worker(){while(idx<pick.length){var u=pick[idx++];var p=await readPage(u,9000,true);if(!p){res.push({url:u,fail:true});continue;}
      var s=p.body?summary(p.body):{};s.url=u;s.status=p.status;s.redirected=p.redirected;res.push(s);}}
    await Promise.all([worker(),worker(),worker()]);
    return{total:total,pages:res,urls:list};
  }
  function siteIssues(S,main){
    var I=[];if(!S)return I;
    function issue(sev,title,why){I.push({group:'Across Your Site',sev:sev,title:title,why:why});}
    var ok=S.pages.filter(function(p){return !p.fail&&(!p.status||p.status<400);});
    var all=ok.concat([{url:'(this page)',title:main.title,desc:main.desc}]);
    function dupGroups(key){var m={};all.forEach(function(p){var v=(p[key]||'').toLowerCase();if(v)(m[v]=m[v]||[]).push(p.url);});return Object.keys(m).map(function(k){return m[k];}).filter(function(g){return g.length>1;});}
    var dt=dupGroups('title'),n=dt.reduce(function(a,g){return a+g.length;},0);
    if(n)issue(n>=4?'high':'medium',n+' of '+all.length+' checked pages share the same title','In Google, these pages look identical, so searchers can\'t tell them apart and Google can\'t tell which one should rank.');
    var dd=dupGroups('desc'),m=dd.reduce(function(a,g){return a+g.length;},0);
    if(m)issue(m>=4?'high':'medium',m+' of '+all.length+' checked pages share the same description','Identical summaries in search results make every page look the same and reduce clicks.');
    var hidden=ok.filter(function(p){return p.noindex;});
    if(hidden.length)issue('high',plural(hidden.length,'page')+' in your sitemap '+(hidden.length===1?'is':'are')+' hidden from Google','You ask Google to visit '+(hidden.length===1?'this page':'these pages')+' but also tell it not to list '+(hidden.length===1?'it':'them')+' ('+hidden.slice(0,3).map(function(p){return esc(pathOf(p.url));}).join(', ')+'). Important pages may be invisible in search.');
    var broken=S.pages.filter(function(p){return p.status>=400||p.redirected;});
    if(broken.length)issue('high',plural(broken.length,'page')+' in your sitemap '+(broken.length===1?'is':'are')+' broken or redirect','Google is sent to addresses that fail or move ('+broken.slice(0,3).map(function(p){return esc(pathOf(p.url));}).join(', ')+'), wasting its visits to your site.');
    var tests=S.urls.filter(function(u){return /(^|[\/\-_])(copy|test|testing|old|staging|draft|untitled|template|demo|sample)([\/\-_]|$|\d)/i.test(pathOf(u));});
    if(tests.length)issue('high',plural(tests.length,'page')+' look like test copies or old versions','Pages such as '+tests.slice(0,3).map(function(u){return esc(pathOf(u));}).join(', ')+' are published and listed for Google. They compete with your real pages and can show outdated claims.');
    var noCan=ok.filter(function(p){return !p.canonical;});
    if(noCan.length&&noCan.length===ok.length)issue('high','None of the checked pages set an official address','Across the site, tracking links and duplicate addresses can split ranking strength between copies of the same page.');
    var badH1=ok.filter(function(p){return p.h1!==1;});
    if(badH1.length)issue(badH1.length>=4?'medium':'low',plural(badH1.length,'other page')+' have a missing or split main heading','Each page needs one clear main heading so Google understands its topic.');
    var thin=ok.filter(function(p){return p.words&&p.words<300;});
    if(thin.length)issue(thin.length>=4?'medium':'low',plural(thin.length,'other page')+' have very little text','Thin pages rarely rank and can make the whole site look lower quality.');
    return I;
  }

  /* ---------- Google PageSpeed findings ---------- */
  var LH={
    'render-blocking-resources':['medium','Files hold up the page before it appears','Visitors stare at a blank screen while these download.'],
    'render-blocking-insight':['medium','Files hold up the page before it appears','Visitors stare at a blank screen while these download.'],
    'unused-javascript':['medium','The page downloads code it never uses','Every visitor pays for that extra download, especially on mobile data.'],
    'unused-css-rules':['low','The page downloads styling it never uses','Extra files slow down the first view of the page.'],
    'uses-optimized-images':['medium','Images are heavier than they need to be','Oversized images are the most common cause of slow pages on phones.'],
    'modern-image-formats':['medium','Images use old, heavy formats','Modern formats are much smaller and load faster.'],
    'uses-responsive-images':['medium','Phones download desktop-sized images','Visitors on phones download far more than their screen needs.'],
    'image-delivery-insight':['medium','Images are heavier than they need to be','Oversized images are the most common cause of slow pages on phones.'],
    'offscreen-images':['low','Images far down the page load too early','They compete with the content visitors see first.'],
    'lcp-lazy-loaded':['high','The main image is set to load late','Google measures how fast the main content appears, and this delays it.'],
    'prioritize-lcp-image':['medium','The main image isn\'t prioritized','The most important image waits behind less important files.'],
    'lcp-discovery-insight':['medium','The main image is found and loaded late','The most important image waits behind less important files.'],
    'duplicated-javascript':['high','The same code is downloaded more than once','Visitors download duplicate files on every page.'],
    'duplicated-javascript-insight':['high','The same code is downloaded more than once','Visitors download duplicate files on every page.'],
    'legacy-javascript':['low','Old-style code is sent to modern browsers','It adds weight that today\'s browsers don\'t need.'],
    'legacy-javascript-insight':['low','Old-style code is sent to modern browsers','It adds weight that today\'s browsers don\'t need.'],
    'server-response-time':['medium','The server is slow to respond','Nothing can load until the server answers.'],
    'document-latency-insight':['medium','The page itself is slow to arrive','Nothing can load until the main page arrives.'],
    'uses-text-compression':['medium','Files are not compressed','Uncompressed files take longer to download.'],
    'total-byte-weight':['medium','The page is very heavy to download','Large pages are slow on mobile connections and cost visitors data.'],
    'dom-size':['low','The page structure is very large','Large pages are slower for phones to process.'],
    'dom-size-insight':['low','The page structure is very large','Large pages are slower for phones to process.'],
    'font-display':['low','Text is hidden while fonts load','Visitors see blank space instead of words for a moment.'],
    'font-display-insight':['low','Text is hidden while fonts load','Visitors see blank space instead of words for a moment.'],
    'third-party-summary':['low','Outside services slow the page down','Chat widgets, trackers and embeds add delay you don\'t control.'],
    'third-parties-insight':['low','Outside services slow the page down','Chat widgets, trackers and embeds add delay you don\'t control.'],
    'mainthread-work-breakdown':['low','Phones have a lot of work to do to show the page','Pages feel sluggish on mid-range phones.'],
    'bootup-time':['low','Scripts take a long time to run','Pages feel sluggish on mid-range phones.'],
    'color-contrast':['medium','Some text is hard to read','Low contrast text is difficult to read, especially on phones outdoors.'],
    'link-name':['low','Some links have no readable name','Screen readers and Google can\'t tell where they lead.'],
    'button-name':['low','Some buttons have no readable name','Screen readers can\'t tell visitors what the button does.'],
    'image-alt':['medium','Images are missing descriptions','Google Images and screen readers can\'t understand them.'],
    'heading-order':['low','Heading levels are out of order','The page structure is harder to follow.'],
    'document-title':['critical','The page has no title','Google has no headline to show for the page.'],
    'meta-description':['high','There is no search result description','Google writes its own summary, which usually gets fewer clicks.'],
    'is-crawlable':['critical','This page is hidden from Google','Search engines are told not to list it.'],
    'http-status-code':['critical','The page returns an error','Google cannot list a broken page.'],
    'canonical':['high','The official address setting has a problem','Google may pick the wrong version of the page.'],
    'link-text':['low','Links use vague text like "click here"','Link text tells Google what the linked page is about.'],
    'crawlable-anchors':['medium','Some links can\'t be followed by Google','Pages linked this way may never be found.'],
    'robots-txt':['high','The robots.txt file has errors','It may block Google from parts of the site by mistake.'],
    'hreflang':['low','Language settings have errors','Google may show the wrong language version.']
  };
  var HTML_COVERS=['image-alt','document-title','meta-description','is-crawlable','http-status-code','canonical','link-text','heading-order','link-name','duplicated-javascript','duplicated-javascript-insight','lcp-lazy-loaded'];
  function psiIssues(j,haveHtml,htmlIssues){
    var a=j.lighthouseResult.audits,cats=j.lighthouseResult.categories,I=[],seen={};
    var ht=(htmlIssues||[]).map(function(x){return x.title;}).join(' | ');
    var SKIP_IF={'render-blocking-resources':'hold up the page','render-blocking-insight':'hold up the page','lcp-discovery-insight':'main image is set to load late','prioritize-lcp-image':'main image is set to load late','modern-image-formats':'old, heavy formats','server-response-time':'server is slow','document-latency-insight':'server is slow','uses-text-compression':'not compressed'};
    function n(k){return a[k]&&typeof a[k].numericValue==='number'?a[k].numericValue:null;}
    var p=cats.performance&&cats.performance.score;
    if(p!=null){if(p<.5)I.push({group:'Speed and Technical',sev:'high',title:'Slow on phones: Google speed score '+Math.round(p*100)+'/100',why:'Google rates under 50 as poor. Most visitors check a new site on their phone first, and many leave before it loads.'});
      else if(p<.9)I.push({group:'Speed and Technical',sev:'medium',title:'Google speed score on phones: '+Math.round(p*100)+'/100',why:'Google rates 90 and above as good. Slower pages lose visitors and rank lower.'});}
    var l=n('largest-contentful-paint');if(l!=null&&l>2500)I.push({group:'Speed and Technical',sev:l>4000?'high':'medium',title:'The main content takes '+(l/1000).toFixed(1)+' seconds to appear on phones',why:'Google\'s target is 2.5 seconds. Every extra second makes visitors more likely to leave.'});
    var f=n('first-contentful-paint');if(f!=null&&f>3000)I.push({group:'Speed and Technical',sev:'medium',title:'Visitors see a blank screen for '+(f/1000).toFixed(1)+' seconds',why:'Nothing at all appears for this long on a typical phone connection.'});
    var s=n('cumulative-layout-shift');if(s!=null&&s>.1)I.push({group:'Speed and Technical',sev:s>.25?'high':'medium',title:'The page jumps around while loading',why:'Content moves as it loads, so visitors tap the wrong thing. Google measures this.'});
    var b=n('total-blocking-time');if(b!=null&&b>200)I.push({group:'Speed and Technical',sev:b>600?'high':'medium',title:'The page freezes for '+Math.round(b)+' ms while loading',why:'Taps and clicks don\'t respond while heavy code runs.'});
    Object.keys(LH).forEach(function(id){
      var x=a[id];if(!x||x.score===null||x.score===undefined||x.score>=0.9)return;
      if(['notApplicable','manual','informative'].indexOf(x.scoreDisplayMode)>-1)return;
      if(haveHtml&&HTML_COVERS.indexOf(id)>-1)return;
      if(SKIP_IF[id]&&ht.indexOf(SKIP_IF[id])>-1)return;
      var m=LH[id],key=m[1];if(seen[key])return;seen[key]=1;
      var grp=['color-contrast','link-name','button-name','image-alt','heading-order'].indexOf(id)>-1?'Accessibility':(['document-title','meta-description'].indexOf(id)>-1?'Titles and Descriptions':(['is-crawlable','http-status-code','canonical','crawlable-anchors','robots-txt','hreflang'].indexOf(id)>-1?'Indexing and Crawling':'Speed and Technical'));
      I.push({group:grp,sev:m[0],title:m[1],why:m[2]});
    });
    return I;
  }

  /* ---------- scoring and rendering ---------- */
  var ST=null;
  function score(issues){var P=issues.reduce(function(s,i){return s+SEV[i.sev].p;},0);return Math.max(0,Math.min(100,Math.round(100/(1+P/60))));}
  function render(){
    var issues=ST.issues.concat(ST.site||[],ST.speed||[]);
    var sc=score(issues),col=sc>=85?'var(--ok)':sc>=60?'var(--warn)':'var(--bad)',grade=sc>=85?'Good':sc>=60?'Needs Work':'Poor';
    var cnt={critical:0,high:0,medium:0,low:0};issues.forEach(function(i){cnt[i.sev]++;});
    var C=2*Math.PI*54,off=C*(1-sc/100);
    var h='<div class="summary"><div class="ring"><svg viewBox="0 0 132 132" aria-hidden="true"><circle cx="66" cy="66" r="54" fill="none" stroke="#EEF0F3" stroke-width="12"/><circle cx="66" cy="66" r="54" fill="none" stroke="'+col+'" stroke-width="12" stroke-linecap="round" stroke-dasharray="'+C.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'"/></svg><div class="num" style="color:'+col+'"><span>'+sc+'<small>out of 100</small></span></div></div>';
    h+='<div class="sum-text"><h3>Basic SEO Check: '+grade+'</h3><p>'+esc(ST.url)+'</p><div class="counts">';
    ['critical','high','medium','low'].forEach(function(k){if(cnt[k])h+='<span class="sev-c '+k+'">'+cnt[k]+' '+SEV[k].label+'</span>';});
    if(!issues.length)h+='<span class="c-ok">No issues found in this basic check</span>';
    h+='</div></div></div>';
    var parts=[];
    parts.push(ST.siteDone?(ST.siteChecked?'checked this page plus '+ST.siteChecked+' other pages from your sitemap'+(ST.siteTotal?' (out of '+ST.siteTotal+')':''):'checked this page (the sitemap could not be read for a site-wide sample)'):'checked this page, and is now sampling other pages from your sitemap');
    parts.push(ST.speedDone?(ST.speedOk?'and included Google\'s speed test':'but Google\'s speed test was unavailable'):'while Google\'s speed test runs');
    h+='<p class="basic-note">This basic check '+parts.join(' ')+'. '+(ST.note?ST.note+' ':'')+'It can\'t see backlinks, rankings or competitors, which a full audit covers.</p>';
    if(!ST.speedDone||!ST.siteDone)h+='<p class="tool-note" style="display:flex;gap:10px;align-items:center"><span class="spinner" aria-hidden="true"></span>Still checking. The score will update automatically.</p>';
    GROUPS.forEach(function(g){
      var rows=issues.filter(function(i){return i.group===g;}).sort(function(a,b){return SEV[a.sev].o-SEV[b.sev].o;});
      if(!rows.length)return;
      h+='<div class="igroup"><h4>'+g+' <span>'+plural(rows.length,'issue')+'</span></h4>';
      rows.forEach(function(r){h+='<div class="issue"><span class="sev '+r.sev+'">'+SEV[r.sev].label+'</span><div><b>'+r.title+'</b><span>'+r.why+'</span></div></div>';});
      h+='</div>';
    });
    if(ST.passed&&ST.passed.length)h+='<details class="passed"><summary>'+plural(ST.passed.length,'check')+' passed</summary><ul>'+ST.passed.map(function(p){return'<li>'+esc(p)+'</li>';}).join('')+'</ul></details>';
    if(ST.headings&&ST.headings.length){h+='<div class="outline"><h4>How Google Sees Your Headings</h4><ol>';ST.headings.slice(0,50).forEach(function(x){h+='<li class="l'+x.l+'"><b>H'+x.l+'</b>'+esc(x.t.slice(0,110))+'</li>';});h+='</ol></div>';}
    if(ST.metrics)h+=ST.metrics;
    var total=issues.length;
    h+='<div class="tool-cta"><p>'+(total?'Every issue on this list can be fixed. I\'ll send you a step-by-step fix plan for this site, free.':'Looks solid. A full audit checks every page, backlinks and rankings.')+'</p><a class="btn btn-sun" href="/contact/?site='+encodeURIComponent(ST.url)+'">Get My Free Fix Plan</a></div>';
    out.innerHTML=h;out.style.display='block';
  }
  function metricsHtml(j){
    var a=j.lighthouseResult.audits,c=j.lighthouseResult.categories;
    function sc(v){if(v==null)return'<b>n/a</b>';var n=Math.round(v*100),col=n>=90?'var(--ok)':n>=50?'var(--warn)':'var(--bad)';return'<b style="color:'+col+'">'+n+'</b>';}
    function dv(k){return a[k]&&a[k].displayValue?esc(a[k].displayValue):'n/a';}
    return'<div class="speed"><h4>Google PageSpeed Results (Mobile)</h4><div class="speed-grid"><div>'+sc(c.performance&&c.performance.score)+'<span>Speed</span></div><div>'+sc(c.accessibility&&c.accessibility.score)+'<span>Accessibility</span></div><div>'+sc(c['best-practices']&&c['best-practices'].score)+'<span>Best practices</span></div><div><b>'+dv('largest-contentful-paint')+'</b><span>Main content appears</span></div><div><b>'+dv('cumulative-layout-shift')+'</b><span>Layout shift</span></div></div></div>';
  }
  function fail(msg){out.innerHTML='<div class="issue"><span class="sev critical">Error</span><div><b>We could not check that page</b><span>'+msg+'</span></div></div>';out.style.display='block';}

  form.addEventListener('submit',async function(e){
    e.preventDefault();
    var url=normalize(input.value);
    if(!url){input.setCustomValidity('Enter a full website address, like https://example.com');input.reportValidity();input.setCustomValidity('');return;}
    input.value=url;btn.disabled=true;btn.textContent='Checking...';
    if(empty)empty.style.display='none';out.style.display='none';setStatus('Reading the page...');
    var speedJob=psi(url).catch(function(){return null;});
    try{
      var page=await readPage(url,15000);
      if(page){
        var A=analyze(page,url);
        ST={url:url,issues:A.issues,passed:A.passed,headings:A.headings,site:[],speed:[],siteDone:false,speedDone:false};
        setStatus('Checking robots.txt and sitemap...');
        var rob=await readPage(A.info.origin+'/robots.txt',8000,true),rt=rob&&rob.body||'';
        var robotsOk=!!(rt&&(!rob.status||rob.status<400)&&/user-agent|sitemap|disallow|allow/i.test(rt)&&!/<html/i.test(rt));
        if(!robotsOk&&OWN_OK)ST.issues.push({group:'Indexing and Crawling',sev:'medium',title:'No robots.txt file',why:'Search engines look for this file first to learn how to crawl the site.'});else if(robotsOk)ST.passed.push('robots.txt found');
        setStatus('');render();out.scrollIntoView({behavior:'smooth',block:'start'});
        var siteJob=(OWN_OK?siteSample(A.info.origin,rt,page.finalUrl||url):Promise.resolve(null)).then(function(S){
          ST.siteDone=true;
          if(!S){if(OWN_OK)ST.site=[{group:'Indexing and Crawling',sev:'medium',title:'No readable XML sitemap',why:'Without a sitemap, Google may miss pages or take longer to find new ones.'}];}
          else{ST.passed.push('XML sitemap found ('+S.total+' pages listed)');ST.siteChecked=S.pages.length;ST.siteTotal=S.total;ST.site=siteIssues(S,A.info);}
          render();
        }).catch(function(){ST.siteDone=true;render();});
        var j=await speedJob;ST.speedDone=true;ST.speedOk=!!j;
        if(j){ST.speed=psiIssues(j,true,ST.issues);ST.metrics=metricsHtml(j);}
        render();await siteJob;
      }else{
        setStatus('This site blocks direct reading. Running Google\'s checks instead (up to a minute)...');
        var j2=await speedJob;setStatus('');
        if(!j2){fail('The site did not respond to us or to Google\'s test. Check the address is correct and the site is online, then try again.');return;}
        ST={url:url,issues:[],passed:[],headings:[],site:[],speed:psiIssues(j2,false),metrics:metricsHtml(j2),siteDone:true,speedDone:true,speedOk:true,
            note:'This site blocked our direct reader, so this report is based on Google\'s own checks.'};
        render();out.scrollIntoView({behavior:'smooth',block:'start'});
      }
    }finally{btn.disabled=false;btn.textContent='Check My Site';setStatus('');}
  });
  var pre=new URLSearchParams(location.search).get('check');if(pre){input.value=pre;}
})();
