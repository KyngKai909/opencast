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
