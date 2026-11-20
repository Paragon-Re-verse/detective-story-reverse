import { TEMPLATE_PATH, BOARD_ASSET_PATH } from "../constants.js";
import { localize, format, fullKey } from "../i18n.js";
import { DetectiveApplication, openSingleton } from "./base-application.js";
import {
  getClueTemplate,
  createClueTemplate,
  updateClueTemplate,
  defaultDetection,
  defaultVisual
} from "../data/clue-templates.js";
import { getPlayerClue, updatePlayerClueContent, grantCluesFromTemplates } from "../data/player-clues.js";
import { getClueTypeList } from "../data/clue-types.js";
import {
  getZoneModeChoices,
  getRollModeChoices,
  getCheckSuggestions,
  getKindChoices,
  getFontChoices,
  getInkSwatches,
  getTintSwatches,
  attachCheckFields
} from "./view-helpers.js";
import { MAX_CLUE_LEVELS, normalizeLevels } from "../data/clue-levels.js";
import { editClueTypeDialog } from "./clue-type-dialog.js";
import { renderCardMiniPreview } from "./card-mini-preview.js";
import { pickRecipients } from "./transfer-dialogs.js";

/**
 * Редактор улики «Улика [название]» (только ГМ). Три вкладки: Сводка, Обнаружение, Визуализация.
 * Режимы: шаблон улики (новый или существующий) и копия улики конкретного игрока —
 * для копии вкладки «Обнаружение» нет, правка меняет только эту копию.
 */
export class ClueEditorApplication extends DetectiveApplication {
  /**
   * @param {{templateId?: string, ownerUser?: User, originId?: string}} target
   */
  constructor(target, options = {}) {
    super({ ...options, id: ClueEditorApplication.buildId(target) });
    this.templateId = target.templateId ?? null;
    this.ownerUser = target.ownerUser ?? null;
    this.originId = target.originId ?? null;
    /** Папка библиотеки для новой улики (открытая в библиотеке папка). */
    this.newFolderId = target.folderId ?? null;
  }

  static buildId({ templateId, ownerUser, originId }) {
    if (ownerUser) return `detective-story-clue-editor-${ownerUser.id}-${originId}`;
    return `detective-story-clue-editor-${templateId ?? "new"}`;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["clue-editor"],
    window: { icon: "fa-solid fa-pen-to-square", resizable: true, contentClasses: ["standard-form"] },
    position: { width: 640, height: 720 },
    form: {
      handler: ClueEditorApplication.#onSubmit,
      submitOnChange: false,
      closeOnSubmit: true
    },
    actions: {
      addClueType: ClueEditorApplication.#onAddClueType,
      grantToPlayers: ClueEditorApplication.#onGrantToPlayers
    }
  };

  static PARTS = {
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    summary: { template: `${TEMPLATE_PATH}/apps/clue-editor-summary.hbs`, scrollable: [""] },
    levels: { template: `${TEMPLATE_PATH}/apps/clue-editor-levels.hbs`, scrollable: [""] },
    detection: { template: `${TEMPLATE_PATH}/apps/clue-editor-detection.hbs`, scrollable: [""] },
    visual: { template: `${TEMPLATE_PATH}/apps/clue-editor-visual.hbs`, scrollable: [""] },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  static TABS = {
    sheet: {
      tabs: [
        { id: "summary", icon: "fa-solid fa-file-lines", label: fullKey("Editor.Tabs.summary") },
        { id: "levels", icon: "fa-solid fa-layer-group", label: fullKey("Editor.Tabs.levels") },
        { id: "detection", icon: "fa-solid fa-magnifying-glass", label: fullKey("Editor.Tabs.detection") },
        { id: "visual", icon: "fa-solid fa-thumbtack", label: fullKey("Editor.Tabs.visual") }
      ],
      initial: "summary"
    }
  };

  get isPlayerCopy() {
    return Boolean(this.ownerUser);
  }

  /** Исходные данные для формы. */
  #loadClueData() {
    if (this.isPlayerCopy) {
      const playerClue = getPlayerClue(this.ownerUser, this.originId);
      if (!playerClue) return null;
      return { ...playerClue, detection: defaultDetection(), levels: readCopyLevels(playerClue) };
    }
    if (this.templateId) return getClueTemplate(this.templateId);
    return {
      name: "",
      img: `${BOARD_ASSET_PATH}/placeholder.webp`,
      typeId: "",
      description: "",
      tags: [],
      detection: defaultDetection(),
      visual: defaultVisual(),
      levels: []
    };
  }

