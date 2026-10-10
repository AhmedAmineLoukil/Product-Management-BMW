import {afterEach,describe,expect,it,vi} from 'vitest';
import {createServer,request as httpRequest} from 'node:http';
import type {Server} from 'node:http';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createLocalAIHandler,resolvePython} from './local-ai';
import {loadServerEnvironment} from './server-env';

const ready={pythonReady:true,dependencies:{chat:true,analysis:true,collector:true},issues:[]};
class Bridge extends EventEmitter {
 stdin=new PassThrough();stdout=new PassThrough();stderr=new PassThrough();
 kill=vi.fn(()=>{queueMicrotask(()=>this.emit('close',1));return true;});
 finish(value:unknown,code=0){this.stdout.end(JSON.stringify(value));this.emit('close',code);}
}
const servers:Server[]=[],tempFolders:string[]=[];
afterEach(async()=>{vi.unstubAllEnvs();await Promise.all(servers.splice(0).map(server=>new Promise<void>(done=>{server.closeAllConnections();server.close(()=>done());})));for(const folder of tempFolders.splice(0))rmSync(folder,{recursive:true,force:true});});
async function app(options:NonNullable<Parameters<typeof createLocalAIHandler>[1]>={},env:Record<string,string>={OPENAI_API_KEY:'test-only-not-a-key'}){
 const handler=createLocalAIHandler(env,{healthCheck:async()=>ready,...options});
 const server=createServer((req,res)=>void handler(req,res,()=>{res.statusCode=404;res.end();}));
 servers.push(server);await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const address=server.address();if(!address||typeof address==='string')throw new Error('No server address');
 return `http://127.0.0.1:${address.port}`;
}
const post=(url:string,path:string,body:unknown,extra:RequestInit={})=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),...extra});
function bridgeSpawn(onStart:(bridge:Bridge,script:string,index:number)=>void){
 let index=0;
 return vi.fn((_command:string,args:string[],options:unknown)=>{const bridge=new Bridge();bridge.stdin.on('finish',()=>onStart(bridge,args[0],index++));void options;return bridge;}) as unknown as typeof spawn;
}

describe('local API lifecycle',()=>{
 it('reports local dependencies and key presence without revealing credentials',async()=>{
  const url=await app({healthCheck:async()=>({...ready,dependencies:{chat:true,analysis:false,collector:true},issues:['Analysis dependency missing.']})},{OPENAI_API_KEY:'private-test-value',OPENAI_CHAT_MODEL:'configured-chat',AI_CONFIGURATION_SOURCE:'repository .env'});
  const response=await fetch(url+'/api/health');const text=await response.text();const status=JSON.parse(text);
  expect(status).toMatchObject({keyConfigured:true,pythonReady:true,ai:false,chat:true,collector:true,chatModel:'configured-chat',liveVerified:false,configurationSource:'repository .env'});
  expect(text).not.toContain('private-test-value');expect(response.headers.get('cache-control')).toBe('no-store');
 });
 it('keeps collection ready without an API key and gives a clear chat error',async()=>{
  const url=await app({},{});expect(await (await fetch(url+'/api/capabilities')).json()).toMatchObject({chat:false,ai:false,collector:true,keyConfigured:false});
  const response=await post(url,'/api/chat',{question:'What evidence?'});expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'missing_key'});
 });
 it('rejects null, arrays, invalid JSON, invalid method and oversized requests',async()=>{
  const url=await app();
  for(const input of [null,[],{}, {records:[]}])expect((await post(url,'/api/analyze',input)).status).toBe(400);
  expect((await fetch(url+'/api/chat',{method:'POST',body:'{'})).status).toBe(400);
  expect((await fetch(url+'/api/chat')).status).toBe(405);
  expect((await post(url,'/api/chat',{question:'a',padding:'a'.repeat(1_000_000)})).status).toBe(413);
 });
 it('rejects foreign origins and hostnames',async()=>{
  const url=await app();
  expect((await fetch(url+'/api/health',{headers:{Origin:'https://example.org'}})).status).toBe(403);
  const spoofedStatus=await new Promise<number>((done,reject)=>{const request=httpRequest(url+'/api/health',{headers:{Host:'example.org'}},response=>{response.resume();done(response.statusCode??0);});request.on('error',reject);request.end();});
  expect(spoofedStatus).toBe(403);
 });
 it('decodes split Unicode output and forces UTF-8 on the Python bridge',async()=>{
  const spawnMock=bridgeSpawn(bridge=>{const bytes=Buffer.from(JSON.stringify({answer:'Größe, 中国, café 🚗',citations:[],uncertainty:''}));for(let i=0;i<bytes.length;i++)bridge.stdout.write(bytes.subarray(i,i+1));bridge.emit('close',0);});
  const url=await app({spawnProcess:spawnMock});const response=await post(url,'/api/chat',{question:'中国'});
  expect(response.status).toBe(200);expect((await response.json()).answer).toBe('Größe, 中国, café 🚗');
  expect(vi.mocked(spawnMock).mock.calls[0][2]).toMatchObject({windowsHide:true,env:{PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1'}});
 });
 it('prevents overlapping analysis and releases the lock after completion',async()=>{
  let first:Bridge|undefined;const spawnMock=bridgeSpawn((bridge,_script,index)=>{if(index===0)first=bridge;else bridge.finish({findings:[]});});
  const url=await app({spawnProcess:spawnMock});const pending=post(url,'/api/analyze',{records:[{}]});
  await vi.waitFor(()=>expect(first).toBeDefined());expect((await post(url,'/api/analyze',{records:[{}]})).status).toBe(409);
  first!.finish({findings:[]});expect((await pending).status).toBe(200);expect((await post(url,'/api/analyze',{records:[{}]})).status).toBe(200);
 });
 it('kills timed-out bridges and permits the next analysis',async()=>{
  let stalled:Bridge|undefined;const spawnMock=bridgeSpawn((bridge,_script,index)=>{if(index===0)stalled=bridge;else bridge.finish({findings:[]});});
  const url=await app({spawnProcess:spawnMock,timeouts:{'/api/analyze':30}});
  expect((await post(url,'/api/analyze',{records:[{}]})).status).toBe(504);expect(stalled!.kill).toHaveBeenCalledWith('SIGKILL');expect((await post(url,'/api/analyze',{records:[{}]})).status).toBe(200);
 });
 it('kills a bridge when the browser disconnects and releases analysis',async()=>{
  let stalled:Bridge|undefined;const spawnMock=bridgeSpawn((bridge,_script,index)=>{if(index===0)stalled=bridge;else bridge.finish({findings:[]});});
  const url=await app({spawnProcess:spawnMock});const request=httpRequest(url+'/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'}});request.on('error',()=>{});request.end(JSON.stringify({records:[{}]}));
  await vi.waitFor(()=>expect(stalled).toBeDefined());request.destroy();await vi.waitFor(()=>expect(stalled!.kill).toHaveBeenCalled());expect((await post(url,'/api/analyze',{records:[{}]})).status).toBe(200);
 });
 it('releases analysis after spawn failure and safely forwards provider error codes',async()=>{
  const spawnMock=bridgeSpawn((bridge,_script,index)=>{if(index===0)bridge.emit('error',new Error('secret diagnostic'));else bridge.finish({error:'Check your API credits.',status:429,code:'provider_limit'},1);});
  const url=await app({spawnProcess:spawnMock});expect((await post(url,'/api/analyze',{records:[{}]})).status).toBe(503);
  const response=await post(url,'/api/analyze',{records:[{}]});expect(response.status).toBe(429);expect(await response.json()).toMatchObject({code:'provider_limit'});
 });
 it('does not advertise unavailable dependencies as working',async()=>{
  const url=await app({healthCheck:async()=>({pythonReady:false,dependencies:{chat:false,analysis:false,collector:false},issues:['Python unavailable.']})});
  expect(await (await fetch(url+'/api/health')).json()).toMatchObject({ai:false,chat:false,collector:false,pythonReady:false});expect((await post(url,'/api/collect',{})).status).toBe(503);
 });
});

