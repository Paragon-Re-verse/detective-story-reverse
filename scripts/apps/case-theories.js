import { MODULE_ID, TEMPLATE_PATH } from "../constants.js";
import { localize, format } from "../i18n.js";
import { DetectiveApplication, openSingleton, EmbeddedMixin } from "./base-application.js";
import { isProfiler } from "../permissions.js";
import {
  getCase,
  getCaseLabel,
  submitTheory,
  decideTheory,
  saveSolution,
  closeCaseWithSolution,
  compareTheory,
  getArchivedSuspect,
  canManageCase,
  CASE_STATUS,
  THEORY_VERDICTS
} from "../data/cases.js";
import { getSuspect } from "../data/suspects.js";
import { listPlayerClues, getPlayerClue } from "../data/player-clues.js";
import { getClueTemplate, listClueTemplates } from "../data/clue-templates.js";
import { listCaseClueIds } from "../data/case-progress.js";
import { formatDateTime } from "./view-helpers.js";
import { escapeText } from "../chat.js";
import { offerSuspectShelving, buildSuspectPickerItems } from "./suspect-shelving.js";
import { attachPickers, toPickerItem } from "./view-helpers.js";

const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

/**
 * Версии по делу. Профайлер выдвигает версии и видит только свои (п. 10); ГМ видит все, сверяет их с заранее
 * заданной разгадкой («совпало / не совпало»), отмечает «верно / неверно» и закрывает дело, решая,
 * показывать ли развязку игрокам (п. 11).
 */
export class CaseTheoriesApplication extends DetectiveApplication {
  /** @param {string} caseId */
  constructor(caseId, options = {}) {
    super({ id: CaseTheoriesApplication.buildId(caseId), ...options });
    this.caseId = caseId;
  }

  static buildId(caseId) {
    return `detective-story-theories-${caseId}`;
  }

  static DEFAULT_OPTIONS = {
    classes: ["case-theories"],
    window: { icon: "fa-solid fa-lightbulb", resizable: true },
    position: { width: 640, height: 640 },
    actions: {
      submitTheory: CaseTheoriesApplication.#onSubmitTheory,
      editSolution: CaseTheoriesApplication.#onEditSolution,
      closeWithSolution: CaseTheoriesApplication.#onCloseWithSolution,
      revealSolution: CaseTheoriesApplication.#onRevealSolution,
      markCorrect: CaseTheoriesApplication.#onMarkCorrect,
      markWrong: CaseTheoriesApplication.#onMarkWrong,
      clearVerdict: CaseTheoriesApplication.#onClearVerdict
    }
  };

  static PARTS = {
    theories: { template: `${TEMPLATE_PATH}/apps/case-theories.hbs`, scrollable: [""] }
  };

  get title() {
    const caseData = getCase(this.caseId);
    if (!caseData) return localize("Theories.Title");
    return format("Theories.TitleFor", { label: getCaseLabel(caseData) });
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const caseData = getCase(this.caseId);
    if (!caseData) return Object.assign(context, { missing: true });
    const isGameMaster = game.user.isGM;
    const isClosed = caseData.status === CASE_STATUS.closed;
    const theories = Object.values(caseData.theories)
      .filter((theory) => isGameMaster || theory.authorId === game.user.id)
      .sort((first, second) => second.createdAt - first.createdAt)
      .map((theory) => {
        let match = null;
        if (isGameMaster) match = compareTheory(theory, caseData.solution);
        let verdictLabel = localize("Theories.Pending");
        if (theory.verdict) verdictLabel = localize(`Theories.Verdict.${theory.verdict}`);
        return { ...describeVersion(theory), id: theory.id, authorName: theory.authorName, verdict: theory.verdict, verdictLabel, dateLabel: formatDateTime(theory.createdAt), match };
      });
    const solution = caseData.solution;
    const solutionIsEmpty = !solution.suspectIds.length && !solution.clueIds.length && !solution.motive && !solution.method && !solution.text;
    return Object.assign(context, {
      isGameMaster,
      isClosed,
      canSubmit: isProfiler() && canManageCase(caseData) && !isClosed,
      theories,
      showSolution: isGameMaster || solution.revealed,
      solution: { ...describeVersion(solution), text: solution.text, revealed: solution.revealed, isEmpty: solutionIsEmpty }
    });
  }

