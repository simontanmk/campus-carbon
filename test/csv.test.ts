import { describe, expect, it } from "vitest";
import { toCsv } from "../src/worker/lib/csv";

describe("toCsv", () => {
  it("quotes commas, quotes and newlines; empty for null", () => {
    expect(toCsv(["a", "b"], [["x, y", 'say "hi"'], ["line\nbreak", null], [1.5, 0]])).toBe(
      'a,b\r\n"x, y","say ""hi"""\r\n"line\nbreak",\r\n1.5,0\r\n',
    );
  });
  it("neutralises spreadsheet formulas", () => {
    expect(toCsv(["a"], [["=1+1"], ["+cmd"], ["-2"], ["@x"]])).toBe("a\r\n'=1+1\r\n'+cmd\r\n-2\r\n'@x\r\n");
  });
});
