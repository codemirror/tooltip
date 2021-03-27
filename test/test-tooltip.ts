import {install as installFakeTimers} from "@sinonjs/fake-timers"
import {EditorState, Extension, Facet, Transaction, TransactionSpec} from "@codemirror/state"
import {EditorView, PluginValue, ViewPlugin} from "@codemirror/view"
import ist from "ist"
import {hoverTooltip} from "../src/tooltip.js"

const clock = installFakeTimers()
const viewPlugin = ((ViewPlugin.define(() => ({})).extension) as unknown as { facet: Facet<ViewPlugin<PluginValue>> }).facet

function partial<U, T = U>(value: Partial<T>): U {
  return value as U
}

type EventListenerMap = {
  [K in keyof HTMLElementEventMap]: Array<(ev?: Partial<HTMLElementEventMap[K]>) => unknown>
}
globalThis.document = partial({
  createElement: (tagName: string) => partial({
    _children: [] as Array<HTMLElement>,
    _listeners: {} as EventListenerMap,

    classList: new Set<string>(),
    style: {},
    addEventListener(type: string, listener: unknown) {
      ((this._listeners as Record<string, Array<unknown>>)[type] ??= [] as Array<unknown>).push(listener)
    },
    appendChild(child: HTMLElement) {
      this._children!.push(child)
    },

    get innerHTML(): string {
      return this._children!.map(c => c.outerHTML).join("")
    },
    get outerHTML(): string {
      const classAttr = this.classList!.size > 0 ? ` class="${[...this.classList!].join(" ")}"` : ""
      return `<${tagName}${classAttr}>${this.innerHTML}</${tagName}>`
    }
  })
})

function mockView(extensions: Extension) {
  const state = EditorState.create({doc: "", extensions})

  const plugins = state.facet(viewPlugin)
  const pluginValues = [] as Array<PluginValue>

  const view = partial<EditorView>({
    state,

    dom: document.createElement("div"),
    contentDOM: partial({
      contains: () => true
    }),

    posAtCoords: () => 0,
    coordsAtPos: () => ({left: 0, right: 0, top: 0, bottom: 0}),
    bidiSpans: () => [],
    requestMeasure: () => {},

    dispatch(...input: (Transaction | TransactionSpec)[]) {
      for (const item of input) {
        const tr = (item instanceof Transaction) ? item : this.state!.update(item as TransactionSpec);
        (this as {state: EditorState}).state = tr.state
      }
      for (const pluginValue of pluginValues) {
        if (pluginValue.update)
          pluginValue.update(partial({state: this.state}))
      }
    }
  })

  for (const plugin of plugins) {
    pluginValues.push(plugin.create(view))
  }

  return view as EditorView & {
    dom: HTMLElement & { _listeners: EventListenerMap }
  }
}

describe("tooltip", () => {
  describe("hover", () => {
    describe("render", () => {
      function test(tooltips: Array<string>, expected: string) {
        const hoverTooltips = tooltips.map(t => hoverTooltip(s => ({
          pos: 0,
          create: () => ({dom: document.createElement(t)})
        })))
        const view = mockView(hoverTooltips)

        for (const mousemove of view.dom._listeners.mousemove) {
          mousemove({})
        }
        clock.runAll()

        ist(view.dom.innerHTML, expected)
      }

      it("renders one tooltip view in container", () =>
        test(["tooltip"], '<div class="cm-hover-tooltip cm-tooltip"><tooltip class="cm-hover-tooltip-section"></tooltip></div>'))

      it("renders two tooltip views in container", () =>
        test(["tooltip1", "tooltip2"], '<div class="cm-hover-tooltip cm-tooltip">' +
          '<tooltip1 class="cm-hover-tooltip-section"></tooltip1>' +
          '<tooltip2 class="cm-hover-tooltip-section"></tooltip2>' +
          "</div>"))
    })
  })
})