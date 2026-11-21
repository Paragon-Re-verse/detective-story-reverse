import { TEMPLATE_PATH } from "../constants.js";
import { localize, format } from "../i18n.js";
import {
  createFolder,
  updateFolder,
  moveFolder,
  deleteFolder,
  describeFolderContents,
  getCollapsedFolderIds,
  setFolderCollapsed,
  getTreeLayout,
  setTreeLayout,
  isImageIcon,
  DEFAULT_FOLDER_COLOR,
  DEFAULT_FOLDER_ICON,
  FOLDER_SCOPES
} from "../data/clue-folders.js";
import { MAX_FOLDER_DEPTH, buildFolderNodes, flattenFolderNodes, resolveFolderId } from "../data/folder-tree.js";
import { attachContextMenu } from "./context-menu.js";

const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

/**
 * Дерево папок слева в списке улик, библиотеке ГМ и деле: «Все», «Без папки», папки с подпапками.
 * Окно готовит контекст через prepareFolderTree, вставляет partial dsr-folder-tree и вызывает attachFolderTree.
 */

export const FOLDER_DRAG_TYPE = "application/x-detective-story-folder";
export const ALL_FOLDERS = "__all";
export const NO_FOLDER = "__none";
/** Верхняя часть строки папки при перетаскивании папки — «поставить перед», остальное — «вложить». */
const BEFORE_ZONE_RATIO = 0.3;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const FOLDER_ICONS = [
  "folder", "folder-open", "box-archive", "magnifying-glass", "fingerprint", "shoe-prints", "droplet", "skull",
  "gun", "key", "lock", "file-lines", "envelope", "camera", "film", "music", "phone", "user-secret", "user", "users",
  "house", "building", "city", "map-location-dot", "car", "clock", "coins", "flask", "pills", "scale-balanced",
  "gavel", "eye", "star", "flag", "bookmark", "triangle-exclamation"
].map((iconName) => `fa-solid fa-${iconName}`);

/** «Все» и «Без папки» — не папки: новая папка из них создаётся в корне, улика кладётся в корень. */
export function toRealFolderId(folderId) {
  if (!folderId || folderId === ALL_FOLDERS || folderId === NO_FOLDER) return null;
  return folderId;
}

/**
 * Показывать ли улику при выбранной папке. Улики подпапок видны в своих подпапках, «Все» показывает всё.
 * @param {object} folders
 * @param {string|null} itemFolderId
 * @param {string} selectedFolderId
 */
export function matchesSelectedFolder(folders, itemFolderId, selectedFolderId) {
  if (selectedFolderId === ALL_FOLDERS) return true;
  const resolvedId = resolveFolderId(folders, itemFolderId);
  if (selectedFolderId === NO_FOLDER) return resolvedId === null;
  return resolvedId === selectedFolderId;
}

/** Выбранная папка исчезла (удалили в другом окне) — показываются все улики. */
export function validateSelectedFolder(folders, selectedFolderId) {
  if (selectedFolderId === ALL_FOLDERS || selectedFolderId === NO_FOLDER || folders[selectedFolderId]) return selectedFolderId;
  return ALL_FOLDERS;
}

/**
 * Контекст partial dsr-folder-tree.
 * @param {object} scope - область папок (getFolderScope)
 * @param {object} options
 * @param {string} options.selectedFolderId
 * @param {Record<string, string|null>} [options.itemFolders] - только видимые пользователю улики
 * @param {boolean} [options.hideEmpty] - скрыть папки без видимых улик (игрок в деле, п. 24)
 * @param {boolean} [options.canTransfer] - кнопка «Передать папку» (свой список игрока)
 */
export function prepareFolderTree(scope, { selectedFolderId, itemFolders = scope.readItemFolders(), hideEmpty = false, canTransfer = false }) {
  const folders = scope.readFolders();
  const canEdit = scope.canEdit();
  const collapsedIds = new Set(getCollapsedFolderIds(scope.key));
  let isVisible;
  if (hideEmpty) isVisible = (folder, itemCount) => itemCount > 0;
  const decorate = (node) => {
    // Папки игрока читаются из его флагов: цвет проверяется, прежде чем попасть в style.
    let color = DEFAULT_FOLDER_COLOR;
    if (COLOR_PATTERN.test(String(node.color ?? ""))) color = node.color;
    let icon = String(node.icon ?? "");
    if (!icon) icon = DEFAULT_FOLDER_ICON;
    return {
      ...node,
      color,
      icon,
      iconIsImage: isImageIcon(icon),
      selected: node.id === selectedFolderId,
      collapsed: collapsedIds.has(node.id),
      canEdit,
      canAddChild: canEdit && node.depth < MAX_FOLDER_DEPTH,
      canTransfer: canTransfer && node.itemCount > 0,
      children: node.children.map(decorate)
    };
  };
  const nodes = buildFolderNodes(folders, itemFolders, isVisible).map(decorate);
  const folderIds = Object.values(itemFolders);
  return {
    scopeType: scope.type,
    scopeOwner: scope.ownerId,
    layout: getTreeLayout(scope.type),
    canEdit,
    nodes,
    allCount: folderIds.length,
    noneCount: folderIds.filter((folderId) => resolveFolderId(folders, folderId) === null).length,
    selectedAll: selectedFolderId === ALL_FOLDERS,
    selectedNone: selectedFolderId === NO_FOLDER
  };
}

