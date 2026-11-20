import { MODULE_ID, TEMPLATE_PATH } from "../constants.js";
import { localize, format } from "../i18n.js";
import { DetectiveApplication, openSingleton, EmbeddedMixin } from "./base-application.js";
import { getSetting, SETTING_KEYS } from "../settings.js";
import { getCase, getCaseLabel, saveCaseClueSources, canManageCase, CASE_STATUS } from "../data/cases.js";
import { buildCaseProgress } from "../data/case-progress.js";
import { listClueTemplates } from "../data/clue-templates.js";
import { getChangedSectionKeys } from "../data/user-flags.js";
import { buildFolderNodes, flattenFolderNodes } from "../data/folder-tree.js";
import { attachPickers, toPickerItem } from "./view-helpers.js";

const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

/**
 * Прогресс дела для ГМ и профайлера (п. 13): таблица «улика × игроки». ГМ видит все улики дела и общий счёт
 * (п. 16), профайлер — только улики, которые уже нашёл кто-то из игроков (п. 17).
 */
export class CaseProgressApplication extends DetectiveApplication {
  /** @param {string} caseId */
  constructor(caseId, options = {}) {
    super({ id: CaseProgressApplication.buildId(caseId), ...options });
    this.caseId = caseId;
  }

  static buildId(caseId) {
    return `detective-story-progress-${caseId}`;
  }

  static DEFAULT_OPTIONS = {
    classes: ["case-progress"],
    window: { icon: "fa-solid fa-chart-simple", resizable: true },
    position: { width: 760, height: 520 },
    actions: {
      editSources: CaseProgressApplication.#onEditSources
    }
  };

  static PARTS = {
    progress: { template: `${TEMPLATE_PATH}/apps/case-progress.hbs`, scrollable: [".progress-scroll"] }
  };

  get title() {
    const caseData = getCase(this.caseId);
    if (!caseData) return localize("Progress.Title");
    return format("Progress.TitleFor", { label: getCaseLabel(caseData) });
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const caseData = getCase(this.caseId);
    if (!caseData || !canManageCase(caseData)) return Object.assign(context, { missing: true });
    return Object.assign(context, {
      isGameMaster: game.user.isGM,
      isClosed: caseData.status === CASE_STATUS.closed,
      progress: buildCaseProgress(caseData, { onlyFound: !game.user.isGM })
    });
  }

  /** @inheritDoc */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const rerender = () => this.queuePartRender("progress");
    this.subscribe("updateUser", (user, changes) => {
      if (getChangedSectionKeys(changes, "clues") || getChangedSectionKeys(changes, "zoneState")) rerender();
    });
    this.subscribe("updateJournalEntry", (journalEntry) => {
      const moduleFlags = journalEntry.flags?.[MODULE_ID];
      if (journalEntry.id === this.caseId || moduleFlags?.template) rerender();
    });
    this.subscribe("deleteJournalEntry", (journalEntry) => {
      if (journalEntry.id === this.caseId) this.close();
    });
    for (const hookName of ["createTile", "updateTile", "deleteTile"]) this.subscribe(hookName, rerender);
    this.subscribe("updateSetting", (setting) => {
      if (setting.key === `${MODULE_ID}.${SETTING_KEYS.libraryFolders}`) rerender();
    });
  }

  /** ГМ выбирает, какие улики относятся к делу: папки библиотеки и/или отдельные шаблоны (п. 14). */
  static async #onEditSources() {
    const caseData = getCase(this.caseId);
    if (!caseData || !game.user.isGM) return;
    const selectedFolders = new Set(caseData.clueSources.folderIds);
    const selectedTemplates = new Set(caseData.clueSources.templateIds);
    const folderNodes = flattenFolderNodes(buildFolderNodes(getSetting(SETTING_KEYS.libraryFolders) ?? {}, {}));
    const content = await renderTemplate(`${TEMPLATE_PATH}/apps/clue-sources.hbs`, {
      folders: folderNodes.map((node) => ({ id: node.id, name: node.name, indent: (node.depth - 1) * 16, selected: selectedFolders.has(node.id) })),
      templates: listClueTemplates().map((template) => toPickerItem({
        id: template.id,
        name: template.name,
        img: template.img,
        tags: template.tags,
        selected: selectedTemplates.has(template.id)
      }))
    });
    const sources = await DialogV2.wait({
      window: { title: localize("Progress.Sources"), icon: "fa-solid fa-list-check" },
      classes: ["detective-story", "clue-sources-dialog"],
      position: { width: 480 },
      content,
      render: (event, dialog) => attachPickers(dialog.element),
      buttons: [
        {
          action: "save",
          label: localize("Common.Save"),
          icon: "fa-solid fa-check",
          default: true,
          callback: (event, button) => ({
            folderIds: [...button.form.querySelectorAll("input[name='folder']:checked")].map((input) => input.value),
            templateIds: [...button.form.querySelectorAll("input[name='template']:checked")].map((input) => input.value)
          })
        },
        { action: "cancel", label: localize("Common.Cancel"), icon: "fa-solid fa-xmark" }
      ],
      rejectClose: false
    });
    if (sources && typeof sources === "object") await saveCaseClueSources(this.caseId, sources);
  }
}

/** @param {string} caseId */
export function openCaseProgress(caseId) {
  if (!canManageCase(getCase(caseId))) return null;
  return openSingleton(CaseProgressApplication.buildId(caseId), () => new CaseProgressApplication(caseId));
}

/** Тот же вид внутри вкладки журнала дела. */
export class EmbeddedProgress extends EmbeddedMixin(CaseProgressApplication) {}
