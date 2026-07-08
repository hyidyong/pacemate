import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
  variant?: "default" | "destructive" | "secondary";
}

export function Badge({ className, variant = "default", children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full px-2.5 py-1.5 text-[11px] font-semibold tracking-tight text-white",
        variant === "destructive" && "bg-destructive",
        variant === "secondary" && "bg-slate-500",
        variant === "default" && "bg-slate-700",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
