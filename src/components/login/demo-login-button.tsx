"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { signInAsDemoAccount } from "@/services/demo-login.actions";

export type DemoLoginAccount = {
  identifier: string;
  name: string;
  role: string;
};

/**
 * Stage 9: this component used to `import demoUsers from "@/config/demo-users.json"`,
 * which put four plaintext passwords — including the admin account's — into the
 * public login page's JavaScript bundle. It now receives only names, roles and
 * identifiers from the server, and the sign-in happens in a server action that
 * looks the password up server-side.
 */
export function DemoLoginButton({ accounts }: { accounts: DemoLoginAccount[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!accounts.length) {
    return null;
  }

  const handleDemoLogin = (identifier: string) => {
    startTransition(async () => {
      await signInAsDemoAccount(identifier);
    });
  };

  return (
    <div className="mt-4 border border-dashed border-gray-300 rounded-lg p-4 bg-gray-50">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm font-bold text-gray-700">QA 전용 데모 로그인</h3>
        <Button variant="ghost" size="sm" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? "접기" : "펼치기"}
        </Button>
      </div>

      {isOpen && (
        <div className="grid grid-cols-2 gap-2 mt-3">
          {accounts.map((user) => (
            <Button
              key={user.identifier}
              variant="outline"
              size="sm"
              className="text-xs justify-start"
              disabled={isPending}
              onClick={() => handleDemoLogin(user.identifier)}
            >
              {user.name} ({user.role})
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
