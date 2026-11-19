// Самопроверка дерева папок: node tools/folder-tree.test.mjs
import assert from "node:assert/strict";
import {
  MAX_FOLDER_DEPTH, getFolderDepth, getSubtreeHeight, checkFolderMove, makeUniqueFolderName,
  copyFolderTree, planFolderRemoval, listItemsInSubtree, buildFolderNodes, getFolderPath, resolveFolderId
} from "../scripts/data/folder-tree.js";

const folder = (id, parentId, sort = 1) => ({ id, name: id, color: "", icon: "", parentId, sort });
const folders = { a: folder("a", null), b: folder("b", "a"), c: folder("c", "b"), d: folder("d", "c"), e: folder("e", null, 2) };

assert.equal(MAX_FOLDER_DEPTH, 4);
assert.equal(getFolderDepth(folders, "d"), 4);
assert.equal(getFolderDepth(folders, null), 0);
assert.equal(getSubtreeHeight(folders, "a"), 4);
assert.equal(checkFolderMove(folders, "a", "d"), "cycle");
assert.equal(checkFolderMove(folders, "e", "d"), "depth");
assert.equal(checkFolderMove(folders, "e", "c"), null);
assert.equal(checkFolderMove(folders, "b", "e"), null);
assert.equal(checkFolderMove(folders, "a", "e"), "depth");
assert.equal(checkFolderMove(folders, "c", "e"), null);
assert.equal(resolveFolderId(folders, "gone"), null);

assert.equal(makeUniqueFolderName(folders, null, "a"), "a (2)");
assert.equal(makeUniqueFolderName({ ...folders, x: { ...folder("x", null), name: "a (2)" } }, null, "a"), "a (3)");
assert.equal(makeUniqueFolderName(folders, null, "b"), "b");

let counter = 0;
const copy = copyFolderTree(folders, "b", folders, null, () => `n${++counter}`);
assert.deepEqual(Object.keys(copy.idMap), ["b", "c", "d"]);
assert.equal(copy.folders[copy.idMap.b].parentId, null);
assert.equal(copy.folders[copy.idMap.c].parentId, copy.idMap.b);
assert.equal(copy.folders[copy.idMap.b].name, "b");
const copyOfA = copyFolderTree(folders, "a", folders, null, () => `m${++counter}`);
assert.equal(copyOfA.folders[copyOfA.idMap.a].name, "a (2)");

const items = { clue1: "b", clue2: "d", clue3: null, clue4: "e" };
const removal = planFolderRemoval(folders, "b", items);
assert.equal(removal.folders.b, null);
assert.equal(removal.folders.c.parentId, "a");
assert.deepEqual(removal.items, { clue1: "a" });
assert.deepEqual(listItemsInSubtree(folders, "a", items).sort(), ["clue1", "clue2"]);

const nodes = buildFolderNodes(folders, items);
assert.equal(nodes.length, 2);
assert.equal(nodes[0].itemCount, 2);
assert.equal(nodes[0].children[0].children[0].children[0].depth, 4);
const visibleNodes = buildFolderNodes(folders, { clue4: "e" }, (entry, itemCount) => itemCount > 0);
assert.deepEqual(visibleNodes.map((node) => node.id), ["e"]);
assert.equal(getFolderPath(folders, "c"), "a / b / c");

console.log("folder-tree: ok");
