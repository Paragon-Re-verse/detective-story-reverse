import { MODULE_ID, TEMPLATE_PATH, SEARCH_DEBOUNCE_MS } from "../constants.js";
import { localize, format, fullKey } from "../i18n.js";
import { DetectiveApplication, openSingleton } from "./base-application.js";
import { getPlayerUsers, isProfiler } from "../permissions.js";
import { SETTING_KEYS } from "../settings.js";
import { getChangedSectionKeys } from "../data/user-flags.js";
import { listPlayerClues, getPlayerClue, deletePlayerClue, grantCluesFromTemplates } from "../data/player-clues.js";
import { listClueTemplates, deleteClueTemplate, getClueTemplate } from "../data/clue-templates.js";
import { getClueType, getClueTypeList, deleteCustomClueType } from "../data/clue-types.js";
import { listAllZones, getZoneState, resetZoneForUsers, resetAllZonesForUser } from "../data/zones.js";
import { isClueLockedByClosedCase, buildCaseIndex, listCases, canSeeCase, getCaseLabel, CASE_STATUS } from "../data/cases.js";
import { buildCaseClueSets } from "../data/case-progress.js";
import { describeLevelProgress } from "../data/clue-levels.js";
import { editPlayerLevelsDialog, setLevelForHoldersDialog } from "./level-dialogs.js";
import { attachContextMenu } from "./context-menu.js";
import { showBoardContextMenu } from "../board/threads.js";
import { TEMPLATE_CANVAS_DROP_TYPE } from "../canvas/zone-drop.js";
import { getUserCharacterName } from "../data/transfers.js";
import {
  downloadExport,
  parseImportText,
  summarizeImport,
  countImportConflicts,
  applyImport,
  resetModuleData,
  InvalidImportError,
  CONFLICT_MODES
} from "../data/export-import.js";
import { openClueList } from "./clue-list.js";
import { openClueView } from "./clue-view.js";
import { openTemplateEditor, openPlayerClueEditor } from "./clue-editor.js";
import { editClueTypeDialog } from "./clue-type-dialog.js";
import { pickRecipients } from "./transfer-dialogs.js";
import { openEventLog } from "./event-log.js";
import { getFolderScope, moveItemsToFolder, copyFolderToUser, FOLDER_SCOPES } from "../data/clue-folders.js";
import { resolveFolderId, getFolderPath } from "../data/folder-tree.js";
import {
  prepareFolderTree,
  attachFolderTree,
  matchesSelectedFolder,
  validateSelectedFolder,
  pickFolderDialog,
  isFolderDrag,
  readFolderDrag,
  toRealFolderId,
  ALL_FOLDERS
} from "./folder-tree.js";

const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

/** Тип данных перетаскивания шаблона: по нему зона броска узнаёт шаблон ещё до отпускания (getData там недоступен). */
const TEMPLATE_DRAG_TYPE = "application/x-detective-story-template";
/** Через сколько вкладка «Игроки» открывается сама, если держать шаблон над её заголовком. */
const TAB_SPRING_DELAY_MS = 450;

/** Перетаскивается ли сейчас шаблон из библиотеки. @param {DragEvent} event */
function isTemplateDrag(event) {
  return Boolean(event.dataTransfer?.types?.includes(TEMPLATE_DRAG_TYPE));
}

/**
 * Выдать шаблон игроку, на которого его бросили.
 * @param {string} templateId
 * @param {string} userId
 */
async function grantTemplateByDrop(templateId, userId) {
  const playerUser = game.users.get(userId);
  const template = getClueTemplate(templateId);
  if (!playerUser || !template) return;
  if (playerUser.isGM) {
    ui.notifications.warn(localize("Grant.OnlyPlayers"));
    return;
  }
  const addedCount = await grantCluesFromTemplates([templateId], [userId]);
  if (addedCount) {
    ui.notifications.info(format("Grant.DroppedTo", { clue: template.name, name: playerUser.name }));
  } else {
    ui.notifications.info(format("Grant.AlreadyHas", { clue: template.name, name: playerUser.name }));
  }
}

/**
 * Бросили папку на игрока: папка библиотеки или папка другого игрока копируется ему целиком (пп. 11, 33).
 * @param {DragEvent} event
 * @param {string} userId
 */
async function copyFolderByDrop(event, userId) {
  const folderDrag = readFolderDrag(event);
  const playerUser = game.users.get(userId);
  if (!folderDrag || !playerUser) return;
  if (playerUser.isGM) {
    ui.notifications.warn(localize("Grant.OnlyPlayers"));
    return;
  }
  if (folderDrag.scopeType !== FOLDER_SCOPES.library && folderDrag.scopeType !== FOLDER_SCOPES.user) return;
  const sourceScope = getFolderScope(folderDrag.scopeType, folderDrag.scopeOwner);
  if (sourceScope) await copyFolderToUser(sourceScope, folderDrag.folderId, playerUser);
}

