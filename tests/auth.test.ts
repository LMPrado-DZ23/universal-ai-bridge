import { describe, it, expect } from "vitest";
import { checkToken, checkOrigin } from "../src/security/auth.js";
import type { Config } from "../src/config.js";

function fakeReq(headers: Record<string, string>) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { header: (name: string) => lower[name.toLowerCase()] } as any;
}

const base: Config = {
  mode: "safe",
  workspace: "/tmp/ws",
  token: "segredo123",
  port: 8787,
  allowedOrigins: ["https://chatgpt.com"],
  approval: "confirm",
  allowShell: false,
  allowDocker: false,
  policy: {} as any,
  auditDir: "/tmp/audit",
};

describe("checkToken", () => {
  it("aceita Bearer correto", () => {
    expect(checkToken(fakeReq({ authorization: "Bearer segredo123" }), base)).toBe(true);
  });
  it("aceita header X-Bridge-Token", () => {
    expect(checkToken(fakeReq({ "x-bridge-token": "segredo123" }), base)).toBe(true);
  });
  it("rejeita token errado", () => {
    expect(checkToken(fakeReq({ authorization: "Bearer errado" }), base)).toBe(false);
  });
  it("rejeita quando não há token", () => {
    expect(checkToken(fakeReq({}), base)).toBe(false);
  });
  it("rejeita se o servidor não tem token configurado", () => {
    expect(checkToken(fakeReq({ authorization: "Bearer x" }), { ...base, token: undefined })).toBe(false);
  });
});

describe("checkOrigin", () => {
  it("permite quando não há header Origin (cliente não-browser)", () => {
    expect(checkOrigin(fakeReq({}), base)).toBe(true);
  });
  it("permite Origin na allowlist", () => {
    expect(checkOrigin(fakeReq({ origin: "https://chatgpt.com" }), base)).toBe(true);
  });
  it("bloqueia Origin fora da allowlist (anti DNS-rebinding)", () => {
    expect(checkOrigin(fakeReq({ origin: "https://evil.com" }), base)).toBe(false);
  });
});
