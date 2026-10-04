import { MODULE_ID } from "../constants.js";
import { localize } from "../i18n.js";
import { readUserSection, writeUserEntry, deleteUserEntries } from "./user-flags.js";
import { normalizeDetection, getClueTemplate } from "./clue-templates.js";

/**
 * Зона поиска — Tile на сцене с флагом zone: { templateId, detection }.
 * Настройки обнаружения копируются из шаблона при выборе и могут быть переопределены (A3).
 *
 * Состояние игрока по зонам — флаг zoneState.<tileId> на User: { attempts, found }.
 * Игрок пишет только в своё, ГМ может сбросить.
 */

const ZONE_FLAG = "zone";
const STATE_SECTION = "zoneState";

/**
 * @param {TileDocument} tileDocument
 * @returns {{templateId: string, detection: object}|null}
 */
export function getZone(tileDocument) {
  const storedZone = tileDocument?.flags?.[MODULE_ID]?.[ZONE_FLAG];
  if (!storedZone?.templateId) return null;
  return {
    templateId: storedZone.templateId,
    detection: normalizeDetection(storedZone.detection)
  };
}

/** @param {TileDocument} tileDocument */
export function isZone(tileDocument) {
  return getZone(tileDocument) !== null;
}

/** Путь поля флага зоны для форм настройки Tile. */
export function zoneFieldName(field) {
  return `flags.${MODULE_ID}.${ZONE_FLAG}.${field}`;
}

/** Зоны текущей сцены (объекты Tile на канвасе). */
export function listCanvasZones() {
  if (!canvas?.ready || !canvas.tiles) return [];
  return canvas.tiles.placeables.filter((tileObject) => isZone(tileObject.document));
}

/**
 * Все зоны во всех сценах мира — для окна ГМ.
 * @returns {{scene: Scene, tile: TileDocument, zone: object, templateName: string}[]}
 */
export function listAllZones() {
  const zoneEntries = [];
  for (const scene of game.scenes) {
    for (const tileDocument of scene.tiles) {
      const zone = getZone(tileDocument);
      if (!zone) continue;
      const template = getClueTemplate(zone.templateId);
      let templateName = localize("Zone.TemplateDeleted");
      if (template) templateName = template.name;
      zoneEntries.push({ scene, tile: tileDocument, zone, templateName });
    }
  }
  return zoneEntries;
}

/**
 * @param {User} user
 * @param {string} tileId
 * @returns {{attempts: number, found: boolean}}
 */
export function getZoneState(user, tileId) {
  const storedState = readUserSection(user, STATE_SECTION)[tileId];
  return {
    attempts: Number(storedState?.attempts) || 0,
    found: Boolean(storedState?.found)
  };
}

/**
 * Исчерпаны ли попытки (0 — без ограничения).
 * @param {{attempts: number}} zoneState
 * @param {number} maxAttempts
 */
export function areAttemptsExhausted(zoneState, maxAttempts) {
  if (!maxAttempts) return false;
  return zoneState.attempts >= maxAttempts;
}

/** Отметить провал: попытка списывается. @param {User} user @param {string} tileId */
export async function recordFailedAttempt(user, tileId) {
  const zoneState = getZoneState(user, tileId);
  await writeUserEntry(user, STATE_SECTION, tileId, { attempts: zoneState.attempts + 1, found: false });
}

/** Отметить находку. @param {User} user @param {string} tileId */
export async function recordFoundZone(user, tileId) {
  const zoneState = getZoneState(user, tileId);
  await writeUserEntry(user, STATE_SECTION, tileId, { attempts: zoneState.attempts, found: true });
}

/**
 * Сбросить попытки и отметку «нашёл» (ГМ).
 * @param {string[]} userIds
 * @param {string} tileId
 */
export async function resetZoneForUsers(userIds, tileId) {
  for (const userId of userIds) {
    const user = game.users.get(userId);
    if (!user) continue;
    if (!(tileId in readUserSection(user, STATE_SECTION))) continue;
    await deleteUserEntries(user, STATE_SECTION, [tileId]);
  }
}

/** Сбросить все зоны игрока (ГМ). @param {User} user */
export async function resetAllZonesForUser(user) {
  const tileIds = Object.keys(readUserSection(user, STATE_SECTION));
  await deleteUserEntries(user, STATE_SECTION, tileIds);
}
