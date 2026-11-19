import { MODULE_ID, TEMPLATE_PATH } from "../constants.js";
import { localize, format, fullKey } from "../i18n.js";
import { DetectiveApplication, openSingleton } from "./base-application.js";
import { canCreateCases, canManageCases, canEditSuspects } from "../permissions.js";
import {
  listCases,
  getCase,
  getCaseLabel,
  createCase,
  updateCaseDetails,
  setCaseClosed,
  deleteCase,
  pinClueToCase,
  unpinClueFromCase,
  linkSuspectToCase,
  unlinkSuspectFromCase,
  CASE_STATUS
} from "../data/cases.js";
import { listSuspects, getSuspect } from "../data/suspects.js";
import { userHasClue } from "../data/player-clues.js";
import { getChangedSectionKeys } from "../data/user-flags.js";
import { enrichText, formatDateTime } from "./view-helpers.js";
import { openSuspectDossier } from "./suspect-dossier.js";
import { openTimeline } from "./timeline.js";
import { openClueView } from "./clue-view.js";
import { getFolderScope, moveItemsToFolder, pinFolderToCase, FOLDER_SCOPES } from "../data/clue-folders.js";
import { resolveFolderId, getFolderPath } from "../data/folder-tree.js";
import {
  prepareFolderTree,
  attachFolderTree,
  matchesSelectedFolder,
  validateSelectedFolder,
  pickFolderDialog,
  readFolderDrag,
  toRealFolderId,
  ALL_FOLDERS
} from "./folder-tree.js";

/** Перетаскивание улики внутри дела (между его папками). */
const PINNED_DRAG_TYPE = "application/x-detective-story-pinned";

const { DialogV2 } = foundry.applications.api;

/**
 * Журнал дела: список дел, внутри дела — описание, прикреплённые улики (перетаскиваются из списка улик),
 * подозреваемые, таймлайн, закрытие и переоткрытие. Вкладка «Подозреваемые» — общие досье,
 * вкладка «Архив» — только у ГМ и профайлера.
 */
export class CaseJournalApplication extends DetectiveApplication {
  constructor(options = {}) {
    super({ ...options, id: "detective-story-case-journal" });
    this.selectedCaseId = null;
    this.editingDetails = false;
    this.selectedCaseFolderId = ALL_FOLDERS;
  }

  static DEFAULT_OPTIONS = {
    classes: ["case-journal"],
    window: { icon: "fa-solid fa-folder-open", resizable: true, title: fullKey("CaseJournal.Title") },
    position: { width: 860, height: 640 },
    actions: {
      selectCase: CaseJournalApplication.#onSelectCase,
      createCase: CaseJournalApplication.#onCreateCase,
      editDetails: CaseJournalApplication.#onEditDetails,
      saveDetails: CaseJournalApplication.#onSaveDetails,
      closeCase: CaseJournalApplication.#onCloseCase,
      reopenCase: CaseJournalApplication.#onReopenCase,
      deleteCase: CaseJournalApplication.#onDeleteCase,
      openTimeline: CaseJournalApplication.#onOpenTimeline,
      unpinClue: CaseJournalApplication.#onUnpinClue,
      movePinnedClue: CaseJournalApplication.#onMovePinnedClue,
      openPinnedClue: CaseJournalApplication.#onOpenPinnedClue,
      linkSuspect: CaseJournalApplication.#onLinkSuspect,
      unlinkSuspect: CaseJournalApplication.#onUnlinkSuspect,
      openSuspect: CaseJournalApplication.#onOpenSuspect,
      createSuspect: CaseJournalApplication.#onCreateSuspect
    }
  };

