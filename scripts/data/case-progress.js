import { getSetting, SETTING_KEYS } from "../settings.js";
import { getPlayerUsers } from "../permissions.js";
import { listClueTemplates, getClueTemplate } from "./clue-templates.js";
import { userHasClue } from "./player-clues.js";
import { listAllZones, getZoneState, isZoneLockedFor } from "./zones.js";
import { listItemsInSubtree } from "./folder-tree.js";

/**
 * Прогресс дела: какие улики относятся к делу и кто из игроков их нашёл.
 * «Все улики дела» — шаблоны из привязанных папок библиотеки (с подпапками), отдельно привязанные шаблоны
 * и уже прикреплённые к делу улики, у которых есть шаблон (п. 14).
 */

/** @param {object} caseData @returns {string[]} id шаблонов */
export function listCaseClueIds(caseData) {
  const clueIds = new Set();
  for (const templateId of caseData.clueSources.templateIds) {
    if (getClueTemplate(templateId)) clueIds.add(templateId);
  }
  if (caseData.clueSources.folderIds.length) {
    const libraryFolders = getSetting(SETTING_KEYS.libraryFolders) ?? {};
    const templateFolders = {};
    for (const template of listClueTemplates()) templateFolders[template.id] = template.folderId;
    for (const folderId of caseData.clueSources.folderIds) {
      for (const templateId of listItemsInSubtree(libraryFolders, folderId, templateFolders)) clueIds.add(templateId);
    }
  }
  for (const originId of Object.keys(caseData.pinned)) {
    if (getClueTemplate(originId)) clueIds.add(originId);
  }
  return [...clueIds];
}

/**
 * Таблица «улика × игроки» (п. 15): где искать, цепочка, у кого найдена, сколько попыток потрачено,
 * закрыта ли улика для игрока цепочкой.
 * @param {object} caseData
 * @param {{onlyFound?: boolean}} [options] - профайлер видит только найденное кем-то из игроков (п. 17)
 */
export function buildCaseProgress(caseData, { onlyFound = false } = {}) {
  const players = getPlayerUsers();
  const zonesByTemplate = new Map();
  for (const zoneEntry of listAllZones()) {
    const templateId = zoneEntry.zone.templateId;
    if (!zonesByTemplate.has(templateId)) zonesByTemplate.set(templateId, []);
    zonesByTemplate.get(templateId).push(zoneEntry);
  }
  const rows = [];
  for (const templateId of listCaseClueIds(caseData)) {
    const template = getClueTemplate(templateId);
    if (!template) continue;
    const zoneEntries = zonesByTemplate.get(templateId) ?? [];
    const requiredIds = [...new Set(zoneEntries.flatMap((zoneEntry) => zoneEntry.zone.requires))];
    const cells = players.map((player) => {
      let attempts = 0;
      let maxAttempts = 0;
      let unlimited = false;
      for (const zoneEntry of zoneEntries) {
        attempts += getZoneState(player, zoneEntry.tile.id).attempts;
        if (zoneEntry.zone.detection.maxAttempts) {
          maxAttempts += zoneEntry.zone.detection.maxAttempts;
        } else {
          unlimited = true;
        }
      }
      if (unlimited) maxAttempts = 0;
      const locked = zoneEntries.length > 0 && zoneEntries.every((zoneEntry) => isZoneLockedFor(zoneEntry.zone, player));
      return { userId: player.id, found: userHasClue(player, templateId), attempts, maxAttempts, locked };
    });
    const foundCount = cells.filter((cell) => cell.found).length;
    if (onlyFound && !foundCount) continue;
    rows.push({
      id: templateId,
      name: template.name,
      img: template.img,
      places: zoneEntries.map((zoneEntry) => zoneEntry.scene.name),
      requires: requiredIds.map((requiredId) => getClueTemplate(requiredId)?.name).filter(Boolean),
      cells,
      foundCount
    });
  }
  rows.sort((first, second) => first.name.localeCompare(second.name, game.i18n.lang));
  return {
    players: players.map((player) => ({ id: player.id, name: player.name, foundCount: rows.filter((row) => row.cells.find((cell) => cell.userId === player.id)?.found).length })),
    rows,
    total: rows.length,
    foundByGroup: rows.filter((row) => row.foundCount > 0).length
  };
}
