(function(){
'use strict';
var BRAND='dial'; /* swap the name here */
document.querySelectorAll('[data-brand]').forEach(function(e){ e.textContent=BRAND; });
var RM=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
var FINE=window.matchMedia&&matchMedia('(hover: hover) and (pointer: fine)').matches;
var $=function(id){ return document.getElementById(id); };
function clamp(v,a,b){ return Math.max(a===undefined?0:a,Math.min(b===undefined?1:b,v)); }
function ease(t){ return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2; }

/* grain tile */
(function(){ var c=document.createElement('canvas'); c.width=c.height=180; var x=c.getContext('2d'), d=x.createImageData(180,180); for(var i=0;i<d.data.length;i+=4){ var v=Math.random()*255; d.data[i]=d.data[i+1]=d.data[i+2]=v; d.data[i+3]=255; } x.putImageData(d,0,0); $('grain').style.backgroundImage='url('+c.toDataURL()+')'; })();

/* ---------- stations ---------- */
var S=[
 {n:'7.1',b:'tv',cs:'CIVC',name:'Civic Channel',who:'Run by a residents’ group in Riverside',c:'#2F9A72',sc:'civic',len:120,p:['Council Watch','Neighborhood Hour','Library Talks','Council Watch, replay']},
 {n:'12.1',b:'tv',cs:'BEAT',name:'Beat Tape TV',who:'Run by a crate digger in Pomona',c:'#C04A9E',sc:'crate',len:60,p:['Late Crate','Crate Session','Beat Tape Live','Overnight Crates']},
 {n:'18.1',b:'tv',cs:'SAZN',name:'Sazón',who:'Run by a family kitchen in Fontana',c:'#E0583A',sc:'kitchen',len:30,p:['Tamales for forty','Sunday Pozole','Abuela’s Pantry','Salsa School']},
 {n:'24.1',b:'tv',cs:'REEL',name:'Saturday Reel',who:'Run by a film club in Redlands',c:'#D98A2B',sc:'reel',len:120,p:['Saturday Reel','Short Stack','The Late Show','Projector Room']},
 {n:'31.1',b:'tv',cs:'PREP',name:'Prep Sports',who:'Run by high-school students in Upland',c:'#3478C6',sc:'field',len:180,p:['Prep Football Live','Game Film','Locker Room']},
 {n:'60.1',b:'tv',cs:'OCAT',name:'Classic Matinee',who:'Public-domain films from the network’s catalog',c:'#9A9CAB',sc:'matinee',len:90,p:['Classic Matinee','Silent Hour','Serial Saturday']},
 {n:'88.4',b:'fm',cs:'NITE',name:'Night Shift Radio',who:'Run by two DJs in San Bernardino',c:'#5B7BE0',sc:'radio',len:180,p:['Night Shift','Request Line','Dawn Patrol']},
 {n:'92.0',b:'fm',cs:'FLDR',name:'Mojave Field Recordings',who:'Desert sound, recorded and shared under CC BY',c:'#C9709A',sc:'dunes',len:60,p:['Wind at Amboy','Joshua Tree, 4 am','Kelso Dunes']},
 {n:'104.2',b:'fm',cs:'VOZE',name:'La Voz del Valle',who:'Run by a radio collective in Coachella',c:'#EBA03A',sc:'radio2',len:60,p:['Mañanitas','La Hora Norteña','Voces del Valle']}
];
function slot(s){ var now=new Date(), m=now.getHours()*60+now.getMinutes()+now.getSeconds()/60; var i=Math.floor(m/s.len); return {i:i,start:i*s.len,end:(i+1)*s.len,prog:s.p[i%s.p.length],next:s.p[(i+1)%s.p.length],pct:(m-i*s.len)/s.len,left:Math.ceil((i+1)*s.len-m)}; }
function clock(min){ min=((min%1440)+1440)%1440; var h=Math.floor(min/60),m=Math.round(min%60); if(m===60){h=(h+1)%24;m=0;} return (h%12===0?12:h%12)+(m?':'+(m<10?'0':'')+m:'')+(h<12?' am':' pm'); }

/* ---------- scenes ---------- */
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

/* ---------- hero ---------- */
var hero=$('hero'), screen=$('screen'), pic=$('pic'), noise=$('noise'), px=pic.getContext('2d'), nx=noise.getContext('2d');
var cur=1, t0=performance.now(), heroVis=true, changing=false, heroP=0;
function size(){ var r=screen.getBoundingClientRect(); var W=480, H=Math.max(200,Math.round(W*r.height/Math.max(1,r.width))); pic.width=W; pic.height=H; noise.width=200; noise.height=Math.round(200*H/W); }
size(); addEventListener('resize',size);
function paintNoise(){ var id=nx.createImageData(noise.width,noise.height), d=id.data; for(var i=0;i<d.length;i+=4){ var v=Math.random()*255; d[i]=v; d[i+1]=v; d[i+2]=v*1.05; d[i+3]=255; } nx.putImageData(id,0,0); var y=(performance.now()/3)%noise.height; nx.fillStyle='rgba(255,255,255,.25)'; nx.fillRect(0,y,noise.width,6); }
var last=0;
function heroLoop(now){ requestAnimationFrame(heroLoop); if(!heroVis||document.hidden) return; if(now-last<33) return; last=now; draw(px,pic.width,pic.height,RM?0:(now-t0)/1000,S[cur]); if(changing) paintNoise(); }
requestAnimationFrame(heroLoop);
new IntersectionObserver(function(e){ heroVis=e[0].isIntersecting; }).observe(screen);

function fill(){ var s=S[cur], sl=slot(s); $('npCs').textContent=s.cs; $('npProg').textContent=sl.prog; document.documentElement.style.setProperty('--np',s.c); $('lNum').textContent=s.n; $('lCs').textContent=s.cs; $('lProg').textContent=sl.prog; $('lWho').textContent=s.who; $('lBar').style.width=(sl.pct*100).toFixed(1)+'%'; $('lStart').textContent=clock(sl.start); $('lEnd').textContent=clock(sl.end); $('lLeft').textContent=sl.left+' min left'; $('lNext').textContent=sl.next; $('lNextT').textContent=clock(sl.end); $('osdNum').textContent=(s.b==='fm'?'FM ':'')+s.n; $('osdCs').textContent=s.cs; document.querySelectorAll('.js-ch').forEach(function(e){ e.textContent=s.n; }); screen.setAttribute('aria-label','Now on '+s.n+' '+s.cs+': '+sl.prog+'. Use the left and right arrow keys or type a channel number to change stations.'); document.documentElement.style.setProperty('--st',s.c); place(); }
setInterval(fill,30000);
function gClk(){ var n=new Date(), t=clock(n.getHours()*60+n.getMinutes()); $('gClock').textContent=t; $('mobClock').textContent=t; } gClk(); setInterval(gClk,30000);

var snd=false, ac=null;
$('snd').addEventListener('click',function(){ snd=!snd; this.querySelector('span').textContent=snd?'Sound on':'Sound off'; this.setAttribute('aria-pressed',snd); if(snd&&!ac){ try{ ac=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} } });
function hiss(){ if(!snd||!ac) return; var len=ac.sampleRate*.3, b=ac.createBuffer(1,len,ac.sampleRate), d=b.getChannelData(0); for(var i=0;i<len;i++) d[i]=(Math.random()*2-1)*(1-i/len); var src=ac.createBufferSource(); src.buffer=b; var g=ac.createGain(); g.gain.value=.12; var f=ac.createBiquadFilter(); f.type='highpass'; f.frequency.value=900; src.connect(f); f.connect(g); g.connect(ac.destination); src.start(); }

function tune(i){ i=(i+S.length)%S.length; if(i===cur&&!changing) return; cur=i; hiss(); mapWall();
  if(RM){ fill(); return; }
  changing=true; screen.classList.add('changing'); hero.classList.add('changing'); noise.style.opacity=1; screen.classList.remove('roll'); void screen.offsetWidth; screen.classList.add('roll');
  $('osdNum').textContent=(S[i].b==='fm'?'FM ':'')+S[i].n; $('osdCs').textContent=S[i].cs; place();
  clearTimeout(tune.t); tune.t=setTimeout(function(){ fill(); noise.style.opacity=0; setTimeout(function(){ changing=false; screen.classList.remove('changing'); hero.classList.remove('changing'); },200); },380);
}
$('prev').addEventListener('click',function(){ tune(cur-1); }); $('next').addEventListener('click',function(){ tune(cur+1); });

function pos(s){ var v=parseFloat(s.n); return s.b==='fm'?{seg:'segFm',p:(v-88)/20}:{seg:'segTv',p:(v-2)/67}; }
(function(){ var h='';
  for(var n=2;n<=69;n++){ h+='<span class="tick'+(n%10===0?' big':'')+'" style="left:'+((n-2)/67*100)+'%"></span>'; if(n===2||n%10===0) h+='<span class="tick tl" style="left:'+((n-2)/67*100)+'%">'+n+'</span>'; } $('segTv').insertAdjacentHTML('beforeend',h);
  h=''; for(var f=88;f<=108;f++){ h+='<span class="tick'+(f%4===0?' big':'')+'" style="left:'+((f-88)/20*100)+'%"></span>'; if(f%4===0) h+='<span class="tick tl" style="left:'+((f-88)/20*100)+'%">'+f+'</span>'; } $('segFm').insertAdjacentHTML('beforeend',h);
  S.forEach(function(s,i){ var p=pos(s); var b=document.createElement('button'); b.className='st-mark'; b.style.left=(p.p*100)+'%'; b.style.setProperty('--c',s.c); b.innerHTML='<span>'+s.cs+'</span>'; b.setAttribute('aria-label','Tune to '+s.n+' '+s.cs); b.addEventListener('click',function(){ tune(i); }); $(p.seg).appendChild(b); s.mark=b; });
})();
function place(){ var s=S[cur], p=pos(s), seg=$(p.seg), band=$('band'); var br=band.getBoundingClientRect(), sr=seg.getBoundingClientRect(); $('needle').style.left=(sr.left-br.left+p.p*sr.width)+'px'; S.forEach(function(x,i){ x.mark.classList.toggle('on',i===cur); }); }
addEventListener('resize',place);
(function(){ var band=$('band'), down=false;
  function nearest(cx){ var best=0,bd=1e9; S.forEach(function(s,i){ var r=s.mark.getBoundingClientRect(); var d=Math.abs(r.left+r.width/2-cx); if(d<bd){bd=d;best=i;} }); return best; }
  band.addEventListener('pointerdown',function(e){ if(e.target.closest('.st-mark')) return; down=true; band.setPointerCapture(e.pointerId); tune(nearest(e.clientX)); });
  band.addEventListener('pointermove',function(e){ if(down){ var i=nearest(e.clientX); if(i!==cur) tune(i); } });
  band.addEventListener('pointerup',function(){ down=false; });
})();
var buf='', bufT;
addEventListener('keydown',function(e){ if(e.target.closest('input,textarea')) return; if(heroP>.3) return; var r=hero.getBoundingClientRect(); if(r.bottom<200) return;
  if(e.key==='ArrowRight'||e.key==='ArrowUp'){ e.preventDefault(); tune(cur+1); }
  else if(e.key==='ArrowLeft'||e.key==='ArrowDown'){ e.preventDefault(); tune(cur-1); }
  else if(/^[0-9.]$/.test(e.key)){ buf+=e.key; $('kbuf').textContent=buf; $('kbuf').classList.add('show'); clearTimeout(bufT); bufT=setTimeout(function(){ var v=parseFloat(buf), best=-1, bd=1e9; S.forEach(function(s,i){ var d=Math.abs(parseFloat(s.n)-v); if(d<bd){bd=d;best=i;} }); $('kbuf').classList.remove('show'); buf=''; if(best>=0) tune(best); },900); }
});
(function(){ var sx=null,sy=0; screen.addEventListener('touchstart',function(e){ sx=e.touches[0].clientX; sy=e.touches[0].clientY; },{passive:true}); screen.addEventListener('touchend',function(e){ if(sx===null) return; var dx=e.changedTouches[0].clientX-sx, dy=e.changedTouches[0].clientY-sy; if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.4) tune(cur+(dx<0?1:-1)); sx=null; }); })();
/* hero copy also swipes */
(function(){ var sx=null,sy=0, el=$('pin'); el.addEventListener('touchstart',function(e){ if(e.target.closest('a,button,.band')) return; sx=e.touches[0].clientX; sy=e.touches[0].clientY; },{passive:true}); el.addEventListener('touchend',function(e){ if(sx===null) return; var dx=e.changedTouches[0].clientX-sx, dy=e.changedTouches[0].clientY-sy; if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.4) tune(cur+(dx<0?1:-1)); sx=null; }); })();
fill();
$('afterB').textContent=(S.length===9?'Nine':S.length)+' stations on tonight'; $('afterDots').innerHTML=S.map(function(s){ return '<i style="--c:'+s.c+'"></i>'; }).join('');
(function(){ var pw=$('power'); if(RM){ pw.remove(); document.body.classList.add('on'); return; } requestAnimationFrame(function(){ pw.classList.add('go'); }); setTimeout(function(){ document.body.classList.add('on'); },650); setTimeout(function(){ pw.remove(); },1500); })();
/* mouse parallax on the picture */
if(FINE&&!RM) $('pin').addEventListener('mousemove',function(e){ var x=e.clientX/innerWidth-.5, y=e.clientY/innerHeight-.5; pic.style.setProperty('--px',(-x*18).toFixed(1)+'px'); pic.style.setProperty('--py',(-y*12).toFixed(1)+'px'); });

