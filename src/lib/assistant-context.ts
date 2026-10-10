import type {Workspace,Project,SourceRecord} from '../types';
import {priorityFor,scoreRequirement} from './scoring';
import {computeReadiness} from './readiness';

export interface AssistantCitation {source_id:string;quote:string}
export interface AssistantAnswer {
 answer:string;
 citations:AssistantCitation[];
 uncertainty:string;
 next_actions?:string[];
 risk_flags?:string[];
 decision_gate?:string;
 metrics?:{input_tokens:number;output_tokens:number;model:string};
}
export interface AssistantContext {
 question:string;
 project:{id:string;derivative:string;market:string;horizon:string};
 requirements:{id:string;title:string;statement:string;status:string;category:string;score:number|null;priority:string|null;scores:unknown;uncertainty:string;rationale:string;finding_ids:string[]}[];
 findings:{id:string;title:string;description:string;status:string;source_ids:string[];contradictions:string[]}[];
 sources:{id:string;text:string;source_type:string;synthetic:boolean;url:string|null;dataset:string}[];
 scoring_model:Workspace['model'];
 readiness:{
  overall:number;
  criteria:{id:string;label:string;score:number;gaps:string[];evidence:string[];next:string}[];
  strengths:string[];
  next_actions:string[];
  metrics:ReturnType<typeof computeReadiness>['metrics'];
 };
 audit_summary:{events:number;pm_events:number;ai_events:number;latest:string[]};
}
const words=(text:string)=>[...new Set((text.toLowerCase().match(/[\p{L}\p{N}-]+/gu)??[]).filter(w=>w.length>2))];
const relevant=(query:string,text:string)=>{const hay=text.toLowerCase();return words(query).reduce((score,term)=>score+(hay.includes(term)?1:0),0)+(hay.includes(query.toLowerCase())?5:0);};

export function buildAssistantContext(state:Workspace,project:Project,question:string):AssistantContext {
 const reqs=state.requirements.filter(r=>r.projectId===project.id);
 const readiness=computeReadiness(state,project);
 const audit=state.audit.filter(a=>a.projectId===project.id).sort((a,b)=>b.at.localeCompare(a.at));
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
 const datasets=state.datasets.filter(d=>d.projectId===project.id);
 const records=datasets.flatMap(d=>d.records.map(r=>({r,d})));
 const chosen=records.map(x=>({...x,score:relevant(question,`${x.r.id} ${x.r.content}`)+(sourceIds.has(x.r.id)?5:0)})).sort((a,b)=>b.score-a.score).filter(x=>x.score>0).slice(0,8);
 return {
  question:question.trim(),project:{id:project.id,derivative:project.derivative,market:project.market,horizon:project.horizon},
  requirements:selectedReqs.map(r=>({id:r.id,title:r.title,statement:r.statement,status:r.status,category:r.category,
   score:scoreRequirement(r.scores,state.model),priority:priorityFor(scoreRequirement(r.scores,state.model),state.model),
   scores:r.scores,uncertainty:r.uncertainty,rationale:r.rationale,finding_ids:r.findings})),
  findings:findings.map(f=>({id:f.id,title:f.title,description:f.description,status:f.status,source_ids:f.sources,contradictions:f.contradictions})),
  sources:chosen.map(({r,d})=>({id:r.id,text:r.content.slice(0,12_000),source_type:d.type,synthetic:d.synthetic,url:typeof r.fields.url==='string'?r.fields.url:null,dataset:d.name})),
  scoring_model:state.model,
  readiness:{overall:readiness.overall,
   criteria:readiness.criteria.map(c=>({id:c.id,label:c.label,score:c.score,gaps:c.gaps.slice(0,3),evidence:c.evidence.slice(0,3),next:c.next})),
   strengths:readiness.strengths,next_actions:readiness.nextActions,metrics:readiness.metrics},
  audit_summary:{events:audit.length,pm_events:audit.filter(a=>a.actor==='PM').length,ai_events:audit.filter(a=>a.actor==='AI'||a.action.toLowerCase().includes('analysis')).length,latest:audit.slice(0,5).map(a=>`${a.action}: ${a.entityId} by ${a.actorId}`)},
 };
}

