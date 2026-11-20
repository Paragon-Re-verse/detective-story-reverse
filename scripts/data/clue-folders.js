import { MODULE_ID } from "../constants.js";
import { localize, format } from "../i18n.js";
import { getSetting, setSetting, SETTING_KEYS } from "../settings.js";
import { canPinAnyClue } from "../permissions.js";
import { readUserSection } from "./user-flags.js";
import { getPlayerClues, buildPlayerClue, addCluesToUser, CLUE_SOURCES } from "./player-clues.js";
import { getClueTemplate, buildPlayerContent, listClueTemplates } from "./clue-templates.js";
import { getCase, canManageCase, updateOpenCaseFlag, buildPinnedClue, describeCase, isClueLockedByClosedCase, CASE_STATUS } from "./cases.js";
import { listAllZones } from "./zones.js";
import { logEvent, LOG_EVENTS } from "./event-log.js";
import {
  MAX_FOLDER_DEPTH,
  resolveFolderId,
  getFolderDepth,
  getSubtreeHeight,
  checkFolderMove,
  listChildFolders,
  listSubtreeIds,
  nextFolderSort,
  copyFolderTree,
  planFolderRemoval,
  listItemsInSubtree
} from "./folder-tree.js";

/**
 * Папки улик в трёх местах, с одной логикой дерева (folder-tree.js):
 *  - список игрока: флаг folders на User, папка улики — поле folderId её записи в clues;
 *  - библиотека ГМ: настройка мира libraryFolders, папка шаблона — поле folderId во флаге template;
 *  - дело: поле folders во флаге case, папка улики — поле folderId записи в pinned.
 * Каждое место описывается «областью» (scope): чтение папок, чтение «улика → папка», права и одна запись изменений.
 */

export const FOLDER_SCOPES = { user: "user", library: "library", case: "case" };
/** Отметка в изменениях улик: удалить улику (у игрока), шаблон (в библиотеке) или открепить (в деле). */
export const REMOVE_ITEM = "-";

const USER_FOLDERS_SECTION = "folders";
export const DEFAULT_FOLDER_COLOR = "#8b6b3d";
export const DEFAULT_FOLDER_ICON = "fa-solid fa-folder";

/** Иконка — класс Font Awesome или путь к картинке. */
export function isImageIcon(icon) {
  return Boolean(icon) && !String(icon).startsWith("fa-");
}

