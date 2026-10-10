import {useEffect,useRef,useState} from 'react';
import {ArrowUp,BookOpen,MessageCircle,ShieldCheck,Sparkles,X} from 'lucide-react';
import {useApp} from '../context';
import {buildAssistantContext,lookupAssistantSource,offlineAssistantAnswer,type AssistantAnswer} from '../lib/assistant-context';

type Message={role:'user'|'assistant';text:string;answer?:AssistantAnswer;mode?:'AI'|'Offline guide'};
const suggestions=['What supports the top requirement?','Which scores still need PM judgment?','Show me an evidence gap'];

export default function Assistant(){
 const {state,project,aiAvailable,cloud,openSource}=useApp();
 const liveAssistant=aiAvailable&&!cloud;
 const [open,setOpen]=useState(false),[question,setQuestion]=useState(''),[messages,setMessages]=useState<Message[]>([]),[busy,setBusy]=useState(false);
 const bottom=useRef<HTMLDivElement>(null);
 useEffect(()=>{setMessages([]);setQuestion('');},[project.id]);
 useEffect(()=>{bottom.current?.scrollIntoView({block:'end',behavior:'smooth'});},[messages,busy]);
 const send=async(raw:string)=>{
  const q=raw.trim();if(!q||busy)return;
  setQuestion('');setMessages(old=>[...old,{role:'user',text:q}]);setBusy(true);
  try{
   const context=buildAssistantContext(state,project,q);
   let answer:AssistantAnswer;let mode:'AI'|'Offline guide'='Offline guide';
   if(liveAssistant){
    const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(context)});
    const data=await response.json();if(!response.ok)throw new Error(data.error??'Assistant request failed.');
    answer=data as AssistantAnswer;mode='AI';
   }else answer=offlineAssistantAnswer(context);
   const allowed=new Map(context.sources.map(s=>[s.id,s.text]));
   if(answer.citations.some(c=>!allowed.get(c.source_id)?.includes(c.quote)))throw new Error('The answer included an invalid citation.');
   setMessages(old=>[...old,{role:'assistant',text:answer.answer,answer,mode}]);
  }catch(error){setMessages(old=>[...old,{role:'assistant',text:(error as Error).message+' Try again, or inspect the evidence directly.',mode:'Offline guide'}]);}
  finally{setBusy(false);}
 };
 return <div className="assistant-root">
  {open&&<section className="assistant-panel" aria-label="InsightPilot assistant">
   <header className="assistant-header"><div className="assistant-avatar"><Sparkles size={18}/></div><div><strong>InsightPilot Assistant</strong><span>{liveAssistant?'Live AI · grounded in this project':'Offline evidence guide'} · {project.derivative} / {project.market}</span></div><button aria-label="Close assistant" onClick={()=>setOpen(false)}><X size={18}/></button></header>
   <div className="assistant-messages" role="log" aria-live="polite">
    {!messages.length&&<div className="assistant-welcome"><div className="assistant-welcome-icon"><BookOpen size={24}/></div><h3>Ask about the evidence</h3><p>I can explain requirements, show supporting records and point out missing PM assessments. Decisions remain yours.</p><div className="assistant-suggestions">{suggestions.map(s=><button key={s} onClick={()=>void send(s)}>{s}</button>)}</div></div>}
    {messages.map((m,i)=><div key={i} className={`assistant-message ${m.role}`}><div className="assistant-bubble">{m.role==='assistant'&&<small>{m.mode}</small>}<p>{m.text}</p>{m.answer?.uncertainty&&<p className="assistant-uncertainty"><ShieldCheck size={13}/>{m.answer.uncertainty}</p>}{m.answer?.citations.length? <div className="assistant-citations"><span>Source records</span>{m.answer.citations.map((c,j)=>{const source=lookupAssistantSource(state,project.id,c.source_id);return <button key={`${c.source_id}-${j}`} onClick={()=>source&&openSource(source)} disabled={!source}><strong>{c.source_id}</strong><span>“{c.quote.slice(0,100)}”</span></button>;})}</div>:null}</div></div>)}
    {busy&&<div className="assistant-message assistant"><div className="assistant-bubble assistant-thinking">Checking the selected evidence…</div></div>}<div ref={bottom}/>
   </div>
   <form className="assistant-composer" onSubmit={e=>{e.preventDefault();void send(question);}}><label className="sr-only" htmlFor="assistant-question">Ask the assistant</label><input id="assistant-question" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={600} placeholder="Ask about a requirement or source…" disabled={busy}/><button type="submit" aria-label="Send question" disabled={!question.trim()||busy}><ArrowUp size={18}/></button></form>
   <div className="assistant-footnote">Answers use this project’s records. Verify conclusions before approving.</div>
  </section>}
  <button className="assistant-launcher" onClick={()=>setOpen(value=>!value)} aria-label={open?'Close assistant':'Open assistant'}><MessageCircle size={21}/><span>Ask InsightPilot</span></button>
 </div>;
}