export function offlineAssistantAnswer(context:AssistantContext):AssistantAnswer {
 const readinessQuestion=/\b(readiness|criteria|scorecard|judge|judges|evaluation|deliverable|demo)\b/i.test(context.question);
 if(readinessQuestion){
  const weakest=[...context.readiness.criteria].sort((a,b)=>a.score-b.score)[0];
  const strongest=[...context.readiness.criteria].sort((a,b)=>b.score-a.score)[0];
  return {
   answer:`Demo readiness is ${context.readiness.overall}%. Strongest area: ${strongest?.label ?? 'not enough data'} (${strongest?.score ?? 0}%). Weakest area: ${weakest?.label ?? 'not enough data'} (${weakest?.score ?? 0}%). The best demo path is ingestion, grounded findings, prioritized requirements, PM decision, then audit trail.`,
   citations:[],
   uncertainty:'This is a product-readiness heuristic over the current workspace, not an official jury score.',
   next_actions:context.readiness.next_actions.slice(0,3),
   risk_flags:weakest?.gaps.slice(0,3)??[],
   decision_gate:'Use PM approval, rejection, edit or challenge as the mandatory human gate before treating any requirement as accepted.'
  };
 }
 const gapQuestion=/\b(gap|weak|missing|risk|uncertain|uncertainty)\b/i.test(context.question);
 if(gapQuestion){
  const weak=context.requirements.find(r=>r.score===null||/evidence|uncertain|unknown|validate/i.test(`${r.status} ${r.uncertainty}`));
  const risks=context.readiness.criteria.flatMap(c=>c.gaps).slice(0,4);
  return {
   answer:weak?`${weak.id}: ${weak.title} is the clearest evidence or PM-judgment gap in the selected context. Status: ${weak.status}. ${weak.score===null?'At least one score dimension is still unknown.':'Its score is calculated, but the uncertainty should be resolved before approval.'}`:'The selected context does not contain a requirement-specific gap, so I checked the workflow readiness gaps instead.',
   citations:[],
   uncertainty:weak?.uncertainty||'No exact source quote was selected for this workflow-level gap answer.',
   next_actions:context.readiness.next_actions.slice(0,3),
   risk_flags:risks,
   decision_gate:'Request more evidence or challenge the rationale before approving weakly supported requirements.'
  };
 }
 const r=context.requirements[0];
 if(!r)return {answer:`There are no requirements for ${context.project.derivative} in ${context.project.market} yet. Import feedback and run an analysis first.`,citations:[],uncertainty:'No project evidence is available.',next_actions:['Upload customer feedback or select demo data.','Run analysis to generate findings and requirement proposals.'],risk_flags:['No requirements exist for this project.']};
 const status=r.score===null?'Its priority is unscored because some PM ratings are still unknown.':`Its current score is ${r.score} (${r.priority}).`;
 const linked=new Set(context.findings.filter(f=>r.finding_ids.includes(f.id)).flatMap(f=>[...f.source_ids,...f.contradictions]));
 const citations=context.sources.filter(s=>linked.has(s.id)).slice(0,3).map(s=>({source_id:s.id,quote:s.text.slice(0,180)})).filter(c=>c.quote);
 return {answer:`${r.id}: ${r.title}. ${r.statement} Status: ${r.status}. ${status} ${citations.length?'The linked records below are the available evidence.':'I found no matching source record for this question.'}`,
  citations,uncertainty:r.uncertainty||'Check how representative these source records are before making a decision.',
  next_actions:r.score===null?['Complete the missing score dimensions in Prioritization.','Ask the PM to approve, reject, edit or request more evidence.']:['Review the linked source records before changing status.'],
  risk_flags:citations.length?[]:['No source record was selected for this answer.'],
  decision_gate:'The assistant can explain evidence, but only the PM should change requirement status.'};
}
export function lookupAssistantSource(state:Workspace,projectId:string,id:string):SourceRecord|undefined {
 return state.datasets.filter(d=>d.projectId===projectId).flatMap(d=>d.records).find(r=>r.id===id);
}