/* ---------- crawl ---------- */
(function(){ var h=S.map(function(s){ var sl=slot(s); return '<span class="it" style="--c:'+s.c+'"><i></i><b>'+s.n+' '+s.cs+'</b>'+sl.prog+', until '+clock(sl.end)+'</span>'; }).join(''); $('crawl').innerHTML=h+h; })();

/* ---------- peek (floating preview) ---------- */
var peek=$('peek'), pk=peek.querySelector('canvas').getContext('2d'), pkS=null, pkOn=false, mx=0, my=0, pxx=0, pyy=0;
function showPeek(s,label){ if(!FINE) return; pkS=s; pkOn=true; peek.classList.add('show'); peek.style.setProperty('--pc',s.c); peek.querySelector('.ch').textContent=s.n; peek.querySelector('.lb').textContent=label||s.cs; }
function hidePeek(){ pkOn=false; peek.classList.remove('show'); }

/* ---------- guide ---------- */
(function(){ var now=new Date(), m=now.getHours()*60+now.getMinutes(), st=Math.floor(m/30)*30-30, span=210, h='<div class="g-time"><span class="g-corner">Station</span><div class="ts">';
  for(var k=0;k<span;k+=30) h+='<span style="left:'+(k/span*100)+'%">'+clock(st+k)+'</span>'; h+='</div></div>';
  S.forEach(function(s,i){ h+='<div class="g-row" data-i="'+i+'" data-b="'+s.b+'" style="--c:'+s.c+'" role="button" tabindex="0" aria-label="Tune to '+s.n+' '+s.cs+'" data-cur="Tune"><div class="g-st"><span class="badge">'+s.n+'</span><div><b>'+s.cs+'</b><small>'+s.name+'</small></div></div><div class="g-progs">';
    var a=Math.floor(st/s.len)*s.len; for(var x=a;x<st+span;x+=s.len){ var n=s.p.length, title=s.p[((Math.floor(x/s.len)%n)+n)%n]; var l=Math.max(x,st), r=Math.min(x+s.len,st+span); var isNow=m>=x&&m<x+s.len, past=x+s.len<=m; var pct=isNow?((m-x)/s.len*100).toFixed(0):0;
      h+='<div class="g-p'+(isNow?' now':'')+(past?' past':'')+'" style="left:calc('+((l-st)/span*100)+'% + 3px);width:calc('+((r-l)/span*100)+'% - 6px)">'+(isNow?'<em>Now</em>':'')+'<strong>'+title+'</strong><small>'+clock(x)+' to '+clock(x+s.len)+'</small>'+(isNow?'<span class="pb"><i style="width:'+pct+'%"></i></span>':'')+'</div>'; }
    h+='</div></div>'; });
  h+='<div class="g-now" id="gNow"><span id="gNowT"></span></div>'; $('gIn').innerHTML=h;
  function nowL(){ var n=new Date(), mm=n.getHours()*60+n.getMinutes()+n.getSeconds()/60; var ts=$('gIn').querySelector('.g-time .ts'); $('gNow').style.left=(ts.offsetLeft+(mm-st)/span*ts.offsetWidth)+'px'; $('gNowT').textContent=clock(Math.floor(mm)); } nowL(); setInterval(nowL,20000); addEventListener('resize',nowL);
  $('gIn').querySelectorAll('.g-row').forEach(function(r){ var i=+r.dataset.i; function go(){ tune(i); scrollToTop(); } r.addEventListener('click',go); r.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); go(); } }); r.addEventListener('mouseenter',function(){ showPeek(S[i]); }); r.addEventListener('mouseleave',hidePeek); });
  document.querySelectorAll('.seg2 button').forEach(function(bt){ bt.addEventListener('click',function(){ document.querySelectorAll('.seg2 button').forEach(function(x){ x.classList.toggle('on',x===bt); }); var f=bt.dataset.f; $('gIn').querySelectorAll('.g-row').forEach(function(r){ r.hidden=!(f==='all'||r.dataset.b===f); }); }); });
})();

