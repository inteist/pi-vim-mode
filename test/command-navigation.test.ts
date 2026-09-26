import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMultiLineEditor, sendKeys } from "./harness.js";

const NATIVE_UP = "\x1b[1;9A";
const NATIVE_DOWN = "\x1b[1;9B";
const PREFIXES = [
  "\x1b[31~", // F17, legacy xterm
  "\x1b[57380u", // F17, Kitty
  "\x1b[57380;1u", // F17, Nash with Kitty enabled
  "\x1b[57380;65u", // F17 with Caps Lock
];

const shortcuts = [
  { name: "native Command arrows", up: [NATIVE_UP], down: [NATIVE_DOWN] },
  {
    name: "Kitty CSI-u Command arrows",
    up: ["\x1b[57352;9u"],
    down: ["\x1b[57353;9u"],
  },
  {
    name: "Command arrows with Caps Lock",
    up: ["\x1b[1;73A"],
    down: ["\x1b[1;73B"],
  },
  ...PREFIXES.flatMap((prefix, index) => [
    {
      name: `Karabiner F17 variant ${index}, separate events`,
      up: [prefix, "\x1b[A"],
      down: [prefix, "\x1b[B"],
    },
    {
      name: `Karabiner F17 variant ${index}, combined event`,
      up: [prefix + "\x1b[A"],
      down: [prefix + "\x1b[B"],
    },
  ]),
];

describe("macOS whole-draft navigation", () => {
  for (const shortcut of shortcuts) {
    for (const mode of ["insert", "normal"] as const) {
      it(`${shortcut.name} reaches both boundaries in ${mode} mode`, () => {
        const text = "  first line\n" + "wrapped ".repeat(30) + "\nlast 👩‍💻é";
        const { editor, clipboardWrites } = createMultiLineEditor(text);
        editor.addToHistory("older prompt that must not replace the draft");
        sendKeys(editor, ["j", "l", ...(mode === "insert" ? ["i"] : [])]);

        sendKeys(editor, shortcut.down);
        const end = { line: 2, col: "last 👩‍💻é".length };
        assert.deepEqual(editor.getCursor(), end);
        sendKeys(editor, shortcut.down);
        assert.deepEqual(editor.getCursor(), end);
        sendKeys(editor, shortcut.up);
        sendKeys(editor, shortcut.up);
        assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
        assert.equal(editor.getMode(), mode);
        assert.equal(editor.getText(), text);
        assert.equal(editor.getRegister(), "");
        assert.deepEqual(clipboardWrites, []);
      });
    }
  }

  for (const text of ["", "single line", "first\n", "\n\n"]) {
    it(`handles empty lines and exact EOF in ${JSON.stringify(text)}`, () => {
      const { editor } = createMultiLineEditor(text);
      const lines = text.split("\n");
      sendKeys(editor, ["i", NATIVE_DOWN]);
      assert.deepEqual(editor.getCursor(), {
        line: lines.length - 1,
        col: lines[lines.length - 1]!.length,
      });
      sendKeys(editor, [NATIVE_UP]);
      assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
      assert.equal(editor.getText(), text);
    });
  }

  it("inserts at the actual beginning and end without switching modes", () => {
    const { editor } = createMultiLineEditor("first\nlast");
    sendKeys(editor, ["i", NATIVE_DOWN, "!", NATIVE_UP, ">"]);
    assert.equal(editor.getText(), ">first\nlast!");
    assert.equal(editor.getMode(), "insert");
  });

  for (const pending of [
    ["2"], ["d"], ["c"], ["y"], ["r"], ["f"], ["d", "i"], ["g"], [":", "q"],
  ]) {
    it(`cancels pending ${pending.join("")} without editing or leaking a count`, () => {
      const { editor, clipboardWrites } = createMultiLineEditor("abc\ndef");
      sendKeys(editor, [...pending, "\x1b[57380;1u", "\x1b[B"]);
      assert.deepEqual(editor.getCursor(), { line: 1, col: 3 });
      assert.equal(editor.getMode(), "normal");
      assert.equal(editor.getText(), "abc\ndef");
      assert.deepEqual(clipboardWrites, []);
      sendKeys(editor, ["h"]);
      assert.deepEqual(editor.getCursor(), { line: 1, col: 2 });
    });
  }

  it("leaves ordinary arrows alone and consumes a prefix only once", () => {
    const { editor } = createMultiLineEditor("aaa\nbbb\nccc");
    sendKeys(editor, ["i", "\x1b[B"]);
    assert.deepEqual(editor.getCursor(), { line: 1, col: 0 });
    sendKeys(editor, ["\x1b[A"]);
    assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
    sendKeys(editor, ["\x1b[31~", "x", "\x1b[B"]);
    assert.equal(editor.getText(), "xaaa\nbbb\nccc");
    assert.deepEqual(editor.getCursor(), { line: 1, col: 1 });
  });

  it("keeps undo/redo history intact", () => {
    const { editor } = createMultiLineEditor("abc\ndef");
    sendKeys(editor, ["x", "u", NATIVE_DOWN, NATIVE_UP, "\x12"]);
    assert.equal(editor.getText(), "bc\ndef");
  });

  it("does not interpret Command arrows inside bracketed paste", () => {
    const { editor } = createMultiLineEditor("first\nlast");
    sendKeys(editor, ["i", "\x1b[200~", NATIVE_DOWN, "\x1b[201~"]);
    assert.equal(editor.getCursor().line, 0);
    assert.ok(editor.getText().endsWith("first\nlast"));
  });
});