/**
 * Зона броска шаблона или папки на элементе с data-user-id (строка игрока в окне ГМ или в списке игроков Foundry).
 * @param {HTMLElement} element
 */
function attachTemplateDrop(element) {
  element.addEventListener("dragover", (event) => {
    if (!isTemplateDrag(event) && !isFolderDrag(event)) return;
    event.preventDefault();
    element.classList.add("template-drop-target");
  });
  element.addEventListener("dragleave", (event) => {
    if (!element.contains(event.relatedTarget)) element.classList.remove("template-drop-target");
  });
  element.addEventListener("drop", (event) => {
    if (isFolderDrag(event)) {
      event.preventDefault();
      element.classList.remove("template-drop-target");
      copyFolderByDrop(event, element.dataset.userId);
      return;
    }
    if (!isTemplateDrag(event)) return;
    event.preventDefault();
    element.classList.remove("template-drop-target");
    grantTemplateByDrop(event.dataTransfer.getData(TEMPLATE_DRAG_TYPE), element.dataset.userId);
  });
}

/** Шаблон можно бросить и на имя игрока в штатном списке игроков Foundry (внизу слева, виден всегда). */
export function registerTemplateDropOnPlayersList() {
  if (!game.user.isGM) return;
  Hooks.on("renderPlayers", (application, element) => {
    for (const playerElement of element.querySelectorAll("[data-user-id]")) attachTemplateDrop(playerElement);
  });
  ui.players?.render();
}

/**
 * Окно ГМ: вкладки «Игроки» (улики игрока, расход попыток, выдача, сброс),
 * «Библиотека» (шаблоны улик) и «Типы» (иконки и названия типов). Экспорт, импорт и сброс данных.
 */
export class GameMasterWindow extends DetectiveApplication {
  constructor(options = {}) {
    super({ ...options, id: "detective-story-gm-window" });
    this.selectedPlayerId = getPlayerUsers()[0]?.id ?? null;
    this.librarySearch = "";
    this.selectedLibraryFolderId = ALL_FOLDERS;
    /** Фильтр по делу (п. 15): auto — дела выбранного игрока, case:<id>, all. */
    this.playerCaseFilter = "auto";
    this.playerClueSearch = "";
    this.onlyTouchedZones = true;
    /** Библиотека: active — улики открытых дел и улики вне дел, case:<id>, all. */
    this.libraryCaseFilter = "active";
  }

  static DEFAULT_OPTIONS = {
    classes: ["gm-window"],
    window: { icon: "fa-solid fa-user-tie", resizable: true, title: fullKey("GameMasterWindow.Title") },
    position: { width: 820, height: 680 },
    actions: {
      selectPlayer: GameMasterWindow.#onSelectPlayer,
      openPlayerList: GameMasterWindow.#onOpenPlayerList,
      grantToPlayer: GameMasterWindow.#onGrantToPlayer,
      viewPlayerClue: GameMasterWindow.#onViewPlayerClue,
      editPlayerClue: GameMasterWindow.#onEditPlayerClue,
      deletePlayerClue: GameMasterWindow.#onDeletePlayerClue,
      resetZone: GameMasterWindow.#onResetZone,
      resetZoneAllPlayers: GameMasterWindow.#onResetZoneAllPlayers,
      resetAllZones: GameMasterWindow.#onResetAllZones,
      newTemplate: GameMasterWindow.#onNewTemplate,
      editTemplate: GameMasterWindow.#onEditTemplate,
      deleteTemplate: GameMasterWindow.#onDeleteTemplate,
      grantTemplate: GameMasterWindow.#onGrantTemplate,
      moveTemplate: GameMasterWindow.#onMoveTemplate,
      editPlayerLevels: GameMasterWindow.#onEditPlayerLevels,
      openTemplateMenu: GameMasterWindow.#onOpenTemplateMenu,
      openDataMenu: GameMasterWindow.#onOpenDataMenu,
      newType: GameMasterWindow.#onNewType,
      editType: GameMasterWindow.#onEditType,
      deleteType: GameMasterWindow.#onDeleteType,
      openEventLog: () => openEventLog(),
      exportData: GameMasterWindow.#onExportData,
      importData: GameMasterWindow.#onImportData,
      resetData: GameMasterWindow.#onResetData
    }
  };

