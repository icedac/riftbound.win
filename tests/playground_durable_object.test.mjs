import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("playground Durable Object worker exports the table actor protocol", async () => {
  const source = await readFile(new URL("../workers/playground-table.js", import.meta.url), "utf8");

  assert.match(source, /export class PlaygroundTable/);
  assert.match(source, /WebSocketPair/);
  assert.match(source, /table\.snapshot/);
  assert.match(source, /table\.event/);
  assert.match(source, /presence\.update/);
  assert.match(source, /signal\.offer/);
  assert.match(source, /signal\.answer/);
  assert.match(source, /signal\.ice/);
  assert.match(source, /\/broadcast/);
});

test("playground Durable Object worker has a deployable Wrangler config", async () => {
  const config = await readFile(new URL("../wrangler.playground-table.toml", import.meta.url), "utf8");

  assert.match(config, /name = "riftbound-playground-table"/);
  assert.match(config, /main = "workers\/playground-table\.js"/);
  assert.match(config, /\[\[durable_objects\.bindings\]\]/);
  assert.match(config, /name = "PLAYGROUND_TABLE"/);
  assert.match(config, /class_name = "PlaygroundTable"/);
  assert.match(config, /\[\[migrations\]\]/);
  assert.match(config, /new_sqlite_classes = \["PlaygroundTable"\]/);
});

test("Pages worker delegates table websockets and event broadcasts to the Durable Object binding", async () => {
  const source = await readFile(new URL("../public/_worker.js", import.meta.url), "utf8");

  assert.match(source, /PLAYGROUND_TABLE/);
  assert.match(source, /playgroundTableActor/);
  assert.match(source, /forwardPlaygroundWebSocketToActor/);
  assert.match(source, /broadcastPlaygroundActorMessage/);
  assert.match(source, /x-riftbound-user-id/);
});

test("Cloudflare deployment publishes the Durable Object actor before Pages", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy-cloudflare-pages.yml", import.meta.url), "utf8");
  const actorStep = workflow.indexOf("Deploy Playground table actor");
  const pagesStep = workflow.indexOf("Deploy static catalog");

  assert.ok(actorStep > 0, "workflow must deploy the Durable Object actor");
  assert.ok(pagesStep > actorStep, "actor must deploy before Pages binds to it");
  assert.match(workflow, /wrangler@4\.105\.0 deploy --config wrangler\.playground-table\.toml/);
});
