declare module "cloudflare:test" {
  // ProvidedEnv controls the type of `import("cloudflare:test").env`
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}
