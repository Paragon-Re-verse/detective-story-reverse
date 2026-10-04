import { MODULE_ID } from "./constants.js";
import { localize } from "./i18n.js";

/**
 * Релей действий через ГМ (socketlib). Нужен только там, где у игрока нет прав Foundry:
 * создание общих документов профайлером и правка чужих карточек доски.
 *
 * Модули данных регистрируют обработчики через registerGameMasterHandler(); каждый обработчик
 * получает пользователя, отправившего запрос, и сам проверяет его права. Отклонённый запрос
 * возвращает null и пишется в консоль ГМ.
 */

const gameMasterHandlers = new Map();
const everyoneHandlers = new Map();
let moduleSocket = null;

export class PermissionDeniedError extends Error {}

/**
 * @param {string} name
 * @param {(requester: User, ...args: any[]) => any} handler
 */
export function registerGameMasterHandler(name, handler) {
  gameMasterHandlers.set(name, handler);
}

/**
 * Обработчик, который выполняется у всех клиентов (например, общее воспроизведение аудио).
 * @param {string} name
 * @param {(...args: any[]) => any} handler
 */
export function registerEveryoneHandler(name, handler) {
  everyoneHandlers.set(name, handler);
}

export function initializeSocket() {
  moduleSocket = socketlib.registerModule(MODULE_ID);
  for (const [name, handler] of gameMasterHandlers) {
    moduleSocket.register(name, async function relayedHandler(...args) {
      const requester = game.users.get(this.socketdata.userId);
      if (!requester) return null;
      try {
        return await handler(requester, ...args);
      } catch (error) {
        if (error instanceof PermissionDeniedError) {
          console.warn(`${MODULE_ID} | ${localize("Socket.Denied")}: ${name} (${requester.name})`, args);
          return null;
        }
        console.error(`${MODULE_ID} | ${name}`, error);
        return null;
      }
    });
  }
  for (const [name, handler] of everyoneHandlers) {
    moduleSocket.register(name, handler);
  }
}

/**
 * Выполнить действие от имени ГМ. Если пользователь сам ГМ, обработчик вызывается напрямую.
 * Если ГМ нет в сети, показывает уведомление и возвращает null.
 * @param {string} name
 * @param {...any} args
 * @returns {Promise<any>}
 */
export async function requestAsGameMaster(name, ...args) {
  if (game.user.isGM) {
    const handler = gameMasterHandlers.get(name);
    return handler(game.user, ...args);
  }
  if (!game.users.activeGM) {
    ui.notifications.warn(localize("Notify.GameMasterRequired"));
    return null;
  }
  try {
    return await moduleSocket.executeAsGM(name, ...args);
  } catch (error) {
    console.error(`${MODULE_ID} | ${name}`, error);
    ui.notifications.warn(localize("Notify.GameMasterRequired"));
    return null;
  }
}

/**
 * Выполнить действие у всех клиентов, включая текущий.
 * @param {string} name
 * @param {...any} args
 */
export function executeForEveryone(name, ...args) {
  return moduleSocket.executeForEveryone(name, ...args);
}

/**
 * Выполнить действие у всех клиентов, кроме текущего.
 * @param {string} name
 * @param {...any} args
 */
export function executeForOthers(name, ...args) {
  return moduleSocket.executeForOthers(name, ...args);
}

/**
 * Бросает PermissionDeniedError, если условие ложно.
 * @param {boolean} condition
 */
export function assertPermission(condition) {
  if (!condition) throw new PermissionDeniedError();
}
