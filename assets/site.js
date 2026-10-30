(function(){
  var d=document,root=d.documentElement;
  /* mobile menu */
  var b=d.querySelector('.menu-btn'),m=d.getElementById('menu');
  if(b&&m){b.addEventListener('click',function(){var o=b.getAttribute('aria-expanded')==='true';b.setAttribute('aria-expanded',o?'false':'true');m.classList.toggle('open',!o);});
    d.addEventListener('keydown',function(e){if(e.key==='Escape'&&m.classList.contains('open')){m.classList.remove('open');b.setAttribute('aria-expanded','false');b.focus();}});}
  var y=d.getElementById('yr');if(y)y.textContent=new Date().getFullYear();

  /* contact form: prefill website and lead source from the URL (?site=...&from=...) */
  var q=new URLSearchParams(location.search),s=q.get('site'),f=d.getElementById('cf-site');if(s&&f)f.value=s;
  var src=d.getElementById('cf-source');if(src){src.value=q.get('from')||(d.referrer?d.referrer.replace(/^https?:\/\//,'').slice(0,120):'direct');}
  var svc=q.get('service'),sel=d.getElementById('cf-service');
  if(svc&&sel){for(var i=0;i<sel.options.length;i++){if(sel.options[i].value===svc){sel.selectedIndex=i;break;}}}

  /* header shadow and mobile lead bar */
  var top=d.querySelector('.top'),mc=d.querySelector('.m-cta');
  function onScroll(){var sy=window.scrollY||0;if(top)top.classList.toggle('scrolled',sy>8);if(mc)mc.classList.toggle('show',sy>520);}
  window.addEventListener('scroll',onScroll,{passive:true});onScroll();

  /* reveal on scroll (content stays visible if anything fails) */
  var els=d.querySelectorAll('.rv');
  if(els.length&&'IntersectionObserver' in window&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    root.classList.add('js');
    var io=new IntersectionObserver(function(en){en.forEach(function(x){if(x.isIntersecting){x.target.classList.add('in');io.unobserve(x.target);}});},{rootMargin:'0px 0px -8% 0px'});
    els.forEach(function(el){io.observe(el);});
    setTimeout(function(){els.forEach(function(el){el.classList.add('in');});},2500);
  }

  /* contact page: live clocks for Karachi and the visitor */
  var ck=d.getElementById('clk-pk'),cu=d.getElementById('clk-you'),cl=d.getElementById('clk-you-l');
  if(ck&&cu){
    var tz='';try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'';}catch(e){}
    var showNY=!tz||tz==='Asia/Karachi';
    if(cl)cl.textContent=showNY?'New York':'Your time ('+tz.split('/').pop().replace(/_/g,' ')+')';
    var tick=function(){var n=new Date();
      try{ck.textContent=n.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Karachi'});
        cu.textContent=n.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:showNY?'America/New_York':tz});}catch(e){}};
    tick();setInterval(tick,30000);
  }
})();
/* Email links: also copy the address, because many computers have no email app set up */
(function(){
  function toast(msg){
    var t=document.getElementById('copy-toast');
    if(!t){t=document.createElement('div');t.id='copy-toast';t.setAttribute('role','status');t.setAttribute('aria-live','polite');document.body.appendChild(t);}
    t.textContent=msg;t.classList.add('show');clearTimeout(t._h);t._h=setTimeout(function(){t.classList.remove('show');},5000);
  }
  function copy(text){
    if(navigator.clipboard&&window.isSecureContext)return navigator.clipboard.writeText(text);
    return new Promise(function(res,rej){var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy')?res():rej();}catch(e){rej(e);}ta.remove();});
  }
  document.addEventListener('click',function(e){
    var a=e.target.closest&&e.target.closest('a[href^="mailto:"]');if(!a)return;
    var addr=decodeURIComponent(a.getAttribute('href').slice(7).split('?')[0]);
    copy(addr).then(function(){toast('Email address copied: '+addr+'. If no email app opened, paste it into your email.');},function(){toast('Email me at '+addr);});
  });
})();
