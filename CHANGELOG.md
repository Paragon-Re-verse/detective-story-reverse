# Changelog

Русская версия: `CHANGELOG.ru.md`.

## 1.0.0 — 2026-10-04

- Removed the “Board mode” button from the “Detective” group: board mode turns on by itself when a board scene opens.
- Video clues: a new card kind “Video cassette (VHS)” with a video file (.mp4, .webm), set on the “Visuals” tab like an audio cassette. On the board it is a VHS cassette with the clue name handwritten on its label; “Watch” opens a player in the card view, and the GM can “Show to everyone” (a player window opens for everyone, starting where the GM is) and “Stop for everyone”. The tape effect gives the picture scan lines, flicker and a “▶ PLAY” mark and runs the sound through the tape filter. If the browser blocks autoplay with sound, the video starts muted with a hint.
- Stamps on board cards: right-click a photo card, index card, sticky note or handout → “Stamp” → Classified, Missing, a hand-drawn X, Evidence, Deceased, Redacted or Remove stamp; the stamp lands under the cursor at a slight angle and is also shown in the card view. Players and the GM can stamp. Module settings: “Stamp folder” (your own white .webp stamps with transparency) and “Stamp color”; “Redacted” is always dark.
- While drawing a thread, right-clicking an empty spot offers every card kind (sticky note, pin, index card, photo card, handout, cassette) plus “Clue from the list…” (the GM picks from templates) and “Suspect…”; the new card is connected right away. A new blank card opens its edit window for its creator.
- English language: a full interface translation (`lang/en.json`), an English “GM Guide” in the compendium next to the Russian one, translatable compendium names, ready-made scenes named in both languages; the case number, quotation marks, dates and sorting follow the client language. README and changelog are in English, the Russian versions are `README.ru.md` and `CHANGELOG.ru.md`.
- Clue list: a single window in which the GM switches between players; a new card look (a button strip at the bottom of the image, case badges, a “new” badge).
- Clue editor: a live preview of the board card on the “Visuals” tab; the image on “Summary” updates immediately.
- Timeline: event stems to the line, date ticks, a time arrow.
- Light theme: a darker accent for small text; the type icon in the clue view is aligned.
- Board: only the changed card's pin is updated, not all of them; the pin is removed together with its card.
- GM window: only the affected tab is re-rendered, and only if the change concerns it.
- Fixed: sticky note and index card paper did not show in the card view window (wrong image path).
- Case journal: data is prepared per tab; only the affected tab is re-rendered (“Cases”, “Suspects”, “Archive”).
- Clue list and GM window: the clue → cases link is computed in one pass; when a case changes, only cards whose badges changed are re-rendered.
- Board: threads follow a card while it is being dragged.
- Chat: “Show in chat” posts a polaroid card; GM whispers have an icon and a colored stripe (found, accepted, declined).
- Clue view and dossier: the image in a polaroid frame with a pin.
- GM window: character portraits in the player list.
- Board: if only a card's threads changed, the card is not laid out again — only the threads are redrawn.
- Board: while dragging, threads are redrawn at most once per frame in a simplified form (1 primitive instead of ~370); the full texture returns on release.
- Board: card text truncation results are cached (a re-layout needs no line measurements).
- Clue types are built once and cached until the types setting changes.
- Case journal as a case folder: “#N” tags on cases, a “Case closed” stamp on a closed case, pinned clues as a grid of polaroids.
- “You are being handed clues” window: the sender's portrait, clues as polaroids, ones you already have are dimmed and marked “already have”.
- Fixed: a thread jittered while dragging a card or a new thread from a pin — its curve was computed from the end coordinates and changed every frame; now it is constant for each thread.
- Fixed: a player without a character had their name shown twice (“DopDop (DopDop)”) in the recipient picker and the GM window.
- Fixed: a clue could not be dragged from the list into a case when grabbed by its image (the browser dragged the image itself).
- Case journal: a clue can be dropped anywhere on the case, not only on the “Clues” strip.
- Archived suspects: when a dossier is deleted, the suspect stays in every case it is linked to as an “archived” snapshot (read-only, personal notes are kept); the journal's “Archive” tab lists archived suspects by case; the delete window warns which cases will keep them.
- Fixed: “Details” on the photo card of a deleted suspect opened an empty “New suspect” dossier; now it opens the archived snapshot or says the dossier was deleted.
- Fixed: a clue locked by a closed case could be edited if the editor had been opened before the case was closed; the check moved to the data layer and covers editing and deleting on any path.
- GM window: the type icon sits on the same line as the type name (it used to wrap above it), types are aligned in a column, long clue names are cut with an ellipsis, the player header buttons wrap in a narrow window.
- Security: description HTML is cleaned with Foundry's standard sanitizer before display (the description of a handed-over clue comes from another player's flags and could be forged).
- Fixed: a closed case could be changed from a window opened before closing (description, timeline, clues, suspects); the check moved to the data layer, and an unsaved description is not lost.
- Fixed: while drawing a thread, clicking a card (not its pin) swallowed the next click on an empty spot.
- A zone whose template was deleted is no longer highlighted for players in focus mode; the GM window shows “(template deleted)” instead of the id.
- Event log for the GM: the “Event log” button at the bottom of the GM window opens a feed — discoveries and failed searches, handovers and replies, board placements, chat posts, clues given by the GM, pinning to cases, closing and reopening cases; filters by participant and event kind, clearing. Everyone writes events to their own User (works without a GM online), at most the last 200 entries per participant.
- Cursor hint over a zone in focus mode: “Examine”, “Select your character's token” or “Get closer: ≈ N ft more” (how far the token still has to go to the zone radius); the “too far” message also gives the distance.
- Clue list: sorting (newest first, by name, by type, by case) and a “tiles / rows” view; the choice is remembered per player. A note icon on the card when the player wrote something about the clue, with the note text in a tooltip.
- Zone labels for the GM: above each search zone — the clue name, check, DC, radius and attempt limit (GM only, can be turned off in the client settings).
- Giving by drag and drop: a template from the library is dropped onto a player on the “Players” tab (holding it over the tab title opens the tab) or onto the player's name in the Foundry players list.
- Fixed: a new handover arriving while a confirmation window was open appeared on top of it; now the windows come one at a time.
- Fixed: the card view window re-rendered on any card change — moving the card or a new thread cut off a cassette playing in it; now the window updates only when the content changes.
- Fixed: closing one card's window turned off the thread highlight of another open card.
- The animation says “Clue received” for a handed-over or given clue; “Clue found” only for a discovery in a zone.
- The GM and profilers see “The case has no clues.” in an empty closed case instead of the player's phrase.
- Texts: gender-neutral GM messages and handover notifications, “Place on the board” instead of “on the scene”, consistent “tile”, “You don't have this clue”.
- README and the GM guide describe the new features; the guide has a new “Event log” page.
- Removed an unused case status CSS rule.
- Discovery animation: a polaroid on a pin with a warm glow and a “Clue found” stamp; with the system “reduce motion” setting the animation is static.

