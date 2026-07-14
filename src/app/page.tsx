import { redirect } from "next/navigation";
import { getDemoProfile, getRoleHomePath } from "@/services/session.service";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const profile = await getDemoProfile();
  redirect(profile ? getRoleHomePath(profile.role) : "/login");
}
