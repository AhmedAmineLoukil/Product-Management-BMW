import type {Dataset} from '../types';
import {uid} from './workspace';
export interface ParsedFile {name:string; normalized?:boolean; sheets:{name:string;rows:unknown[][]}[]}
export function decodeCsv(bytes:Uint8Array):string{
 const encoding=bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':'utf-8';
 try{return new TextDecoder(encoding,{fatal:true}).decode(bytes);}
 catch{throw new Error('The CSV text encoding could not be read. Save the file as CSV UTF-8 and upload it again.');}
}
export async function parseFile(file:File):Promise<ParsedFile>{
 if(!/\.(csv|xlsx)$/i.test(file.name))throw new Error('Choose a CSV or XLSX file.');
 if(file.size>10*1024*1024)throw new Error('Maximum file size is 10 MB. Split large datasets before importing.');
 const XLSX=await import('xlsx');const bytes=new Uint8Array(await file.arrayBuffer());
 const book=/\.csv$/i.test(file.name)?XLSX.read(decodeCsv(bytes),{type:'string',raw:true,cellDates:false}):XLSX.read(bytes,{type:'array',cellDates:false});
 const sheets=book.SheetNames.map(name=>({name,rows:XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name],{header:1,defval:'',blankrows:true})})).filter(sheet=>sheet.rows.some(row=>row.some(cell=>String(cell).trim())));
 if(!sheets.length)throw new Error('This file contains no readable records. Choose a CSV or XLSX with a header and data rows.');
 return {name:file.name,sheets};
}
export const requiredFields:Record<Dataset['type'],string[]>={'Customer verbatims':['feedback'],'Equipment list':['feature','availability'],'Sales volumes':['region','units'],'Customer study':['category','rating'],'External research':['title','url','excerpt']};
export function normalizeProvidedStudy(parsed:ParsedFile):ParsedFile {
 const grouped=new Map<string,Record<string,unknown>[]>();
 const append=(key:string,record:Record<string,unknown>)=>grouped.set(key,[...(grouped.get(key)??[]),record]);
 for(const sheet of parsed.sheets){
  if(sheet.name==='CN_EU_2025'){
   const models=sheet.rows[2]??[];let category=String(models[0]??'');const markets:string[]=[];let market='';
   for(let col=1;col<models.length;col++){if(sheet.rows[1]?.[col])market=String(sheet.rows[1][col]);markets[col]=market==='EU'?'Europe':market;}
   for(let index=3;index<sheet.rows.length;index++){const row=sheet.rows[index];if(String(row[0]??'').trim().toLowerCase()!=='mean'){if(row[0])category=String(row[0]);continue;}
    for(let col=1;col<models.length;col++){if(typeof row[col]!=='number')continue;const derivative=String(models[col]).trim();append(`${markets[col]} · ${derivative}`,{id:`${sheet.name}:R${index+1}:C${col+1}`,category,rating:row[col],measure:'Mean rating; source scale not specified',response:'Mean',market:markets[col],derivative,source_sheet:sheet.name,source_row:index+1,source_column:col+1,original_filename:parsed.name,original_row:JSON.stringify(row)});}
   }
  }else if(sheet.name==='US_2025'){
   const models=sheet.rows[0]??[];let category=String(models[0]??'');
   for(let index=1;index<sheet.rows.length;index++){const row=sheet.rows[index];const hasNumber=row.slice(2).some(v=>typeof v==='number');if(!hasNumber){if(row[0])category=String(row[0]);continue;}
    for(let col=2;col<models.length;col++){if(typeof row[col]!=='number')continue;const derivative=String(models[col]).trim();append(`United States · ${derivative}`,{id:`${sheet.name}:R${index+1}:C${col+1}`,category,rating:row[col],measure:`Response proportion (fraction, not mean rating): ${String(row[1]??'')}`,response:String(row[0]??''),market:'United States',derivative,source_sheet:sheet.name,source_row:index+1,source_column:col+1,original_filename:parsed.name,original_row:JSON.stringify(row)});}
   }
  }
 }
 if(!grouped.size)throw new Error('No recognized grouped study sheets were found. Use explicit column mapping for this file.');
 return {name:parsed.name,normalized:true,sheets:[...grouped].map(([name,records])=>{const columns=Object.keys(records[0]);return {name,rows:[columns,...records.map(r=>columns.map(c=>r[c]))]};})};
}
export function tableRows(parsed:ParsedFile,sheetIndex:number,headerRow:number){
 const sheet=parsed.sheets[sheetIndex];
 if(!sheet||!Number.isInteger(headerRow)||headerRow<0||headerRow>=sheet.rows.length)throw new Error('Choose an existing worksheet and header row.');
 const header=sheet.rows[headerRow];let width=header.length;
 for(const row of sheet.rows.slice(headerRow+1))width=Math.max(width,row.length);
 const seen=new Set<string>();const columns=Array.from({length:width},(_,i)=>{
  const original=String(header[i]??'').trim()||`Column ${i+1}`;let name=original,suffix=i+1;
  while(seen.has(name))name=`${original} (${suffix++})`;
  seen.add(name);return name;
 });
 return {columns,rows:sheet.rows.slice(headerRow+1).map((row,i)=>({row:headerRow+i+2,fields:Object.fromEntries(columns.map((col,j)=>[col,row[j]??'']))})).filter(r=>Object.values(r.fields).some(v=>String(v).trim()))};
}
export function makeDataset(parsed:ParsedFile,sheetIndex:number,headerRow:number,type:Dataset['type'],mapping:Record<string,string>,projectId:string):Dataset{const {columns,rows}=tableRows(parsed,sheetIndex,headerRow);const errors:string[]=[];if(rows.length>5000)throw new Error('This sheet exceeds the 5,000-row demo limit. Split it into smaller files; no rows were imported.');const id=uid('DS');const missing=requiredFields[type].filter(f=>!mapping[f]);if(missing.length)errors.push(`Map required columns: ${missing.join(', ')}.`);const seen=new Set<string>();const records=rows.map(({fields,row})=>{const normalized=Object.fromEntries(Object.entries(mapping).filter(([,col])=>col).map(([field,col])=>[field,fields[col]]));for(const field of requiredFields[type])if(mapping[field]&&!String(normalized[field]??'').trim())errors.push(`Row ${row}: missing ${field}.`);for(const field of ['units','rating'])if(normalized[field]!==undefined&&(String(normalized[field]).trim()===''||!Number.isFinite(Number(normalized[field]))||Number(normalized[field])<0))errors.push(`Row ${row}: ${field} must be a non-negative number.`);if(type==='External research'&&normalized.url){try{const url=new URL(String(normalized.url));if(!['https:','http:'].includes(url.protocol))throw new Error();}catch{errors.push(`Row ${row}: invalid source URL.`);}}const originalId=String(normalized.id??fields.id??fields.ID??`${parsed.sheets[sheetIndex].name}:${row}`);if(seen.has(originalId))errors.push(`Row ${row}: duplicate original identifier ${originalId}.`);seen.add(originalId);return {id:`${id}:${originalId}:${row}`,datasetId:id,content:(parsed.normalized?`Category: ${fields.category} · ${fields.measure} · ${fields.response}: ${fields.rating} · ${fields.derivative} / ${fields.market}`:String(normalized.feedback??normalized.excerpt??Object.entries(normalized).filter(([key])=>key!=='id').map(([key,v])=>`${key}: ${v}`).join(' · ')??JSON.stringify(fields))),fields:{...fields,_originalId:originalId,_filename:parsed.name,...normalized},row:parsed.normalized?Number(fields.source_row):row,sheet:parsed.normalized?String(fields.source_sheet):parsed.sheets[sheetIndex].name,category:String(normalized.category??'')};});return {id,projectId,name:`${parsed.name} · ${parsed.sheets[sheetIndex].name}`,type,synthetic:false,status:errors.length?'Validation errors':'Ready',createdAt:new Date().toISOString(),records,errors,columns};}
