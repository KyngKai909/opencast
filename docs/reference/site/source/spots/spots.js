
/* ---------- money helpers ---------- */
function money(v){ return '$'+v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,','); }
function num(v){ return Math.round(v).toLocaleString('en-US'); }

/* ---------- hero: the break, live (control room) ---------- */
(function(){
  var cv=$('spTv'); if(!cv) return;
  var x=cv.getContext('2d'), W=320, H=180, FD='"Big Shoulders Display", Impact, sans-serif', FT='"Instrument Sans", Arial, sans-serif', FO='"VT323", monospace';
  x.scale(2,2);
  var vis=true, last=0, t0=performance.now();
  new IntersectionObserver(function(e){ vis=e[0].isIntersecting; }).observe(cv);
  function ease(v){ v=clamp(v); return 1-Math.pow(1-v,3); }
  function qr(x0,y0,s,ink,bg){ var n=21, m=s/n; x.fillStyle=bg; x.fillRect(x0-m,y0-m,s+2*m,s+2*m); x.fillStyle=ink;
    for(var i=0;i<n;i++) for(var j=0;j<n;j++){ var f=(i<7&&j<7)||(i<7&&j>13)||(i>13&&j<7); if(f){ var a=i%14, b=j%14; if(i>13) a=i-14; if(j>13) b=j-14; if(a===0||a===6||b===0||b===6||(a>1&&a<5&&b>1&&b<5)) x.fillRect(x0+j*m,y0+i*m,m+.3,m+.3); }
      else if(((i*7+j*13+i*j)*2654435761>>>7)%3===0) x.fillRect(x0+j*m,y0+i*m,m+.3,m+.3); } }
  function spot(k,T){
    if(k<9){
      var g=x.createLinearGradient(0,0,W,H); g.addColorStop(0,'#2a0f08'); g.addColorStop(1,'#7a2a14'); x.fillStyle=g; x.fillRect(0,0,W,H);
      var r=x.createRadialGradient(W*.7,H*.55,10,W*.7,H*.55,150); r.addColorStop(0,'rgba(255,170,90,.55)'); r.addColorStop(1,'rgba(255,170,90,0)'); x.fillStyle=r; x.fillRect(0,0,W,H);
      x.fillStyle='#1a0905'; x.fillRect(0,H*.78,W,H*.22);
      var z=1+k*.012, cx=W*.7, cy=H*.62; x.save(); x.translate(cx,cy); x.scale(z,z);
      x.fillStyle='#f3e7d6'; x.beginPath(); x.moveTo(-34,-30); x.lineTo(34,-30); x.lineTo(26,30); x.lineTo(-26,30); x.closePath(); x.fill();
      x.strokeStyle='#f3e7d6'; x.lineWidth=6; x.beginPath(); x.arc(38,-2,12,-1.3,1.3); x.stroke();
      x.fillStyle='#c97a3a'; x.beginPath(); x.ellipse(0,-30,34,7,0,0,7); x.fill();
      x.fillStyle='#f6dcc0'; x.beginPath(); x.ellipse(0,-30,16,3.4,0,0,7); x.fill();
      x.fillStyle='#E0583A'; x.fillRect(-27,-4,54,10);
      x.strokeStyle='rgba(255,236,214,.35)'; x.lineWidth=3; x.lineCap='round';
      for(var s=0;s<3;s++){ x.beginPath(); for(var y=0;y<46;y+=2){ var px=-14+s*14+Math.sin(y*.18+T*2.2+s)*5, py=-40-y-((T*14+s*9)%10); y===0?x.moveTo(px,py):x.lineTo(px,py); } x.stroke(); }
      x.restore();
      x.fillStyle='#d98a3a'; x.beginPath(); x.ellipse(W*.43,H*.8,22,8,0,0,7); x.fill(); x.fillStyle='#b8632a'; x.beginPath(); x.ellipse(W*.43,H*.78,18,5,0,0,7); x.fill();
      var a1=ease((k-.4)/.8), a2=ease((k-1.1)/.8);
      x.globalAlpha=a1; x.fillStyle='#fff3e2'; x.font='italic 800 13px '+FT; x.textAlign='left'; x.fillText('Orange Street Coffee',18+(1-a1)*-12,30);
      x.globalAlpha=a2; x.font='900 46px '+FD; x.fillText('PUMPKIN',16+(1-a2)*-20,82); x.fillStyle='#ffb27a'; x.fillText('LATTE',16+(1-a2)*-30,124);
      var a3=ease((k-4)/.7); x.globalAlpha=a3; x.fillStyle='#fff3e2'; x.font='600 11px '+FT; x.fillText('Back for fall. Roasted on Orange St.',18,146);
      x.globalAlpha=1;
    } else {
      var p=ease((k-9)/.6);
      x.fillStyle='#E0583A'; x.fillRect(0,0,W,H);
      x.fillStyle='#2a0f08'; x.fillRect(0,0,W*(1-p),H);
      x.globalAlpha=p; x.fillStyle='#1b0b06'; x.font='700 9px '+FT; x.textAlign='left';
      x.fillText('SHOW THIS CODE',18,48); x.fillStyle='#fff6e8'; x.font='900 50px '+FD; x.fillText('PUMPKIN',16,96);
      x.fillStyle='#1b0b06'; x.font='600 12px '+FT; x.fillText('A free pastry with a latte',18,118);
      x.font='700 8.5px '+FT; x.fillText('ORANGE STREET COFFEE  ·  1840 ORANGE ST',18,156);
      qr(W-104,40,78,'#1b0b06','#fff6e8'); x.globalAlpha=1;
    }
  }
  function card(bg,fg,big,small,u,acc){ x.fillStyle=bg; x.fillRect(0,0,W,H);
    if(acc){ x.fillStyle=acc; for(var i=-4;i<20;i++){ x.fillRect(i*24+((u*60)%24),H-18,12,18); } }
    var a=ease(u*3); x.globalAlpha=a; x.textAlign='center'; x.fillStyle=fg; x.font='900 40px '+FD; x.fillText(big,W/2,H/2+4+(1-a)*10);
    x.font='600 11px '+FT; x.globalAlpha=a*.85; x.fillText(small,W/2,H/2+28); x.globalAlpha=1; x.textAlign='left'; }
  var BEAT=S[1];
  var SEG=[
    {d:4,k:'prog',l:'Late Crate',c:'#C04A9E',chip:'Program'},
    {d:2,k:'bump',l:'Bumper',c:'#7a3b8f',chip:'Bumper'},
    {d:4,k:'jun',l:'Juniper',c:'#2F9A72',chip:'Spot, :15'},
    {d:7,k:'you',l:'Your spot',c:'#F3EAD9',chip:'Your spot, :15'},
    {d:4,k:'red',l:'Redlands',c:'#3478C6',chip:'Spot, :30'},
    {d:2,k:'id',l:'ID',c:'#E0583A',chip:'Station ID'},
    {d:3,k:'prog',l:'Late Crate',c:'#C04A9E',chip:'Program'}];
  var TOT=0; SEG.forEach(function(s){ s.s=TOT; TOT+=s.d; });
  $('crSegs').innerHTML=SEG.map(function(s){ return '<span class="cr-sg'+(s.k==='you'?' you':'')+'" style="flex:'+s.d+';--k:'+s.c+'"><em>'+s.l+'</em></span>'; }).join('');
  var segEls=$('crSegs').children, tot=33.02, cu=9, settled=false, curI=-1, base=new Date(); base.setHours(20,14,2,0);
  function clockAt(t){ var d=new Date(base.getTime()+t*1000*2.1), h=d.getHours(), m=d.getMinutes(), s=d.getSeconds(); return (h%12||12)+':'+(m<10?'0':'')+m+':'+(s<10?'0':'')+s; }
  function frame(T){
    var t=T%TOT, i=0; while(i<SEG.length-1&&t>=SEG[i].s+SEG[i].d) i++;
    var sg=SEG[i], u=(t-sg.s)/sg.d;
    if(sg.k==='prog') draw(x,W,H,T,BEAT);
    else if(sg.k==='bump') card('#140F24','#E9FFE8','12.1 BEAT','We’ll be right back',u,'#7a3b8f');
    else if(sg.k==='jun') card('#0c2b28','#5ff2d2','Juniper','Fades. Beard trims. Orange St.',u,'#e8402f');
    else if(sg.k==='red') card('#f1e6d2','#c8321f','REDLANDS HARDWARE','Since 1962. Everything for the house.',u,null);
    else if(sg.k==='id') card('#C04A9E','#ffffff','BEAT 12.1','Beat Tape TV · Pomona',u,null);
    else spot(u*15,T);
    if(i!==curI){ curI=i; for(var j=0;j<segEls.length;j++) segEls[j].classList.toggle('on',j===i); var ch=$('crChip'); ch.textContent=sg.chip; ch.classList.toggle('you',sg.k==='you');
      $('spair').classList.toggle('is-you',sg.k==='you');
      if(sg.k==='you'){ settled=false; $('crTunS').textContent='Counting the room'; }
      if(i===SEG.length-1||sg.k==='red'){ if(!settled&&sg.k==='red'){ settled=true; tot+=2.5; if(Math.random()<.4) cu++; $('crTot').textContent=money(tot); $('crCu').textContent=cu+' customers from the code'; $('crTunS').textContent='Settled. $1.50 back to your balance'; var f=$('crCost'); f.classList.remove('bump'); void f.offsetWidth; f.classList.add('bump'); } } }
    if(sg.k==='you'){ var n=Math.round(312*ease(u*1.15)); $('crTun').textContent=num(n); $('crCost').textContent=money(n*8/1000); }
    else if(i<3){ $('crTun').textContent='0'; $('crCost').textContent='$0.00'; if(i===0) $('crTunS').textContent='Waiting for the break'; }
    $('crPh').style.left=(t/TOT*100)+'%'; $('crClock').textContent=clockAt(t);
  }
  (function loop(now){ requestAnimationFrame(loop); if(!vis||document.hidden||now-last<45) return; last=now; frame(RM?13.5:(now-t0)/1000); })(0);
  frame(RM?13.5:0);
})();

