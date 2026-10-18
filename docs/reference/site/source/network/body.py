AR='<svg viewBox="0 0 20 20"><path d="M5 10h10M10.5 5.5 15 10l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
AL='<svg viewBox="0 0 20 20"><path d="M15 10H5M9.5 5.5 5 10l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
def mh(l,r='',ix=None,rc=''):
    left=('<b class="ix">%s</b>'%ix if ix else '')+l
    return '<div class="mh"><span>%s</span>%s</div>'%(left,('<span%s>%s</span>'%((' class="%s"'%rc) if rc else '',r)) if r else '')
def li(rows): return ''.join('<li><i class="tab">%02d</i><div><b>%s</b><p>%s</p></div></li>'%(k+1,h,p) for k,(h,p) in enumerate(rows))

H=[]; a=H.append
a('<main id="top">')

# ---------------- HERO: the dial ----------------
a('''<section class="blk rhero nt-hero" id="hero">
  <div class="wrap"><div class="sheet">
    <div class="cell hd rh" style="--d:6">
      %s
      <div class="cb">
        <h1 class="sy-h"><span>A network,</span><span class="dim">not a feed.</span></h1>
        <p class="lede">Local TV used to work like this: a few stations in every town, each with a number on the dial, paid by the businesses down the street, carrying the best shows from everywhere else. We're rebuilding that for anyone with something worth airing.</p>
        <div class="acts"><a class="btn" href="/" data-cur="Watch"><span class="live" aria-hidden="true"><i></i><span class="js-ch">12.1</span></span>Open the dial</a><a class="btn ghost" href="#money">How the money moves</a></div>
      </div>
      <div class="mf"><span>Free to watch. No account to tune in.</span><span class="nt-st"><i></i>Before launch</span></div>
    </div>
    <div class="cell tuner" style="--d:6" id="tuner">
      <div class="mh"><span>The dial</span><span>Example stations</span></div>
      <div class="tn-mk"><div class="seg2" id="tnMk" role="group" aria-label="Market"></div></div>
      <div class="tn-read" aria-live="polite">
        <div class="tn-num"><b class="tab" id="tnNum">12.1</b><small id="tnBand">TV</small></div>
        <div class="tn-id"><b id="tnCs">BEAT</b><span id="tnName">Beat Tape TV</span><small id="tnWho">Run by a crate digger in Pomona</small></div>
      </div>
      <div class="tn-now"><span class="lb">Now</span><b id="tnNow">Late Crate</b><span class="tn-k" id="tnKind">Station</span></div>
      <div class="nw-band" id="bTv" aria-hidden="true"><span class="nw-bl">TV</span><div class="bt"><div class="bk" id="bTvK"></div><div class="bs" id="bTvS"></div><i class="nd" id="ndTv"></i></div><span class="br">2&ndash;69</span></div>
      <div class="nw-band" id="bFm" aria-hidden="true"><span class="nw-bl">FM</span><div class="bt"><div class="bk" id="bFmK"></div><div class="bs" id="bFmS"></div><i class="nd" id="ndFm"></i></div><span class="br">88&ndash;108</span></div>
      <div class="tn-ctl"><button type="button" class="key" id="tnPrev" aria-label="Previous station">%s</button><button type="button" class="tn-scan on" id="tnScan" aria-pressed="true"><i></i>Scanning</button><button type="button" class="key" id="tnNext" aria-label="Next station">%s</button></div>
      <div class="mf"><span>Every number is unique in its market. Radio sits on even tenths, so no number matches a real FM station.</span></div>
    </div>
  </div></div>
</section>''' % (mh('The network','About'),AL,AR))

# ---------------- 01 WHAT IT IS ----------------
CMP=[('Who can start a channel','A few licence holders per town','Anyone, but it\'s a feed, not a channel','Anyone, with a number and a call sign'),
     ('How you find it','Flip the dial','An algorithm picks for you','Flip the dial, in your market'),
     ('What\'s on at 9 pm','A schedule','Whatever you search for','A schedule, live and recorded'),
     ('Who pays for it','Local businesses, in the breaks','Ads the platform sells, its cut first','Local businesses and pledges, to the station'),
     ('How shows travel','Syndication, to affiliates','They don\'t; you build your own audience','Syndication, paid every airing')]
