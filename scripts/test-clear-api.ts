#!/usr/bin/env bun

/**
 * CLEAR API smoke tests for local development.
 *
 * Usage:
 *   bun run test:clear          # all tests
 *   bun run test:clear -- me    # single test
 *
 * Requires CLEAR_API_KEY in .env.local (Bun loads this automatically).
 */

import { clearQueryData } from "./clear/client";

type MeResult = {
  me: { id: string; email: string; role: string } | null;
};

type CountriesResult = {
  locations: Array<{
    id: string;
    name: string;
    population: number | null;
    level: number;
  }>;
};

type EventsByLocationResult = {
  eventsByLocation: Array<{
    id: string;
    title: string;
    severity: number;
    types: string[];
    generalLocation: { name: string; geometry: unknown } | null;
  }>;
};

type SignalsByLocationResult = {
  signalsByLocation: Array<{
    id: string;
    title: string | null;
    severity: number | null;
    source: { id: string; name: string; type: string } | null;
    generalLocation: { name: string; geometry: unknown } | null;
  }>;
};

type AlertsByLocationResult = {
  alertsByLocation: Array<{
    id: string;
    status: string;
    event: {
      title: string;
      severity: number;
      types: string[];
      generalLocation: { name: string; geometry: unknown } | null;
    };
  }>;
};

const tests: Record<string, () => Promise<void>> = {
  async me() {
    const data = await clearQueryData<MeResult>(`
      query {
        me { id email role }
      }
    `);

    if (!data.me) {
      throw new Error(
        "me returned null — API key not accepted. Regenerate in Developer Portal, update .env.local, ensure header is Authorization: Bearer <key>",
      );
    }

    console.log("  user:", data.me.email);
    console.log("  role:", data.me.role);
    console.log("  id:  ", data.me.id);
  },

  async countries() {
    const data = await clearQueryData<CountriesResult>(`
      query {
        locations(level: 0) {
          id
          name
          population
          level
        }
      }
    `);

    console.log(`  countries tracked: ${data.locations.length}`);
    const sample = data.locations.slice(0, 5).map((l) => l.name);
    console.log("  sample:", sample.join(", "));
  },

  async afghanistan() {
    const data = await clearQueryData<CountriesResult>(`
      query {
        locations(level: 0) {
          id
          name
          population
        }
      }
    `);

    const afghanistan = data.locations.find((l) =>
      l.name.toLowerCase().includes("afghan"),
    );

    if (!afghanistan) {
      throw new Error("Afghanistan not found in locations(level: 0)");
    }

    console.log("  name:       ", afghanistan.name);
    console.log("  location id:", afghanistan.id);
    console.log("  population: ", afghanistan.population ?? "n/a");

    return afghanistan.id;
  },

  async events() {
    const countries = await clearQueryData<CountriesResult>(`
      query {
        locations(level: 0) { id name }
      }
    `);

    const afghanistan = countries.locations.find((l) =>
      l.name.toLowerCase().includes("afghan"),
    );
    if (!afghanistan) throw new Error("Afghanistan not found");

    const data = await clearQueryData<EventsByLocationResult>(
      `
      query ($locationId: String!) {
        eventsByLocation(locationId: $locationId) {
          id
          title
          severity
          types
          generalLocation { name geometry }
        }
      }
    `,
      { locationId: afghanistan.id },
    );

    console.log(`  events in ${afghanistan.name}: ${data.eventsByLocation.length}`);
    const withGeo = data.eventsByLocation.filter(
      (e) => e.generalLocation?.geometry,
    ).length;
    console.log(`  with geometry: ${withGeo}`);

    for (const event of data.eventsByLocation.slice(0, 3)) {
      console.log(
        `    · [sev ${event.severity}] ${event.title} (${event.types.join(", ") || "no type"})`,
      );
    }
  },

  async signals() {
    const countries = await clearQueryData<CountriesResult>(`
      query {
        locations(level: 0) { id name }
      }
    `);

    const afghanistan = countries.locations.find((l) =>
      l.name.toLowerCase().includes("afghan"),
    );
    if (!afghanistan) throw new Error("Afghanistan not found");

    const data = await clearQueryData<SignalsByLocationResult>(
      `
      query ($locationId: String!) {
        signalsByLocation(locationId: $locationId) {
          id
          title
          severity
          source { id name type }
          generalLocation { name geometry }
        }
      }
    `,
      { locationId: afghanistan.id },
    );

    console.log(`  signals in ${afghanistan.name}: ${data.signalsByLocation.length}`);
    const withGeo = data.signalsByLocation.filter(
      (s) => s.generalLocation?.geometry,
    ).length;
    console.log(`  with geometry: ${withGeo}`);

    for (const signal of data.signalsByLocation.slice(0, 3)) {
      console.log(
        `    · ${signal.title ?? "(untitled)"} — ${signal.source?.name ?? "unknown source"} (sev ${signal.severity ?? "?"})`,
      );
    }
  },

  async alerts() {
    const countries = await clearQueryData<CountriesResult>(`
      query {
        locations(level: 0) { id name }
      }
    `);

    const afghanistan = countries.locations.find((l) =>
      l.name.toLowerCase().includes("afghan"),
    );
    if (!afghanistan) throw new Error("Afghanistan not found");

    const data = await clearQueryData<AlertsByLocationResult>(
      `
      query ($locationId: String!) {
        alertsByLocation(locationId: $locationId) {
          id
          status
          event {
            title
            severity
            types
            generalLocation { name geometry }
          }
        }
      }
    `,
      { locationId: afghanistan.id },
    );

    console.log(`  alerts in ${afghanistan.name}: ${data.alertsByLocation.length}`);

    for (const alert of data.alertsByLocation.slice(0, 3)) {
      console.log(
        `    · [${alert.status}] sev ${alert.event.severity}: ${alert.event.title}`,
      );
    }
  },
};

const order = ["me", "countries", "afghanistan", "events", "signals", "alerts"] as const;

/** Queries that work without a valid API key (public schema). */
const publicTests = new Set(["countries", "afghanistan"]);

async function main() {
  const filter = process.argv[2];
  const selected = filter
    ? order.filter((name) => name === filter)
  : order;

  if (filter && selected.length === 0) {
    console.error(`Unknown test "${filter}". Available: ${order.join(", ")}`);
    process.exit(1);
  }

  if (!process.env.CLEAR_API_KEY) {
    console.error("CLEAR_API_KEY not set. Add it to .env.local");
    process.exit(1);
  }

  console.log("CLEAR API tests — https://api.clearinitiative.io/graphql\n");

  let passed = 0;
  let failed = 0;
  let authOk = false;

  for (const name of selected) {
    const run = tests[name];
    process.stdout.write(`▶ ${name} ... `);
    try {
      await run();
      console.log("OK\n");
      passed++;
      if (name === "me") authOk = true;
    } catch (err) {
      console.log("FAIL\n");
      console.error(`  ${err instanceof Error ? err.message : String(err)}\n`);
      failed++;
      if (name === "me") {
        console.error(
          "  Authenticated tests (events, signals, alerts) will likely fail until me succeeds.\n",
        );
      }
    }
  }

  if (!authOk && selected.some((n) => !publicTests.has(n) && n !== "me")) {
    console.log(
      "Tip: run public-only checks with: bun run test:clear -- countries && bun run test:clear -- afghanistan",
    );
  }

  console.log(`Done: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
