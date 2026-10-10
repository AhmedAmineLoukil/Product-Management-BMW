import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {localAI} from './scripts/local-ai';
import {loadServerEnvironment} from './scripts/server-env';
export default defineConfig(({mode})=>({ plugins: [react(), tailwindcss(), localAI(loadServerEnvironment(mode, process.cwd()))], server: { host: '127.0.0.1', port: 5173 }, preview: {host:'127.0.0.1'}, build: {rollupOptions:{output:{manualChunks:{charts:['recharts'],spreadsheet:['xlsx'],supabase:['@supabase/supabase-js']}}}} }));