/** Название, цвет и иконка из формы в нормальном виде. */
export function normalizeFolderInput(input = {}) {
  let color = DEFAULT_FOLDER_COLOR;
  if (/^#[0-9a-f]{6}$/i.test(String(input.color ?? ""))) color = String(input.color);
  let icon = String(input.icon ?? "").trim();
  if (!icon) icon = DEFAULT_FOLDER_ICON;
  return {
    name: String(input.name ?? "").trim().slice(0, 100) || localize("ClueFolders.Unnamed"),
    color,
    icon
  };
}

/** @param {User} user */
function createUserScope(user) {
  return {
    type: FOLDER_SCOPES.user,
    ownerId: user.id,
    key: `user.${user.id}`,
    readFolders: () => readUserSection(user, USER_FOLDERS_SECTION),
    readItemFolders: () => {
      const itemFolders = {};
      for (const [originId, playerClue] of Object.entries(getPlayerClues(user))) itemFolders[originId] = playerClue.folderId ?? null;
      return itemFolders;
    },
    // Игрок раскладывает только свой список, ГМ — любой (и у игрока не в сети).
    canEdit: () => game.user.isGM || user.id === game.user.id,
    // Удалять улики игрока может только ГМ (п. 34).
    canRemoveItems: () => game.user.isGM,
    isItemLocked: (originId) => isClueLockedByClosedCase(originId),
    apply: async ({ folders = {}, items = {} }) => {
      const update = {};
      for (const [folderId, folder] of Object.entries(folders)) {
        if (folder === null) {
          update[`flags.${MODULE_ID}.${USER_FOLDERS_SECTION}.-=${folderId}`] = null;
        } else {
          update[`flags.${MODULE_ID}.${USER_FOLDERS_SECTION}.${folderId}`] = folder;
        }
      }
      // Запись только для улик, которые есть: иначе путь clues.<id>.folderId создал бы обрывок записи.
      const playerClues = getPlayerClues(user);
      for (const [originId, folderId] of Object.entries(items)) {
        if (!playerClues[originId]) continue;
        if (folderId === REMOVE_ITEM) {
          update[`flags.${MODULE_ID}.clues.-=${originId}`] = null;
        } else {
          update[`flags.${MODULE_ID}.clues.${originId}.folderId`] = folderId;
        }
      }
      if (!foundry.utils.isEmpty(update)) await user.update(update);
      return true;
    }
  };
}

function createLibraryScope() {
  return {
    type: FOLDER_SCOPES.library,
    ownerId: "",
    key: "library",
    readFolders: () => getSetting(SETTING_KEYS.libraryFolders) ?? {},
    readItemFolders: () => {
      const itemFolders = {};
      for (const template of listClueTemplates()) itemFolders[template.id] = template.folderId;
      return itemFolders;
    },
    canEdit: () => game.user.isGM,
    canRemoveItems: () => game.user.isGM,
    isItemLocked: () => false,
    apply: async ({ folders = {}, items = {} }) => {
      if (!game.user.isGM) return false;
      if (!foundry.utils.isEmpty(folders)) {
        const nextFolders = foundry.utils.deepClone(getSetting(SETTING_KEYS.libraryFolders) ?? {});
        for (const [folderId, folder] of Object.entries(folders)) {
          if (folder === null) {
            delete nextFolders[folderId];
          } else {
            nextFolders[folderId] = folder;
          }
        }
        await setSetting(SETTING_KEYS.libraryFolders, nextFolders);
      }
      const templateUpdates = [];
      const deletedTemplateIds = [];
      for (const [templateId, folderId] of Object.entries(items)) {
        if (!getClueTemplate(templateId)) continue;
        if (folderId === REMOVE_ITEM) {
          deletedTemplateIds.push(templateId);
        } else {
          templateUpdates.push({ _id: templateId, [`flags.${MODULE_ID}.template.folderId`]: folderId });
        }
      }
      if (templateUpdates.length) await JournalEntry.updateDocuments(templateUpdates);
      if (deletedTemplateIds.length) await JournalEntry.deleteDocuments(deletedTemplateIds);
      return true;
    }
  };
}

/** @param {string} caseId */
function createCaseScope(caseId) {
  const readPinned = () => getCase(caseId)?.pinned ?? {};
  return {
    type: FOLDER_SCOPES.case,
    ownerId: caseId,
    key: `case.${caseId}`,
    readFolders: () => getCase(caseId)?.folders ?? {},
    readItemFolders: () => {
      const itemFolders = {};
      for (const [originId, pinnedClue] of Object.entries(readPinned())) itemFolders[originId] = pinnedClue.folderId ?? null;
      return itemFolders;
    },
    // Закрытое дело не меняется (п. 27); править дела могут ГМ и профайлер.
    canEdit: () => canManageCase(getCase(caseId)) && getCase(caseId)?.status === CASE_STATUS.open && Boolean(game.journal.get(caseId)?.isOwner),
    canRemoveItems: () => canManageCase(getCase(caseId)),
    isItemLocked: () => false,
    apply: async ({ folders = {}, items = {}, pins = {} }) => {
      const changes = {};
      for (const [folderId, folder] of Object.entries(folders)) {
        if (folder === null) {
          changes[`folders.-=${folderId}`] = null;
        } else {
          changes[`folders.${folderId}`] = folder;
        }
      }
      const pinned = readPinned();
      for (const [originId, folderId] of Object.entries(items)) {
        if (!pinned[originId]) continue;
        if (folderId === REMOVE_ITEM) {
          changes[`pinned.-=${originId}`] = null;
        } else {
          changes[`pinned.${originId}.folderId`] = folderId;
        }
      }
      for (const [originId, pinnedRecord] of Object.entries(pins)) changes[`pinned.${originId}`] = pinnedRecord;
      if (foundry.utils.isEmpty(changes)) return true;
      return updateOpenCaseFlag(caseId, changes);
    }
  };
}

/**
 * Область папок по типу и владельцу.
 * @param {string} type - user, library, case
 * @param {string} [ownerId] - id пользователя или дела
 */
export function getFolderScope(type, ownerId) {
  if (type === FOLDER_SCOPES.user) {
    const user = game.users.get(ownerId);
    if (user) return createUserScope(user);
  } else if (type === FOLDER_SCOPES.library) {
    return createLibraryScope();
  } else if (type === FOLDER_SCOPES.case) {
    if (getCase(ownerId)) return createCaseScope(ownerId);
  }
  return null;
}

/** @param {object} scope */
function warnIfReadOnly(scope) {
  if (scope.canEdit()) return false;
  if (scope.type === FOLDER_SCOPES.case && getCase(scope.ownerId)?.status === CASE_STATUS.closed) {
    ui.notifications.warn(localize("Case.ClosedReadOnly"));
  } else {
    ui.notifications.warn(localize("ClueFolders.NoPermission"));
  }
  return true;
}

/**
 * Новая папка в конце уровня.
 * @param {object} scope
 * @param {string|null} parentId
 * @param {{name: string, color: string, icon: string}} input
 * @returns {Promise<string|null>} id папки
 */
export async function createFolder(scope, parentId, input) {
  if (warnIfReadOnly(scope)) return null;
  const folders = scope.readFolders();
  const normalizedParentId = resolveFolderId(folders, parentId);
  if (getFolderDepth(folders, normalizedParentId) >= MAX_FOLDER_DEPTH) {
    ui.notifications.warn(format("ClueFolders.TooDeep", { depth: MAX_FOLDER_DEPTH }));
    return null;
  }
  const folderId = foundry.utils.randomID();
  const folder = {
    id: folderId,
    ...normalizeFolderInput(input),
    parentId: normalizedParentId,
    sort: nextFolderSort(folders, normalizedParentId)
  };
  await scope.apply({ folders: { [folderId]: folder } });
  return folderId;
}

/** Изменить название, цвет и иконку. */
export async function updateFolder(scope, folderId, input) {
  if (warnIfReadOnly(scope)) return;
  const folder = scope.readFolders()[folderId];
  if (!folder) return;
  await scope.apply({ folders: { [folderId]: { ...folder, ...normalizeFolderInput(input) } } });
}

/**
 * Перенести папку в другую (null — в корень). С beforeFolderId — поставить перед этой папкой на её уровне.
 * @returns {Promise<boolean>}
 */
export async function moveFolder(scope, folderId, newParentId, beforeFolderId = null) {
  if (warnIfReadOnly(scope)) return false;
  const folders = scope.readFolders();
  if (!folders[folderId] || folderId === beforeFolderId) return false;
  const parentId = resolveFolderId(folders, newParentId);
  const denialReason = checkFolderMove(folders, folderId, parentId);
  if (denialReason) {
    ui.notifications.warn(format(`ClueFolders.MoveDenied.${denialReason}`, { depth: MAX_FOLDER_DEPTH }));
    return false;
  }
  // Ручной порядок: уровень нумеруется заново, переписываются только папки с изменившимся номером.
  const siblings = listChildFolders(folders, parentId).filter((folder) => folder.id !== folderId);
  let insertIndex = siblings.findIndex((folder) => folder.id === beforeFolderId);
  if (insertIndex < 0) insertIndex = siblings.length;
  siblings.splice(insertIndex, 0, { ...folders[folderId], parentId });
  const folderChanges = {};
  siblings.forEach((folder, index) => {
    const sort = index + 1;
    if (folder.id === folderId || folder.sort !== sort) folderChanges[folder.id] = { ...folder, sort };
  });
  await scope.apply({ folders: folderChanges });
  return true;
}

/** Переложить улики в папку (null — «Без папки»). */
export async function moveItemsToFolder(scope, itemIds, folderId) {
  if (warnIfReadOnly(scope)) return;
  const normalizedFolderId = resolveFolderId(scope.readFolders(), folderId);
  const items = {};
  for (const itemId of itemIds) items[itemId] = normalizedFolderId;
  await scope.apply({ items });
}

/** Что лежит в папке — для окна удаления. */
export function describeFolderContents(scope, folderId) {
  const folders = scope.readFolders();
  const itemIds = listItemsInSubtree(folders, folderId, scope.readItemFolders());
  let zoneCount = 0;
  if (scope.type === FOLDER_SCOPES.library && itemIds.length) {
    const templateIds = new Set(itemIds);
    zoneCount = listAllZones().filter(({ zone }) => templateIds.has(zone.templateId)).length;
  }
  return {
    itemCount: itemIds.length,
    subfolderCount: listSubtreeIds(folders, folderId).length - 1,
    zoneCount
  };
}

/**
 * Удалить папку.
 *  - withItems = false: подпапки и улики поднимаются на уровень выше;
 *  - withItems = true: удаляются папка, подпапки и улики (в деле улики открепляются). Улики закрытого дела не удаляются,
 *    а поднимаются выше (п. 35).
 * @returns {Promise<{lockedCount: number}>}
 */
export async function deleteFolder(scope, folderId, withItems) {
  if (warnIfReadOnly(scope)) return { lockedCount: 0 };
  const folders = scope.readFolders();
  if (!folders[folderId]) return { lockedCount: 0 };
  const itemFolders = scope.readItemFolders();
  if (!withItems || !scope.canRemoveItems()) {
    await scope.apply(planFolderRemoval(folders, folderId, itemFolders));
    return { lockedCount: 0 };
  }
  const parentId = resolveFolderId(folders, folders[folderId].parentId);
  const folderChanges = {};
  for (const subtreeId of listSubtreeIds(folders, folderId)) folderChanges[subtreeId] = null;
  const itemChanges = {};
  let lockedCount = 0;
  for (const itemId of listItemsInSubtree(folders, folderId, itemFolders)) {
    if (scope.isItemLocked(itemId)) {
      itemChanges[itemId] = parentId;
      lockedCount += 1;
    } else {
      itemChanges[itemId] = REMOVE_ITEM;
    }
  }
  await scope.apply({ folders: folderChanges, items: itemChanges });
  if (lockedCount) ui.notifications.warn(format("ClueFolders.LockedKept", { count: lockedCount }));
  return { lockedCount };
}

/**
 * Папка (с подпапками) и раскладка её улик — для передачи другому игроку.
 * @param {User} user
 * @param {string} folderId
 * @returns {{rootId: string, folders: object, itemFolders: Record<string, string>}|null}
 */
export function buildFolderPayload(user, folderId) {
  const scope = createUserScope(user);
  const folders = scope.readFolders();
  if (!folders[folderId]) return null;
  const subtreeIds = listSubtreeIds(folders, folderId);
  const payloadFolders = {};
  for (const subtreeId of subtreeIds) payloadFolders[subtreeId] = folders[subtreeId];
  const itemFolders = {};
  const allItemFolders = scope.readItemFolders();
  for (const originId of listItemsInSubtree(folders, folderId, allItemFolders)) itemFolders[originId] = allItemFolders[originId];
  return { rootId: folderId, folders: payloadFolders, itemFolders };
}

/**
 * Положить копию папки в корень списка игрока и разложить в неё новые улики. Улики, которые у игрока уже есть,
 * остаются на своих местах, дубликаты не создаются (п. 28). Совпадает название — «Название (2)» (п. 31).
 * @param {User} targetUser
 * @param {{rootId: string, folders: object, itemFolders: Record<string, string>}} payload
 * @param {PlayerClue[]} clueRecords - записи новых улик
 * @returns {Promise<string[]>} originId добавленных улик
 */
export async function addFolderWithClues(targetUser, payload, clueRecords) {
  const targetScope = createUserScope(targetUser);
  const copy = copyFolderTree(payload.folders, payload.rootId, targetScope.readFolders(), null, () => foundry.utils.randomID());
  await targetScope.apply({ folders: copy.folders });
  for (const clueRecord of clueRecords) clueRecord.folderId = copy.idMap[payload.itemFolders[clueRecord.originId]] ?? copy.idMap[payload.rootId];
  return addCluesToUser(targetUser, clueRecords);
}

/**
 * ГМ перетащил папку библиотеки или папку игрока на игрока: у него появляется такая же папка с уликами.
 * @param {object} sourceScope - библиотека или список другого игрока
 * @param {string} folderId
 * @param {User} targetUser
 */
export async function copyFolderToUser(sourceScope, folderId, targetUser) {
  if (!game.user.isGM || !targetUser || targetUser.isGM) return;
  if (sourceScope.type === FOLDER_SCOPES.user && sourceScope.ownerId === targetUser.id) return;
  const folders = sourceScope.readFolders();
  const folder = folders[folderId];
  if (!folder) return;
  const allItemFolders = sourceScope.readItemFolders();
  const subtreeIds = listSubtreeIds(folders, folderId);
  const payloadFolders = {};
  for (const subtreeId of subtreeIds) payloadFolders[subtreeId] = folders[subtreeId];
  const itemFolders = {};
  const clueRecords = [];
  let sourceClues = null;
  if (sourceScope.type === FOLDER_SCOPES.user) sourceClues = getPlayerClues(game.users.get(sourceScope.ownerId));
  for (const itemId of listItemsInSubtree(folders, folderId, allItemFolders)) {
    itemFolders[itemId] = allItemFolders[itemId];
    let content = null;
    if (sourceClues) {
      content = sourceClues[itemId];
    } else {
      const template = getClueTemplate(itemId);
      if (template) content = buildPlayerContent(template);
    }
    if (content) clueRecords.push(buildPlayerClue(itemId, content, { source: CLUE_SOURCES.gameMaster }));
  }
  const addedIds = await addFolderWithClues(targetUser, { rootId: folderId, folders: payloadFolders, itemFolders }, clueRecords);
  if (addedIds.length) {
    const addedNames = clueRecords.filter((clueRecord) => addedIds.includes(clueRecord.originId)).map((clueRecord) => clueRecord.name);
    await logEvent(LOG_EVENTS.granted, { recipient: targetUser.name, clues: addedNames });
  }
  ui.notifications.info(format("ClueFolders.CopiedTo", { folder: folder.name, name: targetUser.name, count: addedIds.length }));
}

/**
 * Профайлер или ГМ перетащил папку своего списка в дело: в деле появляется такая же папка, улики прикрепляются к ней.
 * Улика, уже прикреплённая к делу в другом месте, переезжает в новую папку (п. 25). Личная папка остаётся.
 * @param {string} caseId
 * @param {User} sourceUser - чей список улик
 * @param {string} folderId
 * @param {string|null} targetParentId - папка дела, куда положить (null — корень)
 */
export async function pinFolderToCase(caseId, sourceUser, folderId, targetParentId) {
  const caseScope = getFolderScope(FOLDER_SCOPES.case, caseId);
  if (!caseScope || warnIfReadOnly(caseScope)) return false;
  if (sourceUser?.id !== game.user.id && !canPinAnyClue()) {
    ui.notifications.warn(localize("Case.PinOnlyOwn"));
    return false;
  }
  const sourceScope = createUserScope(sourceUser);
  const sourceFolders = sourceScope.readFolders();
  if (!sourceFolders[folderId]) return false;
  const caseFolders = caseScope.readFolders();
  const parentId = resolveFolderId(caseFolders, targetParentId);
  if (getFolderDepth(caseFolders, parentId) + getSubtreeHeight(sourceFolders, folderId) > MAX_FOLDER_DEPTH) {
    ui.notifications.warn(format("ClueFolders.MoveDenied.depth", { depth: MAX_FOLDER_DEPTH }));
    return false;
  }
  const copy = copyFolderTree(sourceFolders, folderId, caseFolders, parentId, () => foundry.utils.randomID());
  const pinned = getCase(caseId).pinned;
  const sourceClues = getPlayerClues(sourceUser);
  const sourceItemFolders = sourceScope.readItemFolders();
  const items = {};
  const pins = {};
  const pinnedNames = [];
  for (const originId of listItemsInSubtree(sourceFolders, folderId, sourceItemFolders)) {
    const newFolderId = copy.idMap[sourceItemFolders[originId]];
    if (pinned[originId]) {
      items[originId] = newFolderId;
    } else {
      pins[originId] = { ...buildPinnedClue(originId, sourceClues[originId]), folderId: newFolderId };
      pinnedNames.push(sourceClues[originId].name);
    }
  }
  const saved = await caseScope.apply({ folders: copy.folders, items, pins });
  if (saved && pinnedNames.length) await logEvent(LOG_EVENTS.pinned, { clue: pinnedNames.join(", "), ...describeCase(getCase(caseId)) });
  return saved;
}

/** Ширина и скрытие панели дерева для вида окна (список игрока, библиотека, дело) на этом клиенте. */
export function getTreeLayout(scopeType) {
  return getSetting(SETTING_KEYS.folderTreeState)?.[`layout:${scopeType}`] ?? { hidden: false, width: 0 };
}

/** @param {string} scopeType @param {{hidden?: boolean, width?: number}} changes */
export async function setTreeLayout(scopeType, changes) {
  const treeState = foundry.utils.deepClone(getSetting(SETTING_KEYS.folderTreeState) ?? {});
  treeState[`layout:${scopeType}`] = { ...getTreeLayout(scopeType), ...changes };
  await setSetting(SETTING_KEYS.folderTreeState, treeState);
}

/** Свёрнутые папки дерева на этом клиенте. @param {string} scopeKey */
export function getCollapsedFolderIds(scopeKey) {
  return getSetting(SETTING_KEYS.folderTreeState)?.[scopeKey] ?? [];
}

/** @param {string} scopeKey @param {string} folderId @param {boolean} collapsed */
export async function setFolderCollapsed(scopeKey, folderId, collapsed) {
  const treeState = foundry.utils.deepClone(getSetting(SETTING_KEYS.folderTreeState) ?? {});
  const collapsedIds = new Set(treeState[scopeKey] ?? []);
  if (collapsed) {
    collapsedIds.add(folderId);
  } else {
    collapsedIds.delete(folderId);
  }
  treeState[scopeKey] = [...collapsedIds];
  await setSetting(SETTING_KEYS.folderTreeState, treeState);
}
