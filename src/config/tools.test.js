import { describe, expect, it } from "vitest";
import { toolGroups } from "./tools.js";

describe("tool navigation", () => {
  it("contains each public tool URL exactly once", () => {
    const links = toolGroups.flatMap((group) => group.tools.map((tool) => tool.href));
    expect(links).toHaveLength(6);
    expect(new Set(links).size).toBe(links.length);
    expect(links.every((href) => href.endsWith(".html"))).toBe(true);
  });
});