/* ---------- hero: just booked ---------- */
(function(){ var v=$('bkV'); if(!v) return;
  var D=[['#C04A9E','12.1','Juniper Barber Co.','is sponsoring','Late Crate','$120 a month','3 min ago'],
    ['#E0583A','18.1','Redlands Hardware','ordered a :30 from','SAZN','quoted $180','8 min ago'],
    ['#2F9A72','7.1','Cuevas Bakery','booked a :15 on','CIVC and 4 more','$6 per 1,000','12 min ago'],
    ['#5B7BE0','88.4','Sole Shop, online','booked a :30 in','Inland Empire','$9 per 1,000','19 min ago'],
    ['#D98A2B','24.1','Magnolia Books','is sponsoring','Saturday Reel','$200 a month','26 min ago']];
  var i=0;
  function show(){ var d=D[i%D.length]; i++; var old=v.firstChild; if(old){ old.classList.add('out'); setTimeout(function(){ if(old.parentNode) old.parentNode.removeChild(old); },400); }
    setTimeout(function(){ var el=document.createElement('div'); el.innerHTML='<span class="badge" style="background:'+d[0]+'">'+d[1]+'</span><span><b>'+d[2]+'</b> '+d[3]+' <b>'+d[4]+'</b> <em>· '+d[5]+' · '+d[6]+'</em></span>'; v.appendChild(el); },old?380:0); }
  show(); if(!RM) setInterval(function(){ if(!document.hidden) show(); },3600);
})();

