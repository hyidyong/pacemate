import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type ScreenIntroProps = {
  title: string;
  description: string;
  status: string;
  nextItems: string[];
  primaryAction?: {
    href: string;
    label: string;
  };
};

export function ScreenIntro({
  title,
  description,
  status,
  nextItems,
  primaryAction,
}: ScreenIntroProps) {
  return (
    <AppShell>
      <section className="screen-hero">
        <Link href="/" className="status-line">
          <ArrowLeft size={15} aria-hidden="true" />
          1단계 화면 뼈대
        </Link>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="actions">
          {primaryAction ? (
            <Button asChild>
              <Link
                href={primaryAction.href}
                data-testid={`screen-primary-${primaryAction.href.slice(1)}`}
              >
                {primaryAction.label}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link href="/">전체 화면 지도</Link>
          </Button>
        </div>
      </section>
      <section className="section">
        <Card>
          <CardHeader>
            <CardTitle>현재 상태</CardTitle>
            <CardDescription>{status}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="screen-list">
              {nextItems.map((item) => (
                <li key={item}>
                  <p>{item}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
