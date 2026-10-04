import { TEMPLATE_PATH } from "../constants.js";
import { localize, format } from "../i18n.js";
import { getPlayerUsers } from "../permissions.js";
import {
  sendTransfers,
  listIncomingTransfers,
  findDuplicateClues,
  answerTransfer,
  listAnsweredOutgoingTransfers,
  removeOutgoingTransfers,
  cleanupStaleReceipts,
  getUserCharacterName
} from "../data/transfers.js";
import { whisperGameMasters, escapeText, GM_NOTE_TONES } from "../chat.js";

const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

/**
 * Выбор получателей: список игроков с галочками. Для игрока — без себя и без ГМ, для ГМ — все игроки.
 * @param {{title: string, confirmLabel: string}} labels
 * @returns {Promise<string[]|null>}
 */
export async function pickRecipients({ title, confirmLabel }) {
  const candidates = getPlayerUsers()
    .filter((user) => user.id !== game.user.id)
    .map((user) => ({ id: user.id, name: user.name, characterName: getUserCharacterName(user), active: user.active }));
  if (!candidates.length) {
    ui.notifications.info(localize("Transfer.NoRecipients"));
    return null;
  }
  const content = await renderTemplate(`${TEMPLATE_PATH}/apps/recipient-picker.hbs`, { candidates });
  const recipientIds = await DialogV2.wait({
    window: { title, icon: "fa-solid fa-users" },
    classes: ["detective-story", "recipient-picker"],
    content,
    buttons: [
      {
        action: "confirm",
        label: confirmLabel,
        icon: "fa-solid fa-check",
        default: true,
        callback: (event, button) => {
          return [...button.form.querySelectorAll("input[name='recipient']:checked")].map((input) => input.value);
        }
      },
      { action: "cancel", label: localize("Common.Cancel"), icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (!Array.isArray(recipientIds) || !recipientIds.length) return null;
  return recipientIds;
}

/**
 * Передать свои улики выбранным игрокам.
 * @param {string[]} originIds
 * @returns {Promise<boolean>}
 */
export async function startTransfer(originIds) {
  const recipientIds = await pickRecipients({
    title: localize("Transfer.PickTitle"),
    confirmLabel: localize("Transfer.Send")
  });
  if (!recipientIds) return false;
  const transferCount = await sendTransfers(recipientIds, originIds);
  if (transferCount) ui.notifications.info(localize("Transfer.Sent"));
  return transferCount > 0;
}

let incomingQueueRunning = false;

/**
 * Показать окна подтверждения входящих передач строго по очереди: передача, пришедшая, пока открыто окно,
 * ждёт своей очереди, а не открывается поверх. Список перечитывается после каждого ответа.
 */
export async function processIncomingTransfers() {
  if (game.user.isGM || incomingQueueRunning) return;
  incomingQueueRunning = true;
  const askedIds = new Set();
  try {
    let nextTransfer = listIncomingTransfers().find((transfer) => !askedIds.has(transfer.id));
    while (nextTransfer) {
      askedIds.add(nextTransfer.id);
      await askAboutTransfer(nextTransfer);
      nextTransfer = listIncomingTransfers().find((transfer) => !askedIds.has(transfer.id));
    }
  } finally {
    incomingQueueRunning = false;
  }
}

/** @param {object} transfer */
async function askAboutTransfer(transfer) {
  const duplicateIds = findDuplicateClues(transfer);
  const clues = Object.entries(transfer.clues ?? {}).map(([originId, transferredClue]) => {
    return { ...transferredClue.content, isDuplicate: duplicateIds.includes(originId) };
  });
  const sender = game.users.get(transfer.from);
  const content = await renderTemplate(`${TEMPLATE_PATH}/apps/transfer-confirm.hbs`, {
    senderName: transfer.senderName,
    senderPortrait: sender?.character?.img || sender?.avatar || CONST.DEFAULT_TOKEN,
    clues,
    hasDuplicates: duplicateIds.length > 0
  });
  const accepted = await DialogV2.confirm({
    window: { title: localize("Transfer.ConfirmTitle"), icon: "fa-solid fa-envelope-open-text" },
    classes: ["detective-story", "transfer-confirm"],
    content,
    yes: { label: localize("Common.Yes"), icon: "fa-solid fa-check" },
    no: { label: localize("Common.No"), icon: "fa-solid fa-xmark" },
    rejectClose: false
  });
  const stillPending = listIncomingTransfers().some((pendingTransfer) => pendingTransfer.id === transfer.id);
  if (!stillPending) return;
  await answerTransfer(transfer, accepted === true);

  const clueNames = clues.map((clue) => escapeText(clue.name)).join(", ");
  let resultKey = "Chat.TransferDeclined";
  let noteStyle = GM_NOTE_TONES.declined;
  if (accepted === true) {
    resultKey = "Chat.TransferAccepted";
    noteStyle = GM_NOTE_TONES.accepted;
  }
  await whisperGameMasters(format(resultKey, {
    sender: escapeText(transfer.senderName),
    recipient: escapeText(getUserCharacterName(game.user)),
    clues: clueNames
  }), noteStyle);
}

/** Отправитель: показать результат по распискам и убрать записи из outbox. */
export async function processOutgoingReceipts() {
  const answeredTransfers = listAnsweredOutgoingTransfers();
  if (!answeredTransfers.length) return;
  for (const { receipt, recipient } of answeredTransfers) {
    let messageKey = "Transfer.DeclinedBy";
    if (receipt.accepted) messageKey = "Transfer.AcceptedBy";
    ui.notifications.info(format(messageKey, { name: getUserCharacterName(recipient) }));
  }
  await removeOutgoingTransfers(answeredTransfers.map(({ transfer }) => transfer.id));
}

let synchronizationRunning = false;
let synchronizationQueued = false;

/** Все шаги обмена, которые клиент делает при изменениях пользователей и при входе. */
export async function synchronizeTransfers() {
  if (game.user.isGM) return;
  if (synchronizationRunning) {
    synchronizationQueued = true;
    return;
  }
  synchronizationRunning = true;
  try {
    await processOutgoingReceipts();
    await cleanupStaleReceipts();
  } finally {
    synchronizationRunning = false;
  }
  processIncomingTransfers();
  if (synchronizationQueued) {
    synchronizationQueued = false;
    synchronizeTransfers();
  }
}