  /** @inheritDoc */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.subscribe("updateJournalEntry", (journalEntry) => {
      if (journalEntry.id === this.caseId) this.queuePartRender("theories");
    });
    this.subscribe("deleteJournalEntry", (journalEntry) => {
      if (journalEntry.id === this.caseId) this.close();
    });
  }

  static async #onSubmitTheory() {
    const caseData = getCase(this.caseId);
    if (!caseData) return;
    // Улики версии — из своего списка; прикреплённые к делу идут первыми.
    const ownClues = listPlayerClues(game.user).sort((first, second) => Number(Boolean(caseData.pinned[second.originId])) - Number(Boolean(caseData.pinned[first.originId])));
    const formValues = await theoryFormDialog({
      title: localize("Theories.Submit"),
      linkedSuspectIds: caseData.suspectIds,
      clues: ownClues.map((playerClue) => ({ id: playerClue.originId, name: playerClue.name, img: playerClue.img, tags: playerClue.tags }))
    });
    if (!formValues) return;
    if (!formValues.suspectIds.length) {
      ui.notifications.warn(localize("Theories.SuspectRequired"));
      return;
    }
    const saved = await submitTheory(this.caseId, formValues);
    if (saved) ui.notifications.info(localize("Theories.Submitted"));
  }

  static async #onEditSolution() {
    const caseData = getCase(this.caseId);
    if (!caseData) return;
    let templates = listCaseClueIds(caseData).map((templateId) => getClueTemplate(templateId)).filter(Boolean);
    if (!templates.length) templates = listClueTemplates();
    const formValues = await theoryFormDialog({
      title: localize("Theories.EditSolution"),
      linkedSuspectIds: caseData.suspectIds,
      clues: templates.map((template) => ({ id: template.id, name: template.name, img: template.img, tags: template.tags })),
      initial: caseData.solution,
      showText: true
    });
    if (formValues) await saveSolution(this.caseId, formValues);
  }

  static async #onCloseWithSolution() {
    const reveal = await askRevealOnClose();
    if (reveal === null) return;
    await closeCaseWithSolution(this.caseId, reveal);
    if (reveal) await postSolutionToChat(this.caseId);
    await offerSuspectShelving(this.caseId);
  }

  static async #onRevealSolution() {
    const confirmed = await DialogV2.confirm({
      window: { title: localize("Theories.Reveal") },
      content: `<p>${localize("Theories.RevealConfirm")}</p>`,
      rejectClose: false
    });
    if (!confirmed) return;
    await closeCaseWithSolution(this.caseId, true);
    await postSolutionToChat(this.caseId);
  }

  static #onMarkCorrect(event, target) {
    return this.#decide(target, THEORY_VERDICTS.correct);
  }

  static #onMarkWrong(event, target) {
    return this.#decide(target, THEORY_VERDICTS.wrong);
  }

  static #onClearVerdict(event, target) {
    return this.#decide(target, null);
  }

  async #decide(target, verdict) {
    const theoryId = target.closest("[data-theory-id]")?.dataset.theoryId;
    if (theoryId) await decideTheory(this.caseId, theoryId, verdict);
  }
}

/** Подозреваемый по id: живое досье или архивный снимок из дела. */
function findSuspect(suspectId) {
  return getSuspect(suspectId) ?? getArchivedSuspect(suspectId);
}

/** Название и картинка улики: своя копия, иначе шаблон. */
function findClue(originId) {
  const clue = getPlayerClue(game.user, originId) ?? getClueTemplate(originId);
  if (clue) return { name: clue.name, img: clue.img };
  return { name: localize("Zone.TemplateDeleted"), img: "" };
}

/** Версия или разгадка для показа: имена подозреваемых и улик вместо id. */
function describeVersion(version) {
  return {
    suspects: version.suspectIds.map((suspectId) => {
      const suspect = findSuspect(suspectId);
      return { name: suspect?.name ?? "?", portrait: suspect?.portrait ?? "" };
    }),
    clues: version.clueIds.map((originId) => findClue(originId)),
    motive: version.motive,
    method: version.method
  };
}

/**
 * Форма версии или разгадки: подозреваемые, мотив, способ, улики (с поиском), для разгадки — текст развязки.
 * @returns {Promise<{suspectIds: string[], clueIds: string[], motive: string, method: string, text: string}|null>}
 */
