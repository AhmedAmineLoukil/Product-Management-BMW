import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ plugins: [react(), tailwindcss()], server: { port: 5173 }, build: {rollupOptions:{output:{manualChunks:{charts:['recharts'],spreadsheet:['xlsx'],supabase:['@supabase/supabase-js']}}}} });