  static PARTS = {
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    players: { template: `${TEMPLATE_PATH}/apps/gm-players.hbs`, scrollable: [".player-details"] },
    library: { template: `${TEMPLATE_PATH}/apps/gm-library.hbs`, scrollable: [".template-list", ".dsr-folder-tree"] },
    types: { template: `${TEMPLATE_PATH}/apps/gm-types.hbs`, scrollable: [".type-list"] },
    footer: { template: `${TEMPLATE_PATH}/apps/gm-footer.hbs` }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "players", icon: "fa-solid fa-users", label: fullKey("GameMasterWindow.Tabs.players") },
        { id: "library", icon: "fa-solid fa-book", label: fullKey("GameMasterWindow.Tabs.library") },
        { id: "types", icon: "fa-solid fa-tags", label: fullKey("GameMasterWindow.Tabs.types") }
      ],
      initial: "players"
    }
  };

  /**
   * Данные готовятся по вкладкам: при частичной перерисовке считается только нужная вкладка.
   * @inheritDoc
   */
  async _preparePartContext(partId, context, options) {
    const partContext = await super._preparePartContext(partId, context, options);
    if (partContext.tabs?.[partId]) partContext.tab = partContext.tabs[partId];
    if (partId === "players") {
      partContext.players = this.#preparePlayers();
      partContext.selectedPlayer = this.#prepareSelectedPlayer();
      partContext.caseFilterChoices = this.#buildCaseFilterChoices("auto", localize("GameMasterWindow.FilterPlayerCases"));
      partContext.playerCaseFilter = this.playerCaseFilter;
      partContext.playerClueSearch = this.playerClueSearch;
      partContext.onlyTouchedZones = this.onlyTouchedZones;
    } else if (partId === "library") {
      this.libraryFolders = this.libraryScope.readFolders();
      this.selectedLibraryFolderId = validateSelectedFolder(this.libraryFolders, this.selectedLibraryFolderId);
      partContext.templates = this.#prepareTemplates();
      partContext.librarySearch = this.librarySearch;
      partContext.folderTree = prepareFolderTree(this.libraryScope, { selectedFolderId: this.selectedLibraryFolderId });
      partContext.libraryCaseFilterChoices = this.#buildCaseFilterChoices("active", localize("GameMasterWindow.FilterActiveCases"));
      partContext.libraryCaseFilter = this.libraryCaseFilter;
    } else if (partId === "types") {
      partContext.clueTypes = getClueTypeList();
    }
    return partContext;
  }

  get libraryScope() {
    return getFolderScope(FOLDER_SCOPES.library);
  }

  #preparePlayers() {
    return getPlayerUsers().map((playerUser) => {
      return {
        id: playerUser.id,
        name: playerUser.name,
        characterName: getUserCharacterName(playerUser),
        portrait: playerUser.character?.img || playerUser.avatar || CONST.DEFAULT_TOKEN,
        active: playerUser.active,
        profiler: isProfiler(playerUser),
        clueCount: listPlayerClues(playerUser).length,
        selected: playerUser.id === this.selectedPlayerId
      };
    });
  }

  /** Варианты фильтра по делу: «по умолчанию», открытые дела и «Все». */
  #buildCaseFilterChoices(defaultKey, defaultLabel) {
    const choices = { [defaultKey]: defaultLabel };
    for (const caseData of listCases({ includeClosed: false })) {
      choices[`case:${caseData.id}`] = `${getCaseLabel(caseData)} ${format("Common.Quoted", { text: caseData.title })}`;
    }
    choices.all = localize("GameMasterWindow.FilterAll");
    return choices;
  }

  /**
   * Какие улики показать при фильтре: null — все. Иначе множество улик выбранных дел.
   * @param {string} filter
   * @param {User|null} playerUser - для «дел игрока»
   */
  #resolveCaseClueFilter(filter, playerUser, caseClueSets) {
    if (filter === "all") return null;
    let caseIds = [];
    if (filter.startsWith("case:")) {
      caseIds = [filter.slice("case:".length)];
    } else {
      caseIds = listCases({ includeClosed: false })
        .filter((caseData) => !playerUser || canSeeCase(caseData, playerUser))
        .map((caseData) => caseData.id);
    }
    const clueIds = new Set();
    for (const caseId of caseIds) {
      for (const clueId of caseClueSets.sets.get(caseId) ?? []) clueIds.add(clueId);
    }
    return clueIds;
  }

  #prepareSelectedPlayer() {
    const playerUser = game.users.get(this.selectedPlayerId);
    if (!playerUser) return null;
    const caseIndex = buildCaseIndex();
    const caseClueSets = buildCaseClueSets();
    if (this.playerCaseFilter !== "auto" && this.playerCaseFilter !== "all" && !caseClueSets.sets.has(this.playerCaseFilter.slice(5))) this.playerCaseFilter = "auto";
    const filterClueIds = this.#resolveCaseClueFilter(this.playerCaseFilter, playerUser, caseClueSets);
    const clues = [];
    const otherClues = [];
    for (const playerClue of listPlayerClues(playerUser)) {
      const clueType = getClueType(playerClue.typeId);
      const locked = (caseIndex.get(playerClue.originId) ?? []).some((caseData) => caseData.status === CASE_STATUS.closed);
      const levelProgress = describeLevelProgress(playerClue);
      let levelLabel = "";
      if (levelProgress.total > 1) levelLabel = `${levelProgress.open}/${levelProgress.total}`;
      const clueEntry = {
        ...playerClue,
        typeName: clueType.name,
        typeIcon: clueType.icon,
        locked,
        levelLabel,
        searchIndex: [playerClue.name, ...(playerClue.tags ?? [])].join(" ").toLocaleLowerCase(game.i18n.lang)
      };
      // Улики вне всех дел — свёрнутой группой «Без дела» (п. 17); улики других дел скрыты.
      if (!filterClueIds || filterClueIds.has(playerClue.originId)) {
        clues.push(clueEntry);
      } else if (!caseClueSets.inAnyCase.has(playerClue.originId)) {
        otherClues.push(clueEntry);
      }
    }
    const zones = listAllZones()
      .filter(({ zone }) => !filterClueIds || filterClueIds.has(zone.templateId))
      .map(({ scene, tile, zone, templateName }) => {
        const zoneState = getZoneState(playerUser, tile.id);
        let attemptsLabel = format("GameMasterWindow.AttemptsOf", { used: zoneState.attempts, max: zone.detection.maxAttempts });
        if (!zone.detection.maxAttempts) attemptsLabel = format("GameMasterWindow.AttemptsUnlimited", { used: zoneState.attempts });
        return {
          tileId: tile.id,
          sceneName: scene.name,
          templateName,
          attemptsLabel,
          found: zoneState.found,
          touched: zoneState.attempts > 0 || zoneState.found
        };
      })
      .filter((zoneEntry) => !this.onlyTouchedZones || zoneEntry.touched);
    return { id: playerUser.id, name: playerUser.name, characterName: getUserCharacterName(playerUser), clues, otherClues, zones };
  }

  #prepareTemplates() {
    const caseClueSets = buildCaseClueSets();
    if (this.libraryCaseFilter.startsWith("case:") && !caseClueSets.sets.has(this.libraryCaseFilter.slice(5))) this.libraryCaseFilter = "active";
    const filterClueIds = this.#resolveCaseClueFilter(this.libraryCaseFilter, null, caseClueSets);
    return listClueTemplates().map((template) => {
      const clueType = getClueType(template.typeId);
      // Улики закрытых и чужих дел скрыты; улики вне дел видны всегда — иначе новая улика пропала бы из виду.
      const caseVisible = !filterClueIds || filterClueIds.has(template.id) || !caseClueSets.inAnyCase.has(template.id);
      return {
        caseVisible,
        levelCount: template.levels.length + 1,
        ...template,
        typeName: clueType.name,
        typeIcon: clueType.icon,
        zoneModeLabel: localize(`ZoneMode.${template.detection.zoneMode}`),
        kindLabel: localize(`Kind.${template.visual.kind}`),
        folderId: resolveFolderId(this.libraryFolders, template.folderId) ?? "",
        folderPath: getFolderPath(this.libraryFolders, template.folderId),
        searchIndex: [template.name, ...template.tags].join(" ").toLocaleLowerCase(game.i18n.lang)
      };
    });
  }

  /** @inheritDoc */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);

    this.subscribe("updateUser", (user, changes) => {
      if (user.isGM) return;
      if ("active" in changes || "character" in changes || "name" in changes) {
        this.queuePartRender("players");
        return;
      }
      if (!changes.flags?.[MODULE_ID]) return;
      // Записи журнала событий и передач вкладку не меняют: перерисовка только по уликам и попыткам.
      const cluesChanged = getChangedSectionKeys(changes, "clues") !== null;
      const zonesChanged = getChangedSectionKeys(changes, "zoneState") !== null;
      if (cluesChanged || (zonesChanged && user.id === this.selectedPlayerId)) this.queuePartRender("players");
    });

    const onJournalChanged = (journalEntry) => {
      const moduleFlags = journalEntry.flags?.[MODULE_ID];
      if (moduleFlags?.template) this.queuePartRender("library", "players");
      else if (moduleFlags?.case) this.queuePartRender("players");
    };
    this.subscribe("createJournalEntry", onJournalChanged);
    this.subscribe("updateJournalEntry", onJournalChanged);
    this.subscribe("deleteJournalEntry", onJournalChanged);

    const onTileChanged = (tileDocument, changes) => {
      if (tileDocument.flags?.[MODULE_ID] || changes?.flags?.[MODULE_ID]) this.queuePartRender("players");
    };
    this.subscribe("createTile", onTileChanged);
    this.subscribe("updateTile", onTileChanged);
    this.subscribe("deleteTile", onTileChanged);

    this.subscribe("updateSetting", (setting) => {
      if (setting.key === `${MODULE_ID}.${SETTING_KEYS.clueTypes}`) this.queuePartRender("players", "library", "types");
      if (setting.key === `${MODULE_ID}.${SETTING_KEYS.profilers}`) this.queuePartRender("players");
      if (setting.key === `${MODULE_ID}.${SETTING_KEYS.libraryFolders}`) this.queuePartRender("library");
    });
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    if (options.parts?.includes("players")) {
      for (const playerRow of this.element.querySelectorAll(".player-row[data-user-id]")) attachTemplateDrop(playerRow);
      this.#attachPlayerFilters();
    }
    if (options.parts?.includes("tabs")) this.#attachTabSpring();
    if (!options.parts?.includes("library")) return;
    attachFolderTree(this.element.querySelector(".gm-library"), {
      getScope: () => this.libraryScope,
      onSelect: (folderId) => {
        this.selectedLibraryFolderId = folderId;
        for (const nodeElement of this.element.querySelectorAll(".gm-library .folder-node")) {
          nodeElement.classList.toggle("selected", nodeElement.dataset.folderId === folderId);
        }
        this.#applyLibraryFilter();
      },
      onDrop: async (event, folderId) => {
        const templateId = event.dataTransfer.getData(TEMPLATE_DRAG_TYPE);
        if (templateId) await moveItemsToFolder(this.libraryScope, [templateId], folderId);
      }
    });
    this.element.querySelector("select[name='libraryCaseFilter']")?.addEventListener("change", (event) => {
      this.libraryCaseFilter = event.target.value;
      this.render({ parts: ["library"] });
    });
    attachContextMenu(this.element.querySelector(".template-list"), ".template-row", (rowElement) => this.#buildTemplateMenu(rowElement));
    for (const templateRow of this.element.querySelectorAll(".template-row[draggable]")) {
      templateRow.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData(TEMPLATE_DRAG_TYPE, templateRow.dataset.templateId);
        // Для броска на сцену: Foundry передаёт канве JSON из text/plain (п. 6 — улика на сцене становится зоной).
        event.dataTransfer.setData("text/plain", JSON.stringify({ type: TEMPLATE_CANVAS_DROP_TYPE, templateId: templateRow.dataset.templateId }));
        event.dataTransfer.effectAllowed = "copy";
      });
    }
    const searchInput = this.element.querySelector("input[name='librarySearch']");
    const applySearch = foundry.utils.debounce(() => {
      this.librarySearch = searchInput.value.trim().toLocaleLowerCase(game.i18n.lang);
      this.#applyLibraryFilter();
    }, SEARCH_DEBOUNCE_MS);
    searchInput?.addEventListener("input", applySearch);
    this.#applyLibraryFilter();
  }

  /** Шаблон держат над заголовком «Игроки» — вкладка открывается сама, чтобы бросить его на игрока. */
  #attachTabSpring() {
    const playersTab = this.element.querySelector("nav [data-tab='players']");
    if (!playersTab) return;
    let springTimer = null;
    playersTab.addEventListener("dragenter", (event) => {
      if ((!isTemplateDrag(event) && !isFolderDrag(event)) || springTimer) return;
      springTimer = window.setTimeout(() => {
        springTimer = null;
        this.changeTab("players", "primary");
      }, TAB_SPRING_DELAY_MS);
    });
    playersTab.addEventListener("dragover", (event) => {
      if (isTemplateDrag(event) || isFolderDrag(event)) event.preventDefault();
    });
    playersTab.addEventListener("dragleave", () => {
      window.clearTimeout(springTimer);
      springTimer = null;
    });
  }

  /** Поиск идёт по всем папкам (у найденного шаблона виден путь папки), без поиска — только выбранная папка. */
  #applyLibraryFilter() {
    const searching = Boolean(this.librarySearch);
    this.element.querySelector(".template-list")?.classList.toggle("show-folder", searching || this.selectedLibraryFolderId === ALL_FOLDERS);
    for (const rowElement of this.element.querySelectorAll(".template-row")) {
      let visible = rowElement.dataset.caseVisible === "1" && matchesSelectedFolder(this.libraryFolders ?? {}, rowElement.dataset.folderId || null, this.selectedLibraryFolderId);
      if (searching) visible = rowElement.dataset.search.includes(this.librarySearch);
      rowElement.hidden = !visible;
    }
  }

  /** Фильтры вкладки «Игроки»: дело, поиск по уликам, «только зоны с попытками». */
  #attachPlayerFilters() {
    this.element.querySelector("select[name='playerCaseFilter']")?.addEventListener("change", (event) => {
      this.playerCaseFilter = event.target.value;
      this.render({ parts: ["players"] });
    });
    this.element.querySelector("input[name='onlyTouchedZones']")?.addEventListener("change", (event) => {
      this.onlyTouchedZones = event.target.checked;
      this.render({ parts: ["players"] });
    });
    // Галочка внутри <summary>: клик по ней не должен сворачивать раздел.
    this.element.querySelector("input[name='onlyTouchedZones']")?.closest("label")?.addEventListener("click", (event) => event.stopPropagation());
    const searchInput = this.element.querySelector("input[name='playerClueSearch']");
    const applySearch = () => {
      this.playerClueSearch = searchInput.value.trim().toLocaleLowerCase(game.i18n.lang);
      for (const rowElement of this.element.querySelectorAll(".mini-clue-list [data-search]")) {
        rowElement.hidden = Boolean(this.playerClueSearch) && !rowElement.dataset.search.includes(this.playerClueSearch);
      }
    };
    searchInput?.addEventListener("input", foundry.utils.debounce(applySearch, SEARCH_DEBOUNCE_MS));
    if (searchInput) applySearch();
  }

  /** Меню строки библиотеки (п. Б7): выдать, править, уровни у игроков, переместить, удалить. */
  #buildTemplateMenu(rowElement) {
    const call = (handler) => () => handler.call(this, null, rowElement);
    const templateId = rowElement.dataset.templateId;
    const menuItems = [
      { icon: "fa-solid fa-gift", label: localize("Grant.Button"), callback: call(GameMasterWindow.#onGrantTemplate) },
      { icon: "fa-solid fa-pen", label: localize("Common.Edit"), callback: call(GameMasterWindow.#onEditTemplate) }
    ];
    menuItems.push({ separator: true });
    menuItems.push({
      icon: "fa-solid fa-layer-group",
      label: localize("Levels.ForHolders"),
      callback: () => setLevelForHoldersDialog(templateId),
      disabled: Number(rowElement.dataset.levelCount) < 2,
      reason: localize("Levels.NoExtraLevels")
    });
    menuItems.push({ icon: "fa-solid fa-folder-tree", label: localize("ClueFolders.MoveTo"), callback: call(GameMasterWindow.#onMoveTemplate) });
    menuItems.push({ separator: true });
    menuItems.push({ icon: "fa-solid fa-trash", label: localize("Common.Delete"), callback: call(GameMasterWindow.#onDeleteTemplate), danger: true });
    return menuItems;
  }

  get selectedPlayer() {
    return game.users.get(this.selectedPlayerId);
  }

  static #onSelectPlayer(event, target) {
    this.selectedPlayerId = target.closest("[data-user-id]").dataset.userId;
    this.render({ parts: ["players"] });
  }

  static #onOpenPlayerList() {
    if (this.selectedPlayer) openClueList(this.selectedPlayer);
  }

  static async #onGrantToPlayer() {
    const playerUser = this.selectedPlayer;
    if (!playerUser) return;
    const templateIds = await pickTemplates();
    if (!templateIds) return;
    const addedCount = await grantCluesFromTemplates(templateIds, [playerUser.id]);
    ui.notifications.info(format("Grant.Done", { count: addedCount }));
  }

  static #onViewPlayerClue(event, target) {
    const originId = target.closest("[data-origin-id]").dataset.originId;
    if (this.selectedPlayer) openClueView(this.selectedPlayer, originId);
  }

  static #onEditPlayerClue(event, target) {
    const originId = target.closest("[data-origin-id]").dataset.originId;
    if (isClueLockedByClosedCase(originId)) {
      ui.notifications.warn(localize("Case.ClueLocked"));
      return;
    }
    if (this.selectedPlayer) openPlayerClueEditor(this.selectedPlayer, originId);
  }

  static async #onDeletePlayerClue(event, target) {
    const playerUser = this.selectedPlayer;
    const originId = target.closest("[data-origin-id]").dataset.originId;
    const playerClue = getPlayerClue(playerUser, originId);
    if (!playerClue) return;
    if (isClueLockedByClosedCase(originId)) {
      ui.notifications.warn(localize("Case.ClueLocked"));
      return;
    }
    const confirmed = await DialogV2.confirm({
      window: { title: localize("ClueList.DeleteTitle") },
      content: `<p>${format("ClueList.DeleteConfirm", { clue: foundry.utils.escapeHTML(playerClue.name), player: foundry.utils.escapeHTML(playerUser.name) })}</p>`,
      rejectClose: false
    });
    if (confirmed) await deletePlayerClue(playerUser, originId);
  }

  static async #onResetZone(event, target) {
    const tileId = target.closest("[data-tile-id]").dataset.tileId;
    if (!this.selectedPlayer) return;
    await resetZoneForUsers([this.selectedPlayer.id], tileId);
    ui.notifications.info(localize("Notify.AttemptsReset"));
  }

  static async #onResetZoneAllPlayers(event, target) {
    const tileId = target.closest("[data-tile-id]").dataset.tileId;
    await resetZoneForUsers(getPlayerUsers().map((playerUser) => playerUser.id), tileId);
    ui.notifications.info(localize("Notify.AttemptsReset"));
  }

  static async #onResetAllZones() {
    if (!this.selectedPlayer) return;
    await resetAllZonesForUser(this.selectedPlayer);
    ui.notifications.info(localize("Notify.AttemptsReset"));
  }

  /** Новая улика — сразу в открытой папке библиотеки (п. Б8). */
  static #onNewTemplate() {
    openTemplateEditor(undefined, { folderId: toRealFolderId(this.selectedLibraryFolderId) });
  }

  /** «Данные ▾»: экспорт, импорт и — отдельно, красным — сброс (п. 3). Сброс по-прежнему спрашивает подтверждение. */
  static #onOpenDataMenu(event, target) {
    const bounds = target.getBoundingClientRect();
    showBoardContextMenu(bounds.left, bounds.top, [
      { icon: "fa-solid fa-file-export", label: localize("DataTools.Export"), callback: () => downloadExport() },
      { icon: "fa-solid fa-file-import", label: localize("DataTools.Import"), callback: () => runImportFlow() },
      { separator: true },
      { icon: "fa-solid fa-trash", label: localize("DataTools.Reset"), callback: () => GameMasterWindow.#onResetData.call(this), danger: true }
    ]);
  }

  static #onOpenTemplateMenu(event, target) {
    const bounds = target.getBoundingClientRect();
    showBoardContextMenu(bounds.left, bounds.bottom, this.#buildTemplateMenu(target.closest(".template-row")));
  }

  static async #onEditPlayerLevels(event, target) {
    const originId = target.closest("[data-origin-id]").dataset.originId;
    if (this.selectedPlayer) await editPlayerLevelsDialog(this.selectedPlayer, originId);
  }

  static #onEditTemplate(event, target) {
    openTemplateEditor(target.closest("[data-template-id]").dataset.templateId);
  }

  static async #onDeleteTemplate(event, target) {
    const templateId = target.closest("[data-template-id]").dataset.templateId;
    const template = listClueTemplates().find((entry) => entry.id === templateId);
    if (!template) return;
    const confirmed = await DialogV2.confirm({
      window: { title: localize("Library.DeleteTitle") },
      content: `<p>${format("Library.DeleteConfirm", { name: foundry.utils.escapeHTML(template.name) })}</p>`,
      rejectClose: false
    });
    if (confirmed) await deleteClueTemplate(templateId);
  }

  static async #onGrantTemplate(event, target) {
    const templateId = target.closest("[data-template-id]").dataset.templateId;
    const recipientIds = await pickRecipients({ title: localize("Grant.PickTitle"), confirmLabel: localize("Grant.Confirm") });
    if (!recipientIds) return;
    const addedCount = await grantCluesFromTemplates([templateId], recipientIds);
    ui.notifications.info(format("Grant.Done", { count: addedCount }));
  }

  static async #onMoveTemplate(event, target) {
    const templateId = target.closest("[data-template-id]").dataset.templateId;
    const folderId = await pickFolderDialog(this.libraryScope);
    if (folderId !== undefined) await moveItemsToFolder(this.libraryScope, [templateId], folderId);
  }

  static async #onNewType() {
    await editClueTypeDialog();
  }

  static async #onEditType(event, target) {
    const typeId = target.closest("[data-type-id]").dataset.typeId;
    const clueType = getClueType(typeId);
    if (clueType.builtIn) return;
    await editClueTypeDialog(clueType);
  }

  static async #onDeleteType(event, target) {
    const typeId = target.closest("[data-type-id]").dataset.typeId;
    const clueType = getClueType(typeId);
    if (clueType.builtIn) return;
    const confirmed = await DialogV2.confirm({
      window: { title: localize("ClueTypes.DeleteTitle") },
      content: `<p>${format("ClueTypes.DeleteConfirm", { name: foundry.utils.escapeHTML(clueType.name) })}</p>`,
      rejectClose: false
    });
    if (confirmed) await deleteCustomClueType(typeId);
  }

  static #onExportData() {
    downloadExport();
  }

  static async #onImportData() {
    await runImportFlow();
  }

  static async #onResetData() {
    const content = await renderTemplate(`${TEMPLATE_PATH}/apps/reset-confirm.hbs`, {});
    const choice = await DialogV2.wait({
      window: { title: localize("DataTools.ResetTitle"), icon: "fa-solid fa-triangle-exclamation" },
      classes: ["detective-story"],
      content,
      buttons: [
        {
          action: "reset",
          label: localize("DataTools.Reset"),
          icon: "fa-solid fa-trash",
          callback: (event, button) => ({ includePlayerData: button.form.elements.includePlayerData.checked })
        },
        { action: "cancel", label: localize("Common.Cancel"), icon: "fa-solid fa-xmark", default: true }
      ],
      rejectClose: false
    });
    if (!choice || typeof choice !== "object") return;
    await resetModuleData(choice);
    ui.notifications.info(localize("DataTools.ResetDone"));
  }
}

