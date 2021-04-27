import {EditorView, ViewPlugin, ViewUpdate, Direction, logException} from "@codemirror/view"
import {StateEffect, StateEffectType, Facet, StateField, Extension, MapMode} from "@codemirror/state"

const ios = typeof navigator != "undefined" &&
  !/Edge\/(\d+)/.exec(navigator.userAgent) && /Apple Computer/.test(navigator.vendor) &&
  (/Mobile\/\w+/.test(navigator.userAgent) || navigator.maxTouchPoints > 2)

type Rect = {left: number, right: number, top: number, bottom: number}

type Measured = {
  editor: Rect,
  pos: (Rect | null)[],
  size: Rect[],
  innerWidth: number,
  innerHeight: number
}

const Outside = "-10000px"

class TooltipViewManager {
  private input: readonly (Tooltip | null)[]
  tooltips: readonly Tooltip[]
  tooltipViews: readonly TooltipView[]

  constructor(
    view: EditorView,
    private readonly facet: Facet<Tooltip | null>,
    private readonly createTooltipView: (tooltip: Tooltip) => TooltipView
  ) {
    this.input = view.state.facet(facet)
    this.tooltips = this.input.filter(t => t) as Tooltip[]
    this.tooltipViews = this.tooltips.map(createTooltipView)
  }

  update(update: ViewUpdate) {
    const input = update.state.facet(this.facet)
    const tooltips = input.filter(x => x) as Tooltip[]
    if (input === this.input) {
      for (let t of this.tooltipViews) if (t.update) t.update(update)
      return {shouldMeasure: false}
    }

    let tooltipViews = []
    for (let i = 0; i < tooltips.length; i++) {
      let tip = tooltips[i], known = -1
      if (!tip) continue
      for (let i = 0; i < this.tooltips.length; i++) {
        let other = this.tooltips[i]
        if (other && other.create == tip.create) known = i
      }
      if (known < 0) {
        tooltipViews[i] = this.createTooltipView(tip)
      } else {
        let tooltipView = tooltipViews[i] = this.tooltipViews[known]
        if (tooltipView.update) tooltipView.update(update)
      }
    }
    for (let t of this.tooltipViews) if (tooltipViews.indexOf(t) < 0) t.dom.remove()

    this.input = input
    this.tooltips = tooltips
    this.tooltipViews = tooltipViews
    return {shouldMeasure: true}
  }
}