rows=''.join('<div class="cm-r"><b>%s</b><span>%s</span><span>%s</span><span class="nw-us">%s</span></div>'%r for r in CMP)
a('''<section class="blk" id="what"><div class="wrap"><div class="sheet">
  <div class="cell hd" style="--d:7">%s<div class="cb"><h2>Old TV's best idea.<br>Open to everyone.</h2></div></div>
  <div class="cell hd" style="--d:5">%s<div class="cb end"><p class="lede">Broadcast TV had a schedule, a dial, local ads and shows that travelled. Then the internet gave everyone a channel and took all of that away. We kept what worked and dropped the licence.</p></div></div>
  <div class="cell nw-cmp" style="--d:12">
    <div class="cm-r hd3"><span></span><span>Broadcast TV</span><span>Streaming platforms</span><span class="nw-us">The network</span></div>
    %s
  </div>
</div></div></section>'''%(mh('What it is','Then and now','01'),mh('Why a network'),rows))

# ---------------- 02 THE DIAL / CALL SIGNS ----------------
RULES=[('A number in your market','TV from 2.1 to 69.9, radio from 88.2 to 107.8. Each number belongs to one station in each market.'),
 ('A call sign that\'s yours','Three to five letters, unique across the whole network. Pick it once: it can\'t change after you sign on.'),
 ('Nothing that looks official','No four-letter signs starting with K or W, which look like real FCC stations, and no network or brand names.'),
 ('Hold one before you\'re ready','Reserve a call sign and a number on the waitlist. It\'s held for 120 days, with a reminder before it lapses.'),
 ('Sign off for good, and it\'s kept','Your call sign stays yours for a year. The number goes back to the market after 90 days.')]
a('''<section class="blk" id="dial"><div class="wrap"><div class="sheet">
  <div class="cell hd" style="--d:5;--t:6">%s<div class="cb"><h2>Every station<br>gets a number.</h2><p class="lede">A number you can remember and a call sign you can say out loud. It's how people find you again tomorrow.</p>
    <div class="nw-cs" id="cs">
      <label for="csIn" class="lb">Try a call sign</label>
      <div class="nw-csin"><input id="csIn" type="text" maxlength="5" autocomplete="off" spellcheck="false" value="TACO" aria-describedby="csOut"><span class="nw-csch">12.4</span></div>
      <ul class="nw-csck" id="csCk"></ul>
      <p class="nw-csout" id="csOut" aria-live="polite"></p>
    </div></div></div>
  <div class="cell rgl" style="--d:7;--t:6">%s<ol class="rg">%s</ol></div>
</div></div></section>'''%(mh('The dial','Numbers and call signs','02'),mh('How numbers work','Five rules'),li(RULES)))

# ---------------- 03 KINDS ----------------
KINDS=[('#C04A9E','Stations','Run by an operator','A person, a club, a school or a business runs the schedule, sells the breaks and keeps what they earn.','12.1 BEAT, 24.1 REEL'),
 ('#EBA03A','Studios','Make shows, no channel','Offer programs to every station through the syndication market and get paid when they air.','Pomona Vinyl Club'),
 ('#5B7BE0','Claimable','We run it until you claim it','For creators whose work already airs with their permission. Earnings wait in escrow until they claim the station.','18.1 SAZN'),
 ('#9A9CAB','The catalog','Public domain, checked twice','Films and recordings the public owns, each cleared by two different people, free for any station to carry.','60.1 OCAT'),
 ('#2F9A72','Listed','A public source, as it is','City meetings and public access, played from the source\'s own stream with their permission. No ads, ever.','7.1 CIVC')]
a('''<section class="blk" id="kinds"><div class="wrap"><div class="sheet">
  <div class="cell hd" style="--d:7">%s<div class="cb"><h2>Five kinds<br>of station.</h2></div></div>
  <div class="cell hd" style="--d:5">%s<div class="cb end"><p class="lede">They share the dial, the guide and the remote. What differs is who runs them and where the money goes.</p></div></div>
  %s
</div></div></section>'''%(mh('On the dial','Who\'s who','03'),mh('Kinds'),''.join('<div class="cell knd" style="--c:%s;--d:%s;--t:%s;--m:2"><div class="mh"><span><i class="sq"></i>%s</span><span>%s</span></div><div class="cb"><p>%s</p></div><div class="mf"><span class="tab">%s</span></div></div>'%(c,'4' if k<3 else '6','6' if k==2 else '3',n,t,p,e) for k,(c,n,t,p,e) in enumerate(KINDS))))

