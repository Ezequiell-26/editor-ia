/**
 * Evaluador de expresiones de plantillas `concat-effects`.
 *
 * Port fiel de `vendor/concat/crates/concat-effects/src/expr.rs` (+ el render
 * de slots de `template.rs`) para que el compilador FFmpeg de effect-kit
 * (`ffmpeg.ts`, rama `audio.concatTemplate`) produzca las mismas cadenas que
 * el crate en Rust. La paridad la verifican los `fixtures.toml` del vendor,
 * embebidos en `catalog/concat-audio.ts` como `CONCAT_AUDIO_FIXTURES`.
 *
 * El lenguaje es chico a propósito: números, nombres (parámetros), aritmética,
 * comparación y un set fijo de funciones. Los valores distinguen entero de
 * real porque el formato importa: `round` produce `12`, no `12.0`, y
 * `fixed(x, n)` produce texto con exactamente `n` decimales.
 */

export type ConcatValue =
  | { readonly kind: 'int'; readonly n: number }
  | { readonly kind: 'float'; readonly n: number }
  | { readonly kind: 'text'; readonly s: string };

const int = (n: number): ConcatValue => ({ kind: 'int', n });
const float = (n: number): ConcatValue => ({ kind: 'float', n });
const text = (s: string): ConcatValue => ({ kind: 'text', s });

function asNumber(value: ConcatValue, what: string): number {
  if (value.kind === 'text') {
    throw new Error(`${what}: text where a number was needed`);
  }
  return value.n;
}

/**
 * `f64` como lo imprime Rust (`Display`): decimal siempre, sin notación
 * científica, con la representación más corta que ida y vuelta. JS ya da la
 * parte corta; sólo hay que expandir cuando cae en notación exponencial.
 */
export function formatConcatFloat(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'inf';
  if (value === -Infinity) return '-inf';
  if (value === 0) return Object.is(value, -0) ? '-0' : '0';
  const plain = String(value);
  if (!plain.includes('e') && !plain.includes('E')) return plain === '-0' ? '0' : plain;
  // Expande notación exponencial a decimal.
  const [mantissa, exponentText] = plain.split(/[eE]/);
  const exponent = Number(exponentText);
  const negative = (mantissa ?? '').startsWith('-');
  const digits = (mantissa ?? '').replace('-', '').replace('.', '');
  const point = (mantissa ?? '').replace('-', '').indexOf('.');
  const intDigits = point === -1 ? digits.length : point;
  const newPoint = intDigits + exponent;
  let out: string;
  if (newPoint <= 0) {
    out = `0.${'0'.repeat(-newPoint)}${digits}`;
  } else if (newPoint >= digits.length) {
    out = `${digits}${'0'.repeat(newPoint - digits.length)}`;
  } else {
    out = `${digits.slice(0, newPoint)}.${digits.slice(newPoint)}`;
  }
  // Recorta ceros finales del lado decimal sin dejar el punto colgando
  // (sólo si hay punto: un entero como "100" no se toca).
  if (out.includes('.')) out = out.replace(/0+$/, '').replace(/\.$/, '');
  return `${negative ? '-' : ''}${out}`;
}

function printValue(value: ConcatValue): string {
  switch (value.kind) {
    case 'int':
      return String(Math.trunc(value.n));
    case 'float':
      return formatConcatFloat(value.n);
    case 'text':
      return value.s;
  }
}

// ─── parsing ────────────────────────────────────────────────────────────────