async function theoryFormDialog({ title, linkedSuspectIds, clues, initial = null, showText = false }) {
  const selectedSuspects = new Set(initial?.suspectIds ?? []);
  const selectedClues = new Set(initial?.clueIds ?? []);
  const content = await renderTemplate(`${TEMPLATE_PATH}/apps/theory-form.hbs`, {
    suspects: buildSuspectPickerItems(linkedSuspectIds, selectedSuspects),
    suspectToggleLabel: localize("Suspect.SearchShelved"),
    clues: clues.map((clue) => toPickerItem({ ...clue, selected: selectedClues.has(clue.id) })),
    motive: initial?.motive ?? "",
    method: initial?.method ?? "",
    text: initial?.text ?? "",
    showText
  });
  const result = await DialogV2.wait({
    window: { title, icon: "fa-solid fa-lightbulb" },
    classes: ["detective-story", "theory-form-dialog"],
    position: { width: 520 },
    content,
    render: (event, dialog) => attachPickers(dialog.element),
    buttons: [
      {
        action: "save",
        label: localize("Common.Save"),
        icon: "fa-solid fa-check",
        default: true,
        callback: (event, button) => {
          const form = button.form;
          const checkedValues = (name) => [...form.querySelectorAll(`input[name='${name}']:checked`)].map((input) => input.value);
          return {
            suspectIds: checkedValues("suspect"),
            clueIds: checkedValues("clue"),
            motive: form.elements.motive?.value ?? "",
            method: form.elements.method?.value ?? "",
            text: form.elements.text?.value ?? ""
          };
        }
      },
      { action: "cancel", label: localize("Common.Cancel"), icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (!result || typeof result !== "object") return null;
  return result;
}

/** @returns {Promise<boolean|null>} показывать ли развязку; null — отмена */
async function askRevealOnClose() {
  const choice = await DialogV2.wait({
    window: { title: localize("Theories.CloseCase"), icon: "fa-solid fa-lock" },
    classes: ["detective-story"],
    content: `<p>${localize("Theories.CloseConfirm")}</p>`,
    buttons: [
      { action: "reveal", label: localize("Theories.CloseAndReveal"), icon: "fa-solid fa-bullhorn", default: true },
      { action: "silent", label: localize("Theories.CloseSilently"), icon: "fa-solid fa-lock" },
      { action: "cancel", label: localize("Common.Cancel"), icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (choice === "reveal") return true;
  if (choice === "silent") return false;
  return null;
}

/** HTML развязки: для окна у всех и для сообщения в чате (остаётся для тех, кто не в сети). */
async function renderSolutionHtml(caseData) {
  const solution = caseData.solution;
  const summary = await renderTemplate(`${TEMPLATE_PATH}/partials/theory-summary.hbs`, { ...describeVersion(solution), text: solution.text });
  return `<div class="detective-story-chat solution-reveal"><h3><i class="fa-solid fa-key" inert></i> ${escapeText(format("Theories.RevealHeading", { label: getCaseLabel(caseData), title: caseData.title }))}</h3>${summary}</div>`;
}

/** Развязка в чат — от имени ГМ, видна всем. */
async function postSolutionToChat(caseId) {
  const caseData = getCase(caseId);
  if (!caseData) return;
  await ChatMessage.create({ content: await renderSolutionHtml(caseData), speaker: ChatMessage.getSpeaker({ user: game.user }) });
}

/**
 * Окно развязки у каждого клиента, когда ГМ её открыл. Срабатывает на переходе revealed → true.
 * @param {JournalEntry} journalEntry
 * @param {object} changes
 */
export async function onCaseSolutionRevealed(journalEntry, changes) {
  const solutionChanges = changes?.flags?.[MODULE_ID]?.case?.solution;
  if (solutionChanges?.revealed !== true) return;
  // Импорт дела с уже показанной разгадкой не должен открывать окно заново: только свежий показ.
  if (Date.now() - (Number(solutionChanges.revealedAt) || 0) > 60000) return;
  const caseData = getCase(journalEntry.id);
  if (!caseData) return;
  await DialogV2.prompt({
    window: { title: localize("Theories.RevealTitle"), icon: "fa-solid fa-key" },
    classes: ["detective-story", "solution-reveal-dialog"],
    position: { width: 520 },
    content: await renderSolutionHtml(caseData),
    ok: { label: localize("Common.Ok"), icon: "fa-solid fa-check" },
    rejectClose: false
  });
}

/** @param {string} caseId */
export function openCaseTheories(caseId) {
  return openSingleton(CaseTheoriesApplication.buildId(caseId), () => new CaseTheoriesApplication(caseId));
}

/** Тот же вид внутри вкладки журнала дела. */
export class EmbeddedTheories extends EmbeddedMixin(CaseTheoriesApplication) {}
