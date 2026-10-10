import {chromium,expect} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import * as XLSX from 'xlsx';

const baseUrl=process.env.BASE_URL??'http://127.0.0.1:5173';
const workspaceKey='insightpilot.workspace.v1';
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
const page=await context.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const tests=[];
const record=name=>{tests.push(name);console.log('PASS',name);};
let serviceReady=false,serviceRequests=0;
const serviceStatus=()=>({ai:serviceReady,chat:serviceReady,collector:serviceReady,keyConfigured:serviceReady,pythonReady:true,issues:serviceReady?[]:['Synthetic test: local AI configuration needs setup.'],model:'test-analysis-model',chatModel:'test-chat-model',configurationSource:'Synthetic test environment',dependencies:{chat:true,analysis:true,collector:true},status:serviceReady?'ready':'degraded',limit:50,liveVerified:false});
await context.route('**/api/health',async route=>{serviceRequests++;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(serviceStatus())});});
const upload=async(value,name='workspace.json')=>page.getByLabel('Workspace backup file').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(typeof value==='string'?value:JSON.stringify(value))});
const downloadText=async(button)=>{
  const downloadPromise=page.waitForEvent('download');
  await button.click();const result=await downloadPromise;
  return {name:result.suggestedFilename(),text:await readFile(await result.path(),'utf8')};
};
const savedState=()=>page.evaluate(key=>localStorage.getItem(key),workspaceKey);
let recoveryContext,delayedContext,releaseHealth;
try{
  await page.goto(baseUrl+'/#settings',{waitUntil:'domcontentloaded'});
  await expect(page.locator('h1')).toHaveText('Settings');
  const initial=await downloadText(page.getByRole('button',{name:'Export workspace',exact:true}));
  expect(initial.name).toBe('insightpilot-workspace.json');
  const original=JSON.parse(initial.text);expect(original.projects).toHaveLength(3);expect(original.requirements).toHaveLength(8);
  record('Full workspace JSON download includes projects, requirements and history');

  const initialCsv=await downloadText(page.getByRole('button',{name:'Export requirements CSV',exact:true}));
  expect(initialCsv.name).toBe('insightpilot-requirements.csv');
  const csvRows=XLSX.utils.sheet_to_json(XLSX.read(initialCsv.text,{type:'string'}).Sheets.Sheet1,{header:1,raw:false});
  expect(csvRows).toHaveLength(9);expect(csvRows[0]).toContain('Weighted score');
  expect(csvRows[1]).toContain('REQ-001');expect(csvRows[1]).toContain('90');expect(csvRows[7]).toContain('Unknown');
  record('Requirement CSV download includes scoped scores, provenance and unknown values');

  await expect(page.getByText('Synthetic test: local AI configuration needs setup.')).toBeVisible();
  serviceReady=true;const requestsBefore=serviceRequests;
  await page.getByRole('button',{name:'Refresh status',exact:true}).click();
  await expect(page.getByText('Public-source collection service is ready')).toBeVisible();
  await expect(page.getByText('Server-side AI with workspace context')).toBeVisible();
  expect(serviceRequests).toBeGreaterThan(requestsBefore);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'artifacts/settings-desktop.png',fullPage:true,animations:'disabled'});
  record('Service refresh updates live chat, research and analysis readiness');

  const unchangedStorage=await savedState();
  await upload('{ invalid json','invalid.json');
  await expect(page.getByRole('alert')).toContainText('not valid JSON');
  expect(await savedState()).toBe(unchangedStorage);await expect(page.getByRole('dialog')).toHaveCount(0);
  const crossProject=structuredClone(original);crossProject.requirements[0].projectId=original.projects[1].id;
  await upload(crossProject,'cross-project.json');
  await expect(page.getByRole('alert')).toContainText('cross-project');
  expect(await savedState()).toBe(unchangedStorage);await expect(page.getByRole('dialog')).toHaveCount(0);
  record('Invalid JSON and cross-project references preserve the current workspace');

  const restored=structuredClone(original);restored.projects[0].name='Restored browser test project';restored.requirements[0].title='Verified backup restore requirement';
  await upload(restored,'valid-workspace.json');
  let dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('Validated backup: valid-workspace.json');
  await expect(dialog).toContainText('Audit events');
  await expect(dialog.getByRole('button',{name:'Replace local workspace',exact:true})).toBeDisabled();
  await page.screenshot({path:'artifacts/backup-preview.png',fullPage:true,animations:'disabled'});
  expect(await savedState()).toBe(unchangedStorage);
  const currentBackup=await downloadText(dialog.getByRole('button',{name:'Download current workspace backup',exact:true}));
  expect(JSON.parse(currentBackup.text)).toEqual(original);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  expect(await savedState()).toBe(unchangedStorage);
  record('Restore preview offers a current backup and cancellation leaves data intact');

  await upload(restored,'valid-workspace.json');dialog=page.getByRole('dialog');
  await dialog.getByRole('checkbox',{name:'I understand that this replaces the current local workspace.'}).check();
  await expect(dialog.getByRole('button',{name:'Replace local workspace',exact:true})).toBeEnabled();
  await dialog.getByRole('button',{name:'Replace local workspace',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Restored browser test project',{exact:true})).toBeVisible();
  expect(JSON.parse(await savedState())).toEqual(restored);
  await page.reload({waitUntil:'domcontentloaded'});await expect(page.locator('h1')).toHaveText('Settings');
  expect(JSON.parse((await downloadText(page.getByRole('button',{name:'Export workspace',exact:true}))).text)).toEqual(restored);
  record('Explicitly confirmed backup restore persists and round trips after reload');

  await page.locator('.context-switcher').click();
  await page.locator('.project-popover').getByRole('button',{name:/BMW iX1.*United Kingdom/}).click();
  const emptyCsv=await downloadText(page.getByRole('button',{name:'Export requirements CSV',exact:true}));
  const emptyRows=XLSX.utils.sheet_to_json(XLSX.read(emptyCsv.text,{type:'string'}).Sheets.Sheet1,{header:1,raw:false});
  expect(emptyRows).toHaveLength(1);record('CSV export respects the selected vehicle and market project');

  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'artifacts/settings-mobile.png',fullPage:true,animations:'disabled'});
  await upload(restored,'mobile-preview.json');
  await expect(page.getByRole('dialog').getByRole('button',{name:'Replace local workspace',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  await page.setViewportSize({width:1440,height:1100});
  record('Mobile Settings and backup confirmation fit the viewport');

  delayedContext=await browser.newContext();
  const delayed=await delayedContext.newPage();delayed.on('pageerror',error=>errors.push(error.message));
  let healthRequested=false;
  const healthGate=new Promise(resolve=>{releaseHealth=resolve;});
  await delayedContext.route('**/api/health',async route=>{healthRequested=true;await healthGate;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(serviceStatus())});});
  await delayed.goto(baseUrl+'/#settings',{waitUntil:'domcontentloaded'});
  await expect(delayed.locator('h1')).toHaveText('Settings');await expect.poll(()=>healthRequested).toBe(true);
  await delayed.getByLabel('Workspace backup file').setInputFiles({name:'delayed-service-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(restored))});
  await delayed.getByRole('dialog').getByRole('checkbox',{name:'I understand that this replaces the current local workspace.'}).check();
  await delayed.getByRole('dialog').getByRole('button',{name:'Replace local workspace',exact:true}).click();
  await expect(delayed.getByText('Restored browser test project',{exact:true})).toBeVisible();
  releaseHealth();await expect(delayed.getByText('Public-source collection service is ready')).toBeVisible();
  await expect(delayed.getByText('Restored browser test project',{exact:true})).toBeVisible();
  expect(JSON.parse(await delayed.evaluate(key=>localStorage.getItem(key),workspaceKey))).toEqual(restored);
  record('Slow service initialization preserves a workspace restored during the health check');

  recoveryContext=await browser.newContext({acceptDownloads:true});
  const recovery=await recoveryContext.newPage();recovery.on('pageerror',error=>errors.push(error.message));
  const corrupted='{"schemaVersion":1,"requirements":[],"audit":[]}';
  await recoveryContext.addInitScript(({key,value})=>{if(!sessionStorage.getItem('features-test-initialized')){localStorage.setItem(key,value);sessionStorage.setItem('features-test-initialized','yes');}},{key:workspaceKey,value:corrupted});
  await recovery.goto(baseUrl,{waitUntil:'domcontentloaded'});
  await expect(recovery.getByRole('alert')).toContainText('Invalid workspace backup');
  const recoveryDownloadPromise=recovery.waitForEvent('download');
  await recovery.getByRole('button',{name:'Download saved data for recovery',exact:true}).click();
  const recoveryDownload=await recoveryDownloadPromise;
  expect(await readFile(await recoveryDownload.path(),'utf8')).toBe(corrupted);
  await expect(recovery.getByRole('button',{name:'Start a fresh local demo',exact:true})).toBeDisabled();
  expect(await recovery.evaluate(key=>localStorage.getItem(key),workspaceKey)).toBe(corrupted);
  await recovery.getByRole('checkbox',{name:'I saved my data and want to replace the local workspace with a fresh demo.'}).check();
  await recovery.getByRole('button',{name:'Start a fresh local demo',exact:true}).click();
  await expect(recovery.locator('h1')).toHaveText('Overview');
  expect(JSON.parse(await recovery.evaluate(key=>localStorage.getItem(key),workspaceKey)).requirements).toHaveLength(8);
  record('Malformed saved state supports original-data download and requires confirmation to reset');

  expect(errors).toEqual([]);record('Feature workflows produce no browser runtime errors');
  await writeFile('artifacts/features-browser-results.json',JSON.stringify({passed:tests.length,tests,errors},null,2));
  console.log(`\n${tests.length} feature browser scenarios passed.`);
}catch(error){
  console.error(error);await page.screenshot({path:'artifacts/features-e2e-failure.png',fullPage:true});
  await writeFile('artifacts/features-browser-results.json',JSON.stringify({passed:tests.length,tests,errors,failure:String(error)},null,2));process.exitCode=1;
}finally{releaseHealth?.();await delayedContext?.close();await recoveryContext?.close();await context.close();await browser.close();}