type Token =
  | { readonly t: 'number'; readonly n: number }
  | { readonly t: 'ident'; readonly name: string }
  | { readonly t: 'op'; readonly op: 'add' | 'sub' | 'mul' | 'div' | 'lt' | 'gt' | 'le' | 'ge' | 'eq' | 'ne' }
  | { readonly t: 'plus' | 'minus' | 'star' | 'slash' | 'lparen' | 'rparen' | 'comma' };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i] ?? '';
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const start = i;
      while (i < source.length && /[0-9.]/.test(source[i] ?? '')) i += 1;
      const text = source.slice(start, i);
      const n = Number(text);
      if (!Number.isFinite(n)) throw new Error(`bad number \`${text}\``);
      tokens.push({ t: 'number', n });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i] ?? '')) i += 1;
      tokens.push({ t: 'ident', name: source.slice(start, i) });
      continue;
    }
    switch (c) {
      case '+': tokens.push({ t: 'plus' }); i += 1; continue;
      case '-': tokens.push({ t: 'minus' }); i += 1; continue;
      case '*': tokens.push({ t: 'star' }); i += 1; continue;
      case '/': tokens.push({ t: 'slash' }); i += 1; continue;
      case '(': tokens.push({ t: 'lparen' }); i += 1; continue;
      case ')': tokens.push({ t: 'rparen' }); i += 1; continue;
      case ',': tokens.push({ t: 'comma' }); i += 1; continue;
      case '<':
      case '>':
      case '=':
      case '!': {
        const next = source[i + 1];
        const two = `${c}${next ?? ''}`;
        if (two === '<=' || two === '>=' || two === '==' || two === '!=') {
          const op = two === '<=' ? 'le' : two === '>=' ? 'ge' : two === '==' ? 'eq' : 'ne';
          tokens.push({ t: 'op', op: op as 'le' | 'ge' | 'eq' | 'ne' });
          i += 2;
          continue;
        }
        if (c === '<') {
          tokens.push({ t: 'op', op: 'lt' });
          i += 1;
          continue;
        }
        if (c === '>') {
          tokens.push({ t: 'op', op: 'gt' });
          i += 1;
          continue;
        }
        throw new Error(`unexpected \`${c}\``);
      }
      default:
        throw new Error(`unexpected \`${c}\``);
    }
  }
  return tokens;
}

type Expr =
  | { readonly k: 'num'; readonly n: number }
  | { readonly k: 'name'; readonly name: string }
  | { readonly k: 'neg'; readonly inner: Expr }
  | { readonly k: 'bin'; readonly op: TokenOp; readonly l: Expr; readonly r: Expr }
  | { readonly k: 'call'; readonly name: string; readonly args: readonly Expr[] };

type TokenOp = 'add' | 'sub' | 'mul' | 'div' | 'lt' | 'gt' | 'le' | 'ge' | 'eq' | 'ne';

const FUNCTIONS: Readonly<Record<string, number>> = {
  if: 3,
  clamp: 3,
  min: 2,
  max: 2,
  abs: 1,
  floor: 1,
  ceil: 1,
  round: 1,
  sqrt: 1,
  pow: 2,
  fixed: 2,
};

class Parser {
  private at = 0;
  constructor(private readonly tokens: readonly Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.at];
  }

  private next(): Token | undefined {
    const token = this.tokens[this.at];
    this.at += 1;
    return token;
  }

  private expect(kind: Token['t']): void {
    const token = this.next();
    if (!token || token.t !== kind) {
      throw new Error(`expected ${kind}, found ${token ? JSON.stringify(token) : 'the end'}`);
    }
  }

  comparison(): Expr {
    const left = this.sum();
    const token = this.peek();
    if (token?.t === 'op') {
      this.next();
      const right = this.sum();
      return { k: 'bin', op: token.op, l: left, r: right };
    }
    return left;
  }

  private sum(): Expr {
    let left = this.term();
    for (;;) {
      const token = this.peek();
      if (token?.t === 'plus') {
        this.next();
        left = { k: 'bin', op: 'add', l: left, r: this.term() };
        continue;
      }
      if (token?.t === 'minus') {
        this.next();
        left = { k: 'bin', op: 'sub', l: left, r: this.term() };
        continue;
      }
      return left;
    }
  }

  private term(): Expr {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      if (token?.t === 'star') {
        this.next();
        left = { k: 'bin', op: 'mul', l: left, r: this.unary() };
        continue;
      }
      if (token?.t === 'slash') {
        this.next();
        left = { k: 'bin', op: 'div', l: left, r: this.unary() };
        continue;
      }
      return left;
    }
  }

  private unary(): Expr {
    if (this.peek()?.t === 'minus') {
      this.next();
      return { k: 'neg', inner: this.unary() };
    }
    return this.atom();
  }

  /** True cuando se consumieron todos los tokens (sin input colgante). */
  done(): boolean {
    return this.at === this.tokens.length;
  }

  private atom(): Expr {
    const token = this.next();
    if (!token) throw new Error('unexpected end of expression');
    switch (token.t) {
      case 'number':
        return { k: 'num', n: token.n };
      case 'ident': {
        if (this.peek()?.t === 'lparen') {
          this.next();
          const args: Expr[] = [];
          if (this.peek()?.t === 'rparen') {
            this.next();
          } else {
            for (;;) {
              args.push(this.comparison());
              const sep = this.next();
              if (sep?.t === 'comma') continue;
              if (sep?.t === 'rparen') break;
              throw new Error(`expected ',' or ')' in call to ${token.name}`);
            }
          }
          const arity = FUNCTIONS[token.name];
          if (arity === undefined) throw new Error(`unknown function \`${token.name}\``);
          if (args.length !== arity) {
            throw new Error(`${token.name} takes ${arity} argument(s), given ${args.length}`);
          }
          return { k: 'call', name: token.name, args };
        }
        return { k: 'name', name: token.name };
      }
      case 'lparen': {
        const inner = this.comparison();
        this.expect('rparen');
        return inner;
      }
      default:
        throw new Error(`unexpected token`);
    }
  }
}

