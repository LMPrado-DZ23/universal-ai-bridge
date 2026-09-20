import { describe, it, expect } from "vitest";
import { isPrivateIp } from "../src/tools/net.js";

describe("isPrivateIp (anti-SSRF)", () => {
  it("bloqueia loopback e privados IPv4", () => {
    for (const ip of ["127.0.0.1", "127.9.9.9", "10.0.0.5", "192.168.1.1", "172.16.0.1", "172.31.255.255", "169.254.1.1", "100.64.0.1", "0.0.0.0"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("bloqueia loopback/ULA/link-local/multicast IPv6 e IPv4-mapeado", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12::1", "ff02::1", "::ffff:127.0.0.1", "fe80::1%eth0"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("permite IPs públicos", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});
