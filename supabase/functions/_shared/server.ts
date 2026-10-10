import {createClient} from 'npm:@supabase/supabase-js@2';
import type {Workspace} from './types.ts';
export const cors={'Access-Control-Allow-Origin':Deno.env.get('APP_ORIGIN')??'http://localhost:5173','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
export const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
export async function authenticate(req:Request){
 if(req.method!=='POST')throw new Error('POST required.');
 const authorization=req.headers.get('Authorization');if(!authorization?.startsWith('Bearer '))throw new Error('Authentication required.');
 const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
 const {data:{user},error}=await client.auth.getUser();if(error||!user)throw new Error('Invalid session.');
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 const {data:member,error:memberError}=await admin.from('workspace_members').select('workspace_id,role').eq('user_id',user.id).order('created_at').limit(1).maybeSingle();
 if(memberError||!member)throw new Error('No workspace membership. Ask an administrator to provision your account.');
 const {data:row,error:rowError}=await admin.from('workspaces').select('snapshot,revision').eq('id',member.workspace_id).single();if(rowError)throw new Error('Workspace unavailable.');
 return {admin,user,member,workspace:row.snapshot as Workspace|null,revision:row.revision as number};
}
export async function commit(ctx:Awaited<ReturnType<typeof authenticate>>,next:Workspace,expected:number){const {error}=await ctx.admin.rpc('commit_workspace',{p_workspace:ctx.member.workspace_id,p_expected:expected,p_snapshot:next});if(error)throw new Error(error.message);return next;}