/* ---------- call signs: the letters are the screen ---------- */
var signs=[], off=document.createElement('canvas'); off.width=240; off.height=120; var ox=off.getContext('2d');
S.forEach(function(s,i){ var sl=slot(s); var a=document.createElement('a'); a.className='sg'; a.href='#top'; a.style.setProperty('--c',s.c); a.setAttribute('data-cur','Tune');
  a.className='cell stn'; a.style.cssText+=';--d:4;--t:3;--m:1'; a.innerHTML='<div class="mh"><span class="ch">'+(s.b==='fm'?'FM ':'')+s.n+'</span><span class="air"><i></i>On now</span></div><div class="cv"><canvas aria-hidden="true"></canvas><span class="sr">'+s.cs+'</span></div><div class="mf col"><div class="nm"><b>'+s.name+'</b><span>'+s.who+'</span></div><div class="onn"><strong>'+sl.prog+'</strong><small>until '+clock(sl.end)+'</small><span class="pb"><i style="width:'+(sl.pct*100).toFixed(0)+'%"></i></span></div></div><span class="key"><svg viewBox="0 0 20 20"><path d="M5 10h10M10.5 5.5 15 10l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  a.setAttribute('aria-label','Tune to '+s.n+' '+s.cs+', '+s.name);
  a.addEventListener('click',function(e){ e.preventDefault(); tune(i); scrollToTop(); });
  $('signs').appendChild(a); var c=a.querySelector('canvas'); var o={a:a,c:c,x:c.getContext('2d'),s:s,hot:false,k:i};
  a.addEventListener('mouseenter',function(){ o.hot=true; }); a.addEventListener('mouseleave',function(){ o.hot=false; });
  signs.push(o); });
(function(){ var a=document.createElement('a'); a.className='cell stn-cta'; a.href='#run'; a.setAttribute('data-cur','Open'); a.style.cssText='--d:12;--t:3;--m:1;--c:#F3EAD9';
  a.innerHTML='<div class="mh"><span class="ch">__.1</span><span>Open</span></div><div class="cb"><h3>Room on the dial.</h3><p>Pick a number and a call sign. Free to start.</p></div><div class="mf"><span>Run a station</span><span class="key"><svg viewBox="0 0 20 20"><path d="M5 10h10M10.5 5.5 15 10l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span></div>';
  $('signs').appendChild(a); })();
(function(){ var r=$('rul'); if(!r) return; var h=''; S.forEach(function(s){ if(s.b!=='tv') return; var p=(parseFloat(s.n)-2)/67*100; h+='<span class="mk" style="left:'+p.toFixed(2)+'%;--c:'+s.c+'"><b>'+s.cs+'</b></span>'; });
  h+='<span class="mk you" style="left:'+((44-2)/67*100).toFixed(2)+'%"><b>You?</b></span>'; r.innerHTML=h+'<span class="lo">2</span><span class="hi">69</span>'; })();
