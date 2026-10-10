import type {Plugin} from 'vite';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {resolve} from 'node:path';

export interface PythonReadiness {
 pythonReady:boolean;
 dependencies:{chat:boolean;analysis:boolean;collector:boolean};
 issues:string[];
}
interface LocalAIOptions {
 root?:string;
 spawnProcess?:typeof spawn;
 healthCheck?:()=>Promise<PythonReadiness>;
 healthCacheMs?:number;
 timeouts?:Partial<Record<'/api/analyze'|'/api/chat'|'/api/collect',number>>;
}
type BridgeResult={status:number;data:unknown};
const unavailable:PythonReadiness={pythonReady:false,dependencies:{chat:false,analysis:false,collector:false},issues:['Python could not start. Run start-final.ps1, or configure PYTHON_BIN and install requirements.txt.']};

/** Resolve both Windows and Unix environments without relying on the shell PATH. */
export function resolvePython(env:Record<string,string>,root=process.cwd(),platform=process.platform):string {
 if(env.PYTHON_BIN?.trim())return env.PYTHON_BIN.trim();
 const relative=platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python';
 return [resolve(root,relative),resolve(root,'..',relative)].find(existsSync)??(platform==='win32'?'python':'python3');
}

/** Local Python services. Credentials remain in the server and never enter JSON replies. */
export function createLocalAIHandler(env:Record<string,string>,options:LocalAIOptions={}) {
 const root=options.root??process.cwd();
 const spawnProcess=options.spawnProcess??spawn;
 const python=resolvePython(env,root);
 const model=env.OPENAI_MODEL?.trim()||'gpt-5-mini';
 const chatModel=env.OPENAI_CHAT_MODEL?.trim()||model;
 const childEnv={...process.env,...env,OPENAI_MODEL:model,OPENAI_CHAT_MODEL:chatModel,PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1',PYTHONUNBUFFERED:'1'};
 const routes={
  '/api/analyze':{script:'scripts/analyze_bridge.py',timeout:options.timeouts?.['/api/analyze']??600_000,needsKey:true,dependency:'analysis' as const},
  '/api/chat':{script:'scripts/chat_bridge.py',timeout:options.timeouts?.['/api/chat']??90_000,needsKey:true,dependency:'chat' as const},
  '/api/collect':{script:'scripts/collect_bridge.py',timeout:options.timeouts?.['/api/collect']??90_000,needsKey:false,dependency:'collector' as const},
 };
 let activeAnalysis=false;
 let healthCache:Promise<PythonReadiness>|undefined,checkedAt=0;

 const runBridge=(script:string,data:unknown,timeout:number,signal?:AbortSignal):Promise<BridgeResult>=>new Promise(done=>{
  if(signal?.aborted)return done({status:499,data:{error:'Operation cancelled.'}});
  let child:ReturnType<typeof spawn>;
  try{child=spawnProcess(python,[resolve(root,script)],{cwd:root,env:childEnv,stdio:['pipe','pipe','pipe'],windowsHide:true});}
  catch{return done({status:503,data:{error:unavailable.issues[0]}});}
  let output='',finished=false;
  const finish=(status:number,result:unknown)=>{
   if(finished)return;
   finished=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
   done({status,data:result});
  };
  const stop=()=>{try{child.kill('SIGKILL');}catch{/* Already stopped. */}};
  const cancel=()=>{stop();finish(499,{error:'Operation cancelled.'});};
  const timer=setTimeout(()=>{stop();finish(504,{error:'Operation timed out. Try a smaller input or another source.',code:'timeout'});},timeout);
  signal?.addEventListener('abort',cancel,{once:true});
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data',(chunk:string)=>{output+=chunk;if(Buffer.byteLength(output)>10_000_000){stop();finish(502,{error:'Output exceeds the limit.'});}});
  // Provider diagnostics may contain private request details. Never echo stderr.
  child.stderr?.resume();
  child.on('error',()=>finish(503,{error:unavailable.issues[0]}));
  child.on('close',code=>{
   if(finished)return;
   try{
    const parsed:unknown=JSON.parse(output);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Invalid bridge result');
    const result=parsed as {error?:unknown;status?:unknown};
    const status=code===0&&!result.error?200:(typeof result.status==='number'&&[400,401,403,422,429,502,503,504].includes(result.status)?result.status:422);
    finish(status,parsed);
   }catch{finish(502,{error:'Python operation failed. Run start-final.ps1 to check the server dependencies.'});}
  });
  child.stdin?.on('error',()=>{});
  child.stdin?.end(JSON.stringify(data));
 });
 const readiness=()=>{
  if(!healthCache||Date.now()-checkedAt>(options.healthCacheMs??15_000)){
   checkedAt=Date.now();
   healthCache=(options.healthCheck?options.healthCheck():runBridge('scripts/health_bridge.py',{},8_000).then(result=>{
    if(result.status!==200)return {...unavailable,issues:result.status===504?['Python readiness check timed out. Restart the app and check the Python installation.']:unavailable.issues};
    const probe=result.data as Partial<PythonReadiness>;
    return probe.pythonReady===true&&probe.dependencies&&typeof probe.dependencies.chat==='boolean'&&typeof probe.dependencies.analysis==='boolean'&&typeof probe.dependencies.collector==='boolean'&&Array.isArray(probe.issues)?probe as PythonReadiness:unavailable;
   })).catch(()=>unavailable);
  }
  return healthCache;
 };
 const capabilities=async()=>{
  const health=await readiness();
  const keyConfigured=!!env.OPENAI_API_KEY?.trim();
  const chat=keyConfigured&&health.pythonReady&&health.dependencies.chat;
  const ai=keyConfigured&&health.pythonReady&&health.dependencies.analysis;
  const collector=health.pythonReady&&health.dependencies.collector;
  return {...health,keyConfigured,chat,ai,collector,status:chat&&ai&&collector?'ready':'degraded',
   model,chatModel,
   configurationSource:env.AI_CONFIGURATION_SOURCE||'not configured',limit:50,liveVerified:false,
   issues:[...health.issues,...(!keyConfigured?['Live AI needs OPENAI_API_KEY in the repository or final-product .env. Restart the app after changing it.']:[])]};
 };
 return async(req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
  const path=req.url?.split('?')[0];
  if(!path?.startsWith('/api/'))return next();
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  const reply=(status:number,data:unknown)=>{if(res.writableEnded||res.destroyed)return;res.statusCode=status;res.end(JSON.stringify(data));};
  const host=req.headers.host??'',origin=req.headers.origin;
  if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)||(origin&&origin!==`http://${host}`))return reply(403,{error:'Local same-origin access only.'});
  if((path==='/api/capabilities'||path==='/api/health')&&req.method==='GET')return reply(200,await capabilities());
  const route=routes[path as keyof typeof routes];
  if(!route)return reply(404,{error:'Unknown endpoint.'});
  if(req.method!=='POST'){res.setHeader('Allow','POST');return reply(405,{error:'Use POST for this endpoint.'});}
  const abort=new AbortController();
  const disconnect=()=>{if(!res.writableEnded)abort.abort();};
  req.on('aborted',disconnect);res.on('close',disconnect);
  let ownsAnalysis=false;
  try{
   const chunks:Buffer[]=[];let bytes=0;
   for await(const chunk of req){const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=buffer.length;if(bytes>1_000_000)return reply(413,{error:'Request is too large.'});chunks.push(buffer);}
   let data:unknown;
   try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,{error:'Invalid JSON request.'});}
   if(!data||typeof data!=='object'||Array.isArray(data))return reply(400,{error:'Send a JSON object.'});
   const request=data as Record<string,unknown>;
   if(path==='/api/analyze'){
    if(!Array.isArray(request.records)||request.records.length<1||request.records.length>50)return reply(400,{error:'Select 1–50 feedback records.'});
    if(activeAnalysis)return reply(409,{error:'An analysis is already running.'});
    activeAnalysis=true;ownsAnalysis=true;
   }
   if(path==='/api/chat'&&(typeof request.question!=='string'||!request.question.trim()||request.question.trim().length>600))return reply(400,{error:'Ask a question of up to 600 characters.'});
   if(route.needsKey&&!env.OPENAI_API_KEY?.trim())return reply(503,{error:'Set OPENAI_API_KEY in the repository or final-product .env and restart the app.',code:'missing_key'});
   const health=await readiness();
   if(abort.signal.aborted)return;
   if(!health.pythonReady||!health.dependencies[route.dependency])return reply(503,{error:health.issues[0]||'Install requirements.txt and restart the app.',code:'dependencies_unavailable'});
   const result=await runBridge(route.script,data,route.timeout,abort.signal);
   reply(result.status,result.data);
  }catch{if(!abort.signal.aborted)reply(400,{error:'Could not read the request. Send a valid JSON object.'});}
  finally{if(ownsAnalysis)activeAnalysis=false;req.off('aborted',disconnect);res.off('close',disconnect);}
 };
}

export function localAI(env:Record<string,string>,options:LocalAIOptions={}):Plugin {
 const handler=createLocalAIHandler(env,options);
 return {name:'local-python-services',configureServer(server){server.middlewares.use((req,res,next)=>{void handler(req,res,next);});},configurePreviewServer(server){server.middlewares.use((req,res,next)=>{void handler(req,res,next);});}};
}
