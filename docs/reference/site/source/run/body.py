AR='<svg viewBox="0 0 20 20"><path d="M5 10h10M10.5 5.5 15 10l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
KEY='<span class="key">'+AR+'</span>'
def mh(l,r='',ix=None):
    left=('<b class="ix">%s</b>'%ix if ix else '')+l
    return '<div class="mh"><span>%s</span>%s</div>'%(left,('<span>%s</span>'%r) if r else '')

H=[]
a=H.append
a('<main id="top">')
# ---------------- HERO ----------------
a('''<section class="blk rhero" id="hero">
  <div class="wrap"><div class="sheet">
    <div class="cell hd rh" style="--d:7">
      %s
      <div class="cb">
        <h1>Run it like a station.<br><span class="dim">Not a loop.</span></h1>
        <p class="lede">Bring your library. Build a real schedule with bumpers, station IDs and breaks, go live inside it, and send one continuous signal to the dial and every platform you stream to.</p>
        <div class="acts"><a class="btn" href="#claim" data-cur="Claim"><span class="live" aria-hidden="true"><i></i>__.1</span>Claim a number</a><a class="btn ghost" href="#pricing">See pricing</a></div>
      </div>
      <div class="mf"><span>Being on air is free. You pay for storage, relays and live hours.</span></div>
    </div>
    <div class="cell chainc" style="--d:5">
      <div class="mh"><span>Signal chain</span><span class="lv"><i></i>12.1 BEAT, live</span></div>
      <div class="cb">
        <div class="mc" id="mc" style="--s:#9A9CAB">
          <div class="mc-steps" role="tablist" aria-label="Signal chain">
            <button type="button" role="tab" data-i="0" style="--c:#9A9CAB"><i>01</i>Library<u></u></button>
            <button type="button" role="tab" data-i="1" style="--c:#5B7BE0"><i>02</i>Prepare<u></u></button>
            <button type="button" role="tab" data-i="2" style="--c:#2F9A72"><i>03</i>Schedule<u></u></button>
            <button type="button" role="tab" data-i="3" style="--c:#EBA03A"><i>04</i>Breaks<u></u></button>
            <button type="button" role="tab" data-i="4" style="--c:#C04A9E"><i>05</i>On air<u></u></button>
          </div>
          <div class="pgm" id="pgm" data-s="0">
            <canvas id="pgmC" width="480" height="270" aria-hidden="true"></canvas>
            <div class="ov ov-lib" aria-hidden="true">
              <div class="ol-h"><span>NAS · /media/beat-tape-tv</span><span class="tab">2.4 TB</span></div>
              <div class="ol-l" id="olL"></div>
            </div>
            <div class="ov ov-prep" aria-hidden="true"><div class="op-b" id="opB"><span>Before</span></div><i class="op-d" id="opD"></i><span class="op-a">After</span><span class="op-t" id="opT">HDR10 → SDR</span></div>
            <div class="ov ov-sch" aria-hidden="true">
              <div class="os-g">
                <div class="os-r"><span>Fri</span><div><b style="flex:2;--k:#C04A9E">Crate Session</b><b style="flex:2;--k:#FF4A3D" class="lv">● Beat Tape Live</b><b style="flex:3;--k:#7a3b8f">Overnight Crates</b></div></div>
                <div class="os-r"><span>Sat</span><div><b style="flex:2;--k:#EBA03A">Guest Mix</b><b style="flex:2;--k:#C04A9E">Late Crate</b><b style="flex:3;--k:#7a3b8f">Overnight Crates</b></div></div>
                <i class="os-n" id="osN"></i>
              </div>
            </div>
            <div class="ov ov-brk" aria-hidden="true">
              <div class="ob-now"><small>In the break</small><b id="obN">Bumper</b><span class="tab" id="obT">0:05</span></div>
              <div class="ob-s" id="obS"><i style="flex:1;--k:#C04A9E"></i><i style="flex:6;--k:#E0583A"></i><i style="flex:6;--k:#E8402F"></i><i style="flex:3;--k:#5B7BE0"></i><i style="flex:1;--k:#fff"></i></div>
            </div>
            <div class="ov ov-air" aria-hidden="true"><span class="pgm-tl"><i></i>On air</span><span class="pgm-lt"><b>LATE CRATE</b><small>with Marisol, live from Pomona</small></span></div>
            <span class="pgm-bug" aria-hidden="true"><span class="js-ch">12.1</span> <b>BEAT</b></span>
            <span class="pgm-tc tab" id="pgmTc" aria-hidden="true">00:00:00:00</span>
          </div>
          <div class="mc-cap" aria-live="polite"><div><b id="mcT">Your library stays home</b><p id="mcP">A small agent on your NAS sends only what's about to air.</p></div><em class="tab" id="mcS">2.4 TB home · 38 GB sent</em></div>
          <svg class="sc-fan" id="scFan" aria-hidden="true"></svg>
          <div class="sc-outs" id="outs">
            <div class="so" style="--k:#FF4A3D"><b>The dial</b><small>12.1</small></div>
            <div class="so" style="--k:#FF3B30"><b>YouTube</b><small class="tab" data-up="171230">47:33:50</small></div>
            <div class="so" style="--k:#9146FF"><b>Twitch</b><small class="tab" data-restart="2892">0:48</small></div>
            <div class="so" style="--k:#53FC18"><b>Kick</b><small class="tab" data-up="91210">25:20:10</small></div>
            <div class="so" style="--k:#9A9CAB"><b>RTMP</b><small>Your server</small></div>
          </div>
        </div>
      </div>
      <div class="mf"><span>Five destinations. One signal.</span><span class="tab" id="chClock">10:53 pm</span></div>
    </div>
    <div class="cell st4" style="--d:3;--t:3;--m:1"><div class="cb"><b>Free</b><span>to be on air, on the dial, all day</span></div></div>
    <div class="cell st4" style="--d:3;--t:3;--m:1"><div class="cb"><b>0 GPUs</b><span>needed on your side, ever</span></div></div>
    <div class="cell st4" style="--d:3;--t:3;--m:1"><div class="cb"><b>Every platform</b><span>from one stream, with your bug on it</span></div></div>
    <div class="cell st4" style="--d:3;--t:3;--m:1"><div class="cb"><b>Paid breaks</b><span>spots from businesses near and far, not a tip jar</span></div></div>
  </div></div>
</section>''' % mh('Run a station','For operators'))