  static PARTS = {
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    cases: { template: `${TEMPLATE_PATH}/apps/case-journal-cases.hbs`, scrollable: [".case-list", ".case-details"] },
    suspects: { template: `${TEMPLATE_PATH}/apps/case-journal-suspects.hbs`, scrollable: [".suspect-grid"] },
    archive: { template: `${TEMPLATE_PATH}/apps/case-journal-archive.hbs`, scrollable: [""] }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "cases", icon: "fa-solid fa-folder-open", label: fullKey("CaseJournal.Tabs.cases") },
        { id: "suspects", icon: "fa-solid fa-user-secret", label: fullKey("CaseJournal.Tabs.suspects") },
        { id: "archive", icon: "fa-solid fa-box-archive", label: fullKey("CaseJournal.Tabs.archive") }
      ],
      initial: "cases"
    }
  };

  /** @inheritDoc */
  _getTabsConfig(group) {
    const tabsConfig = foundry.utils.deepClone(super._getTabsConfig(group));
    if (tabsConfig && !canManageCases()) tabsConfig.tabs = tabsConfig.tabs.filter((tab) => tab.id !== "archive");
    return tabsConfig;
  }

  /** @inheritDoc */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    if (!canManageCases()) delete parts.archive;
    return parts;
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, {
      canCreateCases: canCreateCases(),
      canManageCases: canManageCases(),
      canEditSuspects: canEditSuspects(),
      isGameMaster: game.user.isGM
    });
  }

  /** Список дела для боковой панели и архива. */
  #toListItem(caseData) {
    return {
      id: caseData.id,
      number: caseData.number,
      label: getCaseLabel(caseData),
      title: caseData.title,
      closed: caseData.status === CASE_STATUS.closed,
      selected: caseData.id === this.selectedCaseId
    };
  }

  /**
   * Архивные подозреваемые списками по делам: название дела, под ним подозреваемые, ушедшие в архив.
   * Снимок, чьё досье снова существует (например, после импорта), архивным не считается.
   */
  #groupArchivedSuspects(allCases) {
    const groups = [];
    for (const caseData of allCases) {
      const suspects = Object.values(caseData.archivedSuspects)
        .filter((snapshot) => !getSuspect(snapshot.id))
        .sort((first, second) => first.name.localeCompare(second.name, game.i18n.lang));
      if (suspects.length) groups.push({ ...this.#toListItem(caseData), suspects });
    }
    return groups;
  }

  /** Выбранное дело должно быть видно пользователю, иначе выбирается первое открытое. */
  #validateSelection(allCases) {
    const visibleCases = allCases.filter((caseData) => caseData.status === CASE_STATUS.open || canManageCases());
    if (!visibleCases.some((caseData) => caseData.id === this.selectedCaseId)) {
      this.selectedCaseId = allCases.find((caseData) => caseData.status === CASE_STATUS.open)?.id ?? null;
    }
  }

  async #prepareSelectedCase() {
    const caseData = getCase(this.selectedCaseId);
    if (!caseData) return null;
    const managesCases = canManageCases();
    this.caseFolders = caseData.folders;
    this.selectedCaseFolderId = validateSelectedFolder(caseData.folders, this.selectedCaseFolderId);
    const pinnedClues = Object.values(caseData.pinned)
      .filter((pinnedClue) => managesCases || userHasClue(game.user, pinnedClue.originId))
      .map((pinnedClue) => ({
        ...pinnedClue,
        pinnedAtLabel: formatDateTime(pinnedClue.pinnedAt),
        ownedByMe: userHasClue(game.user, pinnedClue.originId),
        folderId: resolveFolderId(caseData.folders, pinnedClue.folderId) ?? "",
        folderPath: getFolderPath(caseData.folders, pinnedClue.folderId)
      }));
    // Игрок видит только папки, где есть его улики (п. 24): счётчики считаются по видимым уликам.
    const visibleItemFolders = {};
    for (const pinnedClue of pinnedClues) visibleItemFolders[pinnedClue.originId] = pinnedClue.folderId || null;
    const folderTree = prepareFolderTree(getFolderScope(FOLDER_SCOPES.case, caseData.id), {
      selectedFolderId: this.selectedCaseFolderId,
      itemFolders: visibleItemFolders,
      hideEmpty: !managesCases
    });
    const linkedSuspects = caseData.suspectIds.map((suspectId) => {
      const suspect = getSuspect(suspectId);
      if (suspect) return suspect;
      const snapshot = caseData.archivedSuspects[suspectId];
      if (snapshot) return { ...snapshot, archived: true };
      return null;
    }).filter(Boolean);
    const availableSuspects = listSuspects().filter((suspect) => !caseData.suspectIds.includes(suspect.id));
    const isClosed = caseData.status === CASE_STATUS.closed;
    return {
      ...caseData,
      label: getCaseLabel(caseData),
      enrichedDescription: await enrichText(caseData.description),
      pinnedClues,
      folderTree,
      linkedSuspects,
      availableSuspects,
      isClosed,
      managesCases,
      canEdit: managesCases && !isClosed,
      canDrop: managesCases && !isClosed
    };
  }

  /**
   * Данные готовятся по вкладкам: при частичной перерисовке считается только нужная вкладка.
   * @inheritDoc
   */
  async _preparePartContext(partId, context, options) {
    const partContext = await super._preparePartContext(partId, context, options);
    if (partContext.tabs?.[partId]) partContext.tab = partContext.tabs[partId];
    if (partId === "cases") {
      const allCases = listCases();
      this.#validateSelection(allCases);
      partContext.openCases = allCases.filter((caseData) => caseData.status === CASE_STATUS.open).map((caseData) => this.#toListItem(caseData));
      partContext.selectedCase = await this.#prepareSelectedCase();
      partContext.editingDetails = this.editingDetails;
    } else if (partId === "archive") {
      const allCases = listCases();
      partContext.closedCases = allCases.filter((caseData) => caseData.status === CASE_STATUS.closed).map((caseData) => this.#toListItem(caseData));
      partContext.archivedSuspectGroups = this.#groupArchivedSuspects(allCases);
    } else if (partId === "suspects") {
      partContext.suspects = listSuspects();
    }
    return partContext;
  }

  /**
   * Перерисовать вкладки журнала. Пока ГМ правит описание дела, вкладка «Дела» не перерисовывается.
   * @param {...string} partIds
   */
  #queueParts(...partIds) {
    const allowedParts = partIds.filter((partId) => {
      if (partId === "archive" && !canManageCases()) return false;
      if (partId === "cases" && this.editingDetails) return false;
      return true;
    });
    if (allowedParts.length) this.queuePartRender(...allowedParts);
  }

  /** @inheritDoc */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const onCaseChanged = (journalEntry, changes) => {
      const parts = ["cases"];
      const caseChanges = changes?.flags?.[MODULE_ID]?.case;
      const listChanged = !changes || typeof changes !== "object" || "name" in changes || caseChanges?.status !== undefined
        || Object.keys(caseChanges ?? {}).some((key) => key.includes("archivedSuspects"));
      if (listChanged) parts.push("archive");
      this.#queueParts(...parts);
    };
    const onSuspectChanged = (journalEntry) => {
      const parts = ["suspects"];
      const selectedCase = getCase(this.selectedCaseId);
      if (selectedCase && (canManageCases() || selectedCase.suspectIds.includes(journalEntry.id))) parts.push("cases");
      this.#queueParts(...parts);
    };
    const onJournalEvent = (journalEntry, changes) => {
      const moduleFlags = journalEntry.flags?.[MODULE_ID];
      if (moduleFlags?.case) onCaseChanged(journalEntry, changes);
      else if (moduleFlags?.suspect) onSuspectChanged(journalEntry);
    };
    this.subscribe("createJournalEntry", (journalEntry) => onJournalEvent(journalEntry, null));
    this.subscribe("updateJournalEntry", (journalEntry, changes) => onJournalEvent(journalEntry, changes));
    this.subscribe("deleteJournalEntry", (journalEntry) => onJournalEvent(journalEntry, null));
    this.subscribe("updateUser", (user, changes) => {
      if (user.id !== game.user.id) return;
      const changedKeys = getChangedSectionKeys(changes, "clues");
      const selectedCase = getCase(this.selectedCaseId);
      if (!changedKeys || !selectedCase) return;
      const touchedIds = [...changedKeys.changed, ...changedKeys.deleted];
      if (touchedIds.includes("*") || touchedIds.some((originId) => selectedCase.pinned[originId])) this.#queueParts("cases");
    });
    this.subscribe("updateSetting", (setting) => {
      if (setting.key === `${MODULE_ID}.profilers` || setting.key === `${MODULE_ID}.profilersCreateCases`) this.render();
    });
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    if (!options.parts?.includes("cases")) return;
    attachFolderTree(this.element.querySelector(".case-clues"), {
      getScope: () => getFolderScope(FOLDER_SCOPES.case, this.selectedCaseId),
      onSelect: (folderId) => {
        this.selectedCaseFolderId = folderId;
        for (const nodeElement of this.element.querySelectorAll(".case-clues .folder-node")) {
          nodeElement.classList.toggle("selected", nodeElement.dataset.folderId === folderId);
        }
        this.#applyCaseFolderFilter();
      },
      onDrop: (event, folderId) => this.#onDropIntoCase(event, folderId)
    });
    for (const pinnedElement of this.element.querySelectorAll(".pinned-clue[draggable='true']")) {
      pinnedElement.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData(PINNED_DRAG_TYPE, pinnedElement.dataset.originId);
        event.dataTransfer.effectAllowed = "move";
      });
    }
    this.#applyCaseFolderFilter();
    const dropZone = this.element.querySelector(".pinned-dropzone");
    if (!dropZone) return;
    // Бросать можно на всю карточку дела, а не только на узкую полоску «Улики»: подсвечивается сама полоска.
    const dropTarget = this.element.querySelector(".case-details");
    dropTarget.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropZone.classList.add("drag-over");
    });
    dropTarget.addEventListener("dragleave", (event) => {
      if (!dropTarget.contains(event.relatedTarget)) dropZone.classList.remove("drag-over");
    });
    dropTarget.addEventListener("drop", (event) => {
      event.preventDefault();
      dropZone.classList.remove("drag-over");
      // На карточку дела вне дерева: в открытую папку. В «Все» уже прикреплённая улика остаётся в своей папке.
      let folderId;
      if (this.selectedCaseFolderId !== ALL_FOLDERS) folderId = toRealFolderId(this.selectedCaseFolderId);
      this.#onDropIntoCase(event, folderId);
    });
  }

  /** Показать улики выбранной папки дела, в «Все» — с путём папки. */
  #applyCaseFolderFilter() {
    this.element.querySelector(".pinned-clues")?.classList.toggle("show-folder", this.selectedCaseFolderId === ALL_FOLDERS);
    for (const pinnedElement of this.element.querySelectorAll(".pinned-clue")) {
      pinnedElement.hidden = !matchesSelectedFolder(this.caseFolders ?? {}, pinnedElement.dataset.folderId || null, this.selectedCaseFolderId);
    }
  }

  /**
   * Бросили в дело: улику из списка (прикрепить в папку), папку из своего списка (прикрепить целиком, п. 9)
   * или улику этого дела (переложить в другую папку).
   * @param {DragEvent} event
   * @param {string|null|undefined} folderId - папка дела; undefined — не менять папку уже прикреплённой улики
   */
  async #onDropIntoCase(event, folderId) {
    const caseScope = getFolderScope(FOLDER_SCOPES.case, this.selectedCaseId);
    if (!caseScope) return;
    const pinnedOriginId = event.dataTransfer.getData(PINNED_DRAG_TYPE);
    if (pinnedOriginId) {
      if (folderId === undefined) return;
      await moveItemsToFolder(caseScope, [pinnedOriginId], folderId);
      return;
    }
    const folderDrag = readFolderDrag(event);
    if (folderDrag) {
      if (folderDrag.scopeType !== FOLDER_SCOPES.user) {
        ui.notifications.warn(localize("ClueFolders.CaseOnlyFromList"));
        return;
      }
      await pinFolderToCase(this.selectedCaseId, game.users.get(folderDrag.scopeOwner), folderDrag.folderId, folderId ?? null);
      return;
    }
    let dropData;
    try {
      dropData = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    if (dropData?.type !== "DetectiveStoryClue") return;
    const pinned = await pinClueToCase(this.selectedCaseId, dropData.originId, dropData.ownerUserId, folderId);
    if (pinned === false) ui.notifications.warn(localize("Case.PinOnlyOwn"));
  }

  static #onSelectCase(event, target) {
    this.selectedCaseId = target.closest("[data-case-id]").dataset.caseId;
    this.editingDetails = false;
    this.selectedCaseFolderId = ALL_FOLDERS;
    this.changeTab("cases", "primary");
    this.render({ parts: ["cases"] });
  }

  static async #onCreateCase() {
    const formValues = await DialogV2.input({
      window: { title: localize("Case.CreateTitle"), icon: "fa-solid fa-folder-plus" },
      content: `<div class="form-group"><label>${localize("Case.Title")}</label><input type="text" name="title" autofocus></div>`,
      ok: { label: localize("Case.Create"), icon: "fa-solid fa-check" },
      rejectClose: false
    });
    if (!formValues) return;
    const caseId = await createCase({ title: formValues.title });
    if (!caseId) return;
    this.selectedCaseId = caseId;
    this.render({ parts: ["cases"] });
  }

  static #onEditDetails() {
    this.editingDetails = true;
    this.render({ parts: ["cases"] });
  }

  static async #onSaveDetails() {
    const titleInput = this.element.querySelector("input[name='caseTitle']");
    const descriptionEditor = this.element.querySelector("prose-mirror[name='caseDescription']");
    const saved = await updateCaseDetails(this.selectedCaseId, {
      title: titleInput?.value ?? "",
      description: descriptionEditor?.value ?? ""
    });
    // Дело успели закрыть: редактор остаётся открытым, чтобы набранный текст не пропал.
    if (!saved) return;
    this.editingDetails = false;
    this.render({ parts: ["cases"] });
  }

  static async #onCloseCase() {
    const confirmed = await DialogV2.confirm({
      window: { title: localize("Case.CloseTitle") },
      content: `<p>${localize("Case.CloseConfirm")}</p>`,
      rejectClose: false
    });
    if (confirmed) await setCaseClosed(this.selectedCaseId, true);
  }

  static async #onReopenCase() {
    await setCaseClosed(this.selectedCaseId, false);
  }

  static async #onDeleteCase() {
    const caseData = getCase(this.selectedCaseId);
    if (!caseData) return;
    const confirmed = await DialogV2.confirm({
      window: { title: localize("Case.DeleteTitle") },
      content: `<p>${format("Case.DeleteConfirm", { label: foundry.utils.escapeHTML(getCaseLabel(caseData)) })}</p>`,
      rejectClose: false
    });
    if (confirmed) await deleteCase(this.selectedCaseId);
  }

  static #onOpenTimeline() {
    if (this.selectedCaseId) openTimeline(this.selectedCaseId);
  }

  static async #onUnpinClue(event, target) {
    const originId = target.closest("[data-origin-id]").dataset.originId;
    await unpinClueFromCase(this.selectedCaseId, originId);
  }

  static async #onMovePinnedClue(event, target) {
    const originId = target.closest("[data-origin-id]").dataset.originId;
    const caseScope = getFolderScope(FOLDER_SCOPES.case, this.selectedCaseId);
    if (!caseScope) return;
    const folderId = await pickFolderDialog(caseScope);
    if (folderId !== undefined) await moveItemsToFolder(caseScope, [originId], folderId);
  }

  static #onOpenPinnedClue(event, target) {
    const originId = target.closest("[data-origin-id]").dataset.originId;
    if (userHasClue(game.user, originId)) openClueView(game.user, originId);
  }

  static async #onLinkSuspect() {
    const suspectSelect = this.element.querySelector("select[name='suspectToLink']");
    if (!suspectSelect?.value) return;
    await linkSuspectToCase(this.selectedCaseId, suspectSelect.value);
  }

  static async #onUnlinkSuspect(event, target) {
    const suspectId = target.closest("[data-suspect-id]").dataset.suspectId;
    await unlinkSuspectFromCase(this.selectedCaseId, suspectId);
  }

  static #onOpenSuspect(event, target) {
    openSuspectDossier(target.closest("[data-suspect-id]").dataset.suspectId);
  }

  static #onCreateSuspect() {
    openSuspectDossier(null);
  }
}

export function openCaseJournal() {
  return openSingleton("detective-story-case-journal", () => new CaseJournalApplication());
}
