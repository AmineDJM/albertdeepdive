import { describe, expect, it } from "vitest";
import { discoverOrganization, normaliseWebsite } from "@/server/tenancy/discovery";
import { ValidationError } from "@/lib/action-result";

describe("normaliseWebsite", () => {
  it("accepts a bare domain and assumes https", () => {
    expect(normaliseWebsite("acme.com").toString()).toBe("https://acme.com/");
    expect(normaliseWebsite("  Acme.com  ").hostname).toBe("acme.com");
    expect(normaliseWebsite("http://acme.com/about").protocol).toBe("http:");
  });

  it("rejects anything that is not a website address", () => {
    for (const input of ["", "   ", "localhost", "acme", "javascript:alert(1)", "file:///etc/passwd", "not a url"]) {
      expect(() => normaliseWebsite(input), input).toThrow(ValidationError);
    }
  });
});

describe("discoverOrganization refuses to probe the private network", () => {
  // Onboarding turns a typed string into a server-side fetch, which is a server-side request
  // forgery primitive unless the destination is checked. Reserved ranges are rejected before any
  // request is made, whether they are written as a literal address or reached through a hostname.
  const privateTargets = [
    "127.0.0.1",
    "http://127.0.0.1:5432",
    "10.0.0.1",
    "172.16.5.4",
    "192.168.1.1",
    "169.254.169.254", // cloud instance metadata
    "100.64.0.1",
    "0.0.0.0",
    "[::1]",
    "localhost",
    "db.internal",
    "printer.local",
  ];

  for (const target of privateTargets) {
    it(`rejects ${target}`, async () => {
      await expect(discoverOrganization(target)).rejects.toBeInstanceOf(ValidationError);
    });
  }
});
