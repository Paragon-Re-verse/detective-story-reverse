import { readUserSection, writeUserEntry, deleteUserEntries } from "./user-flags.js";
import { getPlayerClue, buildPlayerClue, addCluesToUser, userHasClue, CLUE_SOURCES } from "./player-clues.js";
import { logEvent, LOG_EVENTS } from "./event-log.js";
import { addFolderWithClues } from "./clue-folders.js";
import { mergeOpenLevels } from "./clue-levels.js";

/**
 * Передача улик между игроками без ведущего:
 *  1. отправитель пишет outbox.<transferId> в свои флаги (по записи на каждого получателя);
 *  2. клиент получателя видит запись (updateUser или вход в мир) и спрашивает «Да / Нет»;
 *  3. получатель пишет receipts.<transferId> в свои флаги (и при «Да» — улики в clues);
 *  4. клиент отправителя видит расписку, сообщает результат и удаляет запись из outbox;
 *  5. получатель удаляет расписку, когда записи в outbox отправителя больше нет.
 * Каждый пишет только в свои флаги.
 */

const OUTBOX_SECTION = "outbox";
const RECEIPTS_SECTION = "receipts";

/**
 * Имя персонажа пользователя, без персонажа — имя пользователя (допущение ТЗ).
 * @param {User} user
 */
export function getUserCharacterName(user) {
  if (user?.character?.name) return user.character.name;
  return user?.name ?? "";
}

/**
 * Отправить улики выбранным игрокам.
 * @param {string[]} recipientIds
 * @param {string[]} originIds
 * @param {object|null} [folder] - передача целой папки: структура и раскладка улик (buildFolderPayload)
 * @returns {Promise<number>} число созданных передач
 */
export async function sendTransfers(recipientIds, originIds, folder = null) {
  const sender = game.user;
  const transferredClues = {};
  for (const originId of originIds) {
    const playerClue = getPlayerClue(sender, originId);
    if (!playerClue) continue;
    transferredClues[originId] = {
      content: {
        name: playerClue.name,
        img: playerClue.img,
        typeId: playerClue.typeId,
        description: playerClue.description,
        tags: playerClue.tags,
        visual: playerClue.visual,
        levels: playerClue.levelsSnapshot ?? []
      },
      notes: playerClue.notes ?? "",
      // Открытые у отправителя уровни переходят вместе с уликой (п. 5).
      openLevels: playerClue.openLevels ?? {},
      customLevels: Boolean(playerClue.customLevels)
    };
  }
  if (foundry.utils.isEmpty(transferredClues)) return 0;

  let transferCount = 0;
  for (const recipientId of recipientIds) {
    const recipient = game.users.get(recipientId);
    if (!recipient || recipient.isGM || recipient.id === sender.id) continue;
    const transferId = foundry.utils.randomID();
    await writeUserEntry(sender, OUTBOX_SECTION, transferId, {
      id: transferId,
      from: sender.id,
      to: recipient.id,
      senderName: getUserCharacterName(sender),
      createdAt: Date.now(),
      clues: transferredClues,
      folder
    });
    transferCount += 1;
    await logEvent(LOG_EVENTS.transferSent, { recipient: recipient.name, clues: listTransferredNames(transferredClues) });
  }
  return transferCount;
}

/**
 * Входящие передачи текущего пользователя, на которые он ещё не ответил.
 * @param {User} [recipient]
 */
export function listIncomingTransfers(recipient = game.user) {
  const receipts = readUserSection(recipient, RECEIPTS_SECTION);
  const incomingTransfers = [];
  for (const sender of game.users) {
    if (sender.id === recipient.id) continue;
    for (const transfer of Object.values(readUserSection(sender, OUTBOX_SECTION))) {
      if (transfer?.to !== recipient.id) continue;
      if (receipts[transfer.id]) continue;
      incomingTransfers.push(transfer);
    }
  }
  return incomingTransfers.sort((first, second) => first.createdAt - second.createdAt);
}

