import { TEMPLATE_PATH } from "../constants.js";
import { localize } from "../i18n.js";
import { saveCustomClueType } from "../data/clue-types.js";

const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

/**
 * Создать или изменить свой тип улики: название и иконка (файл выбирается или загружается).
 * @param {{id?: string, name?: string, icon?: string}} [existingType]
 * @returns {Promise<string|null>} id типа
 */
export async function editClueTypeDialog(existingType = {}) {
  const content = await renderTemplate(`${TEMPLATE_PATH}/apps/clue-type-dialog.hbs`, { clueType: existingType });
  let title = localize("ClueTypes.NewTitle");
  if (existingType.id) title = localize("ClueTypes.EditTitle");
  const formValues = await DialogV2.wait({
    window: { title, icon: "fa-solid fa-tags" },
    classes: ["detective-story"],
    content,
    buttons: [
      {
        action: "save",
        label: localize("Common.Save"),
        icon: "fa-solid fa-floppy-disk",
        default: true,
        callback: (event, button) => {
          const formObject = new foundry.applications.ux.FormDataExtended(button.form).object;
          return { name: String(formObject.name ?? ""), icon: String(formObject.icon ?? "") };
        }
      },
      { action: "cancel", label: localize("Common.Cancel"), icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (!formValues || typeof formValues !== "object") return null;
  if (!formValues.name.trim()) {
    ui.notifications.warn(localize("ClueTypes.NameRequired"));
    return null;
  }
  return saveCustomClueType({ id: existingType.id, name: formValues.name, icon: formValues.icon });
}