/** @param {DragEvent} event */
export function isFolderDrag(event) {
  return Boolean(event.dataTransfer?.types?.includes(FOLDER_DRAG_TYPE));
}

/** @param {DragEvent} event @returns {{scopeType: string, scopeOwner: string, folderId: string}|null} */
export function readFolderDrag(event) {
  const rawData = event.dataTransfer?.getData(FOLDER_DRAG_TYPE);
  if (!rawData) return null;
  try {
    const dragData = JSON.parse(rawData);
    if (typeof dragData?.folderId === "string") return dragData;
  } catch {
    return null;
  }
  return null;
}

function clearDropMarks(container) {
  for (const markedElement of container.querySelectorAll(".dsr-folder-tree .drag-over, .dsr-folder-tree .drop-before")) {
    markedElement.classList.remove("drag-over", "drop-before");
  }
}

/** @param {DragEvent} event @param {HTMLElement} nodeElement */
function isBeforeZone(event, nodeElement) {
  if (!isFolderDrag(event) || nodeElement.classList.contains("virtual")) return false;
  const bounds = nodeElement.getBoundingClientRect();
  return event.clientY - bounds.top < bounds.height * BEFORE_ZONE_RATIO;
}

/**
 * Обработчики дерева. Слушатели вешаются делегированием на контейнер, поэтому замена самого дерева
 * (обновление счётчиков) не требует навешивать их заново.
 * @param {HTMLElement} container
 * @param {object} handlers
 * @param {() => object} handlers.getScope
 * @param {(folderId: string) => void} handlers.onSelect
 * @param {(event: DragEvent, folderId: string|null) => any} [handlers.onDrop] - бросили не папку этого же дерева
 * @param {(folderId: string) => any} [handlers.onTransfer]
 */
