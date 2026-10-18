
/* ---------- the wire: one show, many dials ---------- */
/*SCENES*/
(function(){
  var viz=$('sxViz'); if(!viz) return;
  var SAZN=S[2];
  var CAR=[
    {n:'12.1',cs:'BEAT',mk:'Inland Empire',c:'#C04A9E',t:'cash',tv:'$2.50 an airing',a:-150},
    {n:'24.1',cs:'REEL',mk:'Inland Empire',c:'#D98A2B',t:'share',tv:'30% revenue share',a:-108},
    {n:'33.1',cs:'MESA',mk:'High Desert',c:'#3478C6',t:'cash',tv:'$2.50 an airing',a:-72},
    {n:'41.1',cs:'ORNG',mk:'Orange County',c:'#E0583A',t:'cash',tv:'$1.00 + 15%',a:-30},
    {n:'19.1',cs:'LBCH',mk:'Long Beach',c:'#2F9A72',t:'share',tv:'40% revenue share',a:30},
    {n:'27.1',cs:'VALE',mk:'Coachella Valley',c:'#EBA03A',t:'free',tv:'Free to carry',a:72},
    {n:'31.1',cs:'PREP',mk:'Inland Empire',c:'#5B7BE0',t:'cash',tv:'$2.00 an airing',a:108},
    {n:'7.1',cs:'CIVC',mk:'Inland Empire',c:'#9A9CAB',t:'free',tv:'Free to carry',a:150}];
  var tiles=CAR.map(function(c,i){ var d=document.createElement('div'); d.className='sx-t'; d.style.setProperty('--c',c.c);
    d.innerHTML='<div class="ts"><canvas width="160" height="90"></canvas><span class="badge" style="background:'+c.c+'">'+c.n+'</span><em class="st"></em></div><div class="tm"><b>'+c.cs+'</b><small>'+c.mk+'</small></div><div class="tt">'+c.tv+'</div><span class="pp">'+(c.t==='cash'?'+$'+(c.tv.match(/\d+\.\d+/)||['2.50'])[0]:c.t==='share'?'+ watch time':'+ reach')+'</span>';
    viz.appendChild(d); return {el:d,c:c,x:d.querySelector('canvas').getContext('2d'),live:i%3===0,until:0,next:15+i*17}; });
  var phone=matchMedia('(max-width:699px)');
  function place(){
    if(phone.matches){ tiles.forEach(function(t,i){ t.el.style.left=(12.5+25*(i%4))+'%'; t.el.style.top=(i<4?62:85)+'%'; }); return; }
    tiles.forEach(function(t){ var r=t.c.a*Math.PI/180; t.el.style.left=(50+40*Math.cos(r))+'%'; t.el.style.top=(50+39*Math.sin(r))+'%'; }); }
  place(); addEventListener('resize',place);
  function status(t){ var e=t.el.querySelector('.st'); if(t.live){ e.textContent='On air'; e.className='st on'; } else { e.textContent=t.aired?'Aired':'In '+t.next+' min'; e.className='st'; } t.el.classList.toggle('live',t.live); }
  tiles.forEach(status);
  var lc=$('sxLines'), lx=lc.getContext('2d'), W=0, H=0, dpr=Math.min(2,devicePixelRatio||1);
  function size(){ var r=viz.getBoundingClientRect(); W=r.width; H=r.height; lc.width=W*dpr; lc.height=H*dpr; lx.setTransform(dpr,0,0,dpr,0,0); }
  size(); addEventListener('resize',size);
  function pt(t){ var r=t.el.getBoundingClientRect(), v=viz.getBoundingClientRect(); return {x:r.left-v.left+r.width/2, y:r.top-v.top+r.height/2}; }
  var pulses=[], paid=412.5, air=121, k=0;
  function fire(){ var t=tiles[k%tiles.length]; k++; pulses.push({t:t,s:performance.now()}); }
  function arrive(t){ t.live=true; t.aired=false; t.until=performance.now()+9000; status(t);
    t.el.classList.remove('pay'); void t.el.offsetWidth; t.el.classList.add('pay');
    air++; if(t.c.t==='cash'){ var v=parseFloat((t.c.tv.match(/\d+\.\d+/)||['2.50'])[0]); paid+=v; }
    $('wPaid').textContent='$'+paid.toFixed(2); $('wAir').textContent=air;
    ['wPaid','wAir'].forEach(function(id){ var f=$(id); f.classList.remove('bump'); void f.offsetWidth; f.classList.add('bump'); }); }
  function curve(a,b){ var mx=(a.x+b.x)/2, my=(a.y+b.y)/2, dx=b.x-a.x, dy=b.y-a.y; return {x:mx-dy*.12, y:my+dx*.12}; }
  function q(a,c,b,u){ var v=1-u; return {x:v*v*a.x+2*v*u*c.x+u*u*b.x, y:v*v*a.y+2*v*u*c.y+u*u*b.y}; }
  var pic=$('wPic').getContext('2d'), vis=true, last=0;
  new IntersectionObserver(function(e){ vis=e[0].isIntersecting; }).observe(viz);
  function noise(x){ x.fillStyle='#07050d'; x.fillRect(0,0,160,90); for(var i=0;i<70;i++){ var g=Math.random()*40|0; x.fillStyle='rgba('+(g+30)+','+(g+26)+','+(g+44)+',.6)'; x.fillRect(Math.random()*160,Math.random()*90,2+Math.random()*8,1); } }
  function frame(now){ requestAnimationFrame(frame); if(!vis||document.hidden) return;
    var T=RM?0:now/1000, hb=viz.querySelector('.sx-scr').getBoundingClientRect(), vb=viz.getBoundingClientRect(), c={x:hb.left-vb.left+hb.width/2,y:hb.top-vb.top+hb.height/2};
    lx.clearRect(0,0,W,H);
    tiles.forEach(function(t){ var p=pt(t), m=curve(c,p); lx.beginPath(); lx.moveTo(c.x,c.y); lx.quadraticCurveTo(m.x,m.y,p.x,p.y);
      lx.strokeStyle=t.live?hexA(t.c.c,.55):'rgba(243,234,217,.10)'; lx.lineWidth=t.live?1.6:1; lx.setLineDash(t.live?[]:[3,5]); lx.stroke(); lx.setLineDash([]);
      if(t.live&&now>t.until){ t.live=false; t.aired=true; status(t); } });
    pulses=pulses.filter(function(P){ var u=(now-P.s)/1100; if(u>=1){ arrive(P.t); return false; }
      var p=pt(P.t), m=curve(c,p), e=u<.5?2*u*u:1-Math.pow(-2*u+2,2)/2;
      for(var j=0;j<10;j++){ var uu=Math.max(0,e-j*.018), d=q(c,m,p,uu); lx.fillStyle=hexA(P.t.c.c,(1-j/10)*.9); lx.beginPath(); lx.arc(d.x,d.y,3.4-j*.25,0,7); lx.fill(); }
      var h=q(c,m,p,e); var g=lx.createRadialGradient(h.x,h.y,0,h.x,h.y,16); g.addColorStop(0,hexA(P.t.c.c,.6)); g.addColorStop(1,hexA(P.t.c.c,0)); lx.fillStyle=g; lx.beginPath(); lx.arc(h.x,h.y,16,0,7); lx.fill();
      return true; });
    if(now-last<66) return; last=now;
    draw(pic,320,180,T,SAZN);
    tiles.forEach(function(t){ if(t.live) draw(t.x,160,90,T,SAZN); else noise(t.x); });
  }
  requestAnimationFrame(frame);
  if(!RM){ setTimeout(fire,700); setInterval(function(){ if(vis&&!document.hidden) fire(); },2300); }
  setInterval(function(){ tiles.forEach(function(t){ if(!t.live&&!t.aired&&t.next>1){ t.next--; status(t); } }); },60000);
})();

