import { localize } from "../i18n.js";
import { canEditSuspects } from "../permissions.js";
import { getCase, listCases } from "../data/cases.js";
import { getSuspect, listSuspects, setSuspectShelved } from "../data/suspects.js";
import { pickItemsDialog, toPickerItem } from "./view-helpers.js";

/**
 * Дело закрыто: предложить отправить в архив подозреваемых, которые больше ни в одном открытом деле
 * не участвуют (п. 20). Все отмечены, лишние можно снять.
 * @param {string} caseId
 */
export async function offerSuspectShelving(caseId) {
  const caseData = getCase(caseId);
  if (!caseData || !canEditSuspects()) return;
  const otherOpenCases = listCases({ includeClosed: false }).filter((entry) => entry.id !== caseId);
  const candidates = caseData.suspectIds
    .map((suspectId) => getSuspect(suspectId))
    .filter((suspect) => suspect && !suspect.shelved)
    .filter((suspect) => !otherOpenCases.some((entry) => entry.suspectIds.includes(suspect.id)));
  if (!candidates.length) return;
  const pickedIds = await pickItemsDialog({
    title: localize("Suspect.ShelveAfterClose"),
    icon: "fa-solid fa-box-archive",
    items: candidates.map((suspect) => ({ id: suspect.id, name: suspect.name, img: suspect.portrait, tags: suspect.tags, selected: true })),
    confirmLabel: localize("Suspect.Shelve")
  });
  for (const suspectId of pickedIds ?? []) await setSuspectShelved(suspectId, true);
}

/**
 * Подозреваемые для сетки выбора в формах: привязанные к делу — первыми, архивные скрыты до галочки
 * «Искать в архиве» (кроме уже выбранных).
 * @param {string[]} linkedIds
 * @param {Set<string>} selectedIds
 */
export function buildSuspectPickerItems(linkedIds, selectedIds) {
  return listSuspects()
    .sort((first, second) => Number(linkedIds.includes(second.id)) - Number(linkedIds.includes(first.id)))
    .map((suspect) => {
      let badge = "";
      if (suspect.shelved) badge = localize("Suspect.ShelvedBadge");
      return toPickerItem({
        id: suspect.id,
        name: suspect.name,
        img: suspect.portrait,
        tags: suspect.tags,
        selected: selectedIds.has(suspect.id),
        extra: suspect.shelved && !linkedIds.includes(suspect.id),
        badge
      });
    });
}
