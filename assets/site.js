(function(){
  var b=document.querySelector('.menu-btn'),m=document.getElementById('menu');
  if(b&&m){b.addEventListener('click',function(){var o=b.getAttribute('aria-expanded')==='true';b.setAttribute('aria-expanded',o?'false':'true');m.classList.toggle('open',!o);});}
  var y=document.getElementById('yr');if(y)y.textContent=new Date().getFullYear();
  /* contact form: prefill website from ?site= */
  var s=new URLSearchParams(location.search).get('site'),f=document.getElementById('cf-site');if(s&&f)f.value=s;
})();