export function parseConcatExpr(source: string): Expr {
  const parser = new Parser(tokenize(source));
  const expr = parser.comparison();
  if (!parser.done()) throw new Error(`trailing input in \`${source}\``);
  return expr;
}

function binary(op: TokenOp, left: ConcatValue, right: ConcatValue): ConcatValue {
  if (left.kind === 'int' && right.kind === 'int') {
    const a = left.n;
    const b = right.n;
    switch (op) {
      case 'add': return int(a + b);
      case 'sub': return int(a - b);
      case 'mul': return int(a * b);
      case 'div': return float(a / b);
      case 'lt': return int(a < b ? 1 : 0);
      case 'gt': return int(a > b ? 1 : 0);
      case 'le': return int(a <= b ? 1 : 0);
      case 'ge': return int(a >= b ? 1 : 0);
      case 'eq': return int(a === b ? 1 : 0);
      case 'ne': return int(a !== b ? 1 : 0);
    }
  }
  const a = asNumber(left, 'operator');
  const b = asNumber(right, 'operator');
  switch (op) {
    case 'add': return float(a + b);
    case 'sub': return float(a - b);
    case 'mul': return float(a * b);
    case 'div': return float(a / b);
    case 'lt': return int(a < b ? 1 : 0);
    case 'gt': return int(a > b ? 1 : 0);
    case 'le': return int(a <= b ? 1 : 0);
    case 'ge': return int(a >= b ? 1 : 0);
    case 'eq': return int(a === b ? 1 : 0);
    case 'ne': return int(a !== b ? 1 : 0);
  }
}

function truthy(value: ConcatValue): boolean {
  return asNumber(value, 'if') !== 0;
}

/** `value` con exactamente `digits` decimales; -0 se imprime sin signo. */
export function concatFixed(value: number, digits: number): string {
  const v = value === 0 ? 0 : value;
  return v.toFixed(digits);
}

