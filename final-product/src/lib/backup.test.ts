import {describe,it,expect} from 'vitest';
import {createSeed} from '../data/seed';
import {applyCommand} from './workspace';
import {backupSummary,csvCell,parseWorkspaceBackup,requirementPortfolioCsv,validateWorkspaceBackup} from './backup';

describe('Workspace backup integrity',()=>{
  it('restores an exported seed without losing provenance, history or audit records',()=>{
    const state=createSeed();
    expect(parseWorkspaceBackup(JSON.stringify(state))).toEqual(state);
    expect(backupSummary(state)).toMatchObject({projects:3,datasets:4,records:31,findings:10,requirements:8,revision:0,modelVersion:1});
    expect(parseWorkspaceBackup('\uFEFF'+JSON.stringify(state))).toEqual(state);
  });
  it('restores edited and rescored workspaces with historical model snapshots',()=>{
    const edited=applyCommand(createSeed(),{type:'decision',id:'REQ-002',status:'Approved',reason:'Review complete.'});
    const state=applyCommand(edited,{type:'model',model:{...edited.model,weights:{impact:20,frequency:20,strategy:20,evidence:30,feasibility:10}},reason:'Increase emphasis on evidence.'});
    expect(parseWorkspaceBackup(JSON.stringify(state))).toEqual(JSON.parse(JSON.stringify(state)));
  });
  it('round trips a completed demo analysis with source and run attribution',()=>{
    const state=applyCommand(createSeed(),{type:'analysis',projectId:'project-ix1-de',datasetIds:['ds-verbatims']});
    expect(parseWorkspaceBackup(JSON.stringify(state)).runs.at(-1)?.findingIds.length).toBeGreaterThan(0);
  });
  it('rejects malformed JSON, missing collections, unsupported schemas and invalid revisions',()=>{
    expect(()=>parseWorkspaceBackup('{')).toThrow('not valid JSON');
    expect(()=>validateWorkspaceBackup({...createSeed(),datasets:undefined})).toThrow('datasets');
    expect(()=>validateWorkspaceBackup({...createSeed(),schemaVersion:2})).toThrow('schemaVersion');
    for(const revision of [-1,0.5,Number.POSITIVE_INFINITY,Number.MAX_SAFE_INTEGER+1]) expect(()=>validateWorkspaceBackup({...createSeed(),revision})).toThrow('revision');
  });
  it('rejects duplicate IDs and source records assigned to the wrong dataset',()=>{
    const duplicate=createSeed();duplicate.projects.push({...duplicate.projects[0]});
    expect(()=>validateWorkspaceBackup(duplicate)).toThrow('duplicate ID');
    const wrong=createSeed();wrong.datasets[0].records[0].datasetId=wrong.datasets[1].id;
    expect(()=>validateWorkspaceBackup(wrong)).toThrow('another dataset');
  });
  it('rejects cross-project references in findings, requirements, requests and runs',()=>{
    const finding=createSeed();finding.findings[0].projectId='project-ix1-uk';
    expect(()=>validateWorkspaceBackup(finding)).toThrow('cross-project');
    const requirement=createSeed();requirement.requirements[0].projectId='project-ix1-uk';
    expect(()=>validateWorkspaceBackup(requirement)).toThrow('cross-project');
    const request=createSeed();request.requests[0].projectId='project-ix1-uk';
    expect(()=>validateWorkspaceBackup(request)).toThrow('cross-project');
    const run=createSeed();run.runs[0].projectId='project-ix1-uk';
    expect(()=>validateWorkspaceBackup(run)).toThrow('cross-project');
  });
  it('rejects fabricated audit and historical finding references',()=>{
    const audit=createSeed();audit.audit[0].relatedIds=['FABRICATED'];
    expect(()=>validateWorkspaceBackup(audit)).toThrow('unknown record');
    const history=createSeed();history.requirements[0].history[0].findings=['FABRICATED'];
    expect(()=>validateWorkspaceBackup(history)).toThrow('unknown Finding');
  });
  it('rejects invalid scores, scoring models, versions and undocumented overrides',()=>{
    const score=createSeed();score.requirements[0].scores.impact=6;
    expect(()=>validateWorkspaceBackup(score)).toThrow('scores.impact');
    const model=createSeed();model.model.weights.impact=31;
    expect(()=>validateWorkspaceBackup(model)).toThrow('Weights must total');
    const threshold=createSeed();threshold.model.thresholds.p2=80;
    expect(()=>validateWorkspaceBackup(threshold)).toThrow('Thresholds');
    const version=createSeed();version.requirements[0].version=3;
    expect(()=>validateWorkspaceBackup(version)).toThrow('incomplete version history');
    const snapshot=createSeed();snapshot.requirements[0].history[0].modelVersion=2;
    expect(()=>validateWorkspaceBackup(snapshot)).toThrow('historical version');
    const override=createSeed();override.requirements[0].priorityOverride='P1';
    expect(()=>validateWorkspaceBackup(override)).toThrow('undocumented priority');
  });
  it('does not mutate the current workspace when backup validation fails',()=>{
    const state=createSeed(),before=JSON.stringify(state);
    expect(()=>validateWorkspaceBackup({...state,revision:-1})).toThrow();
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('Requirement portfolio CSV',()=>{
  it('exports useful scores, source references and unknown values for the selected project',()=>{
    const state=createSeed(),csv=requirementPortfolioCsv(state,'project-ix1-de');
    expect(csv.startsWith('\uFEFF"Requirement ID"')).toBe(true);
    expect(csv).toContain('"REQ-001"');expect(csv).toContain('"90"');
    expect(csv).toContain('"VOC-001; VOC-002; VOC-003; STU-001; VOC-018"');
    expect(csv).toContain('"Unknown"');expect(csv).toContain('"Unscored"');
    expect(requirementPortfolioCsv(state,'project-ix1-uk').trim().split('\r\n')).toHaveLength(1);
  });
  it('preserves quotes, commas and line breaks while neutralizing spreadsheet formulas',()=>{
    expect(csvCell('Say "yes", please\nnext line')).toBe('"Say ""yes"", please\nnext line"');
    for(const value of ['=HYPERLINK("http://example.test")','+SUM(A1:A2)','-1+2','@SUM(A1:A2)','  =1+1','\t=1+1','\r=1+1','\n=1+1']) expect(csvCell(value).startsWith('"\'')).toBe(true);
    const state=createSeed();state.requirements[0].title='=1+1';
    expect(requirementPortfolioCsv(state)).toContain('"\'=1+1"');
    expect(csvCell(90)).toBe('"90"');expect(csvCell(null)).toBe('""');
  });
});