/* ---------- find what fits ---------- */
(function(){
  var list=$('fList'); if(!list) return;
  var P=[
    {t:'Tamales for forty',by:'18.1 SAZN',c:'#E0583A',len:30,eps:'26 episodes',slot:['day','prime'],terms:'cash',tv:'$2.50 an airing',g:'Cooking'},
    {t:'Late Crate',by:'12.1 BEAT',c:'#C04A9E',len:60,eps:'Weekly, live',slot:['late'],terms:'share',tv:'25% revenue share',g:'Music'},
    {t:'Saturday Reel',by:'24.1 REEL',c:'#D98A2B',len:120,eps:'40 films',slot:['prime','late'],terms:'share',tv:'40% revenue share',g:'Film'},
    {t:'Game Film',by:'31.1 PREP',c:'#3478C6',len:60,eps:'Weekly',slot:['day','prime'],terms:'free',tv:'Free to carry',g:'Sports'},
    {t:'Silent Hour',by:'Network catalog',c:'#9A9CAB',len:60,eps:'52 films, public domain',slot:['late','day'],terms:'free',tv:'Free to carry',g:'Film'},
    {t:'Neighborhood Hour',by:'7.1 CIVC',c:'#2F9A72',len:60,eps:'Weekly',slot:['day'],terms:'free',tv:'Free to carry',g:'Civic'},
    {t:'Crate Talk',by:'Pomona Vinyl Club, a studio',c:'#7a3b8f',len:30,eps:'12 episodes',slot:['prime','late'],terms:'cash',tv:'$3.00 an airing',g:'Talk'},
    {t:'Wind at Amboy',by:'92.0 FLDR',c:'#C9709A',len:120,eps:'Field recordings, CC BY',slot:['late'],terms:'free',tv:'Free to carry',g:'Ambient'},
    {t:'Abuela’s Pantry',by:'18.1 SAZN',c:'#E0583A',len:30,eps:'18 episodes',slot:['day'],terms:'share',tv:'30% revenue share',g:'Cooking'},
    {t:'Serial Saturday',by:'Network catalog',c:'#9A9CAB',len:30,eps:'36 chapters, public domain',slot:['day','prime'],terms:'free',tv:'Free to carry',g:'Film'},
    {t:'Short Stack',by:'24.1 REEL',c:'#D98A2B',len:30,eps:'60 shorts',slot:['prime','late'],terms:'cash',tv:'$2.00 an airing',g:'Film'}];
  var F={slot:'any',len:'any',terms:'any',sort:'fit',q:''}, asked={};
  var LBL={slot:{any:'Any time',day:'Daytime',prime:'Prime',late:'Late night'},len:{any:'Any length','30':'30 min','60':'60 min','120':'2 h and up'},terms:{any:'Any terms',share:'Revenue share',cash:'Cash',free:'Free'},sort:{fit:'Best fit',short:'Shortest first',long:'Longest first',az:'A to Z'}};
  function fits(p){ var q=F.q.trim().toLowerCase(); return (F.slot==='any'||p.slot.indexOf(F.slot)>=0)&&(F.len==='any'||(F.len==='120'?p.len>=120:p.len===+F.len))&&(F.terms==='any'||p.terms===F.terms)&&(!q||(p.t+' '+p.by+' '+p.g).toLowerCase().indexOf(q)>=0); }
  function sorted(r){ r=r.slice(); if(F.sort==='short') r.sort(function(a,b){ return a.len-b.len; }); else if(F.sort==='long') r.sort(function(a,b){ return b.len-a.len; }); else if(F.sort==='az') r.sort(function(a,b){ return a.t.localeCompare(b.t); }); return r; }
  function sync(){ document.querySelectorAll('.fit .f-dd').forEach(function(d){ var k=d.dataset.k; d.querySelector('.f-dd-b b').textContent=LBL[k][F[k]]; d.classList.toggle('set',k!=='sort'&&F[k]!=='any'); d.querySelectorAll('[role=option]').forEach(function(o){ o.setAttribute('aria-selected',o.dataset.v===F[k]?'true':'false'); }); });
    document.querySelectorAll('#fSheet .seg2').forEach(function(g){ g.querySelectorAll('button').forEach(function(x){ x.classList.toggle('on',x.dataset.v===F[g.dataset.k]); }); });
    var n=['slot','len','terms'].filter(function(k){ return F[k]!=='any'; }).length; $('fN').textContent=n; $('fN').hidden=!n; }
  function render(){ var r=sorted(P.filter(fits));
    list.innerHTML=r.length?r.map(function(p){ var i=P.indexOf(p), a=asked[i];
      return '<div class="fp" style="--c:'+p.c+'"><div class="fp-l"><span class="fp-len tab">'+(p.len>=120?'2 h':p.len+' min')+'</span><span class="fp-g">'+p.g+'</span></div><div class="fp-m"><b>'+p.t+'</b><small>'+p.by+' · '+p.eps+'</small></div><div class="fp-t"><b>'+({cash:'Cash',share:'Revenue share',free:'Free'})[p.terms]+'</b><small>'+p.tv+'</small></div><button type="button" class="fp-b'+(a?' ok':'')+'" data-i="'+i+'">'+(a?(p.terms==='free'?'In your log':'Sent'):(p.terms==='free'?'Add it':'Request'))+'</button></div>'; }).join(''):'<p class="f-none">Nothing fits that yet. Widen the slot, the length or the search.</p>';
    $('fCount').textContent=r.length+(r.length===1?' program fits':' programs fit'); $('fShowN').textContent=r.length?'Show '+r.length+(r.length===1?' program':' programs'):'Nothing fits'; sync(); }
  function closeAll(except){ document.querySelectorAll('.fit .f-dd').forEach(function(d){ if(d===except) return; d.querySelector('.f-pop').hidden=true; d.querySelector('.f-dd-b').setAttribute('aria-expanded','false'); d.classList.remove('open'); }); }
  document.querySelectorAll('.fit .f-dd').forEach(function(d){ var b=d.querySelector('.f-dd-b'), pop=d.querySelector('.f-pop');
    b.addEventListener('click',function(e){ e.stopPropagation(); var open=pop.hidden; closeAll(d); pop.hidden=!open; d.classList.toggle('open',open); b.setAttribute('aria-expanded',open?'true':'false'); if(open){ var s=pop.querySelector('[aria-selected=true]'); if(s) s.focus(); } });
    pop.addEventListener('click',function(e){ var o=e.target.closest('[role=option]'); if(!o) return; F[d.dataset.k]=o.dataset.v; closeAll(); b.focus(); render(); });
    pop.addEventListener('keydown',function(e){ var os=[].slice.call(pop.querySelectorAll('[role=option]')), i=os.indexOf(document.activeElement); if(e.key==='ArrowDown'){ e.preventDefault(); os[Math.min(os.length-1,i+1)].focus(); } else if(e.key==='ArrowUp'){ e.preventDefault(); os[Math.max(0,i-1)].focus(); } else if(e.key==='Escape'){ closeAll(); b.focus(); } }); });
  document.addEventListener('click',function(e){ if(!e.target.closest('.f-dd')) closeAll(); });
  $('fQ').addEventListener('input',function(){ F.q=this.value; render(); });
  var sh=$('fSheet'); document.body.appendChild(sh);
  function openSheet(){ sh.hidden=false; document.documentElement.classList.add('sheet-open'); setTimeout(function(){ sh.classList.add('on'); var f=sh.querySelector('.f-x'); if(f) f.focus(); },10); }
  function closeSheet(){ sh.classList.remove('on'); document.documentElement.classList.remove('sheet-open'); setTimeout(function(){ sh.hidden=true; $('fMob').focus(); },260); }
  $('fMob').addEventListener('click',openSheet);
  sh.addEventListener('click',function(e){ if(e.target.closest('[data-close]')) closeSheet(); var b=e.target.closest('.seg2 button'); if(b){ F[b.parentNode.dataset.k]=b.dataset.v; render(); } });
  sh.addEventListener('keydown',function(e){ if(e.key==='Escape') closeSheet(); });
  $('fClear').addEventListener('click',function(){ F.slot=F.len=F.terms='any'; F.sort='fit'; render(); });
  list.addEventListener('click',function(e){ var b=e.target.closest('.fp-b'); if(!b) return; var i=+b.dataset.i; asked[i]=!asked[i]; render(); });
  render();
})();