/* ---------- planner ---------- */
(function(){
  var list=$('pList'); if(!list) return;
  var KINDS=['Music','Film','Food','Sports','Civic','Talk','Radio'], TIMES=[['m','Morning'],['d','Daytime'],['p','Prime'],['l','Late night']], MKTS=['Inland Empire','High Desert','Orange County','Long Beach','Coachella Valley'];
  var P=[
    {n:'7.1',cs:'CIVC',c:'#2F9A72',k:'Civic',city:'Riverside',mk:'Inland Empire',mi:2,aud:140,t:{m:2,d:4,p:3,l:1}},
    {n:'88.4',cs:'NITE',c:'#5B7BE0',k:'Radio',city:'San Bernardino',mk:'Inland Empire',mi:9,aud:180,t:{m:2,d:2,p:3,l:5}},
    {n:'18.1',cs:'SAZN',c:'#E0583A',k:'Food',city:'Fontana',mk:'Inland Empire',mi:11,aud:260,t:{m:3,d:4,p:4,l:1}},
    {n:'24.1',cs:'REEL',c:'#D98A2B',k:'Film',city:'Redlands',mk:'Inland Empire',mi:13,aud:300,t:{m:0,d:2,p:4,l:4}},
    {n:'60.1',cs:'OCAT',c:'#9A9CAB',k:'Film',city:'Network catalog',mk:'Inland Empire',mi:15,aud:210,t:{m:2,d:3,p:3,l:3}},
    {n:'31.1',cs:'PREP',c:'#3478C6',k:'Sports',city:'Upland',mk:'Inland Empire',mi:22,aud:520,t:{m:0,d:2,p:5,l:1}},
    {n:'12.1',cs:'BEAT',c:'#C04A9E',k:'Music',city:'Pomona',mk:'Inland Empire',mi:24,aud:380,t:{m:0,d:2,p:4,l:5}},
    {n:'41.1',cs:'ORNG',c:'#E0583A',k:'Talk',city:'Anaheim',mk:'Orange County',mi:31,aud:340,t:{m:3,d:3,p:3,l:1}},
    {n:'33.1',cs:'MESA',c:'#3478C6',k:'Music',city:'Victorville',mk:'High Desert',mi:46,aud:220,t:{m:1,d:2,p:4,l:3}},
    {n:'19.1',cs:'LBCH',c:'#2F9A72',k:'Music',city:'Long Beach',mk:'Long Beach',mi:52,aud:300,t:{m:1,d:2,p:4,l:4}},
    {n:'92.0',cs:'FLDR',c:'#C9709A',k:'Radio',city:'Mojave',mk:'High Desert',mi:58,aud:60,t:{m:1,d:1,p:1,l:3}},
    {n:'27.1',cs:'VALE',c:'#EBA03A',k:'Film',city:'Palm Desert',mk:'Coachella Valley',mi:66,aud:190,t:{m:1,d:2,p:3,l:2}},
    {n:'104.2',cs:'VOZE',c:'#EBA03A',k:'Radio',city:'Coachella',mk:'Coachella Valley',mi:72,aud:240,t:{m:4,d:3,p:2,l:1}}];
  var F={where:'shop',mi:12,mk:{'Inland Empire':1,'Long Beach':1},kind:{},time:{},rk:'k',rate:8,bud:300,cap:15};
  KINDS.forEach(function(k){ F.kind[k]=1; }); TIMES.forEach(function(t){ F.time[t[0]]=1; });
  function chips(el,items,obj){ el.innerHTML=items.map(function(it){ var v=Array.isArray(it)?it[0]:it, l=Array.isArray(it)?it[1]:it; return '<button type="button" data-v="'+v+'" aria-pressed="'+(obj[v]?'true':'false')+'">'+l+'</button>'; }).join('');
    el.addEventListener('click',function(e){ var b=e.target.closest('button'); if(!b) return; var v=b.dataset.v; obj[v]=obj[v]?0:1; b.setAttribute('aria-pressed',obj[v]?'true':'false'); calc(); }); }
  chips($('pKind'),KINDS,F.kind); chips($('pTime'),TIMES,F.time); chips($('pMkt'),MKTS,F.mk);
  function seg(id,key,after){ var g=$(id); g.addEventListener('click',function(e){ var b=e.target.closest('button'); if(!b) return; F[key]=b.dataset.v; g.querySelectorAll('button').forEach(function(x){ x.classList.toggle('on',x===b); }); if(after) after(); calc(); }); }
  seg('pWhere','where',function(){ var on=F.where==='shop'; $('pDistW').hidden=!on; $('pMktW').hidden=on; });
  seg('pKindR','rk',function(){ var r=$('pRate'); if(F.rk==='k'){ r.min=2; r.max=20; r.step=.5; r.value=8; $('lRate').textContent='Rate per 1,000 tuned in'; } else { r.min=.5; r.max=8; r.step=.25; r.value=2.5; $('lRate').textContent='Rate per airing'; } });
  function chance(s){ var v=F.rk==='k'?(F.rate-2)/9:(F.rate/(s.aud*8/1000)-.3)/1.1; return clamp(.12+v*.85,.08,.97); }
  function costOf(s){ return F.rk==='k'?s.aud*F.rate/1000:F.rate; }
  var prev={};
  function set(id,txt){ var e=$(id); if(e.textContent!==txt){ e.textContent=txt; if(prev[id]!==undefined){ e.classList.remove('flash'); void e.offsetWidth; e.classList.add('flash'); } } prev[id]=txt; }
  function calc(){
    F.mi=+$('pDist').value; F.rate=+$('pRate').value; F.bud=+$('pBud').value; F.cap=+$('pCap').value;
    if(F.cap>F.bud){ F.cap=F.bud; }
    $('vDist').textContent=F.mi+' miles'; $('vRate').textContent=money(F.rate); $('vBud').textContent='$'+F.bud.toLocaleString('en-US'); $('vCap').textContent='$'+F.cap;
    ['pDist','pRate','pBud','pCap'].forEach(function(id){ var e=$(id); e.style.setProperty('--p',((e.value-e.min)/(e.max-e.min)*100)+'%'); });
    var inR=[], outR=[];
    P.forEach(function(s){ var why='';
      if(F.where==='shop'&&s.mi>F.mi) why='Farther than '+F.mi+' mi';
      else if(F.where==='online'&&!F.mk[s.mk]) why='Not in your markets';
      else if(!F.kind[s.k]) why='Not a kind you picked';
      var slots=0; TIMES.forEach(function(t){ if(F.time[t[0]]) slots+=s.t[t[0]]; });
      if(!why&&!slots) why='No breaks at those times';
      var p=chance(s), ad=slots*p; (why?outR:inR).push({s:s,why:why,ad:ad,p:p,cost:costOf(s)}); });
    var ad=0, tun=0, spend=0, pk=0;
    inR.forEach(function(r){ ad+=r.ad; tun+=r.ad*r.s.aud; spend+=r.ad*r.cost; pk+=r.p; });
    var scale=spend>F.cap?F.cap/spend:1; ad*=scale; tun*=scale; spend*=scale;
    var days=spend>0?F.bud/spend:0;
    set('oSt',String(inR.length)); set('oAd',ad>=10?String(Math.round(ad)):ad.toFixed(1)); set('oTd',num(tun)); set('oDays',spend>0?(days>=90?'90+ days':Math.max(1,Math.round(days))+(Math.round(days)===1?' day':' days')):'—');
    var avg=inR.length?pk/inR.length:0; $('pkI').style.width=Math.round(avg*100)+'%';
    $('pkL').textContent=!inR.length?'No one yet':avg>.75?'Most will':avg>.5?'Many will':avg>.3?'Some will':'Few will';
    inR.sort(function(a,b){ return b.ad-a.ad; });
    var show=inR.slice(0,6), fill=outR.slice(0,Math.max(0,6-show.length));
    var h=show.map(function(r){ var s=r.s; return '<div class="pr" style="--c:'+s.c+'"><span class="badge" style="background:'+s.c+'">'+s.n+'</span><div class="pr-id"><b>'+s.cs+'</b><small>'+s.k+' · '+s.city+'</small></div><span class="d">'+(F.where==='shop'?s.mi+' mi':s.mk)+'<small>about '+num(s.aud)+' a spot</small></span><span class="v"><b>'+money(r.cost)+'</b><small>'+(r.ad*scale).toFixed(1)+' a day</small></span></div>'; }).join('');
    if(inR.length>6) h+='<div class="pr more" style="--c:rgb(243 234 217 / .14)"><span></span><div class="pr-id"><small>and '+(inR.length-6)+' more that fit</small></div></div>';
    h+=fill.map(function(r){ var s=r.s; return '<div class="pr out"><span class="badge" style="background:'+s.c+'">'+s.n+'</span><div class="pr-id"><b>'+s.cs+'</b><small>'+r.why+'</small></div><span class="d">'+(F.where==='shop'?s.mi+' mi':s.mk)+'</span><span class="v"><small>Won’t air</small></span></div>'; }).join('');
    list.innerHTML=h||'<p class="pl-none">Nothing fits yet. Widen the distance or pick more kinds of station.</p>';
    $('pNote').textContent=scale<1?'Held to your most per day of $'+F.cap+'. Raise it to air more often.':'Estimates from last month’s viewing. Stations, viewers and costs here are examples.';
  }
  ['pDist','pRate','pBud','pCap'].forEach(function(id){ $(id).addEventListener('input',calc); });
  calc();
})();

