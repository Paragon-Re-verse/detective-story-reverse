import { showBoardContextMenu } from "../board/threads.js";

/**
 * Меню по правому клику в окнах модуля — то же меню, что на доске. Пункты собираются для элемента,
 * по которому кликнули; пустой список — меню не показывается (и не мешает штатному).
 * Слушатель вешается один раз на контейнер.
 * @param {HTMLElement|null} container
 * @param {string} selector
 * @param {(targetElement: HTMLElement) => {icon: string, label: string, callback: Function}[]} buildItems
 */
export function attachContextMenu(container, selector, buildItems) {
  if (!container) return;
  const flag = `contextMenu${selector.replace(/[^a-z]/gi, "")}`;
  if (container.dataset[flag]) return;
  container.dataset[flag] = "true";
  container.addEventListener("contextmenu", (event) => {
    const targetElement = event.target.closest(selector);
    if (!targetElement || !container.contains(targetElement)) return;
    const menuItems = buildItems(targetElement).filter(Boolean);
    if (!menuItems.length) return;
    event.preventDefault();
    event.stopPropagation();
    showBoardContextMenu(event.clientX, event.clientY, menuItems);
  });
}
