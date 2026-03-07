export class ErrorWithTitle extends Error {
  public title: string

  constructor(title: string, msg: string) {
    super(msg)
    this.title = title
  }
}
