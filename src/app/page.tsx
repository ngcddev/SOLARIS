import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: "var(--space-6)", maxWidth: "40rem", margin: "0 auto" }}>
      <h1>Solaris</h1>
      <p>
        Coordination and prioritization of help requests for the first 72 hours after a disaster.
        A tool for rescuers: the final decision is always human.
      </p>
      <nav aria-label="Sections">
        <ul>
          <li><Link href="/command-center">Command center</Link></li>
          <li><Link href="/citizen">Citizen simulator</Link></li>
          <li><Link href="/mesh">Mesh simulator</Link></li>
        </ul>
      </nav>
    </main>
  );
}
