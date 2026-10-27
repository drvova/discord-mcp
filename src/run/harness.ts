import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import vm from "node:vm";
import * as acorn from "acorn";

// A single long-lived JavaScript namespace that the `run` tool executes code
// in. Top-level declarations become namespace globals, so a helper defined in
// one call is callable in the next. Pure top-level definitions (functions,
// classes, constants) are also written to disk and reloaded at startup, so the
// model's own tooling survives restarts without replaying any side effects.

export type KeptKind = "function" | "class" | "const";

export type KeptDefinition = {
    name: string;
    kind: KeptKind;
    source: string;
};

export type KeptEntry = {
    name: string;
    kind: KeptKind;
    loaded: boolean;
    error?: string;
};

export type RunResult = {
    ok: boolean;
    text: string;
    output: string;
    value?: unknown;
    error?: string;
    kept: string[];
};

export type DescribeHooks = {
    // Live, domain-specific state to show for an object (e.g. a client's
    // readiness and guilds). Return undefined when it does not apply.
    capabilities?: (value: object) => Record<string, unknown> | undefined;
    // A one-line doc for `owner#member` when the function source has none.
    memberDoc?: (owner: string, member: string) => string | undefined;
    // Overrides what is reported for a function whose source says nothing
    // useful (e.g. a wrapper around a remote tool): at least its signature.
    functionInfo?: (
        fn: Function,
    ) => ({ signature: string; doc?: string } & Record<string, unknown>) | undefined;
};

export type CodeHarnessOptions = {
    persistDir?: string;
    builtins?: Record<string, unknown>;
    manual?: () => string;
    describe?: DescribeHooks;
    timeoutMs?: number;
    onLoadError?: (name: string, error: unknown) => void;
};

type AnyNode = acorn.Node & Record<string, any>;

type Transformed = {
    script: string;
    declared: string[];
    definitions: KeptDefinition[];
};

const KEPT_EXTENSION = ".js";
const MAX_TEXT_LENGTH = 100_000;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function defaultPersistDir(): string {
    if (process.env.DISCORD_MCP_KEPT_DIR) {
        return resolve(process.env.DISCORD_MCP_KEPT_DIR);
    }
    const configHome =
        process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
    return join(configHome, "discord-mcp", "kept");
}

function parseProgram(code: string): AnyNode {
    return acorn.parse(code, {
        ecmaVersion: "latest",
        sourceType: "script",
        allowAwaitOutsideFunction: true,
        allowReturnOutsideFunction: true,
    }) as AnyNode;
}

function collectPatternNames(pattern: AnyNode, names: string[]): void {
    switch (pattern.type) {
        case "Identifier":
            names.push(pattern.name);
            return;
        case "ObjectPattern":
            for (const property of pattern.properties) {
                collectPatternNames(
                    property.type === "RestElement"
                        ? property.argument
                        : property.value,
                    names,
                );
            }
            return;
        case "ArrayPattern":
            for (const element of pattern.elements) {
                if (element) {
                    collectPatternNames(element, names);
                }
            }
            return;
        case "RestElement":
            collectPatternNames(pattern.argument, names);
            return;
        case "AssignmentPattern":
            collectPatternNames(pattern.left, names);
            return;
    }
}

// A constant initializer is kept only when evaluating it cannot do work:
// literals, functions, classes, and plain object/array shapes of those.
function isPureInitializer(node: AnyNode | null | undefined): boolean {
    if (!node) {
        return false;
    }
    switch (node.type) {
        case "Literal":
        case "ArrowFunctionExpression":
        case "FunctionExpression":
        case "ClassExpression":
            return true;
        case "Identifier":
            return node.name === "undefined";
        case "TemplateLiteral":
            return node.expressions.every(isPureInitializer);
        case "ArrayExpression":
            return node.elements.every(
                (element: AnyNode | null) =>
                    element === null ||
                    isPureInitializer(
                        element.type === "SpreadElement"
                            ? element.argument
                            : element,
                    ),
            );
        case "ObjectExpression":
            return node.properties.every((property: AnyNode) =>
                property.type === "SpreadElement"
                    ? isPureInitializer(property.argument)
                    : (!property.computed || isPureInitializer(property.key)) &&
                      isPureInitializer(property.value),
            );
        case "UnaryExpression":
            return node.operator !== "delete" && isPureInitializer(node.argument);
        case "BinaryExpression":
        case "LogicalExpression":
            return isPureInitializer(node.left) && isPureInitializer(node.right);
        case "ConditionalExpression":
            return (
                isPureInitializer(node.test) &&
                isPureInitializer(node.consequent) &&
                isPureInitializer(node.alternate)
            );
        default:
            return false;
    }
}

