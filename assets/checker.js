/* Free SEO Checker
   - Reads the page through this site's Netlify Function (public backups if unavailable)
   - Shows the key SEO tags found (meta title, meta description, canonical tag, H1, robots, schema...)
   - Samples up to 10 pages from the XML sitemap for site-wide problems
   - Adds Google PageSpeed (Core Web Vitals, technical and accessibility audits)
   - Rates issues by severity and explains why each matters, without fix instructions */
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
  var GROUPS=['Indexing and Crawling','Site-Wide (XML Sitemap Sample)','Meta Tags','Headings and Content','Images','Core Web Vitals and Speed','Accessibility'];

  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function normalize(v){v=(v||'').trim();if(!v)return null;if(!/^https?:\/\//i.test(v))v='https://'+v;try{var u=new URL(v);if(!u.hostname.includes('.'))return null;return u.href;}catch(e){return null;}}
  function timed(url,ms,opts){var c=new AbortController();var t=setTimeout(function(){c.abort();},ms);opts=opts||{};opts.signal=c.signal;return fetch(url,opts).finally(function(){clearTimeout(t);});}
  function setStatus(msg){status.style.display=msg?'flex':'none';if(msg)statusText.textContent=msg;}
  function plural(n,a,b){return n+' '+(n===1?a:(b||a+'s'));}
  function pathOf(u){try{var x=new URL(u);return x.pathname+(x.search||'');}catch(e){return u;}}
  function cut(s,n){s=String(s||'');return s.length>n?s.slice(0,n-1)+'\u2026':s;}

  /* robots.txt parser (RFC 9309): groups, specific agent beats *, longest match wins, Allow wins ties */
  function parseRobots(txt){
    var groups=[],cur=null,lastWasUA=false;
    String(txt||'').split(/\r?\n/).forEach(function(line){
      line=line.replace(/#.*/,'').trim();var m=line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);if(!m)return;
      var k=m[1].toLowerCase(),v=m[2].trim();
      if(k==='user-agent'){if(!cur||!lastWasUA){cur={agents:[],rules:[]};groups.push(cur);}cur.agents.push(v.toLowerCase());lastWasUA=true;}
      else if(k==='allow'||k==='disallow'){if(cur){cur.rules.push({allow:k==='allow',path:v});}lastWasUA=false;}
      else lastWasUA=false;
    });
    return groups;
  }
  function robotsCheck(groups,agent,path){
    agent=agent.toLowerCase();
    var named=groups.filter(function(g){return g.agents.indexOf(agent)>-1;}),specific=named.length>0;
    var use=specific?named:groups.filter(function(g){return g.agents.indexOf('*')>-1;});
    var rules=[];use.forEach(function(g){rules=rules.concat(g.rules);});
    var best=null;
    rules.forEach(function(r){if(!r.path)return;
      var end=/\$$/.test(r.path),pat=end?r.path.slice(0,-1):r.path;
      var re='^'+pat.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*')+(end?'$':'');
      var ok;try{ok=new RegExp(re).test(path);}catch(e){ok=false;}
      if(!ok)return;
      if(!best||r.path.length>best.path.length||(r.path.length===best.path.length&&r.allow&&!best.allow))best=r;});
    return{allowed:!best||best.allow,rule:best?(best.allow?'Allow: ':'Disallow: ')+best.path:'',specific:specific,group:use.length>0};
  }

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
    var doc=new DOMParser().parseFromString(page.body,'text/html'),u=new URL(page.finalUrl||url),I=[],P=[],T=[];
    function issue(g,sev,title,why){I.push({group:g,sev:sev,title:title,why:why});}
    function pass(t){P.push(t);}
    function tag(name,code,value,st){T.push({n:name,c:code,v:value,s:st});}
    var q=function(s){return doc.querySelector(s);},qa=function(s){return Array.prototype.slice.call(doc.querySelectorAll(s));};
    var isHome=u.pathname==='/'||u.pathname==='';

    /* HTTP status and HTTPS */
    var code=page.status||200;
    if(page.status&&page.status>=400)issue('Indexing and Crawling','critical','HTTP Status Code '+page.status+' (Error)','Google cannot index a page that returns an error status, and visitors see a broken page.');
    tag('HTTP Status Code','HTTP response',page.status?String(page.status)+(page.redirected?' (after a redirect)':''):'Not reported by the reader',page.status?(page.status<300?'good':page.status<400?'check':'miss'):'info');
    if(u.protocol!=='https:')issue('Indexing and Crawling','critical','No HTTPS (Insecure HTTP Connection)','Browsers show a "Not secure" warning on HTTP pages, and HTTPS is a confirmed Google ranking signal.');else pass('HTTPS');
    tag('HTTPS','SSL / TLS',u.protocol==='https:'?'Secure (https://)':'Not secure (http://)',u.protocol==='https:'?'good':'miss');

    /* Meta robots and X-Robots-Tag */
    var rb=q('meta[name="robots" i]'),rbc=rb?(rb.getAttribute('content')||''):'',xr=page.xRobotsTag||'',rv=rbc+' '+xr;
    if(/noindex/i.test(rv))issue('Indexing and Crawling','critical','Noindex Tag Found (Meta Robots'+(xr&&/noindex/i.test(xr)?' / X-Robots-Tag':'')+')','The page tells search engines not to index it, so it cannot appear in Google or in AI answers at all.');else pass('Indexable (no noindex)');
    if(/nofollow/i.test(rv))issue('Indexing and Crawling','medium','Nofollow in Meta Robots','The page asks search engines not to follow any of its links, so link value stops flowing to your other pages.');
    if(/nosnippet|max-snippet:\s*0/i.test(rv))issue('Indexing and Crawling','high','Nosnippet Directive Found','Google cannot show a text snippet for this page, and it is also excluded from AI Overviews and featured snippets.');
    tag('Meta Robots Tag','<meta name="robots">',rbc?esc(rbc):'Not set (defaults to index, follow)',/noindex/i.test(rbc)?'miss':(/nosnippet|nofollow/i.test(rbc)?'check':'good'));
    if(xr)tag('X-Robots-Tag Header','HTTP header',esc(xr),/noindex|nosnippet/i.test(xr)?'miss':'good');

    /* Canonical tag */
    var cans=qa('link[rel="canonical" i]'),canTxt='',canSt='good';
    if(!cans.length){canSt='miss';canTxt='Missing';issue('Indexing and Crawling','high','Missing Canonical Tag','Without a canonical tag, versions of the URL with tracking parameters or different paths can be treated as duplicates, splitting ranking signals between them.');}
    else if(cans.length>1){canSt='miss';canTxt=cans.length+' canonical tags found';issue('Indexing and Crawling','high','Multiple Canonical Tags ('+cans.length+')','Conflicting canonical tags are ignored by Google, which then picks the main URL on its own.');}
    else{var ch='';try{ch=new URL(cans[0].getAttribute('href')||'',u.href).href;}catch(e){}
      canTxt=ch?esc(ch):'Empty href';
      if(!ch){canSt='miss';issue('Indexing and Crawling','high','Empty Canonical Tag','The canonical tag has no usable URL, so Google ignores it.');}
      else if(ch.replace(/\/$/,'')!==u.href.replace(/[?#].*$/,'').replace(/\/$/,'')){canSt='check';canTxt+=' (points to a different URL)';issue('Indexing and Crawling','medium','Canonical Tag Points to a Different URL','The canonical tag tells Google another URL is the main version, so this page itself is unlikely to rank.');}
      else pass('Self-referencing canonical tag');}
    tag('Canonical Tag','<link rel="canonical">',canTxt,canSt);

    /* Viewport, lang, hreflang */
    var vp=q('meta[name="viewport" i]');
    if(!vp)issue('Indexing and Crawling','high','Missing Viewport Meta Tag','Without a viewport meta tag the page renders zoomed out on phones, and Google indexes the mobile version of every site (mobile-first indexing).');else pass('Viewport meta tag');
    tag('Viewport Meta Tag','<meta name="viewport">',vp?esc(vp.getAttribute('content')||''):'Missing',vp?'good':'miss');
    var lang=doc.documentElement.getAttribute('lang');
    if(!lang)issue('Indexing and Crawling','low','Missing HTML Lang Attribute','Search engines and screen readers have to guess the language of the page.');else pass('HTML lang attribute');
    tag('HTML Lang Attribute','<html lang>',lang?esc(lang):'Missing',lang?'good':'check');
    var hl=qa('link[rel="alternate" i][hreflang]');
    if(hl.length)tag('Hreflang Tags','<link hreflang>',hl.length+' found ('+esc(hl.slice(0,4).map(function(x){return x.getAttribute('hreflang');}).join(', '))+(hl.length>4?', ...':'')+')','good');
    if(page.redirected||(page.finalUrl&&page.finalUrl.replace(/\/$/,'')!==url.replace(/\/$/,'')))issue('Indexing and Crawling','low','URL Redirects (301 / 302)','The URL you entered redirects to '+esc(cut(page.finalUrl||'',80))+'. Each redirect adds delay before the page starts loading.');

    /* Structured data */
    var types=[],ldErr=0,ldN=0;
    qa('script[type="application/ld+json"]').forEach(function(s){ldN++;try{(function walk(o){if(Array.isArray(o))return o.forEach(walk);if(o&&typeof o==='object'){if(o['@type'])types=types.concat(o['@type']);if(o['@graph'])walk(o['@graph']);}})(JSON.parse(s.textContent));}catch(e){ldErr++;}});
    types=types.filter(function(t,i,a){return a.indexOf(t)===i;});
    var micro=qa('[itemtype]').length;
    if(ldErr)issue('Indexing and Crawling','high','Invalid JSON-LD Schema ('+plural(ldErr,'block')+' with errors)','Google ignores structured data that fails to parse, so the facts it was meant to share are lost.');
    if(!types.length&&!micro)issue('Indexing and Crawling','high','Missing Schema Markup (Structured Data)','Without schema markup, Google and AI assistants have to guess who you are, what you offer and where you work, and rich results are not possible.');
    else{if(types.length)pass('Schema markup ('+types.slice(0,4).join(', ')+')');
      if(isHome&&types.length&&!types.some(function(t){return /Organization|LocalBusiness|Corporation|ProfessionalService|Person|WebSite|Store|Restaurant/.test(t);}))issue('Indexing and Crawling','medium','No Organization or LocalBusiness Schema','The homepage does not describe the business (name, logo, address, profiles) in schema, which Google and AI assistants rely on to identify you.');}
    tag('Schema Markup','JSON-LD / Microdata',types.length?esc(types.slice(0,8).join(', '))+(types.length>8?', ...':''):(micro?micro+' microdata items':'None found'),ldErr?'miss':(types.length||micro?'good':'miss'));

    /* Meta title and meta description */
    var title=(q('title')&&q('title').textContent||'').replace(/\s+/g,' ').trim();
    var tSt='good';
    if(!title){tSt='miss';issue('Meta Tags','critical','Missing Meta Title (Title Tag)','Google has no title to show for this page in search results, and the title tag is one of the strongest on-page ranking signals.');}
    else if(title.length>60){tSt='check';issue('Meta Tags','medium','Meta Title Too Long ('+title.length+' Characters)','Google shows roughly the first 60 characters (about 580 pixels), so searchers see a clipped title: "'+esc(cut(title,64))+'"');}
    else if(title.length<30){tSt='check';issue('Meta Tags','medium','Meta Title Too Short ('+title.length+' Characters)','"'+esc(title)+'" uses little of the space Google gives you to earn the click and to describe the page.');}
    else pass('Meta title length ('+title.length+' characters)');
    if(qa('title').length>1)issue('Meta Tags','medium','Multiple Title Tags ('+qa('title').length+')','The page has more than one title tag, so Google may pick the wrong one.');
    tag('Meta Title','<title>',title?'<em>'+esc(title)+'</em> ('+title.length+' characters)':'Missing',tSt);
    var md=q('meta[name="description" i]'),desc=md?(md.getAttribute('content')||'').replace(/\s+/g,' ').trim():'',dSt='good';
    if(!desc){dSt='miss';issue('Meta Tags','high','Missing Meta Description','Google writes its own snippet from random page text, which usually earns fewer clicks than a written meta description.');}
    else if(desc.length>160){dSt='check';issue('Meta Tags','medium','Meta Description Too Long ('+desc.length+' Characters)','Google shows about 155 to 160 characters, so the end of your message is cut off in search results.');}
    else if(desc.length<70){dSt='check';issue('Meta Tags','medium','Meta Description Too Short ('+desc.length+' Characters)','A short meta description gives searchers little reason to choose your result over the others.');}
    else pass('Meta description length ('+desc.length+' characters)');
    if(desc&&title&&desc.toLowerCase()===title.toLowerCase())issue('Meta Tags','low','Meta Description Duplicates the Meta Title','Searchers get no extra information in the snippet, so there is less reason to click.');
    tag('Meta Description','<meta name="description">',desc?'<em>'+esc(desc)+'</em> ('+desc.length+' characters)':'Missing',dSt);
    var ogt=q('meta[property="og:title"]'),ogd=q('meta[property="og:description"]'),ogi=q('meta[property="og:image"]');
    if(!(ogt&&ogd))issue('Meta Tags','low','Missing Open Graph Tags (og:title, og:description)','When the page is shared on LinkedIn, Facebook or WhatsApp, the preview text is missing or pulled at random.');else pass('Open Graph title and description');
    if(!ogi)issue('Meta Tags','low','Missing Open Graph Image (og:image)','Shared links show no preview image, and posts without an image get far less attention.');else pass('Open Graph image');
    var ogc=[ogt?'og:title':'',ogd?'og:description':'',ogi?'og:image':''].filter(Boolean);
    tag('Open Graph Tags','og:title, og:description, og:image',ogc.length?ogc.join(', '):'None found',ogc.length===3?'good':(ogc.length?'check':'miss'));
    var tw=q('meta[name="twitter:card" i]');
    tag('Twitter Card','<meta name="twitter:card">',tw?esc(tw.getAttribute('content')||'set'):'Not set',tw?'good':'info');
    var fav=q('link[rel~="icon" i]')||q('link[rel="shortcut icon" i]')||q('link[rel="apple-touch-icon" i]');
    if(!fav)issue('Meta Tags','low','Missing Favicon','Google shows the favicon next to your result in mobile search; without one the result looks generic.');else pass('Favicon');
    tag('Favicon','<link rel="icon">',fav?'Found':'Missing',fav?'good':'check');

    /* Headings and content */
    var hs=qa('h1,h2,h3,h4,h5,h6').map(function(h){return{l:+h.tagName[1],t:(h.textContent||'').replace(/\s+/g,' ').trim()};}).filter(function(h){return h.t;});
    var h1=hs.filter(function(h){return h.l===1;}),h1txt=h1.map(function(h){return h.t.toLowerCase();});
    var h1dup=h1txt.length-h1txt.filter(function(t,i,a){return a.indexOf(t)===i;}).length,h1St='good';
    if(!h1.length){h1St='miss';issue('Headings and Content','high','Missing H1 Tag','The H1 is the main heading and one of the clearest signals of what a page is about. Without one, Google has to guess the topic.');}
    else if(h1.length>3||h1dup){h1St='miss';issue('Headings and Content','high','Multiple H1 Tags ('+h1.length+')','Google sees '+h1.length+' separate H1 headings ('+esc(h1.slice(0,4).map(function(h){return'"'+cut(h.t,30)+'"';}).join(', '))+(h1.length>4?', ...':'')+') instead of one clear statement of the page topic.');}
    else if(h1.length>1){h1St='check';issue('Headings and Content','medium','Multiple H1 Tags ('+h1.length+')','With more than one H1, the main topic of the page is less clear to Google.');}
    else{pass('One H1 tag');if(h1[0].t.length>70){h1St='check';issue('Headings and Content','low','H1 Tag Too Long ('+h1[0].t.length+' Characters)','Long H1 headings are harder for visitors to scan and for Google to read as one clear topic.');}
      if(title&&h1[0].t.toLowerCase()===title.toLowerCase())pass('H1 matches the topic of the meta title');}
    tag('H1 Tag','<h1>',h1.length?(h1.length>1?h1.length+' found: ':'')+'<em>'+esc(cut(h1[0].t,120))+'</em>':'Missing',h1St);
    var h2n=hs.filter(function(h){return h.l===2;}).length,h3n=hs.filter(function(h){return h.l===3;}).length;
    if(h2n<2)issue('Headings and Content','medium','Few H2 Subheadings ('+h2n+')','Search engines and AI tools use H2 subheadings to understand, and quote, what each part of a page covers.');else pass(h2n+' H2 subheadings');
    tag('H2 and H3 Subheadings','<h2>, <h3>',h2n+' H2, '+h3n+' H3',h2n>=2?'good':'check');
    var skips=0;for(var i=1;i<hs.length;i++){if(hs[i].l-hs[i-1].l>1)skips++;}
    if(skips)issue('Headings and Content','low','Skipped Heading Levels (Heading Hierarchy)','The page jumps heading levels '+plural(skips,'time')+' (for example H2 straight to H4), which makes the structure harder for Google and screen readers to follow.');
    var body=doc.body?doc.body.cloneNode(true):null,words=0,text='';
    if(body){body.querySelectorAll('script,style,noscript,svg,template,nav,footer,header').forEach(function(n){n.remove();});text=(body.textContent||'').replace(/\s+/g,' ').trim();words=text?text.split(' ').length:0;}
    if(words<300)issue('Headings and Content','high','Thin Content ('+plural(words,'Word')+')','Pages with very little text rarely rank for anything beyond the brand name, and AI tools have nothing to quote.');
    else if(words<500)issue('Headings and Content','low','Light Content ('+plural(words,'Word')+')','Pages that rank for competitive searches usually cover the topic in more depth.');
    else pass('Word count ('+plural(words,'word')+')');
    tag('Word Count','Main content',plural(words,'word'),words>=500?'good':(words>=300?'check':'miss'));
    var raw=page.body;
    var PH=[['Lorem ipsum','lorem ipsum'],['This is some text inside of a div block','inside of a div block'],['Your browser does not support the video tag','does not support the video tag'],['Heading text placeholder','heading placeholder'],['Add your text here','add your text here']];
    var found=PH.filter(function(p){return raw.toLowerCase().indexOf(p[1])>-1;});
    if(found.length)issue('Headings and Content','high','Placeholder Text Published ("'+esc(found[0][0])+'")','Default template text is still in the page code. Google and AI tools read it as part of your content, and visitors see an unfinished page.');
    var vague=0,emptyA=0,internal=0,external=0,nofol=0,VAGUE=['click here','here','read more','learn more','more','this','link','click'];
    qa('a[href]').forEach(function(a){var t=(a.textContent||'').replace(/\s+/g,' ').trim().toLowerCase();if(VAGUE.indexOf(t)>-1)vague++;if(!t&&!a.getAttribute('aria-label')&&!a.getAttribute('title')&&!a.querySelector('img[alt]:not([alt=""])'))emptyA++;
      var h=a.getAttribute('href')||'';if(/^(#|mailto:|tel:|javascript:)/i.test(h))return;try{if(new URL(h,u.href).hostname===u.hostname){internal++;if(/nofollow/i.test(a.getAttribute('rel')||''))nofol++;}else external++;}catch(e){}});
    if(vague)issue('Headings and Content','low','Non-Descriptive Anchor Text ('+plural(vague,'link')+')','Anchor text like "read more" or "click here" tells Google nothing about the linked page.');
    if(emptyA)issue('Accessibility','low','Links Without Anchor Text ('+emptyA+')','Screen readers announce these as just "link", and Google cannot tell where they lead.');
    if(internal<3)issue('Headings and Content','medium','Few Internal Links ('+internal+')','Internal links help Google discover, understand and rank your other pages.');else pass(internal+' internal links');
    if(nofol)issue('Headings and Content','low','Nofollow on Internal Links ('+nofol+')','Internal links marked nofollow stop link value from reaching your own pages.');
    tag('Internal and External Links','<a href>',internal+' internal, '+external+' external',internal>=3?'good':'check');

    /* Images */
    var imgs=qa('img'),noalt=imgs.filter(function(i){return !i.hasAttribute('alt');}).length;
    tag('Image Alt Text','<img alt>',imgs.length?(imgs.length-noalt)+' of '+imgs.length+' images have alt text':'No images on the page',!imgs.length?'info':(noalt?(noalt/imgs.length>.25?'miss':'check'):'good'));
    if(imgs.length){
      if(noalt)issue('Images',noalt/imgs.length>.25?'high':'medium','Missing Image Alt Text ('+noalt+' of '+imgs.length+')','Images without alt text are invisible to Google Images and to visitors using screen readers.');else pass('All images have alt text');
      var raster=imgs.filter(function(i){var s=(i.getAttribute('src')||i.getAttribute('data-src')||'').toLowerCase().split('?')[0];return s&&!/\.svg$/.test(s)&&!/^data:/.test(s);});
      if(raster.length){
        var nosize=raster.filter(function(i){return !(i.getAttribute('width')&&i.getAttribute('height'));}).length;
        if(nosize/raster.length>.2)issue('Images','medium','Missing Image Width and Height ('+nosize+' of '+raster.length+')','Images without set dimensions make the page jump while loading, which raises Cumulative Layout Shift (CLS), one of Google\'s Core Web Vitals.');else pass('Image width and height set');
        var modern=raster.filter(function(i){var s=(i.getAttribute('src')||i.getAttribute('data-src')||'').toLowerCase();return /\.(webp|avif)(\?|$)/.test(s)||(i.parentElement&&i.parentElement.tagName==='PICTURE'&&i.parentElement.querySelector('source[type*="webp"],source[type*="avif"]'))||/format=(webp|avif)|fm=(webp|avif)|auto=format|auto=compress/.test(s);}).length;
        if(modern/raster.length<.5)issue('Images','medium','Images Not in WebP or AVIF Format','Only '+modern+' of '+raster.length+' images use next-gen formats. Heavy JPEG and PNG files are the most common cause of slow pages on phones.');else pass('Next-gen image formats');
        var first=raster[0];
        if(first&&first.getAttribute('loading')==='lazy')issue('Images','high','LCP Image Is Lazy-Loaded','The first image on the page is set to loading="lazy", which delays Largest Contentful Paint (LCP), a Core Web Vital.');
        if(raster.length>4&&!raster.some(function(i){return i.getAttribute('loading')==='lazy';}))issue('Images','low','No Lazy Loading on Below-the-Fold Images','Images far down the page download before visitors need them, slowing the first view.');
      }
    }

    /* Scripts and technical */
    var headScripts=qa('head script[src]').filter(function(s){return !s.hasAttribute('async')&&!s.hasAttribute('defer')&&(s.getAttribute('type')||'')!=='module';});
    if(headScripts.length>=2)issue('Core Web Vitals and Speed','medium','Render-Blocking Scripts ('+headScripts.length+')','These scripts in the head load without async or defer, so visitors see a blank screen while they download.');
    var libs={};qa('script[src]').forEach(function(s){var src=(s.getAttribute('src')||'').split('?')[0].toLowerCase();var name=src.split('/').pop().replace(/\.min\.js$|\.js$/,'');var pkg=(src.match(/npm\/(@?[^@\/]+(?:\/[^@\/]+)?)@/)||[])[1];var key=pkg||name;if(!key||key.length<3)return;libs[key]=(libs[key]||0)+1;});
    var dups=Object.keys(libs).filter(function(k){return libs[k]>1;});
    if(dups.length)issue('Core Web Vitals and Speed','high','Duplicate JavaScript ("'+esc(dups[0])+'" Loaded '+libs[dups[0]]+' Times)','Every visitor downloads the same code more than once.');
    if(page.bytes&&page.bytes>500000)issue('Core Web Vitals and Speed','medium','Large HTML Size ('+Math.round(page.bytes/1024)+' KB)','Very large HTML documents load slowly and may not be fully processed by search engines.');
    if(page.headers){
      var H=page.headers;
      if(page.ms>800)issue('Core Web Vitals and Speed',page.ms>1800?'high':'medium','Slow Server Response Time (TTFB '+(page.ms/1000).toFixed(1)+' s)','Time to First Byte is how long the server takes to answer. Nothing can appear until it does.');else pass('Fast server response (TTFB)');
      tag('Server Response (TTFB)','Time to First Byte',(page.ms/1000).toFixed(2)+' s',page.ms>1800?'miss':(page.ms>800?'check':'good'));
      if(!H['content-encoding']&&page.bytes>20000)issue('Core Web Vitals and Speed','medium','No GZIP or Brotli Compression','Uncompressed HTML takes longer to download, especially on mobile data.');
      var sec=['x-frame-options','x-content-type-options','referrer-policy','content-security-policy','permissions-policy'].filter(function(k){return !H[k];});
      if(sec.length>=3)issue('Core Web Vitals and Speed','low','Missing Security Headers ('+sec.length+' of 5)','Headers like Content-Security-Policy and X-Frame-Options protect visitors from common attacks, and security-minded buyers check them.');
    }
    return{issues:I,passed:P,tags:T,headings:hs,info:{title:title,desc:desc,origin:u.origin,home:isHome}};
  }

  /* ---------- site-wide sample from the XML sitemap ---------- */
  function summary(html){
    var d=new DOMParser().parseFromString(html,'text/html');
    var rb=d.querySelector('meta[name="robots" i]');var b=d.body?d.body.cloneNode(true):null,w=0;
    if(b){b.querySelectorAll('script,style,noscript,svg,template,nav,footer,header').forEach(function(n){n.remove();});var t=(b.textContent||'').replace(/\s+/g,' ').trim();w=t?t.split(' ').length:0;}
    return{title:((d.querySelector('title')||{}).textContent||'').trim(),desc:((d.querySelector('meta[name="description" i]')||{getAttribute:function(){return'';}}).getAttribute('content')||'').trim(),
      noindex:/noindex/i.test(rb?rb.getAttribute('content')||'':''),canonical:!!d.querySelector('link[rel="canonical" i]'),h1:d.querySelectorAll('h1').length,words:w};
  }
  function locs(xml){return(xml.match(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)||[]).map(function(m){return m.replace(/<\/?loc>/gi,'').trim().replace(/&amp;/g,'&');});}
  async function siteSample(origin,robotsTxt,current){
    var smUrl=(robotsTxt&&(robotsTxt.match(/^\s*sitemap:\s*(\S+)/im)||[])[1])||origin+'/sitemap.xml';
    var sm=await readPage(smUrl,9000,true);if(!sm||!sm.body||!/<(urlset|sitemapindex)/i.test(sm.body))return null;
    var list=locs(sm.body);
    if(/<sitemapindex/i.test(sm.body)){var all=[];for(var i=0;i<Math.min(list.length,3);i++){var c=await readPage(list[i],9000,true);if(c&&c.body)all=all.concat(locs(c.body));}list=all;}
    var total=list.length,cur=current.replace(/\/$/,'');
    list=list.filter(function(x){return x.replace(/\/$/,'')!==cur;});
    var pick=[];var step=Math.max(1,Math.floor(list.length/SAMPLE_PAGES));for(var k=0;k<list.length&&pick.length<SAMPLE_PAGES;k+=step)pick.push(list[k]);
    var res=[],idx=0;
    async function worker(){while(idx<pick.length){var u=pick[idx++];var p=await readPage(u,9000,true);if(!p){res.push({url:u,fail:true});continue;}
      var s=p.body?summary(p.body):{};s.url=u;s.status=p.status;s.redirected=p.redirected;res.push(s);}}
    await Promise.all([worker(),worker(),worker()]);
    return{total:total,pages:res,urls:list,url:smUrl};
  }
  function siteIssues(S,main){
    var I=[],G='Site-Wide (XML Sitemap Sample)';if(!S)return I;
    function issue(sev,title,why){I.push({group:G,sev:sev,title:title,why:why});}
    var ok=S.pages.filter(function(p){return !p.fail&&(!p.status||p.status<400);});
    var all=ok.concat([{url:'(this page)',title:main.title,desc:main.desc}]);
    function dupGroups(key){var m={};all.forEach(function(p){var v=(p[key]||'').toLowerCase();if(v)(m[v]=m[v]||[]).push(p.url);});return Object.keys(m).map(function(k){return m[k];}).filter(function(g){return g.length>1;});}
    var dt=dupGroups('title'),n=dt.reduce(function(a,g){return a+g.length;},0);
    if(n)issue(n>=4?'high':'medium','Duplicate Meta Titles ('+n+' of '+all.length+' Pages)','In search results these pages look identical, so searchers cannot tell them apart and Google struggles to choose which one should rank.');
    var dd=dupGroups('desc'),m=dd.reduce(function(a,g){return a+g.length;},0);
    if(m)issue(m>=4?'high':'medium','Duplicate Meta Descriptions ('+m+' of '+all.length+' Pages)','Identical snippets make every page look the same in search results and reduce clicks.');
    var hidden=ok.filter(function(p){return p.noindex;});
    if(hidden.length)issue('high','Noindex Pages in XML Sitemap ('+hidden.length+')','The sitemap asks Google to crawl '+(hidden.length===1?'a page':'pages')+' that also '+(hidden.length===1?'carries':'carry')+' a noindex tag ('+hidden.slice(0,3).map(function(p){return esc(pathOf(p.url));}).join(', ')+'). These mixed signals waste crawl budget and can hide important pages.');
    var broken=S.pages.filter(function(p){return p.status>=400||p.redirected;});
    if(broken.length)issue('high','Broken or Redirected URLs in XML Sitemap ('+broken.length+')','Google is sent to URLs that fail or redirect ('+broken.slice(0,3).map(function(p){return esc(pathOf(p.url));}).join(', ')+'), wasting crawl budget on your site.');
    var tests=S.urls.filter(function(u){return /(^|[\/\-_])(copy|test|testing|old|staging|draft|untitled|template|demo|sample)([\/\-_]|$|\d)/i.test(pathOf(u));});
    if(tests.length)issue('high','Test or Duplicate Pages Indexed ('+tests.length+')','URLs such as '+tests.slice(0,3).map(function(u){return esc(pathOf(u));}).join(', ')+' are listed for Google. They compete with your real pages and can show outdated content.');
    var noCan=ok.filter(function(p){return !p.canonical;});
    if(noCan.length&&noCan.length===ok.length)issue('high','Missing Canonical Tags Site-Wide','None of the sampled pages has a canonical tag, so duplicate URLs can split ranking signals across the site.');
    var badH1=ok.filter(function(p){return p.h1!==1;});
    if(badH1.length)issue(badH1.length>=4?'medium':'low','Missing or Multiple H1 Tags on '+plural(badH1.length,'Other Page'),'Each page needs exactly one H1 so Google understands its main topic.');
    var thin=ok.filter(function(p){return p.words&&p.words<300;});
    if(thin.length)issue(thin.length>=4?'medium':'low','Thin Content on '+plural(thin.length,'Other Page'),'Pages with very little text rarely rank and can make the whole site look lower quality.');
    return I;
  }

  /* ---------- Google PageSpeed (Lighthouse) findings ---------- */
  var LH={
    'render-blocking-resources':['medium','Render-Blocking Resources','CSS or JavaScript files hold up the first paint, so visitors stare at a blank screen.'],
    'render-blocking-insight':['medium','Render-Blocking Resources','CSS or JavaScript files hold up the first paint, so visitors stare at a blank screen.'],
    'unused-javascript':['medium','Unused JavaScript','The page downloads code it never runs, which every visitor pays for on mobile data.'],
    'unused-css-rules':['low','Unused CSS','The page downloads styling it never uses, which slows the first view.'],
    'uses-optimized-images':['medium','Unoptimized Images','Images are heavier than they need to be, the most common cause of slow pages on phones.'],
    'modern-image-formats':['medium','Images Not in Next-Gen Formats (WebP or AVIF)','Next-gen formats are much smaller than JPEG and PNG and load faster.'],
    'uses-responsive-images':['medium','Oversized Images (Not Responsive)','Phones download desktop-sized images, far more data than their screens need.'],
    'image-delivery-insight':['medium','Unoptimized Image Delivery','Images are heavier than they need to be, the most common cause of slow pages on phones.'],
    'offscreen-images':['low','Offscreen Images Not Lazy-Loaded','Images far down the page compete with the content visitors see first.'],
    'lcp-lazy-loaded':['high','LCP Image Is Lazy-Loaded','The Largest Contentful Paint image waits to load, which directly delays a Core Web Vital.'],
    'prioritize-lcp-image':['medium','LCP Image Not Prioritized','The most important image waits behind less important files.'],
    'lcp-discovery-insight':['medium','LCP Image Discovered Late','The Largest Contentful Paint image is found and loaded late in the page load.'],
    'duplicated-javascript':['high','Duplicate JavaScript','The same code is downloaded more than once by every visitor.'],
    'duplicated-javascript-insight':['high','Duplicate JavaScript','The same code is downloaded more than once by every visitor.'],
    'legacy-javascript':['low','Legacy JavaScript','Old-style code is sent to modern browsers, adding weight they do not need.'],
    'legacy-javascript-insight':['low','Legacy JavaScript','Old-style code is sent to modern browsers, adding weight they do not need.'],
    'server-response-time':['medium','Slow Server Response Time (TTFB)','Nothing can load until the server answers the first request.'],
    'document-latency-insight':['medium','Slow Document Request (TTFB)','Nothing can load until the main HTML document arrives.'],
    'uses-text-compression':['medium','No Text Compression (GZIP or Brotli)','Uncompressed files take longer to download.'],
    'total-byte-weight':['medium','Large Page Weight','Heavy pages are slow on mobile connections and cost visitors data.'],
    'dom-size':['low','Excessive DOM Size','A very large page structure is slower for phones to process.'],
    'dom-size-insight':['low','Excessive DOM Size','A very large page structure is slower for phones to process.'],
    'font-display':['low','Font Display Not Set (Invisible Text While Loading)','Visitors see blank space instead of words while web fonts load.'],
    'font-display-insight':['low','Font Display Not Set (Invisible Text While Loading)','Visitors see blank space instead of words while web fonts load.'],
    'third-party-summary':['low','Heavy Third-Party Code','Chat widgets, trackers and embeds add delay you do not control.'],
    'third-parties-insight':['low','Heavy Third-Party Code','Chat widgets, trackers and embeds add delay you do not control.'],
    'mainthread-work-breakdown':['low','High Main-Thread Work','Phones have a lot of processing to do before the page responds.'],
    'bootup-time':['low','Long JavaScript Execution Time','Scripts take a long time to run, so pages feel sluggish on mid-range phones.'],
    'color-contrast':['medium','Low Color Contrast','Low-contrast text is hard to read, especially on phones outdoors.'],
    'link-name':['low','Links Without Accessible Names','Screen readers and Google cannot tell where these links lead.'],
    'button-name':['low','Buttons Without Accessible Names','Screen readers cannot tell visitors what these buttons do.'],
    'image-alt':['medium','Missing Image Alt Text','Google Images and screen readers cannot understand these images.'],
    'heading-order':['low','Skipped Heading Levels (Heading Hierarchy)','The page structure is harder to follow.'],
    'document-title':['critical','Missing Meta Title (Title Tag)','Google has no title to show for the page.'],
    'meta-description':['high','Missing Meta Description','Google writes its own snippet, which usually earns fewer clicks.'],
    'is-crawlable':['critical','Page Blocked From Indexing (Noindex or robots.txt)','Search engines are told not to index this page.'],
    'http-status-code':['critical','HTTP Error Status Code','Google cannot index a page that returns an error.'],
    'canonical':['high','Invalid Canonical Tag','Google may pick the wrong version of the page.'],
    'link-text':['low','Non-Descriptive Anchor Text','Anchor text like "click here" tells Google nothing about the linked page.'],
    'crawlable-anchors':['medium','Uncrawlable Links','Some links cannot be followed by Googlebot, so linked pages may never be found.'],
    'robots-txt':['high','Invalid robots.txt','Errors in robots.txt can block Google from parts of the site by mistake.'],
    'hreflang':['low','Invalid Hreflang Tags','Google may show the wrong language version of the page.']
  };
  var HTML_COVERS=['image-alt','document-title','meta-description','is-crawlable','http-status-code','canonical','link-text','heading-order','link-name','duplicated-javascript','duplicated-javascript-insight','lcp-lazy-loaded'];
  function psiIssues(j,haveHtml,htmlIssues){
    var a=j.lighthouseResult.audits,cats=j.lighthouseResult.categories,I=[],seen={};
    var ht=(htmlIssues||[]).map(function(x){return x.title;}).join(' | ');
    var SKIP_IF={'render-blocking-resources':'Render-Blocking','render-blocking-insight':'Render-Blocking','lcp-discovery-insight':'LCP Image Is Lazy','prioritize-lcp-image':'LCP Image Is Lazy','modern-image-formats':'WebP or AVIF','server-response-time':'TTFB','document-latency-insight':'TTFB','uses-text-compression':'Compression'};
    function n(k){return a[k]&&typeof a[k].numericValue==='number'?a[k].numericValue:null;}
    var G='Core Web Vitals and Speed',p=cats.performance&&cats.performance.score;
    if(p!=null){if(p<.5)I.push({group:G,sev:'high',title:'Low PageSpeed Performance Score ('+Math.round(p*100)+'/100 on Mobile)',why:'Google rates under 50 as poor. Most visitors check a new business on their phone first, and many leave before a slow page loads.'});
      else if(p<.9)I.push({group:G,sev:'medium',title:'PageSpeed Performance Score '+Math.round(p*100)+'/100 on Mobile',why:'Google rates 90 and above as good. Slower pages lose visitors and can rank lower.'});}
    var l=n('largest-contentful-paint');if(l!=null&&l>2500)I.push({group:G,sev:l>4000?'high':'medium',title:'Slow Largest Contentful Paint (LCP '+(l/1000).toFixed(1)+' s)',why:'LCP measures when the main content appears. Google\'s "good" threshold is 2.5 seconds, and every extra second makes visitors more likely to leave.'});
    var f=n('first-contentful-paint');if(f!=null&&f>3000)I.push({group:G,sev:'medium',title:'Slow First Contentful Paint (FCP '+(f/1000).toFixed(1)+' s)',why:'Nothing at all appears on screen for this long on a typical phone connection.'});
    var s=n('cumulative-layout-shift');if(s!=null&&s>.1)I.push({group:G,sev:s>.25?'high':'medium',title:'High Cumulative Layout Shift (CLS '+s.toFixed(2)+')',why:'Content moves while the page loads, so visitors tap the wrong thing. Google\'s "good" threshold is 0.1.'});
    var b=n('total-blocking-time');if(b!=null&&b>200)I.push({group:G,sev:b>600?'high':'medium',title:'High Total Blocking Time (TBT '+Math.round(b)+' ms)',why:'Taps and clicks do not respond while heavy code runs. TBT is the lab measure closest to Interaction to Next Paint (INP), a Core Web Vital.'});
    Object.keys(LH).forEach(function(id){
      var x=a[id];if(!x||x.score===null||x.score===undefined||x.score>=0.9)return;
      if(['notApplicable','manual','informative'].indexOf(x.scoreDisplayMode)>-1)return;
      if(haveHtml&&HTML_COVERS.indexOf(id)>-1)return;
      if(SKIP_IF[id]&&ht.indexOf(SKIP_IF[id])>-1)return;
      var m=LH[id],key=m[1];if(seen[key])return;seen[key]=1;
      var grp=['color-contrast','link-name','button-name','image-alt','heading-order'].indexOf(id)>-1?'Accessibility':(['document-title','meta-description'].indexOf(id)>-1?'Meta Tags':(['is-crawlable','http-status-code','canonical','crawlable-anchors','robots-txt','hreflang'].indexOf(id)>-1?'Indexing and Crawling':G));
      I.push({group:grp,sev:m[0],title:m[1],why:m[2]});
    });
    return I;
  }

  /* ---------- scoring and rendering ---------- */
  var ST=null;
  var STL={good:'Good',check:'Check',miss:'Missing',info:'Info'};
  function score(issues){var P=issues.reduce(function(s,i){return s+SEV[i.sev].p;},0);return Math.max(0,Math.min(100,Math.round(100/(1+P/60))));}
  function tagsHtml(){
    var rows=(ST.tags||[]).concat(ST.extraTags||[]);if(!rows.length)return'';
    var h='<div class="tags"><h4>Key SEO Tags Found on This Page</h4>';
    rows.forEach(function(t){var plain=String(t.v).replace(/<[^>]+>/g,'');var lab=t.s==='miss'?(/^(Missing|None|Empty)/i.test(plain)?'Missing':'Problem'):STL[t.s];
      h+='<div class="tagrow"><div class="tn">'+t.n+'<small>'+esc(t.c)+'</small></div><div class="tv">'+t.v+'</div><span class="st '+t.s+'">'+lab+'</span></div>';});
    return h+'</div>';
  }
  function render(){
    var issues=ST.issues.concat(ST.site||[],ST.speed||[]);
    var sc=score(issues),col=sc>=85?'var(--ok)':sc>=60?'var(--warn)':'var(--bad)',grade=sc>=85?'Good':sc>=60?'Needs Work':'Poor';
    var cnt={critical:0,high:0,medium:0,low:0};issues.forEach(function(i){cnt[i.sev]++;});
    var C=2*Math.PI*54,off=C*(1-sc/100);
    var h='<div class="summary"><div class="ring"><svg viewBox="0 0 132 132" aria-hidden="true"><circle cx="66" cy="66" r="54" fill="none" stroke="#EEF0F3" stroke-width="12"/><circle cx="66" cy="66" r="54" fill="none" stroke="'+col+'" stroke-width="12" stroke-linecap="round" stroke-dasharray="'+C.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'"/></svg><div class="num" style="color:'+col+'"><span>'+sc+'<small>out of 100</small></span></div></div>';
    h+='<div class="sum-text"><h3>SEO Score: '+grade+'</h3><p>'+esc(ST.url)+'</p><div class="counts">';
    ['critical','high','medium','low'].forEach(function(k){if(cnt[k])h+='<span class="sev-c '+k+'">'+cnt[k]+' '+SEV[k].label+'</span>';});
    if(!issues.length)h+='<span class="c-ok">No issues found in this check</span>';
    h+='</div></div></div>';
    var scope=ST.siteDone?(ST.siteChecked?'this page plus '+ST.siteChecked+' other pages from your XML sitemap'+(ST.siteTotal?' (out of '+ST.siteTotal+' listed)':''):'this page only, because the XML sitemap could not be read'):'this page, while other pages from your XML sitemap are being sampled';
    var speed=ST.speedDone?(ST.speedOk?', with results from Google PageSpeed Insights (mobile)':'. Google PageSpeed Insights did not respond this time, so speed results are missing'):', while Google PageSpeed Insights runs';
    h+='<p class="basic-note">This report covers '+scope+speed+'. '+(ST.note?ST.note+' ':'')+'It cannot see backlinks, keyword rankings or competitors, which a full SEO audit covers.</p>';
    if(!ST.speedDone||!ST.siteDone)h+='<p class="tool-note" style="display:flex;gap:10px;align-items:center"><span class="spinner" aria-hidden="true"></span>Still checking. The score will update automatically.</p>';
    h+=tagsHtml();
    GROUPS.forEach(function(g){
      var rows=issues.filter(function(i){return i.group===g;}).sort(function(a,b){return SEV[a.sev].o-SEV[b.sev].o;});
      if(!rows.length)return;
      h+='<div class="igroup"><h4>'+g+' <span>'+plural(rows.length,'issue')+'</span></h4>';
      rows.forEach(function(r){h+='<div class="issue"><span class="sev '+r.sev+'">'+SEV[r.sev].label+'</span><div><b>'+r.title+'</b><span>'+r.why+'</span></div></div>';});
      h+='</div>';
    });
    if(ST.passed&&ST.passed.length)h+='<details class="passed"><summary>'+plural(ST.passed.length,'check')+' passed</summary><ul>'+ST.passed.map(function(p){return'<li>'+esc(p)+'</li>';}).join('')+'</ul></details>';
    if(ST.headings&&ST.headings.length){h+='<div class="outline"><h4>Heading Structure (H1 to H6) as Google Sees It</h4><ol>';ST.headings.slice(0,50).forEach(function(x){h+='<li class="l'+x.l+'"><b>H'+x.l+'</b>'+esc(cut(x.t,110))+'</li>';});h+='</ol></div>';}
    if(ST.metrics)h+=ST.metrics;
    var total=issues.length;
    h+='<div class="tool-cta"><p>'+(total?'Every issue on this list can be fixed. I\'ll send you a prioritized fix plan for this site, free.':'Looks solid. A full audit also checks every page, backlinks and rankings.')+'</p><a class="btn btn-sun" href="/contact/?site='+encodeURIComponent(ST.url)+'&amp;from=seo-checker">Get My Free Fix Plan</a></div>';
    out.innerHTML=h;out.style.display='block';
  }
  function metricsHtml(j){
    var a=j.lighthouseResult.audits,c=j.lighthouseResult.categories;
    function sc(v){if(v==null)return'<b>n/a</b>';var n=Math.round(v*100),col=n>=90?'var(--ok)':n>=50?'var(--warn)':'var(--bad)';return'<b style="color:'+col+'">'+n+'</b>';}
    function dv(k){return a[k]&&a[k].displayValue?esc(a[k].displayValue):'n/a';}
    return'<div class="speed"><h4>Google PageSpeed Insights (Mobile)</h4><div class="speed-grid"><div>'+sc(c.performance&&c.performance.score)+'<span>Performance</span></div><div>'+sc(c.seo&&c.seo.score)+'<span>Lighthouse SEO</span></div><div>'+sc(c.accessibility&&c.accessibility.score)+'<span>Accessibility</span></div><div><b>'+dv('largest-contentful-paint')+'</b><span>LCP</span></div><div><b>'+dv('cumulative-layout-shift')+'</b><span>CLS</span></div></div></div>';
  }
  function fail(msg){out.innerHTML='<div class="issue"><span class="sev critical">Error</span><div><b>We Could Not Check That Page</b><span>'+msg+'</span></div></div>';out.style.display='block';}

  async function run(){
    var url=normalize(input.value);
    if(!url){input.setCustomValidity('Enter a full website address, like https://example.com');input.reportValidity();input.setCustomValidity('');return;}
    input.value=url;btn.disabled=true;btn.textContent='Checking...';
    if(empty)empty.style.display='none';out.style.display='none';setStatus('Reading the page...');
    var speedJob=psi(url).catch(function(){return null;});
    try{
      var page=await readPage(url,15000);
      if(page){
        var A=analyze(page,url);
        ST={url:url,issues:A.issues,passed:A.passed,tags:A.tags,extraTags:[],headings:A.headings,site:[],speed:[],siteDone:false,speedDone:false};
        setStatus('Checking robots.txt and XML sitemap...');
        var rob=await readPage(A.info.origin+'/robots.txt',8000,true),rt=rob&&rob.body||'';
        var robotsOk=!!(rt&&(!rob.status||rob.status<400)&&/user-agent|sitemap|disallow|allow/i.test(rt)&&!/<html/i.test(rt));
        if(!robotsOk&&OWN_OK)ST.issues.push({group:'Indexing and Crawling',sev:'medium',title:'Missing robots.txt File',why:'Search engines request robots.txt first to learn which parts of the site they may crawl and where the XML sitemap is.'});else if(robotsOk)ST.passed.push('robots.txt file');
        if(OWN_OK||robotsOk)ST.extraTags.push({n:'robots.txt',c:'/robots.txt',v:robotsOk?'Found'+(/^\s*sitemap:/im.test(rt)?', with a Sitemap line':''):'Missing',s:robotsOk?'good':'miss'});
        if(robotsOk){var pu=new URL(page.finalUrl||url),rc=robotsCheck(parseRobots(rt),'Googlebot',pu.pathname+pu.search);
          if(!rc.allowed)ST.issues.push({group:'Indexing and Crawling',sev:'critical',title:'Page Blocked by robots.txt ('+esc(rc.rule)+')',why:'This robots.txt rule stops Googlebot from crawling this URL, so Google cannot read its content.'});else ST.passed.push('Googlebot allowed by robots.txt');}
        setStatus('');render();out.scrollIntoView({behavior:'smooth',block:'start'});
        var siteJob=(OWN_OK?siteSample(A.info.origin,rt,page.finalUrl||url):Promise.resolve(null)).then(function(S){
          ST.siteDone=true;
          if(!S){if(OWN_OK){ST.site=[{group:'Indexing and Crawling',sev:'medium',title:'Missing XML Sitemap',why:'Without a readable XML sitemap, Google may miss pages or take longer to find new ones.'}];ST.extraTags.push({n:'XML Sitemap',c:'/sitemap.xml',v:'Missing or unreadable',s:'miss'});}}
          else{ST.passed.push('XML sitemap ('+S.total+' URLs listed)');ST.extraTags.push({n:'XML Sitemap',c:pathOf(S.url),v:'Found, '+S.total+' URLs listed',s:'good'});ST.siteChecked=S.pages.length;ST.siteTotal=S.total;ST.site=siteIssues(S,A.info);}
          render();
        }).catch(function(){ST.siteDone=true;render();});
        var j=await speedJob;ST.speedDone=true;ST.speedOk=!!j;
        if(j){ST.speed=psiIssues(j,true,ST.issues);ST.metrics=metricsHtml(j);}
        render();await siteJob;
      }else{
        setStatus('This site blocks direct reading. Running Google\'s Lighthouse checks instead (up to a minute)...');
        var j2=await speedJob;setStatus('');
        if(!j2){fail('The site did not respond to us or to Google\'s test. Check the address is correct and the site is online, then try again.');return;}
        ST={url:url,issues:[],passed:[],tags:[],extraTags:[],headings:[],site:[],speed:psiIssues(j2,false),metrics:metricsHtml(j2),siteDone:true,speedDone:true,speedOk:true,
            note:'This site blocked our direct reader, so this report is based on Google\'s own Lighthouse audits.'};
        render();out.scrollIntoView({behavior:'smooth',block:'start'});
      }
    }finally{btn.disabled=false;btn.textContent='Check My Site';setStatus('');}
  }
  form.addEventListener('submit',function(e){e.preventDefault();run();});
  var pre=new URLSearchParams(location.search).get('check');if(pre){input.value=pre;run();}
})();
