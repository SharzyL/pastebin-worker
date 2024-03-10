let basicConfig = {
  target: "webworker",
  entry: {
    worker: "./src/index.js",
  },
  devtool: "inline-nosources-source-map",
  plugins: [],
  module: {
    rules: [
      { test: /frontend/, type: 'asset/source' },
    ],
  },
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