/* ---------- escrow tick ---------- */
(function(){ var el=$('escAmt'); if(!el||RM) return; var v=1284.6, vis=false;
  new IntersectionObserver(function(e){ vis=e[0].isIntersecting; }).observe(el);
  setInterval(function(){ if(!vis||document.hidden) return; v+=[2.5,3,1.5,0.85][Math.floor(Math.random()*4)]; el.textContent='$'+v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',')+' waiting'; },2600); })();

/* ---------- latest deals feed ---------- */
(function(){ var v=$('dlV'); if(!v) return;
  var D=[['#D98A2B','24.1','REEL','picked up','Tamales for forty','30% share','2 min ago'],
    ['#5B7BE0','88.4','NITE','is carrying','Crate Talk','$3.00 an airing','9 min ago'],
    ['#2F9A72','7.1','CIVC','added','Silent Hour','free','14 min ago'],
    ['#3478C6','33.1','MESA','picked up','Late Crate','25% share','21 min ago'],
    ['#E0583A','41.1','ORNG','is carrying','Short Stack','$2.00 an airing','33 min ago']];
  var i=0;
  function show(){ var d=D[i%D.length]; i++; var old=v.firstChild; if(old){ old.classList.add('out'); setTimeout(function(){ if(old.parentNode) old.parentNode.removeChild(old); },400); }
    setTimeout(function(){ var el=document.createElement('div'); el.innerHTML='<span class="badge" style="background:'+d[0]+'">'+d[1]+'</span><span><b>'+d[2]+'</b> '+d[3]+' <b>'+d[4]+'</b> <em>· '+d[5]+' · '+d[6]+'</em></span>'; v.appendChild(el); },old?380:0); }
  show(); if(!RM) setInterval(function(){ if(!document.hidden) show(); },3400);
})();

