"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ROUTES: readonly { readonly href: string; readonly label: string }[] = [
  { href: "/overview", label: "Overview" },
  { href: "/quotes", label: "Quotes" },
  { href: "/radar", label: "Radar" },
  { href: "/decisions", label: "Decisions" },
  { href: "/grade", label: "Grade" },
  { href: "/arena", label: "Arena" },
  { href: "/verify", label: "Verify" },
  { href: "/replay", label: "Replay" },
  { href: "/analyst", label: "Ask Tissue" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="topnav">
      <Link href="/" className="brand">
        <Image src="/images/tissue-lockup.svg" alt="Tissue" width={112} height={29} priority />
      </Link>
      <div className="topnav-tabs">
        {ROUTES.map((route) => {
          const active = pathname === route.href || pathname.startsWith(route.href + "/");
          return (
            <Link key={route.href} href={route.href} className={active ? "active" : undefined}>
              {route.label}
            </Link>
          );
        })}
      </div>
      <span className="topnav-status">Devnet</span>
    </nav>
  );
}
