/**
 * Read-only DB summary for location history: import batches, observation counts
 * and date ranges per source, visit counts per source/year, and the visits cursor.
 * Never prints coordinates.
 *
 *   npx tsx scripts/inspect-timeline-db.ts
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: batches, error: bErr } = await sb
    .from("location_import_batches")
    .select("id, source, file_name, detected_format, status, imported_count, duplicate_count, rejected_count, error, metadata, created_at, completed_at")
    .order("created_at");
  if (bErr) throw bErr;
  console.log("== import batches ==");
  for (const b of batches ?? []) {
    console.log(
      JSON.stringify({
        id: b.id.slice(0, 8),
        source: b.source,
        file: b.file_name,
        format: b.detected_format,
        status: b.status,
        imported: b.imported_count,
        dup: b.duplicate_count,
        rejected: b.rejected_count,
        total_records: (b.metadata as Record<string, unknown>)?.total_records,
        error: b.error,
        created: b.created_at,
        completed: b.completed_at,
      }),
    );
  }

  console.log("== observations by source ==");
  for (const source of ["google_timeline", "followmee", "manual", "ingest_api"]) {
    const { count } = await sb.from("location_observations").select("id", { count: "exact", head: true }).eq("source", source);
    if (!count) {
      console.log(source, 0);
      continue;
    }
    const first = await sb.from("location_observations").select("observed_at").eq("source", source).order("observed_at").limit(1).single();
    const last = await sb.from("location_observations").select("observed_at").eq("source", source).order("observed_at", { ascending: false }).limit(1).single();
    console.log(source, count, first.data?.observed_at, "->", last.data?.observed_at);
  }

  console.log("== visits ==");
  const { count: vTotal } = await sb.from("visits").select("id", { count: "exact", head: true });
  console.log("total", vTotal);
  for (const source of ["derived", "google_timeline"]) {
    const { count } = await sb.from("visits").select("id", { count: "exact", head: true }).eq("source", source);
    if (!count) {
      console.log(source, 0);
      continue;
    }
    const first = await sb.from("visits").select("started_at").eq("source", source).order("started_at").limit(1).single();
    const last = await sb.from("visits").select("started_at").eq("source", source).order("started_at", { ascending: false }).limit(1).single();
    console.log(source, count, first.data?.started_at, "->", last.data?.started_at);
    if (source === "google_timeline") {
      const years: Record<string, number> = {};
      for (let y = 2010; y <= new Date().getUTCFullYear(); y++) {
        const { count: c } = await sb
          .from("visits")
          .select("id", { count: "exact", head: true })
          .eq("source", source)
          .gte("started_at", `${y}-01-01T00:00:00Z`)
          .lt("started_at", `${y + 1}-01-01T00:00:00Z`);
        if (c) years[y] = c;
      }
      console.log("  by year", JSON.stringify(years));
    }
  }

  const { data: state } = await sb.from("system_state").select("key, value, updated_at").in("key", ["visits_cursor", "publish_cursor"]);
  console.log("== system_state ==");
  for (const s of state ?? []) console.log(s.key, JSON.stringify(s.value), s.updated_at);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
