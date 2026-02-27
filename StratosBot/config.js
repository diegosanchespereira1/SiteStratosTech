/**
 * Configuração Supabase para onboarding (sessão automática, evita 401).
 * Preencha com: Supabase Dashboard → Project Settings → API (Project URL + anon public).
 * Em produção: usar a mesma anon key aqui é seguro (ela é pública por design; RLS protege os dados).
 */
(function () {
  "use strict";
  window.SUPABASE_URL = "https://eefnsjulakraiwcehrkt.supabase.co";       // ex: "https://SEU_PROJECT_REF.supabase.co"
  window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlZm5zanVsYWtyYWl3Y2Vocmt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwMjE1OTIsImV4cCI6MjA3OTU5NzU5Mn0.qAyH4ib7Q0UV0q71xbZlrW6uqvdo5ekK4_U0hZs_hSY";  // anon public key do projeto
})();