/* ---------- what a show earns across the network ---------- */
(function(){ var st=$('rSt'); if(!st) return;
  var mode='share', COLS=['#EBA03A','#C04A9E','#D98A2B','#2F9A72','#3478C6','#E0583A','#5B7BE0','#C9709A'];
  function m(v){ return '$'+v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,','); }
  function w(v){ return '$'+Math.round(v).toLocaleString('en-US'); }
  var CS=['BEAT','REEL','MESA','ORNG','LBCH','VALE','PREP','CIVC','NITE','FLDR','VOZE','OCAT','ECHO','CORT','PASA','SURF','SKAT','TIDE','ROUT','LOFI','DUNE','PALM','MOJO','FUZZ','VINE','HALO','GLOW','ROOT','BOLT','ARCO','LUMA','FADE','RIFF','LOOP','TAPE','ZINE','PIER','YUCA','JADE','OPAL','SAGE','PINE','ROSA','CRUZ','VIBE','NOOK','MINT','SODA'];
  var NET=32, g=$('sGrid'), cells=[];
  for(var i=0;i<CS.length;i++){ var c=document.createElement('i'), ch=(2+((i*13)%66))+'.'+(1+i%3); c.style.setProperty('--k',COLS[(i*5)%COLS.length]); c.style.transitionDelay=(i%8)*14+'ms';
    c.innerHTML=i<NET?'<b>'+ch+'</b><small>'+CS[i]+'</small>':'<b>'+ch+'</b><small>Open</small>'; if(i>=NET) c.classList.add('open'); g.appendChild(c); cells.push(c); }
  function calc(){ var n=+st.value, one;
    $('vSt').textContent=n; $('oSt').textContent=n;
    if(mode==='share'){ var rev=+$('rRev').value, wt=+$('rWatch').value/100, sh=+$('rShare').value/100; one=rev*wt*sh;
      $('vRev').textContent=w(rev); $('vWatch').textContent=Math.round(wt*100)+'%'; $('vShare').textContent=Math.round(sh*100)+'%';
      $('l1').textContent='One station’s ad revenue'; $('o1').textContent=m(rev);
      $('l2').textContent='× your share of what’s watched'; $('o2').textContent=Math.round(wt*100)+'%';
      $('l3').textContent='× your revenue share'; $('o3').textContent=Math.round(sh*100)+'%'; }
    else { var a=+$('rAir').value, p=+$('rPrice').value, mo=a*52/12; one=mo*p*.95;
      $('vAir').textContent=a; $('vPrice').textContent=m(p);
      $('l1').textContent='Airings a month, one station'; $('o1').textContent=(Math.round(mo*10)/10).toString();
      $('l2').textContent='× your price per airing'; $('o2').textContent=m(p);
      $('l3').textContent='Less our 5%'; $('o3').textContent='−'+m(mo*p*.05); }
    var tot=one*n; $('oOne').textContent=m(one); $('oPay').textContent=m(tot); $('oYr').textContent='About '+w(tot*12)+' a year';
    cells.forEach(function(c,k){ c.classList.toggle('on',k<n); if(k>=NET) c.lastChild.textContent=k<n?'New':'Open'; });
    ['rSt','rRev','rWatch','rShare','rAir','rPrice'].forEach(function(id){ var e=$(id); e.style.setProperty('--p',((e.value-e.min)/(e.max-e.min)*100)+'%'); }); }
  ['rSt','rRev','rWatch','rShare','rAir','rPrice'].forEach(function(id){ $(id).addEventListener('input',calc); });
  var seg=$('rMode'); seg.addEventListener('click',function(e){ var b=e.target.closest('button'); if(!b) return; mode=b.dataset.v;
    seg.querySelectorAll('button').forEach(function(x){ x.classList.toggle('on',x===b); });
    document.querySelectorAll('#earn [data-m]').forEach(function(x){ x.hidden=x.dataset.m!==mode; }); calc(); });
  calc(); })();
