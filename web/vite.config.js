import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Em desenvolvimento, as chamadas de dados vao para o backend local (o
// minerador, em 127.0.0.1:4310). O cabecalho Host vai trocado para o do
// backend, que so aceita pedidos feitos ao proprio endereco.
const backend = { target: 'http://127.0.0.1:4310', changeOrigin: true };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, host: '127.0.0.1', proxy: { '/api': backend, '/mineracao': backend } },
});
