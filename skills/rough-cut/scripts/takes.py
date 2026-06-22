import json,sys
n=sys.argv[1]
gap=float(sys.argv[2]) if len(sys.argv)>2 else 1.2
d=json.load(open(f'src{n}.json'))
w=d['words']
takes=[];cur=[]
for x in w:
    if cur and x['start']-cur[-1]['end']>gap:
        takes.append(cur);cur=[]
    cur.append(x)
if cur:takes.append(cur)
for t in takes:
    s=t[0]['start'];e=t[-1]['end']
    # drop degenerate tail words with zero-length identical stamps
    txt=' '.join(y['word'] for y in t)
    print(f"[{s:7.2f}-{e:7.2f}] ({e-s:5.1f}s {len(t):3d}w) {txt}")
