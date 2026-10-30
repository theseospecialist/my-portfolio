(function(){
  var b=document.querySelector('.menu-btn'),m=document.getElementById('menu');
  if(b&&m){b.addEventListener('click',function(){var o=b.getAttribute('aria-expanded')==='true';b.setAttribute('aria-expanded',o?'false':'true');m.classList.toggle('open',!o);});}
  var y=document.getElementById('yr');if(y)y.textContent=new Date().getFullYear();
  /* contact form: prefill website from ?site= */
  var s=new URLSearchParams(location.search).get('site'),f=document.getElementById('cf-site');if(s&&f)f.value=s;
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
