import type {Workspace,Project,SourceRecord} from '../types';
import {priorityFor,scoreRequirement} from './scoring';
import {isInternalDataset} from './internal-data';

export interface AssistantCitation {source_id:string;quote:string}
export interface AssistantAnswer {answer:string;citations:AssistantCitation[];uncertainty:string;metrics?:{input_tokens:number;output_tokens:number;model:string}}
export interface AssistantContext {
 question:string;
 project:{id:string;derivative:string;market:string;horizon:string};
 requirements:{id:string;title:string;statement:string;status:string;category:string;score:number|null;priority:string|null;scores:unknown;uncertainty:string;rationale:string;finding_ids:string[]}[];
 findings:{id:string;title:string;description:string;status:string;source_ids:string[];contradictions:string[]}[];
 sources:{id:string;text:string;source_type:string;synthetic:boolean;url:string|null;dataset:string}[];
 scoring_model:Workspace['model'];
}
const words=(text:string)=>[...new Set((text.toLowerCase().match(/[\p{L}\p{N}-]+/gu)??[]).filter(w=>w.length>2))];
const relevant=(query:string,text:string)=>{const hay=text.toLowerCase();return words(query).reduce((score,term)=>score+(hay.includes(term)?1:0),0)+(hay.includes(query.toLowerCase())?5:0);};

export function buildAssistantContext(state:Workspace,project:Project,question:string):AssistantContext {
 const reqs=state.requirements.filter(r=>r.projectId===project.id);
 const asksTop=/\b(top|highest)\b/i.test(question);
 const asksUnknown=/\b(unknown|unscored|missing)\b|need.*judgment/i.test(question);
 const ranked=reqs.map(r=>({r,score:relevant(question,`${r.id} ${r.title} ${r.statement} ${r.category}`)})).sort((a,b)=>
  asksTop?(scoreRequirement(b.r.scores,state.model)??-1)-(scoreRequirement(a.r.scores,state.model)??-1):
  asksUnknown?Number(scoreRequirement(a.r.scores,state.model)!==null)-Number(scoreRequirement(b.r.scores,state.model)!==null):
  b.score-a.score);
 const selectedReqs=ranked.slice(0,3).map(x=>x.r);
 const linkedIds=new Set(selectedReqs.flatMap(r=>r.findings));
 const findings=state.findings.filter(f=>f.projectId===project.id).map(f=>({f,score:relevant(question,`${f.id} ${f.title} ${f.description}`)+(linkedIds.has(f.id)?4:0)})).sort((a,b)=>b.score-a.score).slice(0,6).map(x=>x.f);
 const sourceIds=new Set(findings.flatMap(f=>[...f.sources,...f.contradictions]));
 const datasets=state.datasets.filter(d=>d.projectId===project.id&&isInternalDataset(d));
 const records=datasets.flatMap(d=>d.records.map(r=>({r,d})));
 const scored=records.map(x=>({...x,score:relevant(question,`${x.r.id} ${x.r.content} ${x.d.type} ${x.d.name} ${x.r.category??''}`)+(sourceIds.has(x.r.id)?5:0)})).sort((a,b)=>b.score-a.score);
 // General questions still need a few inspectable sources, including before analysis exists.
 const chosen=(scored.some(x=>x.score>0)?scored.filter(x=>x.score>0):scored).slice(0,8);
 return {
  question:question.trim(),project:{id:project.id,derivative:project.derivative,market:project.market,horizon:project.horizon},
  requirements:selectedReqs.map(r=>({id:r.id,title:r.title,statement:r.statement,status:r.status,category:r.category,
   score:scoreRequirement(r.scores,state.model),priority:priorityFor(scoreRequirement(r.scores,state.model),state.model),
   scores:r.scores,uncertainty:r.uncertainty,rationale:r.rationale,finding_ids:r.findings})),
  findings:findings.map(f=>({id:f.id,title:f.title,description:f.description,status:f.status,source_ids:f.sources,contradictions:f.contradictions})),
  sources:chosen.map(({r,d})=>({id:r.id,text:r.content.slice(0,12_000),source_type:d.type,synthetic:d.synthetic,url:typeof r.fields.url==='string'?r.fields.url:null,dataset:d.name})),
  scoring_model:state.model,
 };
}

export function offlineAssistantAnswer(context:AssistantContext):AssistantAnswer {
 const r=context.requirements[0];
 const referenceQuestion=/\b(sales|study|equipment|catalog|market data)\b/i.test(context.question);
 if(referenceQuestion){
  const references=context.sources.filter(s=>s.source_type!=='Customer verbatims').slice(0,3);
  if(references.length)return {answer:`I found ${references.length} source record(s) for ${context.project.derivative} in ${context.project.market}. Open the citations to inspect the exact measures and caveats before using them in a PM decision.`,citations:references.map(s=>({source_id:s.id,quote:s.text.slice(0,180)})),uncertainty:'Study scales, shared model sales, publication dates, and market applicability must be checked in the original records.'};
 }
 if(!r){
  const sources=context.sources.slice(0,3);
  if(sources.length)return {answer:`This project has ${sources.length} selected source record(s) to inspect, but no drafted requirements yet. The records below are context, not an approved customer requirement. Run feedback analysis to draft findings and requirements.`,citations:sources.map(s=>({source_id:s.id,quote:s.text.slice(0,180)})).filter(c=>c.quote),uncertainty:'No project requirement has been reviewed or approved.'};
  return {answer:`There are no requirements for ${context.project.derivative} in ${context.project.market} yet. Import feedback and run an analysis first.`,citations:[],uncertainty:'No project evidence is available.'};
 }
 const status=r.score===null?'Its priority is unscored because some PM ratings are still unknown.':`Its current score is ${r.score} (${r.priority}).`;
 const linked=new Set(context.findings.filter(f=>r.finding_ids.includes(f.id)).flatMap(f=>[...f.source_ids,...f.contradictions]));
 const citations=context.sources.filter(s=>linked.has(s.id)).slice(0,3).map(s=>({source_id:s.id,quote:s.text.slice(0,180)})).filter(c=>c.quote);
 return {answer:`${r.id}: ${r.title}. ${r.statement} Status: ${r.status}. ${status} ${citations.length?'The linked records below are the available evidence.':'I found no matching source record for this question.'}`,
  citations,uncertainty:r.uncertainty||'Check how representative these source records are before making a decision.'};
}
export function lookupAssistantSource(state:Workspace,projectId:string,id:string):SourceRecord|undefined {
 return state.datasets.filter(d=>d.projectId===projectId&&isInternalDataset(d)).flatMap(d=>d.records).find(r=>r.id===id);
}
