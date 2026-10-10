import {describe,expect,it} from 'vitest';
import {decodeCsv,makeDataset,parseFile,tableRows,type ParsedFile} from './ingestion';

describe('source record preservation',()=>{
 it('decodes multilingual CSV without changing text or numeric-looking IDs',async()=>{
  const text='Seat discomfort — café, längere Fahrten, العربية, 中文.';
  const file=new File(['id,feedback\n00001,"'+text+'"\n'],'feedback.csv');
  const parsed=await parseFile(file);const dataset=makeDataset(parsed,0,0,'Customer verbatims',{feedback:'feedback',id:'id'},'project');
  expect(dataset.records[0].content).toBe(text);expect(dataset.records[0].fields._originalId).toBe('00001');
 });
 it('accepts Excel UTF-16 BOM text and refuses invalid bytes instead of replacing characters',()=>{
  expect(decodeCsv(new Uint8Array([0xff,0xfe,0xe9,0x00]))).toBe('é');
  expect(decodeCsv(new Uint8Array([0xfe,0xff,0x00,0xe9]))).toBe('é');
  expect(()=>decodeCsv(new Uint8Array([0xff,0x81,0xc0]))).toThrow('CSV UTF-8');
 });
 it('reports an empty file before opening a broken mapping dialog',async()=>{
  await expect(parseFile(new File([''],'empty.csv'))).rejects.toThrow('no readable records');
 });
 it('keeps all cells when duplicate headers collide with a generated header',()=>{
  const parsed:ParsedFile={name:'feedback.csv',sheets:[{name:'Sheet1',rows:[['feedback','feedback','feedback (2)'],['Original A','Original B','Original C']]}]};
  const table=tableRows(parsed,0,0);expect(new Set(table.columns).size).toBe(3);
  expect(Object.values(table.rows[0].fields)).toEqual(['Original A','Original B','Original C']);
  const dataset=makeDataset(parsed,0,0,'Customer verbatims',{feedback:table.columns[1]},'project');
  expect(dataset.records[0].content).toBe('Original B');expect(dataset.records[0].fields['feedback (2) (3)']).toBe('Original C');
 });
 it('retains columns that appear after the first 50 rows',()=>{
  const parsed:ParsedFile={name:'feedback.csv',sheets:[{name:'Sheet1',rows:[['feedback'],...Array.from({length:60},()=>['Seat comfort']),['Climate controls','Original late cell']]}]};
  const table=tableRows(parsed,0,0);expect(table.columns).toEqual(['feedback','Column 2']);
  expect(table.rows.at(-1)?.fields['Column 2']).toBe('Original late cell');
 });
 it('rejects invalid header rows with a useful validation message',()=>{
  const parsed:ParsedFile={name:'feedback.csv',sheets:[{name:'Sheet1',rows:[['feedback'],['Seat comfort']]}]};
  for(const index of [-1,0.5,2,100])expect(()=>tableRows(parsed,0,index)).toThrow('header row');
  expect(()=>tableRows(parsed,9,0)).toThrow('worksheet');
 });
});