describe('server configuration',()=>{
 function fixture(){const folder=mkdtempSync(join(tmpdir(),'insightpilot-env-'));tempFolders.push(folder);const project=join(folder,'final-product');mkdirSync(project);return {folder,project};}
 it('uses repository server settings while excluding browser and unrelated secrets',()=>{
  const {folder,project}=fixture();writeFileSync(join(folder,'.env'),'OPENAI_API_KEY=repository-test\nOPENAI_MODEL=parent-model\nVITE_SECRET=never\nDATABASE_PASSWORD=never\n');
  const env=loadServerEnvironment('test',project,{});expect(env).toEqual({OPENAI_API_KEY:'repository-test',OPENAI_MODEL:'parent-model',AI_CONFIGURATION_SOURCE:'repository .env'});
 });
 it('honors explicit project settings including an empty key',()=>{
  const {folder,project}=fixture();writeFileSync(join(folder,'.env'),'OPENAI_API_KEY=repository-test\nOPENAI_MODEL=parent-model\n');writeFileSync(join(project,'.env'),'OPENAI_API_KEY=\nOPENAI_MODEL=project-model\n');
  expect(loadServerEnvironment('test',project,{})).toMatchObject({OPENAI_API_KEY:'',OPENAI_MODEL:'project-model',AI_CONFIGURATION_SOURCE:'not configured'});
 });
 it('gives runtime environment settings priority',()=>{
  const {folder,project}=fixture();writeFileSync(join(folder,'.env'),'OPENAI_API_KEY=repository-test\n');writeFileSync(join(project,'.env'),'OPENAI_API_KEY=project-test\n');
  expect(loadServerEnvironment('test',project,{OPENAI_API_KEY:'runtime-test'})).toMatchObject({OPENAI_API_KEY:'runtime-test',AI_CONFIGURATION_SOURCE:'environment'});
 });
 it('finds a parent Windows virtual environment and respects custom Python',()=>{
  const {folder,project}=fixture();mkdirSync(join(folder,'.venv','Scripts'),{recursive:true});writeFileSync(join(folder,'.venv','Scripts','python.exe'),'');
  expect(resolvePython({},project,'win32')).toBe(resolve(folder,'.venv/Scripts/python.exe'));expect(resolvePython({PYTHON_BIN:'custom-python'},project,'win32')).toBe('custom-python');
 });
});