## 0.5.0

The first build to the specification: stages 0–5 delivered in a single release.

- Skeleton: id `detective-story-reverse`, socketlib and dnd5e dependencies, a “Detective” group in the left toolbar, hotkeys without default bindings.
- Clue core: clue types and templates (editor with “Summary”, “Detection”, “Visuals” tabs), search zones on tiles (“Clue” tab), focus mode, dnd5e rolls with attempts, discovery animation, the player clue list, the GM window, giving and handing over through outbox/receipts.
- Storage: player clues are a `clues.<originId>` object in User flags with per-key writes (instead of the prototype's array), zone state is `zoneState.<tileId>`.
- Suspect dossiers with personal notes; the profiler role in the world settings.
- Clue board: placing from the clue list, five card kinds, threads with a palette (stored once, only affected threads are redrawn), “Details”, card deletion by the GM only, relay through socketlib instead of a custom channel, Russian texts, fixed paths of the ready-made scenes, fonts with Cyrillic.
- Cases, timeline and archive; a closed case locks its pinned clues.
- Export and import of GM data to JSON, data reset, the “GM Guide” journal in a compendium.

### Load measurements

Measured on 2026-10-03 in the “Test dnd” world (Foundry v13.351, dnd5e 5.3.3): 300 templates with ~600-character descriptions, all given to one player (303 clues).

- Creating 300 templates: 185 ms; giving 300 clues to one player in a single write: 76 ms.
- Player flag size: 467 KB, ~1.5 KB per clue. Estimate for 7 players with the full set: ~3.2 MB.
- Opening the clue list with 303 clues: 45 ms (the specification target is about 0.5 s).

Seven live clients at once were not reproduced: network behavior with 7 players remains a risk.
