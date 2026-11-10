import { end, event, limit, next, start } from '#diag';
import { HttpError } from '../contract/http-error.ts';
import type { ErrorDetail } from '../contract/types.ts';
import { parseQuery } from '../request/query.ts';
import type { PartValidator } from '../compile/types.ts';
import type { Exchange } from './exchange.ts';

const DETAILS_CAP = 100;
const EMPTY: Readonly<Record<string, never>> = Object.freeze(Object.create(null));

export interface ValidatedParts {
  readonly params: unknown;
  readonly query: unknown;
  readonly headers: unknown;
  readonly body: unknown;
}

interface Failures {
  failed: boolean;
  readonly details: ErrorDetail[];
}

function check(validator: PartValidator | null, raw: unknown, failures: Failures): unknown {
  if (validator === null) {
    return raw;
  }
  const outcome = validator.run(raw);
  if (outcome.kind === 'ok') {
    return outcome.value;
  }
  failures.failed = true;
  failures.details.push(...outcome.details);
  return raw;
}

export function validateRequest(exchange: Exchange, body: unknown): ValidatedParts | HttpError {
  exchange.stage = next(exchange.stage, 'req.validate');
  const { validators } = exchange.route;
  const failures: Failures = { failed: false, details: [] };
  const paramsPart = start('req.validate.part', 'params');
  const params = check(validators.params, exchange.params, failures);
  end(paramsPart);
  const queryPart = start('req.validate.part', 'query');
  const query = validators.query === null ? EMPTY : check(validators.query, parseQuery(exchange.query), failures);
  end(queryPart);
  const headersPart = start('req.validate.part', 'headers');
  const headers = check(validators.headers, exchange.req.headers, failures);
  end(headersPart);
  const bodyPart = start('req.validate.part', 'body');
  const validBody = check(validators.body, body, failures);
  end(bodyPart);
  if (!failures.failed) {
    return { params, query, headers, body: validBody };
  }
  const { details } = failures;
  limit('limit.validation_details', details.length, DETAILS_CAP);
  event('refuse.validation');
  if (details.length > DETAILS_CAP) {
    return new HttpError(400, 'VALIDATION', `Request validation failed; showing the first ${DETAILS_CAP} errors`, {
      details: details.slice(0, DETAILS_CAP),
    });
  }
  return new HttpError(400, 'VALIDATION', 'Request validation failed', { details });
}
