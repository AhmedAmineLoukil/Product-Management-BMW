import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';

const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5173';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],tests=[];
page.on('pageerror',error=>errors.push(error.message));
const health={ai:false,chat:false,collector:true,keyConfigured:false,pythonReady:true,issues:[],model:'test-model',chatModel:'test-chat',configurationSource:'test fixture',dependencies:{chat:true,analysis:true,collector:true},status:'degraded',limit:50,liveVerified:false};
await page.route('**/api/health',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(health)}));
const panel=()=>page.getByRole('region',{name:'InsightPilot assistant'});
const answer=()=>page.locator('.assistant-message.assistant').last();
const record=name=>{tests.push(name);console.log('PASS',name);};
const ask=async question=>{await panel().getByLabel('Ask the assistant',{exact:true}).fill(question);await panel().getByRole('button',{name:'Send question',exact:true}).click();await expect(answer()).toBeVisible();};
const reset=async()=>{await panel().getByRole('button',{name:'Reset conversation',exact:true}).click();await expect(page.locator('.assistant-message')).toHaveCount(0);};
const switchProject=async market=>{await page.locator('.context-switcher').click();await page.locator('.project-popover').getByRole('button',{name:new RegExp(`BMW iX1.*${market}`)}).click();};
let behavior='success',pendingRoutes=[],lastPayload,chatCalls=0;
const grounded={answer:'The stored synthetic record asks whether a charger on the route is available.',uncertainty:'Synthetic demonstration data.',citations:[{source_id:'VOC-004',quote:'I want to know whether a charger on my route is actually available.'}]};
const release=async()=>{const pending=pendingRoutes.splice(0);await Promise.all(pending.map(async item=>{try{await item.route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(grounded)});}catch{/* The canceled browser request may already be closed. */}item.resolve();}));};
try{
 await page.goto(base,{waitUntil:'domcontentloaded'});await expect(page.locator('h1')).toHaveText('Overview');
 await page.getByRole('button',{name:'Open assistant',exact:true}).click();
 await ask('What supports REQ-002?');await expect(answer()).toContainText('96 (P1)');await expect(answer()).toContainText('Offline guide');
 await answer().getByRole('button',{name:/VOC-004/}).click();await expect(page.getByRole('dialog').last()).toContainText('actually available');await page.getByRole('dialog').last().getByRole('button',{name:'Close dialog',exact:true}).click();record('Offline requirement answer with a clickable original citation');
 await reset();await ask('Which scores still need PM judgment?');await expect(answer()).toContainText('REQ-007');await expect(answer()).toContainText('Unknown or invalid ratings: Feasibility');record('Missing PM judgment answers the actual question');
 await reset();await ask('Show me an evidence gap');await expect(answer()).toContainText('TASK-001');record('Evidence gap exposes the actual open research request');
 await reset();await ask('Which requirements are approved?');await expect(answer()).toContainText('Approved: 1');await expect(answer()).toContainText('REQ-004');record('Project review status and decision list');
 await reset();await ask('Show VOC-020');await expect(answer()).toContainText('synthetic demonstration data');await expect(answer().locator('.assistant-citations button')).toHaveCount(1);record('Direct source lookup');
 await reset();await ask('Show VOC-999');await expect(answer()).toContainText('no matching source record');await expect(answer().locator('.assistant-citations button')).toHaveCount(0);record('Unknown record never produces a fabricated citation');
 await switchProject('United Kingdom');await expect(page.locator('.assistant-message')).toHaveCount(0);await ask('How do I import feedback?');await expect(answer()).toContainText('CSV or XLSX');record('Project change resets the conversation and empty projects still have guidance');
 await switchProject('Germany');await page.unroute('**/api/health');health.chat=true;health.keyConfigured=true;health.status='ready';
 await page.route('**/api/health',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(health)}));
 await page.route('**/api/chat',async route=>{
  chatCalls++;
  lastPayload=route.request().postDataJSON();
  if(behavior==='hold'){await new Promise(resolve=>pendingRoutes.push({route,resolve}));return;}
  if(behavior==='failure')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'service unavailable'})});
  if(behavior==='malformed')return route.fulfill({status:200,contentType:'text/html',body:'<html>Invalid response</html>'});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(behavior==='invalid'?{...grounded,citations:[{source_id:'VOC-004',quote:'fabricated'}]}:grounded)});
 });
 await ask('What supports REQ-002?');await expect(answer().locator('small')).toHaveText('AI');record('An already open assistant recovers when the chat backend becomes ready without reloading');chatCalls=0;
 await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Open assistant',exact:true}).click();await expect(panel().locator('.assistant-header')).toContainText('Live AI');
 await ask('How do I import CSV?');await expect(answer().locator('small')).toHaveText('Offline guide');await expect(answer()).toContainText('CSV or XLSX');expect(chatCalls).toBe(0);record('App help uses approved local guidance without calling available live AI');await reset();
 await ask('What supports REQ-002?');await expect(answer().locator('small')).toHaveText('AI');await expect(answer()).toContainText('stored synthetic record');expect(lastPayload.project.market).toBe('Germany');record('Chat works when chat service is ready even if analysis is unavailable');
 for(const failure of ['failure','malformed','invalid']){behavior=failure;await reset();await ask('What supports REQ-002?');await expect(answer().locator('small')).toHaveText('Offline guide');await expect(answer()).toContainText('Showing an offline answer');await expect(answer()).toContainText('96 (P1)');await expect(answer().locator('.assistant-citations button')).not.toHaveCount(0);}
 record('Service errors, malformed data and invalid citations provide a labeled offline fallback');
 behavior='hold';await reset();await panel().getByLabel('Ask the assistant',{exact:true}).fill('What supports REQ-002?');await panel().getByRole('button',{name:'Send question',exact:true}).click();await expect(panel().getByRole('button',{name:'Stop request',exact:true})).toBeVisible();await expect.poll(()=>pendingRoutes.length).toBe(1);
 await panel().getByRole('button',{name:'Stop request',exact:true}).click();await expect(answer()).toContainText('Request canceled');await release();await expect(page.locator('.assistant-message.assistant')).toHaveCount(1);await expect(answer().locator('small')).toHaveText('Status');record('Stop request releases the composer and discards late replies');
 await reset();await panel().getByLabel('Ask the assistant',{exact:true}).fill('What supports REQ-002?');await panel().getByRole('button',{name:'Send question',exact:true}).click();await expect.poll(()=>pendingRoutes.length).toBe(1);await reset();await release();await expect(page.locator('.assistant-message')).toHaveCount(0);await expect(panel().getByLabel('Ask the assistant',{exact:true})).toBeEnabled();record('Reset cancels an active request and clears the conversation');
 await panel().getByLabel('Ask the assistant',{exact:true}).fill('What supports REQ-002?');await panel().getByRole('button',{name:'Send question',exact:true}).click();await expect.poll(()=>pendingRoutes.length).toBe(1);await switchProject('United Kingdom');await release();await expect(page.locator('.assistant-message')).toHaveCount(0);await expect(panel().locator('.assistant-header')).toContainText('United Kingdom');await expect(panel().getByLabel('Ask the assistant',{exact:true})).toBeEnabled();record('Project switch cancels in-flight work and keeps old market answers out of the new project');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await expect(panel()).toBeVisible();record('Assistant remains usable on a mobile viewport');
 expect(errors).toEqual([]);record('No chatbot browser runtime errors');
 await mkdir('artifacts',{recursive:true});await writeFile('artifacts/assistant-browser-results.json',JSON.stringify({passed:tests.length,tests,errors,liveModelCalls:0},null,2));
 console.log(`\n${tests.length} assistant browser scenarios passed; no real model calls.`);
}catch(error){console.error(error);await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/assistant-e2e-failure.png',fullPage:true});process.exitCode=1;}
finally{await release();await browser.close();}
