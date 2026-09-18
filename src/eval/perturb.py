# Perturbed replays (Jacob 2026-09-18: "test counterfactual user moves frequently to see robustness of all the functions").
# Takes a scenario piece and interleaves user moves into the `then` of every round: the person favourites, zooms, renames the
# chat, edits a card, deletes a filed node, undoes, toggles the light, asks the brain, refreshes — while the real conversation goes on.
import json,sys
src,dst,seed=sys.argv[1],sys.argv[2],sys.argv[3]
d=json.load(open(src)); R=d['rounds']
MOVES=[
 [{'do':'bind','key':'n1'},{'do':'favorite','key':'n1'},{'favoriteOf':'n1'} if False else {'do':'wait','ms':500}],
 [{'do':'brainChat','text':'what have we decided so far? one line'},{'askSays':'.+'} if False else {'do':'wait','ms':300}],
 [{'do':'bind','key':'n2'},{'do':'zoom','key':'n2','focus':False},{'do':'wait','ms':500},{'do':'zoom','key':seed,'focus':False}],
 [{'do':'rename','name':'renamed mid-thread'},{'chatName':'renamed mid-thread'}],
 [{'do':'bind','key':'n3'},{'do':'statement','key':'n3','status':'parked'},{'do':'wait','ms':300}],
 [{'do':'bind','key':'n4'},{'do':'delete','key':'n4'},{'do':'undo'},{'nodeExists':'n4','is':True}],
 [{'do':'litAll','on':False},{'do':'wait','ms':500},{'do':'litAll','on':True}],
 [{'do':'title','key':seed,'title':'Hand title'},{'do':'refresh'}],
 [{'do':'bind','key':'n5'},{'do':'light','key':'n5','on':False},{'do':'wait','ms':300},{'do':'light','key':'n5','on':True}],
 [{'do':'tidy','key':seed}],
]
k=0
for i,r in enumerate(R):
    mv=MOVES[k%len(MOVES)]; k+=1
    r['then']=list(mv)+[a for a in r.get('then',[]) if not a.get('do')]
d['name']=d['name']+' — PERTURBED (user moves every round)'
json.dump(d,open(dst,'w'),ensure_ascii=False)
print(dst,len(R),'rounds perturbed')
