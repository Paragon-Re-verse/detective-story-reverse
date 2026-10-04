import { MODULE_ID, TEMPLATE_PATH, SEARCH_DEBOUNCE_MS } from "../constants.js";
import { localize, format } from "../i18n.js";
import { DetectiveApplication, openSingleton } from "./base-application.js";
import { listPlayerClues, getPlayerClue, deletePlayerClue } from "../data/player-clues.js";
import { getChangedSectionKeys } from "../data/user-flags.js";
import { getClueType, getClueTypeList } from "../data/clue-types.js";
import { buildCaseIndex, getCaseLabel, isClueLockedByClosedCase, CASE_STATUS } from "../data/cases.js";
import { getPlayerUsers } from "../permissions.js";
import { getSetting, setSetting, SETTING_KEYS } from "../settings.js";
import { postClueToChat } from "../chat.js";
import { isBoardScene } from "../board/board-scenes.js";
import { placeClueOnBoard } from "../board/clue-cards.js";
import { openClueView } from "./clue-view.js";
import { openPlayerClueEditor } from "./clue-editor.js";
import { startTransfer } from "./transfer-dialogs.js";

const { renderTemplate } = foundry.applications.handlebars;
const ITEM_TEMPLATE = `${TEMPLATE_PATH}/partials/clue-list-item.hbs`;

/** Порядок карточек: новые сверху, по названию, по типу, по делу. */
const SORT_MODES = ["received", "name", "type", "case"];
/** Вид списка: плитка или строки. */
const VIEW_MODES = { grid: "grid", rows: "rows" };
/** Улики вне дел при сортировке «по делу» идут в конце. */
const NO_CASE_NUMBER = Number.MAX_SAFE_INTEGER;
const NOTES_PREVIEW_LENGTH = 160;

/**
 * Список улик: игрок видит свои, ГМ — любого игрока.
 * Сетка иконок, поиск по названию и тегам, фильтр по типу, режим выбора для массовой передачи.
 * Изменения улик обновляют только затронутые карточки, а не всё окно.
 */
export class ClueListApplication extends DetectiveApplication {
  /**
   * @param {User} ownerUser - чей список
   * @param {object} [options]
   */
  constructor(ownerUser, options = {}) {
    super({ ...options, id: ClueListApplication.APPLICATION_ID });
    this.ownerUser = ownerUser;
    this.selectionMode = false;
    this.selectedOriginIds = new Set();
    this.searchText = "";
    this.typeFilter = "";
  }

  /** Окно одно: ГМ переключает в нём игроков, игрок видит только свой список. */
  static APPLICATION_ID = "detective-story-clue-list";

  /**
   * Показать в этом же окне список другого игрока.
   * @param {User} ownerUser
   */
  showOwner(ownerUser) {
    if (ownerUser.id === this.ownerUser.id) return;
    this.ownerUser = ownerUser;
    this.selectionMode = false;
    this.selectedOriginIds.clear();
    this.render({ window: { title: this.title } });
  }

  static DEFAULT_OPTIONS = {
    classes: ["clue-list"],
    window: { icon: "fa-solid fa-magnifying-glass", resizable: true },
    position: { width: 720, height: 620 },
    actions: {
      openClue: ClueListApplication.#onOpenClue,
      showInChat: ClueListApplication.#onShowInChat,
      placeOnBoard: ClueListApplication.#onPlaceOnBoard,
      transferClue: ClueListApplication.#onTransferClue,
      editClue: ClueListApplication.#onEditClue,
      deleteClue: ClueListApplication.#onDeleteClue,
      toggleSelection: ClueListApplication.#onToggleSelection,
      toggleView: ClueListApplication.#onToggleView,
      transferSelected: ClueListApplication.#onTransferSelected
    }
  };

  static PARTS = {
    list: { template: `${TEMPLATE_PATH}/apps/clue-list.hbs`, scrollable: [".clue-grid"] }
  };

