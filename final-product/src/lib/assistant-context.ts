import {dimensionLabels,dimensions,type Workspace,type Project,type SourceRecord,type Scores} from '../types';
import {priorityFor,scoreRequirement} from './scoring';

export interface AssistantCitation {source_id:string;quote:string}
export interface AssistantAnswer {answer:string;citations:AssistantCitation[];uncertainty:string;metrics?:{input_tokens:number;output_tokens:number;model:string}}
type ContextRequirement={id:string;title:string;statement:string;status:string;category:string;score:number|null;priority:string|null;priority_override:string|null;scores:Scores;uncertainty:string;rationale:string;finding_ids:string[];support_source_count:number;missing_source_ids:string[];contradiction_source_ids:string[];challenged_finding_ids:string[];excluded_finding_ids:string[]};
export interface AssistantContext {
 question:string;
 conversation?:{role:'user'|'assistant';content:string}[];
 project:{id:string;derivative:string;market:string;horizon:string};
 summary:{requirements:number;findings:number;datasets:number;records:number;unscored:number;statuses:Record<string,number>};
 requirements:ContextRequirement[];
 findings:{id:string;title:string;description:string;status:string;strength:string;source_ids:string[];contradictions:string[]}[];
 sources:{id:string;text:string;source_type:string;synthetic:boolean;url:string|null;dataset:string}[];
 evidence_requests:{id:string;requirement_id:string;text:string;status:string}[];
 scoring_model:Workspace['model'];
}
type Intent='workflow'|'scoring'|'unknown'|'gap'|'status'|'source'|'finding'|'requirement';
const ignoredWords=new Set(['what','which','where','when','does','have','with','this','that','from','about','show','tell','please','give','need','still','the','and','for','are','can','you','how','why','any','there','sources','source','evidence','requirement','requirements','findings','finding','supports','support']);
const words=(text:string)=>[...new Set((text.toLowerCase().match(/[\p{L}\p{N}-]+/gu)??[]).filter(w=>w.length>2&&!ignoredWords.has(w)))];
const relevant=(query:string,text:string)=>{const hay=text.toLowerCase();return words(query).reduce((score,term)=>score+(hay.includes(term)?1:0),0);};
const requestedIds=(question:string)=>question.match(/\b(?:REQ|FND|VOC|EQ|SAL|STU|WEB|SRC|CUSTOMER)[-_][\p{L}\p{N}_-]+\b/giu)??[];
function intentFor(question:string):Intent {
 if(/\b(how|explain)\b.*\b(score|scoring|priority|weights?|rank)\b|\b(scoring model|score calculation|priority calculation)\b/i.test(question))return 'scoring';
 if(/\b(unknown|unscored|unrated|judg(?:e)?ment|missing ratings?|missing scores?)\b/i.test(question))return 'unknown';
 if(/\b(gaps?|contradictions?|conflicting|challenged|weak|missing evidence|missing sources?|more evidence)\b/i.test(question))return 'gap';
 if(/\b(status|approved|rejected|deferred|review queue|awaiting review|project summary|project overview)\b/i.test(question))return 'status';
 if(/\bFND[-_]/i.test(question))return 'finding';
 if(requestedIds(question).some(id=>!/^REQ[-_]/i.test(id))||/\b(source records?|data sources?|datasets?|verbatim|original record)\b/i.test(question))return 'source';
 if(/^(hi|hello|hey|help)[!.?\s]*$/i.test(question)||/\b(what can you|how (?:do|can) (?:i|we) (?:use|start|review|approve|reject|edit|challenge|configure|open|switch|cancel)|getting started|workflow|import|upload|export|download|restore|backup|reset|chatbot|assistant)\b/i.test(question)&&!requestedIds(question).length)return 'workflow';
 return 'requirement';
}
/** App instructions are approved local guidance, rather than model evidence questions. */
export const isWorkflowQuestion=(question:string)=>intentFor(question)==='workflow';
const gapWeight=(r:ContextRequirement)=>Number(!r.support_source_count)*10+r.missing_source_ids.length*5+r.challenged_finding_ids.length*3+r.contradiction_source_ids.length+Number(r.score===null)*4+Number(r.status==='More evidence requested')*5+Number((r.scores.evidence??0)<3)*3;
export function buildAssistantContext(state:Workspace,project:Project,question:string):AssistantContext {
 const intent=intentFor(question),ids=requestedIds(question).map(id=>id.toUpperCase());
 const reqs=state.requirements.filter(r=>r.projectId===project.id),projectFindings=state.findings.filter(f=>f.projectId===project.id);
 const datasets=state.datasets.filter(d=>d.projectId===project.id),records=datasets.flatMap(d=>d.records.map(r=>({r,d}))),recordIds=new Set(records.map(({r})=>r.id));
 const contextReqs=reqs.map((r):ContextRequirement=>{
  const linked=projectFindings.filter(f=>r.findings.includes(f.id)),active=linked.filter(f=>f.status!=='Excluded'),supporting=[...new Set(active.flatMap(f=>f.sources))];
  return {id:r.id,title:r.title,statement:r.statement,status:r.status,category:r.category,score:scoreRequirement(r.scores,state.model),priority:priorityFor(scoreRequirement(r.scores,state.model),state.model),priority_override:r.priorityOverride??null,scores:r.scores,uncertainty:r.uncertainty,rationale:r.rationale,finding_ids:r.findings,support_source_count:supporting.filter(id=>recordIds.has(id)).length,missing_source_ids:supporting.filter(id=>!recordIds.has(id)),contradiction_source_ids:[...new Set(active.flatMap(f=>f.contradictions))],challenged_finding_ids:linked.filter(f=>f.status==='Challenged').map(f=>f.id),excluded_finding_ids:linked.filter(f=>f.status==='Excluded').map(f=>f.id)};
 });
 const asksTop=/\b(top|highest|rank|priority|priorities)\b/i.test(question);
 const requirements=contextReqs.sort((a,b)=>{
  const exact=Number(ids.includes(b.id.toUpperCase()))-Number(ids.includes(a.id.toUpperCase()));if(exact)return exact;
  if(intent==='unknown')return Number(a.score!==null)-Number(b.score!==null);
  if(intent==='gap')return gapWeight(b)-gapWeight(a);
  if(intent==='status'){const matches=(status:string)=>question.toLowerCase().includes(status.toLowerCase());const status=Number(matches(b.status))-Number(matches(a.status));if(status)return status;}
  if(asksTop)return (b.score??-1)-(a.score??-1);
  return relevant(question,`${b.id} ${b.title} ${b.statement} ${b.category}`)-relevant(question,`${a.id} ${a.title} ${a.statement} ${a.category}`);
 }).slice(0,12);
 const linkedIds=new Set(requirements.flatMap(r=>r.finding_ids)),primaryIds=new Set(requirements.slice(0,3).flatMap(r=>r.finding_ids));
 const findings=projectFindings.map(f=>({f,score:relevant(question,`${f.id} ${f.title} ${f.description}`)+(linkedIds.has(f.id)?4:0)+(primaryIds.has(f.id)?20:0)+(ids.includes(f.id.toUpperCase())?100:0)})).sort((a,b)=>b.score-a.score).slice(0,12).map(x=>x.f);
 const sourceIds=new Set(findings.filter(f=>f.status!=='Excluded').flatMap(f=>[...f.sources,...f.contradictions])),primarySources=new Set(findings.filter(f=>primaryIds.has(f.id)&&f.status!=='Excluded'||ids.includes(f.id.toUpperCase())).flatMap(f=>[...f.sources,...f.contradictions]));
 const chosen=records.map(x=>({...x,score:relevant(question,`${x.r.id} ${x.r.content} ${x.d.name}`)+(sourceIds.has(x.r.id)?5:0)+(primarySources.has(x.r.id)?20:0)+(ids.includes(x.r.id.toUpperCase())?100:0)})).sort((a,b)=>b.score-a.score).filter(x=>x.score>0||intent==='source'&&words(question).length===0).slice(0,16);
 const statuses:Record<string,number>={};for(const r of reqs)statuses[r.status]=(statuses[r.status]??0)+1;
 return {question:question.trim(),project:{id:project.id,derivative:project.derivative,market:project.market,horizon:project.horizon},summary:{requirements:reqs.length,findings:projectFindings.length,datasets:datasets.length,records:records.length,unscored:reqs.filter(r=>scoreRequirement(r.scores,state.model)===null).length,statuses},requirements,
  findings:findings.map(f=>({id:f.id,title:f.title,description:f.description,status:f.status,strength:f.strength,source_ids:f.sources,contradictions:f.contradictions})),
  sources:chosen.map(({r,d})=>({id:r.id,text:r.content.slice(0,12_000),source_type:d.type,synthetic:d.synthetic,url:typeof r.fields.url==='string'?r.fields.url:null,dataset:d.name})),
  evidence_requests:state.requests.filter(r=>r.projectId===project.id).slice(0,30).map(r=>({id:r.id,requirement_id:r.requirementId,text:r.text,status:r.status})),scoring_model:state.model};
}
const quoted=(sources:AssistantContext['sources'],ids:Set<string>,max=3):AssistantCitation[]=>[...ids].flatMap(id=>{const s=sources.find(s=>s.id===id);return s?.text.trim()?[{source_id:s.id,quote:s.text.slice(0,240)}]:[];}).slice(0,max);
function requirementCitations(context:AssistantContext,r:ContextRequirement):AssistantCitation[]{
 const linked=context.findings.filter(f=>r.finding_ids.includes(f.id)&&f.status!=='Excluded');
 const support=quoted(context.sources,new Set(linked.flatMap(f=>f.source_ids)),2),opposition=quoted(context.sources,new Set(r.contradiction_source_ids.filter(id=>!support.some(c=>c.source_id===id))),1);
 return [...support,...opposition];
}
const uncertaintyFor=(context:AssistantContext,citations:AssistantCitation[])=>citations.some(c=>context.sources.find(s=>s.id===c.source_id)?.synthetic)?'The cited records are synthetic demonstration data. Validate these signals with representative customers before deciding.':'This guide reports stored records and PM assessments; it does not verify representativeness or make a product decision.';
export function offlineAssistantAnswer(context:AssistantContext):AssistantAnswer {
 const intent=intentFor(context.question),ids=requestedIds(context.question).map(id=>id.toUpperCase());
 const result=(answer:string,citations:AssistantCitation[]=[],uncertainty=uncertaintyFor(context,citations)):AssistantAnswer=>({answer,citations,uncertainty});
 if(intent==='workflow'){
  if(/\b(export|download)\b/i.test(context.question))return result('Open Requirements and use Export requirements to save the filtered requirements as JSON. In Settings, Export requirements CSV creates a spreadsheet-ready file, and Export workspace saves the full workspace and history as JSON. Keep this backup before resetting your workspace.');
  if(/\b(import|upload)\b/i.test(context.question))return result('Open Data Sources, upload a CSV or XLSX file, choose its dataset type, map the required columns and validate the mapping before importing. Select the imported dataset for analysis, then inspect findings and source records in Evidence Explorer. Review the resulting requirements before approval.');
  return result(`I can help with ${context.project.derivative} / ${context.project.market}: supporting and contradicting records, unknown PM ratings, evidence gaps, priority scores and review status. Try “What supports REQ-002?”, “Which scores need PM judgment?”, “Show an evidence gap”, or “Show VOC-004”. To start a project, import data in Data Sources, run analysis, inspect findings in Evidence Explorer, then assess requirements in Review Queue.`);
 }
 if(intent==='scoring'){
  const model=context.scoring_model,weights=dimensions.map(d=>`${dimensionLabels[d]} ${model.weights[d]}%`).join(', ');
  return result(`Scoring model v${model.version}: ${weights}. Each PM rating is 1–5; the score is the sum of weight × rating ÷ 5, rounded to two decimals. P1 is at least ${model.thresholds.p1}, P2 is at least ${model.thresholds.p2}, and lower scores are P3. Any unknown rating keeps the calculated score unscored. A PM priority override is a separate decision. Edit ratings on a requirement; edit weights and thresholds in Settings.`);
 }
 if(intent==='source'){
  const wanted=ids.filter(id=>!/^REQ[-_]|^FND[-_]/i.test(id));
  const matches=context.sources.filter(s=>wanted.length?wanted.includes(s.id.toUpperCase()):!words(context.question).length||relevant(context.question,`${s.id} ${s.text} ${s.dataset}`)>0);
  if(!matches.length)return result(`I found no matching source record${wanted.length?` for ${wanted.join(', ')}`:''} in ${context.project.derivative} / ${context.project.market}. Check the source ID in Data Sources or Evidence Explorer. This conversation only uses the selected project.`);
  const selected=matches.slice(0,3),citations=quoted(selected,new Set(selected.map(s=>s.id)));
  return result(selected.map(s=>`${s.id} — ${s.dataset} (${s.source_type}${s.synthetic?', synthetic demonstration data':''}). ${s.url?`Source URL: ${s.url}. `:''}Open the source record below to inspect its original content.`).join('\n\n'),citations);
 }
 if(intent==='finding'){
  const f=context.findings.find(f=>ids.includes(f.id.toUpperCase()));
  if(!f)return result(`I found no matching finding in ${context.project.derivative} / ${context.project.market}. Check its ID in Evidence Explorer.`);
  const citations=quoted(context.sources,new Set([...f.source_ids,...f.contradictions]));
  return result(`${f.id}: ${f.title}. ${f.description} Status: ${f.status}; stored evidence strength: ${f.strength}. ${f.contradictions.length?`Contradicting source IDs: ${f.contradictions.join(', ')}.`:'No contradicting sources are linked to this finding.'}${f.status==='Excluded'?' This finding is excluded and should not be treated as active support.':''}`,citations);
 }
 const reqIds=ids.filter(id=>/^REQ[-_]/i.test(id)),scope=reqIds.length?context.requirements.filter(r=>reqIds.includes(r.id.toUpperCase())):context.requirements;
 if(reqIds.length&&!scope.length)return result(`I found no requirement ${reqIds.join(', ')} in ${context.project.derivative} / ${context.project.market}. Check its ID or select the correct project.`);
 if(intent==='status'){
  if(reqIds.length)return result(scope.map(r=>`${r.id}: ${r.title}. Status: ${r.status}. ${r.rationale}`).join('\n\n'));
  const matching=scope.filter(r=>context.question.toLowerCase().includes(r.status.toLowerCase())),counts=Object.entries(context.summary.statuses).map(([status,count])=>`${status}: ${count}`).join('; ');
  return result(`${context.project.derivative} / ${context.project.market} has ${context.summary.requirements} requirements, ${context.summary.findings} findings and ${context.summary.records} source records. ${counts||'No requirements have been created.'} ${context.summary.unscored} requirements have unknown PM ratings.${matching.length?`\n\n${matching.map(r=>`${r.id}: ${r.title} — ${r.status}`).join('\n')}`:''} Open Review Queue for pending decisions and record a rationale for any status change.`);
 }
 if(intent==='unknown'){
  const unknown=scope.filter(r=>r.score===null);
  if(!unknown.length)return result(reqIds.length?'All five PM ratings on this requirement are filled. Inspect its assessment to review the assumptions.':`${context.summary.unscored===0?'All stored requirements have complete PM ratings.':'No unscored requirement is in the selected context.'} Complete ratings are assessments, not proof of customer demand.`);
  return result(unknown.map(r=>`${r.id}: ${r.title}. Unknown or invalid ratings: ${dimensions.filter(d=>r.scores[d]===null||!Number.isFinite(r.scores[d])||r.scores[d]!<1||r.scores[d]!>5).map(d=>dimensionLabels[d]).join(', ')}. ${r.uncertainty}`).join('\n\n')+'\n\nOpen each requirement and choose Adjust scores or priority. Keep a rating unknown until the responsible PM can justify it; save an assessment with a rationale.');
 }
 if(intent==='gap'){
  const r=[...scope].sort((a,b)=>gapWeight(b)-gapWeight(a))[0];
  if(!r)return result('No requirements are available to inspect for evidence gaps. Import source records in Data Sources and run an analysis first.');
  const gaps=[!r.support_source_count?'No available supporting source records are linked.':'',r.missing_source_ids.length?`Linked records are unavailable: ${r.missing_source_ids.join(', ')}.`:'',r.challenged_finding_ids.length?`Challenged findings: ${r.challenged_finding_ids.join(', ')}.`:'',r.excluded_finding_ids.length?`Excluded findings are not active support: ${r.excluded_finding_ids.join(', ')}.`:'',r.contradiction_source_ids.length?`Contradicting source IDs: ${r.contradiction_source_ids.join(', ')}.`:'',r.score===null?'Some PM ratings are unknown.':'',r.uncertainty].filter(Boolean);
  const requests=context.evidence_requests.filter(t=>t.requirement_id===r.id&&t.status==='Open'),citations=requirementCitations(context,r);
  return result(`${r.id}: ${r.title}. ${gaps.join(' ')}${requests.length?`\n\nOpen evidence requests: ${requests.map(t=>`${t.id}: ${t.text}`).join(' ')}`:''}\n\nReview the linked findings, collect evidence that addresses these specific uncertainties, and reassess the requirement with a rationale.`,citations);
 }
 const r=scope[0];
 if(!r)return result(`There are no requirements for ${context.project.derivative} in ${context.project.market} yet. Import feedback in Data Sources and run an analysis first.`);
 if(!reqIds.length&&!/\b(top|highest|priority|priorities|score|evidence|support|supports|requirement|requirements)\b/i.test(context.question)&&!relevant(context.question,`${r.title} ${r.statement} ${r.category}`))return result('I could not match that question to a requirement or source in this project. I can explain stored evidence, scores, gaps and status. Ask about a requirement title or ID, or try “How do I import feedback?”.');
 const status=r.score===null?'Its calculated priority is unscored because some PM ratings are unknown.':`Its calculated score is ${r.score} (${r.priority}).`,citations=requirementCitations(context,r);
 return result(`${r.id}: ${r.title}. ${r.statement} Status: ${r.status}. ${status}${r.priority_override?` PM priority override: ${r.priority_override}.`:''} ${r.support_source_count} available supporting records are linked.${r.contradiction_source_ids.length?` Contradicting records: ${r.contradiction_source_ids.join(', ')}.`:''}${r.challenged_finding_ids.length?` Challenged findings: ${r.challenged_finding_ids.join(', ')}.`:''}${citations.length?' Open the source records below to inspect the evidence.':' No linked source excerpt is available in this answer.'}`,citations,`${r.uncertainty} ${uncertaintyFor(context,citations)}`.trim());
}
export function lookupAssistantSource(state:Workspace,projectId:string,id:string):SourceRecord|undefined {
 return state.datasets.filter(d=>d.projectId===projectId).flatMap(d=>d.records).find(r=>r.id===id);
}
