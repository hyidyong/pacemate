"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import React from "react";

interface ShimmerButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

export const ShimmerButton = React.forwardRef<HTMLButtonElement, ShimmerButtonProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <motion.button
        ref={ref}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className={cn(
          "relative inline-flex h-12 items-center justify-center overflow-hidden rounded-xl bg-emerald-600 px-6 font-semibold text-white transition-all shadow-[0_4px_14px_0_rgba(16,185,129,0.39)] hover:bg-emerald-700 hover:shadow-[0_6px_20px_rgba(16,185,129,0.23)]",
          className
        )}
        {...(props as any)}
      >
        <span className="relative z-10 flex items-center gap-2">{children}</span>
        
        {/* Shimmer effect overlay */}
        <div className="absolute inset-0 z-0 h-full w-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
      </motion.button>
    );
  }
);
ShimmerButton.displayName = "ShimmerButton";
