import { getSetting, SETTING_KEYS } from "./settings.js";

/**
 * Модель ролей модуля: ГМ (включая Assistant GM), профайлер (игрок с правом вести дела), игрок.
 * Все проверки прав собраны здесь, чтобы окна и обработчики сокета пользовались одной логикой.
 */

/** @param {User} [user] */
export function isGameMaster(user = game.user) {
  return Boolean(user?.isGM);
}

/** @param {User} [user] */
export function isProfiler(user = game.user) {
  if (!user || user.isGM) return false;
  const profilerIds = getSetting(SETTING_KEYS.profilers) ?? [];
  return profilerIds.includes(user.id);
}

/** Создавать и править досье подозреваемых. */
export function canEditSuspects(user = game.user) {
  return isGameMaster(user) || isProfiler(user);
}

/** Создавать новые дела (допущение A4: профайлеру — только по настройке мира). */
export function canCreateCases(user = game.user) {
  if (isGameMaster(user)) return true;
  if (isProfiler(user) && getSetting(SETTING_KEYS.profilersCreateCases)) return true;
  return false;
}

/** Править дела, таймлайн, закрывать и переоткрывать, видеть архив. */
export function canManageCases(user = game.user) {
  return isGameMaster(user) || isProfiler(user);
}

/** Прикреплять к делу любые улики, а не только свои (A5). */
export function canPinAnyClue(user = game.user) {
  return isGameMaster(user);
}

/** Пользователи-игроки (не ГМ), активные или нет. */
export function getPlayerUsers() {
  return game.users.filter((user) => !user.isGM);
}

/**
 * Может ли пользователь создавать карточки доски сам, без релея через ГМ.
 * @param {User} [user]
 */
export function canCreateDrawingsDirectly(user = game.user) {
  if (user.isGM) return true;
  return user.can("DRAWING_CREATE") && user.can("FILES_BROWSE") && user.can("FILES_UPLOAD");
}

/** Отвечает ли этот клиент за служебные действия ГМ (первый активный ГМ). */
export function isResponsibleGameMaster() {
  if (!game.user.isGM) return false;
  const activeGameMaster = game.users.activeGM;
  if (!activeGameMaster) return true;
  return activeGameMaster.id === game.user.id;
}
