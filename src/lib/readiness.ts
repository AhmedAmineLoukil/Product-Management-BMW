import type {Dataset,Project,Requirement,Workspace} from '../types';
import {dimensions} from '../types';
import {evidenceLevel,scoreRequirement,validateModel} from './scoring';

export type ReadinessTone='green'|'amber'|'blue'|'red';
export interface ReadinessCriterion {
 id:string;
 label:string;
 score:number;
 tone:ReadinessTone;
 evidence:string[];
 gaps:string[];
 next:string;
}
export interface ReadinessReport {
 overall:number;
 criteria:ReadinessCriterion[];
 strengths:string[];
 nextActions:string[];
 metrics:{
  requirements:number;
  findings:number;
  datasets:number;
  records:number;
  traceableRequirements:number;
  scoredRequirements:number;
  reviewedRequirements:number;
  pmEvents:number;
  auditEvents:number;
 };
}

const reviewedStatuses=new Set(['Approved','Rejected','Deferred','More evidence requested','Challenged']);
const requiredDataTypes:Dataset['type'][]=['Customer verbatims','Equipment list','Sales volumes','Customer study'];
const pct=(part:number,total:number)=>total?part/total:0;
const clamp=(value:number)=>Math.max(0,Math.min(100,Math.round(value)));
const toneFor=(score:number):ReadinessTone=>score>=80?'green':score>=60?'blue':score>=40?'amber':'red';
const present=(condition:boolean,text:string)=>condition?[text]:[];

function criterion(id:string,label:string,score:number,evidence:string[],gaps:string[],next:string):ReadinessCriterion {
 const value=clamp(score);
 return {id,label,score:value,tone:toneFor(value),evidence,gaps,next};
}

function hasFullScore(requirement:Requirement):boolean {
 return dimensions.every(d=>typeof requirement.scores[d]==='number');
}