# ---------------- 01 WHO ----------------
a('''<section class="blk" id="who"><div class="wrap"><div class="sheet">
  <div class="cell hd" style="--d:7">%s<div class="cb"><h2>Built for the people<br>already doing it.</h2></div></div>
  <div class="cell hd" style="--d:5">%s<div class="cb end"><p class="lede">Most of our operators don't stand in front of a camera. They have a library, a taste, and a channel they keep running with tools that weren't made for it.</p></div></div>'''%(mh('Who it\'s for','Three kinds of operator','01'),mh('Why they switch')))
aud=[
 ('A','#C04A9E','You loop a library to YouTube','Lofi, mixes, long-stream archives, podcast reruns','Switching from Livepush, Upstream or Gyre',
  ['Storage counts what airs, not your whole library','A week laid out by the hour, not one long playlist','Breaks that pay you, on every platform you relay to'],'#switch','See the switch'),
 ('B','#EBA03A','You build webchannels','ErsatzTV, Tunarr and Plex channels with bumpers','Keep the bumpers. Lose the server.',
  ['No transcoding box at home, no GPU','Your bumpers, IDs and blocks carried over','On the dial, in Plex, and in IPTV apps'],'#control','See master control'),
 ('C','#2F9A72','You run a community channel','City hall, a school, a church, a radio collective','Public access, without the studio',
  ['Go live from a phone inside the schedule','Replays fill the rest of the day on their own','Members and underwriters credited on air'],'#earn','See how it pays'),
]
for L,c,t,sub,tag,pts,href,cta in aud:
    a('''  <a class="cell aud" href="%s" style="--c:%s;--d:4;--t:6" data-cur="Open">
    <div class="mh"><span><b class="ix">%s</b>%s</span></div>
    <div class="cb"><p class="tag">%s</p><h3>%s</h3><ul>%s</ul></div>
    <div class="mf"><span>%s</span>%s</div>
  </a>'''%(href,c,L,sub,tag,t,''.join('<li>%s</li>'%p for p in pts),cta,KEY))
