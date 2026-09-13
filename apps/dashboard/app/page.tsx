import { API_URL, listElders, listEvents } from "../lib/api";
import { Dashboard } from "./_components/dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  try {
    const [events, elders] = await Promise.all([listEvents(), listElders()]);
    return <Dashboard initialEvents={events} initialElders={elders} />;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return (
      <main className="shell">
        <section className="offline">
          <h1>CareGuard can’t reach the API</h1>
          <p>
            Start it with <code>npm run dev:api</code>, then reload this page.
          </p>
          <p>
            Tried <code>{API_URL}</code>: {reason}
          </p>
        </section>
      </main>
    );
  }
}
