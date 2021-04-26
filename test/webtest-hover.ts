import {EditorState, Extension} from "@codemirror/state"
import {EditorView} from "@codemirror/view"
import ist from "ist"
import {hoverTooltip} from "../src/tooltip.js"

function makeView(doc: string, extensions: Extension) {
  const state = EditorState.create({doc, extensions})
  const root = document.body.appendChild(document.createElement("div"))

  return new EditorView({state, parent: root})
}

async function waitForSuccess(assert: () => void) {
  for (let i = 0; i < 20; i++) {
    await new Promise<void>(resolve => setTimeout(() => resolve(), 50))
    try {
      assert()
      return
    }
    catch {
    }
  }
  // final try
  assert()
}

function setupHover(...tooltips: Array<string|{text: string, start: number, end: number}>) {
  const testText = "test"
  const hoverTooltips = tooltips.map(x => {
    const {text, start, end} = typeof x === "string"
      ? {text: x, start: 0, end: testText.length - 1}
      : x

    return hoverTooltip((_, pos) => {
      if (pos < start || pos > end) return null

      return {pos, create: () => {
        const dom = document.createElement("div")
        dom.innerText = text
        return {dom}
      }}
    })
  })
  const view = makeView(testText, hoverTooltips)

  return {
    mousemove(pos = 0) {
      const line = view.dom.querySelector(".cm-line")!
      const {top, left} = view.coordsAtPos(pos)!
      line.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: left + 1, clientY: top + 1}))
    },

    expect(html: string) {
      return waitForSuccess(() => {
        const tooltip = view.dom.querySelector(".cm-tooltip")
        ist(tooltip)
        ist(tooltip!.className, "cm-hover-tooltip cm-tooltip cm-tooltip-below")
        ist(tooltip!.innerHTML, html)
      })
    }
  }
}

describe("tooltip", () => {
  describe("hover", () => {
    it("renders one tooltip view in container", async () => {
      const {mousemove, expect} = setupHover("test")
      mousemove()
      await expect('<div class="cm-hover-tooltip-section">test</div>')
    }),

    it("renders two tooltip views in container", async () => {
      const {mousemove, expect} = setupHover("test1", "test2")
      mousemove()
      await expect('<div class="cm-hover-tooltip-section">test1</div>' +
        '<div class="cm-hover-tooltip-section">test2</div>')
    })

    it("adds tooltip view if mouse moves into the range", async () => {
      const {mousemove, expect} = setupHover(
        {text: "add", start: 2, end: 4},
        {text: "keep", start: 0, end: 4}
      )
      mousemove(0)
      await expect('<div class="cm-hover-tooltip-section">keep</div>')
      mousemove(3)
      await expect('<div class="cm-hover-tooltip-section">add</div>'
        + '<div class="cm-hover-tooltip-section">keep</div>')
    })

    it("removes tooltip view if mouse moves outside of the range", async () => {
      const {mousemove, expect} = setupHover(
        {text: "remove", start: 0, end: 2},
        {text: "keep", start: 0, end: 4}
      )
      mousemove(0)
      await expect('<div class="cm-hover-tooltip-section">remove</div>' +
        '<div class="cm-hover-tooltip-section">keep</div>')
      mousemove(3)
      await expect('<div class="cm-hover-tooltip-section">keep</div>')
    })
  })
})