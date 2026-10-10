import {useEffect,useRef,useState} from 'react';
import {ArrowUp,BookOpen,MessageCircle,RotateCcw,ShieldCheck,Sparkles,Square,X} from 'lucide-react';
import {useApp} from '../context';
import {buildAssistantContext,isWorkflowQuestion,lookupAssistantSource,type AssistantAnswer} from '../lib/assistant-context';
import {AssistantCancelledError,requestAssistantAnswer} from '../lib/assistant-client';
import {checkServices} from '../lib/services';

type Message={role:'user'|'assistant';text:string;answer?:AssistantAnswer;mode?:'AI'|'Offline guide'|'Status';notice?:string};
const suggestions=['What supports the top requirement?','Which scores still need PM judgment?','Show me an evidence gap','What is the project status?'];
export default function Assistant(){
 const {state,project,chatAvailable,cloud,openSource,navigate,refreshServices}=useApp();
 const liveAssistant=chatAvailable&&!cloud;
 const [open,setOpen]=useState(false),[question,setQuestion]=useState(''),[messages,setMessages]=useState<Message[]>([]),[busy,setBusy]=useState(false);
 const bottom=useRef<HTMLDivElement>(null),activeRequest=useRef<AbortController|null>(null),generation=useRef(0),projectId=useRef(project.id);
 projectId.current=project.id;
 const clear=()=>{generation.current++;activeRequest.current?.abort();activeRequest.current=null;setBusy(false);setMessages([]);setQuestion('');};
 useEffect(()=>{clear();return ()=>{generation.current++;activeRequest.current?.abort();};},[project.id]);
 useEffect(()=>{bottom.current?.scrollIntoView({block:'end',behavior:'smooth'});},[messages,busy]);
 useEffect(()=>{if(open)void refreshServices();},[open]);
 const cancel=()=>{generation.current++;activeRequest.current?.abort();activeRequest.current=null;setBusy(false);setMessages(old=>[...old,{role:'assistant',text:'Request canceled. You can ask another question.',mode:'Status'}]);};
 const send=async(raw:string)=>{
  const q=raw.trim();if(!q||activeRequest.current)return;
  const controller=new AbortController(),session=generation.current,originProject=project.id;
  activeRequest.current=controller;setQuestion('');setMessages(old=>[...old,{role:'user',text:q}]);setBusy(true);
  const current=()=>session===generation.current&&originProject===projectId.current&&!controller.signal.aborted;
  try{
   const context=buildAssistantContext(state,project,q);
   context.conversation=messages.filter(m=>m.mode!=='Status').slice(-10).map(m=>({role:m.role,content:m.text.slice(0,3000)}));
   let live=liveAssistant;
   // Startup checks and server restarts can leave the page's capability state stale.
   // Resolve readiness for this question before choosing the offline guide.
   if(!cloud&&!isWorkflowQuestion(q)){
    try{live=(await checkServices(controller.signal)).chat;}catch{live=false;}
   }
   if(!current())return;
   const result=await requestAssistantAnswer(context,{live,signal:controller.signal});
   if(current())setMessages(old=>[...old,{role:'assistant',text:result.answer.answer,answer:result.answer,mode:result.mode,notice:result.notice}]);
  }catch(error){
   if(current()&&!(error instanceof AssistantCancelledError))setMessages(old=>[...old,{role:'assistant',text:'The assistant could not read this project. Open Data Sources to inspect its records, or reset this conversation and retry.',mode:'Status'}]);
  }finally{if(current()){activeRequest.current=null;setBusy(false);}}
 };
 return <div className="assistant-root">
  {open&&<section className="assistant-panel" aria-label="InsightPilot assistant">
   <header className="assistant-header"><div className="assistant-avatar"><Sparkles size={18}/></div><div><strong>InsightPilot Assistant</strong><span>{liveAssistant?'Live AI · grounded in this project':'Offline evidence guide'} · {project.derivative} / {project.market}</span></div><button aria-label="Reset conversation" title="Reset conversation" onClick={clear} disabled={!messages.length&&!busy}><RotateCcw size={16}/></button><button aria-label="Close assistant" onClick={()=>setOpen(false)}><X size={18}/></button></header>
   <div className="assistant-messages" role="log" aria-live="polite" aria-busy={busy}>
    {!messages.length&&<div className="assistant-welcome"><div className="assistant-welcome-icon"><BookOpen size={24}/></div><h3>Ask about the evidence</h3><p>I can find source records, explain priorities, show review status and identify missing PM assessments. Decisions remain yours.</p><div className="assistant-suggestions">{suggestions.map(s=><button key={s} onClick={()=>void send(s)}>{s}</button>)}</div></div>}
    {messages.map((m,i)=><div key={i} className={`assistant-message ${m.role}`}><div className="assistant-bubble">{m.role==='assistant'&&<small>{m.mode}</small>}{m.notice&&<div className="assistant-service-notice" role="status">{m.notice}<button onClick={()=>{navigate('Settings');setOpen(false);}}>Open Settings</button></div>}<p>{m.text}</p>{m.answer?.uncertainty&&<p className="assistant-uncertainty"><ShieldCheck size={13}/>{m.answer.uncertainty}</p>}{m.answer?.citations.length?<div className="assistant-citations"><span>Source records</span>{m.answer.citations.map((c,j)=>{const source=lookupAssistantSource(state,project.id,c.source_id);return <button key={`${c.source_id}-${j}`} onClick={()=>source&&openSource(source)} disabled={!source}><strong>{c.source_id}</strong><span>“{c.quote.slice(0,100)}”</span></button>;})}</div>:null}</div></div>)}
    {busy&&<div className="assistant-message assistant"><div className="assistant-bubble assistant-thinking">{liveAssistant?'Checking the selected evidence…':'Reading this project’s records…'}<button className="assistant-stop" onClick={cancel}><Square size={11}/>Stop request</button></div></div>}<div ref={bottom}/>
   </div>
   {!busy&&messages.length>0&&<div className="assistant-followups">{suggestions.slice(1,3).map(s=><button key={s} onClick={()=>void send(s)}>{s}</button>)}</div>}
   <form className="assistant-composer" onSubmit={e=>{e.preventDefault();void send(question);}}><label className="sr-only" htmlFor="assistant-question">Ask the assistant</label><input id="assistant-question" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={600} placeholder="Ask about a requirement or source…" disabled={busy}/><button type="submit" aria-label="Send question" disabled={!question.trim()||busy}><ArrowUp size={18}/></button></form>
   <div className="assistant-footnote">{liveAssistant?'AI may make mistakes.':'Offline mode works without an API key.'} Answers use this project’s records.</div>
  </section>}
  <button className="assistant-launcher" onClick={()=>setOpen(value=>!value)} aria-label={open?'Close assistant':'Open assistant'}><MessageCircle size={21}/><span>Ask InsightPilot</span></button>
 </div>;
}
