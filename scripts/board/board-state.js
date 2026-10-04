import { DEFAULT_THREAD_COLOR } from "../constants.js";

/**
 * Локальное состояние доски на этом клиенте.
 * active — включён режим работы с доской (активен слой рисунков);
 * threadColor — цвет нити, выбранный перед соединением карточек.
 */
export const BoardState = {
  active: false,
  threadColor: DEFAULT_THREAD_COLOR
};
