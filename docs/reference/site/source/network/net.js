
/* ---------- the network's stations, by market ---------- */
var MK=[
 {id:'ie',n:'Inland Empire',d:'Riverside and San Bernardino counties',st:'Opening first',on:1,c:'#5B7BE0',
  s:[['7.1','CIVC','Civic Channel','Run by a residents’ group in Riverside','#2F9A72','Listed',['Council Watch','Neighborhood Hour','Library Talks']],
     ['12.1','BEAT','Beat Tape TV','Run by a crate digger in Pomona','#C04A9E','Station',['Late Crate','Crate Session','Overnight Crates']],
     ['18.1','SAZN','Sazón','A family kitchen in Fontana, run by us until they claim it','#E0583A','Claimable',['Tamales for forty','Sunday Pozole','Salsa School']],
     ['24.1','REEL','Saturday Reel','Run by a film club in Redlands','#D98A2B','Station',['Saturday Reel','Short Stack','Projector Room']],
     ['31.1','PREP','Prep Sports','Run by high-school students in Upland','#3478C6','Station',['Game Film','Prep Football Live','Locker Room']],
     ['60.1','OCAT','Classic Matinee','Public-domain films from the network’s catalog','#9A9CAB','Catalog',['Classic Matinee','Silent Hour','Serial Saturday']],
     ['88.4','NITE','Night Shift Radio','Run by two DJs in San Bernardino','#5B7BE0','Station',['Night Shift','Request Line','Dawn Patrol']],
     ['99.2','LOFI','Lofi Hours','The network’s own radio, beats to study to','#7a6ad8','Catalog',['Lofi Hours','Rain Tapes','Late Study']]]},
 {id:'la',n:'Los Angeles',d:'Los Angeles County',st:'Next',on:0,c:'#C04A9E',
  s:[['19.1','LBCH','Long Beach Sound','Run by a record shop in Long Beach','#2F9A72','Station',['Shop Sessions','Harbor Hour','Crate Night']],
     ['22.1','ECHO','Echo Park Sessions','Run by a venue collective in Echo Park','#C04A9E','Station',['Live at the Lake','Soundcheck','Encore']],
     ['36.1','CORT','Courtside','Run by a pickup league in Inglewood','#3478C6','Station',['Saturday Runs','Pickup Live','Tape Room']],
     ['45.1','PASA','Pasadena Access','Public access, from the city’s own stream','#9A9CAB','Listed',['City Council','Arts Desk','Community Bulletin']],
     ['96.6','SURF','Surf Report Radio','Run by a surf shop in Venice','#EBA03A','Station',['Dawn Patrol','Swell Watch','Sunset Set']]]},
 {id:'oc',n:'Orange County',d:'Orange County',st:'Next',on:0,c:'#E0583A',
  s:[['14.1','SKAT','Skate Parks','Run by a skate shop in Costa Mesa','#E0583A','Station',['Park Sessions','Bowl Jam','Video Night']],
     ['41.1','ORNG','Orange Talk','Run by a podcast studio in Anaheim','#EBA03A','Station',['Morning Desk','Open Line','The Late Read']],
     ['101.4','TIDE','Tide Radio','Run by a beach town collective','#5B7BE0','Station',['High Tide','Low Tide','Night Swim']]]},
 {id:'hd',n:'High Desert',d:'Victorville to the Mojave',st:'Opening first',on:1,c:'#C9709A',
  s:[['33.1','MESA','Mesa Music','Run by a rehearsal space in Victorville','#3478C6','Station',['Garage Hour','Desert Demos','Late Set']],
     ['66.1','ROUT','Route 66 Reel','Run by a drive-in in Barstow','#D98A2B','Station',['Drive-in Double','B-Side Cinema','Midnight Reel']],
     ['92.0','FLDR','Mojave Field Recordings','Desert sound, shared under CC BY','#C9709A','Station',['Wind at Amboy','Joshua Tree, 4 am','Kelso Dunes']]]}];

