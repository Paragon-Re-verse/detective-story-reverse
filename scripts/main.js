import { MODULE_ID, TEMPLATE_PATH, SCHEMA_VERSION } from "./constants.js";
import { localize, format } from "./i18n.js";
import { registerSettings, getSetting, setSetting, SETTING_KEYS } from "./settings.js";
import { isResponsibleGameMaster } from "./permissions.js";
import { initializeSocket } from "./socket.js";
import { registerSceneControls, registerKeybindings } from "./controls.js";
import { getChangedSectionKeys } from "./data/user-flags.js";
import { ensureAllModuleFolders, getModuleFolderIds } from "./data/folders.js";
import { countNewPlayerClues, getPlayerClue } from "./data/player-clues.js";
import { syncCollaboratorOwnership } from "./data/shared-journals.js";
import { initializeZoneClicks, initializeZoneHoverHint, hideZoneHint } from "./canvas/zone-search.js";
import { refreshZone, refreshAllZones, resetHighlightsForNewCanvas } from "./canvas/focus-mode.js";
import { initializeFindAnimationWatcher, onOwnCluesChanged } from "./canvas/find-animation.js";
import { registerZoneTab, onRenderTileConfig } from "./canvas/zone-tab.js";
import { ProfilersConfig, PermissionsWarning } from "./apps/settings-apps.js";
import { synchronizeTransfers } from "./apps/transfer-dialogs.js";
import { openClueList } from "./apps/clue-list.js";
import { openCaseJournal } from "./apps/case-journal.js";
import { onCaseSolutionRevealed } from "./apps/case-theories.js";
import { openGameMasterWindow, registerTemplateDropOnPlayersList } from "./apps/gm-window.js";
import { registerBoardInit, registerBoardHooks, preloadBoardFonts } from "./board/board-main.js";
import { syncStampFiles } from "./board/stamps.js";

/**
 * Detective Story Reverse — точка входа: регистрация настроек, хуков и окон.
 */

const PARTIAL_TEMPLATES = {
  "dsr-clue-list-item": `${TEMPLATE_PATH}/partials/clue-list-item.hbs`,
  "dsr-detection-fields": `${TEMPLATE_PATH}/partials/detection-fields.hbs`,
  "dsr-swatches": `${TEMPLATE_PATH}/partials/swatches.hbs`,
  "dsr-vhs-screen": `${TEMPLATE_PATH}/partials/vhs-screen.hbs`,
  "dsr-folder-tree": `${TEMPLATE_PATH}/partials/folder-tree.hbs`,
  "dsr-folder-node": `${TEMPLATE_PATH}/partials/folder-node.hbs`,
  "dsr-theory-summary": `${TEMPLATE_PATH}/partials/theory-summary.hbs`,
  "dsr-check-field": `${TEMPLATE_PATH}/partials/check-field.hbs`,
  "dsr-picker": `${TEMPLATE_PATH}/partials/picker.hbs`,
  "dsr-mini-clue": `${TEMPLATE_PATH}/partials/mini-clue.hbs`
};

/** Изменился список профайлеров: ГМ переписывает права общих журналов. */
function onProfilersChange() {
  if (isResponsibleGameMaster()) syncCollaboratorOwnership();
  ui.controls?.render({ reset: true });
}

Hooks.once("init", () => {
  registerSettings({ profilersConfig: ProfilersConfig, permissionsWarning: PermissionsWarning }, onProfilersChange);
  registerBoardInit();
  registerKeybindings();
  registerSceneControls();
  registerZoneTab();
  registerBoardHooks();
  foundry.applications.handlebars.loadTemplates(PARTIAL_TEMPLATES);
});

Hooks.once("socketlib.ready", () => initializeSocket());

