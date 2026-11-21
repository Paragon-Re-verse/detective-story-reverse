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
import { getClueLevels, getNextClosedLevel, setClueLevelOpen, describeCheck, getLevelLabel } from "../data/clue-levels.js";
import { getClueTemplate } from "../data/clue-templates.js";
import { rollDetectionCheck, getBackgroundActor } from "../canvas/zone-search.js";
import { whisperGameMasters, escapeText, GM_NOTE_TONES } from "../chat.js";

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
      transferClue: ClueViewApplication.#onTransferClue,
      studyLevel: ClueViewApplication.#onStudyLevel,
      toggleLevel: ClueViewApplication.#onToggleLevel
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
    const isGameMaster = game.user.isGM;
    // Уровни: открытые — с текстом; закрытые игрок видит замком без текста (п. 6), ГМ — с текстом и проверкой.
    const levels = [];
    for (const level of getClueLevels(playerClue)) {
      let html = "";
      if (level.open || isGameMaster) html = await enrichText(level.text);
      levels.push({
        ...level,
        label: getLevelLabel(level.number),
        html,
        checkLabel: describeCheck(level.check),
        showLockedDetails: isGameMaster && level.number > 1,
        canToggle: isGameMaster && level.number > 1
      });
    }
    let nextLevel = null;
    const nextClosedLevel = getNextClosedLevel(playerClue);
    if (isOwner && nextClosedLevel) nextLevel = { number: nextClosedLevel.number, checkLabel: describeCheck(nextClosedLevel.check) };
    return Object.assign(context, {
      levels,
      hasLevels: levels.length > 1,
      nextLevel,
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
    // Сцена сменилась (например, открыли доску) — кнопка «Выставить на доску» должна это увидеть.
    this.subscribe("canvasReady", () => this.render());
    // Тексты уровней берутся из шаблона: ГМ дописал уровень — окно обновляется.
    this.subscribe("updateJournalEntry", (journalEntry) => {
      if (journalEntry.id === this.originId) this.render();
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

  /**
   * «Изучить»: проверка навыка следующего закрытого уровня против его сложности. Попыток не считаем (п. 2):
   * провал — «Не получилось», и ГМ узнаёт об этом скрытым сообщением.
   */
  static async #onStudyLevel() {
    const playerClue = this.playerClue;
    const nextLevel = playerClue && getNextClosedLevel(playerClue);
    if (!nextLevel || this.ownerUser.id !== game.user.id) return;
    // Тот же персонаж, что и при поиске на фоне: из профиля, иначе выбранный токен.
    const actor = getBackgroundActor();
    const rollMode = getClueTemplate(this.originId)?.detection.rollMode ?? "publicroll";
    const rollResult = await rollDetectionCheck({ check: nextLevel.check, dc: nextLevel.dc, rollMode }, actor);
    if (!rollResult) return;
    const succeeded = rollResult.total >= rollResult.difficulty;
    if (succeeded) {
      await setClueLevelOpen(game.user, this.originId, nextLevel.number, true);
    } else {
      ui.notifications.info(localize("Levels.StudyFailed"));
    }
    let messageKey = "Chat.LevelStudyFailed";
    let tone = GM_NOTE_TONES.declined;
    if (succeeded) {
      messageKey = "Chat.LevelStudied";
      tone = GM_NOTE_TONES.found;
    }
    await whisperGameMasters(format(messageKey, {
      player: escapeText(game.user.name),
      clue: escapeText(playerClue.name),
      level: nextLevel.number,
      total: rollResult.total,
      dc: rollResult.difficulty
    }), tone);
  }

  /** ГМ открывает или закрывает уровень у этого игрока (п. 7а). */
  static async #onToggleLevel(event, target) {
    if (!game.user.isGM) return;
    const levelNumber = Number(target.dataset.level);
    const isOpen = Boolean(this.playerClue?.openLevels?.[levelNumber]);
    await setClueLevelOpen(this.ownerUser, this.originId, levelNumber, !isOpen);
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
