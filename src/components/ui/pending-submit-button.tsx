"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

// Server-action forms had bare submit buttons: no pending feedback and a
// wide double-submit window across the multi-query round trip (Stage 4,
// audit A-9). Drop-in replacement for <Button type="submit">.
export function PendingSubmitButton({
  children,
  pendingLabel = "처리 중…",
  ...props
}: React.ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