# ---------------- 04 MONEY ----------------
a('''<section class="blk" id="money"><div class="wrap"><div class="sheet">
  <div class="cell hd" style="--d:7">%s<div class="cb"><h2>Follow<br>the dollar.</h2></div></div>
  <div class="cell hd" style="--d:5">%s<div class="cb end"><p class="lede">We earn two ways: a small share of what stations earn, and what stations pay for the storage and relays they use. Being on the air is free. Here's where a hundred dollars goes.</p></div></div>
  <div class="cell nw-fd" style="--d:8;--t:6;--m:2">
    <div class="mh"><span>Per $100</span><span>Pick a kind of money</span></div>
    <div class="fd-seg"><div class="seg2" id="fdSeg" role="group" aria-label="Kind of money"><button data-i="0" class="on">A spot it booked</button><button data-i="1">A spot we brought</button><button data-i="2">A pledge</button><button data-i="3">Cash carriage</button></div></div>
    <div class="cb">
      <div class="fd-bar" id="fdBar" aria-hidden="true"><i class="fa"><span></span></i><i class="fb"><span></span></i><i class="fc"><span></span></i></div>
      <div class="fd-rows">
        <div class="fd-r"><i style="--k:#5B7BE0"></i><span id="fdA">To the station</span><b class="tab" id="fdAv">$90.00</b></div>
        <div class="fd-r"><i style="--k:#EBA03A"></i><span>To the network, to run the dial</span><b class="tab" id="fdBv">$10.00</b></div>
        <div class="fd-r"><i class="pl"></i><span>Part of ours, back to stations through the pool</span><b class="tab">Shared monthly</b></div>
      </div>
      <p class="fd-note" id="fdNote"></p>
    </div>
  </div>
  <div class="cell use" style="--d:4;--t:6;--m:2">
    %s
    <div class="cb"><div class="us-r us-big"><span>Being on the air</span><b>Free</b></div><div class="us-r"><span>Storage, after 10 GB</span><b class="tab">$0.04 a GB a month</b></div><div class="us-r"><span>Relays to YouTube and the rest</span><b class="tab">$0.05 an hour, $25 most</b></div><div class="us-r"><span>Live hours, after 5</span><b class="tab">$0.75 an hour</b></div><p class="us-n">Paid from earnings first. Run short and the channel stays on the air; relays pause after a 14-day grace.</p></div>
  </div>
  <div class="cell pool" style="--d:12">
    <div class="mh"><span>The pool</span><span>On the 1st, for last month</span></div>
    <div class="pl3">
      <div style="--c:#5B7BE0"><small class="tab">01</small><b>An equal share</b><p>Split evenly between every station that aired last month. The smallest station gets what the biggest gets.</p></div>
      <div style="--c:#EBA03A"><small class="tab">02</small><b>A watch-time share</b><p>Split by the minutes people spent watching each station. Good programming is paid for twice.</p></div>
      <div style="--c:#C04A9E"><small class="tab">03</small><b>The creator fund</b><p>Grants for makers, approved in public by people who can't pay themselves or us.</p></div>
    </div>
  </div>
</div></div></section>'''%(mh('Money','How it moves','04'),mh('What we keep'),mh('What stations pay','Pay as you go')))

# ---------------- 05 MONEY WE CAN'T TOUCH ----------------
a('''<section class="blk" id="locks"><div class="wrap"><div class="sheet">
  <div class="cell hd" style="--d:7">%s<div class="cb"><h2>Money we<br>can't touch.</h2></div></div>
  <div class="cell hd" style="--d:5">%s<div class="cb end"><p class="lede">Earnings for creators who haven't joined yet, and the creator fund, sit in public contracts. They can pay a creator or a grant. There is no way for them to pay us.</p></div></div>
  <div class="cell lk2" style="--d:6;--t:6;--m:2">
    <div class="mh"><span>Paying a creator or a grant</span><span>2 of 3 keys</span></div>
    <div class="cb"><div class="tl3" data-run aria-hidden="true">
      <div class="t3 t3-keys"><b>Approve</b><span><i></i><i></i><i class="x"></i></span><small>Two of three people, held separately</small></div>
      <div class="t3 t3-wait"><b>72 hours in public</b><span class="t3-tb"><i></i></span><small>Anyone can see it. Any one key can stop it</small></div>
      <div class="t3 t3-done"><b>Paid</b><span class="t3-ok"></span><small>Only to the creator, or as a grant</small></div>
    </div></div>
  </div>
  <div class="cell lk2" style="--d:6;--t:6;--m:2">
    <div class="mh"><span>Changing the contracts</span><span>7-day lock</span></div>
    <div class="cb"><div class="tl3" data-run aria-hidden="true">
      <div class="t3 t3-keys"><b>Proposed</b><span><i></i></span><small>By the network</small></div>
      <div class="t3 t3-wait"><b>7 days in public</b><span class="t3-tb"><i></i></span><small>Every key holder can cancel it</small></div>
      <div class="t3 t3-done"><b>Live</b><span class="t3-ok"></span><small>One honest key is enough to stop it</small></div>
    </div></div>
  </div>
  <div class="cell" style="--d:12"><div class="nw-facts">
    <div><small>Unclaimed after</small><b class="tab">3 years</b><span>then it becomes grants</span></div>
    <div><small>Can pay the network</small><b class="tab">Never</b><span>not a code path that exists</span></div>
    <div><small>Paid into escrow</small><b class="tab">Weekly</b><span>after the same shares as any station</span></div>
    <div><small>Anyone can read it</small><b class="tab">Always</b><span>every payment, on chain</span></div>
  </div></div>
</div></div></section>'''%(mh('Escrow and the fund','On-chain','05'),mh('Why it\'s built this way')))