function sizeSigns(){ var dpr=Math.min(2,devicePixelRatio||1); signs.forEach(function(o){ var r=o.c.parentNode.getBoundingClientRect(); o.c.width=Math.round(r.width*dpr); o.c.height=Math.round(r.height*dpr); o.fs=o.c.height*1.12; var ctx=o.x; ctx.font='900 100px "Big Shoulders Display", Impact, sans-serif'; var w100=ctx.measureText(o.s.cs).width||1; o.fs=Math.min(o.fs, o.c.width*.98/w100*100); }); }
function paintSign(o,t){ var w=o.c.width, h=o.c.height, x=o.x; off.height=Math.max(60,Math.round(240*h/w)); draw(ox,240,off.height,t,o.s); x.globalCompositeOperation='source-over'; x.clearRect(0,0,w,h); x.font='900 '+o.fs+'px "Big Shoulders Display", Impact, sans-serif'; x.textBaseline='alphabetic'; x.fillStyle=o.s.c; x.fillText(o.s.cs,0,h*.9); x.globalCompositeOperation='source-atop'; x.globalAlpha=.62; x.drawImage(off,0,0,w,h); x.globalAlpha=1; x.globalCompositeOperation='source-over'; }
function paintAll(){ sizeSigns(); signs.forEach(function(o){ paintSign(o,o.k*5+2); }); }
(document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(paintAll); addEventListener('resize',paintAll);
var signsVis=false; new IntersectionObserver(function(e){ signsVis=e[0].isIntersecting; }).observe($('signs'));
if(!FINE){ var lio=new IntersectionObserver(function(es){ es.forEach(function(e){ var o=signs.filter(function(x){return x.a===e.target;})[0]; o.hot=e.isIntersecting; e.target.classList.toggle('lit',e.isIntersecting); }); },{rootMargin:'-42% 0px -42% 0px'}); signs.forEach(function(o){ lio.observe(o.a); }); }

/* ---------- the break ---------- */
var B=S[1], PARTS=[
 ['Late Crate',10,'#C04A9E','And now, a break.','Late Crate wraps a segment. The break starts on time, because the station scheduled it.'],
 ['Bumper',5,'#C04A9E','The bumper.','Five seconds in BEAT’s own look, so you always know where you are and when the show is back.'],
 ['Juniper Barber Co.',30,'#E08A2C','A spot from down the street.','A barbershop bought thirty seconds on the station its customers watch. The code on the end card tells them it worked.'],
 ['Redlands Hardware',30,'#E8402F','And a proper commercial.','Shot like the ads you grew up with. Shops nearby and brands online buy spots by the station and the hour in the spot market.'],
 ['Members',15,'#5B7BE0','A thank-you.','Underwriters and members keep the station on, so they get a credit, like public television.'],
 ['Station ID',5,'#C04A9E','The station ID.','Call sign, number, market. The break ends where it started: on 12.1.'],
 ['Late Crate',10,'#C04A9E','And we’re back.','A minute and forty-five seconds, all of it local, all of it paying the people who make the channel.']];
var TOT=PARTS.reduce(function(a,p){return a+p[1];},0);
$('tl').innerHTML=PARTS.map(function(p){ return '<div style="flex:'+p[1]+'"><i></i></div>'; }).join(''); $('tlNames').innerHTML=PARTS.map(function(p){ return '<span style="flex:'+p[1]+'">'+(p[1]<10?'':(p[0]==='Juniper Barber Co.'||p[0]==='Redlands Hardware'?'Spot, 0:'+p[1]:p[0]))+'</span>'; }).join('');
var bc=$('brkC'), bx=bc.getContext('2d'), BW=800, BH=500, curPart=-1, bK=0, bLt=0, bTT=0, brkVis=false;
bc.width=1280; bc.height=800;
var FD='"Big Shoulders Display", Impact, sans-serif', FT='"Instrument Sans", Arial, sans-serif', FO='"VT323", "Courier New", monospace';
function bf(w,s,f){ return w+' '+s+'px '+(f||FD); }
function tx(t,x,y,font,col,al,ls){ bx.font=font; bx.fillStyle=col; bx.textAlign=al||'left'; bx.textBaseline='alphabetic'; var L='letterSpacing' in bx; if(L) bx.letterSpacing=(ls||0)+'px'; bx.fillText(t,x,y); if(L) bx.letterSpacing='0px'; }
function rc(x,y,w,h,c){ bx.fillStyle=c; bx.fillRect(x,y,w,h); }
function rr(x,y,w,h,r,c){ bx.beginPath(); if(bx.roundRect) bx.roundRect(x,y,w,h,r); else bx.rect(x,y,w,h); bx.fillStyle=c; bx.fill(); }
function ez(t){ t=clamp(t); return 1-Math.pow(1-t,3); }
function sg(t,a,b){ return clamp((t-a)/(b-a)); }
function lg(y0,y1,a,b){ var g=bx.createLinearGradient(0,y0,0,y1); g.addColorStop(0,a); g.addColorStop(1,b); return g; }
function flash(lt,at,w){ w=w||.014; var d=Math.abs(lt-at); if(d<w){ rc(0,0,BW,BH,'rgba(255,255,255,'+((1-d/w)*.85).toFixed(3)+')'); } }
function hsh(i){ var x=Math.sin(i*127.1+311.7)*43758.5453; return x-Math.floor(x); }
function bug(a){ bx.globalAlpha=.8*(a==null?1:a); tx('12.1',BW-112,48,bf(400,28,FO),'#fff','right'); tx('BEAT',BW-36,48,bf(900,28),'#fff','right',1); bx.globalAlpha=1; }
function sup(t,sub,a,col,dark){ if(a<=0) return; var x=56-(1-ez(a))*40; bx.globalAlpha=ez(a); rc(x,BH-128,6,sub?72:52,col); tx(t,x+22,BH-(sub?84:86),bf(900,46),dark?'#1a1410':'#fff','left',.5); if(sub) tx(sub,x+22,BH-58,bf(500,19,FT),dark?'rgba(26,20,16,.7)':'rgba(255,255,255,.8)'); bx.globalAlpha=1; }
function shade(){ var g=bx.createLinearGradient(0,BH*.55,0,BH); g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,'rgba(0,0,0,.65)'); bx.fillStyle=g; bx.fillRect(0,0,BW,BH); }
function push(s,cx,cy){ bx.translate(cx,cy); bx.scale(s,s); bx.translate(-cx,-cy); }

/* ---- program, with lower third ---- */
function fProgram(lt,T,back){ draw(bx,BW,BH,T*.4,B); bug();
  var a=back?sg(lt,.18,.3)-sg(lt,.8,.9):sg(lt,.08,.2)-sg(lt,.55,.65);
  if(a>0){ var x=56-(1-ez(a))*60; bx.globalAlpha=ez(a); rr(x,BH-132,330,46,6,B.c); tx('LATE CRATE',x+18,BH-97,bf(900,32),'#fff','left',1.5); rr(x,BH-82,330,34,6,'rgba(10,6,16,.82)'); tx(back?'Side B, all requests':'with Marisol, live from Pomona',x+18,BH-59,bf(500,16,FT),'rgba(255,255,255,.85)'); bx.globalAlpha=1; }
  if(!back&&lt>.66&&lt<.88){ var b=sg(lt,.66,.72); bx.globalAlpha=b; rr(BW-246,BH-80,210,36,18,'rgba(10,6,16,.8)'); rc(BW-230,BH-66,8,8,'#FF4A3D'); tx('Back after the break',BW-214,BH-57,bf(600,15,FT),'#fff'); bx.globalAlpha=1; }
  if(!back&&lt>.86) rc(0,0,BW,BH,'rgba(0,0,0,'+sg(lt,.86,1)+')');
  if(back&&lt<.18) rc(0,0,BW,BH,'rgba(0,0,0,'+(1-sg(lt,0,.18))+')'); }

/* ---- bumper ---- */
function fBumper(lt,T){ var g=bx.createRadialGradient(560,250,20,560,250,520); g.addColorStop(0,'#3a0f3a'); g.addColorStop(1,'#0c0410'); bx.fillStyle=g; bx.fillRect(0,0,BW,BH);
  var rx=170-(1-ez(lt*2))*200, ry=250; bx.save(); bx.translate(rx,ry); bx.rotate(T*2.4); rr(-215,-215,430,430,215,'#0a0a0c'); bx.strokeStyle='rgba(255,255,255,.06)'; bx.lineWidth=1; for(var r=90;r<212;r+=7){ bx.beginPath(); bx.arc(0,0,r,0,7); bx.stroke(); } bx.strokeStyle='rgba(255,255,255,.18)'; bx.lineWidth=10; bx.beginPath(); bx.arc(0,0,160,-.5,.2); bx.stroke(); rr(-78,-78,156,156,78,B.c); rr(-8,-8,16,16,8,'#0c0410'); bx.restore();
  var s=ez(sg(lt,.05,.5)); bx.save(); bx.globalAlpha=s; var x=360+(1-s)*140; bx.font=bf(900,230); if('letterSpacing' in bx) bx.letterSpacing='4px'; bx.textAlign='left'; bx.lineWidth=2; for(var e2=3;e2>=1;e2--){ bx.strokeStyle='rgba(192,74,158,'+(.5-e2*.12)+')'; bx.strokeText('BEAT',x+e2*12,300+e2*10); } if('letterSpacing' in bx) bx.letterSpacing='0px'; tx('BEAT',x,300,bf(900,230),B.c,'left',4); bx.restore();
  for(var j=0;j<44;j++){ var h=6+Math.abs(Math.sin(T*5+j*.7)*Math.cos(T*1.3+j*.21))*46; rc(372+j*9.4,BH-40-h,6,h,j%7===0?'#fff':'rgba(192,74,158,.85)'); }
  tx('12.1',BW-40,58,bf(400,44,FO),'#E9FFE8','right'); bx.globalAlpha=sg(lt,.35,.6); tx('LATE CRATE',372,346,bf(800,26),'#fff','left',3); tx('Back in a minute forty',372,372,bf(500,17,FT),'rgba(255,255,255,.7)'); bx.globalAlpha=1; }