a('</div></div></section>')

# ---------------- 02 MASTER CONTROL ----------------
a('''<section class="blk" id="control"><div class="wrap"><div class="sheet">
  <div class="cell hd" style="--d:7">%s<div class="cb"><h2>Master control.<br>The whole station, one screen.</h2></div></div>
  <div class="cell hd" style="--d:5">%s<div class="cb end"><p class="lede">Schedule, breaks, live, relays and the library, run the way a TV station runs them. The parts operators told us were hardest, scheduling and choosing what airs, do most of their own work.</p></div></div>'''%(mh('Master control','Eight parts','02'),mh('What you run')))
# schedule (big)
a('''  <div class="cell ft big" style="--d:8;--t:6">
    %s
    <div class="cb"><div class="sch" id="sch" aria-hidden="true"></div>
      <div class="ftx"><h3>A real schedule, not a playlist.</h3><p>Lay out a week by the hour. Blocks repeat by day, live shows get a slot, and the station can sign off at 2 am and come back at 6. Drag a show and everything after it moves.</p></div></div>
  </div>'''%mh('Schedule','This week on 12.1','A'))
a('''  <div class="cell ft" style="--d:4;--t:3">
    %s
    <div class="cb"><div class="bks" aria-hidden="true">
      <div class="bk-row"><i style="flex:10;--c:#C04A9E"></i><i style="flex:3;--c:#fff"></i><i style="flex:12;--c:#E0583A"></i><i style="flex:12;--c:#E8402F"></i><i style="flex:6;--c:#5B7BE0"></i><i style="flex:3;--c:#fff"></i><i style="flex:10;--c:#C04A9E"></i></div>
      <div class="bk-l"><span>Show</span><span>Bumper</span><span>Spot</span><span>Spot</span><span>Credit</span><span>ID</span></div></div>
      <div class="ftx"><h3>Breaks that build themselves.</h3><p>We find natural break points from chapters, black frames and silence, then fill them with your bumpers, IDs and spots you've accepted from the market.</p></div></div>
  </div>'''%mh('Breaks','Auto-filled','B'))
a('''  <div class="cell ft" style="--d:4;--t:3">
    %s
    <div class="cb"><div class="lib" aria-hidden="true"><div class="lib-a"><b class="tab">2.4 TB</b><span>On your NAS</span></div><div class="lib-f"><i></i><i></i><i></i></div><div class="lib-b"><b class="tab">38 GB</b><span>Next 7 days</span></div></div>
      <div class="ftx"><h3>Your library stays at home.</h3><p>A small agent on your NAS or computer sends only what's about to air. You pay storage for 38 GB, not 2.4 TB.</p></div></div>
  </div>'''%mh('Library at home','Agent','C'))
a('''  <div class="cell ft" style="--d:4;--t:3">
    %s
    <div class="cb"><ul class="prep" aria-hidden="true"><li><span>HDR10</span><i>→</i><span>SDR</span></li><li><span>1080i</span><i>→</i><span>1080p</span></li><li><span>−9 LUFS</span><i>→</i><span>−16 LUFS</span></li><li><span>Sideways phone clip</span><i>→</i><span>Upright</span></li></ul>
      <div class="ftx"><h3>Prepared once, on our side.</h3><p>Every file is fixed and transcoded one time, then aired from the prepared copy forever. No GPU, no server, no fan noise.</p></div></div>
  </div>'''%mh('Prepare','Automatic','D'))
