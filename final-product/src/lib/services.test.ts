import {afterEach,describe,expect,it,vi} from 'vitest';
import {checkServices} from './services';

afterEach(()=>vi.unstubAllGlobals());
describe('local service checks',()=>{
 it('preserves independent chat, analysis and collector readiness',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({ai:false,chat:true,collector:false,keyConfigured:true,pythonReady:true,issues:['Collector dependency missing'],model:'analysis-model',chatModel:'chat-model',configurationSource:'repository .env',dependencies:{chat:true,analysis:false,collector:false},status:'degraded',limit:50,liveVerified:false}))));
  const result=await checkServices();expect(result.chat).toBe(true);expect(result.ai).toBe(false);expect(result.issues).toEqual(['Collector dependency missing']);
 });
 it('gives a restart instruction for the old server response',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({ai:false,chat:false,collector:true}))));
  await expect(checkServices()).rejects.toThrow('restart');
 });
 it('reports unavailable services instead of enabling live features',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('Unavailable',{status:503})));
  await expect(checkServices()).rejects.toThrow('start-final.ps1');
 });
});