const tooltipPlugin = ViewPlugin.fromClass(class {
  manager: TooltipViewManager
  measureReq: {read: () => Measured, write: (m: Measured) => void, key: any}
  inView = true

  constructor(readonly view: EditorView) {
    this.measureReq = {read: this.readMeasure.bind(this), write: this.writeMeasure.bind(this), key: this}
    this.manager = new TooltipViewManager(view, showTooltip, t => this.createTooltip(t))
  }

  update(update: ViewUpdate) {
    const {shouldMeasure} = this.manager.update(update)
    if (shouldMeasure)
      this.maybeMeasure()
  }

  createTooltip(tooltip: Tooltip) {
    let tooltipView = tooltip.create(this.view)
    tooltipView.dom.classList.add("cm-tooltip")
    // FIXME drop this on the next breaking release
    if ((tooltip as any).class) tooltipView.dom.classList.add((tooltip as any).class)
    tooltipView.dom.style.top = Outside
    this.view.dom.appendChild(tooltipView.dom)
    if (tooltipView.mount) tooltipView.mount(this.view)
    return tooltipView
  }

  destroy() {
    for (let {dom} of this.manager.tooltipViews) dom.remove()
  }

  readMeasure() {
    return {
      editor: this.view.dom.getBoundingClientRect(),
      pos: this.manager.tooltips.map(t => this.view.coordsAtPos(t.pos)),
      size: this.manager.tooltipViews.map(({dom}) => dom.getBoundingClientRect()),
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight
    }
  }

  writeMeasure(measured: Measured) {
    let {editor} = measured
    let others = []
    for (let i = 0; i < this.manager.tooltips.length; i++) {
      let tooltip = this.manager.tooltips[i], tView = this.manager.tooltipViews[i], {dom} = tView
      let pos = measured.pos[i], size = measured.size[i]
      // Hide tooltips that are outside of the editor.
      if (!pos || pos.bottom <= editor.top || pos.top >= editor.bottom || pos.right <= editor.left || pos.left >= editor.right) {
        dom.style.top = Outside
        continue
      }
      let width = size.right - size.left, height = size.bottom - size.top
      let left = this.view.textDirection == Direction.LTR ? Math.min(pos.left, measured.innerWidth - width)
        : Math.max(0, pos.left - width)
      let above = !!tooltip.above
      if (!tooltip.strictSide &&
          (above ? pos.top - (size.bottom - size.top) < 0 : pos.bottom + (size.bottom - size.top) > measured.innerHeight))
        above = !above
      let top = above ? pos.top - height : pos.bottom, right = left + width
      for (let r of others) if (r.left < right && r.right > left && r.top < top + height && r.bottom > top)
        top = above ? r.top - height : r.bottom
      if (ios) {
        dom.style.top = (top - editor.top) + "px"
        dom.style.left = (left - editor.left) + "px"
        dom.style.position = "absolute"
      } else {
        dom.style.top = top + "px"
        dom.style.left = left + "px"
      }
      others.push({left, top, right, bottom: top + height})
      dom.classList.toggle("cm-tooltip-above", above)
      dom.classList.toggle("cm-tooltip-below", !above)
      if (tView.positioned) tView.positioned()
    }
  }

  maybeMeasure() {
    if (this.manager.tooltips.length) {
      if (this.view.inView || this.inView) this.view.requestMeasure(this.measureReq)
      this.inView = this.view.inView
    }
  }
}, {
  eventHandlers: {
    scroll() { this.maybeMeasure() }
  }
})

const baseTheme = EditorView.baseTheme({
  ".cm-tooltip": {
    position: "fixed",
    zIndex: 100
  },
  "&light .cm-tooltip": {
    border: "1px solid #ddd",
    backgroundColor: "#f5f5f5"
  },
  "&light .cm-tooltip-section:not(:first-child)": {
    borderTop: "1px solid #ddd",
  },
  "&dark .cm-tooltip": {
    backgroundColor: "#333338",
    color: "white"
  }
})

// FIXME backward-compat shim. Delete on next major version.
/// @internal
export function tooltips(): Extension {
  return []
}

/// Describes a tooltip. Values of this type, when provided through
/// the [`showTooltip`](#tooltip.showTooltip) facet, control the
/// individual tooltips on the editor.
export interface Tooltip {
  /// The document position at which to show the tooltip.
  pos: number
  /// The end of the range annotated by this tooltip, if different
  /// from `pos`.
  end?: number
  /// A constructor function that creates the tooltip's [DOM
  /// representation](#tooltip.TooltipView).
  create(view: EditorView): TooltipView
  /// Whether the tooltip should be shown above or below the target
  /// position. Not guaranteed for hover tooltips since all hover
  /// tooltips for the same range are always positioned together.
  /// Defaults to false.
  above?: boolean
  /// Whether the `above` option should be honored when there isn't
  /// enough space on that side to show the tooltip inside the
  /// viewport. Not guaranteed for hover tooltips. Defaults to false.
  strictSide?: boolean
}

/// Describes the way a tooltip is displayed.
export interface TooltipView {
  /// The DOM element to position over the editor.
  dom: HTMLElement
  /// Called after the tooltip is added to the DOM for the first time.
  mount?(view: EditorView): void
  /// Update the DOM element for a change in the view's state.
  update?(update: ViewUpdate): void
  /// Called when the tooltip has been (re)positioned.
  positioned?(): void
}

/// Behavior by which an extension can provide a tooltip to be shown.
export const showTooltip = Facet.define<Tooltip | null>({
  enables: [tooltipPlugin, baseTheme]
})

const showHoverTooltip = Facet.define<Tooltip | null>()

class HoverTooltipHost implements TooltipView {
  private readonly manager: TooltipViewManager
  dom: HTMLElement
  mounted: boolean = false

