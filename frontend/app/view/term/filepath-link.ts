// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getApi } from "@/store/global";
import { fireAndForget } from "@/util/util";
import type { IBufferLine, ILink, ILinkProvider, Terminal } from "@xterm/xterm";

// Quoted paths: "~/path with spaces/file" or '/path with spaces/file'
const QuotedDoublePathRegex = /"((?:\/|~\/|\.\.?\/)(?:[^"\n]+))"(?::(\d+)(?::(\d+))?)?/g;
const QuotedSinglePathRegex = /'((?:\/|~\/|\.\.?\/)(?:[^'\n]+))'(?::(\d+)(?::(\d+))?)?/g;

// Unquoted paths: spaces allowed in non-final segments (before /), escaped spaces (\ ) allowed everywhere
const UnquotedPathRegex =
    /(?:\/|~\/|\.\.?\/)(?:(?:[\w.@~-]|\\[ ])+(?:[ ](?:[\w.@~-]|\\[ ])+)*\/)*(?:[\w.@~-]|\\[ ])+(?::(\d+)(?::(\d+))?)?/g;

const ExistsCacheTTL = 30000;

function isFalsePositive(match: string): boolean {
    if (match.startsWith("//")) return true;
    return false;
}

export type FilePathLinkCallbacks = {
    onHover?: (uri: string | null, mouseX: number, mouseY: number) => void;
    getCwd?: () => string | null;
};

export class FilePathLinkProvider implements ILinkProvider {
    private callbacks: FilePathLinkCallbacks;
    private existsCache: Map<string, { exists: boolean; ts: number }> = new Map();

    constructor(callbacks: FilePathLinkCallbacks) {
        this.callbacks = callbacks;
    }

    provideLinks(lineNumber: number, callback: (links: ILink[] | undefined) => void): void {
        const terminal = this._terminal;
        if (!terminal) {
            callback(undefined);
            return;
        }

        const bufferLine = terminal.buffer.active.getLine(lineNumber - 1);
        if (!bufferLine) {
            callback(undefined);
            return;
        }

        const lineText = getLineText(bufferLine);
        const candidates: { range: ILink["range"]; text: string; resolvedPath: string }[] = [];
        const coveredRanges: { start: number; end: number }[] = [];

        this.collectQuotedPaths(lineText, lineNumber, candidates, coveredRanges);
        this.collectUnquotedPaths(lineText, lineNumber, candidates, coveredRanges);

        if (candidates.length === 0) {
            callback(undefined);
            return;
        }

        // split into cached-hit vs needs-check
        const verified: typeof candidates = [];
        const toCheck: typeof candidates = [];
        for (const c of candidates) {
            const cached = this.existsCache.get(c.resolvedPath);
            if (cached && Date.now() - cached.ts < ExistsCacheTTL) {
                if (cached.exists) verified.push(c);
            } else {
                toCheck.push(c);
            }
        }

        if (toCheck.length === 0) {
            const links = verified.map((c) => this.makeLink(c.range, c.text, c.resolvedPath));
            callback(links.length > 0 ? links : undefined);
            return;
        }

        // async check uncached paths
        Promise.all(
            toCheck.map(async (c) => {
                try {
                    const uri = `wsh://local/${c.resolvedPath}`;
                    const info = await RpcApi.FileInfoCommand(
                        TabRpcClient,
                        { info: { path: uri } },
                        { timeout: 2000 }
                    );
                    const exists = !info.notfound;
                    this.existsCache.set(c.resolvedPath, { exists, ts: Date.now() });
                    return exists ? c : null;
                } catch {
                    this.existsCache.set(c.resolvedPath, { exists: false, ts: Date.now() });
                    return null;
                }
            })
        ).then((results) => {
            for (const r of results) {
                if (r) verified.push(r);
            }
            const links = verified.map((c) => this.makeLink(c.range, c.text, c.resolvedPath));
            callback(links.length > 0 ? links : undefined);
        });
    }

    private collectQuotedPaths(
        lineText: string,
        lineNumber: number,
        candidates: { range: ILink["range"]; text: string; resolvedPath: string }[],
        coveredRanges: { start: number; end: number }[]
    ): void {
        for (const regex of [QuotedDoublePathRegex, QuotedSinglePathRegex]) {
            regex.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = regex.exec(lineText)) !== null) {
                const fullMatch = m[0];
                const innerPath = m[1];
                if (isFalsePositive(innerPath)) continue;

                const pathOnly = innerPath.replace(/:\d+(?::\d+)?$/, "");
                const startX = m.index;
                const range = {
                    start: { x: startX + 1, y: lineNumber },
                    end: { x: startX + fullMatch.length, y: lineNumber },
                };
                coveredRanges.push({ start: startX, end: startX + fullMatch.length });

                const resolvedPath = this.resolvePath(pathOnly);
                candidates.push({ range, text: fullMatch, resolvedPath });
            }
        }
    }

    private collectUnquotedPaths(
        lineText: string,
        lineNumber: number,
        candidates: { range: ILink["range"]; text: string; resolvedPath: string }[],
        coveredRanges: { start: number; end: number }[]
    ): void {
        UnquotedPathRegex.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = UnquotedPathRegex.exec(lineText)) !== null) {
            const rawPath = m[0];
            if (isFalsePositive(rawPath)) continue;

            const startX = m.index;
            const endX = startX + rawPath.length;

            if (coveredRanges.some((r) => startX >= r.start && endX <= r.end)) continue;

            const pathOnly = rawPath.replace(/:\d+(?::\d+)?$/, "");
            const range = {
                start: { x: startX + 1, y: lineNumber },
                end: { x: endX, y: lineNumber },
            };

            const resolvedPath = this.resolvePath(unescapePath(pathOnly));
            candidates.push({ range, text: rawPath, resolvedPath });
        }
    }

    private makeLink(range: ILink["range"], text: string, resolvedPath: string): ILink {
        return {
            range,
            text,
            activate: (_e: MouseEvent, _text: string) => {
                fireAndForget(() => openFilePath(resolvedPath));
            },
            hover: (e: MouseEvent, _text: string) => {
                this.callbacks.onHover?.(resolvedPath, e.clientX, e.clientY);
            },
            leave: () => {
                this.callbacks.onHover?.(null, 0, 0);
            },
        };
    }

    private _terminal: Terminal | null = null;

    attach(terminal: Terminal): void {
        this._terminal = terminal;
    }

    private resolvePath(rawPath: string): string {
        if (rawPath.startsWith("~")) {
            const home = getApi().getHomeDir();
            return home + rawPath.slice(1);
        }
        if (rawPath.startsWith("/")) {
            return rawPath;
        }
        const cwd = this.callbacks.getCwd?.();
        if (cwd) {
            return cwd + "/" + rawPath;
        }
        return rawPath;
    }
}

function unescapePath(path: string): string {
    return path.replace(/\\ /g, " ");
}

function getLineText(bufferLine: IBufferLine): string {
    return bufferLine.translateToString(true);
}

async function openFilePath(filePath: string): Promise<void> {
    getApi().openNativePath(filePath);
}
