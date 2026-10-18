d='/tmp/claude-0/-home-claude/cc9f0db9-758e-5d85-865f-8efb14ba887d/scratchpad/site/'
a=open(d+'a.html').read(); a=a.replace('</style>',open(d+'polish.css').read()+open(d+'grid.css').read()+open(d+'flat.css').read()+open(d+'nav.css').read()+open(d+'shape.css').read()+open(d+'lt.css').read()+'</style>',1)
bh=open(d+'b.html').read()
for x in ['run','syndication','spots','network','contact']: bh=bh.replace('href="#'+x+'"','href="/'+x+'"')
out=a+bh+'<script>\n'+open(d+'c.js').read()+'\n</script>\n'
open('/mnt/user-data/outputs/site/site-home.html','w').write(out)
i=out.find('</style>')+len('</style>')
open('/mnt/user-data/outputs/claude-code/site-home.html','w').write('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'+out[:i]+'\n</head>\n<body>\n'+out[i:]+'\n</body>\n</html>\n')