// Rewrites top-level declarations into namespace-global assignments and wraps
// the code in an async function so `await` works and the last expression
// statement becomes the call's value.
export function transformCode(
    code: string,
    options: { sync?: boolean } = {},
): Transformed {
    const program = parseProgram(code);
    const slice = (node: AnyNode) => code.slice(node.start, node.end);
    const declared: string[] = [];
    const definitions: KeptDefinition[] = [];
    const prefix: string[] = [];
    const body: AnyNode[] = program.body;
    let output = "";
    let cursor = 0;

    body.forEach((node, index) => {
        let replacement: string | undefined;

        if (node.type === "FunctionDeclaration") {
            // Left in place so hoisting and line numbers are untouched; the
            // prefix publishes the hoisted binding to the namespace.
            const name = node.id.name;
            declared.push(name);
            prefix.push(`globalThis[${JSON.stringify(name)}] = ${name};`);
            definitions.push({ name, kind: "function", source: slice(node) });
        } else if (node.type === "ClassDeclaration") {
            const name = node.id.name;
            declared.push(name);
            replacement = `${name} = ${slice(node)};`;
            definitions.push({ name, kind: "class", source: slice(node) });
        } else if (node.type === "VariableDeclaration") {
            const parts: string[] = [];
            for (const declarator of node.declarations) {
                if (declarator.id.type === "Identifier") {
                    const name = declarator.id.name;
                    declared.push(name);
                    if (declarator.init) {
                        parts.push(`${name} = ${slice(declarator.init)};`);
                        if (
                            node.kind === "const" &&
                            isPureInitializer(declarator.init)
                        ) {
                            definitions.push({
                                name,
                                kind: "const",
                                source: `const ${name} = ${slice(declarator.init)};`,
                            });
                        }
                    } else if (node.kind !== "var") {
                        parts.push(`${name} = undefined;`);
                    }
                } else {
                    collectPatternNames(declarator.id, declared);
                    parts.push(
                        `(${slice(declarator.id)} = ${slice(declarator.init)});`,
                    );
                }
            }
            replacement = parts.join(" ");
        } else if (
            index === body.length - 1 &&
            node.type === "ExpressionStatement"
        ) {
            replacement = `return (${slice(node.expression)});`;
        }

        if (replacement !== undefined) {
            output += code.slice(cursor, node.start) + replacement;
            cursor = node.end;
        }
    });
    output += code.slice(cursor);

    return {
        script: `(${options.sync ? "" : "async "}() => { ${prefix.join(" ")}\n${output}\n})()`,
        declared,
        definitions,
    };
}

function formatValue(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }
    return inspect(value, {
        depth: 4,
        maxArrayLength: 200,
        maxStringLength: 20_000,
        breakLength: 100,
    });
}

function truncate(text: string): string {
    if (text.length <= MAX_TEXT_LENGTH) {
        return text;
    }
    return `${text.slice(0, MAX_TEXT_LENGTH)}\n... [truncated ${text.length - MAX_TEXT_LENGTH} chars]`;
}

function formatError(error: unknown): string {
    if (!(error instanceof Error) && !(error && typeof error === "object" && "stack" in error)) {
        return `Error: ${formatValue(error)}`;
    }
    const stack = String((error as Error).stack || (error as Error).message);
    const lines = stack.split("\n");
    const userFrames = lines
        .slice(1)
        .filter((line) => line.includes("run.js") || line.includes("kept:"));
    return [lines[0], ...userFrames].join("\n");
}

function extractParams(source: string): string {
    const trimmed = source.trimStart();
    const arrowIndex = trimmed.indexOf("=>");
    const parenIndex = trimmed.indexOf("(");
    if (arrowIndex !== -1 && (parenIndex === -1 || arrowIndex < parenIndex)) {
        return trimmed.slice(0, arrowIndex).replace(/^async\s+/, "").trim();
    }
    if (parenIndex === -1) {
        return "";
    }
    let depth = 0;
    for (let index = parenIndex; index < trimmed.length; index += 1) {
        const char = trimmed[index];
        if (char === "(") {
            depth += 1;
        } else if (char === ")") {
            depth -= 1;
            if (depth === 0) {
                return trimmed
                    .slice(parenIndex + 1, index)
                    .replace(/\s+/g, " ")
                    .trim();
            }
        }
    }
    return "";
}

function functionSource(fn: Function): string {
    try {
        return Function.prototype.toString.call(fn);
    } catch {
        return "";
    }
}

