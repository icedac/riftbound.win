import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const playgroundHtmlPath = new URL("../public/playground/index.html", import.meta.url);

test("public navigation exposes the Playground menu", async () => {
  for (const path of [
    "../public/index.html",
    "../public/cards/index.html",
    "../public/decks/index.html",
    "../public/community/index.html",
    "../public/profile/index.html",
  ]) {
    const html = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(html, /href="\/playground\/">Playground<\/a>/, path);
  }
});

test("playground page exposes lobby, deck picker, table, chat, voice, result, and replay surfaces", async () => {
  const html = await readFile(playgroundHtmlPath, "utf8");

  for (const required of [
    'class="active" href="/playground/"',
    'id="playgroundLobby"',
    'id="playgroundDecks"',
    'id="playgroundTable"',
    'id="tableZones"',
    'id="revealCard"',
    'id="selectedCardStatus"',
    'id="moveToZone"',
    'id="moveSelectedCard"',
    'id="flipSelectedCard"',
    'id="eventLog"',
    'id="chatLog"',
    'id="voicePanel"',
    'id="remoteAudio"',
    'id="resultPanel"',
    'id="replayPanel"',
    'src="/playground.js?v=',
    'src="/auth.js?v=',
    'src="/perf.js?v=',
  ]) {
    assert.match(html, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), required);
  }
});

test("playground client uses shared server table APIs instead of browser-local tables", async () => {
  const js = await readFile(new URL("../public/playground.js", import.meta.url), "utf8");

  assert.match(js, /\/api\/playground\/tables/);
  assert.match(js, /\/events/);
  assert.match(js, /selectedCard/);
  assert.match(js, /instance_id/);
  assert.match(js, /card\.flip/);
  assert.match(js, /WebSocket/);
  assert.match(js, /RTCPeerConnection/);
  assert.doesNotMatch(js, /localStorage/);
  assert.doesNotMatch(js, /riftbound\.playground\.tables\.v1/);
});