/**
 * Выбор шаблонов галочками (с поиском).
 * @returns {Promise<string[]|null>}
 */
export async function pickTemplates() {
  const templates = listClueTemplates().map((template) => ({
    id: template.id,
    name: template.name,
    img: template.img,
    searchIndex: [template.name, ...template.tags].join(" ").toLocaleLowerCase(game.i18n.lang)
  }));
  if (!templates.length) {
    ui.notifications.info(localize("Library.Empty"));
    return null;
  }
  const content = await renderTemplate(`${TEMPLATE_PATH}/apps/template-picker.hbs`, { templates });
  const templateIds = await DialogV2.wait({
    window: { title: localize("Grant.PickTemplatesTitle"), icon: "fa-solid fa-book" },
    classes: ["detective-story", "template-picker"],
    content,
    render: (event, dialog) => {
      const searchInput = dialog.element.querySelector("input[name='templateSearch']");
      searchInput?.addEventListener("input", () => {
        const searchText = searchInput.value.trim().toLocaleLowerCase(game.i18n.lang);
        for (const rowElement of dialog.element.querySelectorAll("[data-search]")) {
          rowElement.hidden = Boolean(searchText) && !rowElement.dataset.search.includes(searchText);
        }
      });
    },
    buttons: [
      {
        action: "confirm",
        label: localize("Grant.Confirm"),
        icon: "fa-solid fa-gift",
        default: true,
        callback: (event, button) => [...button.form.querySelectorAll("input[name='template']:checked")].map((input) => input.value)
      },
      { action: "cancel", label: localize("Common.Cancel"), icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (!Array.isArray(templateIds) || !templateIds.length) return null;
  return templateIds;
}

/** Импорт: выбор файла, сводка, решение по конфликтам id. */
async function runImportFlow() {
  const fileText = await selectJsonFile();
  if (fileText === null) return;
  let importData;
  try {
    importData = parseImportText(fileText);
  } catch (error) {
    if (error instanceof InvalidImportError) {
      ui.notifications.error(localize(`DataTools.Errors.${error.message}`));
      return;
    }
    throw error;
  }
  const summary = summarizeImport(importData);
  const conflictCount = countImportConflicts(importData);
  const content = await renderTemplate(`${TEMPLATE_PATH}/apps/import-summary.hbs`, { summary, conflictCount });
  const buttons = [];
  if (conflictCount) {
    buttons.push({ action: CONFLICT_MODES.replace, label: localize("DataTools.Replace"), icon: "fa-solid fa-arrows-rotate" });
    buttons.push({ action: CONFLICT_MODES.skip, label: localize("DataTools.Skip"), icon: "fa-solid fa-forward", default: true });
  } else {
    buttons.push({ action: CONFLICT_MODES.skip, label: localize("DataTools.Import"), icon: "fa-solid fa-file-import", default: true });
  }
  buttons.push({ action: "cancel", label: localize("Common.Cancel"), icon: "fa-solid fa-xmark" });
  const decision = await DialogV2.wait({
    window: { title: localize("DataTools.ImportTitle"), icon: "fa-solid fa-file-import" },
    classes: ["detective-story"],
    content,
    buttons,
    rejectClose: false
  });
  if (decision !== CONFLICT_MODES.replace && decision !== CONFLICT_MODES.skip) return;
  await applyImport(importData, decision);
  ui.notifications.info(localize("DataTools.ImportDone"));
}

/** @returns {Promise<string|null>} текст выбранного файла */
function selectJsonFile() {
  return new Promise((resolve) => {
    const inputElement = document.createElement("input");
    inputElement.type = "file";
    inputElement.accept = ".json,application/json";
    inputElement.addEventListener("change", async () => {
      const selectedFile = inputElement.files?.[0];
      if (!selectedFile) {
        resolve(null);
        return;
      }
      resolve(await foundry.utils.readTextFromFile(selectedFile));
    });
    inputElement.addEventListener("cancel", () => resolve(null));
    inputElement.click();
  });
}

export function openGameMasterWindow() {
  if (!game.user.isGM) return null;
  return openSingleton("detective-story-gm-window", () => new GameMasterWindow());
}
