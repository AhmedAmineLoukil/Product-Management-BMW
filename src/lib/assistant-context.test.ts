import {describe,it,expect} from 'vitest';
import {createSeed} from '../data/seed';
import {buildAssistantContext,offlineAssistantAnswer} from './assistant-context';

describe('assistant project grounding',()=>{
 it('uses only the selected market and exact source substrings',()=>{
  const state=createSeed(),project=state.projects[0];
  const context=buildAssistantContext(state,project,'What supports REQ-002?');
  expect(context.project.market).toBe('Germany');
  const answer=offlineAssistantAnswer(context);
  for(const citation of answer.citations)expect(context.sources.find(s=>s.id===citation.source_id)?.text).toContain(citation.quote);
 });
 it('does not borrow evidence from another project',()=>{
  const state=createSeed(),project=state.projects[1];
  const context=buildAssistantContext(state,project,'What supports REQ-002?');
  expect(context.sources).toHaveLength(0);
  expect(offlineAssistantAnswer(context).answer).toContain('no requirements');
 });
});
