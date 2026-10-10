import {useEffect,useRef,useState} from 'react';
import type {ChangeEvent} from 'react';
import {Check,Download,Info,LockKeyhole,Plus,RefreshCw,Save,Server,ShieldCheck,Upload} from 'lucide-react';
import {useApp} from '../context';
import {dimensions,dimensionLabels} from '../types';
import type {Workspace} from '../types';
import {Badge,PageHeading,Panel,TextField} from '../components/common';
import {Button} from '../components/ui/button';
import {Modal} from '../components/ui/dialog';
import {uid} from '../lib/workspace';
import {validateModel} from '../lib/scoring';
import {download} from '../lib/utils';
import {supabase} from '../lib/storage';
import {backupSummary,MAX_BACKUP_BYTES,parseWorkspaceBackup,requirementPortfolioCsv} from '../lib/backup';

export default function Settings(){
  const {state,project,run,setProject,notify,cloud,aiAvailable,chatAvailable,busy,services,refreshServices,serviceChecking,restoreWorkspace}=useApp();
  const [model,setModel]=useState(structuredClone(state.model));
  const [reason,setReason]=useState(''),[newProject,setNewProject]=useState(false);
  const [name,setName]=useState(''),[derivative,setDerivative]=useState(''),[market,setMarket]=useState(''),[horizon,setHorizon]=useState('2026–2028');
  const [email,setEmail]=useState(''),[password,setPassword]=useState('');
  const [pendingRestore,setPendingRestore]=useState<{name:string;workspace:Workspace}|null>(null);
  const [restoreConfirmed,setRestoreConfirmed]=useState(false),[readingBackup,setReadingBackup]=useState(false);
  const backupInput=useRef<HTMLInputElement>(null);
  const backupRead=useRef(0);
  useEffect(()=>setModel(structuredClone(state.model)),[state.model]);
  useEffect(()=>()=>{backupRead.current++;},[]);
  const total=dimensions.reduce((sum,dimension)=>sum+model.weights[dimension],0);
  const modelError=validateModel(model);
  const exportBackup=()=>download('insightpilot-workspace.json',JSON.stringify(state,null,2));
  const inspectBackup=async(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0];event.target.value='';
    if(!file)return;
    const readId=++backupRead.current;
    setPendingRestore(null);setRestoreConfirmed(false);setReadingBackup(true);
    try{
      if(cloud)throw new Error('Workspace restore is available only for local browser workspaces.');
      if(file.size>MAX_BACKUP_BYTES)throw new Error('Workspace backups must be smaller than 50 MB.');
      const workspace=parseWorkspaceBackup(await file.text());
      if(readId===backupRead.current){setPendingRestore({name:file.name,workspace});notify('Backup validated. Review the preview before replacing your workspace.');}
    }catch(error){if(readId===backupRead.current)notify((error as Error).message,true);}
    finally{if(readId===backupRead.current)setReadingBackup(false);}
  };
  const closeRestore=()=>{if(!busy){setPendingRestore(null);setRestoreConfirmed(false);}};
  const restoreSummary=pendingRestore?backupSummary(pendingRestore.workspace):null;
  return <>
    <PageHeading eyebrow="BUILT AROUND YOUR CONTEXT" title="Settings" description="Configure your project, scoring assumptions and connected services."/>
    <div className="settings-grid">
      <div>
        <Panel title="Vehicle projects" subtitle="Each vehicle and market has its own evidence and requirements" action={<Button size="sm" variant="outline" disabled={busy} onClick={()=>setNewProject(true)}><Plus size={14}/>New project</Button>}>
          <div className="project-list">{state.projects.map(item=><button key={item.id} className={item.id===project.id?'selected':''} onClick={()=>setProject(item.id)}><span className="project-avatar">{item.derivative.replace('BMW ','')}</span><div><strong>{item.name}</strong><p>{item.derivative} · {item.market} · {item.horizon}</p></div>{item.id===project.id?<Badge tone="green">Active</Badge>:<span className="small muted">Switch →</span>}</button>)}</div>
        </Panel>
        <Panel title="Scoring model" subtitle={`Current model v${state.model.version} · Demonstration configuration, not a BMW standard`}>
          <form className="form-stack" onSubmit={async event=>{event.preventDefault();if(await run({type:'model',model,reason}))setReason('');}}>
            {dimensions.map(dimension=><label key={dimension} className="weight-row"><span>{dimensionLabels[dimension]}</span><div className="weight-track"><span style={{width:`${model.weights[dimension]}%`}}/></div><div><input aria-label={`${dimensionLabels[dimension]} weight`} type="number" min={0} max={100} value={model.weights[dimension]} onChange={event=>setModel({...model,weights:{...model.weights,[dimension]:Number(event.target.value)}})}/><span>%</span></div></label>)}
            <div className={`weights-total ${Math.abs(total-100)<=0.01?'text-green':'text-amber'}`}><span>Total weight</span><strong>{total}% {Math.abs(total-100)<=0.01&&<Check size={14}/>}</strong></div>
            <div className="threshold-grid">
              <label className="field"><span>P1 minimum score</span><input aria-label="P1 threshold" type="number" min={1} max={100} value={model.thresholds.p1} onChange={event=>setModel({...model,thresholds:{...model.thresholds,p1:Number(event.target.value)}})}/></label>
              <label className="field"><span>P2 minimum score</span><input aria-label="P2 threshold" type="number" min={1} max={99} value={model.thresholds.p2} onChange={event=>setModel({...model,thresholds:{...model.thresholds,p2:Number(event.target.value)}})}/></label>
            </div>
            <TextField label="Reason for model change" value={reason} onChange={setReason} required multiline placeholder="Explain how these weights reflect the planning context…"/>
            {modelError&&<p className="text-amber small">{modelError}</p>}
            <div className="notice notice-blue"><Info size={16}/><p>Saving creates a new scoring model version and preserves the previous assessment for every requirement.</p></div>
            <div className="form-actions"><Button type="submit" disabled={!!modelError||!reason.trim()||busy}><Save size={14}/>Save scoring model</Button></div>
          </form>
        </Panel>
      </div>
      <div>
        <Panel title="Workspace connection">
          <div className="connection-status"><span className="source-icon"><Server size={23}/></span><div><strong>{cloud?'Supabase cloud workspace':'Local browser workspace'}</strong><p>{cloud?'Authenticated · PostgreSQL persistence':'Persistent storage in this browser'}</p></div><Badge tone={cloud?'green':'blue'}>{cloud?'Connected':'Local'}</Badge></div>
          <p className="prose">{cloud?'Workspace commands are authorized server-side. Audit records are protected by database permissions.':'Records are stored locally and survive reloads. Use workspace backups to move your work between browsers, or a configured Supabase backend for protected shared workflows.'}</p>
          {supabase&&!cloud&&<form className="form-stack" onSubmit={async event=>{event.preventDefault();try{const {error}=await supabase!.auth.signInWithPassword({email,password});if(error)throw error;location.reload();}catch(error){notify((error as Error).message,true);}}}>
            <label className="field"><span>Work email *</span><input aria-label="Work email" type="email" required autoComplete="username" value={email} onChange={event=>setEmail(event.target.value)}/></label>
            <label className="field"><span>Password *</span><input aria-label="Password" type="password" required autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)}/></label>
            <Button disabled={busy}><LockKeyhole size={14}/>Sign in to Supabase</Button>
          </form>}
          {cloud&&<Button variant="outline" disabled={busy} onClick={async()=>{const result=await supabase?.auth.signOut();if(result?.error)notify(result.error.message,true);else location.reload();}}>Sign out</Button>}
        </Panel>
        <Panel title="AI & research integrations" action={<Button size="sm" variant="outline" disabled={serviceChecking} onClick={()=>void refreshServices()}><RefreshCw size={14}/>{serviceChecking?'Checking…':'Refresh status'}</Button>}>
          <div className="integration-row"><div><strong>Demo analysis</strong><p>Deterministic source grouping</p></div><Badge tone="blue">Available</Badge></div>
          <div className="integration-row"><div><strong>Live AI analysis</strong><p>{cloud?'Supabase server functions':services?.pythonReady?'Local Python service':services?'Local Python service needs setup':'Local service connection not detected'}</p></div><Badge tone={aiAvailable?'green':'neutral'}>{aiAvailable?'Available':'Setup required'}</Badge></div>
          <div className="integration-row"><div><strong>Assistant chat</strong><p>{chatAvailable?'Server-side AI with workspace context':'Workspace assistant is available with local answers'}</p></div><Badge tone={chatAvailable?'green':'blue'}>{chatAvailable?'Live AI':'Local answers'}</Badge></div>
          <div className="integration-row"><div><strong>Live web research</strong><p>{services?.collector?'Public-source collection service is ready':'Check the local research service configuration'}</p></div><Badge tone={services?.collector?'green':'neutral'}>{services?.collector?'Available':'Setup required'}</Badge></div>
          {services?.model&&<p className="small muted">Analysis model: {services.model}</p>}
          {services?.chatModel&&<p className="small muted">Chat model: {services.chatModel}</p>}
          {!!services?.issues?.length&&<div className="notice notice-amber"><Info size={16}/><div>{services.issues.map((issue,index)=><p key={`${index}-${issue}`}>{issue}</p>)}</div></div>}
          <p className="small muted">API keys remain in server-side configuration. Refresh status after updating configuration or restarting the service.</p>
        </Panel>
        <Panel title="Data portability">
          <p className="prose">Back up the complete workspace, including source records, version history, scoring configuration and audit events. Export the active project's requirements as a spreadsheet-ready CSV.</p>
          <div className="form-stack">
            <Button variant="outline" className="full-width" onClick={exportBackup}><Download size={14}/>Export workspace</Button>
            <Button variant="outline" className="full-width" onClick={()=>download('insightpilot-requirements.csv',requirementPortfolioCsv(state,project.id),'text/csv;charset=utf-8')}><Download size={14}/>Export requirements CSV</Button>
            <input ref={backupInput} type="file" accept=".json,application/json" aria-label="Workspace backup file" style={{display:'none'}} onChange={event=>void inspectBackup(event)}/>
            <Button variant="outline" className="full-width" disabled={cloud||busy||readingBackup} onClick={()=>backupInput.current?.click()}><Upload size={14}/>{readingBackup?'Validating backup…':'Restore workspace backup'}</Button>
            <p className="small muted">{cloud?'Local backup replacement is disabled for cloud workspaces.':'Restore validates the full backup and shows a preview before replacing the workspace in this browser.'}</p>
          </div>
        </Panel>
        <div className="notice notice-blue"><ShieldCheck size={20}/><p>Seeded customer feedback, findings and decisions are synthetic. Inspect imported sources and review AI proposals before making product decisions.</p></div>
      </div>
    </div>
    {newProject&&<Modal open onClose={()=>setNewProject(false)} title="Create vehicle project" description="Start an empty workspace for a specific derivative and market.">
      <form className="form-stack" onSubmit={async event=>{event.preventDefault();const projectId=uid('PROJECT');if(await run({type:'project',project:{id:projectId,name,derivative,market,horizon}})){setProject(projectId);setNewProject(false);}}}>
        <TextField label="Project name" value={name} onChange={setName} required/>
        <TextField label="Vehicle derivative" value={derivative} onChange={setDerivative} required placeholder="e.g. BMW 1 Series F70"/>
        <TextField label="Target market" value={market} onChange={setMarket} required placeholder="e.g. Europe"/>
        <TextField label="Planning horizon" value={horizon} onChange={setHorizon} required/>
        <div className="form-actions"><Button type="button" variant="outline" onClick={()=>setNewProject(false)}>Cancel</Button><Button disabled={busy}>Create project</Button></div>
      </form>
    </Modal>}
    {pendingRestore&&restoreSummary&&<Modal open onClose={closeRestore} title="Restore workspace backup" description={`Validated backup: ${pendingRestore.name}`}>
      <div className="form-stack">
        <div className="notice notice-blue"><Check size={18}/><p>Structure, scoring configuration, version history and references passed validation.</p></div>
        <div className="source-fields">{[
          ['Projects',restoreSummary.projects],['Datasets',restoreSummary.datasets],['Source records',restoreSummary.records],['Findings',restoreSummary.findings],['Requirements',restoreSummary.requirements],['Audit events',restoreSummary.audit],['Workspace revision',restoreSummary.revision],['Scoring model',`v${restoreSummary.modelVersion}`],
        ].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
        <p className="prose">Projects: {pendingRestore.workspace.projects.map(item=>`${item.derivative} · ${item.market}`).join('; ')}</p>
        <div className="notice notice-amber"><Info size={18}/><p>Restoring replaces all projects and records in this local browser workspace. Download your current workspace first if you want to keep a copy.</p></div>
        <Button variant="outline" onClick={exportBackup}><Download size={14}/>Download current workspace backup</Button>
        <label className="small" style={{display:'flex',alignItems:'flex-start',gap:10}}><input type="checkbox" checked={restoreConfirmed} disabled={busy||cloud} onChange={event=>setRestoreConfirmed(event.target.checked)} style={{width:16,height:16,marginTop:2,flexShrink:0}}/><span>I understand that this replaces the current local workspace.</span></label>
        <div className="form-actions"><Button variant="outline" disabled={busy} onClick={closeRestore}>Cancel</Button><Button disabled={!restoreConfirmed||busy||cloud} onClick={async()=>{if(!restoreConfirmed||cloud)return;if(await restoreWorkspace(pendingRestore.workspace)){setPendingRestore(null);setRestoreConfirmed(false);}}}><Upload size={14}/>{busy?'Restoring…':'Replace local workspace'}</Button></div>
      </div>
    </Modal>}
  </>;
}
