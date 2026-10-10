import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {localAI} from './scripts/local-ai';
export default defineConfig(({mode})=>({ plugins: [react(), tailwindcss(), localAI({...loadEnv(mode, process.cwd(), ''), ...process.env} as Record<string,string>)], server: { host: '127.0.0.1', port: 5173 }, preview: {host:'127.0.0.1'}, build: {rollupOptions:{output:{manualChunks:{charts:['recharts'],spreadsheet:['xlsx'],supabase:['@supabase/supabase-js']}}}} }));