/* ---------- tuner ---------- */
(function(){
  var T=$('tuner'); if(!T) return;
  var mi=0, k=0, scan=!RM, timer=null, lastTv=.15, lastFm=.2;
  function fm(n){ return parseFloat(n)>=88; }
  function pos(n){ var v=parseFloat(n); return fm(n)?(v-88)/20:(v-2)/68; }
  function ticks(el,a,b,step,maj,toPos){ var h=''; for(var v=a;v<=b+1e-6;v+=step){ var m=Math.abs(v/maj-Math.round(v/maj))<1e-6; h+='<i class="'+(m?'m':'')+'" style="left:'+(toPos(v)*100).toFixed(2)+'%"></i>'; } el.innerHTML=h; }
  ticks($('bTvK'),2,69,1,10,function(v){ return (v-2)/68; }); ticks($('bFmK'),88,108,.4,2,function(v){ return (v-88)/20; });
  var seg=$('tnMk'); seg.innerHTML=MK.map(function(m,i){ return '<button type="button" data-i="'+i+'"'+(i===0?' class="on"':'')+'>'+m.n+'</button>'; }).join('');
  function list(){ return MK[mi].s.slice().sort(function(a,b){ return parseFloat(a[0])-parseFloat(b[0]); }); }
  function markers(){ var L=list(), tv='', f='';
    L.forEach(function(s,i){ var b='<button type="button" data-k="'+i+'" style="left:'+(pos(s[0])*100).toFixed(2)+'%;--k:'+s[4]+'" aria-label="'+s[0]+' '+s[1]+'"></button>'; if(fm(s[0])) f+=b; else tv+=b; });
    $('bTvS').innerHTML=tv; $('bFmS').innerHTML=f; }
  function tune(){ var L=list(); k=(k+L.length)%L.length; var s=L[k], isFm=fm(s[0]), p=pos(s[0]);
    var nb=$('tnNum'); nb.parentNode.classList.remove('flick'); void nb.offsetWidth; nb.parentNode.classList.add('flick');
    nb.textContent=s[0]; $('tnBand').textContent=isFm?'FM':'TV'; $('tnCs').textContent=s[1]; $('tnName').textContent=s[2]; $('tnWho').textContent=s[3];
    var hr=new Date().getHours(); $('tnNow').textContent=s[6][hr%s[6].length]; $('tnKind').textContent=s[5]; T.style.setProperty('--c',s[4]);
    if(isFm){ lastFm=p; } else { lastTv=p; }
    $('ndTv').style.left=(lastTv*100)+'%'; $('ndFm').style.left=(lastFm*100)+'%'; $('ndTv').classList.toggle('idle',isFm); $('ndFm').classList.toggle('idle',!isFm);
    T.querySelectorAll('.bs button').forEach(function(b){ b.classList.toggle('on',+b.dataset.k===k); }); }
  function setScan(v){ scan=v; var b=$('tnScan'); b.classList.toggle('on',v); b.setAttribute('aria-pressed',v?'true':'false'); b.lastChild.textContent=v?'Scanning':'Scan'; }
  var vis=true; new IntersectionObserver(function(e){ vis=e[0].isIntersecting; }).observe(T);
  setInterval(function(){ if(scan&&vis&&!document.hidden){ k++; tune(); } },3200);
  seg.addEventListener('click',function(e){ var b=e.target.closest('button'); if(!b) return; mi=+b.dataset.i; k=0; seg.querySelectorAll('button').forEach(function(x){ x.classList.toggle('on',x===b); }); markers(); tune(); });
  T.addEventListener('click',function(e){ var b=e.target.closest('.bs button'); if(!b) return; k=+b.dataset.k; setScan(false); tune(); });
  $('tnPrev').addEventListener('click',function(){ k--; setScan(false); tune(); });
  $('tnNext').addEventListener('click',function(){ k++; setScan(false); tune(); });
  $('tnScan').addEventListener('click',function(){ setScan(!scan); });
  markers(); k=1; tune(); if(RM) setScan(false);
})();

