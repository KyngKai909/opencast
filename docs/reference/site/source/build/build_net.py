d='/tmp/claude-0/-home-claude/cc9f0db9-758e-5d85-865f-8efb14ba887d/scratchpad/site/'
r=d+'run/'; s=d+'synd/'; p=d+'net/'
a=open(d+'a.html').read().replace('<title>Dial</title>','<title>The Network | Dial</title>')
css=''.join(open(d+f).read() for f in ['polish.css','grid.css','flat.css','nav.css','shape.css','lt.css'])+open(r+'run.css').read()+open(s+'synd.css').read()+open(d+'spots/spots.css').read()+open(p+'net.css').read()
a=a.replace('</style>',css+'</style>',1)
head=open(r+'chrome_head.html').read()
routes=[('href="#run"','href="/run"'),('href="#syndication"','href="/syndication"'),('href="#spots"','href="/spots"'),('href="#network"','href="/network" class="is-cur" aria-current="page"'),('href="#contact"','href="/contact"')]
nav_i=head.index('<nav class="nl nl2"'); nav_j=head.index('</nav>',nav_i)
navs=head[nav_i:nav_j]
for x,y in routes: navs=navs.replace(x,y)
head=head[:nav_i]+navs+head[nav_j:]
mi=head.index('<nav class="mob-l"'); mj=head.index('</nav>',mi)
mob=head[mi:mj]
for x,y in routes: mob=mob.replace(x,y.split(' class')[0])
mob=mob.replace('<a href="#top" class="w">','<a href="/" class="w">')
head=head[:mi]+mob+head[mj:]
head=head.replace('<a class="np" href="#top"','<a class="np" href="/"')
head=head.replace('<a class="brand" href="#top" aria-label="Dial, home">','<a class="brand" href="/" aria-label="Dial, home">')
foot=open(p+'foot.html').read()
for x,y in [('href="#top">Open the dial','href="/">Open the dial'),('href="#guide"','href="/#guide"'),('href="#stations"','href="/#stations"'),('href="#run"','href="/run"'),('href="#syndication"','href="/syndication"'),('href="#spots"','href="/spots"'),('href="#breaks"','href="/#breaks"'),('href="#network"','href="/network"'),('href="#public"','href="/#public"'),('href="#contact">Contact','href="/contact">Contact')]:
    foot=foot.replace(x,y)
js=open(s+'common_head.js').read().replace('/*DATA*/',open(r+'shared_data.js').read())+open(p+'net.js').read()+open(s+'common_tail.js').read()
js=js.encode('ascii','backslashreplace').decode('ascii').replace('\\x','\\u00')
out=a+(head+open(p+'body.html').read()+'\n'+foot).encode('ascii','xmlcharrefreplace').decode('ascii')+'\n<script src="https://cdn.jsdelivr.net/npm/lenis@1.1.13/dist/lenis.min.js"></script>\n<script>\n'+js+'\n</script>\n'
open('/mnt/user-data/outputs/site/site-network.html','w').write(out)
i=out.find('</style>')+len('</style>')
open('/mnt/user-data/outputs/claude-code/site-network.html','w').write('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'+out[:i]+'\n</head>\n<body>\n'+out[i:]+'\n</body>\n</html>\n')
print(len(out))
