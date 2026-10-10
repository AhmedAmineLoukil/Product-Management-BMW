import {afterEach,describe,expect,it,vi} from 'vitest';
import {createSeed} from '../data/seed';
import {buildAssistantContext,offlineAssistantAnswer} from './assistant-context';
import {AssistantCancelledError,parseAssistantAnswer,requestAssistantAnswer} from './assistant-client';

const state=createSeed(),context=buildAssistantContext(state,state.projects[0],'What supports REQ-002?');
const grounded={answer:'Customers ask about charger availability.',uncertainty:'Synthetic demo records.',citations:[{source_id:'VOC-004',quote:'I want to know whether a charger on my route is actually available.'}]};
const fetchResponse=(response:Response)=>vi.fn<typeof fetch>().mockResolvedValue(response);
afterEach(()=>vi.useRealTimers());
describe('assistant transport and source validation',()=>{
 it('works offline without making a network request',async()=>{
  const fetcher=vi.fn<typeof fetch>(),result=await requestAssistantAnswer(context,{live:false,fetcher});
  expect(fetcher).not.toHaveBeenCalled();expect(result.mode).toBe('Offline guide');expect(result.answer).toEqual(offlineAssistantAnswer(context));
 });
 it.each(['How do I import CSV?','How can I upload feedback?','How do I export requirements?','What can you do?','Hello'])('uses approved app guidance without calling live AI for %s',async question=>{
  const fetcher=vi.fn<typeof fetch>(),help=buildAssistantContext(state,state.projects[0],question),result=await requestAssistantAnswer(help,{live:true,fetcher});
  expect(fetcher).not.toHaveBeenCalled();expect(result.mode).toBe('Offline guide');expect(result.answer).toEqual(offlineAssistantAnswer(help));
 });
 it('keeps an evidence question on live AI even when it starts with how do I',async()=>{
  const fetcher=fetchResponse(Response.json(grounded)),evidence=buildAssistantContext(state,state.projects[0],'How do I know what supports the charging requirement?');
  const result=await requestAssistantAnswer(evidence,{live:true,fetcher});expect(fetcher).toHaveBeenCalledTimes(1);expect(result.mode).toBe('AI');
 });
 it('accepts an exact grounded live answer and identifies it as AI',async()=>{
  const fetcher=fetchResponse(Response.json(grounded)),result=await requestAssistantAnswer(context,{live:true,fetcher});
  expect(result.mode).toBe('AI');expect(result.answer).toEqual(grounded);expect(result.notice).toBeUndefined();
  expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string).project.id).toBe(context.project.id);
 });
 it.each([null,{}, {answer:'text',uncertainty:'',citations:null},{answer:'',uncertainty:'',citations:[]},{...grounded,citations:[{source_id:'VOC-999',quote:'fabricated'}]},{...grounded,citations:[{source_id:'VOC-004',quote:'not present'}]},{...grounded,citations:[{source_id:'VOC-004',quote:''}]}])('rejects malformed or unsupported response %j',value=>{
  expect(()=>parseAssistantAnswer(value,context)).toThrow();
 });
 it('falls back after a service failure without pretending the answer came from AI',async()=>{
  const result=await requestAssistantAnswer(context,{live:true,fetcher:fetchResponse(Response.json({error:'Private provider detail'},{status:503}))});
  expect(result.mode).toBe('Offline guide');expect(result.answer.citations.length).toBeGreaterThan(0);expect(result.notice).toContain('Settings');expect(result.notice).not.toContain('Private provider detail');
 });
 it('falls back for HTML responses and invalid citations',async()=>{
  for(const response of [new Response('<html>not JSON</html>'),Response.json({...grounded,citations:[{source_id:'VOC-004',quote:'invented quote'}]})]){
   const result=await requestAssistantAnswer(context,{live:true,fetcher:fetchResponse(response)});
   expect(result.mode).toBe('Offline guide');expect(result.notice).toContain('Showing an offline answer');expect(result.answer).toEqual(offlineAssistantAnswer(context));
  }
 });
 it('times out stalled live requests and returns a useful offline answer',async()=>{
  vi.useFakeTimers();
  const fetcher=vi.fn<typeof fetch>().mockImplementation((_url,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))));
  const pending=requestAssistantAnswer(context,{live:true,fetcher,timeoutMs:100});await vi.advanceTimersByTimeAsync(101);
  const result=await pending;expect(result.mode).toBe('Offline guide');expect(result.notice).toContain('timed out');expect(result.answer).toEqual(offlineAssistantAnswer(context));
 });
 it('enforces its timeout even when transport ignores the abort signal',async()=>{
  vi.useFakeTimers();
  const fetcher=vi.fn<typeof fetch>().mockImplementation(()=>new Promise(()=>{})),pending=requestAssistantAnswer(context,{live:true,fetcher,timeoutMs:100});
  await vi.advanceTimersByTimeAsync(101);const result=await pending;
  expect(result.mode).toBe('Offline guide');expect(result.notice).toContain('timed out');
 });
 it('does not append an offline fallback after an intentional cancellation',async()=>{
  const controller=new AbortController(),fetcher=vi.fn<typeof fetch>().mockImplementation((_url,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))));
  const pending=requestAssistantAnswer(context,{live:true,fetcher,signal:controller.signal});controller.abort();
  await expect(pending).rejects.toBeInstanceOf(AssistantCancelledError);
 });
 it('discards late provider responses even when the provider ignores cancellation',async()=>{
  const controller=new AbortController();let finish!:(response:Response)=>void;
  const fetcher=vi.fn<typeof fetch>().mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=requestAssistantAnswer(context,{live:true,fetcher,signal:controller.signal});controller.abort();finish(Response.json(grounded));
  await expect(pending).rejects.toBeInstanceOf(AssistantCancelledError);
 });
});