  get title() {
    if (this.ownerUser.id === game.user.id) return localize("ClueList.Title");
    return format("ClueList.TitleFor", { name: this.ownerUser.name });
  }

  get isOwnList() {
    return this.ownerUser.id === game.user.id;
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this.caseIndex = buildCaseIndex();
    const clueItems = listPlayerClues(this.ownerUser).map((playerClue) => this.#buildItemContext(playerClue));
    const typeChoices = { "": localize("ClueList.AllTypes") };
    for (const clueType of getClueTypeList()) typeChoices[clueType.id] = clueType.name;
    const sortChoices = {};
    for (const sortMode of SORT_MODES) sortChoices[sortMode] = localize(`ClueList.Sort.${sortMode}`);
    let userChoices = null;
    if (game.user.isGM) {
      userChoices = {};
      for (const playerUser of getPlayerUsers()) userChoices[playerUser.id] = playerUser.name;
    }
    return Object.assign(context, {
      clues: clueItems,
      hasClues: clueItems.length > 0,
      typeChoices,
      typeFilter: this.typeFilter,
      searchText: this.searchText,
      userChoices,
      ownerUserId: this.ownerUser.id,
      canTransfer: this.isOwnList,
      selectionMode: this.selectionMode,
      selectedCount: this.selectedOriginIds.size,
      sortChoices,
      sortMode: getSetting(SETTING_KEYS.clueListSort),
      isRowsView: getSetting(SETTING_KEYS.clueListView) === VIEW_MODES.rows
    });
  }

  /** Данные одной карточки (общие для полного рендера и точечного обновления). */
  #buildItemContext(playerClue) {
    const clueType = getClueType(playerClue.typeId);
    const pinnedCases = this.caseIndex?.get(playerClue.originId) ?? [];
    const caseTags = pinnedCases.map((caseData) => {
      return { label: getCaseLabel(caseData), number: caseData.number, closed: caseData.status === CASE_STATUS.closed };
    });
    const searchIndex = [playerClue.name, ...(playerClue.tags ?? [])].join(" ").toLocaleLowerCase(game.i18n.lang);
    let caseSortNumber = NO_CASE_NUMBER;
    for (const caseTag of caseTags) caseSortNumber = Math.min(caseSortNumber, caseTag.number);
    // Заметки личные: значок только в собственном списке, текст — в подсказке.
    const notesText = String(playerClue.notes ?? "").trim();
    const hasNotes = this.isOwnList && notesText.length > 0;
    let notesPreview = notesText.slice(0, NOTES_PREVIEW_LENGTH);
    if (notesText.length > NOTES_PREVIEW_LENGTH) notesPreview += "…";
    return {
      ...playerClue,
      typeName: clueType.name,
      typeIcon: clueType.icon,
      caseTags,
      searchIndex,
      isOwnList: this.isOwnList,
      isGameMaster: game.user.isGM,
      boardAvailable: isBoardScene(canvas?.scene),
      selected: this.selectedOriginIds.has(playerClue.originId),
      caseSortNumber,
      receivedAt: playerClue.receivedAt ?? 0,
      hasNotes,
      notesPreview,
      locked: caseTags.some((caseTag) => caseTag.closed)
    };
  }

