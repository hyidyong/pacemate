import { AppShell } from "@/components/layout/app-shell";
import { ProfessorProfileEditor } from "@/components/professor/professor-profile-editor";
import { getProfessorProfile } from "@/services/professor.service";
import { requireRoles } from "@/services/role-guard.service";
import { getDemoProfile } from "@/services/session.service";

export const dynamic = "force-dynamic";

export default async function ProfessorMyPage() {
  const profile = await getDemoProfile();
  requireRoles(profile, ["professor"]);
  const professor = await getProfessorProfile(profile);

  return (
    <AppShell>
      {professor ? (
        <ProfessorProfileEditor professor={professor} />
      ) : (
        <section className="section">
          <div className="community-empty">
            <p>연결된 교수 정보를 찾지 못했습니다.</p>
          </div>
        </section>
      )}
    </AppShell>
  );
}