Hooks.once("ready", async () => {
  if (game.system.id !== "dnd5e") {
    ui.notifications.error(localize("Notify.WrongSystem"), { permanent: true });
  }
  initializeZoneClicks();
  initializeZoneHoverHint();
  initializeFindAnimationWatcher();
  preloadBoardFonts();

  if (isResponsibleGameMaster()) {
    await ensureAllModuleFolders();
    if (getSetting(SETTING_KEYS.schemaVersion) !== SCHEMA_VERSION) await setSetting(SETTING_KEYS.schemaVersion, SCHEMA_VERSION);
    ui.journal?.render();
    // Список штампов перечитывается при каждом входе ГМ: в папку могли добавить свои картинки.
    syncStampFiles();
  }

  if (game.user.isGM && getSetting(SETTING_KEYS.showSetupWarning) && PermissionsWarning.hasRestrictedPlayers()) {
    new PermissionsWarning().render({ force: true });
  }

  if (!game.user.isGM) {
    const newClueCount = countNewPlayerClues(game.user);
    if (newClueCount) ui.notifications.info(format("Notify.NewClues", { count: newClueCount }));
    synchronizeTransfers();
  }

  registerTemplateDropOnPlayersList();

  game.modules.get(MODULE_ID).api = { openClueList, openCaseJournal, openGameMasterWindow };
});

Hooks.on("updateUser", (user, changes) => {
  if (!changes.flags?.[MODULE_ID]) return;
  if (user.id === game.user.id) {
    if (getChangedSectionKeys(changes, "clues")) {
      notifyOpenedLevels(user, changes);
      onOwnCluesChanged();
      refreshAllZones();
      hideZoneHint();
    }
    if (getChangedSectionKeys(changes, "zoneState")) {
      refreshAllZones();
      hideZoneHint();
    }
  }
  if (getChangedSectionKeys(changes, "outbox") || getChangedSectionKeys(changes, "receipts")) synchronizeTransfers();
});

/** Игроку открыли уровень улики (ГМ или сам через «Изучить») — уведомление (п. 8). */
function notifyOpenedLevels(user, changes) {
  for (const [originId, clueChanges] of Object.entries(changes.flags[MODULE_ID].clues ?? {})) {
    for (const [levelKey, isOpen] of Object.entries(clueChanges?.openLevels ?? {})) {
      if (levelKey.startsWith("-=") || isOpen !== true) continue;
      const clueName = getPlayerClue(user, originId)?.name ?? "";
      ui.notifications.info(format("Levels.Opened", { clue: clueName, level: levelKey }));
    }
  }
}

Hooks.on("canvasReady", () => resetHighlightsForNewCanvas());
Hooks.on("drawTile", (tileObject) => refreshZone(tileObject));
Hooks.on("refreshTile", (tileObject) => refreshZone(tileObject));
Hooks.on("updateTile", (tileDocument) => {
  if (tileDocument.object) refreshZone(tileDocument.object);
});

Hooks.on("renderTileConfig", (application, element) => onRenderTileConfig(application, element));

/** Переименовали или удалили шаблон улики — подписи зон у ГМ показывают актуальное название. */
function onTemplateJournalChanged(journalEntry) {
  if (game.user.isGM && journalEntry.flags?.[MODULE_ID]?.template) refreshAllZones();
}
Hooks.on("createJournalEntry", onTemplateJournalChanged);
// ГМ открыл развязку дела — окно у каждого, кто в сети (в чате она остаётся для остальных).
Hooks.on("updateJournalEntry", (journalEntry, changes) => onCaseSolutionRevealed(journalEntry, changes));
Hooks.on("updateJournalEntry", onTemplateJournalChanged);
Hooks.on("deleteJournalEntry", onTemplateJournalChanged);

/** Служебные папки модуля в боковой панели журналов не показываются: данные правятся в окнах модуля. */
Hooks.on("renderJournalDirectory", (application, element) => {
  for (const folderId of getModuleFolderIds()) {
    element.querySelector(`.folder[data-folder-id="${folderId}"]`)?.remove();
  }
});
