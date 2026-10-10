import {isWorkflowQuestion,offlineAssistantAnswer,type AssistantAnswer,type AssistantContext} from './assistant-context';

export type AssistantResult={answer:AssistantAnswer;mode:'AI'|'Offline guide';notice?:string};
export class AssistantCancelledError extends Error {
 constructor(){super('Assistant request canceled.');this.name='AssistantCancelledError';}
}
const isObject=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
/** Validate the response before rendering it or offering source links. */
export function parseAssistantAnswer(value:unknown,context:AssistantContext):AssistantAnswer {
 if(!isObject(value)||typeof value.answer!=='string'||!value.answer.trim()||value.answer.length>3_000||typeof value.uncertainty!=='string'||value.uncertainty.length>3_000||!Array.isArray(value.citations)||value.citations.length>8)throw new Error('Live AI returned an invalid answer.');
 const sources=new Map(context.sources.map(s=>[s.id,s.text]));
 const citations=value.citations.map(c=>{
  if(!isObject(c)||typeof c.source_id!=='string'||typeof c.quote!=='string'||!c.quote.trim()||!sources.get(c.source_id)?.includes(c.quote))throw new Error('Live AI returned an unsupported source citation.');
  return {source_id:c.source_id,quote:c.quote};
 });
 return {answer:value.answer,citations,uncertainty:value.uncertainty};
}
/** Always preserve a useful offline answer when the optional live service fails. */
export async function requestAssistantAnswer(context:AssistantContext,options:{live:boolean;signal?:AbortSignal;timeoutMs?:number;fetcher?:typeof fetch}):Promise<AssistantResult> {
 if(options.signal?.aborted)throw new AssistantCancelledError();
 if(!options.live||isWorkflowQuestion(context.question))return {answer:offlineAssistantAnswer(context),mode:'Offline guide'};
 const controller=new AbortController();let timedOut=false;
 const onAbort=()=>controller.abort();options.signal?.addEventListener('abort',onAbort,{once:true});
 let rejectAborted!:(reason:Error)=>void;
 const aborted=new Promise<never>((_resolve,reject)=>{rejectAborted=reject;});
 const stop=()=>rejectAborted(options.signal?.aborted?new AssistantCancelledError():new Error('Live AI timed out. Check the service status in Settings and retry.'));
 controller.signal.addEventListener('abort',stop,{once:true});
 const timeout=setTimeout(()=>{timedOut=true;controller.abort();},options.timeoutMs??65_000);
 try{
  const response=await Promise.race([(options.fetcher??fetch)('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(context),signal:controller.signal}),aborted]);
  if(!response.ok)throw new Error(response.status===503?'Live AI is unavailable. Check the service status and API setup in Settings.':response.status===504?'Live AI timed out. Retry or use the offline evidence guide.':`Live AI could not answer (HTTP ${response.status}). Check the service status in Settings and retry.`);
  let data:unknown;try{data=await Promise.race([response.json(),aborted]);}catch(error){if(controller.signal.aborted)throw error;throw new Error('Live AI returned unreadable data. Restart the local server and retry.');}
  // Some providers or mocks may complete even after their request was aborted.
  if(options.signal?.aborted)throw new AssistantCancelledError();
  if(timedOut)throw new Error('Live AI timed out. Check the service status in Settings and retry.');
  return {answer:parseAssistantAnswer(data,context),mode:'AI'};
 }catch(error){
  if(options.signal?.aborted||error instanceof AssistantCancelledError)throw new AssistantCancelledError();
  const notice=timedOut?'Live AI timed out. Check the service status in Settings and retry.':error instanceof Error&&error.message.startsWith('Live AI')?error.message:'Live AI could not connect. Check that the local server is running and retry.';
  return {answer:offlineAssistantAnswer(context),mode:'Offline guide',notice:`${notice} Showing an offline answer from this project’s stored records.`};
 }finally{clearTimeout(timeout);options.signal?.removeEventListener('abort',onAbort);controller.signal.removeEventListener('abort',stop);}
}
