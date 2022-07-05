import { WorkerError } from "./common.js";
import conf from '../config.json'

function parseBasicAuth(request) {
  const Authorization = request.headers.get('Authorization');
  console.log(Authorization)

  const [scheme, encoded] = Authorization.split(' ');

  // The Authorization header must start with Basic, followed by a space.
  if (!encoded || scheme !== 'Basic') {
    throw new WorkerError(400, 'malformed authorization header');
  }

  const buffer = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
  const decoded = new TextDecoder().decode(buffer).normalize();

  const index = decoded.indexOf(':');

  if (index === -1 || /[\0-\x1F\x7F]/.test(decoded)) {
    throw WorkerError(400, 'invalid authorization value');
  }

  return {
    user: decoded.substring(0, index),
    pass: decoded.substring(index + 1),
  };
}

export function verifyAuth(request) {
  if ('basicAuth' in conf && conf.basicAuth.enabled === true) {
    if (request.headers.has('Authorization')) {
      const { user, pass } = parseBasicAuth(request)
      const passwdMap = conf.basicAuth.passwd
      if (passwdMap[user] === undefined) {
        throw new WorkerError(401, "user not found for basic auth")
      } else if (passwdMap[user] !== pass) {
        throw new WorkerError(401, "incorrect passwd for basic auth")
      }
    } else {
      return new Response('HTTP basic auth is required', {
        status: 401,
        headers: {
          // Prompts the user for credentials.
          'WWW-Authenticate': 'Basic realm="my scope", charset="UTF-8"',
        },
      });
    }
  }
  return null
}