/* ---- spot 1: Juniper Barber Co. (with a code on the end card) ---- */
function pole(x,y,h,T){ rr(x-6,y-16,56,18,6,'#c9c9c9'); rr(x-6,y+h-2,56,18,6,'#c9c9c9'); bx.save(); bx.beginPath(); bx.rect(x,y,44,h); bx.clip(); rc(x,y,44,h,'#f4f1ea'); for(var i=-6;i<h/22+6;i++){ var yy=y+i*44+((T*40)%44); bx.fillStyle=i%2?'#c8262c':'#1f4aa8'; bx.beginPath(); bx.moveTo(x,yy); bx.lineTo(x+44,yy-30); bx.lineTo(x+44,yy-16); bx.lineTo(x,yy+14); bx.fill(); } var g=bx.createLinearGradient(x,0,x+44,0); g.addColorStop(0,'rgba(0,0,0,.35)'); g.addColorStop(.4,'rgba(255,255,255,.25)'); g.addColorStop(1,'rgba(0,0,0,.4)'); bx.fillStyle=g; bx.fillRect(x,y,44,h); bx.restore(); }
function chair(cx,cy,s,col){ bx.save(); bx.translate(cx,cy); bx.scale(s,s); bx.fillStyle=col; rr(-28,-100,56,40,12,col); rc(-45,-60,90,10,col); rr(-65,-50,130,120,14,col); rr(-80,60,160,40,10,col); rc(-8,100,16,60,col); rr(-50,156,100,14,6,col); rr(-95,40,20,20,6,col); rr(75,40,20,20,6,col); bx.restore(); }
function qr(x,y,s){ var n=21, c=s/n; rc(x-c*2,y-c*2,s+c*4,s+c*4,'#fff'); for(var i=0;i<n;i++) for(var j=0;j<n;j++){ var f=(i<7&&j<7)||(i>n-8&&j<7)||(i<7&&j>n-8); if(!f&&hsh(i*31+j*7+3)>.52) rc(x+i*c,y+j*c,c+.4,c+.4,'#111'); }
  [[0,0],[n-7,0],[0,n-7]].forEach(function(p){ rc(x+p[0]*c,y+p[1]*c,7*c,7*c,'#111'); rc(x+(p[0]+1)*c,y+(p[1]+1)*c,5*c,5*c,'#fff'); rc(x+(p[0]+2)*c,y+(p[1]+2)*c,3*c,3*c,'#111'); }); }
function fJuniper(lt,T){
  if(lt<.36){ var a=lt/.36; bx.save(); push(1+a*.06,400,260);
    bx.fillStyle=lg(0,BH,'#241a3a','#4a2a40'); bx.fillRect(0,0,BW,BH);
    rc(0,120,BW,BH,'#3a2321'); bx.fillStyle='rgba(0,0,0,.25)'; for(var r=0;r<20;r++){ rc(0,120+r*20,BW,2,'rgba(0,0,0,.28)'); for(var c=0;c<14;c++) rc(((r%2)*30+c*60)%BW,120+r*20,2,20,'rgba(0,0,0,.22)'); }
    var w=bx.createLinearGradient(0,170,0,430); w.addColorStop(0,'#ffcf8a'); w.addColorStop(1,'#d4783a'); rr(120,170,440,260,4,w); rc(116,166,448,8,'#1a1210'); rc(336,170,6,260,'#1a1210');
    chair(228,300,.55,'rgba(45,22,12,.85)'); chair(450,300,.55,'rgba(45,22,12,.85)'); rc(120,296,440,2,'rgba(60,30,14,.35)'); bx.save(); bx.globalAlpha=.5; rr(268,182,12,40,4,'#5a3010'); rr(254,220,40,14,7,'#5a3010'); bx.restore();
    var fl=(hsh(Math.floor(T*9))>.12)?1:.35; bx.save(); bx.shadowColor='#5ff2d2'; bx.shadowBlur=26*fl; tx('Juniper',340,262,'italic '+bf(800,92),'rgba(140,255,228,'+(.95*fl)+')','center',2); bx.restore();
    pole(640,150,230,T); bx.restore(); shade(); sup('Fades. Beard trims.','Juniper Barber Co., Orange St',sg(lt,.05,.12),'#5ff2d2'); }
  else if(lt<.68){ var b=(lt-.36)/.32; bx.save(); push(1.04-b*.04,400,250);
    rc(0,0,BW,BH,'#12302b'); for(var i=0;i<12;i++) for(var j=0;j<4;j++) if((i+j)%2) rc(i*70-((j*20)%70),380+j*32,70,32,'rgba(240,235,220,.85)'); else rc(i*70-((j*20)%70),380+j*32,70,32,'#141414');
    rr(250,60,300,250,10,'#0b1c19'); bx.fillStyle=lg(70,300,'#5f7f78','#2c4743'); bx.fillRect(266,76,268,218);
    for(var k=0;k<7;k++){ [[266+k*44.6,64],[266+k*44.6,306]].forEach(function(p){ bx.save(); bx.shadowColor='#ffd89a'; bx.shadowBlur=14; rr(p[0]-6,p[1]-6,12,12,6,'#fff3d6'); bx.restore(); }); }
    chair(400,250,1,'#0a0a0a');
    var on=(Math.floor(T*1.6)%4)!==3; rr(610,90,140,58,10,'rgba(0,0,0,.45)'); bx.save(); bx.shadowColor='#ff4a6a'; bx.shadowBlur=on?22:0; bx.strokeStyle=on?'#ff7a8e':'rgba(255,122,142,.25)'; bx.lineWidth=3; bx.strokeRect(618,98,124,42); tx('OPEN',680,133,bf(800,32),on?'#ffd0d8':'rgba(255,208,216,.25)','center',6); bx.restore();
    bx.restore(); shade(); sup('Walk-ins until 8.','Tuesday to Saturday',sg(b,.08,.2),'#5ff2d2'); }
  else { var c2=(lt-.68)/.32; rc(0,0,BW,BH,'#efe6d6'); rc(0,0,BW,10,'#1b2a26'); rc(0,BH-10,BW,10,'#1b2a26');
    bx.globalAlpha=ez(sg(c2,0,.2)); tx('JUNIPER',300,170,bf(900,120),'#1b2a26','center',6); rc(140,196,90,3,'#c8262c'); rc(370,196,90,3,'#c8262c'); tx('BARBER CO.',300,206,bf(800,26),'#1b2a26','center',6); tx('EST. 2009 · REDLANDS',300,244,bf(600,15,FT),'rgba(27,42,38,.6)','center',3);
    bx.globalAlpha=ez(sg(c2,.15,.35)); tx('214 Orange St',80,330,bf(700,24,FT),'#1b2a26'); tx('Tuesday to Saturday, 10 to 8',80,362,bf(500,19,FT),'rgba(27,42,38,.7)'); tx('Walk-ins welcome',80,390,bf(500,19,FT),'rgba(27,42,38,.7)');
    var cy=ez(sg(c2,.3,.5)); bx.globalAlpha=cy; bx.save(); bx.translate(0,(1-cy)*30); rr(540,60,220,380,14,'#fff'); bx.setLineDash([7,6]); bx.strokeStyle='#1b2a26'; bx.lineWidth=2; bx.strokeRect(552,72,196,356); bx.setLineDash([]);
    tx('$5 OFF',650,128,bf(900,52),'#c8262c','center',1); tx('ANY CUT THIS MONTH',650,154,bf(700,13,FT),'#1b2a26','center',2); qr(590,180,120); tx('SHOW AT THE CHAIR',650,350,bf(700,12,FT),'rgba(27,42,38,.6)','center',2); tx('BEAT12',650,394,bf(400,40,FO),'#1b2a26','center',4); bx.restore(); bx.globalAlpha=1; }
  flash(lt,.36); flash(lt,.68); }

