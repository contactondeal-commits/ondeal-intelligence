import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildWorldState } from "@/lib/ai/supervisor/worldState";

/**
 * ONDEAL AI CORE — PHASE 4 : tests du World State (06/09/2026), §13/§14/§15.
 *
 * Fixture filesystem RÉELLE (même principe que tests/coderWorkspace.test.ts)
 * — jamais un World State mocké : `buildWorldState` lit de VRAIS fichiers.
 * Vérifie surtout la règle centrale §15 : un signal indisponible doit être
 * marqué INSUFFICIENT_DATA, jamais fabriqué.
 */

const createdRoots: string[] = [];
afterEach(async () => {
  for (const root of createdRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

async function makeFixtureRepo(opts: { withLogin?: boolean; withCss?: boolean; withComponents?: string[] } = {}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ondeal-worldstate-fixture-"));
  createdRoots.push(root);
  if (opts.withLogin ?? true) {
    await fs.mkdir(path.join(root, "src/app/login"), { recursive: true });
    await fs.writeFile(path.join(root, "src/app/login/page.tsx"), "export default function LoginPage() { return null; }");
  }
  if (opts.withCss ?? true) {
    await fs.mkdir(path.join(root, "src/app"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src/app/globals.css"),
      ":root {\n  --color-bg: #0a0a12;\n  --color-accent: #7c3aed;\n}\n\nbody { margin: 0; }\n",
    );
  }
  if (opts.withComponents) {
    await fs.mkdir(path.join(root, "src/components"), { recursive: true });
    for (const name of opts.withComponents) {
      await fs.writeFile(path.join(root, "src/components", name), "export default function C() { return null; }");
    }
  }
  return root;
}

describe("buildWorldState — faits réels avec provenance", () => {
  it("marque public_landing_surface comme FACT/REPOSITORY quand /login existe", async () => {
    const root = await makeFixtureRepo();
    const state = await buildWorldState(root);
    const fact = state.facts.find((f) => f.key === "public_landing_surface");
    expect(fact).toBeDefined();
    expect(fact?.kind).toBe("FACT");
    expect(fact?.source).toBe("REPOSITORY");
    expect(fact?.uncertainty).toBeUndefined();
  });

  it("extrait les tokens CSS de :root en un fait structuré", async () => {
    const root = await makeFixtureRepo();
    const state = await buildWorldState(root);
    const fact = state.facts.find((f) => f.key === "design_tokens_current");
    expect(fact?.value).toEqual({ "color-bg": "#0a0a12", "color-accent": "#7c3aed" });
  });

  it("liste les composants existants (§26 : à consulter avant de créer un nouveau composant)", async () => {
    const root = await makeFixtureRepo({ withComponents: ["Foo.tsx", "Bar.tsx"] });
    const state = await buildWorldState(root);
    const fact = state.facts.find((f) => f.key === "existing_components_inventory");
    expect(fact?.value).toEqual(expect.arrayContaining(["Foo.tsx", "Bar.tsx"]));
  });

  it("marque design_tokens_current en INSUFFICIENT_DATA si globals.css est absent — jamais un token inventé", async () => {
    const root = await makeFixtureRepo({ withCss: false });
    const state = await buildWorldState(root);
    const fact = state.facts.find((f) => f.key === "design_tokens_current");
    expect(fact?.value).toBeNull();
    expect(fact?.uncertainty).toBe("INSUFFICIENT_DATA");
  });

  it("marque explicitement les signaux réels indisponibles (trafic/conversion/avis/concurrence) comme HYPOTHESIS/INSUFFICIENT_DATA — jamais fabriqués", async () => {
    const root = await makeFixtureRepo();
    const state = await buildWorldState(root);
    for (const key of ["real_traffic_ga4", "real_conversion_rate", "real_visitor_reviews_on_marketing_page", "competitor_benchmark_live"]) {
      const fact = state.facts.find((f) => f.key === key);
      expect(fact?.kind).toBe("HYPOTHESIS");
      expect(fact?.uncertainty).toBe("INSUFFICIENT_DATA");
      expect(fact?.value).toBeNull();
    }
  });

  it("ne fabrique jamais public_landing_surface quand /login est absent", async () => {
    const root = await makeFixtureRepo({ withLogin: false });
    const state = await buildWorldState(root);
    const fact = state.facts.find((f) => f.key === "public_landing_surface");
    expect(fact?.value).toBe("introuvable");
  });

  it("horodate le World State (builtAt, ISO)", async () => {
    const root = await makeFixtureRepo();
    const before = Date.now();
    const state = await buildWorldState(root);
    expect(new Date(state.builtAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});
