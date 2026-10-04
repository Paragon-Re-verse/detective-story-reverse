import { MODULE_ID, TEMPLATE_PATH } from "../constants.js";
import { localize, format } from "../i18n.js";
import { DetectiveApplication, openSingleton } from "./base-application.js";
import { getPlayerClue, setPlayerClueNotes, markPlayerClueSeen, CLUE_SOURCES } from "../data/player-clues.js";
import { getChangedSectionKeys } from "../data/user-flags.js";
import { getClueType } from "../data/clue-types.js";
import { listCasesWithClue, getCaseLabel } from "../data/cases.js";
import { postClueToChat } from "../chat.js";
import { isBoardScene } from "../board/board-scenes.js";
import { placeClueOnBoard } from "../board/clue-cards.js";
import { enrichText, formatDateTime } from "./view-helpers.js";
import { startTransfer } from "./transfer-dialogs.js";

/**
 * Карточка улики (просмотр): изображение, название, тип, описание, теги, «получено от»,
 * теги дел и личные заметки (редактирует только владелец). Видят владелец и ГМ.
 */
export class ClueViewApplication extends DetectiveApplication {
  /**
   * @param {User} ownerUser
   * @param {string} originId
   */
  constructor(ownerUser, originId, options = {}) {
    super({ ...options, id: ClueViewApplication.buildId(ownerUser, originId) });
    this.ownerUser = ownerUser;
    this.originId = originId;
  }

  static buildId(ownerUser, originId) {
    return `detective-story-clue-view-${ownerUser.id}-${originId}`;
  }

  static DEFAULT_OPTIONS = {
    classes: ["clue-view"],
    window: { icon: "fa-solid fa-file-magnifying-glass", resizable: true },
    position: { width: 480, height: "auto" },
    actions: {
      showInChat: ClueViewApplication.#onShowInChat,
      placeOnBoard: ClueViewApplication.#onPlaceOnBoard,
      transferClue: ClueViewApplication.#onTransferClue
    }
  };

  static PARTS = {
    view: { template: `${TEMPLATE_PATH}/apps/clue-view.hbs`, scrollable: [""] }
  };

  get playerClue() {
    return getPlayerClue(this.ownerUser, this.originId);
  }

  get title() {
    return this.playerClue?.name ?? localize("ClueView.Title");
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const playerClue = this.playerClue;
    if (!playerClue) return Object.assign(context, { missing: true });
    const clueType = getClueType(playerClue.typeId);
    let receivedFromLabel = "";
    if (playerClue.receivedFrom?.source === CLUE_SOURCES.player) {
      receivedFromLabel = format("ClueView.ReceivedFrom", { name: playerClue.receivedFrom.name });
    }
    const isOwner = this.ownerUser.id === game.user.id;
    return Object.assign(context, {
      clue: playerClue,
      clueType,
      enrichedDescription: await enrichText(playerClue.description),
      receivedFromLabel,
      receivedAt: formatDateTime(playerClue.receivedAt),
      caseLabels: listCasesWithClue(playerClue.originId).map((caseData) => getCaseLabel(caseData)),
      isOwner,
      boardAvailable: isBoardScene(canvas?.scene)
    });
  }

  /** @inheritDoc */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.subscribe("updateUser", (user, changes) => {
      if (user.id !== this.ownerUser.id) return;
      const changedKeys = getChangedSectionKeys(changes, "clues");
      if (!changedKeys) return;
      const affectsThisClue = changedKeys.changed.includes(this.originId) || changedKeys.deleted.includes(this.originId) || changedKeys.deleted.includes("*");
      if (!affectsThisClue) return;
      const changedRecord = changes.flags?.[MODULE_ID]?.clues?.[this.originId];
      const onlyPersonalFields = changedRecord && Object.keys(changedRecord).every((field) => field === "notes" || field === "isNew");
      if (onlyPersonalFields) return;
      this.render();
    });
    if (this.ownerUser.id === game.user.id) await markPlayerClueSeen(game.user, this.originId);
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const notesField = this.element.querySelector("textarea[name='notes']");
    notesField?.addEventListener("change", () => setPlayerClueNotes(game.user, this.originId, notesField.value));
  }

  static async #onShowInChat() {
    if (this.playerClue) await postClueToChat(this.playerClue);
  }

  static async #onPlaceOnBoard() {
    if (!this.playerClue) return;
    if (!isBoardScene(canvas?.scene)) {
      ui.notifications.warn(localize("ClueList.OpenBoardFirst"));
      return;
    }
    await placeClueOnBoard(this.playerClue);
  }

  static async #onTransferClue() {
    if (this.playerClue) await startTransfer([this.originId]);
  }
}

/**
 * @param {User} ownerUser
 * @param {string} originId
 */
export function openClueView(ownerUser, originId) {
  return openSingleton(ClueViewApplication.buildId(ownerUser, originId), () => new ClueViewApplication(ownerUser, originId));
}
