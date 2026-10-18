AR='<svg viewBox="0 0 20 20"><path d="M5 10h10M10.5 5.5 15 10l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
KEY='<span class="key">'+AR+'</span>'
def mh(l,r='',ix=None,rc=''):
    left=('<b class="ix">%s</b>'%ix if ix else '')+l
    return '<div class="mh"><span>%s</span>%s</div>'%(left,('<span%s>%s</span>'%((' class="%s"'%rc) if rc else '',r)) if r else '')

H=[]; a=H.append
a('<main id="top">')

# ---------------- HERO: the break, live ----------------
a('''<section class="blk rhero sp-hero" id="hero">
  <div class="wrap"><div class="sheet">
    <div class="cell hd rh cr-l" style="--d:5">
      %s
      <div class="cb">
        <h1 class="sy-h"><span>Be in <br class="lg">the break.</span><span class="dim">Pay for <br class="lg">who watched.</span></h1>
        <p class="lede">Your :15 or :30 in the breaks of stations people actually sit with: near your shop, or anywhere you ship. Stations choose your spot. You pay only for the people who tuned in.</p>
        <div class="acts"><a class="btn" href="#plan" data-cur="Plan"><span class="live" aria-hidden="true"><i></i>:15</span>Start a spot</a><a class="btn ghost" href="#ways">Order one made</a></div>
      </div>
      <div class="mf"><span>No minimum spend. No contract. Pause any time.</span></div>
    </div>
    <div class="cell cr" style="--d:7" id="spair">
      <div class="mh mh-dl"><div class="deals" aria-live="off"><span class="dl-k">Just booked</span><div class="dl-v" id="bkV"></div></div><span class="lv"><i></i>Live</span></div>
      <div class="cr-mon"><div class="cr-scr"><canvas id="spTv" width="640" height="360" aria-hidden="true"></canvas><span class="cr-bug" id="spBug">12.1</span><span class="cr-chip" id="crChip">Program</span></div></div>
      <div class="cr-tl" aria-hidden="true"><div class="cr-segs" id="crSegs"></div><i class="cr-ph" id="crPh"><b id="crClock">8:14:02</b></i></div>
      <div class="cr-meter">
        <div><small>Tuned in for your spot</small><b class="tab" id="crTun">0</b><span id="crTunS">Counting the room</span></div>
        <div><small>This airing costs</small><b class="tab" id="crCost">$0.00</b><span>$8 per 1,000 tuned in</span></div>
        <div><small>Tonight, of $300</small><b class="tab" id="crTot">$33.02</b><span id="crCu">9 customers from the code</span></div>
      </div>
      <div class="mf"><span>An example break on one station. Your spot is the cream one.</span></div>
    </div>
  </div></div>
</section>''' % mh('Spot market','For advertisers'))

# ---------------- 01 WHO ----------------
a('''<section class="blk" id="who"><div class="wrap"><div class="sheet">
  <div class="cell hd" style="--d:7">%s<div class="cb"><h2>Down the street,<br>or ships anywhere.</h2></div></div>
  <div class="cell hd" style="--d:5">%s<div class="cb end"><p class="lede">Local stations used to be where a barber or a hardware store could afford to be on TV. That's the idea here, for anyone with something to sell to the people watching.</p></div></div>'''%(mh('Who it\'s for','Three kinds of advertiser','01'),mh('Why it works')))
WHO=[('A','#E0583A','You have a shop','Set a distance','Down the street',
      'Pick how far your customers come from. Your spot airs on stations watched inside that circle.',
      [('Within','8 miles of Orange St'),('Counted by','Clear Pay at the counter')]),
     ('B','#5B7BE0','You sell online','Pick markets','Ships anywhere',
      'No storefront needed. Choose the markets you ship to, and codes used at checkout count on their own.',
      [('Markets','Inland Empire, Long Beach'),('Counted by','Shopify, Stripe or Square')]),
     ('C','#2F9A72','You run an agency','One login','For your clients',
      'Every business you manage in one place, each with its own balance, spots and statements. Order spots made for them too.',
      [('Businesses','As many as you manage'),('Statements','One per business, monthly')])]
