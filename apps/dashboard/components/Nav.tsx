import Link from "next/link";

const ROUTES: readonly { readonly href: string; readonly label: string }[] = [
  { href: "/", label: "Overview" },
  { href: "/quotes", label: "Quotes" },
  { href: "/radar", label: "Radar" },
  { href: "/decisions", label: "Decisions" },
  { href: "/grade", label: "Grade" },
  { href: "/replay", label: "Replay" },
];

export function Nav() {
  return (
    <nav className="topnav">
      <span className="brand">TISSUE</span>
      {ROUTES.map((route) => (
        <Link key={route.href} href={route.href}>
          {route.label}
        </Link>
      ))}
    </nav>
  );
}
