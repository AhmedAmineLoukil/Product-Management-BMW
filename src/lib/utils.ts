import {clsx,type ClassValue} from 'clsx';
import {twMerge} from 'tailwind-merge';
export const cn=(...inputs:ClassValue[])=>twMerge(clsx(inputs));
export const formatDate=(value:string,withTime=false)=>new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',...(withTime?{hour:'2-digit',minute:'2-digit'}:{})}).format(new Date(value));
export function download(name:string,content:string,type='application/json'){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