for L,c,t,tag,h,p,rows in WHO:
    rr=''.join('<div class="rr-l"><span>%s</span><b>%s</b></div>'%x for x in rows)
    a('''  <div class="cell side wh" style="--c:%s;--d:4;--t:6;--m:2">
    <div class="mh"><span><b class="ix">%s</b>%s</span><span>%s</span></div>
    <div class="cb"><h3>%s</h3><p>%s</p><div class="rrec">%s</div></div>
    <a class="mf go" href="#plan" data-cur="Plan"><span>%s</span>%s</a>
  </div>'''%(c,L,t,tag,h,p,rr,'Plan a spot' if L!='C' else 'Talk to us',KEY))
a('</div></div></section>')

# ---------------- 02 PLAN ----------------
a('''<section class="blk" id="plan"><div class="wrap"><div class="sheet">
  <div class="cell hd" style="--d:7">%s<div class="cb"><h2>Say who it's for.<br>See what it buys.</h2></div></div>
  <div class="cell hd" style="--d:5">%s<div class="cb end"><p class="lede">You set the rate and the budget. Stations decide whether your spot fits their breaks, so a fair rate gets picked up by more of them. The planner shows what you'd get before you spend a cent.</p></div></div>
  <div class="cell pl-in" style="--d:5;--t:6;--m:2">
    %s
    <div class="cb">
      <div class="cr"><span class="lb">Where you sell</span><div class="seg2" id="pWhere" role="group" aria-label="Where you sell"><button data-v="shop" class="on">In a shop</button><button data-v="online">Online</button></div></div>
      <div class="cr" id="pDistW"><label for="pDist">Within<b class="tab" id="vDist">12 miles</b></label><input id="pDist" type="range" min="2" max="60" step="1" value="12"><small class="crh">Of 1840 Orange St, Riverside. Change the address when you sign up.</small></div>
      <div class="cr" id="pMktW" hidden><span class="lb">Markets you ship to</span><div class="chips" id="pMkt" role="group" aria-label="Markets"></div></div>
      <div class="cr"><span class="lb">Kinds of station</span><div class="chips" id="pKind" role="group" aria-label="Kinds of station"></div></div>
      <div class="cr"><span class="lb">Times of day</span><div class="chips" id="pTime" role="group" aria-label="Times of day"></div></div>
      <div class="cr"><span class="lb">Your rate</span><div class="seg2" id="pKindR" role="group" aria-label="Rate"><button data-v="k" class="on">Per 1,000 tuned in</button><button data-v="a">Per airing</button></div></div>
      <div class="cr"><label for="pRate"><span id="lRate">Rate per 1,000 tuned in</span><b class="tab" id="vRate">$8.00</b></label><input id="pRate" type="range" min="2" max="20" step=".5" value="8"></div>
      <div class="cr"><label for="pBud">Budget<b class="tab" id="vBud">$300</b></label><input id="pBud" type="range" min="50" max="2000" step="25" value="300"></div>
      <div class="cr"><label for="pCap">Most per day<b class="tab" id="vCap">$15</b></label><input id="pCap" type="range" min="5" max="150" step="5" value="15"></div>
    </div>
  </div>
  <div class="cell pl-out" style="--d:7;--t:6;--m:2">
    %s
    <div class="pl-stats">
      <div><small>Stations that fit</small><b class="tab" id="oSt">0</b></div>
      <div><small>Airings a day</small><b class="tab" id="oAd">0</b></div>
      <div><small>Tuned in a day</small><b class="tab" id="oTd">0</b></div>
      <div><small>Budget lasts</small><b class="tab" id="oDays">0</b></div>
    </div>
    <div class="pl-pick"><span class="lb">How likely stations are to pick it</span><div class="pk-bar" aria-hidden="true"><i id="pkI"></i></div><b id="pkL">Most will</b></div>
    <div class="pl-list" id="pList" aria-live="polite"></div>
    <div class="mf"><span id="pNote">Estimates from last month's viewing. Stations, viewers and costs here are examples.</span></div>
  </div>'''%(mh('Plan it','Before you spend','02'),mh('How it\'s priced'),mh('Who it\'s for','Change anything'),mh('What it buys','Estimated','',)))