a('''  <div class="cell ft" style="--d:4;--t:3">
    %s
    <div class="cb"><ul class="rly" aria-hidden="true"><li><i></i>YouTube<span class="tab">47:33:50</span></li><li><i></i>Twitch<span class="tab warn">restarts at next break</span></li><li><i></i>Kick<span class="tab">25:20:10</span></li><li><i class="off"></i>Facebook<span>live shows only</span></li></ul>
      <div class="ftx"><h3>One signal to every platform.</h3><p>Connect YouTube and Twitch, or add any RTMP address. We restart ahead of each platform's limit, at a break, so viewers never see it drop.</p></div></div>
  </div>'''%mh('Relays','Built in','E'))
a('''  <div class="cell ft" style="--d:4;--t:3">
    %s
    <div class="cb"><div class="lv-t" aria-hidden="true"><span class="seg r">Replay</span><span class="seg l"><i></i>Live, 9 to 11 pm</span><span class="seg r">Replay</span></div>
      <div class="ftx"><h3>Go live inside the schedule.</h3><p>Live shows get a slot like anything else. Start late and a replay covers it; end early and the next block slides in. The stream never breaks.</p></div></div>
  </div>'''%mh('Live','From a phone or OBS','F'))
a('''  <div class="cell ft" style="--d:6;--t:3">
    %s
    <div class="cb"><ol class="eps" aria-hidden="true"><li class="d">S2 E4</li><li class="d">S2 E5</li><li class="n">S2 E6<small>Tonight</small></li><li>S2 E7</li><li>S2 E8</li></ol>
      <div class="ftx"><h3>Slots that remember where you were.</h3><p>Point a slot at a series and it airs the next episode every time, in order, shuffled, or by season. Seasons and playback orders are built in.</p></div></div>
  </div>'''%mh('Series slots','Next episode','G'))
a('''  <div class="cell ft" style="--d:6;--t:6">
    %s
    <div class="cb"><div class="feeds"><div class="fd"><code>usedial.com/12.1/channel.m3u</code><button class="cp" type="button" data-copy="usedial.com/12.1/channel.m3u">Copy</button></div><div class="fd"><code>usedial.com/12.1/guide.xml</code><button class="cp" type="button" data-copy="usedial.com/12.1/guide.xml">Copy</button></div></div>
      <div class="ftx"><h3>In Plex and IPTV apps, too.</h3><p>Every station publishes an M3U playlist and an XMLTV guide, so it shows up in Plex, Channels and any IPTV player with its schedule attached.</p></div></div>
  </div>'''%mh('Feeds','M3U and XMLTV','H'))
a('</div></div></section>')

