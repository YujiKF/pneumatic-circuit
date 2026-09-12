/**
 * Sequence parser: turns a raw PMR3407 sequence string into a canonical
 * {@link SequenceModel}.
 *
 * Responsibilities:
 *  - Accept every documented input dialect: compact "A+B+A-B-",
 *    space-separated "A+ B+ A- B-", semicolon-separated "A+;B+;A-;B-", and
 *    lowercase "a+b+a-b-". All normalize to the SAME canonical model.
 *  - Support the timer prefix 'T' and parenthesized SIMULTANEOUS groups, e.g.
 *    "A+B-T(A-B-)B+".
 *  - Auto-detect the set of actuators.
 *  - Attach an explicit initial state (default: all retracted, overridable via
 *    options) so nothing downstream assumes it silently.
 *  - Reject invalid sequences (A++, AB+, A+X, ++B, unbalanced/empty parens,
 *    dangling timer) with specific, useful messages, returning a Result rather
 *    than throwing.
 *
 * See docs/PMR3407_RULES.md and the Kiro spec requirements for the exact
 * behaviour contract.
 */

import type {
  ActuatorId,
  InitialState,
  Movement,
  RestState,
  Result,
  SequenceModel,
  Step,
} from '../domain/index.ts';
import { defaultInitialState, initialStateFrom, err, ok } from '../domain/index.ts';
import { ParseErrorCode } from './errors.ts';
import { tokenize } from './tokenizer.ts';
import type { Token } from './tokenizer.ts';

export interface ParseOptions {
  /**
   * Explicit initial rest positions per actuator. Any actuator not listed
   * defaults to retracted. When omitted entirely, all detected actuators start
   * retracted (the PMR3407 default).
   */
  readonly initialState?: Readonly<Record<ActuatorId, RestState>>;
}

/**
 * Parse a raw sequence string. Returns ok(SequenceModel) or err(DomainError).
 */
export function parseSequence(
  raw: string,
  options: ParseOptions = {},
): Result<SequenceModel> {
  if (raw.trim().length === 0) {
    return err(
      ParseErrorCode.EMPTY,
      'The sequence is empty. Provide at least one movement, e.g. "A+A-".',
    );
  }

  const tokenized = tokenize(raw);
  if (!tokenized.ok) {
    return tokenized;
  }
  const tokens = tokenized.value;

  const stepsResult = buildSteps(tokens);
  if (!stepsResult.ok) {
    return stepsResult;
  }
  const steps = stepsResult.value;

  if (steps.length === 0) {
    return err(
      ParseErrorCode.EMPTY,
      'The sequence contains no movements. Provide at least one movement, e.g. "A+A-".',
    );
  }

  const actuators = detectActuators(steps);
  const initialState = resolveInitialState(actuators, options);
  const canonical = canonicalize(steps);

  return ok({ steps, actuators, initialState, canonical });
}

/**
 * Consume the token stream into ordered steps. Each element is either a single
 * movement or a parenthesized group of simultaneous movements, optionally
 * preceded by a timer marker.
 */
function buildSteps(tokens: readonly Token[]): Result<Step[]> {
  const steps: Step[] = [];
  let pendingTimer = false;
  let i = 0;

  const finishStep = (movements: Movement[]): void => {
    steps.push({ index: steps.length, movements, hasTimer: pendingTimer });
    pendingTimer = false;
  };

  while (i < tokens.length) {
    const token = tokens[i] as Token;

    if (token.type === 'timer') {
      if (pendingTimer) {
        return err(
          ParseErrorCode.DANGLING_TIMER,
          `Two consecutive timer markers 'T' at position ${token.position}. ` +
            `A timer must precede exactly one movement or group, e.g. "TA+" or "T(A-B-)".`,
          token.position,
        );
      }
      pendingTimer = true;
      i++;
      continue;
    }

    if (token.type === 'lparen') {
      const group = readGroup(tokens, i);
      if (!group.ok) {
        return group;
      }
      finishStep(group.value.movements);
      i = group.value.nextIndex;
      continue;
    }

    if (token.type === 'rparen') {
      return err(
        ParseErrorCode.UNBALANCED_PARENS,
        `Unexpected ')' at position ${token.position} with no matching '('.`,
        token.position,
      );
    }

    if (token.type === 'sign') {
      return err(
        ParseErrorCode.DANGLING_SIGN,
        `Sign '${token.value}' at position ${token.position} is not attached to an actuator. ` +
          `Write the actuator letter before the sign, e.g. "A${token.value}". ` +
          `(Sequences like "${token.value}${token.value}B" are invalid.)`,
        token.position,
      );
    }

    // token.type === 'actuator'
    const mv = readMovement(tokens, i);
    if (!mv.ok) {
      return mv;
    }
    finishStep([mv.value.movement]);
    i = mv.value.nextIndex;
  }

  if (pendingTimer) {
    return err(
      ParseErrorCode.DANGLING_TIMER,
      `A timer marker 'T' at the end of the sequence has no movement to delay. ` +
        `Place 'T' before a movement or group, e.g. "TA+".`,
    );
  }

  return ok(steps);
}

interface MovementRead {
  readonly movement: Movement;
  readonly nextIndex: number;
}

/**
 * Read a single "<actuator><sign>" movement starting at index `start` (which
 * points at an actuator token).
 */