# ---------------- 06 STANDARDS ----------------
STD=[('Every break has a station ID','Viewers always know what they\'re watching. A station can choose how often, never "never".'),
 ('Every program has a rights record','Who made it, who owns the music and footage, and the licence it airs under. No record, no air.'),
 ('A claim stops a program everywhere','Anyone can file one. The program comes off every station at once while the station answers. The channel keeps running.'),
 ('Repeat claims pause carriage','Three upheld claims in a year and a station can\'t offer shows to others until it\'s sorted.'),
 ('Ratings and advisories on every show','From TV-Y to TV-MA, with language and mature flags. Children\'s programs never get personalized ads.'),
 ('Breaks stay short','Each station sets its own breaks, starting from three minutes of spots an hour, and can turn whole categories of ads away.'),
 ('A bill never takes a channel dark','Run short and you stay on the air. Relays and live hours pause after a 14-day grace; the dial never does.')]
a('''<section class="blk" id="standards"><div class="wrap"><div class="sheet">
  <div class="cell hd" style="--d:5;--t:6">%s<div class="cb"><h2>Rules every<br>station keeps.</h2><p class="lede">Few of them, written plainly, the same for the biggest station and the smallest.</p>
    <div class="rrec" aria-hidden="true"><div class="rr-h"><b>A rule change</b><span class="rr-ok"><i></i>Dated</span></div><div class="rr-l"><span>Takes effect</span><b>From a date, never before today</b></div><div class="rr-l"><span>Backdated</span><b>Never</b></div><div class="rr-l"><span>The old value</span><b>Kept, with who changed it</b></div><div class="rr-l"><span>Past statements</span><b>Read exactly as they did</b></div></div></div></div>
  <div class="cell rgl" style="--d:7;--t:6">%s<ol class="rg">%s</ol></div>
</div></div></section>'''%(mh('Standards','Seven of them','06'),mh('On every station','For everyone'),li(STD)))

# ---------------- 07 WHO + FAQ ----------------
FAQ=[('Who runs the network?','A small team in Southern California. We run the network desk: rights checks, the catalog, markets and the rules on this page. Stations run themselves.'),
 ('Where are you starting?','The Inland Empire first, then Los Angeles and Orange County. Anyone anywhere can sign on; those are the markets we\'re filling first.'),
 ('Is it really free to watch?','Yes. No account, no subscription. Spots, sponsors and pledges pay for the stations, and stations pay for the storage they use.'),
 ('Can I watch on my TV?','On Android TV, Google TV and Fire TV in the browser, or cast from your phone and use the phone as the remote.'),
 ('Do I own my station?','Your number, call sign, schedule and earnings are yours. You decide what airs and who can carry it.'),
 ('Can my city or school be on the dial?','Yes. Public meetings and public access can be listed from their own stream, with no ads, or run as a full station.'),
 ('Is the software open?','That\'s the plan: the apps and the code, open for anyone to read and improve. When the money contracts go live, every payment they make can be read by anyone.')]
a('''<section class="blk" id="faq"><div class="wrap"><div class="sheet">
  <div class="cell where" style="--d:5;--t:6">%s<div class="cb"><div class="mk-l" id="mkList"></div></div><div class="mf"><span>Markets are sets of ZIP codes. Your market decides which stations come first on your dial.</span></div></div>
  <div class="cell faq" style="--d:7;--t:6">%s<div class="qs">%s</div></div>
</div></div></section>'''%(mh('Where','Markets we\'re filling first','07'),mh('Questions people ask','%d answers'%len(FAQ)),''.join('<details><summary><span>%s</span><i aria-hidden="true"></i></summary><p>%s</p></details>'%q for q in FAQ)))
a('</main>')
open('body.html','w').write('\n'.join(H))
