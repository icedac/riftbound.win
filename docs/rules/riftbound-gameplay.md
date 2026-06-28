# Riftbound Gameplay Rules Notes

Last checked: 2026-06-28

Primary sources:
- Official Rules Hub: https://riftbound.leagueoflegends.com/en-us/rules-hub/
- Core Rules PDF from Rules Hub, listed as last updated 2026-03-30: https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/861747d1d4d505b7c14d73aba9749d1c3a209a67.pdf
- How to Play quick start: https://riftbound.leagueoflegends.com/en-us/news/rules-and-releases/how-to-play-get-started/
- Unleashed Core Rules patch notes: https://riftbound.leagueoflegends.com/en-us/news/rules-and-releases/riftbound-core-rules-unleashed-patch-notes/

This file is an implementation note for Riftbound.kr Playground. It is not a replacement for the official Core Rules.

## Current Playground Scope

The first playable slice should model table flow, piles, public logs, card movement, flipping, chat, voice, and replay. It should not pretend to be a full judge engine yet. When a rule needs card text timing, replacement effects, simultaneous triggers, or a complete combat/showdown resolver, the UI should log the player action and let players adjudicate until that engine is implemented.

## Deck And Setup Model

- A player brings a Champion Legend, a Main Deck, a Rune Deck, and battlefields.
- Main Deck cards include the chosen champion, units, gear, and spells. The Core Rules require at least 40 Main Deck cards.
- The Rune Deck is separate from the Main Deck. The Core Rules identify 12 rune cards.
- Setup separates the Champion Legend, chosen champion, battlefields, Main Deck, and Rune Deck into their own zones.
- Both Main Deck and Rune Deck order are secret information. Hands are private information. Trash, board objects, and face-up play-area information are public.
- The setup process draws 4 cards for each player, then allows a mulligan flow, then starts with the first player.

Playground implication:
- Keep `legend_zone`, `battlefields`, `base`, `main_deck`, `rune_deck`, `rune_pool`, `hand`, `battlefield`, `discard`, `removed`, and `revealed` zones.
- `legend_zone` and `battlefields` are public setup zones. `base` is the first manual play destination for cards that should enter a player's base before a stricter card-type resolver exists.
- Add a future `champion_zone` once the deck editor can mark the chosen champion distinctly from the rest of the Main Deck.
- Playground API responses now mask Main Deck, Rune Deck, opponent hands, and opponent face-down cards with hidden placeholders while preserving card counts.
- Stored table snapshots remain complete so owner actions and replay reduction can stay deterministic. User-facing HTTP/WebSocket snapshots are derived views.

## Turn Skeleton

- Play proceeds in cyclic turns until a player wins.
- Turn state can be neutral/showdown and open/closed. In a neutral open main phase, the turn player can take discretionary actions.
- Start of turn readies controlled objects, handles battlefield holding/scoring, channels runes, draws 1, and clears unspent rune resources.
- The main phase is where most player-directed actions happen.
- A player ends their turn when they have no more discretionary actions they want to take. The next player in turn order becomes turn player.

Playground implication:
- `turn.pass` is valid as the coarse first version.
- Later, replace the single pass button with phase/task buttons: ready, hold score, channel 2 runes, draw 1, main actions, end.
- Store turn state on the table snapshot, not only in the event log, so replay can rebuild it deterministically.

## Core Actions To Model Next

- Draw: move cards from `main_deck` to `hand`.
- Channel runes: move up to 2 cards from `rune_deck` into a resource/rune area.
- Play card: move a hand card to base, a battlefield, the chain, or trash depending on type and resolution.
- Standard move: move a unit to a battlefield when allowed.
- Conquer/hold scoring: battlefield control can generate victory points.
- Combat/showdown: contested battlefields can create structured windows where action/reaction cards and abilities matter.
- Trash/banish/recycle: distinguish discard/trash, removed/banishment, and deck recycling.

Playground implication:
- Current `card.move`, `card.reveal`, and `card.flip` are the right primitive operations for manual play.
- Add higher-level buttons only when their event payloads can still replay into the same primitive zone changes.

## Victory And Results

- Core Rules cleanup checks whether a player has reached the victory score and has more points than any opponent.
- The current Playground snapshot stores `victory_score: 8` for the default duel setup.
- `score.point` adds points to a player. If that player is at or above `victory_score` and has more points than every opponent, the table completes automatically and records that player as the winner.
- The app also records a mutually agreed result with `result.propose` and completes when both players choose the same result.

Playground implication:
- Keep mutual result confirmation as a correction/override path.
- The next step is to wire battlefield control and hold/conquer checks into `score.point` instead of using only the manual Score Point control.

## Engine Backlog

- Add explicit table phases and rune pool state.
- Add public/private/secret card masking.
- Add battlefield objects and control state.
- Add automated battlefield scoring and control checks.
- Add action legality for turn player, reactions, chain, and showdown state.
- Add replay snapshots or deterministic reducers for every new event type.
