import {useEffect,useRef,useState} from 'react';
import {ArrowRight,ExternalLink,Globe2,Loader2,ShieldCheck} from 'lucide-react';
import {z} from 'zod';
import {useApp} from '../context';
import type {Dataset,Project} from '../types';
import {uid} from '../lib/workspace';
import {Button} from './ui/button';
import {Panel} from './common';

const recordSchema=z.object({source_id:z.string().min(1),model_code:z.enum(['F70','G60','G68','G70']),requested_market:z.string(),source_market:z.string(),source_type:z.string(),source_url:z.string().url().refine(v=>new URL(v).protocol==='https:'),title:z.string(),published_at:z.string().nullable(),retrieved_at:z.string(),text_original:z.string().min(1),model_match:z.string(),model_match_quality:z.string()});
const resultSchema=z.object({model_code:z.enum(['F70','G60','G68','G70']),market:z.string(),source_url:z.string().url().refine(v=>new URL(v).protocol==='https:'),records:z.array(recordSchema).min(1),warning:z.string(),cached:z.boolean()});
type Result=z.infer<typeof resultSchema>;
const names:Record<string,string>={F70:'BMW 1 Series F70',G60:'BMW 5 Series G60',G68:'BMW 5 Series G68',G70:'BMW 7 Series G70'};

export default function ExternalCollector(){
 const {state,project,run,setProject,notify,services,busy}=useApp();
 const [code,setCode]=useState('F70'),[url,setUrl]=useState(''),[market,setMarket]=useState(project.market),[loading,setLoading]=useState(false),[result,setResult]=useState<Result|null>(null),[error,setError]=useState('');
 const pending=useRef<AbortController|null>(null);useEffect(()=>()=>pending.current?.abort(),[]);
 const collect=async()=>{
  if(pending.current)return;const controller=new AbortController();pending.current=controller;setLoading(true);setResult(null);setError('');
  try{const response=await fetch('/api/collect',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(50_000)]),body:JSON.stringify({model_code:code,market:market.trim(),url:url.trim()||null})});
   const raw=await response.json().catch(()=>{throw new Error('The source service returned an unreadable response. Restart the app and try again.');});
   if(!response.ok)throw new Error(typeof raw?.error==='string'?raw.error:'The source could not be collected.');
   const parsed=resultSchema.safeParse(raw);if(!parsed.success)throw new Error('The source response is incomplete. Nothing was imported.');
   const data=parsed.data;if(data.model_code!==code||data.market!==market.trim()||data.records.some(r=>r.model_code!==code||r.requested_market!==data.market)||new Set(data.records.map(r=>r.source_id)).size!==data.records.length)throw new Error('The source response does not match the selected vehicle and market. Nothing was imported.');
   if(!controller.signal.aborted)setResult(data);
  }catch(e){if(!controller.signal.aborted)setError((e as Error).name==='TimeoutError'?'The source took too long. Try again or choose another page.':(e as Error).message);}
  finally{if(pending.current===controller){pending.current=null;setLoading(false);}}
 };
 const importRecords=async()=>{if(!result||busy)return;let target:Project|undefined=state.projects.find(p=>p.derivative===names[result.model_code]&&p.market===result.market);if(!target){target={id:uid('PROJECT'),name:'External product context',derivative:names[result.model_code],market:result.market,horizon:'2026–2028'};if(!await run({type:'project',project:target}))return;}
 const existing=new Set(state.datasets.flatMap(d=>d.records.map(r=>r.id)));const fresh=result.records.filter(r=>!existing.has(r.source_id));if(!fresh.length){notify('These source records are already in the workspace.');setProject(target.id);return;}
 const datasetId=uid('EXT'),now=new Date().toISOString();const dataset:Dataset={id:datasetId,projectId:target.id,name:`External ${result.model_code} context · ${new URL(result.source_url).hostname}`,type:'External research',synthetic:false,status:'Ready',createdAt:now,errors:[],columns:['source_type','model_code','source_market','published_at','source_url'],records:fresh.map((r,i)=>({id:r.source_id,datasetId,content:r.text_original,row:i+1,fields:{source_type:r.source_type,model_code:r.model_code,requested_market:r.requested_market,source_market:r.source_market,published_at:r.published_at,retrieved_at:r.retrieved_at,url:r.source_url,title:r.title,model_match:r.model_match,model_match_quality:r.model_match_quality},category:r.source_type}))};
 if(await run({type:'import',dataset})){setProject(target.id);setResult(null);notify(`${fresh.length} external source record(s) imported for review.`);}
 };
 return <Panel title="Collect a public source" subtitle="Official BMW context or a public review page"><div className="collector-grid"><label className="field"><span>Vehicle code</span><select disabled={loading} aria-label="Collector vehicle code" value={code} onChange={e=>{setCode(e.target.value);setResult(null);}}>{Object.entries(names).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label><label className="field"><span>Market to review</span><input disabled={loading} aria-label="Collector market" value={market} onChange={e=>{setMarket(e.target.value);setResult(null);setError('');}} maxLength={80}/></label><label className="field collector-url"><span>Public review URL (optional)</span><input disabled={loading} aria-label="Public review URL" type="url" placeholder="Leave blank for BMW PressClub source" value={url} onChange={e=>{setUrl(e.target.value);setResult(null);}}/></label></div><div className="collector-actions"><Button variant="outline" onClick={()=>void collect()} disabled={loading||busy||!market.trim()||services?.collector===false}>{loading?<Loader2 size={15} className="spin"/>:<Globe2 size={15}/>} {loading?'Checking source…':'Fetch and preview source'}</Button>{loading&&<Button variant="outline" onClick={()=>{pending.current?.abort();setError('Collection stopped. No records were imported.');}}>Stop collection</Button>}<span>HTTPS pages only · robots policy checked · cached for 24 hours</span></div>
 {services?.collector===false&&<p className="notice notice-amber">The source collector is unavailable. Check service status in Settings.</p>}
 {error&&<div className="notice notice-amber" role="alert"><p>{error}</p></div>}
 {result&&<div className="collector-results"><div className="notice notice-blue"><ShieldCheck size={17}/><p>{result.warning} {result.cached?'Loaded from the local 24-hour cache.':''}</p></div><a href={result.source_url} target="_blank" rel="noreferrer">Open original page <ExternalLink size={13}/></a>{result.records.map(r=><div className="collector-record" key={r.source_id}><strong>{r.title}</strong><span>{r.source_type.replaceAll('_',' ')} · {r.model_code} · {r.published_at||'Publication date unknown'} · {r.model_match_quality==='exact_code'?'Exact model code matched':'Model name match; verify variant'}</span><p>{r.text_original.slice(0,500)}{r.text_original.length>500?'…':''}</p></div>)}<Button disabled={busy} onClick={()=>void importRecords()}>Import {result.records.length} external record(s)<ArrowRight size={14}/></Button></div>}
 <p className="small muted">Imported pages remain separate from customer feedback and are never counted as customer complaints. Collection can fail when a site blocks automated access.</p></Panel>;
}