function signatureOf(name: string, fn: Function): string {
    const source = functionSource(fn);
    if (source.includes("[native code]")) {
        const params = Array.from({ length: fn.length }, (_, i) => `arg${i}`);
        return `${name}(${params.join(", ")})`;
    }
    const isAsync = /^async[\s(]/.test(source);
    return `${isAsync ? "async " : ""}${name}(${extractParams(source)})`;
}

// The first line of a leading comment inside the function body, if any.
function inlineDocOf(fn: Function): string | undefined {
    const source = functionSource(fn);
    const bodyStart = source.indexOf("{");
    if (bodyStart === -1) {
        return undefined;
    }
    const match = source
        .slice(bodyStart + 1)
        .match(/^\s*(?:\/\*\*?([\s\S]*?)\*\/|\/\/([^\n]*))/);
    if (!match) {
        return undefined;
    }
    const text = (match[1] ?? match[2] ?? "")
        .split("\n")
        .map((line) => line.replace(/^\s*\*?\s?/, "").trim())
        .find((line) => line.length > 0);
    return text || undefined;
}

function typeLabel(value: unknown): string {
    if (value === null) {
        return "null";
    }
    if (typeof value === "function") {
        return "function";
    }
    if (typeof value === "object") {
        const name = (value as object).constructor?.name;
        if (value instanceof Map || (value && "size" in (value as object) && typeof (value as Map<unknown, unknown>).size === "number")) {
            return `${name || "Map"}(${(value as Map<unknown, unknown>).size})`;
        }
        if (Array.isArray(value)) {
            return `Array(${value.length})`;
        }
        return name || "object";
    }
    return typeof value;
}

type MemberDescription = {
    name: string;
    kind: "method" | "getter" | "property";
    signature?: string;
    type?: string;
    from?: string;
    doc?: string;
};

// Object.prototype or Function.prototype of any realm (the namespace runs in
// its own realm, so identity checks against this realm's are not enough).
function isRootPrototype(level: object): boolean {
    if (Object.getPrototypeOf(level) === null) {
        return true;
    }
    return (
        typeof level === "function" &&
        Object.prototype.hasOwnProperty.call(level, "call") &&
        Object.prototype.hasOwnProperty.call(level, "apply")
    );
}

function withoutUndefined<T extends object>(value: T): T {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined),
    ) as T;
}

function describeMembers(
    target: object,
    hooks: DescribeHooks | undefined,
): MemberDescription[] {
    const members: MemberDescription[] = [];
    const seen = new Set<string>(["constructor"]);
    let level: object | null = target;

    while (level && !isRootPrototype(level)) {
        const owner =
            level === target && typeof target !== "function"
                ? (target as object).constructor?.name
                : typeof level === "function"
                  ? (level as Function).name
                  : (level as { constructor?: Function }).constructor?.name;

        for (const name of Object.getOwnPropertyNames(level)) {
            if (seen.has(name) || name.startsWith("_") || name.startsWith("#")) {
                continue;
            }
            if (typeof level === "function" && ["length", "name", "prototype", "arguments", "caller"].includes(name)) {
                continue;
            }
            seen.add(name);
            const descriptor = Object.getOwnPropertyDescriptor(level, name);
            if (!descriptor) {
                continue;
            }
            const doc = (fn?: Function) =>
                (fn && inlineDocOf(fn)) ||
                (owner ? hooks?.memberDoc?.(owner, name) : undefined);

            if (descriptor.get || descriptor.set) {
                members.push({
                    name,
                    kind: "getter",
                    from: owner,
                    doc: doc(),
                });
            } else if (typeof descriptor.value === "function") {
                const info = hooks?.functionInfo?.(descriptor.value);
                members.push({
                    name,
                    kind: "method",
                    signature: info?.signature ?? signatureOf(name, descriptor.value),
                    from: owner,
                    doc: info ? info.doc : doc(descriptor.value),
                });
            } else {
                members.push({
                    name,
                    kind: "property",
                    type: typeLabel(descriptor.value),
                    from: owner,
                    doc: doc(),
                });
            }
        }
        level = Object.getPrototypeOf(level);
    }

    return members.map(withoutUndefined);
}

