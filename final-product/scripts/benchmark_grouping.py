"""Offline method comparison on synthetic synonym and market-scope cases."""
import json
import re
import time
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from difflib import SequenceMatcher
from types import SimpleNamespace
from src.ai.clustering import cluster_findings
from src.ai.schemas import ClusteringBatch, SemanticCluster


def sample():
    result=[]
    for vehicle in ['F70','G60','G68','G70']:
        for market in ['DE','FR','CN']:
            for summary,need in [('Seats hurt on long journeys','Comfortable long trips'),
                                 ('My back aches after driving','Comfortable long trips')]:
                result.append({'finding_id':f'F{len(result)+1:04d}','source_id':f'S{len(result)+1:04d}',
                               'source_reference':{'vehicle':vehicle,'market':market},
                               'category':'Comfort','finding_type':'complaint','summary':summary,
                               'customer_need':need,'evidence_quote':summary,'evidence_valid':True})
    return result


def original_lexical(findings):
    """Equivalent grouping rule from origin/feature/ai-engine (0.9 similarity)."""
    groups=[]
    for f in findings:
        found=None
        for g in groups:
            first=g[0]
            if f['category']==first['category'] and f['finding_type']==first['finding_type'] and f['source_reference']['vehicle']==first['source_reference']['vehicle']:
                left=' '.join(re.findall(r'\w+',f['summary'].casefold()))
                right=' '.join(re.findall(r'\w+',first['summary'].casefold()))
                if SequenceMatcher(None,left,right).ratio()>=.9:found=g;break
        if found is None:
            found=[];groups.append(found)
        found.append(f)
    return [[f['finding_id'] for f in g] for g in groups]


def exact_scope(findings):
    groups={}
    for f in findings:
        scope=f['source_reference']
        key=(scope['vehicle'],scope['market'],f['category'],f['finding_type'],f['summary'].casefold())
        groups.setdefault(key,[]).append(f['finding_id'])
    return list(groups.values())


class SemanticMock:
    """API-shaped mock; groups same-scope synonyms by intended meaning."""
    def __init__(self):self.responses=self;self.calls=0
    def parse(self,*,input,**_):
        self.calls+=1
        items=json.loads(input)
        parsed=ClusteringBatch(clusters=[SemanticCluster(title='Seat comfort on long trips',summary='Seats cause discomfort on long trips',category='Comfort',finding_type='complaint',finding_ids=[x['finding_id'] for x in items],uncertainty='Check broader evidence.')])
        return SimpleNamespace(output_parsed=parsed,status='completed',output=[])


def quality(groups,findings):
    assignment={fid:i for i,group in enumerate(groups) for fid in group}
    tp=fp=fn=0
    for i,left in enumerate(findings):
        for right in findings[i+1:]:
            a,b=left['source_reference'],right['source_reference']
            expected=a['vehicle']==b['vehicle'] and a['market']==b['market']
            actual=assignment[left['finding_id']]==assignment[right['finding_id']]
            if actual and expected:tp+=1
            elif actual:fp+=1
            elif expected:fn+=1
    return {'pair_precision':round(tp/(tp+fp),3) if tp+fp else None,
            'pair_recall':round(tp/(tp+fn),3) if tp+fn else None,
            'cross_market_false_pairs':fp,'missed_same_scope_pairs':fn}


def run():
    findings=sample();cases=[]
    for name,fn,loops in [('original lexical',original_lexical,500),('exact scoped',exact_scope,500)]:
        start=time.perf_counter()
        for _ in range(loops):groups=fn(findings)
        cases.append({'method':name,'milliseconds_per_run':round((time.perf_counter()-start)*1000/loops,4),
                      'clusters':len(groups),'model_calls':0,**quality(groups,findings)})
    mock=SemanticMock();start=time.perf_counter();clusters=cluster_findings(mock,findings)
    groups=[c['finding_ids'] for c in clusters]
    cases.append({'method':'scoped semantic (mock)',
                  'milliseconds_per_run':round((time.perf_counter()-start)*1000,4),
                  'clusters':len(groups),'model_calls':mock.calls,**quality(groups,findings)})
    single=SemanticMock();cluster_findings(single,findings[::2])
    return {'dataset':'24 synthetic findings, 4 vehicle codes × 3 markets × 2 paraphrases',
            'live_api_calls':0,'singletons_model_calls':single.calls,'cases':cases,
            'limit':'Semantic result uses a deterministic mock. Its CPU time and pair scores do not predict live API latency or accuracy.'}

if __name__=='__main__':print(json.dumps(run(),indent=2))