function readMovement(tokens: readonly Token[], start: number): Result<MovementRead> {
  const actuatorToken = tokens[start] as Token;
  const next = tokens[start + 1];

  if (next === undefined || next.type !== 'sign') {
    if (next !== undefined && next.type === 'actuator') {
      return err(
        ParseErrorCode.DOUBLE_ACTUATOR,
        `Actuator '${actuatorToken.value}' at position ${actuatorToken.position} is not ` +
          `followed by a direction. Each movement needs a sign, e.g. "${actuatorToken.value}+". ` +
          `(Sequences like "AB+" are invalid.)`,
        actuatorToken.position,
      );
    }
    return err(
      ParseErrorCode.MISSING_DIRECTION,
      `Actuator '${actuatorToken.value}' at position ${actuatorToken.position} is missing a ` +
        `direction '+' or '-'. Write e.g. "${actuatorToken.value}+" (advance) or ` +
        `"${actuatorToken.value}-" (retract).`,
      actuatorToken.position,
    );
  }

  const after = tokens[start + 2];
  if (after !== undefined && after.type === 'sign') {
    return err(
      ParseErrorCode.DOUBLE_SIGN,
      `Two signs after actuator '${actuatorToken.value}' near position ${after.position}. ` +
        `A movement has exactly one direction, e.g. "${actuatorToken.value}+". ` +
        `(Sequences like "${actuatorToken.value}++" are invalid.)`,
      after.position,
    );
  }

  const direction = next.value === '+' ? '+' : '-';
  return ok({
    movement: { actuator: actuatorToken.value, direction },
    nextIndex: start + 2,
  });
}

interface GroupRead {
  readonly movements: Movement[];
  readonly nextIndex: number;
}

/**
 * Read a parenthesized group of simultaneous movements starting at `start`
 * (which points at '('). Nested groups are rejected.
 */
function readGroup(tokens: readonly Token[], start: number): Result<GroupRead> {
  const open = tokens[start] as Token;
  const movements: Movement[] = [];
  const seen = new Set<string>();
  let i = start + 1;

  while (i < tokens.length) {
    const token = tokens[i] as Token;

    if (token.type === 'rparen') {
      if (movements.length === 0) {
        return err(
          ParseErrorCode.EMPTY_GROUP,
          `Empty group "()" at position ${open.position}. A group must contain at least ` +
            `one movement, e.g. "(A+B+)".`,
          open.position,
        );
      }
      return ok({ movements, nextIndex: i + 1 });
    }

    if (token.type === 'lparen') {
      return err(
        ParseErrorCode.NESTED_GROUP,
        `Nested group '(' at position ${token.position}. Groups of simultaneous movements ` +
          `cannot be nested.`,
        token.position,
      );
    }

    if (token.type === 'timer') {
      return err(
        ParseErrorCode.DANGLING_TIMER,
        `Timer marker 'T' inside a group at position ${token.position}. The timer must ` +
          `precede the whole group, e.g. "T(A-B-)".`,
        token.position,
      );
    }

    if (token.type === 'sign') {
      return err(
        ParseErrorCode.DANGLING_SIGN,
        `Sign '${token.value}' at position ${token.position} is not attached to an actuator ` +
          `inside the group.`,
        token.position,
      );
    }

    // actuator
    const mv = readMovement(tokens, i);
    if (!mv.ok) {
      return mv;
    }
    const key = mv.value.movement.actuator;
    if (seen.has(key)) {
      return err(
        ParseErrorCode.DUPLICATE_IN_GROUP,
        `Actuator '${key}' appears twice in the same simultaneous group near position ` +
          `${token.position}. A cylinder cannot move twice at once.`,
        token.position,
      );
    }
    seen.add(key);
    movements.push(mv.value.movement);
    i = mv.value.nextIndex;
  }

  return err(
    ParseErrorCode.UNBALANCED_PARENS,
    `Unbalanced parentheses: '(' at position ${open.position} is never closed with ')'.`,
    open.position,
  );
}

/** Collect the distinct actuators across all steps, sorted alphabetically. */
function detectActuators(steps: readonly Step[]): ActuatorId[] {
  const set = new Set<ActuatorId>();
  for (const step of steps) {
    for (const mv of step.movements) {
      set.add(mv.actuator);
    }
  }
  return [...set].sort();
}

function resolveInitialState(
  actuators: readonly ActuatorId[],
  options: ParseOptions,
): InitialState {
  if (options.initialState === undefined) {
    return defaultInitialState(actuators);
  }
  return initialStateFrom(actuators, options.initialState);
}

/**
 * Produce the canonical, whitespace-free textual form. Single-movement steps
 * are written "A+"; multi-movement steps are wrapped "(A+B+)"; a timer step is
 * prefixed "T". Movements inside a group are ordered alphabetically by
 * actuator so equivalent inputs canonicalize identically.
 */
export function canonicalize(steps: readonly Step[]): string {
  let out = '';
  for (const step of steps) {
    if (step.hasTimer) {
      out += 'T';
    }
    if (step.movements.length === 1) {
      const mv = step.movements[0] as Movement;
      out += `${mv.actuator}${mv.direction}`;
    } else {
      const ordered = [...step.movements].sort((a, b) =>
        a.actuator < b.actuator ? -1 : a.actuator > b.actuator ? 1 : 0,
      );
      out += '(';
      for (const mv of ordered) {
        out += `${mv.actuator}${mv.direction}`;
      }
      out += ')';
    }
  }
  return out;
}