  get title() {
    const clueData = this.#loadClueData();
    let clueName = clueData?.name;
    if (!clueName) clueName = localize("Editor.NewClue");
    if (this.isPlayerCopy) return format("Editor.TitleCopy", { name: clueName, player: this.ownerUser.name });
    return format("Editor.Title", { name: clueName });
  }

  /** @inheritDoc */
  _getTabsConfig(group) {
    const tabsConfig = foundry.utils.deepClone(super._getTabsConfig(group));
    if (this.isPlayerCopy && tabsConfig) tabsConfig.tabs = tabsConfig.tabs.filter((tab) => tab.id !== "detection");
    return tabsConfig;
  }

  /** @inheritDoc */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    if (this.isPlayerCopy) delete parts.detection;
    return parts;
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const clueData = this.#loadClueData() ?? {};
    const typeChoices = { "": localize("Editor.NoType") };
    for (const clueType of getClueTypeList()) typeChoices[clueType.id] = clueType.name;
    const levels = normalizeLevels(clueData.levels);
    const levelCountChoices = {};
    for (let count = 1; count <= MAX_CLUE_LEVELS; count += 1) levelCountChoices[count] = String(count);
    // Все пять дополнительных уровней есть в форме всегда; лишние скрыты и отбрасываются при сохранении.
    const levelSlots = [];
    for (let index = 0; index < MAX_CLUE_LEVELS - 1; index += 1) {
      const level = levels[index] ?? { text: "", check: "inv", dc: "15" };
      levelSlots.push({ ...level, index, number: index + 2, active: index < levels.length });
    }
    let saveLabel = "Common.Save";
    if (!this.templateId && !this.isPlayerCopy) saveLabel = "Editor.Create";
    return Object.assign(context, {
      clue: clueData,
      levelCount: levels.length + 1,
      levelCountChoices,
      levelSlots,
      tagsValue: (clueData.tags ?? []).join(","),
      typeChoices,
      zoneModeChoices: getZoneModeChoices(),
      rollModeChoices: getRollModeChoices(),
      checkSuggestions: getCheckSuggestions(),
      kindChoices: getKindChoices(),
      fontChoices: getFontChoices(),
      inkSwatches: getInkSwatches(clueData.visual?.textColor),
      tintSwatches: getTintSwatches(clueData.visual?.tint),
      isPlayerCopy: this.isPlayerCopy,
      canGrant: Boolean(this.templateId),
      buttons: [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: fullKey(saveLabel) }]
    });
  }

  /** @inheritDoc */
  async _preparePartContext(partId, context, options) {
    const partContext = await super._preparePartContext(partId, context, options);
    if (partContext.tabs?.[partId]) partContext.tab = partContext.tabs[partId];
    return partContext;
  }

  /** @inheritDoc */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const refreshLater = foundry.utils.debounce(() => this.#refreshPreviews(), 100);
    this.element.addEventListener("input", refreshLater);
    this.element.addEventListener("change", refreshLater);
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#refreshPreviews();
    const kindSelect = this.element.querySelector("select[name='visual.kind']");
    kindSelect?.addEventListener("change", () => this.#syncKindFields());
    this.#syncKindFields();
    attachCheckFields(this.element);
    const levelCountSelect = this.element.querySelector("select[name='levelCount']");
    const syncLevelSlots = () => {
      const levelCount = Number(levelCountSelect?.value) || 1;
      for (const slotElement of this.element.querySelectorAll(".level-slot[data-level-number]")) {
        slotElement.hidden = Number(slotElement.dataset.levelNumber) > levelCount;
      }
    };
    levelCountSelect?.addEventListener("change", syncLevelSlots);
    const modeSelect = this.element.querySelector("select[name='detection.zoneMode']");
    modeSelect?.addEventListener("change", () => this.#syncRadiusField());
    this.#syncRadiusField();
  }

  /** Живые превью: картинка на «Сводке» и карточка доски на «Визуализации». */
  #refreshPreviews() {
    const formValues = new foundry.applications.ux.FormDataExtended(this.element).object;
    const imagePreview = this.element.querySelector(".editor-image-preview");
    if (imagePreview && formValues.img) imagePreview.src = formValues.img;
    const previewStage = this.element.querySelector("[data-visual-preview]");
    if (!previewStage) return;
    const visual = {};
    for (const [key, value] of Object.entries(formValues)) {
      if (key.startsWith("visual.")) visual[key.slice("visual.".length)] = value;
    }
    renderCardMiniPreview(previewStage, {
      name: formValues.name || localize("Editor.NewClue"),
      img: formValues.img,
      description: formValues.description,
      visual
    });
  }

  /** Поля вкладки «Визуализация» зависят от вида карточки. */
  #syncKindFields() {
    const kind = this.element.querySelector("select[name='visual.kind']")?.value;
    for (const fieldGroup of this.element.querySelectorAll("[data-kinds]")) {
      fieldGroup.hidden = !fieldGroup.dataset.kinds.split(" ").includes(kind);
    }
  }

  #syncRadiusField() {
    const zoneMode = this.element.querySelector("select[name='detection.zoneMode']")?.value;
    const radiusGroup = this.element.querySelector(".zone-radius-group");
    if (radiusGroup) radiusGroup.hidden = zoneMode !== "battlemap";
  }

  /** @this {ClueEditorApplication} */
  static async #onSubmit(event, form, formData) {
    const submitted = foundry.utils.expandObject(formData.object);
    const levelCount = Number(submitted.levelCount) || 1;
    const submittedLevels = Object.entries(submitted.levels ?? {})
      .sort(([firstIndex], [secondIndex]) => Number(firstIndex) - Number(secondIndex))
      .map(([, level]) => level)
      .slice(0, levelCount - 1);
    const clueContent = {
      name: submitted.name,
      img: submitted.img,
      typeId: submitted.typeId,
      description: submitted.description,
      tags: submitted.tags,
      visual: submitted.visual ?? {},
      levels: normalizeLevels(submittedLevels)
    };
    if (this.isPlayerCopy) {
      await updatePlayerClueContent(this.ownerUser, this.originId, clueContent);
      return;
    }
    const templateData = { ...clueContent, detection: submitted.detection ?? {} };
    if (this.templateId) {
      await updateClueTemplate(this.templateId, templateData);
    } else {
      this.templateId = await createClueTemplate({ ...templateData, folderId: this.newFolderId });
      ui.notifications.info(localize("Editor.Created"));
    }
  }

  static async #onAddClueType() {
    const typeId = await editClueTypeDialog();
    if (!typeId) return;
    const typeSelect = this.element.querySelector("select[name='typeId']");
    if (!typeSelect) return;
    const createdType = getClueTypeList().find((clueType) => clueType.id === typeId);
    const optionElement = document.createElement("option");
    optionElement.value = typeId;
    optionElement.textContent = createdType?.name ?? typeId;
    typeSelect.append(optionElement);
    typeSelect.value = typeId;
  }

  static async #onGrantToPlayers() {
    if (!this.templateId) return;
    const recipientIds = await pickRecipients({ title: localize("Grant.PickTitle"), confirmLabel: localize("Grant.Confirm") });
    if (!recipientIds) return;
    const addedCount = await grantCluesFromTemplates([this.templateId], recipientIds);
    ui.notifications.info(format("Grant.Done", { count: addedCount }));
  }
}

/** Уровни копии игрока для формы: свои после правки ГМ, иначе текущие из шаблона. */
function readCopyLevels(playerClue) {
  if (playerClue.customLevels) return playerClue.levelsSnapshot ?? [];
  return getClueTemplate(playerClue.originId)?.levels ?? playerClue.levelsSnapshot ?? [];
}

/** Открыть редактор шаблона (без id — новый шаблон). @param {string} [templateId] */
export function openTemplateEditor(templateId, { folderId = null } = {}) {
  const target = { templateId, folderId };
  return openSingleton(ClueEditorApplication.buildId(target), () => new ClueEditorApplication(target));
}

/** Открыть редактор копии улики игрока. @param {User} ownerUser @param {string} originId */
export function openPlayerClueEditor(ownerUser, originId) {
  const target = { ownerUser, originId };
  return openSingleton(ClueEditorApplication.buildId(target), () => new ClueEditorApplication(target));
}
