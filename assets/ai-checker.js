/* Free AI Visibility Checker (GEO / AEO readiness)
   - Reads the raw HTML the way AI crawlers do (no JavaScript)
   - Checks robots.txt rules for 13 AI and search crawlers (RFC 9309 matching)
   - Requests the page as GPTBot, OAI-SearchBot, ClaudeBot and PerplexityBot to spot firewall blocks
   - Scores snippet controls, answer-first structure, schema, trust signals and discovery files
   - Explains why each issue matters, without fix instructions */
(function(){
  var form=document.getElementById('aiForm');
  if(!form)return;
  var input=document.getElementById('aiUrl'),btn=document.getElementById('aiBtn');
  var empty=document.getElementById('aiEmpty'),status=document.getElementById('aiStatus'),statusText=document.getElementById('aiStatusText'),out=document.getElementById('aiOut');
  var SEV={critical:{label:'Critical',p:12,o:0},high:{label:'High',p:7,o:1},medium:{label:'Medium',p:3,o:2},low:{label:'Low',p:1,o:3}};
  var GROUPS=['AI Crawler Access','Indexing and Snippet Controls','Content AI Can Read','Answer-Ready Structure','Schema and Entity Signals','Trust, Freshness and Citations','AI Discovery Files'];
  var BOTS=[
    {t:'Googlebot',co:'Google',p:'Google Search, AI Overviews and AI Mode',k:'search',sev:'critical'},
    {t:'Bingbot',co:'Microsoft',p:'Bing search and Microsoft Copilot answers',k:'search',sev:'high'},
    {t:'OAI-SearchBot',co:'OpenAI',p:'ChatGPT search results and source links',k:'search',sev:'high',probe:'oai-searchbot'},
    {t:'ChatGPT-User',co:'OpenAI',p:'Pages ChatGPT opens when a user asks it to',k:'user',sev:'low'},
    {t:'PerplexityBot',co:'Perplexity',p:'Perplexity answers and source links',k:'search',sev:'high',probe:'perplexitybot'},
    {t:'Claude-SearchBot',co:'Anthropic',p:'Claude search results',k:'search',sev:'medium'},
    {t:'Applebot',co:'Apple',p:'Siri and Spotlight suggestions',k:'search',sev:'low'},
    {t:'GPTBot',co:'OpenAI',p:'Training future OpenAI models',k:'training',probe:'gptbot'},
    {t:'ClaudeBot',co:'Anthropic',p:'Training future Claude models',k:'training',probe:'claudebot'},
    {t:'Google-Extended',co:'Google',p:'Gemini apps and model training (not Google Search)',k:'training'},
    {t:'Applebot-Extended',co:'Apple',p:'Training Apple Intelligence models',k:'training'},
    {t:'CCBot',co:'Common Crawl',p:'Open web dataset used to train many AI models',k:'training'},
    {t:'meta-externalagent',co:'Meta',p:'Meta AI and model training',k:'training'}
  ];

  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function normalize(v){v=(v||'').trim();if(!v)return null;if(!/^https?:\/\//i.test(v))v='https://'+v;try{var u=new URL(v);if(!u.hostname.includes('.'))return null;return u.href;}catch(e){return null;}}
  function timed(url,ms,opts){var c=new AbortController();var t=setTimeout(function(){c.abort();},ms);opts=opts||{};opts.signal=c.signal;return fetch(url,opts).finally(function(){clearTimeout(t);});}
  function setStatus(msg){status.style.display=msg?'flex':'none';if(msg)statusText.textContent=msg;}
  function plural(n,a,b){return n+' '+(n===1?a:(b||a+'s'));}
  function cut(s,n){s=String(s||'');return s.length>n?s.slice(0,n-1)+'\u2026':s;}
  function wc(s){s=(s||'').replace(/\s+/g,' ').trim();return s?s.split(' ').length:0;}
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
  async function readOwn(u,ms,extra){
    try{var r=await timed('/.netlify/functions/fetch-page?url='+encodeURIComponent(u)+(extra||''),ms||11000);
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
  async function probe(u,ua){var j=await readOwn(u,10000,'&ua='+ua+'&probe=1');if(!j)return null;return j.error?{error:j.error}:{status:j.status};}

  /* ---------- analysis ---------- */
  function analyze(R){
    var I=[],P=[],page=R.page,u=new URL(R.finalUrl),path=u.pathname+u.search,isHome=u.pathname==='/'||u.pathname==='';
    function issue(g,sev,title,why){I.push({group:g,sev:sev,title:title,why:why});}
    function pass(t){P.push(t);}

    /* crawler access */
    var groups=R.robotsOk?parseRobots(R.robotsTxt):[],rows=[],trainBlocked=0,trainTotal=0;
    BOTS.forEach(function(b){
      var rc=R.robotsOk?robotsCheck(groups,b.t,path):{allowed:true,rule:'',specific:false};
      var site=R.robotsOk?robotsCheck(groups,b.t,'/'):{allowed:true};
      var pr=b.probe&&R.probes?R.probes[b.probe]:undefined;
      var fw=null;
      if(pr&&R.baseStatus&&R.baseStatus<400){
        if(pr.error)fw='err';else if([401,403,406,429,451,503].indexOf(pr.status)>-1)fw=pr.status;
      }
      rows.push({b:b,rc:rc,site:site,pr:pr,fw:fw});
      if(b.k==='training'){trainTotal++;if(!rc.allowed)trainBlocked++;return;}
      if(!rc.allowed){
        var whole=!site.allowed;
        issue('AI Crawler Access',b.sev,b.t+' Blocked by robots.txt ('+esc(rc.rule)+')',b.t+' is used for '+(/^(Pages|Training|Open)\b/.test(b.p)?b.p.charAt(0).toLowerCase()+b.p.slice(1):b.p)+'. While it is blocked'+(whole?' across the whole site':' from this URL')+', '+b.co+' cannot read this page, so it cannot show or cite it there.');
      }
      if(fw&&rc.allowed)issue('AI Crawler Access',b.sev==='critical'?'high':'medium','Server Rejects '+b.t+' (HTTP '+(fw==='err'?'connection refused':fw)+')','robots.txt allows '+b.t+', but the server answered our test request as '+b.t+' with '+(fw==='err'?'no response':'status '+fw)+' while a normal visitor got '+R.baseStatus+'. This usually means a firewall, CDN or bot-protection setting is turning AI crawlers away. Some firewalls also reject requests that only claim to be a bot, so treat this as a strong hint rather than proof.');
    });
    var searchRows=rows.filter(function(r){return r.b.k!=='training';});
    if(searchRows.every(function(r){return r.rc.allowed&&!r.fw;}))pass('All AI search and answer crawlers can reach this page');
    if(trainTotal)pass('AI training crawlers: '+trainBlocked+' of '+trainTotal+' blocked (a business choice, not scored)');

    if(!page)return{issues:I,passed:P,rows:rows,preview:null,words:null};

    var doc=new DOMParser().parseFromString(page.body,'text/html');
    var q=function(s){return doc.querySelector(s);},qa=function(s){return Array.prototype.slice.call(doc.querySelectorAll(s));};

    /* indexing and snippet controls */
    if(R.status&&R.status>=400)issue('Indexing and Snippet Controls','critical','HTTP Status Code '+R.status+' (Error)','AI crawlers and search engines skip pages that return an error, so nothing on this URL can be cited.');
    var metas=qa('meta[name="robots" i],meta[name="googlebot" i],meta[name="bingbot" i]').map(function(m){return(m.getAttribute('content')||'').toLowerCase();}).join(', ');
    var allR=metas+' '+(page.xRobotsTag||'').toLowerCase();
    if(/noindex/.test(allR))issue('Indexing and Snippet Controls','critical','Noindex Tag Found (Meta Robots or X-Robots-Tag)','The page tells search engines not to index it. Google AI Overviews and Bing-powered answers only draw on indexed pages, so this page cannot be cited.');else pass('Indexable (no noindex)');
    if(/(^|[\s,])nosnippet/.test(allR)||/max-snippet:\s*0\b/.test(allR))issue('Indexing and Snippet Controls','high','Nosnippet Directive Blocks AI Overviews','Google does not use pages with nosnippet (or max-snippet:0) in AI Overviews, AI Mode or featured snippets, even when they rank.');
    else{var ms=allR.match(/max-snippet:\s*(\d+)/);if(ms&&+ms[1]>0&&+ms[1]<60)issue('Indexing and Snippet Controls','medium','Short max-snippet Limit ('+ms[1]+' Characters)','Google may only quote up to '+ms[1]+' characters from this page, which is too short for most AI answers to use it.');else pass('No snippet restrictions');}
    var dns=qa('[data-nosnippet]').length;
    if(dns)issue('Indexing and Snippet Controls','low','data-nosnippet on '+plural(dns,'Element'),'Text inside these elements cannot appear in Google snippets or AI Overviews.');
    if(/(^|[\s,])noai/.test(allR))pass('noai directive present (not a recognized standard; major crawlers ignore it)');
    if(!q('link[rel="canonical" i]'))issue('Indexing and Snippet Controls','low','Missing Canonical Tag','AI systems and search engines use the canonical tag to decide which URL to cite when the same content is reachable at several addresses.');else pass('Canonical tag');

    /* content AI can read without JavaScript */
    var body=doc.body?doc.body.cloneNode(true):null,words=0,text='';
    if(body){body.querySelectorAll('script,style,noscript,svg,template,nav,footer,header').forEach(function(n){n.remove();});text=(body.textContent||'').replace(/\s+/g,' ').trim();words=wc(text);}
    var scripts=qa('script[src]').length+qa('script:not([src]):not([type="application/ld+json"])').length;
    var shell=q('#root,#app,#__next,#__nuxt,#___gatsby,app-root,[data-reactroot]');
    var shellEmpty=shell&&wc(shell.textContent)<40;
    if((shellEmpty&&words<200)||(words<120&&scripts>=4))issue('Content AI Can Read','critical','Main Content Requires JavaScript (Client-Side Rendering)','Most AI crawlers, including GPTBot, ClaudeBot and PerplexityBot, read the raw HTML and do not run JavaScript. In this page\'s raw HTML they find only '+plural(words,'word')+', so the real content is invisible to them.');
    else if(words<300)issue('Content AI Can Read','high','Thin Content in Raw HTML ('+plural(words,'Word')+')','AI assistants quote pages that explain things fully. With this little text there is very little for them to cite.');
    else pass('About '+plural(words,'word')+' readable without JavaScript');
    if(!R.title)issue('Content AI Can Read','medium','Missing Meta Title (Title Tag)','The title tag is often shown as the source name when an AI answer links to a page.');
    if(!R.desc)issue('Content AI Can Read','low','Missing Meta Description','Some AI tools and search engines use the meta description to summarize a page before deciding whether to read it.');

    /* answer-ready structure */
    var hs=qa('h1,h2,h3').map(function(h){return{l:+h.tagName[1],t:(h.textContent||'').replace(/\s+/g,' ').trim(),el:h};}).filter(function(h){return h.t;});
    var h1=hs.filter(function(h){return h.l===1;}),h2=hs.filter(function(h){return h.l===2;});
    if(!h1.length)issue('Answer-Ready Structure','high','Missing H1 Tag','Without a main heading, AI systems have to guess what question this page answers.');else pass('H1 tag present');
    var lead=null;
    if(h1.length){var all=qa('h1,p');var i0=all.indexOf(h1[0].el);for(var i=i0+1;i<all.length;i++){var el=all[i];if(el.tagName==='P'&&!el.closest('nav,footer,header,form')){var tx=(el.textContent||'').replace(/\s+/g,' ').trim();if(wc(tx)>=8){lead=tx;break;}}}}
    if(!lead){var ps=qa('main p, article p, p').filter(function(p){return !p.closest('nav,footer,header,form')&&wc(p.textContent)>=8;});if(ps.length)lead=(ps[0].textContent||'').replace(/\s+/g,' ').trim();}
    if(!lead)issue('Answer-Ready Structure','medium','No Answer-First Paragraph','AI answers lift short, self-contained passages. This page has no clear opening paragraph that answers its main question directly.');
    else if(wc(lead)>90)issue('Answer-Ready Structure','low','Long Opening Paragraph ('+wc(lead)+' Words)','AI answers tend to quote short, self-contained passages. A long opening paragraph is harder to quote cleanly.');
    else pass('Answer-first opening paragraph ('+wc(lead)+' words)');
    if(h2.length<2)issue('Answer-Ready Structure','medium','Few H2 Subheadings ('+h2.length+')','AI systems split pages into sections by their subheadings and quote the section that matches a question. Few subheadings means few quotable sections.');else pass(h2.length+' H2 subheadings');
    var QW=/^(how|what|why|when|where|who|which|can|do|does|is|are|should|will|could|would)\b/i;
    var qh=hs.filter(function(h){return h.l>1&&(/\?\s*$/.test(h.t)||QW.test(h.t));}).length;
    if(!qh&&h2.length>=2)issue('Answer-Ready Structure','low','No Question-Style Headings','People ask AI assistants questions. Headings phrased the way people ask make it easy for AI to match a section to a prompt.');else if(qh)pass(plural(qh,'question-style heading'));
    var types=[],objs=[],ldErr=0;
    qa('script[type="application/ld+json"]').forEach(function(s){try{(function walk(o){if(Array.isArray(o))return o.forEach(walk);if(o&&typeof o==='object'){if(o['@type']){types=types.concat(o['@type']);objs.push(o);}if(o['@graph'])walk(o['@graph']);if(o.mainEntity)walk(o.mainEntity);}})(JSON.parse(s.textContent));}catch(e){ldErr++;}});
    types=types.filter(function(t,i,a){return a.indexOf(t)===i;});
    var hasFaq=types.indexOf('FAQPage')>-1||hs.some(function(h){return /faq|frequently asked|questions/i.test(h.t);})||qa('details summary').length>=2;
    if(!hasFaq)issue('Answer-Ready Structure','low','No FAQ Section','FAQ sections pair real questions with direct answers, which is the exact shape AI assistants and featured snippets use.');else pass('FAQ section');
    var lists=qa('ul,ol,table').filter(function(l){return !l.closest('nav,footer,header')&&(l.tagName==='TABLE'||l.querySelectorAll('li').length>=3);}).length;
    if(!lists)issue('Answer-Ready Structure','low','No Lists or Tables','Steps, comparisons and key facts in lists or tables are easy for AI systems to extract and reuse accurately.');else pass(plural(lists,'list or table','lists or tables'));

    /* schema and entity */
    if(ldErr)issue('Schema and Entity Signals','high','Invalid JSON-LD Schema ('+plural(ldErr,'Block')+')','Structured data that fails to parse is ignored, so the facts it was meant to share are lost.');
    if(!types.length)issue('Schema and Entity Signals','high','Missing Schema Markup (JSON-LD)','Schema states facts in a machine-readable way: who you are, what you offer, where and when. Without it, AI systems infer these facts and can get them wrong.');
    else pass('Schema markup ('+types.slice(0,5).join(', ')+')');
    var ENT=/Organization|LocalBusiness|ProfessionalService|Person|Corporation|Store|Restaurant|Dentist|Attorney|LegalService|MedicalBusiness|HomeAndConstructionBusiness|Plumber|Electrician|RoofingContractor|AutomotiveBusiness|FinancialService|RealEstateAgent|HealthAndBeautyBusiness|LodgingBusiness|FoodEstablishment/;
    var hasEnt=types.some(function(t){return ENT.test(t);});
    if(!hasEnt)issue('Schema and Entity Signals',isHome?'high':'medium','No Organization, LocalBusiness or Person Schema','AI assistants build a profile of each business (an entity) before they recommend it. This page does not describe the business behind it in schema.');else pass('Entity schema (business or person)');
    var hasSame=objs.some(function(o){return o.sameAs&&(Array.isArray(o.sameAs)?o.sameAs.length:1);});
    if(hasEnt&&!hasSame)issue('Schema and Entity Signals','low','No sameAs Profile Links in Schema','sameAs links connect the site to its LinkedIn, Google Business Profile and other profiles, which helps AI systems confirm they have the right business.');else if(hasSame)pass('sameAs profile links in schema');
    var art=objs.filter(function(o){return /Article|BlogPosting|NewsArticle/.test([].concat(o['@type']).join(' '));});
    if(art.length&&!art.some(function(o){return o.author;}))issue('Schema and Entity Signals','medium','Article Schema Without Author','AI systems weigh who wrote a piece. The article schema on this page does not say who the author is.');

    /* trust, freshness and citations */
    var dated=objs.some(function(o){return o.dateModified||o.datePublished;})||!!q('meta[property="article:modified_time"],meta[property="article:published_time"],meta[name="date" i],meta[itemprop="dateModified"],time[datetime]');
    if(!dated)issue('Trust, Freshness and Citations',art.length?'medium':'low','No Published or Updated Date','AI assistants favor current information. Without a date, they cannot tell whether this page is up to date.');else pass('Published or updated date');
    var author=!!q('meta[name="author" i],[rel~="author"],[itemprop="author"],.author,.byline')||objs.some(function(o){return o.author;})||types.indexOf('Person')>-1;
    if(!author)issue('Trust, Freshness and Citations',art.length?'medium':'low','No Author Information','Pages that show who wrote them, and why that person is qualified, carry more weight with Google and AI systems.');else pass('Author information');
    var links=qa('a[href]'),aboutC=false,ext=0,host=u.hostname.replace(/^www\./,''),SOC=/facebook\.|twitter\.|x\.com|linkedin\.|instagram\.|youtube\.|tiktok\.|pinterest\.|wa\.me|whatsapp/;
    links.forEach(function(a){var h=a.getAttribute('href')||'',t=(a.textContent||'').toLowerCase();if(/about|contact/.test(h.toLowerCase()+' '+t))aboutC=true;
      try{var lu=new URL(h,u.href);if(/^https?:$/.test(lu.protocol)&&lu.hostname.replace(/^www\./,'')!==host&&!SOC.test(lu.hostname)&&!a.closest('nav,footer,header'))ext++;}catch(e){}});
    if(!aboutC)issue('Trust, Freshness and Citations','low','No Links to About or Contact Pages','About and contact pages are basic trust signals that tell people and AI systems a real business stands behind the content.');else pass('Links to about or contact pages');
    if(!ext)issue('Trust, Freshness and Citations','low','No Outbound Citations to Sources','A 2023 study on generative engine optimization (Aggarwal and colleagues, Princeton University) found that citing sources, adding statistics and quoting experts made content noticeably more likely to appear in AI-generated answers.');else pass(plural(ext,'outbound citation link'));
    var stats=(text.match(/\b\d[\d,.]*\s?(%|percent\b|x\b|times\b)|\$\s?\d[\d,.]*|\b\d[\d,.]*\s?(k|m)\b/gi)||[]).length;
    if(!stats)issue('Trust, Freshness and Citations','low','No Statistics or Specific Numbers','Specific figures give AI answers something concrete to quote, and the same research found statistics improved visibility in AI answers.');else pass(plural(stats,'statistic or figure'));
    if(u.protocol!=='https:')issue('Trust, Freshness and Citations','high','No HTTPS (Insecure HTTP Connection)','Insecure pages are trusted less by browsers, search engines and AI systems.');

    /* discovery files */
    if(R.ownOk){
      if(!R.robotsOk)issue('AI Discovery Files','low','No robots.txt File','Crawlers request robots.txt first. Without it, every crawler is allowed, but there is no file pointing them to your XML sitemap.');else pass('robots.txt file');
      if(!R.sitemapOk)issue('AI Discovery Files','medium','Missing XML Sitemap','The XML sitemap is how search engines, and the AI answers built on them, discover all of your important pages.');else pass('XML sitemap');
      if(!R.llmsOk)issue('AI Discovery Files','low','No llms.txt File','llms.txt is a proposed standard that gives AI tools a short, clean summary of a site. Google has said its search systems do not use it, but some AI tools and agents read it.');
      else if(!/^\s*#\s+\S/.test(R.llmsTxt))issue('AI Discovery Files','low','llms.txt Has No Title Line','The llms.txt proposal starts the file with a single # title line naming the site. Tools that read it expect that structure.');
      else pass('llms.txt file');
    }

    var preview={q:h1.length?h1[0].t:R.title,a:lead,desc:R.desc,title:R.title};
    return{issues:I,passed:P,rows:rows,preview:preview,words:words};
  }

  /* ---------- rendering ---------- */
  /* Honest scoring: AI tools need content they can reach, read and trust, so every gap counts.
     Critical problems cap the score below 40 and missing essentials keep it out of the top band. */
  var DED={critical:25,high:10,medium:5,low:2};
  function score(issues){
    var raw=100,low=0,crit=0,hi=0;
    issues.forEach(function(i){
      if(i.sev==='low')low+=DED.low;else raw-=DED[i.sev];
      if(i.sev==='critical')crit++;if(i.sev==='high')hi++;
    });
    raw-=Math.min(low,16);
    if(crit)raw=Math.min(raw,40-(crit-1)*8);
    if(hi>=3)raw=Math.min(raw,60);else if(hi>=1)raw=Math.min(raw,80);
    return Math.max(3,Math.min(100,Math.round(raw)));
  }
  function botTable(rows,probed){
    var h='<div class="tags"><h4>AI Crawler Access for This URL</h4>';
    rows.forEach(function(r){
      var b=r.b,st,lab,val;
      if(!r.rc.allowed){st=b.k==='training'?'info':'miss';lab='Blocked';val=esc(b.p)+'. <em>robots.txt: '+esc(r.rc.rule)+'</em>';}
      else if(r.fw){st='check';lab='Server blocks';val=esc(b.p)+'. <em>robots.txt allows it, but the server answered HTTP '+(r.fw==='err'?'error':r.fw)+'.</em>';}
      else{st='good';lab='Allowed';val=esc(b.p)+(r.rc.rule?'. <em>robots.txt: '+esc(r.rc.rule)+'</em>':'')+(r.pr&&r.pr.status?'. <em>Server test: HTTP '+r.pr.status+'</em>':'');}
      if(b.k==='training'&&!r.rc.allowed)val+=' <em>(training only, a business choice)</em>';
      h+='<div class="tagrow"><div class="tn">'+esc(b.t)+'<small>'+esc(b.co)+(b.k==='training'?', training':b.k==='user'?', user visits':', search and answers')+'</small></div><div class="tv">'+val+'</div><span class="st '+st+'">'+lab+'</span></div>';
    });
    return h+'</div>';
  }
  function render(S){
    var A=S.A,issues=A.issues,sc=score(issues),col=sc>=85?'var(--ok)':sc>=60?'var(--warn)':'var(--bad)',grade=sc>=85?'AI Ready':sc>=60?'Partly Ready':'Hard for AI to Use';
    var cnt={critical:0,high:0,medium:0,low:0};issues.forEach(function(i){cnt[i.sev]++;});
    var C=2*Math.PI*54,off=C*(1-sc/100);
    var h='<div class="summary"><div class="ring"><svg viewBox="0 0 132 132" aria-hidden="true"><circle cx="66" cy="66" r="54" fill="none" stroke="#EEF0F3" stroke-width="12"/><circle cx="66" cy="66" r="54" fill="none" stroke="'+col+'" stroke-width="12" stroke-linecap="round" stroke-dasharray="'+C.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'"/></svg><div class="num" style="color:'+col+'"><span>'+sc+'<small>out of 100</small></span></div></div>';
    h+='<div class="sum-text"><h3>AI Visibility Score: '+grade+'</h3><p>'+esc(S.url)+'</p><div class="counts">';
    ['critical','high','medium','low'].forEach(function(k){if(cnt[k])h+='<span class="sev-c '+k+'">'+cnt[k]+' '+SEV[k].label+'</span>';});
    if(!issues.length)h+='<span class="c-ok">No issues found in this check</span>';
    h+='</div><p class="score-how">How this score works: each issue lowers it by severity, any critical issue keeps it below 40, and missing essentials keep it out of the AI Ready band.</p></div></div>';
    h+='<p class="basic-note">This check reads the page the way AI crawlers do: raw HTML, no JavaScript. It measures whether AI systems can reach, read and quote this page. It does not query ChatGPT or Google, so it cannot show whether you are cited today. '+(S.note||'')+'</p>';
    h+=botTable(A.rows,S.probed);
    if(A.preview&&A.preview.a){h+='<div class="preview"><h4>What an AI Answer Would Likely Quote</h4><span class="q">The question this page answers (its H1)</span><blockquote><b>'+esc(cut(A.preview.q||'(no H1)',140))+'</b>'+esc(cut(A.preview.a,360))+'</blockquote></div>';}
    GROUPS.forEach(function(g){
      var rows=issues.filter(function(i){return i.group===g;}).sort(function(a,b){return SEV[a.sev].o-SEV[b.sev].o;});
      if(!rows.length)return;
      h+='<div class="igroup"><h4>'+g+' <span>'+plural(rows.length,'issue')+'</span></h4>';
      rows.forEach(function(r){h+='<div class="issue"><span class="sev '+r.sev+'">'+SEV[r.sev].label+'</span><div><b>'+r.title+'</b><span>'+r.why+'</span></div></div>';});
      h+='</div>';
    });
    if(A.passed.length)h+='<details class="passed"><summary>'+plural(A.passed.length,'check')+' passed</summary><ul>'+A.passed.map(function(p){return'<li>'+esc(p)+'</li>';}).join('')+'</ul></details>';
    h+='<div class="tool-cta"><p>'+(issues.length?'Every issue on this list can be fixed. I\'ll send you a prioritized plan to make this site easier for AI to find and cite, free.':'Strong foundations. A full GEO audit also tracks where AI answers mention you and your competitors.')+'</p><a class="btn btn-sun" href="/contact/?site='+encodeURIComponent(S.url)+'&amp;from=ai-visibility-checker&amp;service=AI%20search%20optimization%20(GEO)">Get My Free Fix Plan</a></div>';
    out.innerHTML=h;out.style.display='block';
  }
  function fail(msg){out.innerHTML='<div class="issue"><span class="sev critical">Error</span><div><b>We Could Not Check That Page</b><span>'+msg+'</span></div></div>';out.style.display='block';}

  async function run(){
    var url=normalize(input.value);
    if(!url){input.setCustomValidity('Enter a full website address, like https://example.com');input.reportValidity();input.setCustomValidity('');return;}
    input.value=url;btn.disabled=true;btn.textContent='Checking...';
    if(empty)empty.style.display='none';out.style.display='none';setStatus('Reading the raw HTML the way AI crawlers do...');
    try{
      var page=await readPage(url,15000);
      var finalUrl=(page&&page.finalUrl)||url,origin=new URL(finalUrl).origin;
      setStatus('Checking robots.txt rules for 13 AI crawlers...');
      var jobs=[readPage(origin+'/robots.txt',8000,true),readPage(origin+'/llms.txt',8000,true)];
      var rob=await jobs[0],llm=await jobs[1];
      var rt=rob&&rob.body||'',robotsOk=!!(rt&&(!rob.status||rob.status<400)&&/user-agent|sitemap|disallow|allow/i.test(rt)&&!/<html/i.test(rt));
      var lt=llm&&llm.body||'',llmsOk=!!(lt&&(!llm.status||llm.status<400)&&!/<html|<!doctype/i.test(lt)&&lt.trim().length>20);
      var smUrl=(robotsOk&&(rt.match(/^\s*sitemap:\s*(\S+)/im)||[])[1])||origin+'/sitemap.xml';
      var probes=null;
      if(OWN_OK&&page){
        setStatus('Requesting the page as GPTBot, OAI-SearchBot, ClaudeBot and PerplexityBot...');
        var keys=['gptbot','oai-searchbot','claudebot','perplexitybot'];
        var res=await Promise.all(keys.map(function(k){return probe(finalUrl,k).catch(function(){return null;});}));
        probes={};keys.forEach(function(k,i){if(res[i])probes[k]=res[i];});
      }
      var sm=OWN_OK?await readPage(smUrl,8000,true):null;
      var sitemapOk=!!(sm&&sm.body&&/<(urlset|sitemapindex)/i.test(sm.body));
      if(!page&&!robotsOk){fail('The site did not respond to our reader. Check the address is correct and the site is online, then try again.');return;}
      var title='',desc='';
      if(page){var d0=new DOMParser().parseFromString(page.body,'text/html');title=((d0.querySelector('title')||{}).textContent||'').replace(/\s+/g,' ').trim();var md=d0.querySelector('meta[name="description" i]');desc=md?(md.getAttribute('content')||'').trim():'';}
      var R={page:page,finalUrl:finalUrl,status:page&&page.status,baseStatus:page&&(page.status||200),robotsOk:robotsOk,robotsTxt:rt,llmsOk:llmsOk,llmsTxt:lt,sitemapOk:sitemapOk,probes:probes,ownOk:!!OWN_OK,title:title,desc:desc};
      var A=analyze(R);
      setStatus('');
      render({url:url,A:A,probed:!!probes,note:page?'':'This site blocked our reader, so only robots.txt rules could be checked.'});
      out.scrollIntoView({behavior:'smooth',block:'start'});
    }finally{btn.disabled=false;btn.textContent='Check AI Visibility';setStatus('');}
  }
  form.addEventListener('submit',function(e){e.preventDefault();run();});
  var pre=new URLSearchParams(location.search).get('check');if(pre){input.value=pre;run();}
})();