a('</div></div></section>')

# ---------------- 03 PAY FOR WHO WATCHED ----------------
a('''<section class="blk" id="paid"><div class="wrap"><div class="sheet">
  <div class="cell hd" style="--d:7">%s<div class="cb"><h2>Every airing,<br>settled honestly.</h2></div></div>
  <div class="cell hd" style="--d:5">%s<div class="cb end"><p class="lede">Before an airing, the most it could cost is held from your balance. After, it's settled at what it really cost, and the rest comes back. Pick an airing to see how.</p></div></div>
  <div class="cell rct" style="--d:12">
    <div class="mh"><span>Three airings of Pumpkin latte</span><span class="rs-k">From the statement</span></div>
    <div class="rc-tabs"><div class="seg2" id="rcTabs" role="tablist" aria-label="Airings"><button data-i="0" class="on" role="tab">BEAT, 8:14 pm</button><button data-i="1" role="tab">REEL, 9:02 pm</button><button data-i="2" role="tab">NITE, 11:40 pm</button></div></div>
    <div class="rcp">
      <div class="rc-l" id="rcL"></div>
      <div class="rc-r">
        <div class="rc-steps" id="rcSteps"><div><i class="tab">01</i><b>Held</b><span id="rcS1"></span></div><div><i class="tab">02</i><b>Counted</b><span id="rcS2"></span></div><div><i class="tab">03</i><b>Settled</b><span id="rcS3"></span></div></div>
        <div class="vw"><span class="lb">Who tuned in</span><div class="vw-bar" id="vwBar" aria-hidden="true"></div><div class="t-lg" id="vwLg"></div></div>
        <p class="rc-note" id="rcNote"></p>
      </div>
    </div>
    <div class="mf"><span>On the dial we count viewers with our own player. Relay viewers come from YouTube's and Twitch's own numbers.</span></div>
  </div>
</div></div></section>'''%(mh('Paying','Per airing','03'),mh('Held, counted, settled')))

# ---------------- 04 CUSTOMERS ----------------
a('''<section class="blk" id="customers"><div class="wrap"><div class="sheet">
  <div class="cell hd" style="--d:7">%s<div class="cb"><h2>Count customers,<br>not impressions.</h2></div></div>
  <div class="cell hd" style="--d:5">%s<div class="cb end"><p class="lede">Every spot ends with your offer, a short code and a QR. When someone uses it, at your counter or at checkout online, it's counted against the spot that sent them.</p></div></div>
  <div class="cell endc" style="--d:5;--t:6;--m:2">
    %s
    <div class="cb"><div class="ec" aria-hidden="true">
      <div class="ec-top"><span>Orange Street Coffee</span><span class="tab">0:12</span></div>
      <div class="ec-mid"><div><small>Show this code</small><b>PUMPKIN</b><p>A free pastry with a latte</p></div><canvas id="qr" width="116" height="116"></canvas></div>
      <div class="ec-bot"><span>Good for 7 days</span><span>1840 Orange St</span></div>
    </div>
    <p class="ec-cap">The last few seconds of every spot, added for you. Viewers can scan it from a TV or save it to their phone for later.</p></div>
  </div>
  <div class="cell fun" style="--d:7;--t:6;--m:2" id="fun">
    %s
    <div class="cb">
      <div class="fn" id="fnRows"></div>
      <div class="fn-tot"><div><small>Spent this month</small><b class="tab">$147.36</b></div><div><small>Each customer cost</small><b class="tab hot">$3.59</b></div></div>
      <div class="cnt">
        <div class="c-r"><b>At checkout online</b><span>Shopify, Stripe or Square. Counted on its own</span><em class="tab">17</em></div>
        <div class="c-r"><b>At the counter</b><span>Clear Pay. Counted on its own</span><em class="tab">19</em></div>
        <div class="c-r"><b>Anywhere else</b><span>Marked in the app by you or a manager</span><em class="tab">5</em></div>
      </div>
    </div>
    <div class="mf"><span>Not everyone who comes in because of a spot uses the code. These are the customers we can count.</span></div>
  </div>
</div></div></section>'''%(mh('Results','Codes and QR','04'),mh('What counts'),mh('The end card','Added to every spot'),mh('One month, one spot','Bars on a log scale')))

