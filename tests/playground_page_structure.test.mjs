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
    'id="drawOpening"',
    'id="drawRune"',
    'id="revealCard"',
    'id="selectedCardStatus"',
    'id="moveToZone"',
    'value="rune_pool"',
    'id="moveSelectedCard"',
    'id="flipSelectedCard"',
    'id="exhaustSelectedCard"',
    'id="claimBattlefield"',
    'id="startShowdown"',
    'id="showdownWinnerSelect"',
    'id="endShowdown"',
    'value="base"',
    'value="legend_zone"',
    'value="battlefields"',
    'id="scorePoint"',
    'id="concedeGame"',
    'id="eventLog"',
    'id="turnPhaseSelect"',
    'id="setTurnPhase"',
    'id="chatLog"',
    'id="voicePanel"',
    'id="remoteAudio"',
    'id="resultPanel"',
    'id="replayPanel"',
    'src="/playground.js?v=',
    'id="replayPrev"',
    'id="replayNext"',
    'id="replayState"',
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
  assert.match(js, /card\.exhaust/);
  assert.match(js, /battlefield\.claim/);
  assert.match(js, /showdown\.start/);
  assert.match(js, /showdown\.end/);
  assert.match(js, /active_showdown/);
  assert.match(js, /turn\.phase/);
  assert.match(js, /turn_phase/);
  assert.match(js, /WebSocket/);
  assert.match(js, /RTCPeerConnection/);
  assert.doesNotMatch(js, /localStorage/);
  assert.doesNotMatch(js, /riftbound\.playground\.tables\.v1/);
});

test("playground client does not block profile and table boot on the card catalog", async () => {
  const js = await readFile(new URL("../public/playground.js", import.meta.url), "utf8");

  assert.match(js, /async function loadProfile/);
  assert.match(js, /async function loadCardsQuietly/);
  assert.match(js, /render\(\);\s+await loadProfile/);
  assert.doesNotMatch(js, /Promise\.all\(\s*\[\s*fetchJson\("\/cards\.json"/);
});

test("playground client keeps Start host-only and locks card actions until active", async () => {
  const js = await readFile(new URL("../public/playground.js", import.meta.url), "utf8");

  assert.match(js, /function hostUserId/);
  assert.match(js, /function canStartTable/);
  assert.match(js, /function isTableActive/);
  assert.match(js, /els\.startGame\.disabled = !canStartTable\(table\)/);
  assert.match(js, /control\.disabled = !isTableActive\(table\) \|\| controlsDisabled/);
});

test("playground exposes point scoring controls and summaries", async () => {
  const js = await readFile(new URL("../public/playground.js", import.meta.url), "utf8");

  assert.match(js, /score\.point/);
  assert.match(js, /els\.scorePoint/);
  assert.match(js, /player\.concede/);
  assert.match(js, /els\.concedeGame/);
  assert.match(js, /points \|\| 0/);
});

test("playground replay can step through reconstructed table frames", async () => {
  const js = await readFile(new URL("../public/playground.js", import.meta.url), "utf8");

  assert.match(js, /buildReplayFrames/);
  assert.match(js, /state\.replayFrames/);
  assert.match(js, /function renderReplayFrame/);
  assert.match(js, /els\.replayPrev/);
  assert.match(js, /els\.replayNext/);
});

test("playground renders Hearthstone-style seats with card images and hover preview", async () => {
  const html = await readFile(playgroundHtmlPath, "utf8");
  const js = await readFile(new URL("../public/playground.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

  assert.match(html, /id="cardHoverPreview"/);
  assert.match(js, /function orderedSeats/);
  assert.match(js, /orderedSeats\(table\)\.map\(seatZones\)/);
  assert.match(js, /PLAYGROUND_ZONE_ORDER/);
  assert.match(js, /legend_zone/);
  assert.match(js, /battlefields/);
  assert.match(js, /controller_user_id/);
  assert.match(js, /base/);
  assert.match(js, /function renderCardPreview/);
  assert.match(js, /isHiddenCard/);
  assert.match(js, /exhausted/);
  assert.match(js, /function cardImageSrc/);
  assert.match(js, /document\.createElement\("img"\)/);
  assert.match(js, /mouseover/);
  assert.match(js, /focusin/);
  assert.match(css, /\.card-hover-preview/);
  assert.match(css, /\.seat-board\.is-current-player/);
  assert.match(css, /\.card-chip img/);
  assert.match(css, /\.card-chip\.hidden-card/);
});

test("playground labels setup-aware draw and rune channel actions", async () => {
  const html = await readFile(playgroundHtmlPath, "utf8");
  const js = await readFile(new URL("../public/playground.js", import.meta.url), "utf8");

  assert.match(html, /id="drawOpening"[^>]*>Draw 1<\/button>/);
  assert.match(html, /id="drawRune"[^>]*>Channel 2 Runes<\/button>/);
  assert.match(js, /from: "rune_deck", to: "rune_pool", count: 2/);
  assert.match(js, /from: "main_deck", to: "hand", count: 1/);
});
