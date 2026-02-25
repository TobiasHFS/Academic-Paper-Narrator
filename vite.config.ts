import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import process from 'node:process';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Fix: Explicitly import 'process' from 'node:process' to ensure Node.js types are available, resolving the 'cwd' missing error on the global process type.
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    define: {
      // This exposes the API_KEY from your .env file to the client-side code
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
      // Polyfill for other process.env usage if necessary
      'process.env': {}
    },
  };
});