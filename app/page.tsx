import StudioApp from "./studio-app";
import { supabaseConfigured } from "./api/supabase-admin";

export default function Home() {
  const isDbConfigured = supabaseConfigured();
  return <StudioApp initialStage={isDbConfigured ? "login" : "prompt"} />;
}
