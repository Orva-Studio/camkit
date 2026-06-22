import json,sys
n=sys.argv[1]
d=json.load(open(f'src{n}.json'))
w=d['words']
for i,x in enumerate(w):
    print(f"{i:4d} {x['start']:8.2f}-{x['end']:7.2f} {x['word']}")