# ---------------- 05 WAYS TO BUY ----------------
a('''<section class="blk" id="ways"><div class="wrap"><div class="sheet">
  <div class="cell hd" style="--d:7">%s<div class="cb"><h2>Three ways<br>into the break.</h2></div></div>
  <div class="cell hd" style="--d:5">%s<div class="cb end"><p class="lede">Bring a finished spot, put your name on a show you love, or have one made by people who make TV every day.</p></div></div>'''%(mh('Buying','Spots, sponsors, made for you','05'),mh('Pick one or all three')))
a('''  <div class="cell trm wy" style="--c:#E0583A;--d:4;--t:6;--m:2">
    <div class="mh"><span><i class="sq"></i>Spots</span><span>Self-serve</span></div>
    <div class="cb"><div class="len" aria-hidden="true"><i style="flex:15"><span>:15</span></i><i style="flex:30"><span>:30</span></i><i style="flex:60"><span>:60</span></i></div>
    <h3>Your spot in their breaks</h3><p>Upload a finished :15, :30 or :60. We check it will air cleanly and add your code. Set a rate per 1,000 tuned in or per airing, a budget and a daily cap, and stations choose it.</p></div>
    <div class="mf"><span class="tab">Any budget. Paid as it airs</span></div>
  </div>
  <div class="cell trm wy" style="--c:#EBA03A;--d:4;--t:6;--m:2">
    <div class="mh"><span><i class="sq"></i>Sponsorships</span><span>Monthly</span></div>
    <div class="cb"><div class="cred" aria-hidden="true"><small>Read on air, after the show's open</small><p>Late Crate is brought to you by <b>Orange Street Coffee</b>. Roasted on Orange Street since 2011.</p></div>
    <h3>Your name on a station or a show</h3><p>Sponsor a whole station or one program, by the month. They thank you on air and on their station page, with one line you write. Each station sets its own minimum.</p></div>
    <div class="mf"><span class="tab">Renews monthly until you end it</span></div>
  </div>
  <div class="cell trm wy" style="--c:#2F9A72;--d:4;--t:6;--m:2">
    <div class="mh"><span><i class="sq"></i>Made for you</span><span>Order a spot</span></div>
    <div class="cb"><ol class="mtl" aria-hidden="true"><li class="on"><i></i>Brief</li><li class="on"><i></i>Quote</li><li><i></i>Made</li><li><i></i>Yours</li></ol>
    <h3>Have it made</h3><p>Send a brief: what it's about, what it must say, any files. A station that makes spots, or the network's studio, quotes before anything is paid. The finished spot is yours to run anywhere on the network.</p></div>
    <div class="mf"><span class="tab">The maker is paid for the work, even if it never airs</span></div>
  </div>
  <div class="cell otl is-later" style="--d:12">
    <div class="mh"><span><i class="dot"></i>Ad exchanges and VAST partners</span><span>Later</span></div>
    <div class="cb"><p>Buying programmatically? Stations will be able to fill break time no one has booked through partners like Google Ad Manager, with each station's categories and ratings sent on every request. Spots in the market always air first.</p><label class="tg"><input type="checkbox" disabled aria-label="Open for partners"><span></span>Not yet open</label></div>
  </div>''')
a('</div></div></section>')

