import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';

const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext();const page=await context.newPage();
const base=process.env.BASE_URL||'http://127.0.0.1:5173';
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const passed=[];const pass=name=>{passed.push(name);console.log('PASS',name);};
const health={ai:true,chat:false,collector:true,keyConfigured:true,pythonReady:true,issues:[],model:'synthetic-test',chatModel:'synthetic-test',configurationSource:'synthetic browser fixture',dependencies:{chat:true,analysis:true,collector:true},status:'ready',limit:50,liveVerified:false};
const nav=async name=>{await page.locator('.sidebar nav').getByRole('button',{name,exact:name!=='Review Queue'}).click();await expect(page.locator('h1')).toHaveText(name);};
const workspace=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('insightpilot.workspace.v1')));
let failAnalysis=false,lastPayload;
await page.route('**/api/health',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(health)}));
await page.route('**/api/analyze',async route=>{
 lastPayload=route.request().postDataJSON();
 if(failAnalysis)return route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({error:'Synthetic provider rate limit. Retry later.'})});
 const source=lastPayload.records[0];
 const result={findings:[{finding_id:'F-SYNTHETIC',source_id:source.source_id,summary:'Seat discomfort in the fictional record.',customer_need:'Comfort on long trips.',finding_type:'unmet_need',category:'Comfort',evidence_quote:source.text,evidence_valid:true,needs_review:true,uncertainties:['One fictional record only.']}],clusters:[{cluster_id:'C-SYNTHETIC',title:'Seat comfort',summary:'A fictional comfort observation.',category:'Comfort',finding_ids:['F-SYNTHETIC'],source_ids:[source.source_id],uncertainty:'One fictional source.'}],proposed_requirements:[{requirement_id:'R-SYNTHETIC',description:'Improve seat comfort during long trips.',category:'Comfort',rationale:'The fictional record describes discomfort.',confidence:'low',linked_finding_ids:['F-SYNTHETIC'],linked_source_ids:[source.source_id],assumptions:[],uncertainties:['Not representative.'],decision_status:'pending',validation_errors:[]}],validation_errors:[],metrics:{seconds:0.1,api_calls:0,input_tokens:0,output_tokens:0,reasoning_tokens:0,model:'synthetic-test'}};
 return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
});
let collection='valid';
const publicResult={model_code:'F70',market:'Germany',source_url:'https://example.org/f70',cached:false,warning:'Synthetic external context only.',records:[{source_id:'WEB-SYNTHETIC-1',model_code:'F70',requested_market:'Germany',source_market:'Unverified',source_type:'external_article',source_url:'https://example.org/f70',title:'Fictional F70 context',published_at:null,retrieved_at:'2026-10-10T00:00:00Z',text_original:'Fictional BMW F70 seat context.',model_match:'F70',model_match_quality:'exact_code'}]};
await page.route('**/api/collect',async route=>{
 if(collection==='hold'){await new Promise(resolve=>setTimeout(resolve,1_000));try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(publicResult)});}catch{}return;}
 return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(collection==='invalid'?{...publicResult,records:[{...publicResult.records[0],model_code:'G70'}]}:publicResult)});
});

try{
 await page.goto(base,{waitUntil:'domcontentloaded'});await expect(page.locator('h1')).toHaveText('Overview');await nav('Data Sources');
 const text='Fictional seat discomfort — café, längere Fahrten.';
 await page.getByLabel('Upload CSV or XLSX').setInputFiles({name:'synthetic-unicode.csv',mimeType:'text/csv',buffer:Buffer.from('id,feedback\noriginal-1,"'+text+'"\n')});
 const modal=page.getByRole('dialog').last();await modal.getByLabel('Map feedback',{exact:true}).selectOption('feedback');await modal.getByLabel('Map id',{exact:true}).selectOption('id');await modal.getByRole('button',{name:'Validate mapping',exact:true}).click();await expect(modal).toContainText('Validation passed');await modal.getByRole('button',{name:'Import dataset',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.locator('.dataset-checks input').last().check();const before=await workspace();
 await page.getByRole('button',{name:'Run live AI analysis',exact:true}).click();await expect(page.getByText('Analysis complete. Results and source links are recorded in the audit trail.')).toBeVisible();
 const after=await workspace();expect(lastPayload.records).toHaveLength(1);expect(lastPayload.records[0].text).toBe(text);expect(lastPayload.records[0].source_id).toBe(before.datasets.at(-1).records[0].id);expect(lastPayload.records[0].source_location).toContain('row 2');expect(after.requirements).toHaveLength(before.requirements.length+1);expect(after.runs.at(-1).mode).toBe('AI');expect(after.requirements.at(-1).scores.impact).toBe(null);
 pass('Live analysis request keeps exact Unicode records, row provenance, pending review and unknown ratings');
 failAnalysis=true;await page.getByRole('button',{name:'Run live AI analysis',exact:true}).click();await expect(page.locator('.live-progress-card')).toContainText('Synthetic provider rate limit');await expect(page.locator('.live-progress-card')).toHaveClass(/failed/);expect(await workspace()).toEqual(after);await expect(page.getByRole('button',{name:'Run live AI analysis',exact:true})).toBeEnabled();pass('Failed live analysis records no partial result, explains the failure and allows retry');
 await page.getByRole('button',{name:'External research',exact:true}).click();collection='invalid';await page.getByRole('button',{name:'Fetch and preview source',exact:true}).click();await expect(page.locator('.notice[role="alert"]')).toContainText('does not match');expect(await workspace()).toEqual(after);await expect(page.getByRole('button',{name:/Import .* external record/})).toHaveCount(0);pass('Mismatched external source scope is refused without changing the workspace');
 collection='valid';await page.getByRole('button',{name:'Fetch and preview source',exact:true}).click();await expect(page.locator('.collector-record')).toContainText('Fictional F70 context');await page.getByLabel('Collector market').fill('France');await expect(page.locator('.collector-results')).toHaveCount(0);pass('Changing collector market invalidates the old preview before import');
 await page.getByLabel('Collector market').fill('Germany');collection='hold';await page.getByRole('button',{name:'Fetch and preview source',exact:true}).click();await expect(page.getByLabel('Collector market')).toBeDisabled();await page.getByRole('button',{name:'Stop collection',exact:true}).click();await expect(page.locator('.notice[role="alert"]')).toContainText('Collection stopped');await expect(page.getByRole('button',{name:'Fetch and preview source',exact:true})).toBeEnabled();await page.waitForTimeout(1_100);await expect(page.locator('.collector-results')).toHaveCount(0);pass('Stopped collection discards late results and releases the controls');
 await nav('Review Queue');await expect(page.getByRole('button',{name:'Make remote vehicle actions transparent',exact:true})).toBeVisible();pass('Open evidence requests are included in the default review queue');
 expect(errors).toEqual([]);pass('No browser errors in analysis and collector failure paths');
 await mkdir('artifacts',{recursive:true});await writeFile('artifacts/workflow-browser-results.json',JSON.stringify({passed:passed.length,tests:passed,errors,providerCalls:0},null,2));
 console.log(`\n${passed.length} workflow regression scenarios passed.`);
}catch(error){console.error(error);await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/workflow-e2e-failure.png',fullPage:true});process.exitCode=1;}
finally{await browser.close();}
