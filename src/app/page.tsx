import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: "var(--space-6)", maxWidth: "40rem", margin: "0 auto" }}>
      <h1>Solaris</h1>
      <p>
        Coordinación y priorización de pedidos de ayuda para las primeras 72 horas después de un
        desastre. Herramienta para rescatistas: la decisión final siempre es humana.
      </p>
      <nav aria-label="Secciones">
        <ul>
          <li><Link href="/centro">Centro de mando</Link></li>
          <li><Link href="/ciudadano">Simulador ciudadano</Link></li>
          <li><Link href="/malla">Simulador de malla</Link></li>
        </ul>
      </nav>
    </main>
  );
}
