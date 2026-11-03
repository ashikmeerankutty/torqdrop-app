import { describe, expect, it } from "vitest";
import { getGuide, ITEM_GUIDES, SECTION_GUIDES } from "../lib/diagnostics/checklists/guides";
import { PPI_V1 } from "../lib/diagnostics/checklists/ppi-v1";

describe("check guides", () => {
  it("cover every check and every section, and name no checks that don't exist", () => {
    const keys = PPI_V1.sections.flatMap((s) => s.items.map((i) => i.key));
    expect(keys.filter((k) => !ITEM_GUIDES[k])).toEqual([]);
    expect(Object.keys(ITEM_GUIDES).filter((k) => !keys.includes(k))).toEqual([]);
    expect(PPI_V1.sections.filter((s) => !SECTION_GUIDES[s.key]).map((s) => s.key)).toEqual([]);
  });

  it("say what photo to take for every check that needs one", () => {
    const missing = PPI_V1.sections.flatMap((s) => s.items.filter((i) => i.photo && !ITEM_GUIDES[i.key].capture).map((i) => i.key));
    expect(missing).toEqual([]);
  });

  it("fall back to the section guide", () => {
    expect(getGuide("engine", "unknown")).toBe(SECTION_GUIDES.engine);
  });
});