/* ---- spot 2: Redlands Hardware, a straight commercial ---- */
var BOX=['#c8262c','#f0b429','#2f6fb3','#e8e4da','#3d8c5a','#d9732b','#7a4fb0','#222'];
function fRedlands(lt,T){
  if(lt<.3){ var a=lt/.3; bx.save(); push(1+a*.22,400,232); var vx=400, vy=232;
    bx.fillStyle=lg(0,BH,'#d8d2c4','#8c8475'); bx.fillRect(0,0,BW,BH); bx.fillStyle='#6b6458'; bx.beginPath(); bx.moveTo(0,BH); bx.lineTo(vx-30,vy+40); bx.lineTo(vx+30,vy+40); bx.lineTo(BW,BH); bx.fill();
    for(var t=0;t<5;t++){ var z=Math.pow(.62,t); bx.save(); bx.shadowColor='#fffbe8'; bx.shadowBlur=18; rc(vx-260*z,vy-210*z-6,520*z,6*z+2,'#fffdf2'); bx.restore(); }
    [-1,1].forEach(function(sd){ for(var d=11;d>=0;d--){ var z0=Math.pow(.8,d), z1=Math.pow(.8,d+1); var x0=vx+sd*380*z0, x1=vx+sd*380*z1; for(var row=0;row<5;row++){ var y0=vy+(-180+row*86)*z0, y1=vy+(-180+row*86)*z1, h0=70*z0;
      bx.fillStyle=BOX[Math.floor(hsh(d*13+row*5+(sd>0?77:0))*BOX.length)]; bx.beginPath(); bx.moveTo(x0,y0); bx.lineTo(x1,y1); bx.lineTo(x1,y1+70*z1); bx.lineTo(x0,y0+h0); bx.fill(); bx.fillStyle='rgba(0,0,0,'+(.1+d*.04)+')'; bx.fill(); rc(Math.min(x0,x1),y0+h0,Math.abs(x0-x1)+1,6*z0,'#3c3a36'); } } });
    bx.restore(); shade(); sup('Since 1962.','Redlands Hardware, Orange St',sg(lt,.08,.16),'#e8402f'); }
  else if(lt<.58){ var b=(lt-.3)/.28; rc(0,0,BW,BH,'#17120e'); var g=bx.createRadialGradient(470,250,10,470,250,380); g.addColorStop(0,'rgba(255,170,80,.25)'); g.addColorStop(1,'rgba(0,0,0,0)'); bx.fillStyle=g; bx.fillRect(0,0,BW,BH);
    bx.save(); bx.translate(500,270); bx.rotate(T*14); rr(-120,-120,240,240,120,'#5a554e'); bx.strokeStyle='rgba(255,255,255,.12)'; bx.lineWidth=2; for(var s=0;s<24;s++){ bx.rotate(Math.PI/12); bx.beginPath(); bx.moveTo(30,0); bx.lineTo(118,0); bx.stroke(); } rr(-22,-22,44,44,22,'#2a2724'); bx.restore();
    var kx=100+((b*1.4)%1)*120; bx.fillStyle='#d4a94a'; rr(kx,206,96,96,48,'#d4a94a'); rr(kx+28,234,40,40,20,'#17120e'); bx.fillStyle='#d4a94a'; bx.beginPath(); bx.moveTo(kx+90,232); bx.lineTo(kx+300,232); for(var n=0;n<7;n++){ bx.lineTo(kx+300-n*28,232+((n%2)?28:16)); } bx.lineTo(kx+90,276); bx.fill(); rc(kx+90,240,200,4,'rgba(0,0,0,.25)');
    for(var p=0;p<70;p++){ var ph=(T*1.6+hsh(p))%1, an=-2.6+hsh(p*3)*1.5, sp=180+hsh(p*7)*260; var sx=392+Math.cos(an)*sp*ph, sy=255+Math.sin(an)*sp*ph+ph*ph*160; bx.strokeStyle='rgba(255,'+(170+Math.floor(hsh(p*5)*80))+',60,'+(1-ph)+')'; bx.lineWidth=2; bx.beginPath(); bx.moveTo(sx,sy); bx.lineTo(sx-Math.cos(an)*14,sy-Math.sin(an)*14-ph*8); bx.stroke(); }
    shade(); sup('Keys cut while you wait.','House keys, padlocks, the odd antique',sg(b,.08,.2),'#e8402f'); }
  else if(lt<.84){ var c=(lt-.58)/.26; rc(0,0,BW,BH,'#f3eee4'); var CH=['#c8262c','#e8742b','#f0b429','#9cc25a','#3d8c5a','#2f8f9c','#2f6fb3','#5a3fa0','#b0407a','#3a3633'];
    bx.save(); bx.translate(400,560); var spread=ez(c*1.6)*1.3; for(var i=0;i<CH.length;i++){ bx.save(); bx.rotate(-spread/2+spread*i/(CH.length-1)); rr(-34,-440,68,300,6,'#fff'); rc(-28,-434,56,200,CH[i]); tx(('RH-'+(100+i*7)),0,-212,bf(600,9,FT),'#555','center',1); bx.restore(); } bx.restore();
    sup('Paint matched in ten minutes.','Bring a chip, a cushion, a coffee mug',sg(c,.1,.25),'#c8262c',true); }
  else { var d2=(lt-.84)/.16; rc(0,0,BW,BH,'#b3261e'); bx.globalAlpha=.12; for(var k=0;k<30;k++) rc(0,k*18,BW,8,'#000'); bx.globalAlpha=1;
    var s1=ez(sg(d2,0,.3)); bx.globalAlpha=s1; tx('REDLANDS',400,210-(1-s1)*20,bf(900,128),'#fff','center',4); var s2=ez(sg(d2,.12,.4)); bx.globalAlpha=s2; tx('HARDWARE',400,320,bf(900,128),'#ffd9a0','center',4);
    bx.globalAlpha=ez(sg(d2,.3,.6)); rc(250,350,300,3,'#fff'); tx('ORANGE ST · OPEN 7 DAYS, 7 TO 7',400,392,bf(700,17,FT),'#fff','center',3); tx('Since 1962',400,440,'italic '+bf(800,26),'rgba(255,255,255,.8)','center'); bx.globalAlpha=1; }
  flash(lt,.3); flash(lt,.58); flash(lt,.84); }

/* ---- members ---- */
var MEM=['Ana R.','Luis M.','Dee W.','Marcus T.','Priya S.','The Okafor family','Jo L.','Ray C.','Tomás A.','Kim N.','Bea F.','Sam & Lu','Hector V.','Noor H.','Grace P.','Eli D.','Rosa G.','Ken Y.','Maya B.','Otis J.','Lena K.','Frank Q.','Ivy Z.','Pomona Vinyl Club','Dario E.','June A.','Will S.','Carmen O.','Ty R.','Ines L.'];
function fMembers(lt,T){ bx.fillStyle=lg(0,BH,'#0a1236','#060a1f'); bx.fillRect(0,0,BW,BH);
  bx.globalAlpha=ez(sg(lt,0,.12)); tx('Late Crate is made possible by',400,62,bf(500,18,FT),'rgba(255,255,255,.7)','center');
  var U=[['Juniper Barber Co.',bf(900,24)],['POMONA RECORD EXCHANGE',bf(700,15,FT)],['Redlands Hardware','italic '+bf(800,24)]];
  U.forEach(function(u,i){ var a=ez(sg(lt,.06+i*.06,.18+i*.06)); bx.globalAlpha=a; rr(64+i*232,86,208,62,6,'rgba(255,255,255,.07)'); tx(u[0],168+i*232,124,u[1],'#fff','center',i===1?2:.5); });
  bx.globalAlpha=1; bx.save(); bx.beginPath(); bx.rect(0,176,BW,232); bx.clip(); var off=sg(lt,.2,1)*560;
  tx('AND MEMBERS OF 12.1 BEAT',400,214-off+40,bf(700,13,FT),'#7f9cff','center',3);
  MEM.forEach(function(m,i){ tx(m,i%2?470:330,262+Math.floor(i/2)*34-off+40,bf(500,19,FT),'#fff',i%2?'left':'right'); }); bx.restore();
  bx.fillStyle=lg(176,216,'#0a1236','rgba(10,18,54,0)'); bx.fillRect(0,176,BW,40); bx.fillStyle=lg(368,408,'rgba(7,11,33,0)','#070b21'); bx.fillRect(0,368,BW,40);
  bx.globalAlpha=ez(sg(lt,.55,.7)); rc(300,430,200,1,'rgba(255,255,255,.25)'); tx('Join them: 12.1 BEAT, Members',400,462,bf(600,16,FT),'rgba(255,255,255,.8)','center'); bx.globalAlpha=1; }

