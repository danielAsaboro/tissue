import { dashboardData } from "@/lib/data";
import { QuoteTapeTable } from "@/components/QuoteTapeTable";

export default async function QuotesPage() {
  const rows = await dashboardData.getQuoteTape();
  return (
    <section className="panel">
      <h2>Quote tape</h2>
      <QuoteTapeTable rows={rows} />
    </section>
  );
}
