# Changelog

Русская версия: `CHANGELOG.ru.md`.

## 1.2.4 — 2026-11-21

- Updated and new GM Guide screenshots.

## 1.2.3 — 2026-11-21

- Drag a clue from the GM library onto a scene to create a search zone: a transparent 2×2-cell tile with that clue and its detection settings, ready to resize. Board scenes are skipped.
- The recipient picker has “Case members” buttons that tick all members of an open case at once (giving clues from the library or the editor, handing over between players).
- Clue list: Ctrl+click adds a card to the selection, Shift+click selects a range, Esc clears it; the “Selected: N” bar appears by itself.
- Right-click menus: groups separated by lines, unavailable items shown greyed out with the reason (for example “Place on the board” outside a board scene), “Delete” at the bottom in red; menus stay inside the screen.
- The case number on clue cards is a “#3” badge instead of a folder icon (it was easy to confuse with folders).
- GM window: Export, Import and Reset moved into one “Data ▾” button; Reset is separated and red and still asks for confirmation.
- GM Guide: the quick way to make a zone, selection shortcuts, case members in the recipient picker and the “Data” menu.

## 1.2.2 — 2026-11-21

- Updated and new GM Guide screenshots in Russian and English: every page now has pictures.
- Fixed: the level text editors on the “Levels” tab had no visible input area, and typed text came out reversed.
- Fixed: on a clue list card, the hidden folder and level badges caught clicks meant for “Edit” and “…”.
- Fixed: a console error (TypeError in the clue editor preview) after saving a player's copy.
- A player's copy keeps taking its levels from the template until the GM ticks “Own levels for this copy” (ticked automatically when the levels are changed); saving the card alone no longer freezes them.
- Menus opened by right-click or “…” close with Escape and when their window closes.
- An open clue card updates “Place on the board” as soon as the board scene opens.
- “Details” on a board card opens the player's clue card with all open levels instead of the clue list.
- The folder panel keeps exactly the width it was dragged to (it used to shrink by a few pixels on reload).
- “Study” rolls with the same character as a background zone search: the profile character, otherwise the selected token.
- A write to a case the user doesn't run now reports failure instead of success.
- GM Guide: the caption of the case journal screenshot describes the case tabs.

## 1.2.1 — 2026-11-21

