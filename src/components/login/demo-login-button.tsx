"use client";

import { useState } from "react";
import demoUsers from "@/config/demo-users.json";
import { Button } from "@/components/ui/button";

export function DemoLoginButton() {
  const [isOpen, setIsOpen] = useState(false);

  const handleDemoLogin = (identifier: string, pass: string) => {
    // 폼 요소 선택 후 값 채우고 submit 트리거
    const idInput = document.querySelector('input[name="identifier"]') as HTMLInputElement;
    const pwInput = document.querySelector('input[name="password"]') as HTMLInputElement;
    const form = idInput?.closest("form");

    if (idInput && pwInput && form) {
      idInput.value = identifier;
      pwInput.value = pass;
      
      // Next.js Server Action을 정상적으로 트리거하기 위해 requestSubmit 사용
      const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (submitBtn) {
        form.requestSubmit(submitBtn);
      } else {
        form.requestSubmit();
      }
    }
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
          {demoUsers.map((user, idx) => (
            <Button
              key={idx}
              variant="outline"
              size="sm"
              className="text-xs justify-start"
              onClick={() => handleDemoLogin(user.identifier, user.password)}
            >
              {user.name} ({user.role})
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
