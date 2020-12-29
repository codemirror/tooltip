import dts from "rollup-plugin-dts"

export default [{
  input: "./src/tooltip.js",
  external: id => id != "tslib" && !/^(\.?\/|\w:)/.test(id),
  output: {
    format: "esm",
    file: "./dist/index.js",
    externalLiveBindings: false
  }
}, {
  input: "./src/tooltip.d.ts",
  output: {
    format: "esm",
    file: "./dist/index.d.ts",
  },
  plugins: [dts()],
  onwarn(warning, warn) { if (warning.code != "CIRCULAR_DEPENDENCY") warn(warning) }
}]