/**
 * Какие улики передачи уже есть у получателя (предупреждение о дубликатах).
 * @param {object} transfer
 * @param {User} [recipient]
 * @returns {string[]} originId дубликатов
 */
export function findDuplicateClues(transfer, recipient = game.user) {
  return Object.keys(transfer.clues ?? {}).filter((originId) => userHasClue(recipient, originId));
}

/**
 * Ответ получателя.
 * @param {object} transfer
 * @param {boolean} accepted
 * @returns {Promise<string[]>} originId добавленных улик
 */
export async function answerTransfer(transfer, accepted) {
  const recipient = game.user;
  let addedIds = [];
  if (accepted) {
    const clueRecords = Object.entries(transfer.clues ?? {}).map(([originId, transferredClue]) => {
      const clueRecord = buildPlayerClue(
        originId,
        transferredClue.content,
        { source: CLUE_SOURCES.player, name: transfer.senderName },
        transferredClue.notes
      );
      clueRecord.openLevels = { ...(transferredClue.openLevels ?? {}) };
      clueRecord.customLevels = Boolean(transferredClue.customLevels);
      return clueRecord;
    });
    // Папка принимается только целиком: копия с подпапками ложится в корень (пп. 12, 30).
    if (transfer.folder?.folders?.[transfer.folder.rootId]) {
      addedIds = await addFolderWithClues(recipient, transfer.folder, clueRecords);
    } else {
      addedIds = await addCluesToUser(recipient, clueRecords);
    }
    // Улика уже была: открытые уровни объединяются.
    for (const [originId, transferredClue] of Object.entries(transfer.clues ?? {})) {
      if (!addedIds.includes(originId)) await mergeOpenLevels(recipient, originId, transferredClue.openLevels);
    }
  }
  await writeUserEntry(recipient, RECEIPTS_SECTION, transfer.id, {
    id: transfer.id,
    from: transfer.from,
    accepted: Boolean(accepted),
    answeredAt: Date.now()
  });
  let logType = LOG_EVENTS.transferDeclined;
  if (accepted) logType = LOG_EVENTS.transferAccepted;
  await logEvent(logType, { sender: game.users.get(transfer.from)?.name ?? transfer.senderName, clues: listTransferredNames(transfer.clues) });
  return addedIds;
}

/** Названия улик передачи для журнала. @param {object} transferredClues */
function listTransferredNames(transferredClues) {
  return Object.values(transferredClues ?? {}).map((transferredClue) => transferredClue.content?.name ?? "");
}

/**
 * Расписки на исходящие передачи текущего пользователя, которые ещё не обработаны.
 * @returns {{transfer: object, receipt: object, recipient: User}[]}
 */
export function listAnsweredOutgoingTransfers() {
  const sender = game.user;
  const answeredTransfers = [];
  for (const transfer of Object.values(readUserSection(sender, OUTBOX_SECTION))) {
    const recipient = game.users.get(transfer?.to);
    if (!recipient) continue;
    const receipt = readUserSection(recipient, RECEIPTS_SECTION)[transfer.id];
    if (!receipt) continue;
    answeredTransfers.push({ transfer, receipt, recipient });
  }
  return answeredTransfers;
}

/** Удалить обработанные записи outbox. @param {string[]} transferIds */
export async function removeOutgoingTransfers(transferIds) {
  await deleteUserEntries(game.user, OUTBOX_SECTION, transferIds);
}

/** Удалить расписки, на которые отправитель уже отреагировал. */
export async function cleanupStaleReceipts() {
  const recipient = game.user;
  const staleReceiptIds = [];
  for (const receipt of Object.values(readUserSection(recipient, RECEIPTS_SECTION))) {
    const sender = game.users.get(receipt?.from);
    const senderOutbox = readUserSection(sender, OUTBOX_SECTION);
    if (!sender || !senderOutbox[receipt.id]) staleReceiptIds.push(receipt.id);
  }
  await deleteUserEntries(recipient, RECEIPTS_SECTION, staleReceiptIds);
}