/* ---------- receipt ---------- */
(function(){
  var L=$('rcL'); if(!L) return;
  var A=[
    {b:['#C04A9E','12.1','BEAT'],w:'Late Crate · Tue, 8:14 pm',held:4,lines:[['Tuned in on the dial','268'],['Tuned in on YouTube, through the station’s relay','44']],billed:312,cost:2.5,
     bar:[[268,'#C04A9E','On the dial'],[44,'#E0583A','YouTube']],s:['$4.00 held at 8:13 pm','312 people tuned in','$2.50 paid, $1.50 back'],
     note:'A normal airing. 312 people tuned in, and at $8 per 1,000 that’s $2.50. The rest of the hold went straight back to your balance.'},
    {b:['#D98A2B','24.1','REEL'],w:'Saturday Reel · Sat, 9:02 pm',held:4,lines:[['Tuned in on the dial','301'],['Tuned in on YouTube, with a location','37'],['On YouTube, no location given','21',1]],billed:338,cost:2.7,
     bar:[[301,'#D98A2B','On the dial'],[37,'#E0583A','YouTube'],[21,'','Not billed']],s:['$4.00 held at 9:01 pm','338 counted, 21 not','$2.70 paid, $1.30 back'],
     note:'YouTube didn’t say where 21 of its viewers were, so they weren’t billed. Relay viewers count only when the platform places them in your area.'},
    {b:['#5B7BE0','88.4','NITE'],w:'Night Shift · Fri, 11:40 pm',held:2,lines:[['Listening when it started','190',1],['Cut off at 0:09 of :15','Live hand-off']],billed:0,cost:0,
     bar:[[190,'','Not billed']],s:['$2.00 held at 11:39 pm','Cut short at 0:09','$0.00 paid, $2.00 back'],
     note:'The DJs went live nine seconds into your spot. An airing that’s cut short costs nothing, so the whole hold came back.'}];
  function show(i){ var a=A[i];
    var h='<div class="rc-hd"><span class="badge" style="background:'+a.b[0]+'">'+a.b[1]+'</span><div><b>'+a.b[2]+' · Pumpkin latte, :15</b><small>'+a.w+'</small></div></div>';
    h+='<div class="rl"><span>Held before it aired</span><b>'+money(a.held)+'</b></div>';
    a.lines.forEach(function(l,k){ h+='<div class="rl sub'+(l[2]?' x':'')+'" style="animation-delay:'+(k*60+60)+'ms"><span>'+l[0]+'</span><b>'+l[1]+'</b></div>'; });
    h+='<div class="rl" style="animation-delay:220ms"><span>Billed: '+num(a.billed)+' × $8 per 1,000</span><b>'+money(a.cost)+'</b></div>';
    h+='<div class="rl back" style="animation-delay:280ms"><span>Back to your balance</span><b>'+money(a.held-a.cost)+'</b></div>';
    h+='<div class="rl tot" style="animation-delay:340ms"><span>This airing cost</span><b class="tab">'+money(a.cost)+'</b></div>';
    L.innerHTML=h;
    ['rcS1','rcS2','rcS3'].forEach(function(id,k){ $(id).textContent=a.s[k]; });
    $('vwBar').innerHTML=a.bar.map(function(b){ return '<i class="'+(b[1]?'':'nb')+'" style="flex:'+b[0]+';--k:'+b[1]+'">'+num(b[0])+'</i>'; }).join('');
    $('vwLg').innerHTML=a.bar.map(function(b){ return '<span><i class="'+(b[1]?'':'nb')+'" style="--k:'+b[1]+'"></i>'+b[2]+'</span>'; }).join('');
    $('rcNote').textContent=a.note; }
  var steps=$('rcSteps').children, st=0;
  function stepTick(){ for(var j=0;j<3;j++) steps[j].classList.toggle('on',j===st); st=(st+1)%3; }
  stepTick(); if(!RM) setInterval(function(){ if(!document.hidden) stepTick(); },1600);
  var tabs=$('rcTabs');
  tabs.addEventListener('click',function(e){ var b=e.target.closest('button'); if(!b) return; tabs.querySelectorAll('button').forEach(function(x){ x.classList.toggle('on',x===b); x.setAttribute('aria-selected',x===b?'true':'false'); }); show(+b.dataset.i); st=0; stepTick(); });
  show(0);
})();