export function computeReadiness(state:Workspace,project:Project):ReadinessReport {
 const datasets=state.datasets.filter(d=>d.projectId===project.id);
 const findings=state.findings.filter(f=>f.projectId===project.id&&f.status!=='Excluded');
 const requirements=state.requirements.filter(r=>r.projectId===project.id);
 const audit=state.audit.filter(a=>a.projectId===project.id);
 const runs=state.runs.filter(r=>r.projectId===project.id);
 const records=datasets.reduce((sum,d)=>sum+d.records.length,0);
 const sourceIds=new Set(datasets.flatMap(d=>d.records.map(r=>r.id)));
 const findingById=new Map(findings.map(f=>[f.id,f]));
 const traceableRequirements=requirements.filter(r=>r.findings.some(id=>{
  const finding=findingById.get(id);
  return finding&&finding.sources.some(sourceId=>sourceIds.has(sourceId));
 }));
 const scoredRequirements=requirements.filter(r=>scoreRequirement(r.scores,state.model)!==null);
 const unknownScoreRequirements=requirements.filter(r=>!hasFullScore(r));
 const reviewedRequirements=requirements.filter(r=>reviewedStatuses.has(r.status));
 const pmEvents=audit.filter(a=>a.actor==='PM');
 const changedByPm=pmEvents.some(a=>/approved|rejected|challenged|edited|evidence|deferred/i.test(a.action));
 const readyTypes=new Set(datasets.filter(d=>d.status==='Ready').map(d=>d.type));
 const missingTypes=requiredDataTypes.filter(type=>!readyTypes.has(type));
 const hasExternalResearch=datasets.some(d=>d.type==='External research');
 const hasAiRun=runs.some(r=>r.mode==='AI');
 const hasDemoRun=runs.some(r=>r.mode==='Demo');
 const modelValid=!validateModel(state.model);
 const rationaleCount=requirements.filter(r=>r.rationale&&r.assumptions&&r.uncertainty).length;
 const strongEvidence=requirements.filter(r=>evidenceLevel(r,findings)==='Strong').length;

 const criteria=[
  criterion(
   'decision-scoring',
   'Decision and scoring logic',
   (modelValid?20:0)+pct(scoredRequirements.length,requirements.length)*30+pct(rationaleCount,requirements.length)*25+(unknownScoreRequirements.length?10:0)+(requirements.length?15:0),
   [
    ...present(modelValid,'Weighted scoring model is valid and totals 100%.'),
    ...present(scoredRequirements.length>0,`${scoredRequirements.length} of ${requirements.length} requirements have calculated priorities.`),
    ...present(unknownScoreRequirements.length>0,`${unknownScoreRequirements.length} requirement(s) explicitly surface unknown PM ratings instead of hiding them.`)
   ],
   [
    ...present(!modelValid,'Scoring weights or thresholds need correction.'),
    ...present(scoredRequirements.length<requirements.length,`${requirements.length-scoredRequirements.length} requirement(s) still need complete PM scoring.`),
    ...present(rationaleCount<requirements.length,'Some requirements need stronger rationale, assumptions or uncertainty text.')
   ],
   'Open Prioritization and complete missing score dimensions before final approval.'
  ),
  criterion(
   'workflow-human',
   'Workflow and human decision-making',
   (requirements.length?15:0)+(requirements.some(r=>['Awaiting review','Proposed','Challenged'].includes(r.status))?15:0)+pct(reviewedRequirements.length,requirements.length)*25+(pmEvents.length?30:0)+(changedByPm?15:0),
   [
    ...present(pmEvents.length>0,`${pmEvents.length} PM audit event(s) prove human review is in the loop.`),
    ...present(reviewedRequirements.length>0,`${reviewedRequirements.length} requirement(s) already have a human decision or evidence request.`),
    ...present(requirements.some(r=>['Awaiting review','Proposed','Challenged'].includes(r.status)),'A visible review queue remains for PM decisions.')
   ],
   [
    ...present(!pmEvents.length,'Record at least one PM approve, reject, edit, challenge or evidence request action.'),
    ...present(!requirements.some(r=>['Awaiting review','Proposed','Challenged'].includes(r.status)),'Keep proposed requirements visible as mandatory review gates.')
   ],
   'In the demo, approve, reject, edit or challenge one requirement and explain why.'
  ),
  criterion(
   'traceability',
   'Traceability and auditability',
   pct(traceableRequirements.length,requirements.length)*45+(audit.length?25:0)+(requirements.some(r=>r.history.length||r.version>1)?15:0)+(findings.some(f=>f.sources.length)?10:0)+(records?5:0),
   [
    ...present(traceableRequirements.length>0,`${traceableRequirements.length} of ${requirements.length} requirements link back to findings with source records.`),
    ...present(audit.length>0,`${audit.length} chronological audit event(s) are available.`),
    ...present(requirements.some(r=>r.history.length||r.version>1),'Version history captures edits, score changes and status changes.')
   ],
   [
    ...present(traceableRequirements.length<requirements.length,`${requirements.length-traceableRequirements.length} requirement(s) need stronger source linkage.`),
    ...present(!audit.length,'No audit events are available for this project.')
   ],
   'When presenting, open one requirement and follow it from sources to finding, score, PM action and audit event.'
  ),
  criterion(
   'solution-quality',
   'Solution quality, usability and feasibility',
   pct(requiredDataTypes.length-missingTypes.length,requiredDataTypes.length)*30+(records?15:0)+(findings.length?15:0)+(requirements.length?15:0)+(runs.length?15:0)+(strongEvidence?10:0),
   [
    ...present(missingTypes.length<requiredDataTypes.length,`${requiredDataTypes.length-missingTypes.length} of ${requiredDataTypes.length} provided data categories are represented.`),
    ...present(runs.length>0,`${runs.length} analysis run(s) preserve selected inputs and outputs.`),
    ...present(strongEvidence>0,`${strongEvidence} requirement(s) have strong evidence.`)
   ],
   [
    ...present(missingTypes.length>0,`Missing provided data category: ${missingTypes.join(', ')}.`),
    ...present(!runs.length,'Run an analysis so outputs are connected to selected datasets.')
   ],
   'Use Data Sources to show ingestion, then Review Queue to show product-manager usability.'
  ),
  criterion(
   'innovation-scale',
   'Innovation, scalability and business impact',
   (state.projects.length>1?20:0)+(hasExternalResearch?15:0)+(hasAiRun?20:hasDemoRun?10:0)+(datasets.length>=4?15:0)+(audit.length>5?15:0)+(requirements.length>=5?15:0),
   [
    ...present(state.projects.length>1,`${state.projects.length} projects show the structure can be reused across vehicles and markets.`),
    ...present(hasAiRun,'A server-side AI run has been recorded with usage metrics.'),
    ...present(hasDemoRun&&!hasAiRun,'Deterministic demo analysis is available; live AI can be enabled with OPENAI_API_KEY.'),
    ...present(hasExternalResearch,'External research is kept separate from BMW/customer inputs.')
   ],
   [
    ...present(!hasExternalResearch,'Add at least one external research source to demonstrate web-enriched context.'),
    ...present(!hasAiRun,'Run a small live AI batch when ready to demonstrate credit-backed AI extraction and token metrics.')
   ],
   'Scale the demo by switching project/market and running a capped live AI batch with usage metrics.'
  )
 ];
 const nextActions=criteria.flatMap(c=>c.gaps.length?[c.next]:[]).slice(0,5);
 const strengths=criteria.flatMap(c=>c.evidence.slice(0,1)).slice(0,5);
 return {
  overall:clamp(criteria.reduce((sum,c)=>sum+c.score,0)/criteria.length),
  criteria,
  strengths,
  nextActions,
  metrics:{
   requirements:requirements.length,
   findings:findings.length,
   datasets:datasets.length,
   records,
   traceableRequirements:traceableRequirements.length,
   scoredRequirements:scoredRequirements.length,
   reviewedRequirements:reviewedRequirements.length,
   pmEvents:pmEvents.length,
   auditEvents:audit.length
  }
 };
}
