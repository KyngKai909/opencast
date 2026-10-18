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
