// =====================================================================
//  Configuración — completar con los datos del proyecto Supabase
//  (Supabase → Project Settings → API). La "anon key" es pública por
//  diseño: la seguridad la dan el login y las políticas de schema.sql.
//  Si se dejan vacíos, la página arranca en MODO DEMO (datos solo en
//  este navegador), útil para probar.
// =====================================================================
window.CONFIG = {
  SUPABASE_URL: 'https://rvxxyqrhktfugpaeuwmi.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_iJEzDp43sZKw8JYr6FIJgg_gz-0dufq',
  // Cómo aparece nuestra droguería en las actas (se compara sin mayúsculas/acentos)
  NOMBRE_PROPIO: 'Meta',
};
