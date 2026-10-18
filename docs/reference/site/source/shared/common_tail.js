var nav=$('nav'), lenis=null;
function onScroll(){ nav.classList.toggle('solid',window.scrollY>40); }
if(window.Lenis&&!RM){ lenis=new Lenis({lerp:.1,smoothWheel:true}); lenis.on('scroll',onScroll); (function raf(t){ lenis.raf(t); requestAnimationFrame(raf); })(0); }
addEventListener('scroll',onScroll,{passive:true}); onScroll();
document.querySelectorAll('a[href^="#"]').forEach(function(a){ a.addEventListener('click',function(e){ var id=a.getAttribute('href').slice(1); var t=id==='top'?document.body:$(id); if(!t) return; e.preventDefault(); if(lenis) lenis.scrollTo(id==='top'?0:t,{offset:-70,duration:1.2}); else (id==='top'?window.scrollTo({top:0,behavior:RM?'auto':'smooth'}):t.scrollIntoView({behavior:RM?'auto':'smooth'})); }); });
new IntersectionObserver(function(e){ if(e[0].isIntersecting) $('contact').classList.add('go'); },{threshold:.2}).observe($('contact'));

/* cursor */
if(FINE){ document.body.classList.add('cursor-on'); var cu=$('cur'), ring=cu.querySelector('.r'), dot=cu.querySelector('.d'), mx=0, my=0, rx=0, ry=0;
  addEventListener('mousemove',function(e){ cu.style.opacity=1; mx=e.clientX; my=e.clientY; dot.style.transform='translate('+mx+'px,'+my+'px)'; var t=e.target.closest('[data-cur]'); if(t){ $('curL').textContent=t.dataset.cur; cu.classList.add('big'); } else cu.classList.remove('big'); });
  (function f(){ rx+=(mx-rx)*(RM?1:.2); ry+=(my-ry)*(RM?1:.2); ring.style.transform='translate('+rx+'px,'+ry+'px)'; requestAnimationFrame(f); })();
  document.addEventListener('mouseleave',function(){ cu.style.opacity=0; }); document.addEventListener('mouseenter',function(){ cu.style.opacity=1; }); }

/* menu */
$('menuBtn').addEventListener('click',function(){ $('mob').hidden=false; this.setAttribute('aria-expanded','true'); });
function closeM(){ $('mob').hidden=true; $('menuBtn').setAttribute('aria-expanded','false'); }
$('menuX').addEventListener('click',closeM); $('mob').querySelectorAll('a').forEach(function(a){ a.addEventListener('click',closeM); });
})();