export function attachFolderTree(container, { getScope, onSelect, onDrop, onTransfer }) {
  if (!container || container.dataset.folderTreeAttached) return;
  container.dataset.folderTreeAttached = "true";

  container.addEventListener("click", async (event) => {
    const actionElement = event.target.closest("[data-folder-action]");
    if (!actionElement?.closest(".dsr-folder-tree")) return;
    event.preventDefault();
    const folderId = actionElement.closest("[data-folder-id]")?.dataset.folderId ?? null;
    const scope = getScope();
    if (!scope) return;
    if (actionElement.dataset.folderAction === "select") {
      onSelect(folderId);
      return;
    }
    if (actionElement.dataset.folderAction === "collapseTree") {
      const treeElement = actionElement.closest(".dsr-folder-tree");
      const hidden = !treeElement.classList.contains("collapsed");
      treeElement.classList.toggle("collapsed", hidden);
      const iconElement = actionElement.querySelector("i");
      iconElement?.classList.toggle("fa-angles-right", hidden);
      iconElement?.classList.toggle("fa-angles-left", !hidden);
      await setTreeLayout(scope.type, { hidden });
      return;
    }
    if (actionElement.dataset.folderAction === "toggle") {
      const childList = actionElement.closest(".folder-branch")?.querySelector(":scope > .folder-children");
      if (!childList) return;
      childList.hidden = !childList.hidden;
      actionElement.querySelector("i")?.classList.toggle("fa-caret-right", childList.hidden);
      actionElement.querySelector("i")?.classList.toggle("fa-caret-down", !childList.hidden);
      await setFolderCollapsed(scope.key, folderId, childList.hidden);
      return;
    }
    await runFolderAction(scope, actionElement.dataset.folderAction, folderId, onTransfer);
  });

  // Действия с папкой — по правому клику (п. Б6): подпапка, правка, передача, удаление.
  attachContextMenu(container, ".dsr-folder-tree .folder-node[data-can-edit], .dsr-folder-tree .folder-node[data-can-transfer]", (nodeElement) => {
    const scope = getScope();
    const folderId = nodeElement.dataset.folderId;
    if (!scope) return [];
    const run = (action) => () => runFolderAction(scope, action, folderId, onTransfer);
    const menuItems = [];
    if ("canAdd" in nodeElement.dataset) menuItems.push({ icon: "fa-solid fa-folder-plus", label: localize("ClueFolders.NewSubfolder"), callback: run("create") });
    if ("canEdit" in nodeElement.dataset) menuItems.push({ icon: "fa-solid fa-pen", label: localize("Common.Edit"), callback: run("edit") });
    if ("canTransfer" in nodeElement.dataset) menuItems.push({ icon: "fa-solid fa-share", label: localize("ClueFolders.Transfer"), callback: run("transfer") });
    if ("canEdit" in nodeElement.dataset) {
      menuItems.push({ separator: true });
      menuItems.push({ icon: "fa-solid fa-trash", label: localize("Common.Delete"), callback: run("delete"), danger: true });
    }
    return menuItems;
  });

  // Ширина дерева меняется перетаскиванием края (CSS resize) и запоминается.
  const treeElement = container.querySelector(".dsr-folder-tree");
  if (treeElement && "ResizeObserver" in window) {
    const saveWidth = foundry.utils.debounce((width) => {
      const scope = getScope();
      if (scope && width > 60) setTreeLayout(scope.type, { width: Math.round(width) });
    }, 400);
    let firstObservation = true;
    new ResizeObserver((entries) => {
      if (firstObservation) {
        firstObservation = false;
        return;
      }
      // Ширина с отступами и рамкой (как у inline-стиля при box-sizing: border-box), иначе панель при каждой загрузке сужалась.
      if (!entries[0].target.classList.contains("collapsed")) saveWidth(entries[0].borderBoxSize?.[0]?.inlineSize ?? entries[0].target.offsetWidth);
    }).observe(treeElement);
  }

  container.addEventListener("dragstart", (event) => {
    const nodeElement = event.target.closest?.(".dsr-folder-tree .folder-node[draggable='true']");
    if (!nodeElement) return;
    const treeElement = nodeElement.closest(".dsr-folder-tree");
    event.stopPropagation();
    event.dataTransfer.setData(FOLDER_DRAG_TYPE, JSON.stringify({
      scopeType: treeElement.dataset.scopeType,
      scopeOwner: treeElement.dataset.scopeOwner,
      folderId: nodeElement.dataset.folderId
    }));
    event.dataTransfer.effectAllowed = "copyMove";
  });

  container.addEventListener("dragover", (event) => {
    const nodeElement = event.target.closest?.(".dsr-folder-tree .folder-node");
    if (!nodeElement) return;
    event.preventDefault();
    event.stopPropagation();
    clearDropMarks(container);
    if (isBeforeZone(event, nodeElement)) {
      nodeElement.classList.add("drop-before");
    } else {
      nodeElement.classList.add("drag-over");
    }
  });

  container.addEventListener("dragleave", (event) => {
    const nodeElement = event.target.closest?.(".dsr-folder-tree .folder-node");
    if (nodeElement && !nodeElement.contains(event.relatedTarget)) nodeElement.classList.remove("drag-over", "drop-before");
  });

  container.addEventListener("drop", async (event) => {
    const nodeElement = event.target.closest?.(".dsr-folder-tree .folder-node");
    if (!nodeElement) return;
    event.preventDefault();
    event.stopPropagation();
    const beforeZone = isBeforeZone(event, nodeElement);
    clearDropMarks(container);
    const scope = getScope();
    if (!scope) return;
    const targetId = toRealFolderId(nodeElement.dataset.folderId);
    const folderDrag = readFolderDrag(event);
    if (folderDrag && folderDrag.scopeType === scope.type && folderDrag.scopeOwner === scope.ownerId) {
      if (folderDrag.folderId === targetId) return;
      if (beforeZone) {
        await moveFolder(scope, folderDrag.folderId, scope.readFolders()[targetId]?.parentId ?? null, targetId);
      } else {
        await moveFolder(scope, folderDrag.folderId, targetId);
      }
      return;
    }
    await onDrop?.(event, targetId);
  });
}

/** Действие с папкой из кнопки или меню по правому клику. */
async function runFolderAction(scope, action, folderId, onTransfer) {
  if (action === "create") {
    const input = await editFolderDialog(null);
    if (input) await createFolder(scope, toRealFolderId(folderId), input);
  } else if (action === "edit") {
    const folder = scope.readFolders()[folderId];
    if (!folder) return;
    const input = await editFolderDialog(folder);
    if (input) await updateFolder(scope, folderId, input);
  } else if (action === "delete") {
    await confirmAndDeleteFolder(scope, folderId);
  } else if (action === "transfer") {
    await onTransfer?.(folderId);
  }
}

/**
 * Название, цвет и иконка (Font Awesome или картинка).
 * @param {object|null} folder
 * @returns {Promise<{name: string, color: string, icon: string}|null>}
 */
