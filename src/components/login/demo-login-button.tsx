"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { signInAsDemoRole } from "@/services/demo-login.actions";

export type DemoLoginRole = "student" | "professor" | "assistant" | "admin";

const ROLE_LABELS: Record<DemoLoginRole, string> = {
  student: "학생 데모 로그인",
  professor: "교수 데모 로그인",
  assistant: "조교 데모 로그인",
  admin: "관리자 데모 로그인",
};

/**
 * Stage 9: this component used to `import demoUsers from "@/config/demo-users.json"`,
 * which put four plaintext passwords — including the admin account's — into the
 * public login page's JavaScript bundle.
 *
 * Post-Stage-10 UX restoration: it receives only the list of ROLES the server
 * is willing to demo, renders one button per role, and posts the role back to a
 * server action that resolves the account and its runtime credential on the
 * server. Nothing here knows who the demo accounts are or how to sign in as
 * them. When the server offers no roles (the production default) it renders
 * nothing at all.
 */
export function DemoLoginButton({ roles }: { roles: DemoLoginRole[] }) {
  const [isPending, startTransition] = useTransition();
  const [activeRole, setActiveRole] = useState<DemoLoginRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!roles.length) {
    return null;
  }

  const handleDemoLogin = (role: DemoLoginRole) => {
    setError(null);
    setActiveRole(role);
    startTransition(async () => {
      // On success the action redirects and never resolves here.
      const result = await signInAsDemoRole(role);
      if (result && result.ok === false) {
        setError(result.message);
        setActiveRole(null);
      }
    });
  };

  return (
    <section
      aria-labelledby="demo-login-heading"
      className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4"
      data-testid="demo-login-panel"
    >
      <h3 id="demo-login-heading" className="text-sm font-bold text-gray-700">
        데모 계정으로 바로 로그인
      </h3>
      <p className="mt-1 text-xs text-gray-500">
        역할을 선택하면 데모 계정으로 로그인합니다. 화면 둘러보기 용도입니다.
      </p>

      {error ? (
        <p role="alert" className="mt-2 text-xs font-semibold text-red-600">
          {error}
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {roles.map((role) => (
          <Button
            key={role}
            type="button"
            variant="outline"
            size="sm"
            className="justify-center text-xs"
            disabled={isPending}
            aria-busy={isPending && activeRole === role}
            data-testid={`demo-login-${role}`}
            onClick={() => handleDemoLogin(role)}
          >
            {isPending && activeRole === role ? "로그인 중…" : ROLE_LABELS[role]}
          </Button>
        ))}
      </div>
    </section>
  );
}
