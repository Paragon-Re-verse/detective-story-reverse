/**
 * Дерево папок улик без зависимостей от Foundry: одинаково для списка игрока, библиотеки ГМ и дела.
 * Папки — объект «id → {id, name, color, icon, parentId, sort}», parentId === null — корень.
 * Проверяется в Node: tools/folder-tree.test.mjs.
 */

export const MAX_FOLDER_DEPTH = 4;

/** Папка существует? Ссылка на удалённую папку значит «Без папки» (S6). */
export function resolveFolderId(folders, folderId) {
  if (folderId && folders[folderId]) return folderId;
  return null;
}

/** Уровень папки: 1 — в корне. Битые ссылки на родителя считаются корнем. */
export function getFolderDepth(folders, folderId) {
  let depth = 0;
  let currentId = resolveFolderId(folders, folderId);
  const seenIds = new Set();
  while (currentId && !seenIds.has(currentId)) {
    seenIds.add(currentId);
    depth += 1;
    currentId = resolveFolderId(folders, folders[currentId].parentId);
  }
  return depth;
}

/** Дочерние папки по ручному порядку. */
export function listChildFolders(folders, parentId) {
  const normalizedParentId = resolveFolderId(folders, parentId);
  return Object.values(folders)
    .filter((folder) => resolveFolderId(folders, folder.parentId) === normalizedParentId && folder.id !== normalizedParentId)
    .sort((first, second) => (first.sort ?? 0) - (second.sort ?? 0));
}

/** Папка и все вложенные, сверху вниз. */
export function listSubtreeIds(folders, folderId) {
  const subtreeIds = [];
  const pendingIds = [folderId];
  while (pendingIds.length) {
    const currentId = pendingIds.shift();
    if (!folders[currentId] || subtreeIds.includes(currentId)) continue;
    subtreeIds.push(currentId);
    for (const childFolder of listChildFolders(folders, currentId)) pendingIds.push(childFolder.id);
  }
  return subtreeIds;
}

/** Сколько уровней занимает папка вместе с вложенными (1 — без подпапок). */
export function getSubtreeHeight(folders, folderId) {
  const childHeights = listChildFolders(folders, folderId).map((childFolder) => getSubtreeHeight(folders, childFolder.id));
  return 1 + Math.max(0, ...childHeights);
}

/**
 * Можно ли перенести папку в другую (null — в корень).
 * @returns {null|"cycle"|"depth"} причина запрета
 */
export function checkFolderMove(folders, folderId, newParentId) {
  const parentId = resolveFolderId(folders, newParentId);
  if (parentId && listSubtreeIds(folders, folderId).includes(parentId)) return "cycle";
  if (getFolderDepth(folders, parentId) + getSubtreeHeight(folders, folderId) > MAX_FOLDER_DEPTH) return "depth";
  return null;
}

/** Порядковый номер для новой папки в конце уровня. */
export function nextFolderSort(folders, parentId) {
  const siblingSorts = listChildFolders(folders, parentId).map((folder) => folder.sort ?? 0);
  return Math.max(0, ...siblingSorts) + 1;
}

/** «Название», а если на этом уровне такое уже есть — «Название (2)», «Название (3)»… */
export function makeUniqueFolderName(folders, parentId, name) {
  const siblingNames = new Set(listChildFolders(folders, parentId).map((folder) => folder.name));
  if (!siblingNames.has(name)) return name;
  let copyNumber = 2;
  while (siblingNames.has(`${name} (${copyNumber})`)) copyNumber += 1;
  return `${name} (${copyNumber})`;
}

/**
 * Скопировать папку с подпапками в другое дерево, под parentId (null — в корень). Новые id, уникальное имя корня.
 * @param {object} sourceFolders
 * @param {string} sourceRootId
 * @param {object} targetFolders
 * @param {string|null} targetParentId
 * @param {() => string} createId
 * @returns {{folders: object, idMap: Record<string, string>}} новые записи и соответствие старых id новым
 */