# ---------------- 06 RULES ----------------
RG=[('Checked before it airs','Length, loudness and picture, so it airs cleanly on every station. Your code and QR go on the end card.'),
 ('Stations choose','Each station decides which spots air in its breaks, and can turn away whole categories. Your spot only airs where it\'s welcome.'),
 ('Counted, never guessed','Viewers on the dial come from our own player. Relay viewers come from YouTube and Twitch, and count only when the platform says where they are.'),
 ('Pay only for what aired','Each airing settles at what it really cost. Airings cut short come back in full. Anything unspent stays yours to use or withdraw.'),
 ('Stop any time','Pause a spot and stations fill its time. Bring it back when you like. Ending a sponsorship stops the renewal; it runs to the end of the month you paid for.')]
a('''<section class="blk" id="rules"><div class="wrap"><div class="sheet">
  <div class="cell hd" style="--d:5;--t:6">%s<div class="cb"><h2>Their breaks.<br>Your spot.</h2><p class="lede">Stations keep their breaks short and local. These are the rules that keep it that way.</p><div class="rrec" aria-hidden="true"><div class="rr-h"><b>Pumpkin latte</b><span class="rr-ok"><i></i>Ready to air</span></div><div class="rr-l"><span>Length</span><b>0:15, exactly</b></div><div class="rr-l"><span>Loudness</span><b>Levelled to broadcast</b></div><div class="rr-l"><span>Picture</span><b>1080p, safe margins</b></div><div class="rr-l"><span>End card</span><b>PUMPKIN and QR added</b></div><div class="rr-l"><span>Category</span><b>Food and drink</b></div></div></div></div>
  <div class="cell rgl" style="--d:7;--t:6">%s<ol class="rg">%s</ol></div>
</div></div></section>'''%(mh('Rules','Five of them','06'),mh('How the breaks stay good','For everyone'),''.join('<li><i class="tab">%02d</i><div><b>%s</b><p>%s</p></div></li>'%(k+1,h,p) for k,(h,p) in enumerate(RG))))

# ---------------- 07 WHO GETS WHAT + FAQ ----------------
shr=[('A spot you book','90%','10%'),('A sponsorship','90%','10%'),('A spot made for you','80%','20%'),('A deal our team brought you','80%','20%')]
w='<div class="shr2"><div class="s2 hd2"><span>Your dollar</span><span>To the station</span><span>We keep</span></div>'+''.join('<div class="s2"><b>%s</b><span class="sk tab">%s</span><span class="nk tab">%s</span></div>'%x for x in shr)+'</div>'
FAQ=[('Do I have to be local?','No. Shops set a distance from their address. Online businesses pick the markets they ship to, and codes used at checkout count on their own.'),
 ('How much should I spend?','Whatever you like: there\'s no minimum and no contract. Set a budget and a most-per-day, and the planner shows how long it lasts. You can change both at any time.'),
 ('What rate should I set?','A rate per 1,000 tuned in means you pay for viewers, whatever the station. A rate per airing suits a small station you want to be on. Higher rates get picked by more stations.'),
 ('What if nobody watches?','Then that airing costs nothing. What was held for it comes back to your balance a few minutes after it ends.'),
 ('Can I choose the stations?','You choose the area, the kinds of station and the times of day; stations choose the spots. To be on one station or one show for sure, sponsor it.'),
 ('Do I need a spot already?','No. Order one made by a station that makes spots, or by the network\'s studio. They quote before anything is paid, and the finished spot is yours.'),
 ('Where do I see results?','Every airing, with the station, the time, how many tuned in and what it cost. Customers from your code, and what each one cost. A statement every month.')]
a('''<section class="blk" id="faq"><div class="wrap"><div class="sheet">
  <div class="cell" style="--d:5;--t:6">%s<div class="cb">%s</div><div class="mf"><span>Shares never change what you pay. Card fees are added when you put money in. Part of what we keep goes back to stations through the co-op pool.</span></div></div>
  <div class="cell faq" style="--d:7;--t:6">%s<div class="qs">%s</div></div>
</div></div></section>'''%(mh('Who gets what','Per dollar you spend','07'),w,mh('Questions advertisers ask','%d answers'%len(FAQ)),''.join('<details><summary><span>%s</span><i aria-hidden="true"></i></summary><p>%s</p></details>'%q for q in FAQ)))
a('</main>')
open('body.html','w').write('\n'.join(H))