- Clue levels: a clue can have up to 6 levels of information, each with its own text, check and difficulty; level 1 is the description and is open on receipt. A player opens the next level with “Study” (a check against its difficulty, unlimited tries; the GM gets a whisper with the result). The GM opens and closes any level per player — in the clue card, in GM window → Players (the “2/4” button) and for all holders at once from the library. Level texts come from the template unless the GM edited that player's copy. Open levels travel with a handover and merge with a duplicate; chat and board cards show all open levels; case progress and clue cards show “2/4”; a notification, a “new” badge and an event log entry when a level opens.
- Several cases at once: a case has members (set by the GM). A player sees only cases they are a member of, a profiler runs only such cases; a case without members is visible to everyone.
- Case journal: tabs inside a case — Overview (description, members, suspects), Clues, Timeline, Theories, Progress; the timeline, theories and progress open right inside the journal and can be popped out into a window. Header buttons became icons. Suspects and members are compact chips; suspects are linked with a searchable grid.
- Dossier archive: “Archive / Restore from archive” instead of deleting; the Suspects tab has a search and a filter (active, in case, archived, all); archived suspects are hidden in pickers unless “Search the archive” is checked; closing a case offers to archive suspects that are in no other open case. Snapshots of deleted dossiers are now called “deleted dossiers”.
- GM window for long campaigns: on the Players tab a case filter (the player's cases by default, a specific case or all clues), clues outside any case in a collapsed “No case” group, only zones with attempts by default, collapsible sections, a clue search and the levels button. The library filters by open cases (clues outside cases stay visible); “New clue” goes into the open folder; “Move” and “Delete” moved to the right-click menu and the “…” button.
- Clue list: “Only current cases” toggle; on the card only “Place on the board” (and “Edit” for the GM) plus “…”, everything else in the right-click menu; a levels badge. The GM can use selection mode for any player.
- Folder tree: folder actions in the right-click menu, the panel can be hidden and resized by dragging its edge (remembered).
- Forms: compact searchable chip grids for suspects and clues (event, theory, solution, case clues); the “Check” field is a list of skills and abilities with “Custom formula…”; event color is a palette with “No color” and “Another color”.
- Case progress: no striped rows, a dash instead of “no zone”, open levels next to found clues; on case cards in the journal the move and unpin buttons and the folder path appear on hover.
- Screenshots in the GM Guide (pages 3, 6, 10, 11, 12), in Russian and English; new guide pages “Clue levels” and “A long campaign: several cases”, updated pages on clues, suspects, cases and folders. Some screenshots still show the 1.2.0 layout.

## 1.2.0 — 2026-11-20

- Clue chains: a search zone can require clues (“Requires clues” on the “Clue” tab of the tile). Until a player has all of them, the zone does not exist for that player: it isn't highlighted in focus mode and clicking it does nothing, no attempts are spent. Each player's own clues count; another player can hand over the “key”. The GM's zone label shows “Requires: …”.
- “Zone labels” toggle for the GM in the “Detective” controls: show or hide all labels above zones with one click.
- Theories: a profiler puts forward a theory for a case (suspects, motive, method, clues) from the new “Theories” window of the case journal; every submission is kept, a profiler sees only their own theories. The GM sees all of them, sets the case solution in advance and gets a “matches / does not match” hint for suspects and clues, marks theories correct or wrong, and closes the case choosing whether to reveal the solution. A revealed solution opens a window for everyone online and stays in chat; it can also be revealed later for a closed case.
- Case progress (GM and profilers): a “clue × players” table — where to search, the chain, who found the clue, attempts used, whether it is still locked by a chain for a player. The GM links the case to library folders and/or individual templates (“Case clues”) and sees the group total; a profiler sees only clues some player has already found.
- Timeline rework: events get a description, an optional end (shown as an interval on the line), “approximate time”, place, color, linked clues and suspects. Time is set as dates or as “Day N, time”. The scale is by real time (zoom in, zoom out, fit) or with even spacing; ticks with dates or days. Cards are placed above and below the line by themselves; events at the same or close time go in a staircase. The GM can hide an event or show it only to players who have a linked clue. GMs and profilers drag events along the scale to change their time and drop a clue from the clue list onto the scale to create an event. Clicking an event opens its details with links to clues and dossiers. Old events keep their date; the manual “above / below” choice is no longer needed.
- GM Guide (compendium, English and Russian): updated pages on roles, search zones (chains, the labels toggle), handovers (whole folders), cases and the timeline, export; new pages “Clue folders”, “Theories and solution” and “Case progress”.
## 1.1.0 — 2026-11-19

- Clue folders in three places: the player's clue list, the GM library and each case. A folder has a name, any color and an icon (from a set of Font Awesome icons or any image). Subfolders up to 4 levels, manual order by dragging (drop on the top edge of a folder to place it before, on the rest to put it inside). The folder tree is on the left with “All” and “No folder”; counters include subfolders; collapsed folders are remembered on each client.
- A clue is in one folder. Moving: drag a clue onto a folder, “Move to folder” on the card, or “Move selected” in selection mode (the GM can now use selection mode in any player's list too).
- Search looks through all folders, and found clues show their folder path; sorting works inside the open folder. Clues that are found, given by the GM or handed over by a player land in “No folder”.
- Handing over a whole folder: the “Hand over the folder” button on a folder in your own list opens the usual recipient picker; the recipient accepts the folder only as a whole. The copy with its subfolders lands at the root; clues the recipient already has stay where they are and are not duplicated; a folder with the same name becomes “Name (2)”.
- The GM drags a library folder or another player's folder onto a player (in the GM window or in Foundry's player list): the player gets the same folder with subfolders and clues.
- Case folders: the GM and profilers create folders inside a case and drag a whole folder from their clue list into the case — the case gets the same structure, the clues are pinned to it, and clues already pinned elsewhere in the case move into the new folder. A player sees only case folders that contain their own clues. A closed case's folders do not change.
- Deleting a folder that is not empty shows its contents and offers “Delete only the folder” (contents move one level up) or deleting it together with the clues (in the library — with the templates, and the number of affected search zones is shown; in a case — unpinning the clues). A player can only delete the folder itself. Clues of a closed case are never deleted: they move one level up.
- Export and import include library folders and case folders; player folders, like player clues, are not exported.
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
