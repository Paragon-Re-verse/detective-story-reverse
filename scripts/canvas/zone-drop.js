import { MODULE_ID, BOARD_ASSET_PATH } from "../constants.js";
import { format } from "../i18n.js";
import { getClueTemplate } from "../data/clue-templates.js";
import { isBoardScene } from "../board/board-scenes.js";

/**
 * Улика из библиотеки, брошенная на сцену, становится зоной поиска (п. 6): прозрачный тайл 2×2 клетки
 * в точке броска с этой уликой и её настройками обнаружения. Дальше тайл правится как обычно.
 * На сцене-доске зоны не создаются.
 */

export const TEMPLATE_CANVAS_DROP_TYPE = "DetectiveStoryTemplate";
const ZONE_TILE_IMAGE = `${BOARD_ASSET_PATH}/zone-transparent.webp`;
const ZONE_SIZE_IN_CELLS = 2;

export function registerTemplateDropOnCanvas() {
  Hooks.on("dropCanvasData", (canvasInstance, dropData) => {
    if (dropData?.type !== TEMPLATE_CANVAS_DROP_TYPE) return;
    if (!game.user.isGM || isBoardScene(canvasInstance.scene)) return false;
    createZoneFromTemplate(dropData.templateId, dropData.x, dropData.y);
    return false;
  });
}

/**
 * @param {string} templateId
 * @param {number} centerX - точка броска в координатах сцены
 * @param {number} centerY
 */
async function createZoneFromTemplate(templateId, centerX, centerY) {
  const template = getClueTemplate(templateId);
  const scene = canvas?.scene;
  if (!template || !scene) return;
  const size = canvas.grid.size * ZONE_SIZE_IN_CELLS;
  await scene.createEmbeddedDocuments("Tile", [{
    x: Math.round(centerX - size / 2),
    y: Math.round(centerY - size / 2),
    width: size,
    height: size,
    texture: { src: ZONE_TILE_IMAGE },
    flags: { [MODULE_ID]: { zone: { templateId, detection: foundry.utils.deepClone(template.detection), requires: [] } } }
  }]);
  ui.notifications.info(format("Zone.CreatedFromDrop", { clue: template.name }));
}