export async function editFolderDialog(folder) {
  const currentIcon = folder?.icon || DEFAULT_FOLDER_ICON;
  let iconImage = "";
  if (isImageIcon(currentIcon)) iconImage = currentIcon;
  let selectedIcon = currentIcon;
  if (iconImage || !FOLDER_ICONS.includes(currentIcon)) selectedIcon = DEFAULT_FOLDER_ICON;
  const content = await renderTemplate(`${TEMPLATE_PATH}/apps/folder-config.hbs`, {
    folder: { name: folder?.name ?? "", color: folder?.color || DEFAULT_FOLDER_COLOR },
    icons: FOLDER_ICONS.map((icon) => ({ icon, selected: icon === selectedIcon })),
    iconImage
  });
  let title = localize("ClueFolders.NewTitle");
  if (folder) title = localize("ClueFolders.EditTitle");
  const formValues = await DialogV2.input({
    window: { title, icon: "fa-solid fa-folder" },
    classes: ["detective-story", "folder-config"],
    content,
    ok: { label: localize("Common.Save"), icon: "fa-solid fa-floppy-disk" },
    rejectClose: false
  });
  if (!formValues) return null;
  let icon = String(formValues.iconImage ?? "").trim();
  if (!icon) icon = String(formValues.faIcon ?? DEFAULT_FOLDER_ICON);
  return { name: String(formValues.name ?? ""), color: String(formValues.color ?? ""), icon };
}

/**
 * Предупреждение о содержимом и выбор: удалить только папку (улики поднимаются выше) или папку с уликами (п. 14).
 * Игроку второй вариант не предлагается (п. 34).
 */
async function confirmAndDeleteFolder(scope, folderId) {
  const folder = scope.readFolders()[folderId];
  if (!folder) return;
  const contents = describeFolderContents(scope, folderId);
  const folderName = foundry.utils.escapeHTML(folder.name);
  if (!contents.itemCount && !contents.subfolderCount) {
    const confirmed = await DialogV2.confirm({
      window: { title: localize("ClueFolders.DeleteTitle") },
      content: `<p>${format("ClueFolders.DeleteEmpty", { name: folderName })}</p>`,
      rejectClose: false
    });
    if (confirmed) await deleteFolder(scope, folderId, false);
    return;
  }
  const paragraphs = [format("ClueFolders.DeleteContents", { name: folderName, clues: contents.itemCount, folders: contents.subfolderCount })];
  if (contents.zoneCount) paragraphs.push(format("ClueFolders.DeleteZonesWarning", { count: contents.zoneCount }));
  const buttons = [{ action: "folderOnly", label: localize("ClueFolders.DeleteFolderOnly"), icon: "fa-solid fa-folder-minus", default: true }];
  if (scope.canRemoveItems() && contents.itemCount) {
    let removeLabel = localize("ClueFolders.DeleteWithClues");
    if (scope.type === FOLDER_SCOPES.case) removeLabel = localize("ClueFolders.DeleteWithUnpin");
    if (scope.type === FOLDER_SCOPES.library) removeLabel = localize("ClueFolders.DeleteWithTemplates");
    buttons.push({ action: "withItems", label: removeLabel, icon: "fa-solid fa-trash" });
  }
  buttons.push({ action: "cancel", label: localize("Common.Cancel"), icon: "fa-solid fa-xmark" });
  const choice = await DialogV2.wait({
    window: { title: localize("ClueFolders.DeleteTitle"), icon: "fa-solid fa-triangle-exclamation" },
    classes: ["detective-story"],
    content: paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join(""),
    buttons,
    rejectClose: false
  });
  if (choice === "folderOnly") await deleteFolder(scope, folderId, false);
  if (choice === "withItems") await deleteFolder(scope, folderId, true);
}

/**
 * «Переместить в…»: выбор папки из списка с отступами.
 * @param {object} scope
 * @returns {Promise<string|null|undefined>} id папки, null — «Без папки», undefined — отмена
 */
export async function pickFolderDialog(scope) {
  const folders = scope.readFolders();
  const options = [`<option value="${NO_FOLDER}">${foundry.utils.escapeHTML(localize("ClueFolders.None"))}</option>`];
  for (const node of flattenFolderNodes(buildFolderNodes(folders, {}))) {
    const indent = "  ".repeat(node.depth - 1);
    // Папки игрока читаются из его флагов: id и название экранируются.
    options.push(`<option value="${foundry.utils.escapeHTML(node.id)}">${indent}${foundry.utils.escapeHTML(node.name)}</option>`);
  }
  const formValues = await DialogV2.input({
    window: { title: localize("ClueFolders.MoveTitle"), icon: "fa-solid fa-folder-tree" },
    classes: ["detective-story"],
    content: `<div class="form-group"><label>${localize("ClueFolders.MoveTo")}</label><div class="form-fields"><select name="folderId">${options.join("")}</select></div></div>`,
    ok: { label: localize("ClueFolders.Move"), icon: "fa-solid fa-check" },
    rejectClose: false
  });
  if (!formValues) return undefined;
  return toRealFolderId(formValues.folderId);
}
