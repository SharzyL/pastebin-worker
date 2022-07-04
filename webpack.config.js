let basicConfig = {
  target: "webworker",
  entry: {
    worker: "./src/index.js",
  },
  devtool: "inline-nosources-source-map",
  plugins: []
}

export default (env, argv) => {
  if (argv && argv.mode === "development") {
    basicConfig.devtool = "inline-nosources-source-map"
    basicConfig.mode = "development"
  } else {
    basicConfig.devtool = false
    basicConfig.mode = "production"
  }

  return basicConfig
}