// Introspects any value: a function's signature and doc, a class's static and
// instance members, an object's members across its prototype chain plus any
// live capabilities the domain reports for it.
export function describeValue(value: unknown, hooks?: DescribeHooks): unknown {
    if (value === null || value === undefined || (typeof value !== "object" && typeof value !== "function")) {
        return { type: value === null ? "null" : typeof value, value };
    }

    if (typeof value === "function") {
        const fn = value as Function;
        const source = functionSource(fn);
        if (/^class[\s{]/.test(source)) {
            const constructorMatch = source.match(/constructor\s*\(([^)]*)\)/);
            return withoutUndefined({
                type: "class",
                name: fn.name,
                extends: Object.getPrototypeOf(fn)?.name || undefined,
                constructor: `new ${fn.name}(${constructorMatch ? constructorMatch[1].replace(/\s+/g, " ").trim() : ""})`,
                doc: hooks?.memberDoc?.(fn.name, "constructor"),
                static: describeMembers(fn, hooks),
                instance: fn.prototype
                    ? describeMembers(fn.prototype, hooks)
                    : [],
            });
        }
        const info = hooks?.functionInfo?.(fn);
        if (info) {
            return withoutUndefined({ type: "function", ...info });
        }
        return withoutUndefined({
            type: "function",
            signature: signatureOf(fn.name || "anonymous", fn),
            doc: inlineDocOf(fn),
            ...(Object.keys(fn).length > 0
                ? { members: describeMembers(fn, hooks) }
                : {}),
        });
    }

    const capabilities = hooks?.capabilities?.(value);
    return {
        type: typeLabel(value),
        ...(capabilities ? { capabilities } : {}),
        members: describeMembers(value, hooks),
    };
}

export class CodeHarness {
    readonly persistDir: string;
    private readonly context: vm.Context;
    private readonly builtinNames = new Set<string>();
    private readonly keptStatus = new Map<string, KeptEntry>();
    private readonly manual: () => string;
    private readonly describeHooks?: DescribeHooks;
    private readonly timeoutMs: number;
    private output: string[] = [];

    constructor(options: CodeHarnessOptions = {}) {
        this.persistDir = resolve(options.persistDir || defaultPersistDir());
        this.manual = options.manual || (() => "");
        this.describeHooks = options.describe;
        this.timeoutMs = options.timeoutMs ?? 60_000;
        this.context = vm.createContext({});

        const print = (...args: unknown[]) => {
            this.output.push(args.map(formatValue).join(" "));
        };
        const consoleProxy = {
            log: print,
            info: print,
            debug: print,
            warn: print,
            error: print,
            dir: (value: unknown) => print(value),
            table: (value: unknown) => print(value),
        };

        this.defineBuiltins({
            console: consoleProxy,
            print,
            setTimeout,
            clearTimeout,
            setInterval,
            clearInterval,
            setImmediate,
            clearImmediate,
            queueMicrotask,
            structuredClone,
            fetch,
            URL,
            URLSearchParams,
            Buffer,
            TextEncoder,
            TextDecoder,
            AbortController,
            process,
            require: createRequire(import.meta.url),
            sleep: (ms: number) =>
                new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
            vars: Object.freeze({}),
            describe: (value: unknown) => describeValue(value, this.describeHooks),
            kept: (name?: string) => this.kept(name),
            forget: (name: string) => this.forget(name),
            man: () => this.manual(),
        });
        this.defineBuiltins(options.builtins || {});
        this.loadKept(options.onLoadError);
    }

    defineBuiltins(builtins: Record<string, unknown>): void {
        for (const [name, value] of Object.entries(builtins)) {
            this.builtinNames.add(name);
            this.context[name] = value;
        }
    }

    // Rebinds a builtin's value (e.g. the working object for this call).
    setBuiltin(name: string, value: unknown): void {
        this.builtinNames.add(name);
        this.context[name] = value;
    }

    getGlobal(name: string): unknown {
        return this.context[name];
    }

    builtins(): string[] {
        return Array.from(this.builtinNames).sort();
    }

    async run(
        code: string,
        options: { vars?: Record<string, string> } = {},
    ): Promise<RunResult> {
        if (!code.trim()) {
            const text = this.manual();
            return { ok: true, text, output: "", value: text, kept: [] };
        }

        this.context.vars = Object.freeze({ ...(options.vars || {}) });
        this.output = [];

        let transformed: Transformed;
        try {
            transformed = transformCode(code);
            const clashes = transformed.declared.filter((name) =>
                this.builtinNames.has(name),
            );
            if (clashes.length > 0) {
                throw new Error(
                    `Cannot redefine built-in name(s): ${clashes.join(", ")}. Pick another name.`,
                );
            }
        } catch (error) {
            const message = formatError(error);
            return { ok: false, text: message, output: "", error: message, kept: [] };
        }

        try {
            const value = await this.evaluate(transformed.script, "run.js");
            const keptNames = this.persist(transformed);
            const output = this.output.join("\n");
            const parts = [output, value === undefined ? "" : formatValue(value)]
                .filter((part) => part.length > 0);
            if (keptNames.length > 0) {
                parts.push(`[kept: ${keptNames.join(", ")}]`);
            }
            return {
                ok: true,
                text: truncate(parts.join("\n") || "(no output)"),
                output,
                value,
                kept: keptNames,
            };
        } catch (error) {
            const message = formatError(error);
            const output = this.output.join("\n");
            return {
                ok: false,
                text: truncate([output, message].filter(Boolean).join("\n")),
                output,
                error: message,
                kept: [],
            };
        }
    }

