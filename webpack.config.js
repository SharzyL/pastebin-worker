let config = {
  target: "webworker",
  entry: {
    worker: "./src/index.js",
  },
  devtool: "inline-nosources-source-map",
}

export default (env, argv) => {
  if (argv && argv.mode === "development") {
    config.devtool = "inline-nosources-source-map"
    config.mode = "development"
  } else {
    config.devtool = false
    config.mode = "production"
  }

  return config
}
