import json,sys
n,a,b=sys.argv[1],float(sys.argv[2]),float(sys.argv[3])
w=json.load(open(f'src{n}.json'))['words']
for i,x in enumerate(w):
    if a<=x['start']<=b: print(f"{i:4d} {x['start']:7.2f}-{x['end']:7.2f} {x['word']}")