/* ---------- end card QR + funnel ---------- */
(function(){
  var c=$('qr'); if(c){ var x=c.getContext('2d'), n=25, m=c.width/n; x.fillStyle='#fff6e8'; x.fillRect(0,0,c.width,c.height); x.fillStyle='#1b0b06';
    for(var i=0;i<n;i++) for(var j=0;j<n;j++){ var fi=(i<7&&j<7)?[i,j]:(i<7&&j>=n-7)?[i,j-(n-7)]:(i>=n-7&&j<7)?[i-(n-7),j]:null;
      if(fi){ var a=fi[0],b=fi[1]; if(a===0||a===6||b===0||b===6||(a>1&&a<5&&b>1&&b<5)) x.fillRect(j*m,i*m,m+.4,m+.4); }
      else if(!((i===7||j===7||i===n-8||j===n-8)&&(i<8||j<8)) && (((i*31+j*17+i*j*7)^(i*j))%5<2)) x.fillRect(j*m,i*m,m+.4,m+.4); } }
  var R=$('fnRows'); if(!R) return;
  var F=[['Tuned in',18420,'#9A9CAB'],['Scanned the QR',212,'#EBA03A'],['Saved it for later',96,'#C04A9E'],['Used the code',41,'#E0583A']];
  var top=Math.log10(F[0][1]);
  R.innerHTML=F.map(function(f){ return '<div class="fn-r"><span>'+f[0]+'</span><div class="fn-t"><i style="--k:'+f[2]+';--w:'+(Math.log10(f[1])/top*100).toFixed(1)+'%"></i></div><b class="tab">'+num(f[1])+'</b></div>'; }).join('');
  var el=$('fun'); if(RM){ el.classList.add('go'); return; }
  new IntersectionObserver(function(e,o){ if(e[0].isIntersecting){ el.classList.add('go'); o.disconnect(); } },{threshold:.12}).observe(el);
})();