# ---------------- 03 SWITCH ----------------
rows=[
 ('One 24/7 1080p channel','From <b class="tab">$0</b><small>Grows with what is on air and relay hours. About $26 for 40 GB on air, relayed all month.</small>','<b class="tab">$39</b> to <b class="tab">$119</b>/mo<small>Looping starts on Editors (20 GB), then Creators (50 GB) and Business (100 GB)</small>','<b class="tab">$30</b>/mo<small>Per 1080p 30 fps stream. 60 fps and 4K cost extra.</small>','<b class="tab">$99</b> to <b class="tab">$169</b>/mo<small>Playlists and the scheduler start on Start+ (75 GB), then PRO+ (150 GB)</small>'),
 ('Biggest library it holds','<b class="tab">No limit</b><small>It stays on your NAS. We store the next 7 days on air.</small>','<b class="tab">100 GB</b><small>Business plan</small>','<b class="tab">100 GB</b><small>On its free plan. Paid storage isn\'t published.</small>','<b class="tab">150 GB</b><small>PRO+ plan</small>'),
 ('Library at home','Yes. A small agent on your NAS or computer sends what\'s about to air.','No. Upload everything first.','No. Upload everything first.','No. Upload everything first.'),
 ('Hours on air','All of them, free. Every plan, every day.','20 a month free. 24/7 looping from $39.','24 a month free. Unlimited from $30.','7-day trial. 24/7 from $49; playlists from $99.'),
 ('How you program it','A weekly schedule by the hour, with dayparts, series slots and live blocks','Events queued from merged videos','Looping playlists, started on a daily or weekly schedule','Playlists and a scheduler'),
 ('Breaks with bumpers and IDs','Built in, placed at natural break points','Not listed','Stings and jingles every N videos or minutes, and YouTube ad-break triggers','Not listed'),
 ('Who pays for your breaks','Advertisers in the spot market, paid to you, on every platform you relay to','Not listed','YouTube\'s own ads, on YouTube only','Not listed'),
 ('A home viewers tune into','A number on the dial','No','No','No'),
]
t='<table class="cmp"><thead><tr><th scope="col"><span class="sr">Feature</span></th><th scope="col" class="us"><span data-brand>dial</span></th><th scope="col">Livepush</th><th scope="col">Upstream</th><th scope="col">Gyre</th></tr></thead><tbody>'
for r in rows:
    t+='<tr><th scope="row">%s</th><td class="us">%s</td><td>%s</td><td>%s</td><td>%s</td></tr>'%r
t+='</tbody></table>'
a('''<section class="blk" id="switch"><div class="wrap"><div class="sheet">
  <div class="cell hd" style="--d:7">%s<div class="cb"><h2>Already running<br>a 24/7 stream?</h2></div></div>
  <div class="cell hd" style="--d:5">%s<div class="cb end"><p class="lede">Loop tools make you upload your whole library and cap it at 100 or 150 GB. We leave it on your NAS, keep you on air around the clock for free, and fill your breaks with paid spots.</p></div></div>
  <div class="cell" style="--d:12">%s<div class="cmpw">%s</div><div class="mf"><span>Competitor prices and limits from their public pricing pages, October 2026. Check them before you decide.</span></div></div>'''%(mh('Switching','From loop tools','03'),mh('The short version'),mh('One channel, side by side','<span class="swp">Swipe to compare →</span><span class="mo">Monthly</span>'),t))
steps=[('Point us at your folder','Install the agent on your NAS or computer and pick the folders. Nothing uploads until it\'s scheduled.'),
 ('Lay out your week','Turn your playlists into blocks. Bumpers and IDs go in as break rules.'),
 ('Paste your stream keys','Connect YouTube and Twitch, or add any RTMP address.'),
 ('Run both for a day','Air on the dial while your old tool keeps the platforms. Check the schedule.'),
 ('Flip the relays','Switch the platforms over at a break. Cancel the old plan.')]
for i,(h,p) in enumerate(steps):
    a('  <div class="cell stp" style="--d:%d;--t:%d;--m:2"><div class="mh"><span><b class="ix">%02d</b>Step</span></div><div class="cb"><h3>%s</h3><p>%s</p></div></div>'%([4,4,4,6,6][i],[3,3,3,3,6][i],i+1,h,p))
a('</div></div></section>')

# ---------------- 04 PRICING ----------------
a('''<section class="blk" id="pricing"><div class="wrap"><div class="sheet">
  <div class="cell hd" style="--d:7">%s<div class="cb"><h2>On air is free.<br><span class="dim">You pay for what it costs.</span></h2></div></div>
  <div class="cell hd" style="--d:5">%s<div class="cb end"><p class="lede">One channel per station, pay as you go. Every month starts with a free allowance, and a cap never takes your channel off the dial. What your station earns pays this bill first; that's the next section.</p></div></div>'''%(mh('Pricing','Pay as you go','04'),mh('How it works')))
