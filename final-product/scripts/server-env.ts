import {loadEnv} from 'vite';
import {resolve} from 'node:path';

// Parent repository files supply server settings only. VITE_* values stay project-local.
const keys=['OPENAI_API_KEY','OPENAI_MODEL','OPENAI_CHAT_MODEL','OPENAI_BASE_URL','OPENAI_ORG_ID','OPENAI_PROJECT_ID','AI_EXTRACT_WORKERS','PYTHON_BIN'];
const serverOnly=(input:Record<string,string|undefined>)=>Object.fromEntries(keys.flatMap(key=>input[key]!==undefined?[[key,input[key] as string]]:[]));
export function loadServerEnvironment(mode:string,root:string,inherited:Record<string,string|undefined>=process.env):Record<string,string> {
 const parent=serverOnly(loadEnv(mode,resolve(root,'..'),''));
 const project=serverOnly(loadEnv(mode,root,''));
 const runtime=serverOnly(inherited);
 const environment={...parent,...project,...runtime};
 environment.AI_CONFIGURATION_SOURCE=runtime.OPENAI_API_KEY?.trim()?'environment':project.OPENAI_API_KEY?.trim()?'project .env':environment.OPENAI_API_KEY?.trim()?'repository .env':'not configured';
 return environment;
}
