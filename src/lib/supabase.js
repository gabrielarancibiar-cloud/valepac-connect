import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase no está configurado. Revisa las variables de entorno en Vercel."
  );
}

export const supabase = createClient(
  supabaseUrl || "",
  supabaseAnonKey || ""
);