function call(name: string, args: readonly ConcatValue[]): ConcatValue {
  const num = (i: number) => asNumber(args[i] as ConcatValue, name);
  switch (name) {
    case 'if':
      return truthy(args[0] as ConcatValue) ? (args[1] as ConcatValue) : (args[2] as ConcatValue);
    case 'clamp': {
      const [x, lo, hi] = args as [ConcatValue, ConcatValue, ConcatValue];
      if (x.kind === 'int' && lo.kind === 'int' && hi.kind === 'int' && lo.n <= hi.n) {
        return int(Math.min(hi.n, Math.max(lo.n, x.n)));
      }
      const loN = num(1);
      const hiN = num(2);
      if (Number.isNaN(loN) || Number.isNaN(hiN) || loN > hiN) {
        throw new Error(`clamp: the bounds ${loN} and ${hiN} are crossed`);
      }
      return float(Math.min(hiN, Math.max(loN, num(0))));
    }
    case 'min': {
      const [a, b] = args as [ConcatValue, ConcatValue];
      return a.kind === 'int' && b.kind === 'int' ? int(Math.min(a.n, b.n)) : float(Math.min(num(0), num(1)));
    }
    case 'max': {
      const [a, b] = args as [ConcatValue, ConcatValue];
      return a.kind === 'int' && b.kind === 'int' ? int(Math.max(a.n, b.n)) : float(Math.max(num(0), num(1)));
    }
    case 'abs': {
      const a = args[0] as ConcatValue;
      return a.kind === 'int' ? int(Math.abs(a.n)) : float(Math.abs(num(0)));
    }
    case 'floor': return int(Math.floor(num(0)));
    case 'ceil': return int(Math.ceil(num(0)));
    case 'round': return int(Math.round(num(0)));
    case 'sqrt': return float(Math.sqrt(num(0)));
    case 'pow': return float(Math.pow(num(0), num(1)));
    case 'fixed': {
      const digits = num(1);
      if (digits < 0 || digits % 1 !== 0 || digits > 20) {
        throw new Error(`fixed: ${digits} is not a digit count`);
      }
      return text(concatFixed(num(0), digits));
    }
    default:
      throw new Error(`unknown function \`${name}\``);
  }
}

export function evalConcatExpr(expr: Expr, env: Readonly<Record<string, ConcatValue>>): ConcatValue {
  switch (expr.k) {
    case 'num':
      return float(expr.n);
    case 'name': {
      const value = env[expr.name];
      if (value === undefined) throw new Error(`unknown name \`${expr.name}\``);
      return value;
    }
    case 'neg': {
      const inner = evalConcatExpr(expr.inner, env);
      if (inner.kind === 'text') throw new Error('cannot negate text');
      return inner.kind === 'int' ? int(-inner.n) : float(-inner.n);
    }
    case 'bin':
      return binary(expr.op, evalConcatExpr(expr.l, env), evalConcatExpr(expr.r, env));
    case 'call':
      return call(expr.name, expr.args.map((arg) => evalConcatExpr(arg, env)));
  }
}

// ─── template: texto literal con slots `{expresión}` ────────────────────────

/**
 * Renderiza una cadena-template concat: `{{` y `}}` son llaves literales,
 * `{expr}` se evalúa contra `env` (números → `Value::Float`, igual que
 * `Package::resolve` en Rust). Devuelve `null` si la plantilla o alguna
 * expresión no parsea/evalúa — el llamador decide si eso es "preview-only".
 */
export function renderConcatTemplate(
  template: string,
  env: Readonly<Record<string, number>>,
): string | null {
  const values: Record<string, ConcatValue> = {};
  for (const [key, value] of Object.entries(env)) {
    values[key] = Number.isInteger(value) ? int(value) : float(value);
  }
  let out = '';
  let rest = template;
  while (rest.length > 0) {
    if (rest.startsWith('{{')) {
      out += '{';
      rest = rest.slice(2);
      continue;
    }
    if (rest.startsWith('}}')) {
      out += '}';
      rest = rest.slice(2);
      continue;
    }
    if (rest.startsWith('}')) return null; // stray `}`
    if (rest.startsWith('{')) {
      const close = rest.indexOf('}', 1);
      if (close === -1) return null; // unclosed `{`
      const slot = rest.slice(1, close);
      try {
        const expr = parseConcatExpr(slot);
        out += printValue(evalConcatExpr(expr, values));
      } catch {
        return null;
      }
      rest = rest.slice(close + 1);
      continue;
    }
    // Literal: hasta el próximo '{' o '}'.
    const next = rest.search(/[{]/);
    const stray = rest.indexOf('}');
    const cut = next === -1 ? (stray === -1 ? rest.length : stray) : stray !== -1 && stray < next ? stray : next;
    out += rest.slice(0, cut);
    rest = rest.slice(cut);
  }
  return out;
}
