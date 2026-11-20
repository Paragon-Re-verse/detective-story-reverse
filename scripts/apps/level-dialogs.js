import { localize, format } from "../i18n.js";
import { getPlayerClue } from "../data/player-clues.js";
import { getClueTemplate } from "../data/clue-templates.js";
import { getClueLevels, setClueLevelOpen, setClueLevelForUsers, listClueHolders, describeCheck, getLevelLabel } from "../data/clue-levels.js";

const { DialogV2 } = foundry.applications.api;

/**
 * Окна ГМ для уровней улики: уровни одной улики у одного игрока (Окно ГМ → Игроки, п. 7б)
 * и один уровень сразу у всех, у кого есть улика (библиотека, п. 7в).
 */

/** Галочки «открыт» для каждого уровня 2–6 улики игрока. */
export async function editPlayerLevelsDialog(user, originId) {
  const playerClue = getPlayerClue(user, originId);
  if (!playerClue || !game.user.isGM) return;
  const extraLevels = getClueLevels(playerClue).filter((level) => level.number > 1);
  if (!extraLevels.length) {
    ui.notifications.info(localize("Levels.NoExtraLevels"));
    return;
  }
  const rows = extraLevels.map((level) => {
    let checked = "";
    if (level.open) checked = "checked";
    return `<li><label class="checkbox"><input type="checkbox" name="level" value="${level.number}" ${checked}> <strong>${foundry.utils.escapeHTML(getLevelLabel(level.number))}</strong> <span class="hint">${foundry.utils.escapeHTML(describeCheck(level.check))} · ${foundry.utils.escapeHTML(format("Levels.Dc", { dc: level.dc }))}</span></label></li>`;
  });
  const openNumbers = await DialogV2.wait({
    window: { title: format("Levels.PlayerTitle", { clue: playerClue.name, player: user.name }), icon: "fa-solid fa-layer-group" },
    classes: ["detective-story"],
    content: `<p class="hint">${localize("Levels.PlayerHint")}</p><ul class="picker-list compact">${rows.join("")}</ul>`,
    buttons: [
      {
        action: "save",
        label: localize("Common.Save"),
        icon: "fa-solid fa-check",
        default: true,
        callback: (event, button) => [...button.form.querySelectorAll("input[name='level']:checked")].map((input) => Number(input.value))
      },
      { action: "cancel", label: localize("Common.Cancel"), icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (!Array.isArray(openNumbers)) return;
  for (const level of extraLevels) await setClueLevelOpen(user, originId, level.number, openNumbers.includes(level.number));
}

/** Открыть или закрыть один уровень у отмеченных игроков, у которых есть улика. */
export async function setLevelForHoldersDialog(templateId) {
  const template = getClueTemplate(templateId);
  if (!template || !game.user.isGM) return;
  if (!template.levels.length) {
    ui.notifications.info(localize("Levels.NoExtraLevels"));
    return;
  }
  const holders = listClueHolders(templateId);
  if (!holders.length) {
    ui.notifications.info(localize("Levels.NoHolders"));
    return;
  }
  const levelOptions = template.levels.map((level, index) => `<option value="${index + 2}">${foundry.utils.escapeHTML(getLevelLabel(index + 2))}</option>`).join("");
  const holderRows = holders.map((user) => `<li><label class="checkbox"><input type="checkbox" name="holder" value="${user.id}" checked> ${foundry.utils.escapeHTML(user.name)}</label></li>`).join("");
  const choice = await DialogV2.wait({
    window: { title: format("Levels.HoldersTitle", { clue: template.name }), icon: "fa-solid fa-layer-group" },
    classes: ["detective-story"],
    content: `<div class="form-group"><label>${localize("Levels.Level")}</label><div class="form-fields"><select name="level">${levelOptions}</select></div></div><p class="hint">${localize("Levels.HoldersHint")}</p><ul class="picker-list compact">${holderRows}</ul>`,
    buttons: [
      { action: "open", label: localize("Levels.Open"), icon: "fa-solid fa-lock-open", default: true, callback: (event, button) => readHolderChoice(button.form, true) },
      { action: "close", label: localize("Levels.Close"), icon: "fa-solid fa-lock", callback: (event, button) => readHolderChoice(button.form, false) },
      { action: "cancel", label: localize("Common.Cancel"), icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (!choice || typeof choice !== "object") return;
  const changedCount = await setClueLevelForUsers(choice.userIds, templateId, choice.level, choice.open);
  ui.notifications.info(format("Levels.HoldersDone", { count: changedCount }));
}

function readHolderChoice(form, open) {
  return {
    open,
    level: Number(form.elements.level.value),
    userIds: [...form.querySelectorAll("input[name='holder']:checked")].map((input) => input.value)
  };
}
