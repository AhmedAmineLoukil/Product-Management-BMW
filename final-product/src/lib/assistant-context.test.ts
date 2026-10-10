import {describe,it,expect} from 'vitest';
import {createSeed} from '../data/seed';
import {buildAssistantContext,lookupAssistantSource,offlineAssistantAnswer} from './assistant-context';

describe('assistant project grounding',()=>{
 const answerTo=(question:string)=>{const state=createSeed();return offlineAssistantAnswer(buildAssistantContext(state,state.projects[0],question));};
 it('answers the requested requirement instead of the first requirement',()=>{
  const state=createSeed(),context=buildAssistantContext(state,state.projects[0],'What supports REQ-002?'),answer=offlineAssistantAnswer(context);
  expect(answer.answer).toContain('REQ-002');expect(answer.answer).toContain('96 (P1)');
  expect(answer.citations.map(c=>c.source_id)).toContain('VOC-004');
  for(const citation of answer.citations)expect(context.sources.find(s=>s.id===citation.source_id)?.text).toContain(citation.quote);
 });
 it('does not borrow requirements, findings, requests or sources from another project',()=>{
  const state=createSeed(),context=buildAssistantContext(state,state.projects[1],'What supports REQ-002?'),answer=offlineAssistantAnswer(context);
  expect(context.requirements).toEqual([]);expect(context.findings).toEqual([]);expect(context.sources).toEqual([]);expect(context.evidence_requests).toEqual([]);
  expect(answer.answer).toContain('no requirement REQ-002');expect(answer.citations).toEqual([]);
  expect(lookupAssistantSource(state,state.projects[1].id,'VOC-004')).toBeUndefined();
 });
 it('lists the actual unknown dimensions and does not invent ratings',()=>{
  const answer=answerTo('Which scores still need PM judgment?');
  expect(answer.answer).toContain('REQ-007');expect(answer.answer).toContain('Unknown or invalid ratings: Feasibility');
  expect(answer.answer).not.toContain('REQ-001');expect(answer.answer).toContain('Keep a rating unknown');expect(answer.citations).toEqual([]);
 });
 it('identifies an actionable evidence gap with the actual open follow-up',()=>{
  const answer=answerTo('Show me an evidence gap');
  expect(answer.answer).toContain('REQ-007');expect(answer.answer).toContain('TASK-001');expect(answer.answer).toContain('assess feasibility');
 });
 it('shows contradicting evidence and preserves exact quotes',()=>{
  const answer=answerTo('Show conflicting evidence for REQ-001');
  expect(answer.answer).toContain('FND-010');expect(answer.citations.find(c=>c.source_id==='VOC-018')?.quote).toContain('would not want more physical buttons');
 });
 it('reports missing links and does not count excluded findings as support',()=>{
  const state=createSeed();state.findings[1].status='Excluded';
  const context=buildAssistantContext(state,state.projects[0],'Show an evidence gap for REQ-002'),answer=offlineAssistantAnswer(context);
  expect(answer.answer).toContain('No available supporting source records');expect(answer.answer).toContain('Excluded findings');expect(answer.citations).toEqual([]);
  state.findings[1].status='New';state.findings[1].sources.push('VOC-MISSING');
  expect(offlineAssistantAnswer(buildAssistantContext(state,state.projects[0],'Show an evidence gap for REQ-002')).answer).toContain('Linked records are unavailable: VOC-MISSING');
 });
 it('looks up original source IDs and clearly labels synthetic records',()=>{
  const answer=answerTo('Show VOC-020');
  expect(answer.citations).toEqual([{source_id:'VOC-020',quote:'I would enjoy more ambient lighting choices, but it is not a must-have.'}]);
  expect(answer.answer).toContain('synthetic demonstration data');expect(answer.answer).not.toContain('REQ-001');
 });
 it('does not substitute an unrelated record for a nonexistent source or requirement',()=>{
  expect(answerTo('Show VOC-999').citations).toEqual([]);expect(answerTo('Show VOC-999').answer).toContain('no matching source record');
  expect(answerTo('What supports REQ-999?').citations).toEqual([]);expect(answerTo('What supports REQ-999?').answer).toContain('no requirement REQ-999');
 });
 it('reports project status from the whole project, including a filtered status list',()=>{
  const answer=answerTo('Which requirements are approved?');
  expect(answer.answer).toContain('8 requirements, 10 findings and 31 source records');expect(answer.answer).toContain('Approved: 1');
  expect(answer.answer).toContain('REQ-004');expect(answer.answer).not.toContain('REQ-001:');
 });
 it('explains the actual scoring model without assigning unknown ratings',()=>{
  const answer=answerTo('How is the priority score calculated?');
  expect(answer.answer).toContain('Customer impact 30%');expect(answer.answer).toContain('weight × rating ÷ 5');expect(answer.answer).toContain('P1 is at least 75');
 });
 it('distinguishes a PM override from the calculated score',()=>{
  const state=createSeed();state.requirements[1].priorityOverride='P3';
  const answer=offlineAssistantAnswer(buildAssistantContext(state,state.projects[0],'What supports REQ-002?'));
  expect(answer.answer).toContain('96 (P1)');expect(answer.answer).toContain('PM priority override: P3');
 });
 it('offers working import guidance even when the project has no requirements',()=>{
  const state=createSeed(),answer=offlineAssistantAnswer(buildAssistantContext(state,state.projects[1],'How do I import feedback?'));
  expect(answer.answer).toContain('CSV or XLSX');expect(answer.answer).toContain('validate the mapping');expect(answer.answer).not.toContain('REQ-001');
 });
 it('does not turn an unrelated question into a made-up project answer',()=>{
  const answer=answerTo('What is the capital of Peru?');
  expect(answer.answer).toContain('could not match');expect(answer.citations).toEqual([]);
 });
 it('keeps total counts accurate when the context has more than its requirement limit',()=>{
  const state=createSeed();for(let n=0;n<20;n++)state.requirements.push({...structuredClone(state.requirements[0]),id:`REQ-EXTRA-${n}`});
  const context=buildAssistantContext(state,state.projects[0],'What is the project status?');
  expect(context.requirements).toHaveLength(12);expect(context.summary.requirements).toBe(28);expect(offlineAssistantAnswer(context).answer).toContain('28 requirements');
 });
});
