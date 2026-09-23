import { describe, expect, it } from "vitest";
import { publicAppUrl } from "@/server/env";

describe("the address the newsroom hands out", () => {
  it("uses the explicit setting when there is one", () => {
    expect(publicAppUrl({ NEXT_PUBLIC_APP_URL: "https://deepdive.albertschool.com", RENDER_EXTERNAL_URL: "https://ignored.onrender.com" })).toBe(
      "https://deepdive.albertschool.com",
    );
  });

  it("falls back to the URL Render publishes to the running service", () => {
    expect(publicAppUrl({ RENDER_EXTERNAL_URL: "https://briefly.onrender.com" })).toBe("https://briefly.onrender.com");
  });

  it("adds the scheme when the platform publishes a bare host", () => {
    expect(publicAppUrl({ VERCEL_URL: "briefly.vercel.app" })).toBe("https://briefly.vercel.app");
    expect(publicAppUrl({ RAILWAY_PUBLIC_DOMAIN: "briefly.up.railway.app" })).toBe("https://briefly.up.railway.app");
    expect(publicAppUrl({ FLY_APP_NAME: "briefly" })).toBe("https://briefly.fly.dev");
  });

  it("ignores a blank setting rather than handing out an empty address", () => {
    expect(publicAppUrl({ NEXT_PUBLIC_APP_URL: "   ", RENDER_EXTERNAL_URL: "https://briefly.onrender.com" })).toBe(
      "https://briefly.onrender.com",
    );
  });

  it("says nothing when nothing says otherwise, so the local default applies", () => {
    expect(publicAppUrl({})).toBeUndefined();
  });
});
