# Detective Story Reverse

A Foundry VTT v13 module for the dnd5e 5.3.3 system: players search scenes for clues, collect them in a personal list, hand them to each other and pin them to a clue board with threads, while the GM and profilers keep cases, suspect dossiers and timelines.

The interface is available in English and Russian: the language follows the Foundry client language. Русская версия: `README.ru.md`.

The module is a deep rework of the Investigation Re:Verse prototype. The board engine and focus mode come from the prototype (the board is based on Investigation Board by Mordachai, MIT); clue storage, handovers, windows and checks were rewritten.

## Installation

1. Install and enable the **socketlib** module.
2. In Foundry: “Add-on Modules → Install Module” and paste the manifest URL:
   `https://github.com/Paragon-Re-verse/detective-story-reverse/releases/latest/download/module.json`
3. Enable the module in a dnd5e world.

## Features

- **Clues and types.** The GM creates clues in the GM window: image, name, type, description, tags; detection settings; the board card kind with a live preview. Built-in type icons and custom types.
- **Search zones.** Any tile becomes a zone on the “Clue” tab of its settings. Modes “Background, no token” and “Battle map with token” (with a distance check). Skill, ability or formula rolls through dnd5e, a limited number of attempts, remaining attempts are hidden from players. The GM sees labels above zones: clue, check, DC, radius and attempts.
- **Focus mode.** Each player turns it on; zones of the current scene where they haven't found anything yet are highlighted. A cursor hint: “Examine”, “Select your token” or “Get closer: ≈ N ft more”.
- **Player clue list.** Tiles or rows, sorting (newest, by name, by type, by case), search by name and tags, type filter, “new” badge, personal notes (with an icon on the card), “Show in chat”, “Place on the board”, handing over one clue or a selection.
- **Clue folders** in the player's list, the GM library and every case: name, color, an icon or image, subfolders up to 4 levels, manual order, drag and drop. A whole folder can be handed to another player, given by the GM to a player, or moved by a profiler from their list into a case.
- **Giving and handing over.** The GM gives clues instantly (including to offline players), also by dragging a template from the library onto a player. Players hand clues to each other without a GM: “Yes / No” windows one at a time, a duplicate warning, and a whisper to the GM.
- **Discovery animation** in the middle of the screen (can be turned off in the module settings).
- **Suspect dossiers** with personal notes for each player. A deleted dossier stays in its cases as an archived suspect.
- **Clue chains**: a zone can require clues; until a player has them, the zone does not exist for them. A one-click “Zone labels” toggle for the GM.
- **Theories and solution**: profilers put forward theories (suspects, motive, method, clues); the GM compares them with the case solution, marks them correct or wrong and decides whether to reveal the solution when closing the case.
- **Clue levels**: up to 6 levels of information per clue, opened by the GM or by the player with “Study”.
- **Several cases at once**: case members, case tabs, a dossier archive and case filters in the GM window for long campaigns.
- **Case progress** for the GM and profilers: a “clue × players” table with places, chains and attempts.
- **Cases, timeline, archive.** Numbered cases, pinning clues by drag and drop, case tags on players' clues, closing and reopening (a closed case does not change), a timeline by real time or with even spacing (intervals, places, colors, linked clues and suspects, hidden events and events shown by clue), an archive of closed cases and archived suspects by case.
- **Clue board.** Clue cards of six kinds (including a VHS video cassette with an .mp4/.webm file that plays in a player with a tape effect, and the GM can show it to everyone), sticky notes, suspect photo cards, threads in a chosen color, “Details”, ready-made scenes in a compendium. While drawing a thread, right-click an empty spot to create any kind of card there (or place a clue or a suspect) already connected.
- **Stamps.** Right-click a photo card, index card, sticky note or handout → “Stamp”: Classified, Missing, a hand-drawn X, Evidence, Deceased, Redacted, or Remove stamp. The stamp lands under the cursor. The stamp folder and color are module settings, so you can add your own stamps (white .webp with transparency).
- **Event log** for the GM: discoveries, failed searches, handovers, board placements, clues given, cases — one filterable feed.
- **Export and import** of GM data to JSON, keeping ids.
- **GM guide** — a journal in the module compendium, in English and Russian.

## Permissions

| Action | GM | Profiler | Player |
|---|---|---|---|
| Templates, types, zones | yes | no | no |
| Searching for clues | yes | yes | yes |
| Giving, editing and deleting a player's clues | yes | no | no |
| Handing over own clues | no | yes | yes |
| Dossiers: create and edit | yes | yes | read |
| Creating cases | yes | by setting | no |
| Editing cases and timelines | yes | yes | read |
| Deleting board cards | yes | no | no |
| Folders in a clue list | any player's | own | own |
| Case folders | yes | yes | read |
| Theories | decides | puts forward, sees own | no |
| Case progress | everything | only found clues | no |

Profilers are chosen in the module settings. The restrictions rely on Foundry permissions: a player writes only to their own flags, shared journals belong to the GM and profilers, and actions relayed through the GM (socketlib) are checked on the GM's side.

## What needs a GM online

A profiler creating a new case or dossier and, if the player role lacks the “Drawings”, “Browse files” and “Upload files” permissions, creating and editing other people's board cards. Searching, the clue list, notes, handovers and editing existing cases and dossiers work without a GM.

## Fonts

The card fonts with Cyrillic support (Caveat, Marck Script, Neucha, Bad Script, Amatic SC, PT Mono, IBM Plex Mono, Fira Mono, Roboto Mono) ship with the module under the SIL OFL 1.1 license (`assets/fonts/LICENSE-OFL.txt`). Cards using the prototype's fonts without Cyrillic automatically get a replacement of the same style.

## License

MIT, see `LICENSE` (the Investigation Board notice, Mordachai 2024, is kept).