export function copyFolderTree(sourceFolders, sourceRootId, targetFolders, targetParentId, createId) {
  const copiedFolders = {};
  const idMap = {};
  for (const sourceId of listSubtreeIds(sourceFolders, sourceRootId)) idMap[sourceId] = createId();
  for (const sourceId of Object.keys(idMap)) {
    const sourceFolder = sourceFolders[sourceId];
    const isRoot = sourceId === sourceRootId;
    let parentId = idMap[sourceFolder.parentId];
    let name = sourceFolder.name;
    let sort = sourceFolder.sort ?? 0;
    if (isRoot) {
      parentId = resolveFolderId(targetFolders, targetParentId);
      name = makeUniqueFolderName(targetFolders, parentId, sourceFolder.name);
      sort = nextFolderSort(targetFolders, parentId);
    }
    copiedFolders[idMap[sourceId]] = {
      id: idMap[sourceId],
      name,
      color: sourceFolder.color ?? "",
      icon: sourceFolder.icon ?? "",
      parentId: parentId ?? null,
      sort
    };
  }
  return { folders: copiedFolders, idMap };
}

/**
 * Удаление папки «только папка»: подпапки и улики поднимаются к родителю.
 * @param {object} folders
 * @param {string} folderId
 * @param {Record<string, string|null>} itemFolders - «id улики → id папки»
 * @returns {{folders: Record<string, object|null>, items: Record<string, string|null>}} изменения (null — удалить папку)
 */
export function planFolderRemoval(folders, folderId, itemFolders) {
  const parentId = resolveFolderId(folders, folders[folderId]?.parentId);
  const folderChanges = { [folderId]: null };
  for (const childFolder of listChildFolders(folders, folderId)) folderChanges[childFolder.id] = { ...childFolder, parentId };
  const itemChanges = {};
  for (const [itemId, itemFolderId] of Object.entries(itemFolders)) {
    if (itemFolderId === folderId) itemChanges[itemId] = parentId;
  }
  return { folders: folderChanges, items: itemChanges };
}

/** Улики в папке и всех её подпапках. */
export function listItemsInSubtree(folders, folderId, itemFolders) {
  const subtreeIds = new Set(listSubtreeIds(folders, folderId));
  return Object.keys(itemFolders).filter((itemId) => subtreeIds.has(itemFolders[itemId]));
}

/**
 * Дерево для показа: узлы с детьми и числом улик (в папке и вложенных).
 * @param {object} folders
 * @param {Record<string, string|null>} itemFolders
 * @param {(folder: object, itemCount: number) => boolean} [isVisible] - скрыть узел (пустые для игрока папки дела)
 */
export function buildFolderNodes(folders, itemFolders, isVisible = () => true) {
  const directCounts = {};
  for (const itemFolderId of Object.values(itemFolders)) {
    const folderId = resolveFolderId(folders, itemFolderId);
    if (folderId) directCounts[folderId] = (directCounts[folderId] ?? 0) + 1;
  }
  const buildLevel = (parentId, depth) => {
    const nodes = [];
    for (const folder of listChildFolders(folders, parentId)) {
      const children = buildLevel(folder.id, depth + 1);
      const itemCount = (directCounts[folder.id] ?? 0) + children.reduce((total, child) => total + child.itemCount, 0);
      if (!isVisible(folder, itemCount)) continue;
      nodes.push({ ...folder, depth, children, itemCount });
    }
    return nodes;
  };
  return buildLevel(null, 1);
}

/** Плоский список «отступ + название» для выбора папки. */
export function flattenFolderNodes(nodes) {
  const flatList = [];
  const walk = (levelNodes) => {
    for (const node of levelNodes) {
      flatList.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return flatList;
}

/** Путь папки «Улики / Город / Склад». */
export function getFolderPath(folders, folderId) {
  const names = [];
  let currentId = resolveFolderId(folders, folderId);
  const seenIds = new Set();
  while (currentId && !seenIds.has(currentId)) {
    seenIds.add(currentId);
    names.unshift(folders[currentId].name);
    currentId = resolveFolderId(folders, folders[currentId].parentId);
  }
  return names.join(" / ");
}
