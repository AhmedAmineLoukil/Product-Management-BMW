import {useEffect,useMemo,useState} from 'react';
import {ArrowRight,BookOpen,CarFront,Database,FileCheck2,Loader2,ShieldAlert} from 'lucide-react';
import {useApp} from '../context';
import type {Dataset,Project,SourceRecord} from '../types';
import {uid} from '../lib/workspace';
import {Badge,Panel} from './common';
import {Button} from './ui/button';

type Kind='feedback'|'studies'|'sales'|'equipment';
type Scope={model_code:string;vehicle:string;market_code:string;market:string;counts:Record<Kind,number>};
type Manifest={files:{kind:string;name:string;available:boolean}[];scopes:Scope[];notes:string[]};
type Bundle={model_code:string;vehicle:string;market_code:string;market:string;datasets:{kind:Kind;type:Dataset['type'];name:string;sources:string[];records:Omit<SourceRecord,'datasetId'>[]}[];record_count:number};
const models=['F70','G60','G68','G70'];
const preferredMarket:Record<string,string>={F70:'EU',G60:'US',G68:'CN',G70:'US'};
const countLabels:Record<Kind,string>={feedback:'Feedback comments',studies:'Study measures',sales:'Sales year values',equipment:'Catalog + equipment'};

export default function BMWLibrary(){
 const {state,project,run,setProject,notify,cloud,navigate}=useApp();
 const [manifest,setManifest]=useState<Manifest|null>(null),[error,setError]=useState(''),[model,setModel]=useState(()=>models.find(code=>project.derivative.includes(code))??'F70'),[market,setMarket]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{if(cloud)return;let active=true;fetch('/api/bmw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'manifest'})}).then(async response=>{const data=await response.json() as Manifest&{error?:string};if(!response.ok)throw new Error(data.error??'Could not read the local BMW files.');if(active){setManifest(data);const current=data.scopes.find(scope=>scope.vehicle===project.derivative&&scope.market===project.market);if(current){setModel(current.model_code);setMarket(current.market_code);}}}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[cloud,project.derivative,project.market]);
 const choices=useMemo(()=>manifest?.scopes.filter(scope=>scope.model_code===model)??[],[manifest,model]);
 const chosen=choices.find(scope=>scope.market_code===market)??choices.find(scope=>scope.market_code===preferredMarket[model])??choices[0];
 const imported=chosen?state.datasets.filter(d=>d.projectId===state.projects.find(p=>p.derivative===chosen.vehicle&&p.market===chosen.market&&p.name==='BMW supplied-source workspace')?.id&&d.id.startsWith(`BMW-DS-${model}-${chosen.market_code}-`)).length:0;
 const load=async()=>{
  if(!chosen||loading)return;setLoading(true);
  try{
   const response=await fetch('/api/bmw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'load',model_code:chosen.model_code,market_code:chosen.market_code})});
   const bundle=await response.json() as Bundle&{error?:string};
   if(!response.ok)throw new Error(bundle.error??'The BMW source files could not be loaded.');
   if(bundle.model_code!==chosen.model_code||bundle.market_code!==chosen.market_code)throw new Error('The source scope changed during import. Please retry.');
   const existing=state.projects.find(p=>p.derivative===bundle.vehicle&&p.market===bundle.market&&p.name==='BMW supplied-source workspace');
   const target:Project=existing??{id:uid('PROJECT'),name:'BMW supplied-source workspace',derivative:bundle.vehicle,market:bundle.market,horizon:'2029–2031'};
   const datasets:Dataset[]=bundle.datasets.map(source=>{
    const id=`BMW-DS-${bundle.model_code}-${bundle.market_code}-${source.kind}`;
    const records=source.records.map(record=>({...record,datasetId:id}));
    if(records.some(record=>record.fields.source_vehicle_code!==bundle.model_code||record.fields.analysis_market_code!==bundle.market_code))throw new Error('A record does not match the chosen vehicle and market.');
    return {id,projectId:target.id,name:source.name,type:source.type,synthetic:false,status:'Ready' as const,createdAt:new Date().toISOString(),errors:[],columns:['source_file','source_sheet','source_row','source_market_label','source_market_granularity','source_model_scope','category','measure','value','year','volume','source_pdf_page'],records};
   }).filter(dataset=>!state.datasets.some(d=>d.id===dataset.id));
   if(!datasets.length){setProject(target.id);notify('This vehicle and market are already loaded.');return;}
   const ok=await run({type:'importBatch',project:existing?undefined:target,datasets});
   if(ok){setProject(target.id);notify(`Loaded ${datasets.reduce((n,d)=>n+d.records.length,0)} source records into ${target.derivative} / ${target.market}.`);navigate('Data Sources');}
  }catch(e){notify((e as Error).message,true);}finally{setLoading(false);}
 };
 if(cloud)return <Panel title="Supplied BMW data library" subtitle="Local source files"><p className="small muted">The private source-file library is available in the local workspace. Import approved data into your shared deployment through its own controlled process.</p></Panel>;
 return <section className="bmw-library" aria-label="BMW supplied data library"><div className="bmw-library-header"><div className="bmw-library-symbol"><CarFront size={25}/></div><div><span className="eyebrow">START WITH THE REAL SOURCE SCOPE</span><h2>BMW data library</h2><p>Choose a challenge vehicle and Europe, United States, or China. European country records are grouped for analysis while their original country remains attached to every source.</p></div><Badge tone="blue">Local files only</Badge></div>
 {error&&<div className="notice notice-amber"><ShieldAlert size={17}/><p>{error} Put the supplied workbooks and catalog in the ignored <code>data/raw/</code> folder.</p></div>}
 {!manifest&&!error&&<p className="bmw-library-loading"><Loader2 size={17} className="spin"/> Reading available source files…</p>}
 {manifest&&<><div className="bmw-library-controls"><label className="field"><span>1 · Vehicle</span><select aria-label="BMW library vehicle" value={model} onChange={e=>{setModel(e.target.value);setMarket('');}}>{models.map(code=><option key={code} value={code}>{manifest.scopes.find(s=>s.model_code===code)?.vehicle??code}</option>)}</select></label><label className="field"><span>2 · Analysis market</span><select aria-label="BMW library market" value={chosen?.market_code??''} onChange={e=>setMarket(e.target.value)}>{choices.map(scope=><option key={scope.market_code} value={scope.market_code}>{scope.market}</option>)}</select></label><div className="bmw-library-action"><span>3 · Open the source workspace</span><Button onClick={()=>void load()} disabled={!chosen||loading}>{loading?<Loader2 size={15} className="spin"/>:<ArrowRight size={15}/>} {loading?'Loading source records…':'Load this vehicle + market'}</Button></div></div>
 {chosen&&<><div className="bmw-library-scope"><div><strong>{chosen.vehicle}</strong><span>{chosen.market} · {Object.values(chosen.counts).reduce((a,b)=>a+b,0).toLocaleString()} source records{imported?` · ${imported} dataset group(s) loaded`:''}</span></div><div className="bmw-library-counts">{(Object.keys(countLabels) as Kind[]).map(kind=><div key={kind} className={chosen.counts[kind]?'has-data':''}><b>{chosen.counts[kind].toLocaleString()}</b><span>{countLabels[kind]}</span></div>)}</div></div>{chosen.market_code==='EU'&&<p className="small muted">Europe includes supplied UK, Sweden, France, Denmark, Finland, and Germany records alongside Europe-wide measures. Each record keeps its original source market and granularity.</p>}{!chosen.counts.feedback&&<div className="notice notice-blue"><BookOpen size={16}/><p>No customer verbatims were supplied for this vehicle and market. You can inspect its reference data, but feedback analysis needs separate, correctly scoped comments.</p></div>}{chosen.counts.sales>0&&['G60','G68'].includes(chosen.model_code)&&<p className="small muted">Sales in the source workbook are a <strong>combined G60/G68 total</strong>. They are shown with that warning and are never assigned as an individual model volume.</p>}{chosen.model_code==='G68'&&chosen.market_code!=='CN'&&<p className="small muted">G68 is China-specific. This scope contains shared G60/G68 series totals only; it is not evidence that G68 was sold in {chosen.market}.</p>}{chosen.model_code==='F70'&&chosen.market_code!=='EU'&&<p className="small muted">This F70 scope contains only sales rows from the supplied workbook. The app has no F70 customer feedback or verified market-specific model announcement for {chosen.market}.</p>}</>}
 <div className="bmw-library-footer"><span><FileCheck2 size={15}/>{manifest.files.filter(file=>file.available).length}/{manifest.files.length} supplied source files available locally</span><span><Database size={15}/>{manifest.scopes.length} vehicle/market scopes represented</span><button onClick={()=>navigate('Settings')}>Review projects <ArrowRight size={13}/></button></div></>}
 </section>;
}
