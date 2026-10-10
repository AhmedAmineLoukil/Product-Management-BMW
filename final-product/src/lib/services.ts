import {z} from 'zod';

const serviceSchema=z.object({
 ai:z.boolean(),chat:z.boolean(),collector:z.boolean(),
 keyConfigured:z.boolean(),pythonReady:z.boolean(),
 issues:z.array(z.string()),model:z.string(),chatModel:z.string(),
 configurationSource:z.string(),
 dependencies:z.object({chat:z.boolean(),analysis:z.boolean(),collector:z.boolean()}),
 status:z.enum(['ready','degraded']),limit:z.number(),liveVerified:z.boolean(),
});
export type ServiceStatus=z.infer<typeof serviceSchema>;

export async function checkServices(signal?:AbortSignal):Promise<ServiceStatus>{
 const response=await fetch('/api/health',{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10_000)]):AbortSignal.timeout(10_000),cache:'no-store'});
 if(!response.ok)throw new Error('The local services could not be checked. Start the app with start-final.ps1.');
 const result=serviceSchema.safeParse(await response.json());
 if(!result.success)throw new Error('The local server needs a restart to load the latest service checks.');
 return result.data;
}
