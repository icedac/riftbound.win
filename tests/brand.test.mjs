import test from "node:test";
import assert from "node:assert/strict";
import { brandForHostname, brandedTitle } from "../public/brand.js";

test("riftbound.win hosts use Riftbound.win branding", () => {
  assert.equal(brandForHostname("riftbound.win"), "Riftbound.win");
  assert.equal(brandForHostname("www.riftbound.win"), "Riftbound.win");
});

test("riftbound.kr hosts use Riftbound.kr branding", () => {
  assert.equal(brandForHostname("riftbound.kr"), "Riftbound.kr");
  assert.equal(brandForHostname("cards.riftbound.kr"), "Riftbound.kr");
});

test("branded titles keep the current page suffix", () => {
  assert.equal(brandedTitle("Riftbound.kr Cards", "Riftbound.win"), "Riftbound.win Cards");
  assert.equal(brandedTitle("Riftbound.win Profile", "Riftbound.kr"), "Riftbound.kr Profile");
  assert.equal(brandedTitle("Cards", "Riftbound.win"), "Riftbound.win Cards");
});
