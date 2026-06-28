import test from "node:test";
import assert from "node:assert/strict";
import { brandForHostname, brandedTitle } from "../public/brand.js";

test("public hosts keep the Riftbound.kr site title", () => {
  assert.equal(brandForHostname("riftbound.win"), "Riftbound.kr");
  assert.equal(brandForHostname("www.riftbound.win"), "Riftbound.kr");
  assert.equal(brandForHostname("riftbound.kr"), "Riftbound.kr");
  assert.equal(brandForHostname("cards.riftbound.kr"), "Riftbound.kr");
});

test("unknown hosts use Riftbound.kr branding by default", () => {
  assert.equal(brandForHostname("127.0.0.1"), "Riftbound.kr");
});

test("branded titles keep the current page suffix", () => {
  assert.equal(brandedTitle("Riftbound.kr Cards", "Riftbound.kr"), "Riftbound.kr Cards");
  assert.equal(brandedTitle("Riftbound.win Cards", "Riftbound.kr"), "Riftbound.kr Cards");
  assert.equal(brandedTitle("Riftbound.win Profile", "Riftbound.kr"), "Riftbound.kr Profile");
  assert.equal(brandedTitle("Cards"), "Riftbound.kr Cards");
});
