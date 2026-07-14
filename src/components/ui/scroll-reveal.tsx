interface ScrollRevealProps {
  children: React.ReactNode;
  width?: "fit-content" | "100%";
}

export function ScrollReveal({ children, width = "100%" }: ScrollRevealProps) {
  return (
    <div style={{ width }} className="scroll-reveal">
      {children}
    </div>
  );
}

export function ScrollRevealList({ children, width = "100%" }: ScrollRevealProps) {
  return <ScrollReveal width={width}>{children}</ScrollReveal>;
}

export function ScrollRevealItem({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}
