import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Sem Supabase configurado, o app le a central do minerador local por este
// atalho (modo demonstracao). O cabecalho Host vai trocado para o da central,
// que so aceita pedidos feitos ao proprio endereco.
const central = { target: 'http://127.0.0.1:4310', changeOrigin: true };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: '127.0.0.1', proxy: { '/api': central, '/mineracao': central } },
});
