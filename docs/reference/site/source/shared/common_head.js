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
function fill(){ var s=S[cur], sl=slot(s); document.querySelectorAll('.js-ch').forEach(function(e){ e.textContent=s.n; }); $('npCs').textContent=s.cs; $('npProg').textContent=sl.prog; document.documentElement.style.setProperty('--np',s.c); }
fill(); setInterval(fill,30000);
