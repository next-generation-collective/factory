import test from "node:test";
import assert from "node:assert/strict";
import { banner, welcomeLines } from "../lib/banner.js";

test("banner: a first visit is a welcome by name", () => {
  const text = welcomeLines({ name: "Sibusiso", first: true, version: "1.0.0" }).join("\n");
  assert.match(text, /Welcome to Next-Gen Factory, Sibusiso\./);
  assert.match(text, /builders of the AI economy/);
});

test("banner: a returning builder is welcomed back", () => {
  assert.match(welcomeLines({ name: "Sibusiso", first: false, version: "1.0.0" })[0], /Welcome back, Sibusiso\./);
});

test("banner: no name still reads well", () => {
  assert.match(welcomeLines({ name: null, first: false, version: "1.0.0" })[0], /^Welcome back\.$/);
});

test("banner: every row of the box is the same width", () => {
  const rows = banner("1.0.0", "/tmp/shop", { name: "Sibusiso", first: false }).split("\n").slice(0, 5);
  assert.equal(new Set(rows.map((r) => [...r].length)).size, 1);
});