rate=[('Being on air','On the dial, scheduled, with breaks, files prepared','Free',''),
 ('Storage','Per GB a month, prepared copies of what airs','$0.04','10 GB free'),
 ('Relays, live shows only','Simulcast just your live blocks','Free',''),
 ('Relays, everything you air','Per hour, all platforms together','$0.05','never over $25 a month'),
 ('Live hours, TV','Per hour you broadcast live','$0.75','5 hours free'),
 ('Live hours, radio','Per hour on the FM band','Free',''),
 ('Number and call sign','Yours while you\'re on air','Included','licences come later')]
r='<div class="rate">'
for n,d,p,f in rate:
    r+='<div class="rt"><div><b>%s</b><small>%s</small></div><div class="rp"><b class="tab">%s</b>%s</div></div>'%(n,d,p,('<small>%s</small>'%f) if f else '')
r+='</div>'
a('''  <div class="cell" style="--d:5;--t:6">%s<div class="cb rc">%s</div><div class="mf"><span>Launch prices. They live in one table and will change with notice.</span></div></div>'''%(mh('Rate card','USD'),r))
a('''  <div class="cell calc" style="--d:7;--t:6">%s
    <div class="cb">
      <div class="cr"><label for="cLib">Your library<b class="tab" id="vLib">500 GB</b></label><input id="cLib" type="range" min="0" max="13" step="1" value="7"><small class="crh">Stays on your NAS or computer. Loop tools have to hold all of it.</small></div>
      <div class="cr"><label for="cGb">On air in the next 7 days<b class="tab" id="vGb">40 GB</b></label><input id="cGb" type="range" min="0" max="300" step="5" value="40"><small class="crh">The only part we store, and the only part you pay storage for.</small></div>
      <div class="cr"><span class="lb">Relays</span><div class="seg2 rm" role="group" aria-label="Relays"><button data-r="0">Off</button><button data-r="1">Live only</button><button data-r="2" class="on">Everything</button></div></div>
      <div class="cr"><label for="cLive">Live hours a month<b class="tab" id="vLive">10 h</b></label><input id="cLive" type="range" min="0" max="200" step="1" value="10"></div>
      <div class="out">
        <div class="ol"><span>Storage</span><b class="tab" id="oSt">$2.00</b></div>
        <div class="ol"><span>Relays</span><b class="tab" id="oRl">$14.60</b></div>
        <div class="ol"><span>Live hours</span><b class="tab" id="oLv">$2.00</b></div>
        <div class="ot"><span>Your usage this month</span><b class="tab" id="oTot">$18.60</b></div>
      </div>
      <div class="vs" id="vs"><div class="vs-h"><span>The same channel elsewhere</span><small id="vsNote">Cheapest published plan that fits this much storage, 1080p</small></div><div class="vs-r" id="vsR"></div></div>
    </div>
    <div class="mf"><span>Estimate for a 30-day month. Other tools: their published plans, October 2026; extra streams, 60 fps and 4K cost more there.</span></div>
  </div>'''%mh('Estimate your month','Drag to try'))
bill=[('Earnings first','Usage comes out of what your breaks earned before it touches your card.'),
 ('Caps per usage','Set a monthly cap on relays or live hours. Hitting one pauses that, never the channel.'),
 ('14-day grace','Run out of funds and you keep airing on the dial while we remind you.'),
 ('No contract','Month to month. Export your schedule and leave whenever you like.')]
for h,p in bill:
    a('  <div class="cell bl" style="--d:3;--t:3;--m:1"><div class="cb"><b>%s</b><p>%s</p></div></div>'%(h,p))
a('</div></div></section>')

# ---------------- 05 EARNINGS AND OWNERSHIP ----------------
a('''<section class="blk" id="earn"><div class="wrap"><div class="sheet">
  <div class="cell hd" style="--d:7">%s<div class="cb"><h2>A station can<br>pay for itself.</h2></div></div>
  <div class="cell hd" style="--d:5">%s<div class="cb end"><p class="lede">Your breaks earn. Your shows earn when other stations air them. Viewers can pledge. That money pays your bill first, most of it stays with you, and part of what we keep comes back to every station.</p></div></div>'''%(mh('Earnings and ownership','Where the money goes','05'),mh('The short version')))
