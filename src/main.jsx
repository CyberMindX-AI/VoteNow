import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

window.ENV_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
window.ENV_SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
window.ENV_PAYSTACK_PUBLIC_KEY = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;

// Init Supabase client for realtime reads
window.supa = window.supabase.createClient(
  window.ENV_SUPABASE_URL,
  window.ENV_SUPABASE_ANON_KEY
);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
