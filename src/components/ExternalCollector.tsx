import {useMemo,useState} from 'react';
import {ArrowRight,ExternalLink,Globe2,Loader2,ShieldCheck} from 'lucide-react';
import {useApp} from '../context';
import type {Dataset,Project} from '../types';
import {uid} from '../lib/workspace';
import {Button} from './ui/button';
import {Panel} from './common';
import {analysisMarkets,pressPages,researchLibraries,type AnalysisMarket} from '../data/publicSources';

type Collected={source_id:string;model_code:string;requested_market:string;source_market:string;source_type:string;source_url:string;title:string;published_at:string|null;retrieved_at:string;text_original:string;model_match:string;model_match_quality:string;components?:string;query_url?:string;nhtsa_product_model?:string};
type Result={model_code:string;market:string;source_url:string;records:Collected[];warning:string;cached:boolean};
const names:Record<string,string>={F70:'BMW 1 Series F70',G60:'BMW 5 Series G60',G68:'BMW 5 Series G68',G70:'BMW 7 Series G70'};
const nhtsaModels:Record<string,string[]>={'G60:2024':['530I','540I','I5'],'G60:2025':['I5'],'G70:2024':['I7 SEDAN'],'G70:2025':['I7']};

export default function ExternalCollector(){
 const {state,project,run,setProject,notify}=useApp();
 const [code,setCode]=useState(()=>Object.keys(names).find(value=>project.derivative.includes(value))??'F70');
 const [market,setMarket]=useState<AnalysisMarket>(()=>analysisMarkets.includes(project.market as AnalysisMarket)?project.market as AnalysisMarket:'Europe');
 const [source,setSource]=useState<'bmw'|'nhtsa'|'custom'>('bmw');
 const [url,setUrl]=useState(''),[year,setYear]=useState(2025),[nhtsaModel,setNhtsaModel]=useState('I5');
 const [loading,setLoading]=useState(false),[result,setResult]=useState<Result|null>(null);
 const pressUrl=pressPages[`${code}:${market}`];
 const modelChoices=nhtsaModels[`${code}:${year}`]??[];
 const canNhtsa=market==='United States'&&modelChoices.length>0;
 const activeSource=source==='bmw'&&!pressUrl?'custom':source==='nhtsa'&&!canNhtsa?'custom':source;
 const officialLinks=useMemo(()=>researchLibraries.filter(item=>item.market===market&&item.model===code),[code,market]);
 const collect=async()=>{
  setLoading(true);setResult(null);
  try{
   const response=await fetch('/api/collect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model_code:code,market,source:activeSource==='nhtsa'?'nhtsa':'bmw',url:activeSource==='custom'?url.trim():null,model_year:year,nhtsa_model:modelChoices.includes(nhtsaModel)?nhtsaModel:modelChoices[0]})});
   const data=await response.json();if(!response.ok)throw new Error(data.error??'The source could not be collected.');setResult(data as Result);
  }catch(e){notify((e as Error).message,true);}finally{setLoading(false);}
 };
 const importRecords=async()=>{
  if(!result||!result.records.length)return;
  let target:Project|undefined=state.projects.find(p=>p.derivative===names[result.model_code]&&p.market===result.market&&['BMW supplied-source workspace','External product context'].includes(p.name));
  if(!target){target={id:uid('PROJECT'),name:'External product context',derivative:names[result.model_code],market:result.market,horizon:'2029–2031'};if(!await run({type:'project',project:target}))return;}
  const existing=new Set(state.datasets.flatMap(d=>d.records.map(r=>r.id)));
  const fresh=result.records.filter(r=>!existing.has(r.source_id));
  if(!fresh.length){notify('These source records are already in the workspace.');setProject(target.id);return;}
  const datasetId=uid('EXT'),now=new Date().toISOString();
  const dataset:Dataset={id:datasetId,projectId:target.id,name:`External ${result.model_code} context · ${new URL(result.source_url).hostname}`,type:'External research',synthetic:false,status:'Ready',createdAt:now,errors:[],columns:['source_type','model_code','source_market','published_at','source_url','model_match_quality','nhtsa_product_model'],records:fresh.map((r,i)=>({id:r.source_id,datasetId,content:r.text_original,row:i+1,fields:{source_type:r.source_type,model_code:r.model_code,requested_market:r.requested_market,source_market:r.source_market,published_at:r.published_at,retrieved_at:r.retrieved_at,url:r.source_url,title:r.title,model_match:r.model_match,model_match_quality:r.model_match_quality,components:r.components,query_url:r.query_url,nhtsa_product_model:r.nhtsa_product_model},category:r.source_type}))};
  if(await run({type:'import',dataset})){setProject(target.id);setResult(null);notify(`${fresh.length} external source record(s) imported for review.`);}
 };
 return <Panel title="Public evidence finder" subtitle="Official sources matched to the challenge vehicles and markets">
  <div className="collector-grid">
   <label className="field"><span>Vehicle</span><select aria-label="Collector vehicle code" value={code} onChange={e=>{setCode(e.target.value);setResult(null);}}>{Object.entries(names).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
   <label className="field"><span>Market</span><select aria-label="Collector market" value={market} onChange={e=>{setMarket(e.target.value as AnalysisMarket);setResult(null);}}>{analysisMarkets.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
   <label className="field"><span>Source</span><select aria-label="Public source" value={activeSource} onChange={e=>{setSource(e.target.value as typeof source);setResult(null);}}>{pressUrl&&<option value="bmw">BMW PressClub official page</option>}{canNhtsa&&<option value="nhtsa">NHTSA owner complaints API</option>}<option value="custom">Other public HTTPS page</option></select></label>
   {activeSource==='nhtsa'&&<><label className="field"><span>US model name</span><select aria-label="NHTSA model" value={modelChoices.includes(nhtsaModel)?nhtsaModel:modelChoices[0]} onChange={e=>setNhtsaModel(e.target.value)}>{modelChoices.map(value=><option key={value} value={value}>{value}</option>)}</select></label><label className="field"><span>Model year</span><select aria-label="NHTSA model year" value={year} onChange={e=>setYear(Number(e.target.value))}>{[2024,2025].map(value=><option key={value} value={value}>{value}</option>)}</select></label></>}
   {activeSource==='custom'&&<label className="field collector-url"><span>Public page URL</span><input aria-label="Public review URL" type="url" placeholder="https://…" value={url} onChange={e=>{setUrl(e.target.value);setResult(null);}}/></label>}
  </div>
  {pressUrl&&activeSource==='bmw'&&<p className="small muted">Selected page: <a href={pressUrl} target="_blank" rel="noreferrer">BMW PressClub <ExternalLink size={12}/></a>. This is manufacturer context, not a customer review.</p>}
  {activeSource==='nhtsa'&&<p className="small muted">NHTSA uses US sales model names, not BMW chassis codes. Review the match before using a report as G60 or G70 evidence. No VIN is imported.</p>}
  <div className="collector-actions"><Button variant="outline" onClick={()=>void collect()} disabled={loading||(activeSource==='custom'&&!url.trim())}>{loading?<Loader2 size={15} className="spin"/>:<Globe2 size={15}/>} {loading?'Checking source…':'Fetch and preview source'}</Button><span>Public HTTPS · one request per host per second · 24-hour cache</span></div>
  {officialLinks.length>0&&<div className="collector-results"><strong>More official databases to inspect</strong>{officialLinks.map(item=><p className="small" key={item.url}><a href={item.url} target="_blank" rel="noreferrer">{item.name} <ExternalLink size={12}/></a> — {item.note}</p>)}</div>}
  {result&&<div className="collector-results"><div className="notice notice-blue"><ShieldCheck size={17}/><p>{result.warning} {result.cached?'Loaded from the local 24-hour cache.':''}</p></div><a href={result.source_url} target="_blank" rel="noreferrer">Open source or search query <ExternalLink size={13}/></a>{!result.records.length&&<p>No matching records were returned for this exact selection.</p>}{result.records.map(r=><div className="collector-record" key={r.source_id}><strong>{r.title}</strong><span>{r.source_type.replaceAll('_',' ')} · {r.source_market} · {r.published_at||'Publication date unknown'} · {r.model_match_quality.replaceAll('_',' ')}</span><p>{r.text_original.slice(0,500)}{r.text_original.length>500?'…':''}</p><a href={r.source_url} target="_blank" rel="noreferrer">Exact record <ExternalLink size={12}/></a></div>)}{result.records.length>0&&<Button onClick={()=>void importRecords()}>Import {result.records.length} external record(s)<ArrowRight size={14}/></Button>}</div>}
  <p className="small muted">External research is kept separate from supplied BMW customer feedback. Source URLs and retrieval dates stay attached to imported records. Some public databases require manual review or may block automated access.</p>
 </Panel>;
}
