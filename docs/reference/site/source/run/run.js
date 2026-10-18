(function(){
'use strict';
var BRAND='dial';
document.querySelectorAll('[data-brand]').forEach(function(e){ e.textContent=BRAND; });
var RM=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
var FINE=window.matchMedia&&matchMedia('(hover: hover) and (pointer: fine)').matches;
var $=function(id){ return document.getElementById(id); };
function clamp(v,a,b){ return Math.max(a===undefined?0:a,Math.min(b===undefined?1:b,v)); }
(function(){ var c=document.createElement('canvas'); c.width=c.height=180; var x=c.getContext('2d'), d=x.createImageData(180,180); for(var i=0;i<d.data.length;i+=4){ var v=Math.random()*255; d.data[i]=d.data[i+1]=d.data[i+2]=v; d.data[i+3]=255; } x.putImageData(d,0,0); $('grain').style.backgroundImage='url('+c.toDataURL()+')'; })();
/*DATA*/
var cur=1;
function nowMin(){ var n=new Date(); return n.getHours()*60+n.getMinutes(); }
function fill(){ var s=S[cur], sl=slot(s); document.querySelectorAll('.js-ch').forEach(function(e){ e.textContent=s.n; }); $('npCs').textContent=s.cs; $('npProg').textContent=sl.prog; document.documentElement.style.setProperty('--np',s.c);
  $('chClock').textContent=clock(nowMin()); }
fill(); setInterval(fill,30000);

/* uptime counters on the relay outputs */
var ups=[].slice.call(document.querySelectorAll('[data-up],[data-restart]'));
function hms(s){ s=Math.max(0,Math.floor(s)); var h=Math.floor(s/3600), m=Math.floor(s%3600/60), x=s%60; return h+':'+(m<10?'0':'')+m+':'+(x<10?'0':'')+x; }
var t0=Date.now();
function tick(){ var el=(Date.now()-t0)/1000; ups.forEach(function(e){ if(e.dataset.up) e.textContent=hms(+e.dataset.up+el); else { var R=+e.dataset.restart, r=R-(el%R); e.textContent='↻ '+hms(r).replace(/^0:/,''); e.classList.add('warn'); } }); }
tick(); setInterval(tick,1000);

/* ---------- signal chain: one monitor shows each stage in turn, then the signal fans out ---------- */
function hexA(h,a){ var n=parseInt(h.slice(1),16); return 'rgba('+(n>>16)+','+((n>>8)&255)+','+(n&255)+','+a+')'; }
var SC={
 crate:function(x,w,h,t,s){ var g=x.createLinearGradient(0,0,w,h); g.addColorStop(0,'#2a0d2a'); g.addColorStop(1,'#120618'); x.fillStyle=g; x.fillRect(0,0,w,h);
   var cx=w*.68, cy=h*.46, R=Math.min(w,h)*.36; x.save(); x.translate(cx,cy); x.rotate(t*1.4);
   x.fillStyle='#0b0b0f'; x.beginPath(); x.arc(0,0,R,0,7); x.fill();
   for(var r=R*.38;r<R*.97;r+=R*.035){ x.strokeStyle='rgba(255,255,255,'+(0.04+0.04*Math.sin(r))+')'; x.lineWidth=1; x.beginPath(); x.arc(0,0,r,0,7); x.stroke(); }
   x.fillStyle=s.c; x.beginPath(); x.arc(0,0,R*.32,0,7); x.fill(); x.fillStyle='#fff'; x.fillRect(R*.08,-R*.03,R*.16,R*.06);
   x.fillStyle='rgba(255,255,255,.18)'; x.beginPath(); x.moveTo(0,0); x.arc(0,0,R*.97,-.3,-.05); x.fill(); x.restore();
   var nb=28, bw=w*.5/nb; for(var i=0;i<nb;i++){ var v=.25+.75*Math.abs(Math.sin(t*3.1+i*.7)*Math.cos(t*1.7+i*.31)); x.fillStyle=hexA(s.c,.35+.5*v); x.fillRect(w*.04+i*bw, h*.92-v*h*.28, bw*.62, v*h*.28); }
 },
 reel:function(x,w,h,t,s){ var wy=Math.sin(t*9)*1.2; var g=x.createLinearGradient(0,0,0,h); g.addColorStop(0,'#3a1d0c'); g.addColorStop(.55,'#d98a2b'); g.addColorStop(.62,'#f6c46a'); g.addColorStop(1,'#1a0c06'); x.fillStyle=g; x.fillRect(0,0,w,h);
   x.fillStyle='rgba(255,230,170,.9)'; x.beginPath(); x.arc(w*.62,h*.56+wy,h*.12,0,7); x.fill();
   x.fillStyle='#160904'; x.beginPath(); x.moveTo(0,h*.66+wy); for(var i=0;i<=20;i++){ x.lineTo(w*i/20,h*(.62+.05*Math.sin(i*1.3))+wy); } x.lineTo(w,h); x.lineTo(0,h); x.fill();
   x.fillStyle='#0d0503'; x.fillRect(w*.2,h*.5+wy,w*.012,h*.2); x.beginPath(); x.arc(w*.206,h*.48+wy,h*.025,0,7); x.fill();
   var f=.85+.15*Math.random(); x.fillStyle='rgba(0,0,0,'+(1-f)*.6+')'; x.fillRect(0,0,w,h);
   for(var k=0;k<120;k++){ x.fillStyle='rgba(255,240,210,'+Math.random()*.25+')'; x.fillRect(Math.random()*w,Math.random()*h,1,1); }
   if(Math.random()<.3){ x.fillStyle='rgba(255,240,210,.25)'; x.fillRect(Math.random()*w,0,1,h); }
 },
 kitchen:function(x,w,h,t,s){ var g=x.createRadialGradient(w*.6,h*.5,10,w*.6,h*.5,w*.7); g.addColorStop(0,'#5a1f12'); g.addColorStop(1,'#1d0806'); x.fillStyle=g; x.fillRect(0,0,w,h);
   for(var i=0;i<9;i++){ x.fillStyle=i%2?'rgba(255,200,150,.035)':'rgba(0,0,0,.08)'; x.fillRect(0,i*h/9,w,h/9); }
   var cx=w*.64, cy=h*.6, R=h*.3; x.fillStyle='#120807'; x.beginPath(); x.ellipse(cx,cy,R*1.25,R*.62,0,0,7); x.fill();
   x.fillStyle=s.c; x.beginPath(); x.ellipse(cx,cy-4,R*1.05,R*.48,0,0,7); x.fill();
   x.fillStyle='rgba(255,210,120,.5)'; for(var j=0;j<14;j++){ x.beginPath(); x.ellipse(cx+Math.cos(j*2.4)*R*.6,cy-4+Math.sin(j*1.7)*R*.25,R*.12,R*.06,j,0,7); x.fill(); }
   for(var k=0;k<34;k++){ var ph=(t*.18+k/34)%1; var sx=cx+Math.sin(k*3.7+t*.8)*R*.7+Math.sin(ph*6+k)*12; var sy=cy-R*.4-ph*h*.55; x.fillStyle='rgba(255,240,230,'+(.22*(1-ph))+')'; x.beginPath(); x.arc(sx,sy,6+ph*22,0,7); x.fill(); }
 },
 civic:function(x,w,h,t,s){ var z=1+.03*Math.sin(t*.2); x.save(); x.translate(w/2,h/2); x.scale(z,z); x.translate(-w/2,-h/2);
   x.fillStyle='#1d2a24'; x.fillRect(0,0,w,h); x.fillStyle='#24362e'; x.fillRect(0,0,w,h*.42);
   x.fillStyle='#c8b98a'; x.fillRect(w*.38,h*.1,w*.24,h*.16); x.fillStyle='#1d2a24'; x.fillRect(w*.395,h*.12,w*.21,h*.12);
   x.fillStyle='#3d2a1c'; x.fillRect(w*.08,h*.5,w*.84,h*.2); x.fillStyle='#2b1d13'; x.fillRect(w*.08,h*.68,w*.84,h*.06);
   for(var i=0;i<7;i++){ var px=w*(.14+i*.12), sp=(Math.floor(t/4)%7)===i; x.fillStyle=sp?'#e7d3b5':'#b9a88f'; x.beginPath(); x.arc(px,h*.43,h*.04,0,7); x.fill(); x.fillStyle=sp?'#3b5e8c':'#2f3b48'; x.fillRect(px-h*.05,h*.47,h*.1,h*.06); x.fillStyle='#ddd'; x.fillRect(px-2,h*.48,4,h*.03); }
   x.fillStyle='#4a5a50'; x.fillRect(w*.44,h*.74,w*.12,h*.2); x.restore();
   x.fillStyle='rgba(255,60,50,.95)'; x.beginPath(); x.arc(w*.06,h*.08,5,0,7); x.fill(); x.fillStyle='#fff'; x.font='bold 14px sans-serif'; x.fillText('LIVE',w*.06+10,h*.08+5);
 },
 field:function(x,w,h,t,s){ x.fillStyle='#1e5a2c'; x.fillRect(0,0,w,h); for(var i=0;i<12;i++){ x.fillStyle=i%2?'rgba(255,255,255,.03)':'rgba(0,0,0,.05)'; x.fillRect(0,h*.25+i*h*.07,w,h*.07); }
   x.strokeStyle='rgba(255,255,255,.75)'; x.lineWidth=2; var off=(t*30)%(w*.14);
   for(var j=-2;j<10;j++){ var bx=j*w*.14-off; x.beginPath(); x.moveTo(bx+w*.06,h*.25); x.lineTo(bx-w*.04,h); x.stroke(); }
   x.fillStyle='#0d1a12'; x.fillRect(0,0,w,h*.25); x.fillStyle='rgba(255,255,220,.07)'; for(var k=0;k<40;k++) x.fillRect((k*53)%w,(k*29)%(h*.22),2,2);
   for(var p=0;p<11;p++){ var px=(w*.2+p*w*.06+Math.sin(t*1.3+p)*w*.04-off*.3+w)%w, py=h*(.45+.4*((p*37%11)/11))+Math.cos(t+p)*6; x.fillStyle=p<6?'#f2f2f2':s.c; x.beginPath(); x.arc(px,py,5,0,7); x.fill(); }
   x.fillStyle='rgba(0,0,0,.6)'; x.fillRect(w*.05,h*.06,w*.3,h*.1); x.fillStyle='#fff'; x.font='bold 15px sans-serif'; x.fillText('UPL 14  –  CHA 10   Q3',w*.07,h*.125);
 },
 matinee:function(x,w,h,t,s){ var fl=.8+.2*Math.random(); var g=x.createRadialGradient(w*.5,h*.4,10,w*.5,h*.5,w*.7); g.addColorStop(0,'rgb('+(200*fl|0)+','+(200*fl|0)+','+(195*fl|0)+')'); g.addColorStop(1,'#141414'); x.fillStyle=g; x.fillRect(0,0,w,h);
   x.save(); x.translate(w*.5,h*1.05); for(var i=0;i<18;i++){ x.rotate(Math.PI/18); x.fillStyle=i%2?'rgba(0,0,0,.12)':'rgba(255,255,255,.05)'; x.beginPath(); x.moveTo(0,0); x.lineTo(-w,-h*1.4); x.lineTo(-w*.8,-h*1.6); x.fill(); } x.restore();
   x.fillStyle='#0c0c0c'; x.fillRect(w*.36,h*.3,w*.28,h*.7); x.fillStyle='rgba(230,230,225,'+.85*fl+')'; x.fillRect(w*.38,h*.32,w*.24,h*.68);
   x.fillStyle='#111'; var sx=Math.sin(t*.4)*w*.02; [[.45,.5],[.55,.52]].forEach(function(p){ x.beginPath(); x.arc(w*p[0]+sx,h*p[1],h*.05,0,7); x.fill(); x.fillRect(w*p[0]-h*.06+sx,h*(p[1]+.05),h*.12,h*.4); });
   for(var k=0;k<200;k++){ var v=Math.random()*255|0; x.fillStyle='rgba('+v+','+v+','+v+',.18)'; x.fillRect(Math.random()*w,Math.random()*h,1,1); }
   if(Math.random()<.25){ x.fillStyle='rgba(255,255,255,.3)'; x.fillRect(Math.random()*w,0,1,h); }
 },
 radio:function(x,w,h,t,s,alt){ var g=x.createLinearGradient(0,0,0,h); g.addColorStop(0,alt?'#2a1408':'#070b22'); g.addColorStop(1,alt?'#120804':'#020310'); x.fillStyle=g; x.fillRect(0,0,w,h);
   for(var k=0;k<60;k++){ x.fillStyle='rgba(255,255,255,'+(.2+.6*Math.abs(Math.sin(t+k)))*.5+')'; x.fillRect((k*97)%w,(k*41)%(h*.5),1.4,1.4); }
   var nb=48, bw=w*.8/nb; for(var i=0;i<nb;i++){ var v=Math.abs(Math.sin(t*2.3+i*.45)*Math.cos(t*1.1+i*.13))*(1-Math.abs(i-nb/2)/nb); x.fillStyle=hexA(s.c,.25+.7*v); x.fillRect(w*.1+i*bw,h*.62-v*h*.4,bw*.6,v*h*.4*2); }
   x.strokeStyle='rgba(255,255,255,.35)'; x.lineWidth=1; x.beginPath(); x.moveTo(w*.1,h*.86); x.lineTo(w*.9,h*.86); x.stroke();
   for(var f=88;f<=108;f+=2){ var fx=w*.1+(f-88)/20*w*.8; x.beginPath(); x.moveTo(fx,h*.84); x.lineTo(fx,h*.88); x.stroke(); }
   var nf=parseFloat(s.n), nx=w*.1+(nf-88)/20*w*.8; x.strokeStyle=s.c; x.lineWidth=2; x.beginPath(); x.moveTo(nx,h*.8); x.lineTo(nx,h*.92); x.stroke();
 },
 radio2:function(x,w,h,t,s){ SC.radio(x,w,h,t,s,1); },
 dunes:function(x,w,h,t,s){ var g=x.createLinearGradient(0,0,0,h); g.addColorStop(0,'#2b1638'); g.addColorStop(.5,'#c9709a'); g.addColorStop(.62,'#f2b07a'); g.addColorStop(1,'#3a1e2a'); x.fillStyle=g; x.fillRect(0,0,w,h);
   x.fillStyle='rgba(255,226,180,.9)'; x.beginPath(); x.arc(w*.3,h*(.5+.04*Math.sin(t*.1)),h*.08,0,7); x.fill();
   var cols=['#a0526f','#7a3a5a','#4f2340','#2c1426']; cols.forEach(function(cc,k){ x.fillStyle=cc; x.beginPath(); x.moveTo(0,h); for(var i=0;i<=40;i++){ var px=w*i/40; x.lineTo(px,h*(.55+k*.1)+Math.sin(i*.35+k*1.7+t*.05*(k+1))*h*.05); } x.lineTo(w,h); x.fill(); });
   x.strokeStyle='rgba(255,240,230,.5)'; x.lineWidth=1.2; x.beginPath(); for(var j=0;j<=200;j++){ var px2=w*.1+j*w*.8/200; var v=Math.sin(j*.3+t*4)*Math.sin(j*.05+t)*h*.03; if(j) x.lineTo(px2,h*.2+v); else x.moveTo(px2,h*.2+v); } x.stroke();
 }
};

function draw(x,w,h,t,s){ SC[s.sc](x,w,h,t,s); }

(function(){
  var mc=$('mc'); if(!mc) return;
  var pgm=$('pgm'), pc=$('pgmC'), px=pc.getContext('2d'), steps=[].slice.call(mc.querySelectorAll('.mc-steps button')), outs=[].slice.call(mc.querySelectorAll('.so')), fan=$('scFan'), S1=S[1];
  var STG=[
    {c:'#9A9CAB',t:'Your library stays home',p:'A small agent on your NAS sends only what\'s about to air. Nothing else leaves the house.',s:'2.4 TB home · 38 GB sent',d:2.6},
    {c:'#5B7BE0',t:'Prepared once, on our side',p:'Every file is fixed and transcoded one time. No GPU, no server, no fan noise.',s:'Once per file',d:2.6},
    {c:'#2F9A72',t:'A real schedule',p:'Your week, by the hour. Live shows get a slot and replays fill the gaps.',s:'7 days ahead',d:2.4},
    {c:'#EBA03A',t:'Breaks that build themselves',p:'Bumpers, IDs and paid spots from the market, dropped into natural break points.',s:'1:45 a break',d:3},
    {c:'#C04A9E',t:'On air, everywhere',p:'One continuous signal to the dial and every platform you connect, with your bug on it.',s:'5 outputs · 0 drops',d:4.2}];
  var FILES=[['late_crate_s2e6.mp4','1.8 GB'],['crate_session_041.mkv','3.2 GB'],['bumper_beat_05s.mov','42 MB'],['station_id_v3.mov','28 MB'],['overnight_mix_07.flac','610 MB'],['guest_mix_ibm.mkv','2.6 GB']];
  var PREP=['HDR10 → SDR','1080i → 1080p','−9 LUFS → −16 LUFS'];
  var BRK=[['Bumper','0:05'],['Spot · Juniper Barber','0:30'],['Spot · Redlands Hardware','0:30'],['Members','0:15'],['Station ID','0:05']];
  var bsegs=[].slice.call($('obS').children), olL=$('olL');
  var si=0, t0s=performance.now(), hold=0, fi=0, pi=0, vis=true, last=0;
  function lib(){ var h=''; for(var k=0;k<5;k++){ var f=FILES[(fi+k)%FILES.length], st=k===0?'up':k<2?'ok':''; h+='<div class="'+st+'"><span>'+f[0]+'</span><em>'+(k===0?'Sending':k<2?'Sent':'At home')+'</em></div>'; } olL.innerHTML=h; }
  function setStage(i){ si=i; t0s=performance.now(); var g=STG[i]; pgm.dataset.s=i; mc.style.setProperty('--s',g.c); mc.classList.toggle('is-air',i===4);
    steps.forEach(function(b,k){ b.classList.toggle('on',k===i); b.classList.toggle('done',k<i); b.setAttribute('aria-selected',k===i); b.querySelector('u').style.width='0'; });
    $('mcT').textContent=g.t; $('mcP').textContent=g.p; $('mcS').textContent=g.s;
    if(i===0){ fi=(fi+1)%FILES.length; lib(); } if(i===1){ pi=(pi+1)%PREP.length; $('opT').textContent=PREP[pi]; } }
  steps.forEach(function(b){ b.addEventListener('click',function(){ hold=performance.now()+6000; setStage(+b.dataset.i); }); });
  function rel(el){ var a=el.getBoundingClientRect(), b=mc.getBoundingClientRect(); return {x:a.left-b.left,y:a.top-b.top,w:a.width,h:a.height}; }
  function layout(){ var f=rel(fan), m=rel(pgm), W=f.w, H=f.h, sx=m.x+m.w/2-f.x, h='';
    fan.setAttribute('viewBox','0 0 '+W+' '+H); fan.setAttribute('width',W); fan.setAttribute('height',H);
    outs.forEach(function(o){ var r=rel(o), ex=r.x+r.w/2-f.x, d='M'+sx+' 0 C'+sx+' '+(H*.7)+' '+ex+' '+(H*.3)+' '+ex+' '+H; h+='<path d="'+d+'"/><path class="fl" style="--k:'+getComputedStyle(o).getPropertyValue('--k')+'" d="'+d+'"/>'; });
    fan.innerHTML=h; }
  function tc(){ var n=new Date(), f=Math.floor(n.getMilliseconds()/1000*30), p=function(v){ return (v<10?'0':'')+v; }; return p(n.getHours())+':'+p(n.getMinutes())+':'+p(n.getSeconds())+':'+p(f); }
  new IntersectionObserver(function(e){ vis=e[0].isIntersecting; }).observe(mc);
  function frame(now){ requestAnimationFrame(frame); if(!vis||document.hidden) return; if(now-last<40) return; last=now;
    var T=now/1000, g=STG[si], p=Math.min(1,(now-t0s)/1000/g.d);
    steps[si].querySelector('u').style.width=(p*100)+'%';
    if(si===0){ var up=olL.querySelector('.up'); if(up) up.style.setProperty('--p',Math.min(100,p*130)+'%'); }
    if(si===1){ var w=12+76*(.5-.5*Math.cos(p*Math.PI)); pgm.style.setProperty('--w',w+'%'); }
    if(si===2){ $('osN').style.left=(30+p*25)+'%'; }
    if(si===3){ var bk=Math.min(BRK.length-1,Math.floor(p*BRK.length)); bsegs.forEach(function(b,k){ b.classList.toggle('on',k===bk); }); $('obN').textContent=BRK[bk][0]; $('obT').textContent=BRK[bk][1]; }
    draw(px,480,270,T,S1); $('pgmTc').textContent=tc();
    if(p>=1&&now>hold) setStage((si+1)%STG.length); }
  layout(); addEventListener('resize',layout); document.fonts&&document.fonts.ready.then(layout);
  lib(); setStage(0);
  if(RM){ setStage(4); draw(px,480,270,0,S1); } else requestAnimationFrame(frame);
})();

/* schedule viz: a week, 6 pm to 2 am */
(function(){ var el=$('sch'); if(!el) return; var W0=18, W1=26, days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  var P={cr:['Crate Session','#C04A9E'],lc:['Late Crate','#C04A9E'],bt:['Beat Tape Live','#C04A9E'],ov:['Overnight Crates','#7a3b8f'],sp:['Sample Pack','#5B7BE0'],dj:['Guest Mix','#EBA03A'],rp:['Replay','#6b6585']};
  var G={Mon:[[18,20,'cr'],[20,21,'sp'],[21,23,'lc'],[23,26,'ov']],Tue:[[18,20,'cr'],[20,21,'sp'],[21,23,'lc'],[23,24,'ov'],[24,26,'off']],Wed:[[18,20,'cr'],[20,22,'dj'],[22,23,'lc'],[23,26,'ov']],Thu:[[18,20,'cr'],[20,21,'sp'],[21,23,'lc'],[23,24,'ov'],[24,26,'off']],
    Fri:[[18,19,'rp'],[19,21,'cr'],[21,23,'bt','lv'],[23,26,'ov']],Sat:[[18,20,'dj'],[20,22,'bt','lv'],[22,23,'lc'],[23,26,'ov']],Sun:[[18,20,'rp'],[20,22,'cr'],[22,24,'sp'],[24,26,'off']]};
  var h='<div class="hrs"><span>6 pm</span><span>8 pm</span><span>10 pm</span><span>12 am</span><span>2 am</span></div>';
  var today=(new Date().getDay()+6)%7;
  days.forEach(function(d,k){ h+='<span class="dy'+(k===today?' today':'')+'">'+d+'</span><div class="ln" data-k="'+k+'">';
    G[d].forEach(function(b){ var l=(b[0]-W0)/(W1-W0)*100, w=(b[1]-b[0])/(W1-W0)*100;
      if(b[2]==='off') h+='<b class="off" style="left:'+l+'%;width:calc('+w+'% - 2px)">Off air</b>';
      else h+='<b class="'+(b[3]==='lv'?'lv':'')+'" style="left:'+l+'%;width:calc('+w+'% - 2px);--c:'+P[b[2]][1]+'">'+(b[3]==='lv'?'● ':'')+P[b[2]][0]+'</b>'; });
    h+='</div>'; });
  el.innerHTML=h;
  var row=el.querySelector('.ln[data-k="'+today+'"]'), nl=document.createElement('i'); nl.className='now'; row.appendChild(nl);
  function pos(){ var m=nowMin()/60; if(m<6) m+=24; var p=(m-W0)/(W1-W0); if(p<0||p>1) p=.46; nl.style.left=(p*100)+'%'; } pos(); setInterval(pos,30000);
})();

/* copy buttons */
document.querySelectorAll('.cp').forEach(function(b){ b.addEventListener('click',function(){ var t=b.dataset.copy; try{ navigator.clipboard&&navigator.clipboard.writeText(t); }catch(e){} b.textContent='Copied'; b.classList.add('ok'); setTimeout(function(){ b.textContent='Copy'; b.classList.remove('ok'); },1600); }); });

/* does it cover your costs: spots at ~$8 CPM after our 10%, pledges after our 5% */
var BILL=0;
function pay(){ if(!$('pTun')) return;
  var tun=+$('pTun').value, mn=+$('pMin').value, pl=+$('pPl').value;
  var sp=mn*4*PRICE.hours*tun*8/1000*.9, po=pl*.95, earn=sp+po, cost=BILL, left=Math.max(0,earn-cost);
  $('vTun').textContent=tun.toLocaleString('en-US'); $('vMin').textContent=mn===0?'None':mn<1?Math.round(mn*60)+' sec':(mn%1?mn.toFixed(2).replace(/0$/,''):mn)+' min'; $('vPl').textContent='$'+pl.toLocaleString('en-US');
  $('pSp').textContent=money(sp); $('pPlO').textContent=money(po); $('pCost').textContent='−'+money(Math.min(cost,earn)); $('pCostN').textContent=money(cost); $('pLeft').textContent=money(left);
  var v; if(cost<=0) v='Your month costs nothing to run'; else if(earn>=cost){ var x=earn/cost; v=x>=2?'Covers your month '+(x>=10?Math.round(x):x.toFixed(1).replace(/\.0$/,''))+'\u00d7 over':'Covers your month, with some left'; } else v='Covers '+Math.round(earn/cost*100)+'% of your month';
  $('pVerdict').textContent=v;
  var tot=Math.max(earn,cost)||1; $('pbC').style.flexGrow=Math.min(cost,earn)/tot; $('pbL').style.flexGrow=left/tot; $('pbC').parentNode.style.setProperty('--gap',(Math.max(0,cost-earn)/tot));
  ['pTun','pMin','pPl'].forEach(function(id){ var e=$(id); e.style.setProperty('--p',((e.value-e.min)/(e.max-e.min)*100)+'%'); }); }
['pTun','pMin','pPl'].forEach(function(id){ var e=$(id); if(e) e.addEventListener('input',pay); });

/* calculator. Launch prices: keep in one place. */
var PRICE={gb:.04, freeGb:10, relayHr:.05, relayCap:25, liveHr:.75, freeLive:5, hours:720}; /* docs/pricing.md; relay at recommendation 2 with a monthly cap */
var rm=2;
function money(v){ return '$'+v.toFixed(2); }
var LIB=[25,50,75,100,150,200,300,500,750,1000,1500,2000,3000,5000];
function size(g){ return g>=1000?(g/1000).toFixed(g%1000?1:0)+' TB':g+' GB'; }
function calc(){ var lib=LIB[+$('cLib').value], gb=+$('cGb').value, lv=+$('cLive').value;
  if(gb>lib){ gb=lib; } $('vLib').textContent=size(lib); $('vGb').textContent=gb+' GB'; $('vLive').textContent=lv+' h';
  var st=Math.max(0,gb-PRICE.freeGb)*PRICE.gb, rl=rm===2?Math.min(PRICE.relayCap,PRICE.hours*PRICE.relayHr):0, li=Math.max(0,lv-PRICE.freeLive)*PRICE.liveHr, sub=st+rl+li, tot=sub;
  $('oSt').textContent=money(st); $('oRl').textContent=rm===2?money(rl):rm===1?'Free':'$0.00'; $('oLv').textContent=money(li); $('oTot').textContent=money(tot);
  ['cLib','cGb','cLive'].forEach(function(id){ var e=$(id); e.style.setProperty('--p',((e.value-e.min)/(e.max-e.min)*100)+'%'); });
  vs(lib,tot); BILL=tot; pay(); }
/* competitors: the cheapest published plan that holds the whole library, 1080p 24/7 (their pricing pages, Oct 2026) */
var COMP=[
  {n:'Livepush',tiers:[[20,39,'Editors'],[50,69,'Creators'],[100,119,'Business']]},
  {n:'Upstream',tiers:[[100,30,'1 stream']],note:'100 GB is its free plan; paid storage not published'},
  {n:'Gyre',tiers:[[75,99,'Start+'],[150,169,'PRO+']]}];
function vs(lib,tot){ var h='';
  if(rm===0){ $('vsNote').textContent='Dial only. Loop tools only push to platforms, so there is nothing to compare.'; $('vsR').innerHTML=''; return; }
  $('vsNote').textContent='Their plans have to hold your whole '+size(lib)+' library, at 1080p.';
  COMP.forEach(function(c){ var price=null, plan='', top=c.tiers[c.tiers.length-1][0];
    for(var i=0;i<c.tiers.length;i++){ if(lib<=c.tiers[i][0]){ price=c.tiers[i][1]; plan=c.tiers[i][2]+', '+c.tiers[i][0]+' GB'; break; } }
    var d, b;
    if(price===null){ b='<b class="tab no">Won\'t fit</b>'; plan='Largest published plan holds '+top+' GB'; d='<em class="no">'+size(lib-top)+' over</em>'; }
    else { b='<b class="tab">$'+price+'</b>'; if(c.note) plan+=' · '+c.note; d=price>tot?'<em class="dn">$'+(price-tot).toFixed(2)+' more than here</em>':'<em class="up">$'+(tot-price).toFixed(2)+' less than here</em>'; }
    h+='<div class="vc"><span>'+c.n+'</span>'+b+'<small>'+plan+'</small>'+d+'</div>'; });
  $('vsR').innerHTML=h; }
['cLib'].forEach(function(id){ $(id).addEventListener('input',calc); });
['cGb','cLive'].forEach(function(id){ $(id).addEventListener('input',calc); });
document.querySelectorAll('.rm button').forEach(function(b){ b.addEventListener('click',function(){ rm=+b.dataset.r; document.querySelectorAll('.rm button').forEach(function(x){ x.classList.toggle('on',x===b); }); calc(); }); });
calc();

/* claim a number */
(function(){ var nums=['14.1','16.1','19.1','22.1','27.1','31.1','33.1','38.1','41.1','44.1','47.1','52.1'], taken={'16.1':1,'31.1':1,'41.1':1}, pick=$('pick'), sel='44.1';
  pick.innerHTML=nums.map(function(n){ return '<button type="button" data-n="'+n+'"'+(taken[n]?' disabled aria-label="'+n+' is taken"':'')+(n===sel?' class="on"':'')+'>'+n+'</button>'; }).join('');
  var csIn=$('csIn'), csN=$('csN'), msg=$('csMsg'), used={}; S.forEach(function(s){ used[s.cs]=1; });
  function upd(){ var v=csIn.value.toUpperCase().replace(/[^A-Z]/g,'').slice(0,4); csIn.value=v; csN.textContent=sel;
    if(v.length<4){ msg.textContent='Four letters. '+(4-v.length)+' to go.'; msg.className=''; }
    else if(used[v]){ msg.textContent=v+' is taken on the network. Try another.'; msg.className=''; }
    else { msg.textContent=v+' on '+sel+' is free. Claim it.'; msg.className='ok'; } }
  pick.addEventListener('click',function(e){ var b=e.target.closest('button'); if(!b||b.disabled) return; sel=b.dataset.n; pick.querySelectorAll('button').forEach(function(x){ x.classList.toggle('on',x===b); }); document.querySelectorAll('.btn .live').forEach(function(l){ l.innerHTML='<i></i>'+sel; }); upd(); });
  csIn.addEventListener('input',upd); upd(); })();

/* nav, smooth scroll, sign-off reveal */
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