  // Needs to be static so that host tooltip instances always match
  static create(view: EditorView) {
    return new HoverTooltipHost(view)
  }

  private constructor(readonly view: EditorView) {
    this.dom = document.createElement("div")
    this.dom.classList.add("cm-tooltip-hover")
    this.manager = new TooltipViewManager(view, showHoverTooltip, t => this.createHostedView(t))
  }

  createHostedView(tooltip: Tooltip) {
    const hostedView = tooltip.create(this.view)
    hostedView.dom.classList.add("cm-tooltip-section")
    this.dom.appendChild(hostedView.dom)
    if (this.mounted && hostedView.mount)
      hostedView.mount(this.view)
    return hostedView
  }

  mount(view: EditorView) {
    for (const hostedView of this.manager.tooltipViews) {
      if (hostedView.mount) hostedView.mount(view)
    }
    this.mounted = true
  }

  positioned() {
    for (const hostedView of this.manager.tooltipViews) {
      if (hostedView.positioned) hostedView.positioned()
    }
  }

  update(update: ViewUpdate) {
    this.manager.update(update)
  }
}

const showHoverTooltipHost = showTooltip.compute([showHoverTooltip], state => {
  const tooltips = state.facet(showHoverTooltip).filter(t => t) as Tooltip[]
  if (tooltips.length === 0) return null

  return {
    pos: Math.min(...tooltips.map(t => t.pos)),
    end: Math.max(...tooltips.filter(t => t.end != null).map(t => t.end!)),
    create: HoverTooltipHost.create,
    above: tooltips[0].above
  }
})

const enum Hover { Time = 750, MaxDist = 6 }

class HoverPlugin {
  lastMouseMove: MouseEvent | null = null
  lastMoveTime = 0
  hoverTimeout = -1
  restartTimeout = -1
  pending: {pos: number} | null = null

  constructor(readonly view: EditorView,
              readonly source: (view: EditorView, pos: number, side: -1 | 1) => Tooltip | null | Promise<Tooltip | null>,
              readonly field: StateField<Tooltip | null>,
              readonly setHover: StateEffectType<Tooltip | null>,
              readonly hoverTime: number) {
    this.checkHover = this.checkHover.bind(this)
    view.dom.addEventListener("mouseleave", this.mouseleave = this.mouseleave.bind(this))
    view.dom.addEventListener("mousemove", this.mousemove = this.mousemove.bind(this))
  }

  update() {
    if (this.pending) {
      this.pending = null
      clearTimeout(this.restartTimeout)
      this.restartTimeout = setTimeout(() => this.startHover(), 20)
    }
  }

  get active() {
    return this.view.state.field(this.field)
  }

  checkHover() {
    this.hoverTimeout = -1
    if (this.active) return
    let hovered = Date.now() - this.lastMoveTime
    if (hovered < this.hoverTime)
      this.hoverTimeout = setTimeout(this.checkHover, this.hoverTime - hovered)
    else
      this.startHover()
  }

  startHover() {
    clearTimeout(this.restartTimeout)
    let lastMove = this.lastMouseMove!
    let coords = {x: lastMove.clientX, y: lastMove.clientY}
    let pos = this.view.contentDOM.contains(lastMove.target as HTMLElement)
      ? this.view.posAtCoords(coords) : null
    if (pos == null) return
    let posCoords = this.view.coordsAtPos(pos)
    if (posCoords == null || coords.y < posCoords.top || coords.y > posCoords.bottom ||
        coords.x < posCoords.left - this.view.defaultCharacterWidth ||
        coords.x > posCoords.right + this.view.defaultCharacterWidth) return
    let bidi = this.view.bidiSpans(this.view.state.doc.lineAt(pos)).find(s => s.from <= pos! && s.to >= pos!)
    let rtl = bidi && bidi.dir == Direction.RTL ? -1 : 1
    let open = this.source(this.view, pos, (coords.x < posCoords.left ? -rtl : rtl) as -1 | 1)
    if ((open as any)?.then) {
      let pending = this.pending = {pos}
      ;(open as Promise<Tooltip | null>).then(result => {
        if (this.pending == pending) {
          this.pending = null
          if (result) this.view.dispatch({effects: this.setHover.of(result)})
        }
      }, e => logException(this.view.state, e, "hover tooltip"))
    } else if (open) {
      this.view.dispatch({effects: this.setHover.of(open as Tooltip)})
    }
  }

