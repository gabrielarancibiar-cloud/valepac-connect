export default async function handler(req, res) {
  res.status(200).json({
    tieneUrl: !!process.env.SUPABASE_URL,
    tieneServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    largoClave: process.env.SUPABASE_SERVICE_ROLE_KEY
      ? process.env.SUPABASE_SERVICE_ROLE_KEY.length
      : 0,
    comienzaCon: process.env.SUPABASE_SERVICE_ROLE_KEY
      ? process.env.SUPABASE_SERVICE_ROLE_KEY.substring(0, 10)
      : null
  });
}