/* ---- station ID ---- */
function fStationID(lt,T){ rc(0,0,BW,BH,'#07040b'); var g=bx.createRadialGradient(400,250,10,400,250,420); g.addColorStop(0,'rgba(192,74,158,'+(.35*ez(sg(lt,.3,.7)))+')'); g.addColorStop(1,'rgba(0,0,0,0)'); bx.fillStyle=g; bx.fillRect(0,0,BW,BH);
  var y=372, x0=90, x1=710; rc(x0,y,x1-x0,1,'rgba(255,255,255,.35)'); for(var n=2;n<=69;n++){ var x=x0+(n-2)/67*(x1-x0); rc(x,y-(n%10===0?14:7),1,n%10===0?14:7,'rgba(255,255,255,'+(n%10===0?.5:.25)+')'); if(n%10===0) tx(String(n),x,y+22,bf(500,11,FT),'rgba(255,255,255,.45)','center'); }
  S.forEach(function(s){ if(s.b!=='tv') return; var x=x0+(parseFloat(s.n)-2)/67*(x1-x0); rc(x-1,y-22,2,22,s.c); });
  var tgt=x0+(12.1-2)/67*(x1-x0), nx=x1-(x1-tgt)*ez(sg(lt,0,.45))+Math.sin(sg(lt,.3,.5)*Math.PI*3)*6*(1-sg(lt,.3,.55)); bx.save(); bx.shadowColor='#FF4A3D'; bx.shadowBlur=16; rc(nx-1.5,y-60,3,64,'#FF4A3D'); rr(nx-6,y-66,12,12,6,'#FF4A3D'); bx.restore();
  var a=ez(sg(lt,.42,.7)); bx.globalAlpha=a; bx.save(); bx.shadowColor=B.c; bx.shadowBlur=40; tx('BEAT',400,262+(1-a)*16,bf(900,170),'#fff','center',8); bx.restore();
  tx('12.1',400,98,bf(400,50,FO),'#E9FFE8','center',2); bx.globalAlpha=ez(sg(lt,.55,.8)); tx('POMONA · INLAND EMPIRE',400,306,bf(700,16,FT),'rgba(255,255,255,.75)','center',5);
  bx.globalAlpha=ez(sg(lt,.65,.9)); rr(340,428,26,20,5,'rgba(255,255,255,0)'); bx.strokeStyle='#fff'; bx.lineWidth=2.5; bx.strokeRect(341,429,24,18); rc(358,432,4,4,'#FF4A3D'); tx('a station on dial',374,445,bf(500,15,FT),'rgba(255,255,255,.7)'); bx.globalAlpha=1; }

function brkFrame(k,lt,tt){ var T=(performance.now()-t0)/1000; bx.setTransform(1.6,0,0,1.6,0,0); bx.globalAlpha=1; bx.globalCompositeOperation='source-over'; bx.textBaseline='alphabetic';
  if(k===0) fProgram(lt,T,false); else if(k===6) fProgram(lt,T,true); else if(k===1) fBumper(lt,T); else if(k===2) fJuniper(lt,T); else if(k===3) fRedlands(lt,T); else if(k===4) fMembers(lt,T); else fStationID(lt,T); }
new IntersectionObserver(function(e){ brkVis=e[0].isIntersecting; }).observe(bc);
var bLast=0; (function bl(now){ requestAnimationFrame(bl); if(!brkVis||document.hidden||RM) return; if(now-bLast<40) return; bLast=now; brkFrame(bK,bLt,bTT); })(0);
function mmss(s){ s=Math.round(s); return Math.floor(s/60)+':'+(s%60<10?'0':'')+s%60; }
function brkAt(p){ var tt=p*TOT, acc=0, k=0; for(;k<PARTS.length-1;k++){ if(tt<acc+PARTS[k][1]) break; acc+=PARTS[k][1]; } var lt=clamp((tt-acc)/PARTS[k][1]); bK=k; bLt=lt; bTT=tt; brkFrame(k,lt,tt);
  var segs=$('tl').children, nms=$('tlNames').children; for(var j=0;j<segs.length;j++){ segs[j].firstChild.style.transform='scaleX('+(j<k?1:j===k?lt:0)+')'; nms[j].classList.toggle('on',j===k); }
  $('tlT').textContent=mmss(tt)+' of '+mmss(TOT);
  if(k!==curPart){ curPart=k; var P=PARTS[k]; $('brkPin').style.setProperty('--pc',P[2]); $('capPre').textContent=k===0?'A break on 12.1 BEAT':P[0]+(k===0||k===6?'':', '+mmss(P[1])); $('capH').innerHTML='<span>'+P[3]+'</span>'; $('capP').textContent=P[4]; $('tlNow').innerHTML='<b>'+P[0]+'</b>'; }
}

/* ---------- manifesto ---------- */
(function(){ var el=$('mani'), words=el.dataset.text.split(' '); el.innerHTML=words.map(function(w){ var hot=/^\*.*\*[.,]?$/.test(w); w=w.replace(/\*/g,''); return '<span class="w'+(hot?' hot':'')+'">'+w+'</span>'; }).join(' '); el.setAttribute('aria-label',el.dataset.text.replace(/\*/g,'')); })();
var mWords=$('mani').querySelectorAll('.w');

/* ---------- doors peek ---------- */
document.querySelectorAll('[data-peek]').forEach(function(d){ d.addEventListener('mouseenter',function(){ showPeek(S[+d.dataset.peek],d.querySelector('h3').textContent); }); d.addEventListener('mouseleave',hidePeek); });

/* ---------- sign-off ---------- */
var offx=$('offC').getContext('2d');
new IntersectionObserver(function(e){ if(e[0].isIntersecting){ draw(offx,320,240,3,S[cur]); $('contact').classList.add('go'); } },{threshold:.3}).observe($('contact'));


/* ---------- the wall: pulling back reveals every station ---------- */
var wall=$('wall'), WG=null, wallE=0, tiles=[];
(function(){ for(var k=0;k<9;k++){ var me=k===4, d=document.createElement(me?'div':'button'); d.className='tile'+(me?' me':''); if(!me){ d.type='button'; d.setAttribute('data-cur','Tune'); }
  d.innerHTML=(me?'':'<canvas aria-hidden="true"></canvas>')+'<span class="tb"><b></b><em></em></span><span class="tp"><small></small><strong></strong></span>'+(me?'<span class="tw">Watching</span>':'');
  wall.appendChild(d); var o={el:d,k:k,me:me,c:d.querySelector('canvas'),s:null}; o.x=o.c?o.c.getContext('2d'):null; tiles.push(o);
  if(!me) (function(o){ o.el.addEventListener('click',function(){ if(o.s!=null) tune(o.s); }); })(o); } })();
function mapWall(){ var others=[]; for(var i=0;i<S.length;i++) if(i!==cur) others.push(i); var j=0;
  tiles.forEach(function(o){ var i=o.me?cur:others[j++]; o.s=i; var s=S[i], sl=slot(s); o.el.style.setProperty('--c',s.c); o.el.querySelector('.tb b').textContent=(s.b==='fm'?'FM ':'')+s.n; o.el.querySelector('.tb em').textContent=s.cs; o.el.querySelector('.tp small').textContent='until '+clock(sl.end); o.el.querySelector('.tp strong').textContent=sl.prog; if(!o.me) o.el.setAttribute('aria-label','Tune to '+s.n+' '+s.cs+', '+sl.prog); });
  paintWall(1); }
