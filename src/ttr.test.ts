import { describe, it, expect } from "vitest";
import { normalizeCode, parseSuccess } from "./ttr";
import denver from "../samples/denver.json";
import vail from "../samples/vail.json";

describe("normalizeCode", () => {
  it("dashed -> dashless, leading zeros stripped", () => {
    expect(normalizeCode("01-0006")).toBe("10006"); // Denver
    expect(normalizeCode("44-0060")).toBe("440060"); // Vail
    expect(normalizeCode("07-0003")).toBe("70003"); // Boulder
    expect(normalizeCode("12-0044")).toBe("120044"); // Thornton
  });
});

describe("parseSuccess (real fixtures)", () => {
  it("denver", () => {
    const r = parseSuccess(denver);
    expect(r.status).toBe("resolved");
    expect(r.code_dashed).toBe("01-0006");
    expect(r.code_dashless).toBe("10006");
    expect(r.total_rate).toBe(0.0915);
    expect(r.rate_breakdown).toHaveLength(4);
    expect(r.rate_breakdown[0]).toEqual({ jurisdiction: "Colorado", type: "state", rate: 0.029 });
  });

  it("vail", () => {
    const r = parseSuccess(vail);
    expect(r.code_dashless).toBe("440060");
    expect(r.total_rate).toBe(0.094);
  });

  it("no jurisdictionCode -> no_match", () => {
    expect(parseSuccess({ salesTax: [] }).status).toBe("no_match");
  });
});