earn=[('#E0583A','Spots','Businesses buy spots on your station in the spot market: the shop down the street, an online store, an app. You choose which ones air.','Spot market'),
 ('#EBA03A','Syndication','Offer your shows to the network. Every station that carries them pays you when they air.','Syndication'),
 ('#5B7BE0','Members','Viewers pledge to keep you on. Members and underwriters get a credit in your breaks.','The network'),
 ('#2F9A72','Backfill','Turn it on and break time the market hasn\'t sold is filled by the network\'s video ad partners. Off until you say so.','Spot market')]
for c,h,p,l in earn:
    a('''  <a class="cell ern" href="/%s" style="--c:%s;--d:3;--t:3;--m:2" data-cur="Open"><div class="mh"><span><i class="sq"></i>%s</span></div><div class="cb"><h3>%s</h3><p>%s</p></div><div class="mf"><span>%s</span>%s</div></a>'''%({'Spot market':'spots','Syndication':'syndication','The network':'network'}[l],c,h,h,p,l,KEY))
a('''  <div class="cell pay" style="--d:12" id="pay">
    %s
    <div class="pay-g">
      <div class="pay-in">
        <div class="cr"><label for="pTun">People tuned in, on average<b class="tab" id="vTun">10</b></label><input id="pTun" type="range" min="1" max="500" step="1" value="10"><small class="crh">Across the whole day, on the dial and your relays.</small></div>
        <div class="cr"><label for="pMin">Spot time sold each hour<b class="tab" id="vMin">30 sec</b></label><input id="pMin" type="range" min="0" max="3" step=".25" value=".5"><small class="crh">Your breaks hold up to 3 minutes an hour. Advertisers pay about $8 per 1,000 tuned in.</small></div>
        <div class="cr"><label for="pPl">Pledges a month<b class="tab" id="vPl">$50</b></label><input id="pPl" type="range" min="0" max="1000" step="10" value="50"></div>
        <p class="pay-n">Your bill is the estimate from Pricing: <b class="tab" id="pCostN">$18.60</b>. Change it there and this follows.</p>
      </div>
      <div class="pay-out">
        <div class="ol"><span>Spots, after our 10%%</span><b class="tab" id="pSp">$0</b></div>
        <div class="ol"><span>Pledges, after our 5%%</span><b class="tab" id="pPlO">$0</b></div>
        <div class="ol"><span>Your usage bill, paid from that first</span><b class="tab" id="pCost">$0</b></div>
        <div class="ot"><span>Left for you this month<small id="pVerdict">Covers your month</small></span><b class="tab" id="pLeft">$0</b></div>
        <div class="pay-bar" aria-hidden="true"><i id="pbC"></i><i id="pbL"></i></div>
        <div class="t-lg2"><span><i style="--k:#E0583A"></i>Pays the bill</span><span><i style="--k:#3ddc84"></i>Stays with you</span></div>
      </div>
    </div>
    <div class="mf"><span>An example, not a promise. Real earnings depend on your audience and which spots you approve.</span></div>
  </div>'''%mh('Does it cover your costs?','Drag to try'))
shr=[('Spots the advertiser books','10%','90%',[('YouTube','45%'),('Twitch','45%')]),
 ('Spots we sourced, or ads our agency made','20%','80%',[('YouTube','45%')]),
 ('Pledges and members','5%','95%',[('Patreon','10%'),('YouTube','30%'),('Twitch','50%')]),
 ('Syndication paid in cash, to the maker','5%','95%',[]),
 ('Ads from partners (backfill)','20%','80%',[('YouTube','45%')])]