function layoutWall(){ var vw=innerWidth, vh=$('pin').clientHeight, narrow=vw<700, gut=Math.max(16,Math.min(64,vw*.04)), g=narrow?8:14, top=narrow?84:100, cap=narrow?150:156;
  var W=vw-gut*2, H=vh-top-cap, ar=narrow?1.3:.625, tw=Math.min((W-2*g)/3,(H-2*g)/3/ar), th=tw*ar, gw=tw*3+g*2, gh=th*3+g*2, x0=(vw-gw)/2, y0=top+Math.max(0,(H-gh)/2);
  WG={vw:vw,vh:vh,tw:tw,th:th,g:g,x0:x0,y0:y0,gw:gw,gh:gh,cx:x0+tw+g,cy:y0+th+g,r:2,narrow:narrow};
  tiles.forEach(function(o){ var c=o.k%3, r=(o.k/3)|0, st=o.el.style; st.left=(x0+c*(tw+g))+'px'; st.top=(y0+r*(th+g))+'px'; st.width=tw+'px'; st.height=th+'px'; st.borderRadius=WG.r+'px';
    o.dx=(1-c); o.dy=(1-r); o.d=Math.abs(c-1)+Math.abs(r-1); if(o.c){ o.c.width=narrow?120:180; o.c.height=Math.round(o.c.width*th/tw); } });
  var af=$('after').style; af.left=x0+'px'; af.width=gw+'px'; af.top=(y0+gh+(narrow?18:26))+'px'; af.bottom='auto';
  wall.classList.toggle('narrow',narrow); return WG; }
function wallAt(e){ tiles.forEach(function(o){ var p=o.me?clamp((e-.9)*10):clamp((e-.25-o.d*.08)/.45), q=ease(p), st=o.el.style; st.opacity=q; st.transform=o.me?'':'translate('+(-o.dx*(1-q)*40)+'px,'+(-o.dy*(1-q)*30)+'px) scale('+(.94+.06*q)+')'; });
  wall.style.pointerEvents=e>.85?'auto':'none'; wall.classList.toggle('up',e>.85); }
var wLast=0;
function paintWall(force){ var t=RM?0:(performance.now()-t0)/1000; tiles.forEach(function(o){ if(o.x&&o.s!=null) draw(o.x,o.c.width,o.c.height,t+o.k*3,S[o.s]); }); }
(function wl(now){ requestAnimationFrame(wl); if(document.hidden||!heroVis||wallE<.3||RM) return; if(now-wLast<110) return; wLast=now; paintWall(); })(0);
addEventListener('resize',function(){ layoutWall(); onScroll(); });
$('afterGo').addEventListener('click',function(e){ e.preventDefault(); var g=$('guide'); if(lenis) lenis.scrollTo(g,{offset:-20,duration:1.2}); else g.scrollIntoView({behavior:RM?'auto':'smooth'}); });

/* ---------- scroll choreography ---------- */
var nav=$('nav'), lenis=null;
function scrollToTop(){ if(lenis) lenis.scrollTo(0,{duration:1.4}); else window.scrollTo({top:0,behavior:RM?'auto':'smooth'}); }
document.querySelectorAll('a[href="#top"]').forEach(function(a){ if(a.classList.contains('stn')) return; a.addEventListener('click',function(e){ e.preventDefault(); scrollToTop(); }); });
function onScroll(){
  var vh=innerHeight, y=window.scrollY;
  nav.classList.toggle('solid',y>40);
  /* hero pull-back */
  var r=hero.getBoundingClientRect(), range=hero.offsetHeight-vh; heroP=clamp(-r.top/Math.max(1,range)); var e=RM?0:ease(clamp(heroP*1.15));
  wallE=e; var G=WG||layoutWall(), vw=innerWidth, vh=G.vh, iT=G.cy*e, iL=G.cx*e, iR=(vw-G.cx-G.tw)*e, iB=(vh-G.cy-G.th)*e;
  screen.style.clipPath=e>0?'inset('+iT+'px '+iR+'px '+iB+'px '+iL+'px round '+(e*G.r)+'px)':'';
  var sf=Math.max(G.tw/vw,G.th/vh), sc=1.07+(sf-1.07)*e, tx=(G.cx+G.tw/2-vw/2)*e, ty=(G.cy+G.th/2-vh/2)*e, tf=e>0?'translate('+tx+'px,'+ty+'px) scale('+sc+')':'';
  pic.style.transform=tf; pic.style.transition=e>0?'none':''; noise.style.transform=tf;
  wallAt(e);
  var hf=1-clamp(heroP*2.8); ['copy','lower','hint','dial'].forEach(function(id){ var el=$(id); el.style.opacity=hf; el.style.transform='translateY('+(-heroP*80)+'px)'; el.style.pointerEvents=hf<.2?'none':''; });
  var halo=$('halo'); halo.style.top=iT+'px'; halo.style.bottom=iB+'px'; halo.style.left=iL+'px'; halo.style.right=iR+'px'; halo.style.opacity=clamp((heroP-.15)*1.6)*.55;
  var ao=clamp((e-.82)*6); $('after').style.opacity=ao; $('after').style.transform='translateY('+((1-ao)*14)+'px)'; $('after').style.pointerEvents=ao>.5?'':'none';
  screen.querySelector('.vig').style.opacity=1-e*.85;
  /* break scrub */
  var bw=$('breaks'), br=bw.getBoundingClientRect(); if(br.top<vh&&br.bottom>0){ brkAt(clamp(-br.top/Math.max(1,bw.offsetHeight-vh))); }
  /* manifesto */
  var m=$('mani').getBoundingClientRect(); var mp=clamp((vh*.85-m.top)/(m.height+vh*.3)); var lit=Math.round(mp*mWords.length); mWords.forEach(function(w,i){ w.classList.toggle('lit',RM||i<lit); });
}
if(window.Lenis&&!RM){ lenis=new Lenis({lerp:.1,smoothWheel:true}); lenis.on('scroll',onScroll); (function raf(t){ lenis.raf(t); requestAnimationFrame(raf); })(0); }
layoutWall(); mapWall(); setInterval(mapWall,30000);
addEventListener('scroll',onScroll,{passive:true}); addEventListener('resize',onScroll); onScroll();
document.fonts&&document.fonts.ready.then(function(){ curPart=-1; onScroll(); var br=$('breaks').getBoundingClientRect(); if(br.top>=innerHeight) brkAt(0); });
brkAt(0);

/* ---------- animation loop for small screens (signs, peek) ---------- */
var sl=0;
(function loop(now){ requestAnimationFrame(loop); if(document.hidden) return;
  /* cursor + peek follow */
  pxx+=(mx-pxx)*.18; pyy+=(my-pyy)*.18;
  if(FINE){ peek.style.transform=''; peek.style.left=(pxx+26)+'px'; peek.style.top=(pyy-90)+'px'; }
  if(now-sl<50) return; sl=now; var t=(now-t0)/1000;
  if(pkOn&&pkS) draw(pk,260,195,t,pkS);
  if(signsVis&&!RM) signs.forEach(function(o){ if(o.hot) paintSign(o,t+o.k*5); });
})(0);

/* ---------- cursor ---------- */
if(FINE){ document.body.classList.add('cursor-on'); var cu=$('cur'), ring=cu.querySelector('.r'), dot=cu.querySelector('.d'), rx=0, ry=0;
  addEventListener('mousemove',function(e){ cu.style.opacity=1; mx=e.clientX; my=e.clientY; dot.style.transform='translate('+mx+'px,'+my+'px)'; var t=e.target.closest('[data-cur]'); if(t){ $('curL').textContent=t.dataset.cur; cu.classList.add('big'); } else cu.classList.remove('big'); });
  (function f(){ rx+=(mx-rx)*(RM?1:.2); ry+=(my-ry)*(RM?1:.2); ring.style.transform='translate('+rx+'px,'+ry+'px)'; requestAnimationFrame(f); })();
  document.addEventListener('mouseleave',function(){ cu.style.opacity=0; }); document.addEventListener('mouseenter',function(){ cu.style.opacity=1; });
}

/* ---------- menu ---------- */
$('menuBtn').addEventListener('click',function(){ $('mob').hidden=false; this.setAttribute('aria-expanded','true'); });
function closeM(){ $('mob').hidden=true; $('menuBtn').setAttribute('aria-expanded','false'); }
$('menuX').addEventListener('click',closeM); $('mob').querySelectorAll('a').forEach(function(a){ a.addEventListener('click',closeM); });
})();