  /** @inheritDoc */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.subscribe("updateUser", (user, changes) => this.#onUserUpdated(user, changes));
    this.subscribe("canvasReady", () => this.#refreshBoardButtons());
    const onCaseChanged = (journalEntry) => {
      if (journalEntry.flags?.[MODULE_ID]?.case) this.#refreshCaseTags();
    };
    this.subscribe("createJournalEntry", onCaseChanged);
    this.subscribe("updateJournalEntry", onCaseChanged);
    this.subscribe("deleteJournalEntry", onCaseChanged);
    this.subscribe("updateSetting", (setting) => {
      if (setting.key.endsWith(".clueTypes")) this.render();
    });
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const searchInput = this.element.querySelector("input[name='search']");
    const applySearch = foundry.utils.debounce(() => {
      this.searchText = searchInput.value.trim().toLocaleLowerCase(game.i18n.lang);
      this.#applyFilters();
    }, SEARCH_DEBOUNCE_MS);
    searchInput?.addEventListener("input", applySearch);

    const sortSelect = this.element.querySelector("select[name='sortMode']");
    sortSelect?.addEventListener("change", async () => {
      await setSetting(SETTING_KEYS.clueListSort, sortSelect.value);
      this.#applySort();
    });

    const typeSelect = this.element.querySelector("select[name='typeFilter']");
    typeSelect?.addEventListener("change", () => {
      this.typeFilter = typeSelect.value;
      this.#applyFilters();
    });

    const userSelect = this.element.querySelector("select[name='ownerUserId']");
    userSelect?.addEventListener("change", () => {
      const nextUser = game.users.get(userSelect.value);
      if (nextUser) this.showOwner(nextUser);
    });

    this.element.querySelector(".clue-grid")?.addEventListener("change", (event) => {
      const checkbox = event.target.closest("input[data-select]");
      if (!checkbox) return;
      const originId = checkbox.closest("[data-origin-id]").dataset.originId;
      if (checkbox.checked) {
        this.selectedOriginIds.add(originId);
      } else {
        this.selectedOriginIds.delete(originId);
      }
      this.#refreshSelectionCount();
    });

    for (const itemElement of this.element.querySelectorAll(".clue-item")) this.#attachDrag(itemElement);
    this.#applySort();
    this.#applyFilters();
  }

  /** Переставить готовые карточки в выбранном порядке (без перерисовки). */
  #applySort() {
    const gridElement = this.element?.querySelector(".clue-grid");
    if (!gridElement) return;
    const sortMode = getSetting(SETTING_KEYS.clueListSort);
    const byName = (first, second) => first.dataset.name.localeCompare(second.dataset.name, game.i18n.lang);
    const comparators = {
      received: (first, second) => Number(second.dataset.received) - Number(first.dataset.received),
      name: byName,
      type: (first, second) => first.dataset.typeName.localeCompare(second.dataset.typeName, game.i18n.lang) || byName(first, second),
      case: (first, second) => Number(first.dataset.caseNumber) - Number(second.dataset.caseNumber) || byName(first, second)
    };
    const comparator = comparators[sortMode] ?? comparators.received;
    const itemElements = [...gridElement.querySelectorAll(".clue-item")].sort(comparator);
    gridElement.append(...itemElements);
  }