/* ---------- call sign check ---------- */
(function(){
  var inp=$('csIn'); if(!inp) return;
  var BRANDS=['ABC','CBS','NBC','NPR','PBS','FCC','FOX','CNN','HBO','ESPN','MTV','BBC','AMC','TBS','TNT','CSPAN','UPN','ION','HGTV','WGN','KTLA','KCAL','TCM','BET','QVC'], DENY=['ALERT','EAS','SOS'];
  var TAKEN={}; MK.forEach(function(m){ m.s.forEach(function(s){ TAKEN[s[1]]=s[0]+' in '+m.n; }); });
  var used={}; MK[0].s.forEach(function(s){ used[s[0]]=1; });
  function freeNum(cs){ var h=0; for(var i=0;i<cs.length;i++) h=(h*31+cs.charCodeAt(i))%997; for(var t=0;t<70;t++){ var n=2+((h+t*7)%66), c=n+'.'+(1+(h%4)); if(!used[c]) return c; } return '50.1'; }
  function check(){ var v=inp.value.toUpperCase().replace(/\s/g,''); if(inp.value!==v) inp.value=v;
    var letters=/^[A-Z]{3,5}$/.test(v), kw=v.length===4&&/^[KW]/.test(v), brand=BRANDS.indexOf(v)>=0||DENY.indexOf(v)>=0, taken=TAKEN[v];
    var C=[[letters,'Three to five letters, A to Z'],[!kw,'Not four letters starting with K or W'],[!brand,'Not a network, a brand or an alert word'],[!taken,taken?'Already '+taken:'Not on the dial yet']];
    $('csCk').innerHTML=C.map(function(c){ return '<li class="'+(c[0]?'':'no')+'"><i>'+(c[0]?'✓':'×')+'</i>'+c[1]+'</li>'; }).join('');
    var ok=v.length&&C.every(function(c){ return c[0]; }), o=$('csOut');
    o.className='nw-csout '+(ok?'ok':'no');
    o.textContent=!v.length?'Type a call sign to check it.':ok?v+' is free. Reserve it and we hold it for 120 days.':kw?'Too close to a real FCC call sign. Try three or five letters.':!letters?'Letters only, three to five of them.':brand?'That one belongs to someone else.':v+' is taken. Try another.';
    document.querySelector('.nw-csch').textContent=ok?freeNum(v):'--.-'; }
  inp.addEventListener('input',check); check();
})();

/* ---------- follow the dollar ---------- */
(function(){
  var seg=$('fdSeg'); if(!seg) return;
  var D=[{a:90,b:10,p:1,l:'To the station',n:'A business booked a spot on its own, in the spot market or straight with the station. The station keeps $90.'},
    {a:80,b:20,p:1,l:'To the station',n:'Our team found the advertiser, or our studio made the spot. We keep more because we did more of the work.'},
    {a:95,b:5,p:0,l:'To the station',n:'A viewer pledged to keep the station on the air. Card fees come off at cost; the rest is the station’s, less our 5%.'},
    {a:95,b:5,p:0,l:'To the maker',n:'A station paid to carry someone else’s show. The maker gets $95 every time it airs. Revenue shares between stations cost nothing extra.'}];
  var bar=$('fdBar'), A=bar.querySelector('.fa'), B=bar.querySelector('.fb'), Cc=bar.querySelector('.fc');
  function show(i){ var d=D[i], pool=d.p?d.b*.25:0;
    A.style.flex=d.a; B.style.flex=d.b-pool; Cc.style.flex=pool||.0001; Cc.style.display=pool?'':'none';
    A.firstChild.textContent='$'+d.a; B.firstChild.textContent=d.b>=10?'$'+d.b:''; Cc.firstChild.textContent='';
    $('fdA').textContent=d.l; $('fdAv').textContent='$'+d.a.toFixed(2); $('fdBv').textContent='$'+d.b.toFixed(2);
    document.querySelector('.fd-r:last-child b').textContent=d.p?'Shared monthly':'Not from this kind';
    $('fdNote').textContent=d.n; }
  seg.addEventListener('click',function(e){ var b=e.target.closest('button'); if(!b) return; seg.querySelectorAll('button').forEach(function(x){ x.classList.toggle('on',x===b); }); show(+b.dataset.i); });
  show(0);
})();

/* ---------- locks: approve, wait in public, done ---------- */
(function(){
  var L=document.querySelectorAll('.lk2'); if(!L.length) return;
  if(RM){ L.forEach(function(l){ l.classList.add('go'); }); return; }
  L.forEach(function(l){ var t=null;
    new IntersectionObserver(function(e){ if(e[0].isIntersecting){ if(t) return; l.classList.add('go'); t=setInterval(function(){ l.classList.remove('go'); setTimeout(function(){ l.classList.add('go'); },700); },7000); } else { clearInterval(t); t=null; l.classList.remove('go'); } },{threshold:.3}).observe(l); });
})();

/* ---------- markets list ---------- */
(function(){ var el=$('mkList'); if(!el) return;
  el.innerHTML=MK.map(function(m){ return '<div class="mk-r"><i class="'+(m.on?'':'soon')+'" style="--k:'+m.c+'"></i><div><b>'+m.n+'</b><small>'+m.d+' · '+m.s.length+' example stations</small></div><em class="'+(m.on?'on':'')+'">'+m.st+'</em></div>'; }).join(''); })();