  mousemove(event: MouseEvent) {
    this.lastMouseMove = event
    this.lastMoveTime = Date.now()
    if (this.hoverTimeout < 0) this.hoverTimeout = setTimeout(this.checkHover, this.hoverTime)
    let tooltip = this.active
    if (tooltip && !isInTooltip(event.target as HTMLElement) || this.pending) {
      let {pos} = tooltip || this.pending!, end = tooltip?.end ?? pos
      if ((pos == end ? this.view.posAtCoords({x: event.clientX, y: event.clientY}) != pos
           : !isOverRange(this.view, pos, end, event.clientX, event.clientY, Hover.MaxDist))) {
        this.view.dispatch({effects: this.setHover.of(null)})
        this.pending = null
      }
    }
  }

  mouseleave() {
    clearTimeout(this.hoverTimeout)
    this.hoverTimeout = -1
    if (this.active)
      this.view.dispatch({effects: this.setHover.of(null)})
  }

  destroy() {
    clearTimeout(this.hoverTimeout)
    this.view.dom.removeEventListener("mouseleave", this.mouseleave)
    this.view.dom.removeEventListener("mousemove", this.mousemove)
  }
}

function isInTooltip(elt: HTMLElement) {
  for (let cur: Node | null = elt; cur; cur = cur.parentNode)
    if (cur.nodeType == 1 && (cur as HTMLElement).classList.contains("cm-tooltip")) return true
  return false
}

function isOverRange(view: EditorView, from: number, to: number, x: number, y: number, margin: number) {
  let range = document.createRange()
  let fromDOM = view.domAtPos(from), toDOM = view.domAtPos(to)
  range.setEnd(toDOM.node, toDOM.offset)
  range.setStart(fromDOM.node, fromDOM.offset)
  let rects = range.getClientRects()
  range.detach()
  for (let i = 0; i < rects.length; i++) {
    let rect = rects[i]
    let dist = Math.max(rect.top - y, y - rect.bottom, rect.left - x, x - rect.right)
    if (dist <= margin) return true
  }
  return false
}

/// Enable a hover tooltip, which shows up when the pointer hovers
/// over ranges of text. The callback is called when the mouse hovers
/// over the document text. It should, if there is a tooltip
/// associated with position `pos` return the tooltip description
/// (either directly or in a promise). The `side` argument indicates
/// on which side of the position the pointer is—it will be -1 if the
/// pointer is before the position, 1 if after the position.
///
/// Note that all hover tooltips are hosted within a single tooltip
/// container element. This allows multiple tooltips over the same
/// range to be "merged" together without overlapping.
export function hoverTooltip(
  source: (view: EditorView, pos: number, side: -1 | 1) => Tooltip | null | Promise<Tooltip | null>,
  options: {hideOnChange?: boolean} = {}
): Extension {
  const setHover = StateEffect.define<Tooltip | null>()
  const hoverState = StateField.define<Tooltip | null>({
    create() { return null },

    update(value, tr) {
      if (value && (options.hideOnChange && (tr.docChanged || tr.selection))) return null
      for (let effect of tr.effects) if (effect.is(setHover)) return effect.value
      if (value && tr.docChanged) {
        let newPos = tr.changes.mapPos(value.pos, -1, MapMode.TrackDel)
        if (newPos == null) return null
        let copy: Tooltip = Object.assign(Object.create(null), value)
        copy.pos = newPos
        if (value.end != null) copy.end = tr.changes.mapPos(value.end)
        return copy
      }
      return value
    },

    provide: f => showHoverTooltip.from(f)
  })

  let hoverTime: number = (options as any).hoverTime || Hover.Time
  return [
    hoverState,
    ViewPlugin.define(view => new HoverPlugin(view, source, hoverState, setHover, hoverTime)),
    showHoverTooltipHost
  ]
}
