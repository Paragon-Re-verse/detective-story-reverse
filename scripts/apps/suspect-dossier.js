import { TEMPLATE_PATH, BOARD_ASSET_PATH } from "../constants.js";
import { localize, format, fullKey } from "../i18n.js";
import { DetectiveApplication, openSingleton } from "./base-application.js";
import { canEditSuspects } from "../permissions.js";
import { setSuspectShelved, getSuspect, createSuspect, updateSuspect, deleteSuspect, getSuspectNotes, setSuspectNotes } from "../data/suspects.js";
import { listCasesWithSuspect, getArchivedSuspect, getCaseLabel } from "../data/cases.js";
import { enrichText } from "./view-helpers.js";

/** Живое досье или архивный снимок из дела. @param {string|null} suspectId */
function findSuspectRecord(suspectId) {
  return getSuspect(suspectId) ?? getArchivedSuspect(suspectId);
}

/**
 * Досье подозреваемого: портрет, имя, описание, внешность, теги и личные заметки каждого игрока.
 * Правят ГМ и профайлер (без ведущего — они владельцы журнала); остальные только читают.
 * Архивный подозреваемый (досье удалено, снимок остался в деле) показывается только для чтения.
 */
export class SuspectDossierApplication extends DetectiveApplication {
  /** @param {string|null} suspectId - null для нового подозреваемого */
  constructor(suspectId, options = {}) {
    super({ ...options, id: SuspectDossierApplication.buildId(suspectId) });
    this.suspectId = suspectId;
    this.editing = !suspectId;
  }

  static buildId(suspectId) {
    return `detective-story-suspect-${suspectId ?? "new"}`;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["suspect-dossier"],
    window: { icon: "fa-solid fa-user-secret", resizable: true, contentClasses: ["standard-form"] },
    position: { width: 560, height: "auto" },
    form: {
      handler: SuspectDossierApplication.#onSubmit,
      submitOnChange: false,
      closeOnSubmit: false
    },
    actions: {
      toggleEdit: SuspectDossierApplication.#onToggleEdit,
      deleteSuspect: SuspectDossierApplication.#onDeleteSuspect,
      toggleShelved: SuspectDossierApplication.#onToggleShelved
    }
  };

  static PARTS = {
    dossier: { template: `${TEMPLATE_PATH}/apps/suspect-dossier.hbs`, scrollable: [""] }
  };

  get title() {
    const suspect = findSuspectRecord(this.suspectId);
    if (suspect) return suspect.name;
    return localize("Suspect.NewTitle");
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    let suspect = findSuspectRecord(this.suspectId);
    if (!suspect) {
      suspect = { id: null, name: "", portrait: `${BOARD_ASSET_PATH}/placeholder.webp`, description: "", appearance: "", tags: [] };
    }
    const canEdit = canEditSuspects() && !suspect.archived;
    return Object.assign(context, {
      suspect,
      tagsValue: suspect.tags.join(","),
      enrichedDescription: await enrichText(suspect.description),
      enrichedAppearance: await enrichText(suspect.appearance),
      notes: getSuspectNotes(this.suspectId ?? ""),
      isNew: !this.suspectId,
      canEdit,
      editing: canEdit && this.editing,
      saveLabel: fullKey("Common.Save")
    });
  }

  /** @inheritDoc */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.subscribe("updateJournalEntry", (journalEntry) => {
      if (journalEntry.id === this.suspectId && !this.editing) this.render();
    });
    this.subscribe("deleteJournalEntry", (journalEntry) => {
      if (journalEntry.id !== this.suspectId) return;
      this.editing = false;
      if (getArchivedSuspect(this.suspectId)) {
        this.render();
      } else {
        this.close();
      }
    });
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const notesField = this.element.querySelector("textarea[name='personalNotes']");
    notesField?.addEventListener("change", (event) => {
      event.stopPropagation();
      if (this.suspectId) setSuspectNotes(this.suspectId, notesField.value);
    });
  }

  /** @this {SuspectDossierApplication} */
  static async #onSubmit(event, form, formData) {
    if (!canEditSuspects() || !this.editing) return;
    const submitted = foundry.utils.expandObject(formData.object);
    const suspectData = {
      name: submitted.name,
      portrait: submitted.portrait,
      description: submitted.description,
      appearance: submitted.appearance,
      tags: submitted.tags
    };
    if (this.suspectId) {
      await updateSuspect(this.suspectId, suspectData);
      this.editing = false;
      this.render();
      return;
    }
    const createdId = await createSuspect(suspectData);
    if (!createdId) return;
    await this.close();
    openSuspectDossier(createdId);
  }

  static #onToggleEdit() {
    if (!canEditSuspects()) return;
    this.editing = !this.editing;
    this.render();
  }

  static async #onToggleShelved() {
    const suspect = getSuspect(this.suspectId);
    if (suspect) await setSuspectShelved(this.suspectId, !suspect.shelved);
  }

  static async #onDeleteSuspect() {
    if (!this.suspectId) return;
    const suspect = getSuspect(this.suspectId);
    let content = `<p>${foundry.utils.escapeHTML(suspect?.name ?? "")}</p><p>${localize("Suspect.DeleteConfirm")}</p>`;
    const linkedCases = listCasesWithSuspect(this.suspectId);
    if (linkedCases.length) {
      const caseLabels = linkedCases.map((caseData) => `${getCaseLabel(caseData)} ${format("Common.Quoted", { text: caseData.title })}`).join(", ");
      content += `<p class="hint">${foundry.utils.escapeHTML(format("Suspect.DeleteArchiveNote", { cases: caseLabels }))}</p>`;
    }
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: localize("Suspect.DeleteTitle") },
      content,
      rejectClose: false
    });
    if (confirmed) await deleteSuspect(this.suspectId);
  }
}

/** @param {string|null} [suspectId] */
export function openSuspectDossier(suspectId = null) {
  if (suspectId && !findSuspectRecord(suspectId)) {
    ui.notifications.info(localize("Suspect.Deleted"));
    return null;
  }
  return openSingleton(SuspectDossierApplication.buildId(suspectId), () => new SuspectDossierApplication(suspectId));
}

