/** A handled failure inside an action handler: the transaction rolls back,
 *  the error is audited with outcome='error', and the message goes to the caller. */
export class ActionError extends Error {
  status: 400 | 403 | 404 | 409 | 501;

  constructor(status: 400 | 403 | 404 | 409 | 501, message: string) {
    super(message);
    this.name = 'ActionError';
    this.status = status;
  }
}