  /** Перетаскивание улики в журнал дела. */
  #attachDrag(itemElement) {
    itemElement.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", JSON.stringify({
        type: "DetectiveStoryClue",
        originId: itemElement.dataset.originId,
        ownerUserId: this.ownerUser.id
      }));
    });
  }

  #applyFilters() {
    let visibleCount = 0;
    for (const itemElement of this.element.querySelectorAll(".clue-item")) {
      const matchesSearch = !this.searchText || itemElement.dataset.search.includes(this.searchText);
      const matchesType = !this.typeFilter || itemElement.dataset.typeId === this.typeFilter;
      const visible = matchesSearch && matchesType;
      itemElement.hidden = !visible;
      if (visible) visibleCount += 1;
    }
    const emptyMessage = this.element.querySelector(".filter-empty");
    if (emptyMessage) emptyMessage.hidden = visibleCount > 0 || !this.element.querySelector(".clue-item");
  }

  #refreshSelectionCount() {
    const countElement = this.element.querySelector("[data-selected-count]");
    if (countElement) countElement.textContent = String(this.selectedOriginIds.size);
    const transferButton = this.element.querySelector("[data-action='transferSelected']");
    if (transferButton) transferButton.disabled = this.selectedOriginIds.size === 0;
  }

  #refreshBoardButtons() {
    const boardAvailable = isBoardScene(canvas?.scene);
    for (const buttonElement of this.element?.querySelectorAll("[data-action='placeOnBoard']") ?? []) {
      buttonElement.disabled = !boardAvailable;
      if (boardAvailable) {
        buttonElement.dataset.tooltip = localize("ClueList.PlaceOnBoard");
      } else {
        buttonElement.dataset.tooltip = localize("ClueList.OpenBoardFirst");
      }
    }
  }

  /**
   * Точечное обновление: меняются только карточки затронутых улик.
   * @param {User} user
   * @param {object} changes
   */
  async #onUserUpdated(user, changes) {
    if (user.id !== this.ownerUser.id || !this.rendered) return;
    const changedKeys = getChangedSectionKeys(changes, "clues");
    if (!changedKeys) return;
    if (changedKeys.deleted.includes("*")) {
      this.render();
      return;
    }
    const gridElement = this.element.querySelector(".clue-grid");
    if (!gridElement) {
      this.render();
      return;
    }
    for (const originId of changedKeys.deleted) {
      gridElement.querySelector(`[data-origin-id="${originId}"]`)?.remove();
      this.selectedOriginIds.delete(originId);
    }
    await this.#renderItems(gridElement, changedKeys.changed);
    this.#applySort();
    const hasItems = Boolean(gridElement.querySelector(".clue-item"));
    const noCluesElement = this.element.querySelector(".no-clues");
    if (noCluesElement) noCluesElement.hidden = hasItems;
    this.#applyFilters();
    this.#refreshSelectionCount();
  }

  /**
   * Перерисовать отдельные карточки (новые добавляются в начало сетки).
   * @param {HTMLElement} gridElement
   * @param {string[]} originIds
   */
  async #renderItems(gridElement, originIds) {
    for (const originId of originIds) {
      const playerClue = getPlayerClue(this.ownerUser, originId);
      if (!playerClue) continue;
      const itemHtml = await renderTemplate(ITEM_TEMPLATE, this.#buildItemContext(playerClue));
      const template = document.createElement("template");
      template.innerHTML = itemHtml.trim();
      const newItemElement = template.content.firstElementChild;
      this.#attachDrag(newItemElement);
      const existingElement = gridElement.querySelector(`[data-origin-id="${originId}"]`);
      if (existingElement) {
        newItemElement.hidden = existingElement.hidden;
        existingElement.replaceWith(newItemElement);
      } else {
        gridElement.prepend(newItemElement);
      }
    }
  }

  /** Изменилось дело: перерисовать только карточки, у которых поменялись значки дел или замок. */
  async #refreshCaseTags() {
    if (!this.rendered) return;
    const gridElement = this.element.querySelector(".clue-grid");
    if (!gridElement) return;
    const caseSignature = (caseIndex, originId) => (caseIndex?.get(originId) ?? []).map((caseData) => `${caseData.number}:${caseData.status}`).join(",");
    const previousIndex = this.caseIndex;
    this.caseIndex = buildCaseIndex();
    const changedIds = [];
    for (const itemElement of gridElement.querySelectorAll(".clue-item")) {
      const originId = itemElement.dataset.originId;
      if (caseSignature(previousIndex, originId) !== caseSignature(this.caseIndex, originId)) changedIds.push(originId);
    }
    await this.#renderItems(gridElement, changedIds);
    if (changedIds.length) this.#applySort();
  }

  /** Выделить улику (переход «Подробнее» с доски). @param {string} originId */
  highlightClue(originId) {
    const itemElement = this.element?.querySelector(`[data-origin-id="${originId}"]`);
    if (!itemElement) return;
    for (const otherElement of this.element.querySelectorAll(".clue-item.highlighted")) otherElement.classList.remove("highlighted");
    itemElement.hidden = false;
    itemElement.classList.add("highlighted");
    itemElement.scrollIntoView({ block: "center" });
  }

  /** @param {HTMLElement} target */
  #getClue(target) {
    const originId = target.closest("[data-origin-id]")?.dataset.originId;
    return getPlayerClue(this.ownerUser, originId);
  }

  static #onOpenClue(event, target) {
    const playerClue = this.#getClue(target);
    if (playerClue) openClueView(this.ownerUser, playerClue.originId);
  }

  static async #onShowInChat(event, target) {
    const playerClue = this.#getClue(target);
    if (playerClue) await postClueToChat(playerClue);
  }

  static async #onPlaceOnBoard(event, target) {
    const playerClue = this.#getClue(target);
    if (!playerClue) return;
    if (!isBoardScene(canvas?.scene)) {
      ui.notifications.warn(localize("ClueList.OpenBoardFirst"));
      return;
    }
    await placeClueOnBoard(playerClue);
  }

  static async #onTransferClue(event, target) {
    const playerClue = this.#getClue(target);
    if (playerClue) await startTransfer([playerClue.originId]);
  }

  static #onEditClue(event, target) {
    const playerClue = this.#getClue(target);
    if (!playerClue || !game.user.isGM) return;
    if (isClueLockedByClosedCase(playerClue.originId)) {
      ui.notifications.warn(localize("Case.ClueLocked"));
      return;
    }
    openPlayerClueEditor(this.ownerUser, playerClue.originId);
  }

  static async #onDeleteClue(event, target) {
    const playerClue = this.#getClue(target);
    if (!playerClue || !game.user.isGM) return;
    if (isClueLockedByClosedCase(playerClue.originId)) {
      ui.notifications.warn(localize("Case.ClueLocked"));
      return;
    }
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: localize("ClueList.DeleteTitle") },
      content: `<p>${format("ClueList.DeleteConfirm", { clue: foundry.utils.escapeHTML(playerClue.name), player: foundry.utils.escapeHTML(this.ownerUser.name) })}</p>`,
      rejectClose: false
    });
    if (confirmed) await deletePlayerClue(this.ownerUser, playerClue.originId);
  }

  static #onToggleSelection() {
    this.selectionMode = !this.selectionMode;
    this.selectedOriginIds.clear();
    this.render();
  }

  static async #onToggleView() {
    let nextView = VIEW_MODES.rows;
    if (getSetting(SETTING_KEYS.clueListView) === VIEW_MODES.rows) nextView = VIEW_MODES.grid;
    await setSetting(SETTING_KEYS.clueListView, nextView);
    this.render();
  }

  static async #onTransferSelected() {
    if (!this.selectedOriginIds.size) return;
    const sent = await startTransfer([...this.selectedOriginIds]);
    if (!sent) return;
    this.selectionMode = false;
    this.selectedOriginIds.clear();
    this.render();
  }
}