    kept(name?: string): KeptEntry[] | string | undefined {
        if (name !== undefined) {
            const file = this.keptFile(name);
            return file && existsSync(file) ? readFileSync(file, "utf8") : undefined;
        }
        return Array.from(this.keptStatus.values()).sort((a, b) =>
            a.name.localeCompare(b.name),
        );
    }

    forget(name: string): boolean {
        const file = this.keptFile(name);
        const existed = !!file && existsSync(file);
        if (file && existed) {
            rmSync(file);
        }
        this.keptStatus.delete(name);
        if (!this.builtinNames.has(name) && name in this.context) {
            vm.runInContext(
                `delete globalThis[${JSON.stringify(name)}]`,
                this.context,
            );
            return true;
        }
        return existed;
    }

    private async evaluate(script: string, filename: string): Promise<unknown> {
        const compiled = new vm.Script(script, {
            filename,
            lineOffset: -1,
            importModuleDynamically:
                vm.constants?.USE_MAIN_CONTEXT_DEFAULT_LOADER as never,
        });
        return await compiled.runInContext(this.context, {
            timeout: this.timeoutMs,
        });
    }

    private keptFile(name: string): string | undefined {
        if (!IDENTIFIER_PATTERN.test(name)) {
            return undefined;
        }
        return join(this.persistDir, `${name}${KEPT_EXTENSION}`);
    }

    // Saves each top-level definition as its own unit and drops units whose
    // name was rebound by a declaration that is not a keepable definition.
    private persist(transformed: Transformed): string[] {
        const keptNames: string[] = [];
        const defined = new Set(transformed.definitions.map((d) => d.name));

        for (const definition of transformed.definitions) {
            const file = this.keptFile(definition.name);
            if (!file) {
                continue;
            }
            mkdirSync(this.persistDir, { recursive: true });
            const temporary = `${file}.tmp`;
            writeFileSync(temporary, `${definition.source}\n`, "utf8");
            renameSync(temporary, file);
            this.keptStatus.set(definition.name, {
                name: definition.name,
                kind: definition.kind,
                loaded: true,
            });
            keptNames.push(definition.name);
        }

        for (const name of transformed.declared) {
            if (!defined.has(name) && this.keptStatus.has(name)) {
                const file = this.keptFile(name);
                if (file && existsSync(file)) {
                    rmSync(file);
                }
                this.keptStatus.delete(name);
            }
        }

        return keptNames;
    }

    // Loads each saved unit in isolation: a broken one is reported by kept()
    // and never prevents the rest (or the server) from starting.
    private loadKept(onLoadError?: (name: string, error: unknown) => void): void {
        if (!existsSync(this.persistDir)) {
            return;
        }

        const files = readdirSync(this.persistDir)
            .filter((file) => file.endsWith(KEPT_EXTENSION))
            .sort();

        for (const file of files) {
            const name = file.slice(0, -KEPT_EXTENSION.length);
            let kind: KeptKind = "function";
            try {
                const source = readFileSync(join(this.persistDir, file), "utf8");
                const transformed = transformCode(source, { sync: true });
                const definition = transformed.definitions.find(
                    (entry) => entry.name === name,
                );
                if (!definition || transformed.definitions.length !== 1) {
                    throw new Error(
                        `Expected exactly one definition named '${name}'.`,
                    );
                }
                kind = definition.kind;
                if (this.builtinNames.has(name)) {
                    throw new Error(`'${name}' is now a built-in name.`);
                }
                new vm.Script(transformed.script, {
                    filename: `kept:${name}`,
                    lineOffset: -1,
                }).runInContext(this.context, { timeout: this.timeoutMs });
                this.keptStatus.set(name, { name, kind, loaded: true });
            } catch (error) {
                this.keptStatus.set(name, {
                    name,
                    kind,
                    loaded: false,
                    error: error instanceof Error ? error.message : String(error),
                });
                onLoadError?.(name, error);
            }
        }
    }
}
