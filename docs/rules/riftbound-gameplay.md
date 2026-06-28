# Riftbound Gameplay Rules Notes

Last checked: 2026-06-28

Primary sources:
- Official Rules Hub: https://riftbound.leagueoflegends.com/en-us/rules-hub/
- Core Rules PDF from Rules Hub, listed as last updated 2026-03-30: https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/861747d1d4d505b7c14d73aba9749d1c3a209a67.pdf
- How to Play quick start: https://riftbound.leagueoflegends.com/en-us/news/rules-and-releases/how-to-play-get-started/ (redirects to `playriftbound.com` as of 2026-06-28)
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
- Keep `legend_zone`, `champion_zone`, `battlefields`, `base`, `main_deck`, `rune_deck`, `rune_pool`, `hand`, `chain`, `battlefield`, `discard`, `removed`, and `revealed` zones.
- `legend_zone`, `champion_zone`, and `battlefields` are public setup zones. `base` is the first manual play destination for cards that should enter a player's base before a stricter card-type resolver exists.
- Saved deck entries preserve section metadata. Unit Champions are counted toward the Main Deck requirement but start in `champion_zone` rather than being shuffled into `main_deck`.
- Playground API responses now mask Main Deck, Rune Deck, opponent hands, and opponent face-down cards with hidden placeholders while preserving card counts.
- Stored table snapshots remain complete so owner actions and replay reduction can stay deterministic. User-facing HTTP/WebSocket snapshots are derived views.
- `deck.shuffle` shuffles a player's `main_deck` or `rune_deck` before or during play while preserving secret visibility and replay determinism.
- `setup.deal` deals each player a 4-card opening hand while the table remains in setup, and `hand.mulligan` returns selected hand cards to the Main Deck, shuffles, and redraws the same count.
- `rune.spend` exhausts a selected rune in that player's `rune_pool` and increments `temporary_energy`; `rune.recycle` returns a selected rune from `rune_pool` to the bottom of `rune_deck`.

## Turn Skeleton

- Play proceeds in cyclic turns until a player wins.
- Turn state can be neutral/showdown and open/closed. In a neutral open main phase, the turn player can take discretionary actions.
- Start of turn readies controlled objects, handles battlefield holding/scoring, channels runes, draws 1, and clears temporary unspent rune resources.
- Official quick-start material describes two new runes each turn and says those runes can be turned sideways for temporary costs or returned to the rune deck for larger costs. Playground should therefore keep channeled rune cards in the rune area and track temporary use with an `exhausted` state instead of deleting those cards at turn start.
- The main phase is where most player-directed actions happen.
- A player ends their turn when they have no more discretionary actions they want to take. The next player in turn order becomes turn player.

Playground implication:
- `turn.pass` is valid as the coarse first version.
- Turn-scoped actions such as drawing, channeling, moving/flipping/revealing cards, passing, and manual scoring are accepted only from `turn_player_id`. Chat, voice, mutual result proposals, and concession are still allowed outside the turn window.
- Current Playground support: selected cards can be moved, flipped face up/down, and exhausted/readied. `rune.spend` and `rune.recycle` model temporary rune use and larger-cost rune recycling from the selected player's rune pool. `turn.phase` records the current phase label (`ready`, `score`, `channel`, `draw`, `main`, or `end`) in snapshots, logs, and replay. `turn.pass` clears temporary energy, readies the next active player's public/board objects, then channels 2 runes, draws 1, increments `turn_number`, and returns `turn_phase` to `main`.
- `Play Card` remains a manual shortcut over `card.move`, but it now uses card type defaults from the catalog: Unit and Gear cards move from hand to `base`, Spell cards move to `chain`, Battlefields move to `battlefields`, Legends move to `legend_zone`, and Runes move to `rune_pool`.
- Opening setup is explicit: the host can deal opening hands before `game.start`, and each player can mulligan selected cards from their own hand while the table is still waiting.
- Battlefield control is modeled manually with `battlefield.claim`, which marks a public battlefield card with `controller_user_id`. Scoring from a selected battlefield sends `score.point` with `source: "battlefield"` and stores `last_scored_by` on that battlefield for logs and replay.
- Showdowns are modeled manually with `showdown.start` and `showdown.end`. Starting a showdown records the contested battlefield in `active_showdown` and marks that battlefield as `contested`; ending it appends `showdown_history`, clears `active_showdown`, and, when a winner is chosen, assigns battlefield control to that winner.
- Store turn state on the table snapshot, not only in the event log, so replay can rebuild it deterministically.

## Core Actions To Model Next

- Draw: move cards from `main_deck` to `hand`.
- Channel runes: move up to 2 cards from `rune_deck` into a resource/rune area.
- Exhaust/ready: turn a selected card sideways for temporary rune/resource use or other activated/attacking states, and ready controlled objects at the start of that player's next turn.
- Play card: move a hand card to base, a battlefield, the chain, or trash depending on type and resolution.
- Standard move: move a unit to a battlefield when allowed.
- Conquer/hold scoring: battlefield control can generate victory points.
- Combat/showdown: contested battlefields can create structured windows where action/reaction cards and abilities matter.
- Trash/banish/recycle: distinguish discard/trash, removed/banishment, and deck recycling.

Playground implication:
- Current `card.move`, `card.reveal`, and `card.flip` are the right primitive operations for manual play. `chain` is a public zone for manually staging action/reaction cards before resolution. The `Play Card` button picks the default target zone by card type, then still records the action as a replayable `card.move`.
- `deck.shuffle` is the current primitive for randomizing Main Deck and Rune Deck order. The event reducer uses a persisted seed so replays rebuild the same pile order.
- `card.exhaust`, `rune.spend`, and `rune.recycle` are the current primitives for sideways/ready state and manual rune resource use. They are intentionally manual; later cost matching and card text automation can consume this same state rather than replacing the event log format.
- `battlefield.claim` plus battlefield-sourced `score.point` is the current primitive for manual hold/conquer scoring. Later battlefield control automation should reduce into these same event shapes.
- `showdown.start` plus `showdown.end` is the current primitive for contested battlefield resolution. It does not judge damage, action windows, or card text yet; it records the shared battlefield window and the agreed winner so the replay can show why control changed.
- Add higher-level buttons only when their event payloads can still replay into the same primitive zone changes.

## Victory And Results

- Core Rules cleanup checks whether a player has reached the victory score and has more points than any opponent.
- The current Playground snapshot stores `victory_score: 8` for the default duel setup.
- `score.point` adds points to a player. If that player is at or above `victory_score` and has more points than every opponent, the table completes automatically and records that player as the winner.
- The app also records a mutually agreed result with `result.propose` and completes when both players choose the same result.
- A player can concede with `player.concede`; the opponent is recorded as `winner_user_id`, the conceding player is recorded as `conceded_user_id`, and the event remains in the replay log.

Playground implication:
- Keep mutual result confirmation as a correction/override path.
- The next step is to add stronger battlefield legality checks around the current manual claim/score/showdown flow.

## Engine Backlog

- Add temporary rune/resource pool state separate from channeled rune cards.
- Add public/private/secret card masking.
- Add automated battlefield scoring and control checks.
- Add action legality for turn player, reactions, chain, and detailed showdown state.
- Add replay snapshots or deterministic reducers for every new event type.