w='<div class="shr"><div class="sh-h"><span>Source</span><span>Elsewhere, they keep</span><span>Station keeps</span><span>We keep</span></div>'
for n,o,st,el in shr:
    e=''.join('<i><span>%s</span><b class="tab">%s</b></i>'%x for x in el) or '<i class="na"><span>No equivalent</span></i>'
    w+='<div class="sh-r"><b>%s</b><span class="el">%s</span><span class="sk tab">%s</span><span class="nk tab">%s</span></div>'%(n,e,st,o)
w+='</div>'
a('''  <div class="cell" style="--d:12">%s<div class="cb">%s</div><div class="mf"><span>Card fees are passed through. Part of what we keep goes back to stations through the co-op pool. Other platforms' cuts are from their published terms: YouTube's Partner Program (ads 45%%, memberships 30%%), Twitch's standard subs and its ad incentive split, Patreon's fee for new creators.</span></div></div>'''%(mh('Who gets what','Per dollar earned, by source'),w))
own=[('#C04A9E','Stations','Your channel is yours','Your number, call sign, schedule, audience and earnings belong to you. Export it all and leave whenever you like.'),
 ('#EBA03A','Makers','Your shows stay yours','You set the terms on every program. Each station that carries it pays you, and you can stop offering it at any time.'),
 ('#5B7BE0','Members','Viewers back the station','Pledges go to the station people watch, 95 cents of every dollar, and members are thanked by name in the breaks.'),
 ('#2F9A72','The pool','Part of ours comes back','A share of what we keep goes into a co-op pool, paid out monthly: an equal share for every station on air, a share by watch time, and a creator fund.')]
for c,k,h,p in own:
    a('  <div class="cell own" style="--c:%s;--d:3;--t:3;--m:2"><div class="mh"><span><i class="sq"></i>%s</span></div><div class="cb"><h3>%s</h3><p>%s</p></div></div>'%(c,k,h,p))
a('</div></div></section>')

# ---------------- 06 FAQ ----------------
faq=[('Do I need a GPU or a server?','No. Files are prepared once on our side. The library agent only copies files and runs on any NAS, Mac, PC or Raspberry Pi.'),
 ('Will my YouTube or Twitch stream drop?','No. Platforms see one continuous stream, even when a live block starts or ends. Where a platform caps stream length, like Twitch at 48 hours, we restart ahead of it at a break.'),
 ('Can I bring my ErsatzTV or Tunarr channels?','Yes. Bring your collections, bumpers and blocks; they become schedule blocks and break rules. Your channel shows up on the dial and still works in Plex.'),
 ('Who buys the spots in my breaks?','Anyone with something to sell: a shop near your viewers, an online store, an app. They buy in the spot market and you approve what airs. Local ads are priced on viewers we can place nearby; online advertisers pay for every viewer. If you turn on backfill, unsold time goes to the network\'s video ad partners.'),
 ('What about music and film rights?','Every program has a rights record. If someone files a claim, that program comes off the air everywhere at once while it\'s sorted out, and your channel keeps running.'),
 ('What happens if I stop paying?','Your channel stays on the dial. After a 14-day grace period, paid relays and live hours pause until the account is topped up.'),
 ('Can I leave?','Yes. The software is open source, and you can export your schedule and library list at any time.')]
a('''<section class="blk" id="faq"><div class="wrap"><div class="sheet">
  <div class="cell hd" style="--d:5;--t:6">%s<div class="cb"><h2>Questions<br>operators ask.</h2></div></div>
  <div class="cell faq" style="--d:7;--t:6">%s<div class="qs">%s</div></div>
</div></div></section>'''%(mh('Questions','','06'),mh('Before you switch','%d answers'%len(faq)),''.join('<details><summary><span>%s</span><i aria-hidden="true"></i></summary><p>%s</p></details>'%q for q in faq)))
a('</main>')
open('body.html','w').write('\n'.join(H))
print(len('\n'.join(H)))
