import type {Plugin} from 'vite';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import type {IncomingMessage,ServerResponse} from 'node:http';

/** Local-only Python services. No API key is ever sent to browser JavaScript. */
export function localAI(env:Record<string,string>):Plugin {
 let activeAnalysis=false;
 const configuredLimit=Number(env.OPENAI_RUN_RECORD_LIMIT||env.OPENAI_MAX_RECORDS_PER_RUN||50);
 const recordLimit=Number.isFinite(configuredLimit)?Math.min(50,Math.max(1,Math.floor(configuredLimit))):50;
 const configuredChars=Number(env.OPENAI_MAX_INPUT_CHARS||100_000);
 const inputCharLimit=Number.isFinite(configuredChars)?Math.min(100_000,Math.max(1_000,Math.floor(configuredChars))):100_000;
 const handler=async(req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
  if(!req.url?.startsWith('/api/'))return next();
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  const reply=(status:number,data:unknown)=>{if(res.writableEnded)return;res.statusCode=status;res.end(JSON.stringify(data));};
  const host=req.headers.host??'';const origin=req.headers.origin;
  if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)||origin&&origin!==`http://${host}`)return reply(403,{error:'Local same-origin access only.'});
  if(req.url==='/api/capabilities'&&req.method==='GET')return reply(200,{ai:!!env.OPENAI_API_KEY,chat:!!env.OPENAI_API_KEY,collector:true,model:env.OPENAI_MODEL||'gpt-5-mini',limit:recordLimit,max_input_chars:inputCharLimit,budget_usd:env.OPENAI_BUDGET_USD||null});
  const routes:Record<string,{script:string;timeout:number;needsKey:boolean}>={
   '/api/analyze':{script:'scripts/analyze_bridge.py',timeout:600_000,needsKey:true},
   '/api/chat':{script:'scripts/chat_bridge.py',timeout:60_000,needsKey:true},
   '/api/collect':{script:'scripts/collect_bridge.py',timeout:45_000,needsKey:false},
  };
  const route=routes[req.url??''];
  if(!route||req.method!=='POST')return reply(404,{error:'Unknown endpoint.'});
  if(route.needsKey&&!env.OPENAI_API_KEY)return reply(503,{error:'Set OPENAI_API_KEY in .env and restart the app.'});
  if(req.url==='/api/analyze'&&activeAnalysis)return reply(409,{error:'An analysis is already running.'});
  let body='';
  try{
   for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>1_000_000)return reply(413,{error:'Request is too large.'});}
   const data=JSON.parse(body);
   if(req.url==='/api/analyze'){
    if(!Array.isArray(data.records)||data.records.length<1||data.records.length>recordLimit)return reply(400,{error:`Select 1-${recordLimit} feedback records.`});
    const chars=data.records.reduce((sum:number,r:unknown)=>sum+String((r as {text?:unknown}).text??'').length,0);
    if(chars>inputCharLimit)return reply(400,{error:`Selected feedback exceeds the ${inputCharLimit}-character live AI limit.`});
    activeAnalysis=true;
   }
   const python=env.PYTHON_BIN
    ||(existsSync('.venv/Scripts/python.exe')?'.venv/Scripts/python.exe'
    :existsSync('.venv/bin/python')?'.venv/bin/python'
    :process.platform==='win32'?'python':'python3');
   const child=spawn(python,[route.script],{env:{...process.env,...env},stdio:['pipe','pipe','pipe']});
   let output='',finished=false;
   const finish=(status:number,result:unknown)=>{if(finished)return;finished=true;clearTimeout(timer);if(req.url==='/api/analyze')activeAnalysis=false;reply(status,result);};
   const timer=setTimeout(()=>{child.kill();finish(504,{error:'Operation timed out. Try a smaller input or another source.'});},route.timeout);
   child.stdout.on('data',chunk=>{output+=chunk;if(output.length>10_000_000){child.kill();finish(502,{error:'Output exceeds the limit.'});}});
   child.stderr.resume();
   child.on('error',()=>finish(503,{error:'Python could not start. Create .venv and install requirements.txt.'}));
   child.on('close',code=>{try{const parsed=JSON.parse(output);finish(code===0?200:422,parsed);}catch{finish(502,{error:'Python operation failed. Install requirements.txt and check the server setup.'});}});
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(data));
  }catch{reply(400,{error:'Invalid JSON request.'});}
 };
 return {name:'local-python-services',configureServer(server){server.middlewares.use((req,res,next)=>{void handler(req,res,next);});},configurePreviewServer(server){server.middlewares.use((req,res,next)=>{void handler(req,res,next);});}};
}
