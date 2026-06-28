# Riftbound Core Rules Implementation Notes

Source checked: 2026-06-29.

Primary source:

- Official Rules Hub: https://riftbound.leagueoflegends.com/en-us/rules-hub/
- Official Core Rules PDF, updated 2026-03-30: https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/861747d1d4d505b7c14d73aba9749d1c3a209a67.pdf
- Local archived copy: `docs/rules/riftbound-core-rules-2026-03-30.pdf`

This document is a short implementation checklist for Riftbound.kr Playground. Do not copy large rulebook passages into app code or UI. Keep the official PDF as the canonical reference when behavior is unclear.

## Turn Structure

Use these canonical turn phase ids in table snapshots, events, replay, and UI:

- `awaken`
- `beginning`
- `channel`
- `draw`
- `action`
- `end`

Legacy aliases should continue to read safely:

- `ready` -> `awaken`
- `score` -> `beginning`
- `main` -> `action`

Playground should default active turns to `action` after game start and after a pass-turn event.

## Table Setup

- A table starts in `waiting`.
- Each player chooses a saved deck; the deck JSON is copied into the table seat snapshot.
- The first setup deal moves four cards from each main deck into each player's hand.
- Setup mulligan returns selected hand card instances to the main deck, shuffles that deck, then draws the same count.
- Starting the game closes setup, sets status to `active`, sets turn number to at least 1, and keeps the chosen first player.

## Zones

Keep these zones in the table model:

- `legend_zone`
- `champion_zone`
- `battlefields`
- `base`
- `main_deck`
- `rune_deck`
- `rune_pool`
- `hand`
- `chain`
- `battlefield`
- `discard`
- `removed`
- `revealed`

Private zones are `main_deck`, `rune_deck`, and opponent `hand`. Server public views must hide card identities in those zones.

## Core Actions

Playground should support these explicit event types and persist each event in order:

- `setup.deal`
- `hand.mulligan`
- `game.start`
- `deck.shuffle`
- `card.move`
- `card.reveal`
- `card.flip`
- `card.exhaust`
- `rune.spend`
- `rune.recycle`
- `battlefield.claim`
- `showdown.start`
- `showdown.end`
- `turn.phase`
- `turn.pass`
- `score.point`
- `player.concede`
- `result.propose`
- `chat.message`
- `voice.presence`

Player-authored events must not accept full replacement snapshots. Apply only validated payloads on the server, then broadcast the updated public table.

## Victory And Result Recording

- The current Playground prototype uses 8 victory points as the table victory score.
- A player reaching the victory score with a lead completes the table.
- Concession completes the table for the opponent.
- Result proposals complete the table only when both seated players submit the same result.
- Completed tables must retain their full ordered event log so replay can reconstruct state.

## Replay Requirements

Replay is event-log based:

- Start from the locked deck snapshots.
- Apply events in sequence order.
- Preserve chat, voice presence, score, battlefield control, showdown history, result proposals, and final result.
- Rebuild frames without mutating the saved live table snapshot.