/**
 * Открыть список улик. Окно одно: если оно уже открыто, в нём показывается нужный игрок.
 * @param {User} [ownerUser] - для ГМ без указания игрока остаётся текущий игрок окна или первый игрок
 * @param {{highlightOriginId?: string}} [options]
 */
export function openClueList(ownerUser = game.user, { highlightOriginId } = {}) {
  const existingApplication = foundry.applications.instances.get(ClueListApplication.APPLICATION_ID);
  let targetUser = ownerUser;
  if (game.user.isGM && targetUser.isGM) {
    targetUser = existingApplication?.ownerUser ?? getPlayerUsers()[0];
    if (!targetUser) {
      ui.notifications.info(localize("ClueList.NoPlayers"));
      return null;
    }
  }
  if (highlightOriginId) {
    const hookId = Hooks.on("renderClueListApplication", (renderedApplication) => {
      if (renderedApplication.id !== ClueListApplication.APPLICATION_ID) return;
      Hooks.off("renderClueListApplication", hookId);
      renderedApplication.highlightClue(highlightOriginId);
    });
  }
  if (existingApplication) {
    if (existingApplication.ownerUser.id === targetUser.id) {
      existingApplication.render({ force: true });
    } else {
      existingApplication.showOwner(targetUser);
    }
    existingApplication.bringToFront();
    return existingApplication;
  }
  return openSingleton(ClueListApplication.APPLICATION_ID, () => new ClueListApplication(targetUser));
}
