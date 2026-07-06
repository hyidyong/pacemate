import { redirect } from "next/navigation";
import { getRoleHomePath, type DemoProfile } from "@/services/session.service";

export function redirectNonStudent(profile: DemoProfile | null) {
  if (!profile) {
    redirect("/login");
  }

  if (profile!.role !== "student") {
    redirect(getRoleHomePath(profile!.role));
  }
}

export function requireRoles(
  profile: DemoProfile | null,
  roles: DemoProfile["role"][],
) {
  if (!profile) {
    redirect("/login");
  }

  if (!roles.includes(profile!.role)) {
    redirect(getRoleHomePath(profile!.role));
  }
}
